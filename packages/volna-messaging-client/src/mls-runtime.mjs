import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import {
  acceptAll,
  createApplicationMessage,
  createCommit,
  createGroup as createMlsGroup,
  decodeGroupState,
  decodeMlsMessage,
  emptyPskIndex,
  encodeGroupState,
  encodeMlsMessage,
  generateKeyPackageWithKey,
  getCiphersuiteFromName,
  joinGroup as joinMlsGroup,
  processPrivateMessage,
  processPublicMessage,
  zeroOutUint8Array,
} from 'ts-mls';
import { defaultClientConfig } from 'ts-mls/clientConfig.js';
import { getGroupMembers } from 'ts-mls/clientState.js';
import { makeKeyPackageRef, verifyKeyPackage } from 'ts-mls/keyPackage.js';
import { unprotectPrivateMessage } from 'ts-mls/messageProtection.js';
import { getSenderLeafNodeIndex } from 'ts-mls/sender.js';
import contract from './index.js';
import { createVolnaCryptoProvider, exactBytes, VolnaCryptoError } from './crypto-provider.mjs';

const {
  CHAT_CIPHERSUITE,
  CHAT_PROTOCOL_VERSION,
  MAX_TOTAL_DEVICES_PER_ACCOUNT,
  canonicalDeviceAuthorization,
  canonicalDeviceRegistrationProof,
  canonicalEnvelopeAad,
  canonicalMlsRoster,
  decodeContentEvent,
  encodeContentEvent,
  normalizeTransferDeviceDraft,
} = contract;

const CREDENTIAL_TAG = 'VOLNA-CHAT-CREDENTIAL';
const GROUP_TAG = 'VOLNA-CHAT-GROUP';
const GROUP_ACTIVATION_TAG = 'VOLNA-CHAT-GROUP-ACTIVATION';
const STATE_AAD_TAG = 'VOLNA-CHAT-LOCAL-STATE';
const STATE_ALGORITHM = 'XCHACHA20-POLY1305';
const STATE_VERSION = 3;
const KEY_DIRECTORY_LABEL_TAG = 'VOLNA-CHAT-KEY-DIRECTORY-LABEL';
const KEY_DIRECTORY_WITNESS_TAG = 'VOLNA-CHAT-KEY-DIRECTORY-WITNESS';
const KEY_PACKAGE_LIFETIME_SECONDS = 30 * 24 * 60 * 60;
const CLOCK_SKEW_SECONDS = 5 * 60;
const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const HEX_ALPHABET = '0123456789abcdef';
const ID_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;

export class MlsRuntimeError extends Error {
  constructor(code, cause) {
    super(`VOLNA MLS runtime error (${code})`, cause === undefined ? undefined : { cause });
    this.name = 'MlsRuntimeError';
    this.code = code;
  }
}

function fail(code, cause) {
  throw new MlsRuntimeError(code, cause);
}

function assertId(value, code = 'id') {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) fail(code);
  return value;
}

function assertPlainObject(value, code = 'object') {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(code);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail(code);
  return value;
}

function assertExactKeys(value, keys, code) {
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype' || !allowed.has(key)) fail(code);
  }
}

function equalBytes(left, right) {
  if (!(left instanceof Uint8Array) || !(right instanceof Uint8Array) || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

function utf8Encode(value) {
  if (typeof value !== 'string') fail('utf8_input');
  const bytes = [];
  for (let index = 0; index < value.length; index += 1) {
    let codePoint = value.charCodeAt(index);
    if (codePoint >= 0xd800 && codePoint <= 0xdbff) {
      const low = value.charCodeAt(index + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        codePoint = 0x10000 + ((codePoint - 0xd800) << 10) + (low - 0xdc00);
        index += 1;
      } else {
        codePoint = 0xfffd;
      }
    } else if (codePoint >= 0xdc00 && codePoint <= 0xdfff) {
      codePoint = 0xfffd;
    }
    if (codePoint <= 0x7f) bytes.push(codePoint);
    else if (codePoint <= 0x7ff) bytes.push(0xc0 | (codePoint >>> 6), 0x80 | (codePoint & 0x3f));
    else if (codePoint <= 0xffff) {
      bytes.push(0xe0 | (codePoint >>> 12), 0x80 | ((codePoint >>> 6) & 0x3f), 0x80 | (codePoint & 0x3f));
    } else {
      bytes.push(
        0xf0 | (codePoint >>> 18),
        0x80 | ((codePoint >>> 12) & 0x3f),
        0x80 | ((codePoint >>> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return Uint8Array.from(bytes);
}

function utf8Decode(bytes) {
  if (!(bytes instanceof Uint8Array)) fail('utf8_bytes');
  const codePoints = [];
  for (let index = 0; index < bytes.length;) {
    const first = bytes[index++];
    if (first <= 0x7f) {
      codePoints.push(first);
      continue;
    }
    let count;
    let codePoint;
    let minimum;
    if (first >= 0xc2 && first <= 0xdf) {
      count = 1;
      codePoint = first & 0x1f;
      minimum = 0x80;
    } else if (first >= 0xe0 && first <= 0xef) {
      count = 2;
      codePoint = first & 0x0f;
      minimum = 0x800;
    } else if (first >= 0xf0 && first <= 0xf4) {
      count = 3;
      codePoint = first & 0x07;
      minimum = 0x10000;
    } else fail('utf8_invalid');
    if (index + count > bytes.length) fail('utf8_invalid');
    for (let offset = 0; offset < count; offset += 1) {
      const next = bytes[index++];
      if ((next & 0xc0) !== 0x80) fail('utf8_invalid');
      codePoint = (codePoint << 6) | (next & 0x3f);
    }
    if (codePoint < minimum || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
      fail('utf8_invalid');
    }
    codePoints.push(codePoint);
  }
  let result = '';
  for (let offset = 0; offset < codePoints.length; offset += 2048) {
    result += String.fromCodePoint(...codePoints.slice(offset, offset + 2048));
  }
  return result;
}

export function bytesToBase64Url(bytes) {
  if (!(bytes instanceof Uint8Array)) fail('base64url_encode');
  let output = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const hasSecond = index + 1 < bytes.length;
    const hasThird = index + 2 < bytes.length;
    const second = hasSecond ? bytes[index + 1] : 0;
    const third = hasThird ? bytes[index + 2] : 0;
    output += BASE64URL_ALPHABET[first >>> 2];
    output += BASE64URL_ALPHABET[((first & 0x03) << 4) | (second >>> 4)];
    if (hasSecond) output += BASE64URL_ALPHABET[((second & 0x0f) << 2) | (third >>> 6)];
    if (hasThird) output += BASE64URL_ALPHABET[third & 0x3f];
  }
  return output;
}

export function base64UrlToBytes(value, maximumBytes = Number.MAX_SAFE_INTEGER) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length % 4 === 1
    || !/^[A-Za-z0-9_-]+$/.test(value)
  ) fail('base64url_decode');
  const length = Math.floor((value.length * 6) / 8);
  if (length > maximumBytes) fail('base64url_size');
  const output = new Uint8Array(length);
  let accumulator = 0;
  let bits = 0;
  let offset = 0;
  for (const character of value) {
    const decoded = BASE64URL_ALPHABET.indexOf(character);
    if (decoded < 0) fail('base64url_decode');
    accumulator = (accumulator << 6) | decoded;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output[offset++] = (accumulator >>> bits) & 0xff;
      accumulator &= (1 << bits) - 1;
    }
  }
  if (offset !== length || (bits > 0 && accumulator !== 0)) fail('base64url_decode');
  return output;
}

function bytesToHex(bytes) {
  let output = '';
  for (const value of bytes) output += HEX_ALPHABET[value >>> 4] + HEX_ALPHABET[value & 0x0f];
  return output;
}

function parseJson(value, code) {
  try {
    return JSON.parse(value);
  } catch (error) {
    fail(code, error);
  }
}

function decodeExact(decoder, bytes, code) {
  let decoded;
  try {
    decoded = decoder(bytes, 0);
  } catch (error) {
    fail(code, error);
  }
  if (decoded === undefined || decoded[1] !== bytes.length) fail(code);
  return decoded[0];
}

function zeroAll(values) {
  for (const value of values ?? []) {
    if (value instanceof Uint8Array) zeroOutUint8Array(value);
  }
}

function zeroByteArraysDeep(value, seen = new Set()) {
  if (value instanceof Uint8Array) {
    value.fill(0);
    return;
  }
  if (value === null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  if (value instanceof Map) {
    for (const [key, item] of value) {
      zeroByteArraysDeep(key, seen);
      zeroByteArraysDeep(item, seen);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) zeroByteArraysDeep(item, seen);
    return;
  }
  for (const item of Object.values(value)) zeroByteArraysDeep(item, seen);
}

function destroyGroupState(group) {
  zeroByteArraysDeep(group.state);
  for (const buffer of group.retainedStateBuffers ?? []) buffer.fill(0);
}

function cloneGroupState(state, code) {
  const encoded = encodeGroupState(state);
  try {
    return {
      state: {
        ...decodeExact(decodeGroupState, encoded, code),
        clientConfig: state.clientConfig,
      },
      encoded,
    };
  } catch (error) {
    encoded.fill(0);
    throw error;
  }
}

function normalizeCapabilities(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 16) fail('capabilities');
  const normalized = [...new Set(value.map((item) => {
    if (typeof item !== 'string' || item.length === 0 || item.length > 80) fail('capability');
    return item;
  }))].sort();
  return normalized;
}

function normalizedPlatform(value) {
  if (value !== 'ios' && value !== 'android' && value !== 'web') fail('platform');
  return value;
}

function normalizedDisplayName(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 80 || !value.trim()) fail('display_name');
  return value.trim();
}

function credentialPayload(input) {
  return [
    CREDENTIAL_TAG,
    CHAT_PROTOCOL_VERSION,
    assertId(input.accountId, 'credential_account_id'),
    assertId(input.deviceId, 'credential_device_id'),
    bytesToBase64Url(exactBytes(input.signaturePublicKey, 32, 'credential_signature_key')),
    bytesToBase64Url(exactBytes(input.accountIdentityKeyHash, 32, 'credential_identity_hash')),
  ];
}

export function encodeDeviceCredential(input) {
  return utf8Encode(JSON.stringify(credentialPayload(input)));
}

export function decodeDeviceCredential(bytes) {
  const payload = parseJson(utf8Decode(bytes), 'credential_json');
  if (!Array.isArray(payload) || payload.length !== 6 || payload[0] !== CREDENTIAL_TAG || payload[1] !== CHAT_PROTOCOL_VERSION) {
    fail('credential_format');
  }
  return {
    accountId: assertId(payload[2], 'credential_account_id'),
    deviceId: assertId(payload[3], 'credential_device_id'),
    signaturePublicKey: exactBytes(base64UrlToBytes(payload[4], 32), 32, 'credential_signature_key'),
    accountIdentityKeyHash: exactBytes(base64UrlToBytes(payload[5], 32), 32, 'credential_identity_hash'),
  };
}

export function accountIdentityFingerprint(publicKeyValue) {
  const publicKey = typeof publicKeyValue === 'string'
    ? base64UrlToBytes(publicKeyValue, 32)
    : publicKeyValue;
  return bytesToHex(sha256(exactBytes(publicKey, 32, 'account_identity_public_key')));
}

function safetyNumberFromFingerprint(fingerprint) {
  const decimal = BigInt(`0x${fingerprint}`).toString(10).padStart(78, '0').slice(0, 60);
  return decimal.match(/.{1,5}/g).join(' ');
}

export function formatSafetyNumber(publicKeyValue) {
  const fingerprint = accountIdentityFingerprint(publicKeyValue);
  return safetyNumberFromFingerprint(fingerprint);
}

export function verifyDirectoryDevice(input) {
  const device = assertPlainObject(input, 'directory_device');
  const accountId = assertId(device.accountId, 'directory_account_id');
  const deviceId = assertId(device.id ?? device.deviceId, 'directory_device_id');
  const platform = normalizedPlatform(device.platform);
  const displayName = normalizedDisplayName(device.displayName);
  const capabilities = normalizeCapabilities(device.capabilities);
  const credential = base64UrlToBytes(device.credential, 8 * 1024);
  const signaturePublicKey = exactBytes(base64UrlToBytes(device.signaturePublicKey, 32), 32, 'directory_signature_key');
  const accountIdentityPublicKey = exactBytes(
    base64UrlToBytes(device.accountIdentityPublicKey ?? device.identity?.publicKey, 32),
    32,
    'directory_identity_key',
  );
  const accountIdentitySignature = exactBytes(
    base64UrlToBytes(device.accountIdentitySignature, 64),
    64,
    'directory_identity_signature',
  );
  const decodedCredential = decodeDeviceCredential(credential);
  if (
    decodedCredential.accountId !== accountId
    || decodedCredential.deviceId !== deviceId
    || !equalBytes(decodedCredential.signaturePublicKey, signaturePublicKey)
    || !equalBytes(decodedCredential.accountIdentityKeyHash, sha256(accountIdentityPublicKey))
  ) fail('directory_credential_binding');
  const authorization = canonicalDeviceAuthorization({
    accountId,
    deviceId,
    platform,
    displayName,
    credential: bytesToBase64Url(credential),
    signaturePublicKey: bytesToBase64Url(signaturePublicKey),
    capabilities,
  });
  let verified = false;
  try {
    verified = ed25519.verify(accountIdentitySignature, utf8Encode(authorization), accountIdentityPublicKey);
  } catch {
    verified = false;
  }
  if (!verified) fail('directory_identity_signature');
  return {
    accountId,
    deviceId,
    platform,
    displayName,
    capabilities,
    credential,
    signaturePublicKey,
    accountIdentityPublicKey,
    accountIdentitySignature,
    identityFingerprint: accountIdentityFingerprint(accountIdentityPublicKey),
    safetyNumber: formatSafetyNumber(accountIdentityPublicKey),
  };
}

function canonicalDirectoryPayload(payloadValue) {
  const payload = assertPlainObject(payloadValue, 'directory_payload');
  assertExactKeys(payload, [
    'version',
    'operation',
    'accountId',
    'deviceId',
    'platform',
    'displayName',
    'credentialHash',
    'signatureKeyHash',
    'accountIdentityKeyHash',
    'accountIdentitySignature',
    'capabilities',
    'registeredAt',
    'revokedAt',
    'recordedAt',
  ], 'directory_payload_keys');
  if (payload.version !== 1 || (payload.operation !== 'REGISTER' && payload.operation !== 'REVOKE')) fail('directory_payload');
  const hexHash = (value) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
    ? value
    : fail('directory_hash');
  const date = (value) => {
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
      fail('directory_date');
    }
    return value;
  };
  return {
    version: 1,
    operation: payload.operation,
    accountId: assertId(payload.accountId, 'directory_account_id'),
    deviceId: assertId(payload.deviceId, 'directory_device_id'),
    platform: normalizedPlatform(payload.platform),
    displayName: normalizedDisplayName(payload.displayName),
    credentialHash: hexHash(payload.credentialHash),
    signatureKeyHash: hexHash(payload.signatureKeyHash),
    accountIdentityKeyHash: hexHash(payload.accountIdentityKeyHash),
    accountIdentitySignature: bytesToBase64Url(exactBytes(
      base64UrlToBytes(payload.accountIdentitySignature, 64),
      64,
      'directory_signature',
    )),
    capabilities: normalizeCapabilities(payload.capabilities),
    registeredAt: date(payload.registeredAt),
    revokedAt: payload.revokedAt === null ? null : date(payload.revokedAt),
    recordedAt: date(payload.recordedAt),
  };
}

export function verifyKeyDirectoryChain(entries, expectedHead = undefined) {
  if (!Array.isArray(entries)) fail('directory_entries');
  if (entries.length > MAX_TOTAL_DEVICES_PER_ACCOUNT * 2) fail('directory_entries');
  let previousHash = null;
  for (const entryValue of entries) {
    const entry = assertPlainObject(entryValue, 'directory_entry');
    if ((entry.previousHash ?? null) !== previousHash) fail('directory_previous_hash');
    const payload = canonicalDirectoryPayload(entry.payload);
    const calculated = bytesToHex(sha256(utf8Encode(JSON.stringify([
      'VOLNA-CHAT-KEY-DIRECTORY',
      1,
      previousHash,
      payload,
    ]))));
    if (entry.entryHash !== calculated) fail('directory_entry_hash');
    previousHash = calculated;
  }
  if (expectedHead !== undefined && expectedHead !== previousHash) fail('directory_head_hash');
  return previousHash;
}

function keyDirectoryHexHash(value, code = 'directory_hash') {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) fail(code);
  return value;
}

function keyDirectoryIsoDate(value, code = 'directory_witness_date') {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    fail(code);
  }
  return value;
}

export function keyDirectoryLabel(accountIdValue) {
  const accountId = assertId(accountIdValue, 'directory_account_id');
  return bytesToHex(sha256(utf8Encode(JSON.stringify([KEY_DIRECTORY_LABEL_TAG, 1, accountId]))));
}

function normalizeKeyDirectoryCheckpoint(inputValue) {
  const input = assertPlainObject(inputValue, 'directory_witness_checkpoint');
  assertExactKeys(
    input,
    ['version', 'directoryLabel', 'identityFingerprint', 'entryCount', 'headHash'],
    'directory_witness_checkpoint_keys',
  );
  if (input.version !== 1) fail('directory_witness_checkpoint');
  if (!Number.isSafeInteger(input.entryCount) || input.entryCount < 0 || input.entryCount > MAX_TOTAL_DEVICES_PER_ACCOUNT * 2) {
    fail('directory_witness_entry_count');
  }
  const headHash = input.headHash === null ? null : keyDirectoryHexHash(input.headHash, 'directory_witness_head');
  if ((input.entryCount === 0) !== (headHash === null)) fail('directory_witness_head');
  return {
    version: 1,
    directoryLabel: keyDirectoryHexHash(input.directoryLabel, 'directory_witness_label'),
    identityFingerprint: keyDirectoryHexHash(input.identityFingerprint, 'directory_witness_identity'),
    entryCount: input.entryCount,
    headHash,
  };
}

export function canonicalKeyDirectoryWitnessStatement(inputValue) {
  const input = assertPlainObject(inputValue, 'directory_witness_statement');
  assertExactKeys(
    input,
    ['version', 'witnessId', 'checkpoint', 'observedAt'],
    'directory_witness_statement_keys',
  );
  if (input.version !== 1) fail('directory_witness_statement');
  const witnessId = assertId(input.witnessId, 'directory_witness_id');
  const checkpoint = normalizeKeyDirectoryCheckpoint(input.checkpoint);
  const observedAt = keyDirectoryIsoDate(input.observedAt);
  return utf8Encode(JSON.stringify([
    KEY_DIRECTORY_WITNESS_TAG,
    1,
    witnessId,
    checkpoint.directoryLabel,
    checkpoint.identityFingerprint,
    checkpoint.entryCount,
    checkpoint.headHash,
    observedAt,
  ]));
}

export function verifyKeyDirectoryWitnessQuorum(inputValue) {
  const input = assertPlainObject(inputValue, 'directory_witness_verification');
  const accountId = assertId(input.accountId, 'directory_account_id');
  const checkpoint = normalizeKeyDirectoryCheckpoint({
    version: 1,
    directoryLabel: keyDirectoryLabel(accountId),
    identityFingerprint: input.identityFingerprint,
    entryCount: input.entryCount,
    headHash: input.headHash,
  });
  const policy = assertPlainObject(input.policy, 'directory_witness_policy');
  if (!Array.isArray(policy.witnesses) || policy.witnesses.length < 1 || policy.witnesses.length > 8) {
    fail('directory_witness_policy');
  }
  if (!Number.isSafeInteger(policy.threshold) || policy.threshold < 1 || policy.threshold > policy.witnesses.length) {
    fail('directory_witness_threshold');
  }
  if (
    !Number.isSafeInteger(policy.maxStatementAgeMs)
    || policy.maxStatementAgeMs < 60_000
    || policy.maxStatementAgeMs > 30 * 24 * 60 * 60_000
  ) fail('directory_witness_max_age');
  const witnesses = new Map();
  for (const witnessValue of policy.witnesses) {
    const witness = assertPlainObject(witnessValue, 'directory_witness_policy');
    const witnessId = assertId(witness.id, 'directory_witness_id');
    if (witnesses.has(witnessId)) fail('directory_witness_duplicate');
    witnesses.set(witnessId, exactBytes(
      base64UrlToBytes(witness.publicKey, 32),
      32,
      'directory_witness_public_key',
    ));
  }
  if (!Array.isArray(input.statements) || input.statements.length > witnesses.size) fail('directory_witness_statements');
  const now = input.now === undefined ? Date.now() : input.now;
  if (!Number.isSafeInteger(now) || now < 0) fail('directory_witness_now');
  const verifiedWitnessIds = new Set();
  const observedTimes = [];
  let staleValidStatements = 0;
  for (const statementValue of input.statements) {
    let statement;
    let witnessId;
    let statementCheckpoint;
    let observedAt;
    let signature;
    try {
      statement = assertPlainObject(statementValue, 'directory_witness_statement');
      assertExactKeys(
        statement,
        ['version', 'witnessId', 'checkpoint', 'observedAt', 'signature'],
        'directory_witness_statement_keys',
      );
      if (statement.version !== 1) fail('directory_witness_statement');
      witnessId = assertId(statement.witnessId, 'directory_witness_id');
      if (!witnesses.has(witnessId) || verifiedWitnessIds.has(witnessId)) fail('directory_witness_statement');
      statementCheckpoint = normalizeKeyDirectoryCheckpoint(statement.checkpoint);
      observedAt = keyDirectoryIsoDate(statement.observedAt);
      signature = exactBytes(base64UrlToBytes(statement.signature, 64), 64, 'directory_witness_signature');
      const validSignature = ed25519.verify(signature, canonicalKeyDirectoryWitnessStatement({
        version: 1,
        witnessId,
        checkpoint: statementCheckpoint,
        observedAt,
      }), witnesses.get(witnessId), { zip215: false });
      if (!validSignature) continue;
    } catch {
      continue;
    }
    if (JSON.stringify(statementCheckpoint) !== JSON.stringify(checkpoint)) fail('directory_witness_checkpoint');
    const observedTime = Date.parse(observedAt);
    if (observedTime > now + CLOCK_SKEW_SECONDS * 1_000) fail('directory_witness_future');
    if (now - observedTime > policy.maxStatementAgeMs) {
      staleValidStatements += 1;
      continue;
    }
    verifiedWitnessIds.add(witnessId);
    observedTimes.push(observedTime);
  }
  if (verifiedWitnessIds.size < policy.threshold) {
    if (verifiedWitnessIds.size + staleValidStatements >= policy.threshold) fail('directory_witness_stale');
    fail('directory_witness_quorum');
  }
  return {
    checkpoint,
    threshold: policy.threshold,
    witnessIds: [...verifiedWitnessIds].sort(),
    oldestObservedAt: new Date(Math.min(...observedTimes)).toISOString(),
  };
}

export function verifyKeyDirectorySnapshot(inputValue) {
  const input = assertPlainObject(inputValue, 'directory_snapshot');
  const accountId = assertId(input.accountId, 'directory_account_id');
  const identity = assertPlainObject(input.identity, 'directory_identity');
  if (identity.accountId !== accountId) fail('directory_identity_account');
  const identityPublicKey = exactBytes(base64UrlToBytes(identity.publicKey, 32), 32, 'directory_identity_key');
  const identityFingerprint = accountIdentityFingerprint(identityPublicKey);
  if (identity.keyHash !== identityFingerprint) fail('directory_identity_hash');
  const headHash = input.headHash === null || (typeof input.headHash === 'string' && /^[0-9a-f]{64}$/.test(input.headHash))
    ? input.headHash
    : fail('directory_head_hash');
  if (!Array.isArray(input.entries) || !Array.isArray(input.devices)) fail('directory_snapshot');
  verifyKeyDirectoryChain(input.entries, headHash);

  const lifecycle = new Map();
  for (const entryValue of input.entries) {
    const entry = assertPlainObject(entryValue, 'directory_entry');
    const payload = canonicalDirectoryPayload(entry.payload);
    if (payload.accountId !== accountId || entry.deviceId !== payload.deviceId) fail('directory_entry_device');
    const topLevelOperation = payload.operation === 'REGISTER' ? 'DEVICE_REGISTERED' : 'DEVICE_REVOKED';
    if (entry.operation !== topLevelOperation) fail('directory_entry_operation');
    const existing = lifecycle.get(payload.deviceId);
    if (payload.operation === 'REGISTER') {
      if (existing !== undefined || payload.revokedAt !== null) fail('directory_lifecycle');
      lifecycle.set(payload.deviceId, { registered: payload, revoked: undefined });
    } else {
      if (existing === undefined || existing.revoked !== undefined || payload.revokedAt === null) fail('directory_lifecycle');
      if (
        payload.platform !== existing.registered.platform
        || payload.displayName !== existing.registered.displayName
        || payload.credentialHash !== existing.registered.credentialHash
        || payload.signatureKeyHash !== existing.registered.signatureKeyHash
        || payload.accountIdentityKeyHash !== existing.registered.accountIdentityKeyHash
        || payload.accountIdentitySignature !== existing.registered.accountIdentitySignature
        || JSON.stringify(payload.capabilities) !== JSON.stringify(existing.registered.capabilities)
        || payload.registeredAt !== existing.registered.registeredAt
      ) fail('directory_lifecycle');
      existing.revoked = payload;
    }
  }
  if (lifecycle.size !== input.devices.length) fail('directory_device_count');

  const verifiedDevices = [];
  const seenDevices = new Set();
  for (const deviceValue of input.devices) {
    const device = assertPlainObject(deviceValue, 'directory_device');
    const verified = verifyDirectoryDevice({ ...device, accountIdentityPublicKey: identity.publicKey });
    if (verified.accountId !== accountId || seenDevices.has(verified.deviceId)) fail('directory_device_snapshot');
    seenDevices.add(verified.deviceId);
    const life = lifecycle.get(verified.deviceId);
    if (life === undefined) fail('directory_device_snapshot');
    const registered = life.registered;
    if (
      registered.platform !== verified.platform
      || registered.displayName !== verified.displayName
      || registered.credentialHash !== bytesToHex(sha256(verified.credential))
      || registered.signatureKeyHash !== bytesToHex(sha256(verified.signaturePublicKey))
      || registered.accountIdentityKeyHash !== identityFingerprint
      || registered.accountIdentitySignature !== bytesToBase64Url(verified.accountIdentitySignature)
      || JSON.stringify(registered.capabilities) !== JSON.stringify(verified.capabilities)
      || registered.registeredAt !== device.registeredAt
    ) fail('directory_registration_snapshot');
    if (device.status === 'ACTIVE') {
      if (life.revoked !== undefined || device.revokedAt !== null) fail('directory_revocation_snapshot');
    } else if (device.status === 'REVOKED') {
      if (life.revoked === undefined || life.revoked.revokedAt !== device.revokedAt) fail('directory_revocation_snapshot');
    } else {
      fail('directory_device_status');
    }
    verifiedDevices.push({
      accountId: verified.accountId,
      deviceId: verified.deviceId,
      identityFingerprint: verified.identityFingerprint,
      safetyNumber: verified.safetyNumber,
      status: device.status,
    });
  }
  return {
    accountId,
    identityFingerprint,
    safetyNumber: formatSafetyNumber(identityPublicKey),
    headHash,
    entryHashes: input.entries.map((entry) => entry.entryHash),
    devices: verifiedDevices,
  };
}

function makeClientConfig() {
  return {
    ...defaultClientConfig,
    authService: {
      async validateCredential(credential, signaturePublicKey) {
        if (credential?.credentialType !== 'basic') return false;
        try {
          const decoded = decodeDeviceCredential(credential.identity);
          return equalBytes(decoded.signaturePublicKey, signaturePublicKey);
        } catch {
          return false;
        }
      },
    },
  };
}

function rosterFromState(state) {
  return getGroupMembers(state).map((leaf) => {
    if (leaf.credential?.credentialType !== 'basic') fail('roster_credential_type');
    const credential = decodeDeviceCredential(leaf.credential.identity);
    if (!equalBytes(credential.signaturePublicKey, leaf.signaturePublicKey)) fail('roster_signature_binding');
    return {
      accountId: credential.accountId,
      deviceId: credential.deviceId,
      signaturePublicKey: bytesToBase64Url(credential.signaturePublicKey),
      accountIdentityKeyHash: bytesToBase64Url(credential.accountIdentityKeyHash),
    };
  }).sort((left, right) => left.deviceId.localeCompare(right.deviceId));
}

function expectedMemberFromVerified(device) {
  return {
    accountId: device.accountId,
    deviceId: device.deviceId,
    signaturePublicKey: bytesToBase64Url(device.signaturePublicKey),
    accountIdentityKeyHash: bytesToBase64Url(sha256(device.accountIdentityPublicKey)),
  };
}

export function mlsRosterHash(membersValue) {
  if (!Array.isArray(membersValue) || membersValue.length === 0) fail('expected_members');
  const expectedMembers = membersValue.map((member) => {
    if (member.accountIdentityKeyHash !== undefined) return member;
    return expectedMemberFromVerified(verifyDirectoryDevice(member));
  });
  return bytesToHex(sha256(utf8Encode(canonicalMlsRoster(expectedMembers))));
}

function leafIndexForDevice(state, deviceId) {
  for (let leafIndex = 0; leafIndex * 2 < state.ratchetTree.length; leafIndex += 1) {
    const node = state.ratchetTree[leafIndex * 2];
    if (node === undefined || node.nodeType !== 'leaf') continue;
    const member = memberAtLeafIndex(state.ratchetTree, leafIndex);
    if (member.deviceId === deviceId) return leafIndex;
  }
  fail('rekey_remove_member');
}

function memberAtLeafIndex(ratchetTree, leafIndex) {
  if (!Number.isSafeInteger(leafIndex) || leafIndex < 0) fail('sender_leaf_index');
  const node = ratchetTree[leafIndex * 2];
  if (node === undefined || node.nodeType !== 'leaf' || node.leaf.credential?.credentialType !== 'basic') {
    fail('sender_leaf');
  }
  const credential = decodeDeviceCredential(node.leaf.credential.identity);
  if (!equalBytes(credential.signaturePublicKey, node.leaf.signaturePublicKey)) fail('sender_signature_binding');
  return credential;
}

async function inspectPrivateSender(state, privateMessage, ciphersuite) {
  const cloned = cloneGroupState(state, 'sender_state_clone');
  const clonedState = cloned.state;
  const receiver = privateMessage.epoch < clonedState.groupContext.epoch
    ? clonedState.historicalReceiverData.get(privateMessage.epoch)
    : clonedState;
  if (receiver === undefined) {
    zeroByteArraysDeep(clonedState);
    fail('sender_epoch_too_old');
  }
  let inspected;
  try {
    inspected = await unprotectPrivateMessage(
      receiver.keySchedule?.senderDataSecret ?? receiver.senderDataSecret,
      privateMessage,
      receiver.secretTree,
      receiver.ratchetTree,
      receiver.groupContext,
      state.clientConfig.keyRetentionConfig,
      ciphersuite,
    );
    const leafIndex = getSenderLeafNodeIndex(inspected.content.content.sender);
    if (leafIndex === undefined) fail('sender_not_member');
    return memberAtLeafIndex(receiver.ratchetTree, leafIndex);
  } finally {
    zeroAll(inspected?.consumed);
    zeroByteArraysDeep(clonedState);
    cloned.encoded.fill(0);
  }
}

function assertRoster(state, expectedMembers) {
  const actual = rosterFromState(state);
  const expected = [...expectedMembers].sort((left, right) => left.deviceId.localeCompare(right.deviceId));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail('group_roster_mismatch');
}

function normalizeCanonicalAad(aadValue) {
  const canonical = typeof aadValue === 'string'
    ? aadValue
    : canonicalEnvelopeAad(aadValue);
  let parsed;
  try {
    parsed = JSON.parse(canonical);
  } catch {
    fail('aad_json');
  }
  if (!Array.isArray(parsed) || parsed.length !== 10) fail('aad_format');
  const rebuilt = canonicalEnvelopeAad({
    protocolVersion: parsed[1],
    threadId: parsed[2],
    senderAccountId: parsed[3],
    senderDeviceId: parsed[4],
    clientEnvelopeId: parsed[5],
    kind: parsed[6],
    epoch: parsed[7],
    operationId: parsed[8],
    rosterHash: parsed[9],
  });
  if (rebuilt !== canonical) fail('aad_not_canonical');
  return { canonical, parsed };
}

function stateAad(wrappingKeyId) {
  return utf8Encode(JSON.stringify([STATE_AAD_TAG, STATE_VERSION, wrappingKeyId, STATE_ALGORITHM]));
}

function normalizeWrappingKey(value) {
  if (typeof value === 'string') return exactBytes(base64UrlToBytes(value, 32), 32, 'wrapping_key');
  return exactBytes(value, 32, 'wrapping_key');
}

export function createMlsRuntime(options) {
  return new VolnaMlsRuntime(options);
}

export class VolnaMlsRuntime {
  constructor(options) {
    const input = assertPlainObject(options, 'runtime_options');
    if (typeof input.randomBytes !== 'function') fail('rng_missing');
    this.randomBytes = (length) => {
      try {
        const generated = exactBytes(input.randomBytes(length), length, 'rng_output');
        const copy = generated.slice();
        generated.fill(0);
        return copy;
      } catch (error) {
        if (error instanceof MlsRuntimeError || error instanceof VolnaCryptoError) throw error;
        fail('rng_failed', error);
      }
    };
    this.wrappingKeyProvider = input.wrappingKeyProvider;
    this.cryptoProvider = createVolnaCryptoProvider(this.randomBytes);
    this.ciphersuiteDefinition = getCiphersuiteFromName(CHAT_CIPHERSUITE);
    this.ciphersuite = undefined;
    this.clientConfig = makeClientConfig();
    this.identity = undefined;
    this.keyPackages = new Map();
    this.groups = new Map();
    this.pendingRekeys = new Map();
    this.identityPins = new Map();
    this.directoryChains = new Map();
    this.applicationState = null;
  }

  get protocolVersion() {
    return CHAT_PROTOCOL_VERSION;
  }

  get ciphersuiteName() {
    return CHAT_CIPHERSUITE;
  }

  async getCiphersuite() {
    if (this.ciphersuite === undefined) {
      this.ciphersuite = await this.cryptoProvider.getCiphersuiteImpl(this.ciphersuiteDefinition);
    }
    return this.ciphersuite;
  }

  pinVerifiedDevice(device) {
    const existing = this.identityPins.get(device.accountId);
    if (existing !== undefined && existing !== device.identityFingerprint) fail('identity_pin_mismatch');
    const firstUse = existing === undefined;
    this.identityPins.set(device.accountId, device.identityFingerprint);
    return { firstUse, fingerprint: device.identityFingerprint, safetyNumber: device.safetyNumber };
  }

  verifyAndPinDirectoryDevice(input) {
    const verified = verifyDirectoryDevice(input);
    return { ...verified, pin: this.pinVerifiedDevice(verified) };
  }

  pinDirectoryVerification(inputValue) {
    const input = assertPlainObject(inputValue, 'directory_verification');
    const accountId = assertId(input.accountId, 'directory_account_id');
    if (typeof input.identityFingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(input.identityFingerprint)) {
      fail('directory_identity_hash');
    }
    if (input.safetyNumber !== safetyNumberFromFingerprint(input.identityFingerprint)) {
      fail('directory_safety_number');
    }
    if (!Array.isArray(input.entryHashes) || input.entryHashes.length > MAX_TOTAL_DEVICES_PER_ACCOUNT * 2) {
      fail('directory_entries');
    }
    const entryHashes = input.entryHashes.map((hash) => {
      if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) fail('directory_hash');
      return hash;
    });
    const headHash = input.headHash === null || (typeof input.headHash === 'string' && /^[0-9a-f]{64}$/.test(input.headHash))
      ? input.headHash
      : fail('directory_head_hash');
    if ((entryHashes.at(-1) ?? null) !== headHash) fail('directory_head_hash');
    const witnessQuorum = assertPlainObject(input.witnessQuorum, 'directory_witness_quorum');
    const checkpoint = normalizeKeyDirectoryCheckpoint(witnessQuorum.checkpoint);
    if (
      checkpoint.directoryLabel !== keyDirectoryLabel(accountId)
      || checkpoint.identityFingerprint !== input.identityFingerprint
      || checkpoint.entryCount !== entryHashes.length
      || checkpoint.headHash !== headHash
    ) fail('directory_witness_checkpoint');
    if (
      !Number.isSafeInteger(witnessQuorum.threshold)
      || witnessQuorum.threshold < 2
      || !Array.isArray(witnessQuorum.witnessIds)
      || witnessQuorum.witnessIds.length < witnessQuorum.threshold
      || witnessQuorum.witnessIds.length > 8
    ) fail('directory_witness_quorum');
    const witnessIds = new Set();
    for (const witnessId of witnessQuorum.witnessIds) {
      const normalized = assertId(witnessId, 'directory_witness_id');
      if (witnessIds.has(normalized)) fail('directory_witness_duplicate');
      witnessIds.add(normalized);
    }
    keyDirectoryIsoDate(witnessQuorum.oldestObservedAt);
    const pin = this.pinVerifiedDevice({
      accountId,
      identityFingerprint: input.identityFingerprint,
      safetyNumber: input.safetyNumber,
    });
    const previous = this.directoryChains.get(accountId) ?? [];
    if (entryHashes.length < previous.length) fail('directory_rollback');
    if (previous.some((hash, index) => entryHashes[index] !== hash)) fail('directory_split_view');
    this.directoryChains.set(accountId, [...entryHashes]);
    return {
      accountId,
      identityFingerprint: input.identityFingerprint,
      safetyNumber: input.safetyNumber,
      headHash,
      entryHashes: [...entryHashes],
      witnessQuorum: {
        checkpoint,
        threshold: witnessQuorum.threshold,
        witnessIds: [...witnessIds].sort(),
        oldestObservedAt: witnessQuorum.oldestObservedAt,
      },
      firstUse: pin.firstUse,
      advanced: entryHashes.length > previous.length,
    };
  }

  async createDeviceIdentity(inputValue) {
    if (this.identity !== undefined) fail('identity_already_initialized');
    const input = assertPlainObject(inputValue, 'identity_input');
    const accountId = assertId(input.accountId, 'identity_account_id');
    const deviceId = assertId(input.deviceId, 'identity_device_id');
    const platform = normalizedPlatform(input.platform);
    const displayName = normalizedDisplayName(input.displayName);
    const capabilities = normalizeCapabilities(input.capabilities ?? ['mls-v1']);
    const recoverySecret = input.recoverySecret === undefined
      ? this.randomBytes(32)
      : exactBytes(base64UrlToBytes(input.recoverySecret, 32), 32, 'recovery_secret');
    let signaturePrivateKey;
    let identityAdopted = false;
    try {
      const accountIdentityPublicKey = ed25519.getPublicKey(recoverySecret);
      signaturePrivateKey = this.randomBytes(32);
      const signaturePublicKey = ed25519.getPublicKey(signaturePrivateKey);
      const credentialBytes = encodeDeviceCredential({
        accountId,
        deviceId,
        signaturePublicKey,
        accountIdentityKeyHash: sha256(accountIdentityPublicKey),
      });
      const credential = bytesToBase64Url(credentialBytes);
      const authorization = canonicalDeviceAuthorization({
        accountId,
        deviceId,
        platform,
        displayName,
        credential,
        signaturePublicKey: bytesToBase64Url(signaturePublicKey),
        capabilities,
      });
      const accountIdentitySignature = ed25519.sign(utf8Encode(authorization), recoverySecret);
      const recoverySecretForDisplay = input.recoverySecret === undefined ? bytesToBase64Url(recoverySecret) : undefined;
      this.identity = {
        accountId,
        deviceId,
        platform,
        displayName,
        capabilities,
        credentialBytes,
        recoverySecret: recoverySecret.slice(),
        accountIdentityPublicKey,
        accountIdentitySignature,
        signaturePrivateKey,
        signaturePublicKey,
      };
      identityAdopted = true;
      const fingerprint = accountIdentityFingerprint(accountIdentityPublicKey);
      this.identityPins.set(accountId, fingerprint);
      return {
        accountId,
        deviceId,
        platform,
        displayName,
        capabilities,
        credential,
        signaturePublicKey: bytesToBase64Url(signaturePublicKey),
        accountIdentityPublicKey: bytesToBase64Url(accountIdentityPublicKey),
        accountIdentitySignature: bytesToBase64Url(accountIdentitySignature),
        recoverySecret: recoverySecretForDisplay,
        identityFingerprint: fingerprint,
        safetyNumber: formatSafetyNumber(accountIdentityPublicKey),
      };
    } finally {
      recoverySecret.fill(0);
      if (!identityAdopted) signaturePrivateKey?.fill(0);
    }
  }

  async createPendingTransferDeviceIdentity(inputValue) {
    if (this.identity !== undefined) fail('identity_already_initialized');
    const input = assertPlainObject(inputValue, 'pending_identity_input');
    const accountId = assertId(input.accountId, 'identity_account_id');
    const deviceId = assertId(input.deviceId, 'identity_device_id');
    const platform = normalizedPlatform(input.platform);
    const displayName = normalizedDisplayName(input.displayName);
    const capabilities = normalizeCapabilities(input.capabilities ?? ['mls-v1', 'transfer-v1']);
    const accountIdentityPublicKey = exactBytes(
      base64UrlToBytes(input.accountIdentityPublicKey, 32),
      32,
      'identity_public_key',
    );
    const signaturePrivateKey = this.randomBytes(32);
    let identityAdopted = false;
    try {
      const signaturePublicKey = ed25519.getPublicKey(signaturePrivateKey);
      const credentialBytes = encodeDeviceCredential({
        accountId,
        deviceId,
        signaturePublicKey,
        accountIdentityKeyHash: sha256(accountIdentityPublicKey),
      });
      this.identity = {
        accountId,
        deviceId,
        platform,
        displayName,
        capabilities,
        credentialBytes,
        recoverySecret: undefined,
        accountIdentityPublicKey,
        accountIdentitySignature: undefined,
        signaturePrivateKey,
        signaturePublicKey,
        pendingTransfer: true,
      };
      identityAdopted = true;
      this.identityPins.set(accountId, accountIdentityFingerprint(accountIdentityPublicKey));
      return this.getPendingTransferDeviceDraft();
    } finally {
      if (!identityAdopted) signaturePrivateKey.fill(0);
    }
  }

  getPendingTransferDeviceDraft() {
    const identity = this.requireIdentity();
    if (identity.pendingTransfer !== true) fail('identity_not_pending_transfer');
    return normalizeTransferDeviceDraft({
      accountId: identity.accountId,
      deviceId: identity.deviceId,
      platform: identity.platform,
      displayName: identity.displayName,
      capabilities: identity.capabilities,
      credential: bytesToBase64Url(identity.credentialBytes),
      signaturePublicKey: bytesToBase64Url(identity.signaturePublicKey),
      accountIdentityPublicKey: bytesToBase64Url(identity.accountIdentityPublicKey),
    });
  }

  authorizeTransferredDevice(draftValue) {
    const identity = this.requireCompleteIdentity();
    const draft = normalizeTransferDeviceDraft(draftValue);
    if (
      draft.accountId !== identity.accountId
      || draft.accountIdentityPublicKey !== bytesToBase64Url(identity.accountIdentityPublicKey)
      || draft.deviceId === identity.deviceId
    ) fail('transfer_device_identity_binding');
    const credential = decodeDeviceCredential(base64UrlToBytes(draft.credential, 8 * 1024));
    if (
      credential.accountId !== draft.accountId
      || credential.deviceId !== draft.deviceId
      || !equalBytes(credential.signaturePublicKey, base64UrlToBytes(draft.signaturePublicKey, 32))
      || !equalBytes(credential.accountIdentityKeyHash, sha256(identity.accountIdentityPublicKey))
    ) fail('transfer_device_credential_binding');
    const authorization = canonicalDeviceAuthorization({
      accountId: draft.accountId,
      deviceId: draft.deviceId,
      platform: draft.platform,
      displayName: draft.displayName,
      credential: draft.credential,
      signaturePublicKey: draft.signaturePublicKey,
      capabilities: draft.capabilities,
    });
    return {
      v: 1,
      targetDeviceId: draft.deviceId,
      sourceDeviceId: identity.deviceId,
      recoverySecret: bytesToBase64Url(identity.recoverySecret),
      accountIdentitySignature: bytesToBase64Url(ed25519.sign(utf8Encode(authorization), identity.recoverySecret)),
    };
  }

  completeTransferredDeviceIdentity(inputValue) {
    const identity = this.requireIdentity();
    if (identity.pendingTransfer !== true) fail('identity_not_pending_transfer');
    const input = assertPlainObject(inputValue, 'transfer_identity_completion');
    const recoverySecret = exactBytes(base64UrlToBytes(input.recoverySecret, 32), 32, 'recovery_secret');
    const accountIdentitySignature = exactBytes(
      base64UrlToBytes(input.accountIdentitySignature, 64),
      64,
      'identity_signature',
    );
    let adopted = false;
    try {
      if (!equalBytes(ed25519.getPublicKey(recoverySecret), identity.accountIdentityPublicKey)) {
        fail('recovery_identity_mismatch');
      }
      const authorization = canonicalDeviceAuthorization({
        accountId: identity.accountId,
        deviceId: identity.deviceId,
        platform: identity.platform,
        displayName: identity.displayName,
        credential: bytesToBase64Url(identity.credentialBytes),
        signaturePublicKey: bytesToBase64Url(identity.signaturePublicKey),
        capabilities: identity.capabilities,
      });
      if (!ed25519.verify(accountIdentitySignature, utf8Encode(authorization), identity.accountIdentityPublicKey)) {
        fail('identity_signature');
      }
      identity.recoverySecret = recoverySecret;
      identity.accountIdentitySignature = accountIdentitySignature;
      identity.pendingTransfer = false;
      adopted = true;
      return this.getIdentitySummary();
    } finally {
      if (!adopted) {
        recoverySecret.fill(0);
        accountIdentitySignature.fill(0);
      }
    }
  }

  signDeviceRegistrationChallenge(inputValue) {
    const identity = this.requireCompleteIdentity();
    const input = assertPlainObject(inputValue, 'registration_challenge');
    const proof = canonicalDeviceRegistrationProof({
      challengeId: input.challengeId,
      challenge: input.challenge,
      accountId: identity.accountId,
      deviceId: identity.deviceId,
      platform: identity.platform,
      displayName: identity.displayName,
      credential: bytesToBase64Url(identity.credentialBytes),
      signaturePublicKey: bytesToBase64Url(identity.signaturePublicKey),
      accountIdentityPublicKey: bytesToBase64Url(identity.accountIdentityPublicKey),
      accountIdentitySignature: bytesToBase64Url(identity.accountIdentitySignature),
      capabilities: identity.capabilities,
    });
    return {
      challengeId: input.challengeId,
      deviceId: identity.deviceId,
      platform: identity.platform,
      displayName: identity.displayName,
      credential: bytesToBase64Url(identity.credentialBytes),
      signaturePublicKey: bytesToBase64Url(identity.signaturePublicKey),
      accountIdentityPublicKey: bytesToBase64Url(identity.accountIdentityPublicKey),
      accountIdentitySignature: bytesToBase64Url(identity.accountIdentitySignature),
      proofSignature: bytesToBase64Url(ed25519.sign(utf8Encode(proof), identity.signaturePrivateKey)),
      capabilities: identity.capabilities,
    };
  }

  async createKeyPackages(count) {
    const identity = this.requireIdentity();
    if (!Number.isSafeInteger(count) || count < 1 || count > 50) fail('key_package_count');
    const ciphersuite = await this.getCiphersuite();
    const now = BigInt(Math.floor(Date.now() / 1000));
    const capabilities = {
      versions: ['mls10'],
      ciphersuites: [CHAT_CIPHERSUITE],
      extensions: [],
      proposals: [],
      credentials: ['basic'],
    };
    const results = [];
    for (let index = 0; index < count; index += 1) {
      const generated = await generateKeyPackageWithKey(
        { credentialType: 'basic', identity: identity.credentialBytes.slice() },
        capabilities,
        { notBefore: now - BigInt(CLOCK_SKEW_SECONDS), notAfter: now + BigInt(KEY_PACKAGE_LIFETIME_SECONDS) },
        [],
        { signKey: identity.signaturePrivateKey.slice(), publicKey: identity.signaturePublicKey.slice() },
        ciphersuite,
      );
      const message = { version: 'mls10', wireformat: 'mls_key_package', keyPackage: generated.publicPackage };
      const payload = bytesToBase64Url(encodeMlsMessage(message));
      const reference = bytesToBase64Url(await makeKeyPackageRef(generated.publicPackage, ciphersuite.hash));
      this.keyPackages.set(reference, {
        payload,
        publicPackage: generated.publicPackage,
        privatePackage: generated.privatePackage,
      });
      results.push(payload);
    }
    return results;
  }

  async verifyClaim(claimValue) {
    const claim = assertPlainObject(claimValue, 'key_package_claim');
    const verifiedDevice = this.verifyAndPinDirectoryDevice({
      accountId: claim.recipientAccountId,
      deviceId: claim.recipientDeviceId,
      platform: claim.platform,
      displayName: claim.displayName,
      capabilities: claim.capabilities,
      credential: claim.credential,
      signaturePublicKey: claim.signaturePublicKey,
      accountIdentityPublicKey: claim.accountIdentityPublicKey,
      accountIdentitySignature: claim.accountIdentitySignature,
    });
    const bytes = base64UrlToBytes(claim.keyPackage, 16 * 1024);
    const message = decodeExact(decodeMlsMessage, bytes, 'key_package_decode');
    if (
      message.version !== 'mls10'
      || message.wireformat !== 'mls_key_package'
      || message.keyPackage.cipherSuite !== CHAT_CIPHERSUITE
      || message.keyPackage.leafNode.credential?.credentialType !== 'basic'
      || !equalBytes(message.keyPackage.leafNode.credential.identity, verifiedDevice.credential)
      || !equalBytes(message.keyPackage.leafNode.signaturePublicKey, verifiedDevice.signaturePublicKey)
    ) fail('key_package_binding');
    const ciphersuite = await this.getCiphersuite();
    if (!(await verifyKeyPackage(message.keyPackage, ciphersuite.signature))) fail('key_package_signature');
    return {
      claimId: assertId(claim.claimId, 'claim_id'),
      recipientAccountId: verifiedDevice.accountId,
      recipientDeviceId: verifiedDevice.deviceId,
      publicPackage: message.keyPackage,
      expectedMember: expectedMemberFromVerified(verifiedDevice),
    };
  }

  async createGroup(inputValue) {
    const identity = this.requireIdentity();
    const input = assertPlainObject(inputValue, 'create_group');
    const threadId = assertId(input.threadId, 'group_thread_id');
    if (!Array.isArray(input.claims) || input.claims.length === 0) fail('group_claims');
    if (this.groups.has(threadId)) fail('group_exists');
    const verifiedClaims = [];
    for (const claim of input.claims) verifiedClaims.push(await this.verifyClaim(claim));
    const deviceIds = verifiedClaims.map((claim) => claim.recipientDeviceId);
    if (new Set(deviceIds).size !== deviceIds.length || deviceIds.includes(identity.deviceId)) fail('group_claim_devices');
    const ciphersuite = await this.getCiphersuite();
    const [selfPackage] = await this.createEphemeralSelfKeyPackage(ciphersuite);
    const groupSalt = this.randomBytes(32);
    const groupIdBytes = sha256(new Uint8Array([
      ...utf8Encode(`${GROUP_TAG}\u0000${threadId}\u0000`),
      ...groupSalt,
    ]));
    groupSalt.fill(0);
    let state = await createMlsGroup(
      groupIdBytes,
      selfPackage.publicPackage,
      selfPackage.privatePackage,
      [],
      ciphersuite,
      this.clientConfig,
    );
    const groupId = bytesToBase64Url(groupIdBytes);
    const activationAad = utf8Encode(JSON.stringify([
      GROUP_ACTIVATION_TAG,
      CHAT_PROTOCOL_VERSION,
      threadId,
      groupId,
      '1',
    ]));
    let committed;
    try {
      committed = await createCommit(
        { state, cipherSuite: ciphersuite, pskIndex: emptyPskIndex },
        {
          extraProposals: verifiedClaims.map((claim) => ({
            proposalType: 'add',
            add: { keyPackage: claim.publicPackage },
          })),
          ratchetTreeExtension: true,
          authenticatedData: activationAad,
        },
      );
    } finally {
      state = undefined;
    }
    zeroAll(committed.consumed);
    if (committed.welcome === undefined || committed.newState.groupContext.epoch !== 1n) fail('group_welcome');
    const expectedMembers = [
      {
        accountId: identity.accountId,
        deviceId: identity.deviceId,
        signaturePublicKey: bytesToBase64Url(identity.signaturePublicKey),
        accountIdentityKeyHash: bytesToBase64Url(sha256(identity.accountIdentityPublicKey)),
      },
      ...verifiedClaims.map((claim) => claim.expectedMember),
    ];
    assertRoster(committed.newState, expectedMembers);
    this.groups.set(threadId, { state: committed.newState, expectedMembers });
    const welcomePayload = bytesToBase64Url(encodeMlsMessage({
      version: 'mls10',
      wireformat: 'mls_welcome',
      welcome: committed.welcome,
    }));
    return {
      protocolVersion: CHAT_PROTOCOL_VERSION,
      groupId,
      epoch: '1',
      claimIds: verifiedClaims.map((claim) => claim.claimId),
      welcomes: verifiedClaims.map((claim) => ({
        recipientDeviceId: claim.recipientDeviceId,
        payload: welcomePayload,
      })),
    };
  }

  async replaceInitialGroup(inputValue) {
    const input = assertPlainObject(inputValue, 'replace_initial_group');
    const threadId = assertId(input.threadId, 'group_thread_id');
    const previousGroupId = typeof input.previousGroupId === 'string' ? input.previousGroupId : fail('previous_group_id');
    const previous = this.requireGroup(threadId);
    if (
      bytesToBase64Url(previous.state.groupContext.groupId) !== previousGroupId
      || previous.state.groupContext.epoch !== 1n
    ) fail('initial_group_replacement_binding');
    this.groups.delete(threadId);
    try {
      const replacement = await this.createGroup({ threadId, claims: input.claims });
      if (replacement.groupId === previousGroupId) fail('initial_group_replacement_collision');
      destroyGroupState(previous);
      return replacement;
    } catch (error) {
      const incompleteReplacement = this.groups.get(threadId);
      if (incompleteReplacement !== undefined && incompleteReplacement !== previous) {
        destroyGroupState(incompleteReplacement);
      }
      this.groups.set(threadId, previous);
      throw error;
    }
  }

  async joinGroup(inputValue) {
    const input = assertPlainObject(inputValue, 'join_group');
    const threadId = assertId(input.threadId, 'group_thread_id');
    const expectedGroupId = typeof input.groupId === 'string' ? input.groupId : fail('group_id');
    const expectedEpoch = input.epoch === undefined ? '1' : input.epoch;
    if (typeof expectedEpoch !== 'string' || !/^[1-9][0-9]{0,19}$/.test(expectedEpoch)) fail('welcome_epoch');
    const existing = this.groups.get(threadId);
    if (existing !== undefined) {
      if (
        bytesToBase64Url(existing.state.groupContext.groupId) !== expectedGroupId
        || existing.state.groupContext.epoch.toString() !== expectedEpoch
      ) fail('welcome_existing_group_mismatch');
      return;
    }
    if (!Array.isArray(input.members) || input.members.length === 0) fail('group_members');
    const verifiedMembers = input.members.map((member) => this.verifyAndPinDirectoryDevice(member));
    const expectedMembers = verifiedMembers.map(expectedMemberFromVerified);
    const message = decodeExact(decodeMlsMessage, base64UrlToBytes(input.welcome, 96 * 1024), 'welcome_decode');
    if (message.version !== 'mls10' || message.wireformat !== 'mls_welcome' || message.welcome.cipherSuite !== CHAT_CIPHERSUITE) {
      fail('welcome_format');
    }
    const ciphersuite = await this.getCiphersuite();
    let selected;
    for (const secret of message.welcome.secrets) {
      const reference = bytesToBase64Url(secret.newMember);
      if (this.keyPackages.has(reference)) {
        if (selected !== undefined) fail('welcome_multiple_packages');
        selected = { reference, package: this.keyPackages.get(reference) };
      }
    }
    if (selected === undefined) fail('welcome_key_package_missing');
    const state = await joinMlsGroup(
      message.welcome,
      selected.package.publicPackage,
      selected.package.privatePackage,
      emptyPskIndex,
      ciphersuite,
      undefined,
      undefined,
      this.clientConfig,
    );
    if (bytesToBase64Url(state.groupContext.groupId) !== expectedGroupId || state.groupContext.epoch.toString() !== expectedEpoch) {
      fail('welcome_group_binding');
    }
    assertRoster(state, expectedMembers);
    this.keyPackages.delete(selected.reference);
    this.groups.set(threadId, { state, expectedMembers });
  }

  async replaceInitialGroupFromWelcome(inputValue) {
    const input = assertPlainObject(inputValue, 'replace_initial_group_welcome');
    const threadId = assertId(input.threadId, 'group_thread_id');
    const previousGroupId = typeof input.previousGroupId === 'string' ? input.previousGroupId : fail('previous_group_id');
    const previous = this.requireGroup(threadId);
    if (
      bytesToBase64Url(previous.state.groupContext.groupId) !== previousGroupId
      || previous.state.groupContext.epoch !== 1n
      || input.groupId === previousGroupId
    ) fail('initial_group_replacement_binding');
    this.groups.delete(threadId);
    try {
      await this.joinGroup({
        threadId,
        groupId: input.groupId,
        epoch: input.epoch,
        welcome: input.welcome,
        members: input.members,
      });
      destroyGroupState(previous);
    } catch (error) {
      const incompleteReplacement = this.groups.get(threadId);
      if (incompleteReplacement !== undefined && incompleteReplacement !== previous) {
        destroyGroupState(incompleteReplacement);
      }
      this.groups.set(threadId, previous);
      throw error;
    }
  }

  abandonInitialGroup(threadIdValue, expectedGroupIdValue) {
    const threadId = assertId(threadIdValue, 'group_thread_id');
    const expectedGroupId = typeof expectedGroupIdValue === 'string' ? expectedGroupIdValue : fail('group_id');
    const group = this.groups.get(threadId);
    if (group === undefined) return false;
    if (
      bytesToBase64Url(group.state.groupContext.groupId) !== expectedGroupId
      || group.state.groupContext.epoch !== 1n
    ) fail('initial_group_abandon_binding');
    destroyGroupState(group);
    this.groups.delete(threadId);
    return true;
  }

  async prepareRekey(inputValue) {
    const input = assertPlainObject(inputValue, 'prepare_rekey');
    const threadId = assertId(input.threadId, 'rekey_thread_id');
    const operationId = assertId(input.operationId, 'rekey_operation_id');
    if (this.pendingRekeys.has(operationId)) fail('rekey_already_prepared');
    const group = this.requireGroup(threadId);
    const baseEpoch = group.state.groupContext.epoch.toString();
    const targetEpoch = (group.state.groupContext.epoch + 1n).toString();
    if (input.baseEpoch !== baseEpoch || input.targetEpoch !== targetEpoch) fail('rekey_epoch');
    if (typeof input.rosterHash !== 'string' || !/^[0-9a-f]{64}$/.test(input.rosterHash)) fail('rekey_roster_hash');
    if (!Array.isArray(input.targetMembers) || input.targetMembers.length === 0) fail('rekey_target_members');
    const expectedMembers = input.targetMembers.map((member) => expectedMemberFromVerified(this.verifyAndPinDirectoryDevice(member)));
    if (mlsRosterHash(expectedMembers) !== input.rosterHash) fail('rekey_roster_hash');
    const currentMembers = rosterFromState(group.state);
    const currentIds = new Set(currentMembers.map((member) => member.deviceId));
    const targetIds = new Set(expectedMembers.map((member) => member.deviceId));
    const additions = expectedMembers.filter((member) => !currentIds.has(member.deviceId));
    const removals = currentMembers.filter((member) => !targetIds.has(member.deviceId));
    if (additions.length === 0 && removals.length === 0) fail('rekey_no_change');
    if (!targetIds.has(this.requireCompleteIdentity().deviceId)) fail('rekey_removes_sender');
    if (!Array.isArray(input.removeDeviceIds)) fail('rekey_remove_devices');
    const removeDeviceIds = input.removeDeviceIds.map((value) => assertId(value, 'rekey_remove_device'));
    if (
      new Set(removeDeviceIds).size !== removeDeviceIds.length
      || JSON.stringify([...removeDeviceIds].sort()) !== JSON.stringify(removals.map((member) => member.deviceId).sort())
    ) fail('rekey_remove_devices');
    if (!Array.isArray(input.claims)) fail('rekey_claims');
    const verifiedClaims = [];
    for (const claim of input.claims) verifiedClaims.push(await this.verifyClaim(claim));
    if (
      new Set(verifiedClaims.map((claim) => claim.recipientDeviceId)).size !== verifiedClaims.length
      || JSON.stringify(verifiedClaims.map((claim) => claim.recipientDeviceId).sort()) !== JSON.stringify(additions.map((member) => member.deviceId).sort())
    ) fail('rekey_claims');
    const { canonical, parsed } = normalizeCanonicalAad(input.aad);
    if (
      parsed[2] !== threadId
      || parsed[3] !== this.identity.accountId
      || parsed[4] !== this.identity.deviceId
      || parsed[6] !== 'COMMIT'
      || parsed[7] !== targetEpoch
      || parsed[8] !== operationId
      || parsed[9] !== input.rosterHash
    ) fail('rekey_aad_binding');
    const working = cloneGroupState(group.state, 'rekey_state_clone');
    const ciphersuite = await this.getCiphersuite();
    let committed;
    try {
      committed = await createCommit(
        { state: working.state, cipherSuite: ciphersuite, pskIndex: emptyPskIndex },
        {
          extraProposals: [
            ...removeDeviceIds.map((deviceId) => ({
              proposalType: 'remove',
              remove: { removed: leafIndexForDevice(working.state, deviceId) },
            })),
            ...verifiedClaims.map((claim) => ({
              proposalType: 'add',
              add: { keyPackage: claim.publicPackage },
            })),
          ],
          ratchetTreeExtension: additions.length > 0,
          authenticatedData: utf8Encode(canonical),
        },
      );
    } catch (error) {
      zeroByteArraysDeep(working.state);
      working.encoded.fill(0);
      throw error;
    }
    zeroAll(committed.consumed);
    if (committed.newState.groupContext.epoch.toString() !== targetEpoch) fail('rekey_epoch');
    assertRoster(committed.newState, expectedMembers);
    if ((additions.length > 0) !== (committed.welcome !== undefined)) fail('rekey_welcome');
    this.pendingRekeys.set(operationId, {
      threadId,
      baseEpoch,
      targetEpoch,
      rosterHash: input.rosterHash,
      state: committed.newState,
      expectedMembers,
      retainedStateBuffers: [working.encoded],
    });
    const welcomePayload = committed.welcome === undefined
      ? undefined
      : bytesToBase64Url(encodeMlsMessage({
          version: 'mls10',
          wireformat: 'mls_welcome',
          welcome: committed.welcome,
        }));
    return {
      protocolVersion: CHAT_PROTOCOL_VERSION,
      operationId,
      baseEpoch,
      epoch: targetEpoch,
      rosterHash: input.rosterHash,
      claimIds: verifiedClaims.map((claim) => claim.claimId),
      ciphertext: bytesToBase64Url(encodeMlsMessage(committed.commit)),
      welcomes: verifiedClaims.map((claim) => ({
        recipientDeviceId: claim.recipientDeviceId,
        payload: welcomePayload,
      })),
    };
  }

  commitPreparedRekey(operationIdValue) {
    const operationId = assertId(operationIdValue, 'rekey_operation_id');
    const pending = this.pendingRekeys.get(operationId);
    if (pending === undefined) fail('rekey_not_prepared');
    const group = this.requireGroup(pending.threadId);
    if (group.state.groupContext.epoch.toString() !== pending.baseEpoch) fail('rekey_base_epoch_changed');
    zeroByteArraysDeep(group.state);
    for (const buffer of group.retainedStateBuffers ?? []) buffer.fill(0);
    group.state = pending.state;
    group.expectedMembers = pending.expectedMembers;
    group.retainedStateBuffers = pending.retainedStateBuffers ?? [];
    this.pendingRekeys.delete(operationId);
    return this.getGroupState(pending.threadId);
  }

  abortPreparedRekey(operationIdValue) {
    const operationId = assertId(operationIdValue, 'rekey_operation_id');
    const pending = this.pendingRekeys.get(operationId);
    if (pending === undefined) return false;
    zeroByteArraysDeep(pending.state);
    for (const buffer of pending.retainedStateBuffers ?? []) buffer.fill(0);
    this.pendingRekeys.delete(operationId);
    return true;
  }

  getPreparedRekey(operationIdValue) {
    const operationId = assertId(operationIdValue, 'rekey_operation_id');
    const pending = this.pendingRekeys.get(operationId);
    if (pending === undefined) return null;
    return {
      operationId,
      threadId: pending.threadId,
      baseEpoch: pending.baseEpoch,
      targetEpoch: pending.targetEpoch,
      rosterHash: pending.rosterHash,
    };
  }

  async encrypt(inputValue) {
    const input = assertPlainObject(inputValue, 'encrypt_input');
    const threadId = assertId(input.threadId, 'encrypt_thread_id');
    const identity = this.requireIdentity();
    const group = this.requireGroup(threadId);
    const { canonical, parsed } = normalizeCanonicalAad(input.aad);
    if (
      parsed[2] !== threadId
      || parsed[3] !== identity.accountId
      || parsed[4] !== identity.deviceId
      || parsed[6] !== 'APPLICATION'
      || parsed[7] !== group.state.groupContext.epoch.toString()
    ) {
      fail('encrypt_aad_binding');
    }
    const plaintext = typeof input.plaintext === 'string'
      ? input.plaintext
      : encodeContentEvent(input.event);
    const normalizedPlaintext = encodeContentEvent(decodeContentEvent(plaintext));
    const ciphersuite = await this.getCiphersuite();
    const encrypted = await createApplicationMessage(
      group.state,
      utf8Encode(normalizedPlaintext),
      ciphersuite,
      utf8Encode(canonical),
    );
    zeroAll(encrypted.consumed);
    group.state = encrypted.newState;
    return {
      epoch: encrypted.privateMessage.epoch.toString(),
      ciphertext: bytesToBase64Url(encodeMlsMessage({
        version: 'mls10',
        wireformat: 'mls_private_message',
        privateMessage: encrypted.privateMessage,
      })),
    };
  }

  async process(inputValue) {
    const input = assertPlainObject(inputValue, 'process_input');
    const threadId = assertId(input.threadId, 'process_thread_id');
    const group = this.requireGroup(threadId);
    let rollback = cloneGroupState(group.state, 'process_state_clone');
    let candidateState;
    const previousExpectedMembers = group.expectedMembers;
    try {
    const { canonical, parsed } = normalizeCanonicalAad(input.aad);
    if (parsed[2] !== threadId) fail('process_aad_thread');
    const message = decodeExact(
      decodeMlsMessage,
      base64UrlToBytes(input.ciphertext, 96 * 1024),
      'envelope_decode',
    );
    const isPrivate = message.version === 'mls10' && message.wireformat === 'mls_private_message';
    const isPublic = message.version === 'mls10' && message.wireformat === 'mls_public_message';
    if (!isPrivate && !isPublic) fail('envelope_wireformat');
    const encodedAad = isPrivate ? message.privateMessage.authenticatedData : message.publicMessage.content.authenticatedData;
    const messageGroupId = isPrivate ? message.privateMessage.groupId : message.publicMessage.content.groupId;
    const messageEpoch = isPrivate ? message.privateMessage.epoch : message.publicMessage.content.epoch;
    if (
      !equalBytes(encodedAad, utf8Encode(canonical))
      || !equalBytes(messageGroupId, group.state.groupContext.groupId)
      || parsed[7] !== input.epoch
    ) fail('envelope_binding');
    if (parsed[6] === 'APPLICATION' && messageEpoch.toString() !== parsed[7]) fail('envelope_epoch');
    if (parsed[6] === 'COMMIT' && (messageEpoch + 1n).toString() !== parsed[7]) fail('envelope_epoch');
    const ciphersuite = await this.getCiphersuite();
    const sender = isPrivate
      ? await inspectPrivateSender(group.state, message.privateMessage, ciphersuite)
      : memberAtLeafIndex(group.state.ratchetTree, getSenderLeafNodeIndex(message.publicMessage.content.sender));
    if (sender.accountId !== parsed[3] || sender.deviceId !== parsed[4]) fail('envelope_sender_binding');
    const result = isPrivate
      ? await processPrivateMessage(group.state, message.privateMessage, emptyPskIndex, ciphersuite, acceptAll)
      : await processPublicMessage(group.state, message.publicMessage, emptyPskIndex, ciphersuite, acceptAll);
    candidateState = result.newState;
    zeroAll(result.consumed);
    if (result.kind === 'applicationMessage') {
      if (parsed[6] !== 'APPLICATION') fail('envelope_kind');
      group.state = result.newState;
      candidateState = undefined;
      let plaintext;
      let event;
      try {
        plaintext = utf8Decode(result.message);
        event = decodeContentEvent(plaintext);
      } catch {
        return {
          rejected: true,
          rejectionReason: 'invalid_content',
          sender: { accountId: sender.accountId, deviceId: sender.deviceId },
          stateChanged: true,
        };
      } finally {
        result.message.fill(0);
      }
      return {
        event,
        sender: { accountId: sender.accountId, deviceId: sender.deviceId },
        stateChanged: true,
      };
    }
    if (parsed[6] !== 'COMMIT') fail('envelope_kind');
    assertRoster(result.newState, input.expectedMembers ?? group.expectedMembers);
    group.state = result.newState;
    candidateState = undefined;
    if (input.expectedMembers !== undefined) group.expectedMembers = input.expectedMembers;
    return {
      stateChanged: true,
      sender: { accountId: sender.accountId, deviceId: sender.deviceId },
      transition: { operationId: parsed[8], rosterHash: parsed[9], epoch: parsed[7] },
    };
    } catch (error) {
      if (candidateState !== undefined) zeroByteArraysDeep(candidateState);
      zeroByteArraysDeep(group.state);
      group.state = rollback.state;
      group.retainedStateBuffers ??= [];
      group.retainedStateBuffers.push(rollback.encoded);
      rollback = undefined;
      group.expectedMembers = previousExpectedMembers;
      throw error;
    } finally {
      if (rollback !== undefined) {
        zeroByteArraysDeep(rollback.state);
        rollback.encoded.fill(0);
      }
    }
  }

  async exportEncryptedState(inputValue) {
    const input = assertPlainObject(inputValue, 'export_state');
    const wrappingKeyId = typeof input.wrappingKeyId === 'string' && input.wrappingKeyId.length <= 120
      ? input.wrappingKeyId
      : fail('wrapping_key_id');
    const key = await this.getWrappingKey(wrappingKeyId);
    const plaintext = utf8Encode(JSON.stringify(this.serializeState()));
    const nonce = this.randomBytes(24);
    try {
      const ciphertext = xchacha20poly1305(key, nonce, stateAad(wrappingKeyId)).encrypt(plaintext);
      return bytesToBase64Url(utf8Encode(JSON.stringify({
        v: STATE_VERSION,
        alg: STATE_ALGORITHM,
        keyId: wrappingKeyId,
        nonce: bytesToBase64Url(nonce),
        ciphertext: bytesToBase64Url(ciphertext),
      })));
    } finally {
      key.fill(0);
      plaintext.fill(0);
      nonce.fill(0);
    }
  }

  async importEncryptedState(inputValue) {
    const input = assertPlainObject(inputValue, 'import_state');
    const wrappingKeyId = typeof input.wrappingKeyId === 'string' ? input.wrappingKeyId : fail('wrapping_key_id');
    const envelope = assertPlainObject(
      parseJson(utf8Decode(base64UrlToBytes(input.state, 16 * 1024 * 1024)), 'state_envelope_json'),
      'state_envelope',
    );
    assertExactKeys(envelope, ['v', 'alg', 'keyId', 'nonce', 'ciphertext'], 'state_envelope_keys');
    if (envelope.v !== STATE_VERSION || envelope.alg !== STATE_ALGORITHM || envelope.keyId !== wrappingKeyId) fail('state_envelope');
    const nonce = exactBytes(base64UrlToBytes(envelope.nonce, 24), 24, 'state_nonce');
    const key = await this.getWrappingKey(wrappingKeyId);
    let plaintext;
    try {
      plaintext = xchacha20poly1305(key, nonce, stateAad(wrappingKeyId)).decrypt(
        base64UrlToBytes(envelope.ciphertext, 16 * 1024 * 1024),
      );
      await this.restoreState(parseJson(utf8Decode(plaintext), 'state_json'));
    } catch (error) {
      if (error instanceof MlsRuntimeError) throw error;
      fail('state_decrypt', error);
    } finally {
      key.fill(0);
      plaintext?.fill(0);
    }
  }

  getGroupState(threadId) {
    const group = this.requireGroup(assertId(threadId, 'group_thread_id'));
    return {
      groupId: bytesToBase64Url(group.state.groupContext.groupId),
      epoch: group.state.groupContext.epoch.toString(),
      members: rosterFromState(group.state),
    };
  }

  getIdentitySummary() {
    const identity = this.requireCompleteIdentity();
    return {
      accountId: identity.accountId,
      deviceId: identity.deviceId,
      platform: identity.platform,
      displayName: identity.displayName,
      capabilities: [...identity.capabilities],
      credential: bytesToBase64Url(identity.credentialBytes),
      signaturePublicKey: bytesToBase64Url(identity.signaturePublicKey),
      accountIdentityPublicKey: bytesToBase64Url(identity.accountIdentityPublicKey),
      accountIdentitySignature: bytesToBase64Url(identity.accountIdentitySignature),
      identityFingerprint: accountIdentityFingerprint(identity.accountIdentityPublicKey),
      safetyNumber: formatSafetyNumber(identity.accountIdentityPublicKey),
    };
  }

  getIdentityStatus() {
    if (this.identity === undefined) return { status: 'missing' };
    return {
      status: this.identity.pendingTransfer === true ? 'transfer-pending' : 'ready',
      accountId: this.identity.accountId,
      deviceId: this.identity.deviceId,
    };
  }

  setApplicationState(value) {
    let encoded;
    try {
      encoded = JSON.stringify(value);
    } catch (error) {
      fail('application_state_json', error);
    }
    if (encoded === undefined || encoded.length > 8 * 1024 * 1024) fail('application_state_size');
    this.applicationState = parseJson(encoded, 'application_state_json');
  }

  getApplicationState() {
    return this.applicationState === null
      ? null
      : parseJson(JSON.stringify(this.applicationState), 'application_state_json');
  }

  destroy() {
    if (this.identity !== undefined) {
      this.identity.recoverySecret?.fill(0);
      this.identity.signaturePrivateKey.fill(0);
      this.identity.accountIdentitySignature?.fill(0);
    }
    for (const keyPackage of this.keyPackages.values()) zeroAll(Object.values(keyPackage.privatePackage));
    for (const group of this.groups.values()) destroyGroupState(group);
    for (const pending of this.pendingRekeys.values()) zeroByteArraysDeep(pending.state);
    this.identity = undefined;
    this.keyPackages.clear();
    this.groups.clear();
    this.pendingRekeys.clear();
    this.identityPins.clear();
    this.directoryChains.clear();
    this.applicationState = null;
  }

  requireIdentity() {
    if (this.identity === undefined) fail('identity_missing');
    return this.identity;
  }

  requireCompleteIdentity() {
    const identity = this.requireIdentity();
    if (
      identity.pendingTransfer === true
      || !(identity.recoverySecret instanceof Uint8Array)
      || !(identity.accountIdentitySignature instanceof Uint8Array)
    ) fail('identity_pending_transfer');
    return identity;
  }

  requireGroup(threadId) {
    const group = this.groups.get(threadId);
    if (group === undefined) fail('group_missing');
    return group;
  }

  async createEphemeralSelfKeyPackage(ciphersuite) {
    const identity = this.requireIdentity();
    const now = BigInt(Math.floor(Date.now() / 1000));
    const generated = await generateKeyPackageWithKey(
      { credentialType: 'basic', identity: identity.credentialBytes.slice() },
      {
        versions: ['mls10'],
        ciphersuites: [CHAT_CIPHERSUITE],
        extensions: [],
        proposals: [],
        credentials: ['basic'],
      },
      { notBefore: now - BigInt(CLOCK_SKEW_SECONDS), notAfter: now + BigInt(KEY_PACKAGE_LIFETIME_SECONDS) },
      [],
      { signKey: identity.signaturePrivateKey.slice(), publicKey: identity.signaturePublicKey.slice() },
      ciphersuite,
    );
    return [generated];
  }

  async getWrappingKey(wrappingKeyId) {
    if (this.wrappingKeyProvider === undefined || typeof this.wrappingKeyProvider.getKey !== 'function') {
      fail('wrapping_key_provider_missing');
    }
    let value;
    try {
      value = await this.wrappingKeyProvider.getKey(wrappingKeyId);
    } catch (error) {
      fail('wrapping_key_provider_failed', error);
    }
    return normalizeWrappingKey(value).slice();
  }

  serializeState() {
    return {
      v: STATE_VERSION,
      identity: this.identity === undefined ? null : {
        accountId: this.identity.accountId,
        deviceId: this.identity.deviceId,
        platform: this.identity.platform,
        displayName: this.identity.displayName,
        capabilities: this.identity.capabilities,
        credential: bytesToBase64Url(this.identity.credentialBytes),
        pendingTransfer: this.identity.pendingTransfer === true,
        recoverySecret: this.identity.recoverySecret === undefined ? null : bytesToBase64Url(this.identity.recoverySecret),
        accountIdentityPublicKey: bytesToBase64Url(this.identity.accountIdentityPublicKey),
        accountIdentitySignature: this.identity.accountIdentitySignature === undefined
          ? null
          : bytesToBase64Url(this.identity.accountIdentitySignature),
        signaturePrivateKey: bytesToBase64Url(this.identity.signaturePrivateKey),
        signaturePublicKey: bytesToBase64Url(this.identity.signaturePublicKey),
      },
      keyPackages: [...this.keyPackages.entries()].map(([reference, value]) => ({
        reference,
        payload: value.payload,
        privatePackage: {
          initPrivateKey: bytesToBase64Url(value.privatePackage.initPrivateKey),
          hpkePrivateKey: bytesToBase64Url(value.privatePackage.hpkePrivateKey),
          signaturePrivateKey: bytesToBase64Url(value.privatePackage.signaturePrivateKey),
        },
      })),
      groups: [...this.groups.entries()].map(([threadId, value]) => ({
        threadId,
        state: bytesToBase64Url(encodeGroupState(value.state)),
        expectedMembers: value.expectedMembers,
      })),
      pendingRekeys: [...this.pendingRekeys.entries()].map(([operationId, value]) => ({
        operationId,
        threadId: value.threadId,
        baseEpoch: value.baseEpoch,
        targetEpoch: value.targetEpoch,
        rosterHash: value.rosterHash,
        state: bytesToBase64Url(encodeGroupState(value.state)),
        expectedMembers: value.expectedMembers,
      })),
      identityPins: [...this.identityPins.entries()],
      directoryChains: [...this.directoryChains.entries()],
      applicationState: this.applicationState,
    };
  }

  async restoreState(value) {
    const state = assertPlainObject(value, 'state');
    assertExactKeys(state, ['v', 'identity', 'keyPackages', 'groups', 'pendingRekeys', 'identityPins', 'directoryChains', 'applicationState'], 'state_keys');
    if (
      state.v !== STATE_VERSION
      || !Array.isArray(state.keyPackages)
      || !Array.isArray(state.groups)
      || !Array.isArray(state.pendingRekeys)
      || !Array.isArray(state.identityPins)
      || !Array.isArray(state.directoryChains)
    ) {
      fail('state_format');
    }
    let identity;
    if (state.identity !== null) {
      const stored = assertPlainObject(state.identity, 'state_identity');
      const pendingTransfer = stored.pendingTransfer === true;
      const recoverySecret = pendingTransfer && stored.recoverySecret === null
        ? undefined
        : exactBytes(base64UrlToBytes(stored.recoverySecret, 32), 32, 'state_recovery_secret');
      const signaturePrivateKey = exactBytes(base64UrlToBytes(stored.signaturePrivateKey, 32), 32, 'state_signature_key');
      const accountIdentityPublicKey = exactBytes(base64UrlToBytes(stored.accountIdentityPublicKey, 32), 32, 'state_identity_public');
      const signaturePublicKey = exactBytes(base64UrlToBytes(stored.signaturePublicKey, 32), 32, 'state_signature_public');
      const credentialBytes = base64UrlToBytes(stored.credential, 8 * 1024);
      if (
        (recoverySecret !== undefined && !equalBytes(ed25519.getPublicKey(recoverySecret), accountIdentityPublicKey))
        || !equalBytes(ed25519.getPublicKey(signaturePrivateKey), signaturePublicKey)
      ) fail('state_identity_key_binding');
      const decoded = decodeDeviceCredential(credentialBytes);
      if (
        decoded.accountId !== stored.accountId
        || decoded.deviceId !== stored.deviceId
        || !equalBytes(decoded.signaturePublicKey, signaturePublicKey)
        || !equalBytes(decoded.accountIdentityKeyHash, sha256(accountIdentityPublicKey))
      ) fail('state_identity_credential');
      identity = {
        accountId: assertId(stored.accountId, 'state_account_id'),
        deviceId: assertId(stored.deviceId, 'state_device_id'),
        platform: normalizedPlatform(stored.platform),
        displayName: normalizedDisplayName(stored.displayName),
        capabilities: normalizeCapabilities(stored.capabilities),
        credentialBytes,
        recoverySecret,
        accountIdentityPublicKey,
        accountIdentitySignature: pendingTransfer && stored.accountIdentitySignature === null
          ? undefined
          : exactBytes(base64UrlToBytes(stored.accountIdentitySignature, 64), 64, 'state_identity_signature'),
        signaturePrivateKey,
        signaturePublicKey,
        pendingTransfer,
      };
      if (pendingTransfer !== (identity.recoverySecret === undefined || identity.accountIdentitySignature === undefined)) {
        fail('state_pending_identity');
      }
    }
    const ciphersuite = await this.getCiphersuite();
    const keyPackages = new Map();
    for (const storedValue of state.keyPackages) {
      const stored = assertPlainObject(storedValue, 'state_key_package');
      const message = decodeExact(decodeMlsMessage, base64UrlToBytes(stored.payload, 16 * 1024), 'state_key_package_decode');
      if (message.version !== 'mls10' || message.wireformat !== 'mls_key_package') fail('state_key_package_format');
      const reference = bytesToBase64Url(await makeKeyPackageRef(message.keyPackage, ciphersuite.hash));
      if (reference !== stored.reference || keyPackages.has(reference)) fail('state_key_package_reference');
      const privatePackage = assertPlainObject(stored.privatePackage, 'state_private_package');
      keyPackages.set(reference, {
        payload: stored.payload,
        publicPackage: message.keyPackage,
        privatePackage: {
          initPrivateKey: base64UrlToBytes(privatePackage.initPrivateKey, 512),
          hpkePrivateKey: base64UrlToBytes(privatePackage.hpkePrivateKey, 512),
          signaturePrivateKey: base64UrlToBytes(privatePackage.signaturePrivateKey, 512),
        },
      });
    }
    const groups = new Map();
    for (const storedValue of state.groups) {
      const stored = assertPlainObject(storedValue, 'state_group');
      const threadId = assertId(stored.threadId, 'state_thread_id');
      const decoded = decodeExact(decodeGroupState, base64UrlToBytes(stored.state, 8 * 1024 * 1024), 'state_group_decode');
      const clientState = { ...decoded, clientConfig: this.clientConfig };
      if (clientState.groupContext.cipherSuite !== CHAT_CIPHERSUITE || !Array.isArray(stored.expectedMembers)) fail('state_group_format');
      assertRoster(clientState, stored.expectedMembers);
      if (groups.has(threadId)) fail('state_group_duplicate');
      groups.set(threadId, { state: clientState, expectedMembers: stored.expectedMembers });
    }
    const pendingRekeys = new Map();
    for (const storedValue of state.pendingRekeys) {
      const stored = assertPlainObject(storedValue, 'state_pending_rekey');
      const operationId = assertId(stored.operationId, 'state_rekey_operation');
      const threadId = assertId(stored.threadId, 'state_rekey_thread');
      if (pendingRekeys.has(operationId) || !groups.has(threadId)) fail('state_rekey_duplicate');
      if (typeof stored.baseEpoch !== 'string' || typeof stored.targetEpoch !== 'string' || BigInt(stored.targetEpoch) !== BigInt(stored.baseEpoch) + 1n) {
        fail('state_rekey_epoch');
      }
      if (typeof stored.rosterHash !== 'string' || !/^[0-9a-f]{64}$/.test(stored.rosterHash) || !Array.isArray(stored.expectedMembers)) {
        fail('state_rekey_roster');
      }
      const decoded = decodeExact(decodeGroupState, base64UrlToBytes(stored.state, 8 * 1024 * 1024), 'state_rekey_decode');
      const clientState = { ...decoded, clientConfig: this.clientConfig };
      if (clientState.groupContext.epoch.toString() !== stored.targetEpoch) fail('state_rekey_epoch');
      assertRoster(clientState, stored.expectedMembers);
      pendingRekeys.set(operationId, {
        threadId,
        baseEpoch: stored.baseEpoch,
        targetEpoch: stored.targetEpoch,
        rosterHash: stored.rosterHash,
        state: clientState,
        expectedMembers: stored.expectedMembers,
      });
    }
    const identityPins = new Map();
    for (const pin of state.identityPins) {
      if (!Array.isArray(pin) || pin.length !== 2 || typeof pin[0] !== 'string' || !/^[0-9a-f]{64}$/.test(pin[1])) fail('state_pin');
      identityPins.set(assertId(pin[0], 'state_pin_account'), pin[1]);
    }
    if (identity !== undefined) {
      const ownFingerprint = accountIdentityFingerprint(identity.accountIdentityPublicKey);
      if (identityPins.get(identity.accountId) !== ownFingerprint) fail('state_own_pin');
    }
    const directoryChains = new Map();
    for (const chain of state.directoryChains) {
      if (!Array.isArray(chain) || chain.length !== 2 || !Array.isArray(chain[1])) fail('state_directory_chain');
      const accountId = assertId(chain[0], 'state_directory_account');
      if (directoryChains.has(accountId) || !identityPins.has(accountId) || chain[1].length > MAX_TOTAL_DEVICES_PER_ACCOUNT * 2) {
        fail('state_directory_chain');
      }
      const hashes = chain[1].map((hash) => {
        if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) fail('state_directory_hash');
        return hash;
      });
      directoryChains.set(accountId, hashes);
    }
    this.destroy();
    this.identity = identity;
    this.keyPackages = keyPackages;
    this.groups = groups;
    this.pendingRekeys = pendingRekeys;
    this.identityPins = identityPins;
    this.directoryChains = directoryChains;
    this.setApplicationState(state.applicationState);
  }
}
