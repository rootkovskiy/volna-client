import { ed25519 } from '@noble/curves/ed25519.js';
import contract from './index.js';
import {
  base64UrlToBytes,
  canonicalKeyDirectoryWitnessStatement,
} from './mls-runtime.mjs';

const { MAX_TOTAL_DEVICES_PER_ACCOUNT } = contract;
const ID_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const MAX_CHECKPOINTS = MAX_TOTAL_DEVICES_PER_ACCOUNT * 2 + 1;
const MAX_COMPARE_AND_SWAP_ATTEMPTS = 16;

export class KeyDirectoryGossipError extends Error {
  constructor(code, cause) {
    super(`VOLNA key-directory gossip error (${code})`, cause === undefined ? undefined : { cause });
    this.name = 'KeyDirectoryGossipError';
    this.code = code;
  }
}

function fail(code, cause) {
  throw new KeyDirectoryGossipError(code, cause);
}

function object(value, code) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(code);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail(code);
  return value;
}

function exactKeys(value, keys, code) {
  if (Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) fail(code);
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

function clone(value) {
  return value === null ? null : JSON.parse(JSON.stringify(value));
}

function normalizePolicy(value) {
  const policy = object(value, 'policy');
  exactKeys(policy, ['witnesses'], 'policy');
  if (!Array.isArray(policy.witnesses) || policy.witnesses.length < 2 || policy.witnesses.length > 8) fail('policy');
  const witnesses = new Map();
  const seenKeys = new Set();
  for (const witnessValue of policy.witnesses) {
    const witness = object(witnessValue, 'policy_witness');
    exactKeys(witness, ['id', 'publicKey'], 'policy_witness');
    const witnessId = id(witness.id, 'policy_witness_id');
    let publicKey;
    try {
      publicKey = base64UrlToBytes(witness.publicKey, 32);
    } catch (error) {
      fail('policy_witness_key', error);
    }
    if (publicKey.length !== 32 || witnesses.has(witnessId) || seenKeys.has(witness.publicKey)) fail('policy_witness_duplicate');
    witnesses.set(witnessId, publicKey);
    seenKeys.add(witness.publicKey);
  }
  return witnesses;
}

function normalizeStatement(value, witnesses) {
  const statement = object(value, 'statement');
  exactKeys(statement, ['version', 'witnessId', 'checkpoint', 'observedAt', 'signature'], 'statement');
  if (statement.version !== 1) fail('statement');
  const witnessId = id(statement.witnessId, 'statement_witness');
  const publicKey = witnesses.get(witnessId);
  if (publicKey === undefined) fail('statement_witness');
  const checkpoint = object(statement.checkpoint, 'checkpoint');
  exactKeys(checkpoint, ['version', 'directoryLabel', 'identityFingerprint', 'entryCount', 'headHash'], 'checkpoint');
  if (
    checkpoint.version !== 1
    || !Number.isSafeInteger(checkpoint.entryCount)
    || checkpoint.entryCount < 0
    || checkpoint.entryCount > MAX_TOTAL_DEVICES_PER_ACCOUNT * 2
  ) fail('checkpoint');
  const normalizedCheckpoint = {
    version: 1,
    directoryLabel: hash(checkpoint.directoryLabel, 'checkpoint_label'),
    identityFingerprint: hash(checkpoint.identityFingerprint, 'checkpoint_identity'),
    entryCount: checkpoint.entryCount,
    headHash: checkpoint.headHash === null ? null : hash(checkpoint.headHash, 'checkpoint_head'),
  };
  if ((normalizedCheckpoint.entryCount === 0) !== (normalizedCheckpoint.headHash === null)) fail('checkpoint_head');
  const observedAt = isoDate(statement.observedAt, 'statement_time');
  let signature;
  try {
    signature = base64UrlToBytes(statement.signature, 64);
  } catch (error) {
    fail('statement_signature', error);
  }
  let verified = false;
  try {
    verified = signature.length === 64 && ed25519.verify(
      signature,
      canonicalKeyDirectoryWitnessStatement({ version: 1, witnessId, checkpoint: normalizedCheckpoint, observedAt }),
      publicKey,
      { zip215: false },
    );
  } catch {
    verified = false;
  } finally {
    signature.fill(0);
  }
  if (!verified) fail('statement_signature');
  return {
    version: 1,
    witnessId,
    checkpoint: normalizedCheckpoint,
    observedAt,
    signature: statement.signature,
  };
}

function normalizeStoredState(value, expectedLabel, witnesses) {
  const state = object(value, 'stored_state');
  exactKeys(state, ['version', 'revision', 'directoryLabel', 'identityFingerprint', 'checkpoints', 'witnesses'], 'stored_state');
  if (state.version !== 1 || !Number.isSafeInteger(state.revision) || state.revision < 1) fail('stored_state');
  if (hash(state.directoryLabel, 'stored_label') !== expectedLabel) fail('stored_label');
  const identityFingerprint = hash(state.identityFingerprint, 'stored_identity');
  if (!Array.isArray(state.checkpoints) || state.checkpoints.length > MAX_CHECKPOINTS) fail('stored_checkpoints');
  let previousCount = -1;
  const checkpoints = state.checkpoints.map((value) => {
    const checkpoint = object(value, 'stored_checkpoint');
    exactKeys(checkpoint, ['entryCount', 'headHash', 'statements', 'witnessIds'], 'stored_checkpoint');
    if (
      !Number.isSafeInteger(checkpoint.entryCount)
      || checkpoint.entryCount < 0
      || checkpoint.entryCount > MAX_TOTAL_DEVICES_PER_ACCOUNT * 2
      || checkpoint.entryCount <= previousCount
      || !Array.isArray(checkpoint.witnessIds)
    ) fail('stored_checkpoint');
    const headHash = checkpoint.headHash === null ? null : hash(checkpoint.headHash, 'stored_checkpoint_head');
    if ((checkpoint.entryCount === 0) !== (headHash === null)) fail('stored_checkpoint_head');
    const statementValues = object(checkpoint.statements, 'stored_checkpoint_statements');
    const statements = {};
    for (const [witnessId, statementValue] of Object.entries(statementValues)) {
      if (!witnesses.has(witnessId)) fail('stored_checkpoint_witness');
      const statement = normalizeStatement(statementValue, witnesses);
      if (
        statement.witnessId !== witnessId
        || statement.checkpoint.directoryLabel !== expectedLabel
        || statement.checkpoint.identityFingerprint !== identityFingerprint
        || statement.checkpoint.entryCount !== checkpoint.entryCount
        || statement.checkpoint.headHash !== headHash
      ) fail('stored_checkpoint_witness');
      statements[witnessId] = statement;
    }
    const witnessIds = checkpoint.witnessIds.map((value) => id(value, 'stored_checkpoint_witness')).sort();
    const signedWitnessIds = Object.keys(statements).sort();
    if (
      new Set(witnessIds).size !== witnessIds.length
      || witnessIds.some((value) => !witnesses.has(value))
      || JSON.stringify(witnessIds) !== JSON.stringify(signedWitnessIds)
    ) {
      fail('stored_checkpoint_witness');
    }
    previousCount = checkpoint.entryCount;
    return { entryCount: checkpoint.entryCount, headHash, witnessIds, statements };
  });
  const witnessValues = object(state.witnesses, 'stored_witnesses');
  const latest = {};
  for (const [witnessId, statementValue] of Object.entries(witnessValues)) {
    if (!witnesses.has(witnessId)) fail('stored_witness');
    const statement = normalizeStatement(statementValue, witnesses);
    if (
      statement.witnessId !== witnessId
      || statement.checkpoint.directoryLabel !== expectedLabel
      || statement.checkpoint.identityFingerprint !== identityFingerprint
    ) fail('stored_witness');
    latest[witnessId] = statement;
  }
  return {
    version: 1,
    revision: state.revision,
    directoryLabel: expectedLabel,
    identityFingerprint,
    checkpoints,
    witnesses: latest,
  };
}

export function createMemoryKeyDirectoryGossipStore() {
  const states = new Map();
  return Object.freeze({
    async load(directoryLabelValue) {
      const directoryLabel = hash(directoryLabelValue, 'store_label');
      return clone(states.get(directoryLabel) ?? null);
    },
    async compareAndSwap(directoryLabelValue, expectedRevision, nextValue) {
      const directoryLabel = hash(directoryLabelValue, 'store_label');
      const current = states.get(directoryLabel) ?? null;
      if ((current?.revision ?? null) !== expectedRevision) return false;
      states.set(directoryLabel, clone(nextValue));
      return true;
    },
  });
}

export function createKeyDirectoryGossipMonitor(optionsValue) {
  const options = object(optionsValue, 'options');
  exactKeys(options, ['policy', 'store'], 'options');
  const witnesses = normalizePolicy(options.policy);
  const store = object(options.store, 'store');
  if (typeof store.load !== 'function' || typeof store.compareAndSwap !== 'function') fail('store');

  const observe = async (statementValue) => {
    const statement = normalizeStatement(statementValue, witnesses);
    const checkpoint = statement.checkpoint;
    for (let attempt = 0; attempt < MAX_COMPARE_AND_SWAP_ATTEMPTS; attempt += 1) {
      const loaded = await store.load(checkpoint.directoryLabel);
      const previous = loaded === null ? null : normalizeStoredState(loaded, checkpoint.directoryLabel, witnesses);
      if (previous !== null && previous.identityFingerprint !== checkpoint.identityFingerprint) fail('identity_changed');
      const previousStatement = previous?.witnesses[statement.witnessId];
      if (previousStatement !== undefined) {
        if (checkpoint.entryCount < previousStatement.checkpoint.entryCount) fail('witness_rollback');
        if (
          checkpoint.entryCount === previousStatement.checkpoint.entryCount
          && checkpoint.headHash !== previousStatement.checkpoint.headHash
        ) fail('witness_equivocation');
        if (Date.parse(statement.observedAt) < Date.parse(previousStatement.observedAt)) fail('witness_time_rollback');
        if (JSON.stringify(previousStatement) === JSON.stringify(statement)) return clone(previous);
      }
      const checkpoints = previous?.checkpoints.map((value) => ({
        ...value,
        witnessIds: [...value.witnessIds],
        statements: clone(value.statements),
      })) ?? [];
      const existing = checkpoints.find((value) => value.entryCount === checkpoint.entryCount);
      if (existing !== undefined) {
        if (existing.headHash !== checkpoint.headHash) fail('split_view');
        if (!existing.witnessIds.includes(statement.witnessId)) existing.witnessIds.push(statement.witnessId);
        existing.statements[statement.witnessId] = statement;
        existing.witnessIds.sort();
      } else {
        checkpoints.push({
          entryCount: checkpoint.entryCount,
          headHash: checkpoint.headHash,
          witnessIds: [statement.witnessId],
          statements: { [statement.witnessId]: statement },
        });
        checkpoints.sort((left, right) => left.entryCount - right.entryCount);
      }
      const next = {
        version: 1,
        revision: (previous?.revision ?? 0) + 1,
        directoryLabel: checkpoint.directoryLabel,
        identityFingerprint: checkpoint.identityFingerprint,
        checkpoints,
        witnesses: { ...(previous?.witnesses ?? {}), [statement.witnessId]: statement },
      };
      if (await store.compareAndSwap(checkpoint.directoryLabel, previous?.revision ?? null, next)) return clone(next);
    }
    fail('store_contention');
  };

  return Object.freeze({
    observe,
    async getEvidence(directoryLabelValue) {
      const directoryLabel = hash(directoryLabelValue, 'evidence_label');
      const loaded = await store.load(directoryLabel);
      return loaded === null ? null : clone(normalizeStoredState(loaded, directoryLabel, witnesses));
    },
  });
}
