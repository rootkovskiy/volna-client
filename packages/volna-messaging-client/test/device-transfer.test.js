'use strict';

const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const test = require('node:test');

const random = (length) => new Uint8Array(randomBytes(length));

const draft = {
  accountId: 'account_alice',
  deviceId: 'device_alice_new',
  platform: 'ios',
  displayName: 'Alice iPhone',
  credential: Buffer.alloc(96, 1).toString('base64url'),
  signaturePublicKey: Buffer.alloc(32, 2).toString('base64url'),
  accountIdentityPublicKey: Buffer.alloc(32, 3).toString('base64url'),
  capabilities: ['mls-v1', 'transfer-v1'],
};

test('QR-bound device transfer encrypts approval and chained history without server keys', async () => {
  const {
    createDeviceTransferSource,
    createDeviceTransferTarget,
    validateTransferManifest,
  } = await import('../src/device-transfer.mjs');
  const target = createDeviceTransferTarget({ randomBytes: random, targetDeviceDraft: draft });
  const input = target.createSessionInput();
  const session = {
    id: 'transfer_session_0001',
    accountId: draft.accountId,
    ...input,
  };
  const { qrPayload, state } = target.bindSession(session.id);
  assert.equal(qrPayload.includes(draft.credential), false);
  assert.equal(JSON.stringify(state).includes('targetPrivateKey'), true);

  const source = createDeviceTransferSource({ randomBytes: random, qrPayload, session });
  const restoredSource = createDeviceTransferSource({ randomBytes: random, state: source.exportState() });
  assert.deepEqual(restoredSource.publicState, source.publicState);
  restoredSource.destroy();
  const connected = target.connect(session, source.publicState.sourceEphemeralPublicKey);
  assert.equal(connected.verificationCode, source.publicState.verificationCode);
  assert.match(connected.verificationCode, /^\d{3} \d{3}$/);

  const first = source.encryptHistory(0, JSON.stringify({ v: 1, threadId: 'thread_secure_1', records: [] }));
  const second = source.encryptHistory(1, JSON.stringify({ v: 1, threadId: 'thread_secure_2', records: [] }), first.payloadHash);
  const manifest = validateTransferManifest({
    v: 1,
    chunkCount: 2,
    finalChunkHash: second.payloadHash,
    totalCiphertextBytes: first.ciphertextBytes + second.ciphertextBytes,
  });
  const approval = source.encryptApproval(JSON.stringify({
    v: 1,
    recoverySecret: Buffer.alloc(32, 4).toString('base64url'),
    accountIdentitySignature: Buffer.alloc(64, 5).toString('base64url'),
    manifest,
  }), manifest.finalChunkHash);

  const openedApproval = target.decrypt(approval.payload, {
    payloadHash: approval.payloadHash,
    kind: 'approval',
    sequence: 0,
    previousHash: manifest.finalChunkHash,
  });
  assert.equal(JSON.parse(Buffer.from(openedApproval.plaintext).toString('utf8')).manifest.chunkCount, 2);
  openedApproval.plaintext.fill(0);

  const openedFirst = target.decrypt(first.payload, {
    payloadHash: first.payloadHash,
    kind: 'history',
    sequence: 0,
    previousHash: null,
  });
  assert.equal(JSON.parse(Buffer.from(openedFirst.plaintext).toString('utf8')).threadId, 'thread_secure_1');
  openedFirst.plaintext.fill(0);
  const openedSecond = target.decrypt(second.payload, {
    payloadHash: second.payloadHash,
    kind: 'history',
    sequence: 1,
    previousHash: first.payloadHash,
  });
  assert.equal(JSON.parse(Buffer.from(openedSecond.plaintext).toString('utf8')).threadId, 'thread_secure_2');
  openedSecond.plaintext.fill(0);

  source.destroy();
  target.destroy();
});

test('device transfer fails closed on substituted session draft and tampered ciphertext', async () => {
  const { createDeviceTransferSource, createDeviceTransferTarget } = await import('../src/device-transfer.mjs');
  const target = createDeviceTransferTarget({ randomBytes: random, targetDeviceDraft: draft });
  const session = {
    id: 'transfer_session_0002',
    accountId: draft.accountId,
    ...target.createSessionInput(),
  };
  const { qrPayload } = target.bindSession(session.id);
  assert.throws(() => createDeviceTransferSource({
    randomBytes: random,
    qrPayload,
    session: {
      ...session,
      targetDeviceDraft: { ...session.targetDeviceDraft, displayName: 'Substituted device' },
    },
  }), /transfer/);

  const source = createDeviceTransferSource({ randomBytes: random, qrPayload, session });
  target.connect(session, source.publicState.sourceEphemeralPublicKey);
  const encrypted = source.encryptApproval('{"v":1}');
  const bytes = Buffer.from(encrypted.payload, 'base64url');
  bytes[bytes.length - 1] ^= 1;
  assert.throws(() => target.decrypt(bytes.toString('base64url'), { kind: 'approval' }), /transfer/);
  source.destroy();
  target.destroy();
});
