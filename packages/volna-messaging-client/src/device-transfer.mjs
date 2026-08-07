import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import contract from './index.js';
import { base64UrlToBytes, bytesToBase64Url } from './mls-runtime.mjs';

const {
  CHAT_PROTOCOL_VERSION,
  MAX_TRANSFER_CHUNK_BYTES,
  MAX_TRANSFER_CHUNKS,
  canonicalTransferDeviceDraft,
  normalizeDeviceTransferSessionInput,
  normalizeTransferManifest,
  normalizeTransferDeviceDraft,
} = contract;

const TRANSFER_TAG = 'VOLNA-CHAT-DEVICE-TRANSFER';
const TRANSFER_CHANNEL_TAG = 'VOLNA-CHAT-DEVICE-TRANSFER-CHANNEL';
const TRANSFER_PAYLOAD_TAG = 'VOLNA-CHAT-DEVICE-TRANSFER-PAYLOAD';
const TRANSFER_ALGORITHM = 'XCHACHA20-POLY1305';
const TRANSFER_STATE_VERSION = 1;
const QR_PREFIX = 'volna://device-transfer/';
const ID_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const ALLOWED_KINDS = new Set(['approval', 'history']);

export class DeviceTransferError extends Error {
  constructor(code, cause) {
    super(`VOLNA device transfer error (${code})`, cause === undefined ? undefined : { cause });
    this.name = 'DeviceTransferError';
    this.code = code;
  }
}

function fail(code, cause) {
  throw new DeviceTransferError(code, cause);
}

function object(value, code) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(code);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail(code);
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

function exactBytes(value, length, code) {
  if (!(value instanceof Uint8Array) || value.byteLength !== length) fail(code);
  return value;
}

function randomBytesFrom(provider, length) {
  if (typeof provider !== 'function') fail('rng_missing');
  let generated;
  try {
    generated = exactBytes(provider(length), length, 'rng_output');
  } catch (error) {
    if (error instanceof DeviceTransferError) throw error;
    fail('rng_failed', error);
  }
  const copy = generated.slice();
  generated.fill(0);
  return copy;
}

function utf8Encode(value) {
  if (typeof value !== 'string') fail('utf8_input');
  const bytes = [];
  for (let index = 0; index < value.length; index += 1) {
    let point = value.charCodeAt(index);
    if (point >= 0xd800 && point <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) fail('utf8_surrogate');
      point = 0x10000 + ((point - 0xd800) << 10) + (next - 0xdc00);
      index += 1;
    } else if (point >= 0xdc00 && point <= 0xdfff) {
      fail('utf8_surrogate');
    }
    if (point < 0x80) bytes.push(point);
    else if (point < 0x800) bytes.push(0xc0 | (point >>> 6), 0x80 | (point & 0x3f));
    else if (point < 0x10000) bytes.push(0xe0 | (point >>> 12), 0x80 | ((point >>> 6) & 0x3f), 0x80 | (point & 0x3f));
    else bytes.push(0xf0 | (point >>> 18), 0x80 | ((point >>> 12) & 0x3f), 0x80 | ((point >>> 6) & 0x3f), 0x80 | (point & 0x3f));
  }
  return new Uint8Array(bytes);
}

function utf8Decode(bytes) {
  if (!(bytes instanceof Uint8Array)) fail('utf8_bytes');
  let value = '';
  for (let index = 0; index < bytes.length;) {
    const first = bytes[index++];
    let point;
    if (first < 0x80) point = first;
    else if ((first & 0xe0) === 0xc0) {
      if (index >= bytes.length) fail('utf8_decode');
      const second = bytes[index++];
      if ((second & 0xc0) !== 0x80) fail('utf8_decode');
      point = ((first & 0x1f) << 6) | (second & 0x3f);
      if (point < 0x80) fail('utf8_decode');
    } else if ((first & 0xf0) === 0xe0) {
      if (index + 1 >= bytes.length) fail('utf8_decode');
      const second = bytes[index++];
      const third = bytes[index++];
      if ((second & 0xc0) !== 0x80 || (third & 0xc0) !== 0x80) fail('utf8_decode');
      point = ((first & 0x0f) << 12) | ((second & 0x3f) << 6) | (third & 0x3f);
      if (point < 0x800 || (point >= 0xd800 && point <= 0xdfff)) fail('utf8_decode');
    } else if ((first & 0xf8) === 0xf0) {
      if (index + 2 >= bytes.length) fail('utf8_decode');
      const second = bytes[index++];
      const third = bytes[index++];
      const fourth = bytes[index++];
      if ((second & 0xc0) !== 0x80 || (third & 0xc0) !== 0x80 || (fourth & 0xc0) !== 0x80) fail('utf8_decode');
      point = ((first & 0x07) << 18) | ((second & 0x3f) << 12) | ((third & 0x3f) << 6) | (fourth & 0x3f);
      if (point < 0x10000 || point > 0x10ffff) fail('utf8_decode');
    } else fail('utf8_decode');
    value += point <= 0xffff
      ? String.fromCharCode(point)
      : String.fromCharCode(0xd800 + ((point - 0x10000) >>> 10), 0xdc00 + ((point - 0x10000) & 0x3ff));
  }
  return value;
}

function concatBytes(...values) {
  const result = new Uint8Array(values.reduce((sum, value) => sum + value.byteLength, 0));
  let offset = 0;
  for (const value of values) {
    result.set(value, offset);
    offset += value.byteLength;
  }
  return result;
}

function hkdfExtract(salt, inputKeyMaterial) {
  return hmac(sha256, salt, inputKeyMaterial);
}

function hkdfExpand(prk, info, length) {
  if (!Number.isSafeInteger(length) || length < 1 || length > 255 * 32) fail('hkdf_length');
  const output = new Uint8Array(length);
  let previous = new Uint8Array();
  let offset = 0;
  try {
    for (let counter = 1; offset < length; counter += 1) {
      const input = concatBytes(previous, info, Uint8Array.of(counter));
      const next = hmac(sha256, prk, input);
      input.fill(0);
      previous.fill(0);
      previous = next;
      const take = Math.min(next.length, length - offset);
      output.set(next.subarray(0, take), offset);
      offset += take;
    }
    return output;
  } finally {
    previous.fill(0);
  }
}

function sha256Hex(bytes) {
  return [...sha256(bytes)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

export function transferDraftHash(draft) {
  return sha256Hex(utf8Encode(canonicalTransferDeviceDraft(draft)));
}

function normalizeTargetState(value) {
  const state = object(value, 'target_state');
  if (state.v !== TRANSFER_STATE_VERSION || state.role !== 'target') fail('target_state_version');
  const draft = normalizeTransferDeviceDraft(state.targetDeviceDraft);
  const targetDraftHash = hash(state.targetDraftHash, 'target_draft_hash');
  if (transferDraftHash(draft) !== targetDraftHash) fail('target_draft_hash');
  return {
    v: TRANSFER_STATE_VERSION,
    role: 'target',
    targetDeviceDraft: draft,
    targetDraftHash,
    targetPrivateKey: bytesToBase64Url(exactBytes(base64UrlToBytes(state.targetPrivateKey, 32), 32, 'target_private_key')),
    targetEphemeralPublicKey: bytesToBase64Url(exactBytes(base64UrlToBytes(state.targetEphemeralPublicKey, 32), 32, 'target_public_key')),
    transferSecret: bytesToBase64Url(exactBytes(base64UrlToBytes(state.transferSecret, 32), 32, 'transfer_secret')),
    sessionId: state.sessionId === null ? null : id(state.sessionId, 'transfer_session_id'),
  };
}

function normalizeSession(value) {
  const session = object(value, 'transfer_session_response');
  const normalized = normalizeDeviceTransferSessionInput({
    protocolVersion: session.protocolVersion,
    targetDeviceId: session.targetDeviceId,
    targetEphemeralPublicKey: session.targetEphemeralPublicKey,
    targetDraftHash: session.targetDraftHash,
    targetDeviceDraft: session.targetDeviceDraft,
  });
  return {
    ...normalized,
    id: id(session.id, 'transfer_session_id'),
    accountId: id(session.accountId, 'transfer_account_id'),
  };
}

function normalizeSourceState(value) {
  const state = object(value, 'source_state');
  if (state.v !== TRANSFER_STATE_VERSION || state.role !== 'source') fail('source_state_version');
  const qr = parseDeviceTransferQr(state.qrPayload);
  const session = normalizeSession(state.session);
  const sourcePrivateKey = exactBytes(base64UrlToBytes(state.sourcePrivateKey, 32), 32, 'source_private_key');
  const sourceEphemeralPublicKey = exactBytes(
    base64UrlToBytes(state.sourceEphemeralPublicKey, 32),
    32,
    'source_public_key',
  );
  const expectedPublicKey = x25519.getPublicKey(sourcePrivateKey);
  const validPublicKey = expectedPublicKey.every((byte, index) => byte === sourceEphemeralPublicKey[index]);
  expectedPublicKey.fill(0);
  sourcePrivateKey.fill(0);
  sourceEphemeralPublicKey.fill(0);
  if (!validPublicKey) fail('source_key_binding');
  if (
    qr.sessionId !== session.id
    || qr.accountId !== session.accountId
    || qr.targetDeviceId !== session.targetDeviceId
    || qr.targetEphemeralPublicKey !== session.targetEphemeralPublicKey
    || qr.targetDraftHash !== session.targetDraftHash
  ) fail('source_session_binding');
  return {
    v: TRANSFER_STATE_VERSION,
    role: 'source',
    qrPayload: state.qrPayload,
    session,
    sourcePrivateKey: state.sourcePrivateKey,
    sourceEphemeralPublicKey: state.sourceEphemeralPublicKey,
  };
}

function encodeQrPayload(state) {
  if (state.sessionId === null) fail('transfer_session_unbound');
  return `${QR_PREFIX}${bytesToBase64Url(utf8Encode(JSON.stringify([
    TRANSFER_TAG,
    CHAT_PROTOCOL_VERSION,
    state.sessionId,
    state.targetDeviceDraft.accountId,
    state.targetDeviceDraft.deviceId,
    state.targetEphemeralPublicKey,
    state.targetDraftHash,
    state.transferSecret,
  ])))}`;
}

export function parseDeviceTransferQr(value) {
  if (typeof value !== 'string' || !value.startsWith(QR_PREFIX) || value.length > 2048) fail('transfer_qr');
  let decoded;
  try {
    decoded = JSON.parse(utf8Decode(base64UrlToBytes(value.slice(QR_PREFIX.length), 1024)));
  } catch (error) {
    if (error instanceof DeviceTransferError) throw error;
    fail('transfer_qr', error);
  }
  if (!Array.isArray(decoded) || decoded.length !== 8 || decoded[0] !== TRANSFER_TAG || decoded[1] !== CHAT_PROTOCOL_VERSION) {
    fail('transfer_qr');
  }
  return {
    protocolVersion: CHAT_PROTOCOL_VERSION,
    sessionId: id(decoded[2], 'transfer_session_id'),
    accountId: id(decoded[3], 'transfer_account_id'),
    targetDeviceId: id(decoded[4], 'transfer_target_device_id'),
    targetEphemeralPublicKey: bytesToBase64Url(exactBytes(base64UrlToBytes(decoded[5], 32), 32, 'transfer_target_key')),
    targetDraftHash: hash(decoded[6], 'transfer_draft_hash'),
    transferSecret: bytesToBase64Url(exactBytes(base64UrlToBytes(decoded[7], 32), 32, 'transfer_secret')),
  };
}

function channelTranscript(sessionId, accountId, targetDeviceId, targetPublicKey, draftHash, sourcePublicKey) {
  return utf8Encode(JSON.stringify([
    TRANSFER_CHANNEL_TAG,
    CHAT_PROTOCOL_VERSION,
    sessionId,
    accountId,
    targetDeviceId,
    targetPublicKey,
    draftHash,
    sourcePublicKey,
  ]));
}

function deriveChannel(privateKey, peerPublicKey, transferSecret, transcript) {
  let shared;
  let prk;
  let expanded;
  try {
    shared = x25519.getSharedSecret(privateKey, peerPublicKey);
    prk = hkdfExtract(transferSecret, shared);
    expanded = hkdfExpand(prk, concatBytes(utf8Encode(TRANSFER_CHANNEL_TAG), transcript), 64);
    return {
      encryptionKey: expanded.slice(0, 32),
      confirmationKey: expanded.slice(32),
      transcript: transcript.slice(),
      transcriptHash: sha256Hex(transcript),
    };
  } catch (error) {
    if (error instanceof DeviceTransferError) throw error;
    fail('transfer_channel', error);
  } finally {
    shared?.fill(0);
    prk?.fill(0);
    expanded?.fill(0);
  }
}

function verificationCode(channel) {
  const digest = hmac(sha256, channel.confirmationKey, channel.transcript);
  try {
    const numeric = (((digest[0] << 16) | (digest[1] << 8) | digest[2]) >>> 0) % 1_000_000;
    return numeric.toString().padStart(6, '0').replace(/(\d{3})(\d{3})/, '$1 $2');
  } finally {
    digest.fill(0);
  }
}

function payloadAad(channel, kind, sequence, previousHash) {
  return utf8Encode(JSON.stringify([
    TRANSFER_PAYLOAD_TAG,
    CHAT_PROTOCOL_VERSION,
    channel.transcriptHash,
    kind,
    sequence,
    previousHash,
  ]));
}

function encodeEncryptedPayload(value) {
  return bytesToBase64Url(utf8Encode(JSON.stringify(value)));
}

function normalizeEncryptedPayload(value) {
  let payload;
  try {
    payload = object(JSON.parse(utf8Decode(base64UrlToBytes(value, MAX_TRANSFER_CHUNK_BYTES + 4096))), 'transfer_payload');
  } catch (error) {
    if (error instanceof DeviceTransferError) throw error;
    fail('transfer_payload', error);
  }
  const keys = Object.keys(payload).sort().join(',');
  if (keys !== 'alg,ciphertext,kind,nonce,previousHash,sequence,v') fail('transfer_payload_keys');
  if (payload.v !== TRANSFER_STATE_VERSION || payload.alg !== TRANSFER_ALGORITHM || !ALLOWED_KINDS.has(payload.kind)) {
    fail('transfer_payload_header');
  }
  if (!Number.isSafeInteger(payload.sequence) || payload.sequence < 0 || payload.sequence >= MAX_TRANSFER_CHUNKS) fail('transfer_payload_sequence');
  const previousHash = payload.previousHash === null ? null : hash(payload.previousHash, 'transfer_previous_hash');
  return {
    v: TRANSFER_STATE_VERSION,
    alg: TRANSFER_ALGORITHM,
    kind: payload.kind,
    sequence: payload.sequence,
    previousHash,
    nonce: exactBytes(base64UrlToBytes(payload.nonce, 24), 24, 'transfer_nonce'),
    ciphertext: base64UrlToBytes(payload.ciphertext, MAX_TRANSFER_CHUNK_BYTES + 16),
  };
}

function encryptPayload(channel, randomBytes, kind, sequence, plaintextValue, previousHash = null) {
  if (!ALLOWED_KINDS.has(kind)) fail('transfer_payload_kind');
  if (!Number.isSafeInteger(sequence) || sequence < 0 || sequence >= MAX_TRANSFER_CHUNKS) fail('transfer_payload_sequence');
  if (previousHash !== null) hash(previousHash, 'transfer_previous_hash');
  const plaintext = typeof plaintextValue === 'string' ? utf8Encode(plaintextValue) : plaintextValue.slice();
  if (!(plaintext instanceof Uint8Array) || plaintext.byteLength > MAX_TRANSFER_CHUNK_BYTES) fail('transfer_plaintext_size');
  const nonce = randomBytesFrom(randomBytes, 24);
  try {
    const ciphertext = xchacha20poly1305(channel.encryptionKey, nonce, payloadAad(channel, kind, sequence, previousHash)).encrypt(plaintext);
    const payload = encodeEncryptedPayload({
      v: TRANSFER_STATE_VERSION,
      alg: TRANSFER_ALGORITHM,
      kind,
      sequence,
      previousHash,
      nonce: bytesToBase64Url(nonce),
      ciphertext: bytesToBase64Url(ciphertext),
    });
    return {
      kind,
      sequence,
      previousHash,
      payload,
      payloadHash: sha256Hex(base64UrlToBytes(payload)),
      ciphertextBytes: ciphertext.byteLength,
    };
  } finally {
    nonce.fill(0);
    plaintext.fill(0);
  }
}

function decryptPayload(channel, value, expected = {}) {
  if (typeof value !== 'string') fail('transfer_payload');
  const payloadHash = sha256Hex(base64UrlToBytes(value));
  if (expected.payloadHash !== undefined && payloadHash !== expected.payloadHash) fail('transfer_payload_hash');
  const payload = normalizeEncryptedPayload(value);
  if (expected.kind !== undefined && payload.kind !== expected.kind) fail('transfer_payload_kind');
  if (expected.sequence !== undefined && payload.sequence !== expected.sequence) fail('transfer_payload_sequence');
  if (expected.previousHash !== undefined && payload.previousHash !== expected.previousHash) fail('transfer_previous_hash');
  try {
    return {
      kind: payload.kind,
      sequence: payload.sequence,
      previousHash: payload.previousHash,
      payloadHash,
      plaintext: xchacha20poly1305(
        channel.encryptionKey,
        payload.nonce,
        payloadAad(channel, payload.kind, payload.sequence, payload.previousHash),
      ).decrypt(payload.ciphertext),
    };
  } catch (error) {
    fail('transfer_decrypt', error);
  } finally {
    payload.nonce.fill(0);
    payload.ciphertext.fill(0);
  }
}

export class DeviceTransferTarget {
  constructor(optionsValue) {
    const options = object(optionsValue, 'target_options');
    this.randomBytes = options.randomBytes;
    const state = options.state === undefined
      ? (() => {
          const targetDeviceDraft = normalizeTransferDeviceDraft(options.targetDeviceDraft);
          const targetPrivateKey = randomBytesFrom(this.randomBytes, 32);
          const targetEphemeralPublicKey = x25519.getPublicKey(targetPrivateKey);
          const transferSecret = randomBytesFrom(this.randomBytes, 32);
          const created = {
            v: TRANSFER_STATE_VERSION,
            role: 'target',
            targetDeviceDraft,
            targetDraftHash: transferDraftHash(targetDeviceDraft),
            targetPrivateKey: bytesToBase64Url(targetPrivateKey),
            targetEphemeralPublicKey: bytesToBase64Url(targetEphemeralPublicKey),
            transferSecret: bytesToBase64Url(transferSecret),
            sessionId: null,
          };
          targetPrivateKey.fill(0);
          targetEphemeralPublicKey.fill(0);
          transferSecret.fill(0);
          return created;
        })()
      : normalizeTargetState(options.state);
    this.state = state;
    this.targetPrivateKey = base64UrlToBytes(state.targetPrivateKey, 32);
    this.transferSecret = base64UrlToBytes(state.transferSecret, 32);
    this.channel = undefined;
  }

  createSessionInput() {
    return normalizeDeviceTransferSessionInput({
      protocolVersion: CHAT_PROTOCOL_VERSION,
      targetDeviceId: this.state.targetDeviceDraft.deviceId,
      targetEphemeralPublicKey: this.state.targetEphemeralPublicKey,
      targetDraftHash: this.state.targetDraftHash,
      targetDeviceDraft: this.state.targetDeviceDraft,
    });
  }

  bindSession(sessionIdValue) {
    const sessionId = id(sessionIdValue, 'transfer_session_id');
    if (this.state.sessionId !== null && this.state.sessionId !== sessionId) fail('transfer_session_rebind');
    this.state.sessionId = sessionId;
    return { qrPayload: encodeQrPayload(this.state), state: this.exportState() };
  }

  connect(sessionValue, sourceEphemeralPublicKeyValue) {
    const session = normalizeSession(sessionValue);
    if (
      this.state.sessionId !== session.id
      || session.accountId !== this.state.targetDeviceDraft.accountId
      || session.targetDeviceId !== this.state.targetDeviceDraft.deviceId
      || session.targetEphemeralPublicKey !== this.state.targetEphemeralPublicKey
      || session.targetDraftHash !== this.state.targetDraftHash
      || canonicalTransferDeviceDraft(session.targetDeviceDraft) !== canonicalTransferDeviceDraft(this.state.targetDeviceDraft)
    ) fail('transfer_session_binding');
    const sourceEphemeralPublicKey = bytesToBase64Url(exactBytes(
      base64UrlToBytes(sourceEphemeralPublicKeyValue, 32),
      32,
      'transfer_source_key',
    ));
    this.channel?.encryptionKey.fill(0);
    this.channel?.confirmationKey.fill(0);
    this.channel?.transcript.fill(0);
    this.channel = deriveChannel(
      this.targetPrivateKey,
      base64UrlToBytes(sourceEphemeralPublicKey, 32),
      this.transferSecret,
      channelTranscript(
        session.id,
        session.accountId,
        session.targetDeviceId,
        session.targetEphemeralPublicKey,
        session.targetDraftHash,
        sourceEphemeralPublicKey,
      ),
    );
    return { verificationCode: verificationCode(this.channel) };
  }

  decrypt(value, expected) {
    if (this.channel === undefined) fail('transfer_channel_missing');
    return decryptPayload(this.channel, value, expected);
  }

  exportState() {
    return JSON.parse(JSON.stringify(this.state));
  }

  destroy() {
    this.targetPrivateKey.fill(0);
    this.transferSecret.fill(0);
    this.channel?.encryptionKey.fill(0);
    this.channel?.confirmationKey.fill(0);
    this.channel?.transcript.fill(0);
    this.channel = undefined;
  }
}

export class DeviceTransferSource {
  constructor(optionsValue) {
    const options = object(optionsValue, 'source_options');
    this.randomBytes = options.randomBytes;
    const restored = options.state === undefined ? undefined : normalizeSourceState(options.state);
    const qrPayload = restored?.qrPayload ?? options.qrPayload;
    const qr = parseDeviceTransferQr(qrPayload);
    const session = restored?.session ?? normalizeSession(options.session);
    if (
      qr.sessionId !== session.id
      || qr.accountId !== session.accountId
      || qr.targetDeviceId !== session.targetDeviceId
      || qr.targetEphemeralPublicKey !== session.targetEphemeralPublicKey
      || qr.targetDraftHash !== session.targetDraftHash
      || transferDraftHash(session.targetDeviceDraft) !== session.targetDraftHash
    ) fail('transfer_qr_binding');
    this.qr = qr;
    this.session = session;
    this.sourcePrivateKey = restored === undefined
      ? randomBytesFrom(this.randomBytes, 32)
      : base64UrlToBytes(restored.sourcePrivateKey, 32);
    this.sourceEphemeralPublicKey = restored === undefined
      ? x25519.getPublicKey(this.sourcePrivateKey)
      : base64UrlToBytes(restored.sourceEphemeralPublicKey, 32);
    this.state = {
      v: TRANSFER_STATE_VERSION,
      role: 'source',
      qrPayload,
      session,
      sourcePrivateKey: bytesToBase64Url(this.sourcePrivateKey),
      sourceEphemeralPublicKey: bytesToBase64Url(this.sourceEphemeralPublicKey),
    };
    this.channel = deriveChannel(
      this.sourcePrivateKey,
      base64UrlToBytes(qr.targetEphemeralPublicKey, 32),
      base64UrlToBytes(qr.transferSecret, 32),
      channelTranscript(
        session.id,
        session.accountId,
        session.targetDeviceId,
        session.targetEphemeralPublicKey,
        session.targetDraftHash,
        bytesToBase64Url(this.sourceEphemeralPublicKey),
      ),
    );
  }

  get publicState() {
    return {
      sourceEphemeralPublicKey: bytesToBase64Url(this.sourceEphemeralPublicKey),
      verificationCode: verificationCode(this.channel),
    };
  }

  encryptHistory(sequence, plaintext, previousHash = null) {
    return encryptPayload(this.channel, this.randomBytes, 'history', sequence, plaintext, previousHash);
  }

  encryptApproval(plaintext, finalHistoryHash = null) {
    return encryptPayload(this.channel, this.randomBytes, 'approval', 0, plaintext, finalHistoryHash);
  }

  exportState() {
    return JSON.parse(JSON.stringify(this.state));
  }

  destroy() {
    this.sourcePrivateKey.fill(0);
    this.sourceEphemeralPublicKey.fill(0);
    this.channel.encryptionKey.fill(0);
    this.channel.confirmationKey.fill(0);
    this.channel.transcript.fill(0);
  }
}

export function createDeviceTransferTarget(options) {
  return new DeviceTransferTarget(options);
}

export function createDeviceTransferSource(options) {
  return new DeviceTransferSource(options);
}

export function validateTransferManifest(value) {
  try {
    return normalizeTransferManifest(value);
  } catch (error) {
    fail('transfer_manifest', error);
  }
}

export function hashTransferPayload(payload) {
  if (typeof payload !== 'string') fail('transfer_payload');
  return sha256Hex(base64UrlToBytes(payload, MAX_TRANSFER_CHUNK_BYTES + 4096));
}
