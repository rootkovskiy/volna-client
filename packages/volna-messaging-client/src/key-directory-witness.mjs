import { ed25519 } from '@noble/curves/ed25519.js';
import contract from './index.js';
import {
  base64UrlToBytes,
  bytesToBase64Url,
  canonicalKeyDirectoryWitnessStatement,
  keyDirectoryLabel,
  verifyKeyDirectorySnapshot,
} from './mls-runtime.mjs';

const { MAX_TOTAL_DEVICES_PER_ACCOUNT } = contract;

const ID_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const MAX_COMPARE_AND_SWAP_ATTEMPTS = 16;

export class KeyDirectoryWitnessError extends Error {
  constructor(code, cause) {
    super(`VOLNA key-directory witness error (${code})`, cause === undefined ? undefined : { cause });
    this.name = 'KeyDirectoryWitnessError';
    this.code = code;
  }
}

function fail(code, cause) {
  throw new KeyDirectoryWitnessError(code, cause);
}

function object(value, code) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(code);
  return value;
}

function id(value, code) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) fail(code);
  return value;
}

function hash(value, code) {
  if (typeof value !== 'string' || !HASH_PATTERN.test(value)) fail(code);
  return value;
}

function isoDate(value, code) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail(code);
  return value;
}

function exactPrivateKey(value) {
  const bytes = typeof value === 'string' ? base64UrlToBytes(value, 32) : value;
  if (!(bytes instanceof Uint8Array) || bytes.length !== 32) fail('signing_key');
  return bytes.slice();
}

function clone(value) {
  return value === null ? null : JSON.parse(JSON.stringify(value));
}

function normalizeStoredState(value, expectedLabel) {
  const state = object(value, 'stored_state');
  if (state.version !== 1 || !Number.isSafeInteger(state.revision) || state.revision < 1) fail('stored_state');
  if (hash(state.directoryLabel, 'stored_label') !== expectedLabel) fail('stored_label');
  const identityFingerprint = hash(state.identityFingerprint, 'stored_identity');
  if (!Array.isArray(state.entryHashes) || state.entryHashes.length > MAX_TOTAL_DEVICES_PER_ACCOUNT * 2) fail('stored_entries');
  const entryHashes = state.entryHashes.map((value) => hash(value, 'stored_entry'));
  const headHash = state.headHash === null ? null : hash(state.headHash, 'stored_head');
  if ((entryHashes.at(-1) ?? null) !== headHash) fail('stored_head');
  const statement = object(state.statement, 'stored_statement');
  if (
    statement.version !== 1
    || statement.witnessId !== state.witnessId
    || statement.checkpoint?.directoryLabel !== expectedLabel
    || statement.checkpoint?.identityFingerprint !== identityFingerprint
    || statement.checkpoint?.entryCount !== entryHashes.length
    || statement.checkpoint?.headHash !== headHash
  ) fail('stored_statement');
  isoDate(statement.observedAt, 'stored_statement');
  if (typeof statement.signature !== 'string') fail('stored_statement');
  return {
    version: 1,
    revision: state.revision,
    witnessId: id(state.witnessId, 'stored_witness'),
    directoryLabel: expectedLabel,
    identityFingerprint,
    entryHashes,
    headHash,
    statement: clone(statement),
  };
}

export function createMemoryKeyDirectoryWitnessStore() {
  const states = new Map();
  return Object.freeze({
    async load(directoryLabelValue) {
      const directoryLabel = hash(directoryLabelValue, 'store_label');
      return clone(states.get(directoryLabel) ?? null);
    },
    async compareAndSwap(directoryLabelValue, expectedRevision, nextValue) {
      const directoryLabel = hash(directoryLabelValue, 'store_label');
      if (expectedRevision !== null && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)) fail('store_revision');
      const current = states.get(directoryLabel) ?? null;
      if ((current?.revision ?? null) !== expectedRevision) return false;
      const next = normalizeStoredState(nextValue, directoryLabel);
      if (next.revision !== (expectedRevision ?? 0) + 1) fail('store_revision');
      states.set(directoryLabel, clone(next));
      return true;
    },
  });
}

export function createKeyDirectoryWitness(optionsValue) {
  const options = object(optionsValue, 'witness_options');
  const witnessId = id(options.witnessId, 'witness_id');
  const signingKey = exactPrivateKey(options.signingKey);
  const store = object(options.store, 'witness_store');
  if (typeof store.load !== 'function' || typeof store.compareAndSwap !== 'function') fail('witness_store');
  const clock = options.clock === undefined ? Date.now : options.clock;
  if (typeof clock !== 'function') fail('witness_clock');
  const publicKey = bytesToBase64Url(ed25519.getPublicKey(signingKey));
  const publicKeyBytes = base64UrlToBytes(publicKey, 32);
  let destroyed = false;

  const requireLive = () => {
    if (destroyed) fail('witness_destroyed');
  };

  const statementFor = (checkpoint, observedAt) => {
    const unsigned = { version: 1, witnessId, checkpoint, observedAt };
    return {
      ...unsigned,
      signature: bytesToBase64Url(ed25519.sign(
        canonicalKeyDirectoryWitnessStatement(unsigned),
        signingKey,
      )),
    };
  };

  const verifiedStoredState = (value, directoryLabel) => {
    const state = normalizeStoredState(value, directoryLabel);
    const { signature, ...unsigned } = state.statement;
    let verified = false;
    try {
      const signatureBytes = base64UrlToBytes(signature, 64);
      verified = signatureBytes.length === 64 && ed25519.verify(
        signatureBytes,
        canonicalKeyDirectoryWitnessStatement(unsigned),
        publicKeyBytes,
        { zip215: false },
      );
    } catch {
      verified = false;
    }
    if (!verified) fail('stored_signature');
    return state;
  };

  const observe = async (snapshotValue) => {
    requireLive();
    let verification;
    try {
      verification = verifyKeyDirectorySnapshot(snapshotValue);
    } catch (error) {
      fail('snapshot_invalid', error);
    }
    const directoryLabel = keyDirectoryLabel(verification.accountId);
    const observedTime = clock();
    if (!Number.isSafeInteger(observedTime) || observedTime < 0) fail('witness_clock');
    const observedAt = new Date(observedTime).toISOString();
    const checkpoint = {
      version: 1,
      directoryLabel,
      identityFingerprint: verification.identityFingerprint,
      entryCount: verification.entryHashes.length,
      headHash: verification.headHash,
    };
    for (let attempt = 0; attempt < MAX_COMPARE_AND_SWAP_ATTEMPTS; attempt += 1) {
      const loaded = await store.load(directoryLabel);
      const previous = loaded === null ? null : verifiedStoredState(loaded, directoryLabel);
      if (previous !== null) {
        if (previous.witnessId !== witnessId || previous.identityFingerprint !== verification.identityFingerprint) {
          fail('identity_changed');
        }
        if (verification.entryHashes.length < previous.entryHashes.length) fail('rollback');
        if (previous.entryHashes.some((entryHash, index) => verification.entryHashes[index] !== entryHash)) fail('split_view');
      }
      const statement = statementFor(checkpoint, observedAt);
      const next = {
        version: 1,
        revision: (previous?.revision ?? 0) + 1,
        witnessId,
        directoryLabel,
        identityFingerprint: verification.identityFingerprint,
        entryHashes: [...verification.entryHashes],
        headHash: verification.headHash,
        statement,
      };
      if (await store.compareAndSwap(directoryLabel, previous?.revision ?? null, next)) return clone(statement);
    }
    fail('store_contention');
  };

  const getStatement = async (checkpointValue) => {
    requireLive();
    const checkpoint = object(checkpointValue, 'checkpoint_query');
    const directoryLabel = hash(checkpoint.directoryLabel, 'checkpoint_label');
    const identityFingerprint = hash(checkpoint.identityFingerprint, 'checkpoint_identity');
    if (
      !Number.isSafeInteger(checkpoint.entryCount)
      || checkpoint.entryCount < 0
      || checkpoint.entryCount > MAX_TOTAL_DEVICES_PER_ACCOUNT * 2
    ) {
      fail('checkpoint_entry_count');
    }
    const headHash = checkpoint.headHash === null ? null : hash(checkpoint.headHash, 'checkpoint_head');
    const loaded = await store.load(directoryLabel);
    if (loaded === null) return null;
    const state = verifiedStoredState(loaded, directoryLabel);
    if (
      state.identityFingerprint !== identityFingerprint
      || state.entryHashes.length !== checkpoint.entryCount
      || state.headHash !== headHash
    ) return null;
    return clone(state.statement);
  };

  return Object.freeze({
    witnessId,
    publicKey,
    observe,
    getStatement,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      signingKey.fill(0);
    },
  });
}
