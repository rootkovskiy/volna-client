import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';

const encoder = new TextEncoder();
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const DECIMAL_PATTERN = /^(?:0|[1-9][0-9]{0,19})$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MAP_TAG = 'VOLNA-CHAT-KEY-TRANSPARENCY-MAP';
const ROOT_TAG = 'VOLNA-CHAT-KEY-TRANSPARENCY-ROOT';
const MAX_NOTE_BYTES = 32 * 1024;
const MAX_NOTE_SIGNATURES = 16;
const MAX_ACTIVE_DEVICES = 8;
const MAP_DEPTH = 32;
const MAP_FANOUT = 256;
const MAX_MAP_PROOF_SIBLINGS = 4096;
const MAX_SAFE_TIMESTAMP = BigInt(Number.MAX_SAFE_INTEGER);

export class KeyTransparencyError extends Error {
  constructor(code, cause) {
    super(`VOLNA key transparency error (${code})`, cause === undefined ? undefined : { cause });
    this.name = 'KeyTransparencyError';
    this.code = code;
  }
}

function fail(code, cause) {
  throw new KeyTransparencyError(code, cause);
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

function hex(value, code) {
  if (typeof value !== 'string' || !HASH_PATTERN.test(value)) fail(code);
  return value;
}

function decimal(value, code) {
  if (typeof value !== 'string' || !DECIMAL_PATTERN.test(value)) fail(code);
  return value;
}

function isoDate(value, code) {
  if (typeof value !== 'string' || !ISO_DATE_PATTERN.test(value) || new Date(value).toISOString() !== value) fail(code);
  return value;
}

function concat(...values) {
  const length = values.reduce((total, value) => total + value.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const value of values) {
    result.set(value, offset);
    offset += value.length;
  }
  return result;
}

function equal(left, right) {
  if (!(left instanceof Uint8Array) || !(right instanceof Uint8Array) || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

function toHex(value) {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function fromHex(value, code = 'hex') {
  hex(value, code);
  const result = new Uint8Array(32);
  for (let index = 0; index < result.length; index += 1) result[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  return result;
}

function decodeBase64(value, code) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 8192) fail(code);
  let decoded;
  try {
    if (typeof globalThis.Buffer !== 'undefined') decoded = new Uint8Array(globalThis.Buffer.from(value, 'base64'));
    else {
      const binary = globalThis.atob(value);
      decoded = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    }
  } catch (error) {
    fail(code, error);
  }
  const canonical = encodeBase64(decoded);
  if (canonical !== value) fail(code);
  return decoded;
}

function encodeBase64(value) {
  if (typeof globalThis.Buffer !== 'undefined') return globalThis.Buffer.from(value).toString('base64');
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary);
}

const DEFAULT_HASHES = (() => {
  const result = new Array(MAP_DEPTH + 1);
  result[MAP_DEPTH] = sha256(Uint8Array.of(0x02));
  for (let depth = MAP_DEPTH - 1; depth >= 0; depth -= 1) {
    result[depth] = sha256(concat(Uint8Array.of(0x03), ...Array(MAP_FANOUT).fill(result[depth + 1])));
  }
  return result;
})();

export function keyTransparencyDefaultHash(depth) {
  if (!Number.isInteger(depth) || depth < 0 || depth > MAP_DEPTH) fail('default_depth');
  return toHex(DEFAULT_HASHES[depth]);
}

export function normalizeKeyTransparencyLeaf(value) {
  const leaf = object(value, 'map_leaf');
  exactKeys(
    leaf,
    ['version', 'directoryLabel', 'identityFingerprint', 'entryCount', 'headHash', 'deviceIds'],
    'map_leaf_keys',
  );
  if (leaf.version !== 1) fail('map_leaf_version');
  const directoryLabel = hex(leaf.directoryLabel, 'map_leaf_label');
  const identityFingerprint = hex(leaf.identityFingerprint, 'map_leaf_identity');
  if (!Number.isSafeInteger(leaf.entryCount) || leaf.entryCount < 1 || leaf.entryCount > 64) fail('map_leaf_count');
  const headHash = hex(leaf.headHash, 'map_leaf_head');
  if (!Array.isArray(leaf.deviceIds) || leaf.deviceIds.length > MAX_ACTIVE_DEVICES) fail('map_leaf_devices');
  const deviceIds = leaf.deviceIds.map((deviceId) => {
    if (typeof deviceId !== 'string' || !/^[A-Za-z0-9_-]{8,80}$/.test(deviceId)) fail('map_leaf_device');
    return deviceId;
  });
  if (new Set(deviceIds).size !== deviceIds.length) fail('map_leaf_device_duplicate');
  const sorted = [...deviceIds].sort();
  if (sorted.some((deviceId, index) => deviceId !== deviceIds[index])) fail('map_leaf_device_order');
  return { version: 1, directoryLabel, identityFingerprint, entryCount: leaf.entryCount, headHash, deviceIds };
}

export function canonicalKeyTransparencyLeaf(value) {
  return JSON.stringify(normalizeKeyTransparencyLeaf(value));
}

export function hashKeyTransparencyLeaf(keyHex, value) {
  const key = fromHex(keyHex, 'map_key');
  const canonical = encoder.encode(canonicalKeyTransparencyLeaf(value));
  return toHex(sha256(concat(Uint8Array.of(0x00), key, sha256(canonical))));
}

export function verifyKeyTransparencyMapProof(inputValue) {
  const input = object(inputValue, 'map_proof');
  exactKeys(input, ['key', 'value', 'siblings', 'root'], 'map_proof_keys');
  const key = fromHex(input.key, 'map_key');
  const value = normalizeKeyTransparencyLeaf(input.value);
  const expectedRoot = fromHex(input.root, 'map_root');
  if (!Array.isArray(input.siblings) || input.siblings.length > MAX_MAP_PROOF_SIBLINGS) fail('map_proof_siblings');
  const siblings = new Map();
  let previousOrder = -1;
  for (const siblingValue of input.siblings) {
    const sibling = object(siblingValue, 'map_proof_sibling');
    exactKeys(sibling, ['depth', 'index', 'hash'], 'map_proof_sibling_keys');
    if (
      !Number.isInteger(sibling.depth)
      || sibling.depth < 0
      || sibling.depth >= MAP_DEPTH
      || !Number.isInteger(sibling.index)
      || sibling.index < 0
      || sibling.index >= MAP_FANOUT
      || sibling.index === key[sibling.depth]
    ) {
      fail('map_proof_depth');
    }
    const siblingKey = `${sibling.depth}:${sibling.index}`;
    const order = sibling.depth * MAP_FANOUT + sibling.index;
    if (order <= previousOrder || siblings.has(siblingKey)) fail('map_proof_order');
    previousOrder = order;
    const siblingHash = fromHex(sibling.hash, 'map_proof_hash');
    if (equal(siblingHash, DEFAULT_HASHES[sibling.depth + 1])) fail('map_proof_noncanonical');
    siblings.set(siblingKey, siblingHash);
  }
  let current = fromHex(hashKeyTransparencyLeaf(input.key, value), 'map_leaf_hash');
  for (let depth = MAP_DEPTH - 1; depth >= 0; depth -= 1) {
    const children = Array(MAP_FANOUT).fill(DEFAULT_HASHES[depth + 1]);
    for (let index = 0; index < MAP_FANOUT; index += 1) {
      const sibling = siblings.get(`${depth}:${index}`);
      if (sibling !== undefined) children[index] = sibling;
    }
    children[key[depth]] = current;
    current = sha256(concat(Uint8Array.of(0x03), ...children));
  }
  if (!equal(current, expectedRoot)) fail('map_proof_root');
  return { key: input.key, value, root: input.root };
}

export function normalizeKeyTransparencyRootEntry(value) {
  const entry = object(value, 'root_entry');
  exactKeys(entry, ['tag', 'version', 'generation', 'root', 'previousGeneration', 'previousRoot', 'updateCount', 'createdAt'], 'root_entry_keys');
  if (entry.tag !== ROOT_TAG || entry.version !== 1) fail('root_entry_version');
  const generation = decimal(entry.generation, 'root_entry_generation');
  if (generation === '0') fail('root_entry_generation');
  const root = hex(entry.root, 'root_entry_root');
  const previousGeneration = entry.previousGeneration === null
    ? null
    : decimal(entry.previousGeneration, 'root_entry_previous_generation');
  const previousRoot = entry.previousRoot === null ? null : hex(entry.previousRoot, 'root_entry_previous');
  if ((previousGeneration === null) !== (previousRoot === null)) fail('root_entry_previous');
  if (previousGeneration !== null && BigInt(previousGeneration) >= BigInt(generation)) fail('root_entry_previous_generation');
  if (!Number.isSafeInteger(entry.updateCount) || entry.updateCount < 1 || entry.updateCount > 100000) fail('root_entry_updates');
  const createdAt = isoDate(entry.createdAt, 'root_entry_time');
  return { tag: ROOT_TAG, version: 1, generation, root, previousGeneration, previousRoot, updateCount: entry.updateCount, createdAt };
}

export function canonicalKeyTransparencyRootEntry(value) {
  return JSON.stringify(normalizeKeyTransparencyRootEntry(value));
}

export function rfc6962LeafHash(entryBytes) {
  if (!(entryBytes instanceof Uint8Array) || entryBytes.length === 0 || entryBytes.length > 64 * 1024) fail('log_leaf');
  return toHex(sha256(concat(Uint8Array.of(0x00), entryBytes)));
}

export function verifyRfc6962Inclusion(inputValue) {
  const input = object(inputValue, 'log_inclusion');
  exactKeys(input, ['leaf', 'index', 'treeSize', 'proof', 'root'], 'log_inclusion_keys');
  if (!(input.leaf instanceof Uint8Array)) fail('log_leaf');
  const index = BigInt(decimal(input.index, 'log_index'));
  const treeSize = BigInt(decimal(input.treeSize, 'log_size'));
  if (treeSize < 1n || index >= treeSize || !Array.isArray(input.proof) || input.proof.length > 64) fail('log_inclusion');
  let current = fromHex(rfc6962LeafHash(input.leaf), 'log_leaf_hash');
  let position = index;
  let last = treeSize - 1n;
  let proofIndex = 0;
  while (last > 0n) {
    if ((position & 1n) === 1n) {
      if (proofIndex >= input.proof.length) fail('log_inclusion_short');
      current = sha256(concat(Uint8Array.of(0x01), fromHex(input.proof[proofIndex++], 'log_proof_hash'), current));
    } else if (position < last) {
      if (proofIndex >= input.proof.length) fail('log_inclusion_short');
      current = sha256(concat(Uint8Array.of(0x01), current, fromHex(input.proof[proofIndex++], 'log_proof_hash')));
    }
    position >>= 1n;
    last >>= 1n;
  }
  if (proofIndex !== input.proof.length || !equal(current, fromHex(input.root, 'log_root'))) fail('log_inclusion_root');
  return true;
}

function parseVkey(value, expectedType, code) {
  if (typeof value !== 'string' || value.length > 8192) fail(code);
  const firstPlus = value.indexOf('+');
  const secondPlus = value.indexOf('+', firstPlus + 1);
  if (firstPlus < 1 || secondPlus <= firstPlus + 1) fail(code);
  const name = value.slice(0, firstPlus);
  const idHex = value.slice(firstPlus + 1, secondPlus);
  if (!/^[0-9a-f]{8}$/.test(idHex) || /[\s+]/u.test(name)) fail(code);
  const keyMaterial = decodeBase64(value.slice(secondPlus + 1), code);
  if (keyMaterial.length !== 33 || keyMaterial[0] !== expectedType) fail(code);
  const publicKey = keyMaterial.subarray(1);
  const expectedId = sha256(concat(encoder.encode(`${name}\n`), Uint8Array.of(expectedType), publicKey)).subarray(0, 4);
  if (toHex(expectedId) !== idHex) fail(code);
  return { name, idHex, id: expectedId, publicKey, type: expectedType };
}

function parseCheckpointNote(noteValue) {
  if (typeof noteValue !== 'string' || encoder.encode(noteValue).length > MAX_NOTE_BYTES) fail('checkpoint_note');
  if (!noteValue.endsWith('\n') || /[\x00-\x09\x0b-\x1f\x7f]/u.test(noteValue)) fail('checkpoint_note');
  const separator = noteValue.lastIndexOf('\n\n');
  if (separator < 1) fail('checkpoint_note');
  const body = noteValue.slice(0, separator + 1);
  const signatureText = noteValue.slice(separator + 2);
  const lines = body.slice(0, -1).split('\n');
  if (lines.length < 3 || lines.some((line) => line.length === 0)) fail('checkpoint_body');
  const size = decimal(lines[1], 'checkpoint_size');
  const rootBytes = decodeBase64(lines[2], 'checkpoint_root');
  if (rootBytes.length !== 32) fail('checkpoint_root');
  const signatureLines = signatureText.slice(0, -1).split('\n');
  if (signatureLines.length < 1 || signatureLines.length > MAX_NOTE_SIGNATURES) fail('checkpoint_signatures');
  const signatures = signatureLines.map((line) => {
    const match = /^— ([^\s+]+) ([A-Za-z0-9+/]+={0,2})$/u.exec(line);
    if (!match) fail('checkpoint_signature_line');
    const bytes = decodeBase64(match[2], 'checkpoint_signature');
    if (bytes.length < 5) fail('checkpoint_signature');
    return { name: match[1], id: bytes.subarray(0, 4), payload: bytes.subarray(4) };
  });
  return { body, origin: lines[0], size, root: toHex(rootBytes), signatures };
}

function parseC2spKeyTransparencyPolicy(policyValue) {
  const policy = object(policyValue, 'checkpoint_policy');
  exactKeys(policy, ['origin', 'logVkey', 'threshold', 'maxAgeSeconds', 'witnessVkeys'], 'checkpoint_policy_keys');
  if (typeof policy.origin !== 'string' || policy.origin.length === 0 || policy.origin.length > 255) fail('checkpoint_origin');
  if (!Number.isInteger(policy.threshold) || policy.threshold < 2 || policy.threshold > 8) fail('checkpoint_threshold');
  if (!Number.isInteger(policy.maxAgeSeconds) || policy.maxAgeSeconds < 30 || policy.maxAgeSeconds > 86400) fail('checkpoint_age');
  const log = parseVkey(policy.logVkey, 0x01, 'checkpoint_log_vkey');
  if (!Array.isArray(policy.witnessVkeys) || policy.witnessVkeys.length < policy.threshold || policy.witnessVkeys.length > 8) {
    fail('checkpoint_witness_policy');
  }
  const witnesses = policy.witnessVkeys.map((value) => parseVkey(value, 0x04, 'checkpoint_witness_vkey'));
  if (
    new Set(witnesses.map((value) => value.name)).size !== witnesses.length
    || new Set(witnesses.map((value) => `${value.name}+${value.idHex}`)).size !== witnesses.length
  ) fail('checkpoint_witness_duplicate');
  if (log.name !== policy.origin) fail('checkpoint_origin');
  return {
    normalized: {
      origin: policy.origin,
      logVkey: policy.logVkey,
      threshold: policy.threshold,
      maxAgeSeconds: policy.maxAgeSeconds,
      witnessVkeys: [...policy.witnessVkeys],
    },
    log,
    witnesses,
  };
}

export function normalizeC2spKeyTransparencyPolicy(policyValue) {
  return parseC2spKeyTransparencyPolicy(policyValue).normalized;
}

export function verifyC2spCheckpoint(inputValue) {
  const input = object(inputValue, 'checkpoint_verification');
  exactKeys(input, ['note', 'policy', 'now'], 'checkpoint_verification_keys');
  if (!Number.isSafeInteger(input.now) || input.now < 0) fail('checkpoint_now');
  const { normalized: policy, log, witnesses } = parseC2spKeyTransparencyPolicy(input.policy);
  const note = parseCheckpointNote(input.note);
  if (note.origin !== policy.origin) fail('checkpoint_origin');
  let logVerified = false;
  const verifiedWitnesses = [];
  const seenSigners = new Set();
  let staleWitnesses = 0;
  for (const signature of note.signatures) {
    if (signature.name === log.name && equal(signature.id, log.id)) {
      const signerKey = `${log.name}+${log.idHex}`;
      if (seenSigners.has(signerKey)) fail('checkpoint_signature_duplicate');
      seenSigners.add(signerKey);
      if (signature.payload.length !== 64 || !ed25519.verify(signature.payload, encoder.encode(note.body), log.publicKey, { zip215: false })) {
        fail('checkpoint_log_signature');
      }
      logVerified = true;
      continue;
    }
    const witness = witnesses.find((candidate) => candidate.name === signature.name && equal(candidate.id, signature.id));
    if (!witness) continue;
    const signerKey = `${witness.name}+${witness.idHex}`;
    if (seenSigners.has(signerKey)) fail('checkpoint_signature_duplicate');
    seenSigners.add(signerKey);
    if (signature.payload.length !== 72) fail('checkpoint_witness_signature');
    let timestamp = 0n;
    for (const byte of signature.payload.subarray(0, 8)) timestamp = (timestamp << 8n) | BigInt(byte);
    if (timestamp > MAX_SAFE_TIMESTAMP) fail('checkpoint_witness_time');
    const timestampNumber = Number(timestamp);
    const message = encoder.encode(`cosignature/v1\ntime ${timestampNumber}\n${note.body}`);
    if (!ed25519.verify(signature.payload.subarray(8), message, witness.publicKey, { zip215: false })) {
      fail('checkpoint_witness_signature');
    }
    if (timestampNumber > input.now + 300) fail('checkpoint_witness_future');
    if (input.now - timestampNumber > policy.maxAgeSeconds) staleWitnesses += 1;
    else verifiedWitnesses.push({ name: witness.name, timestamp: timestampNumber });
  }
  if (!logVerified) fail('checkpoint_log_signature_missing');
  if (verifiedWitnesses.length < policy.threshold) {
    if (verifiedWitnesses.length + staleWitnesses >= policy.threshold) fail('checkpoint_witness_stale');
    fail('checkpoint_witness_quorum');
  }
  return {
    origin: note.origin,
    treeSize: note.size,
    root: note.root,
    witnessNames: verifiedWitnesses.map((value) => value.name).sort(),
    oldestWitnessTimestamp: Math.min(...verifiedWitnesses.map((value) => value.timestamp)),
  };
}

export const KEY_TRANSPARENCY_MAP_TAG = MAP_TAG;
export const KEY_TRANSPARENCY_ROOT_TAG = ROOT_TAG;
