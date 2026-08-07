'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CHAT_CIPHERSUITE,
  CHAT_PROTOCOL_VERSION,
  MessagingContractError,
  canonicalDeviceAuthorization,
  canonicalDeviceRegistrationProof,
  canonicalEnvelopeAad,
  decodedBase64UrlLength,
  decodeContentEvent,
  encodeContentEvent,
  normalizeDeviceRegistration,
  normalizeE2eeActivation,
  normalizeE2eeActivationRecovery,
  normalizeKeyPackageUpload,
  normalizeOpaqueEnvelopeInput,
  utf8ByteLength,
} = require('../src');

const id = (prefix) => `${prefix}_12345678`;

test('canonical content round-trips without adding server-readable fields', () => {
  const encoded = encodeContentEvent({
    v: 1,
    kind: 'message.create',
    logicalMessageId: id('logical'),
    clientCreatedAt: '2026-08-03T00:00:00.000Z',
    text: 'Привет\r\nмир',
    attachment: { kind: 'location', latitude: 55.7558, longitude: 37.6173, accuracy: 25 },
  });
  assert.deepEqual(decodeContentEvent(encoded), {
    v: 1,
    kind: 'message.create',
    logicalMessageId: id('logical'),
    clientCreatedAt: '2026-08-03T00:00:00.000Z',
    text: 'Привет\nмир',
    attachment: { kind: 'location', latitude: 55.7558, longitude: 37.6173, accuracy: 25 },
  });
});

test('entity snapshots round-trip inside ciphertext for stable rendering', () => {
  const encoded = encodeContentEvent({
    v: 1,
    kind: 'message.create',
    logicalMessageId: id('logical'),
    clientCreatedAt: '2026-08-05T00:00:00.000Z',
    attachment: {
      kind: 'entity',
      entityType: 'account',
      id: id('account'),
      snapshot: { name: 'Алиса', username: 'alice', avatarUrl: 'https://media.example/alice.webp', isVerified: true },
    },
  });
  const snapshot = decodeContentEvent(encoded).attachment.snapshot;
  assert.equal(Object.getPrototypeOf(snapshot), null);
  assert.deepEqual({ ...snapshot }, {
    name: 'Алиса',
    username: 'alice',
    avatarUrl: 'https://media.example/alice.webp',
    isVerified: true,
  });
});

test('content parser rejects unknown fields and prototype-bearing metadata', () => {
  assert.throws(() => encodeContentEvent({
    v: 1,
    kind: 'message.create',
    logicalMessageId: id('logical'),
    clientCreatedAt: '2026-08-03T00:00:00.000Z',
    text: 'ok',
    serverPreview: 'must never exist',
  }), (error) => error instanceof MessagingContractError && error.code === 'message_create_keys');

  const metadata = Object.create(null);
  Object.defineProperty(metadata, '__proto__', { enumerable: true, value: { polluted: true } });
  assert.throws(() => encodeContentEvent({
    v: 1,
    kind: 'message.create',
    logicalMessageId: id('logical'),
    clientCreatedAt: '2026-08-03T00:00:00.000Z',
    attachment: { kind: 'music', provider: 'bandcamp', id: 'https://example.test/track', title: 'Track', artist: 'Artist', metadata },
  }), (error) => error instanceof MessagingContractError && error.code === 'attachment_metadata');
});

test('AAD is canonical and binds server-derived routing identity', () => {
  const aad = canonicalEnvelopeAad({
    protocolVersion: 1,
    threadId: id('thread'),
    senderAccountId: id('account'),
    senderDeviceId: id('device'),
    clientEnvelopeId: id('envelope'),
    kind: 'APPLICATION',
    epoch: '42',
  });
  assert.equal(aad, '["VOLNA-CHAT-AAD",1,"thread_12345678","account_12345678","device_12345678","envelope_12345678","APPLICATION","42",null,null]');
});

test('opaque envelope contract rejects plaintext and oversized/non-canonical inputs', () => {
  const valid = {
    protocolVersion: CHAT_PROTOCOL_VERSION,
    senderDeviceId: id('device'),
    clientEnvelopeId: id('envelope'),
    kind: 'APPLICATION',
    epoch: '0',
    ciphertext: 'AQIDBA',
  };
  assert.deepEqual(normalizeOpaqueEnvelopeInput(valid), valid);
  assert.throws(() => normalizeOpaqueEnvelopeInput({ ...valid, text: 'plaintext' }), (error) => error.code === 'envelope_keys');
  assert.throws(() => normalizeOpaqueEnvelopeInput({ ...valid, ciphertext: 'not+base64' }), (error) => error.code === 'envelope_ciphertext');
});

test('device and key-package contracts are bounded and pinned', () => {
  const device = normalizeDeviceRegistration({
    challengeId: id('challenge'),
    deviceId: id('device'),
    platform: 'web',
    displayName: 'Safari на iPhone',
    credential: 'AQIDBA',
    signaturePublicKey: 'BQYHCA',
    accountIdentityPublicKey: 'CQoLDA',
    accountIdentitySignature: 'DQ4PEA',
    proofSignature: 'CQoLDA',
    capabilities: ['mls-1', 'mls-1'],
  });
  assert.deepEqual(device.capabilities, ['mls-1']);
  assert.deepEqual(normalizeKeyPackageUpload({
    deviceId: id('device'),
    protocolVersion: 1,
    ciphersuite: CHAT_CIPHERSUITE,
    keyPackages: ['AQIDBA', 'BQYHCA'],
  }).keyPackages, ['AQIDBA', 'BQYHCA']);
});

test('device proof and activation contracts are deterministic and complete', () => {
  const proof = canonicalDeviceRegistrationProof({
    challengeId: id('challenge'),
    challenge: 'AQIDBA',
    accountId: id('account'),
    deviceId: id('device'),
    platform: 'ios',
    displayName: 'iPhone',
    credential: 'BQYHCA',
    signaturePublicKey: 'CQoLDA',
    accountIdentityPublicKey: 'DQ4PEA',
    accountIdentitySignature: 'ERITFA',
    capabilities: ['z-capability', 'a-capability'],
  });
  assert.equal(proof, '["VOLNA-CHAT-DEVICE-REGISTRATION",1,"challenge_12345678","AQIDBA","account_12345678","device_12345678","ios","iPhone","BQYHCA","CQoLDA","DQ4PEA","ERITFA",["a-capability","z-capability"]]');
  assert.equal(canonicalDeviceAuthorization({
    accountId: id('account'),
    deviceId: id('device'),
    platform: 'ios',
    displayName: 'iPhone',
    credential: 'BQYHCA',
    signaturePublicKey: 'CQoLDA',
    capabilities: ['z-capability', 'a-capability'],
  }), '["VOLNA-CHAT-DEVICE-AUTHORIZATION",1,"account_12345678","device_12345678","ios","iPhone","BQYHCA","CQoLDA",["a-capability","z-capability"]]');

  const activation = normalizeE2eeActivation({
    protocolVersion: 1,
    senderDeviceId: id('device'),
    groupId: 'AQIDBAUGBwgJCgsMDQ4PEA',
    epoch: '1',
    claimIds: [id('claim')],
    welcomes: [{ recipientDeviceId: id('recipient'), payload: 'AQIDBA' }],
  });
  assert.equal(activation.welcomes[0].recipientDeviceId, id('recipient'));
  assert.throws(() => normalizeE2eeActivation({ ...activation, welcomes: [] }), (error) => error.code === 'activation_welcomes');

  const recovery = normalizeE2eeActivationRecovery({
    ...activation,
    previousGroupId: 'ERITFBUWFxgZGhscHR4fIA',
  });
  assert.equal(recovery.previousGroupId, 'ERITFBUWFxgZGhscHR4fIA');
  assert.throws(
    () => normalizeE2eeActivationRecovery({ ...recovery, previousGroupId: recovery.groupId }),
    (error) => error.code === 'activation_recovery_group',
  );
});

test('UTF-8 sizing is consistent for ASCII, Cyrillic, and surrogate pairs', () => {
  assert.equal(utf8ByteLength('abc'), 3);
  assert.equal(utf8ByteLength('Привет'), Buffer.byteLength('Привет'));
  assert.equal(utf8ByteLength('🌊'), 4);
});

test('base64url contracts reject non-canonical trailing bits', () => {
  assert.equal(decodedBase64UrlLength('AQ'), 1);
  assert.throws(() => decodedBase64UrlLength('A_'), /base64url/);
  assert.equal(decodedBase64UrlLength('AQI'), 2);
  assert.throws(() => decodedBase64UrlLength('AQJ'), /base64url/);
});
