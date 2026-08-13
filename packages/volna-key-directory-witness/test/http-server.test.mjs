import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import test from 'node:test';
import {
  createKeyDirectorySnapshotReceipt,
  createKeyDirectoryWitness,
  createMemoryKeyDirectoryWitnessStore,
  keyDirectorySnapshotReceiptPublicKey,
} from '@volna/messaging-client/key-directory-witness';
import { createMlsRuntime, keyDirectoryLabel } from '@volna/messaging-client/mls-runtime';
import { createWitnessHttpServer } from '../src/http-server.mjs';

const random = (length) => new Uint8Array(randomBytes(length));
const digest = (value) => createHash('sha256').update(Buffer.from(value, 'base64url')).digest('hex');

async function fixture() {
  const runtime = createMlsRuntime({ randomBytes: random });
  const identity = await runtime.createDeviceIdentity({
    accountId: 'account_alice',
    deviceId: 'device_alice_1',
    platform: 'web',
    displayName: 'Alice browser',
    capabilities: ['mls-v1'],
  });
  const recordedAt = '2026-08-13T09:00:00.000Z';
  const payload = {
    version: 1,
    operation: 'REGISTER',
    accountId: identity.accountId,
    deviceId: identity.deviceId,
    platform: identity.platform,
    displayName: identity.displayName,
    credentialHash: digest(identity.credential),
    signatureKeyHash: digest(identity.signaturePublicKey),
    accountIdentityKeyHash: digest(identity.accountIdentityPublicKey),
    accountIdentitySignature: identity.accountIdentitySignature,
    capabilities: identity.capabilities,
    registeredAt: recordedAt,
    revokedAt: null,
    recordedAt,
  };
  const entryHash = createHash('sha256')
    .update(Buffer.from(JSON.stringify(['VOLNA-CHAT-KEY-DIRECTORY', 1, null, payload]), 'utf8'))
    .digest('hex');
  const snapshot = {
    accountId: identity.accountId,
    identity: {
      accountId: identity.accountId,
      publicKey: identity.accountIdentityPublicKey,
      keyHash: digest(identity.accountIdentityPublicKey),
      createdAt: recordedAt,
    },
    devices: [{
      id: identity.deviceId,
      accountId: identity.accountId,
      platform: identity.platform,
      displayName: identity.displayName,
      credential: identity.credential,
      signaturePublicKey: identity.signaturePublicKey,
      accountIdentitySignature: identity.accountIdentitySignature,
      capabilities: identity.capabilities,
      status: 'ACTIVE',
      registeredAt: recordedAt,
      lastSeenAt: recordedAt,
      revokedAt: null,
    }],
    entries: [{
      id: '1',
      deviceId: identity.deviceId,
      operation: 'DEVICE_REGISTERED',
      previousHash: null,
      entryHash,
      payload,
      createdAt: recordedAt,
    }],
    headHash: entryHash,
  };
  const checkpoint = {
    version: 1,
    directoryLabel: keyDirectoryLabel(identity.accountId),
    identityFingerprint: snapshot.identity.keyHash,
    entryCount: 1,
    headHash: entryHash,
  };
  return { snapshot, checkpoint };
}

async function runningServer() {
  const receiptKey = new Uint8Array(32).fill(41);
  const witness = createKeyDirectoryWitness({
    witnessId: 'witness_operator_1',
    signingKey: new Uint8Array(32).fill(42),
    store: createMemoryKeyDirectoryWitnessStore(),
  });
  const server = createWitnessHttpServer({
    witness,
    receiptPublicKey: keyDirectorySnapshotReceiptPublicKey(receiptKey),
    allowedOrigins: ['https://volna.social'],
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return {
    base: `http://127.0.0.1:${address.port}`,
    receiptKey,
    witness,
    close: async () => {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      witness.destroy();
    },
  };
}

test('HTTP witness accepts only an attested canonical snapshot and serves the exact checkpoint', async (context) => {
  const active = await runningServer();
  context.after(active.close);
  const { snapshot, checkpoint } = await fixture();
  const receipt = createKeyDirectorySnapshotReceipt({
    checkpoint,
    signingKey: active.receiptKey,
    issuedAt: Date.now(),
  });
  const observed = await fetch(`${active.base}/v1/key-directory/observations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://volna.social' },
    body: JSON.stringify({ snapshot, receipt }),
  });
  assert.equal(observed.status, 200);
  assert.equal(observed.headers.get('access-control-allow-origin'), 'https://volna.social');
  const statement = await observed.json();
  assert.equal(statement.witnessId, active.witness.witnessId);
  assert.deepEqual(statement.checkpoint, checkpoint);

  const query = new URLSearchParams({
    entryCount: String(checkpoint.entryCount),
    headHash: checkpoint.headHash,
    identityFingerprint: checkpoint.identityFingerprint,
  });
  const read = await fetch(`${active.base}/v1/key-directory/checkpoints/${checkpoint.directoryLabel}?${query}`);
  assert.equal(read.status, 200);
  assert.deepEqual(await read.json(), statement);
});

test('HTTP witness rejects forged receipts and unconfigured browser origins without advancing state', async (context) => {
  const active = await runningServer();
  context.after(active.close);
  const { snapshot, checkpoint } = await fixture();
  const receipt = createKeyDirectorySnapshotReceipt({
    checkpoint,
    signingKey: active.receiptKey,
    issuedAt: Date.now(),
  });
  const forbidden = await fetch(`${active.base}/v1/key-directory/observations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://attacker.example' },
    body: JSON.stringify({ snapshot, receipt }),
  });
  assert.equal(forbidden.status, 403);

  const forged = await fetch(`${active.base}/v1/key-directory/observations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ snapshot, receipt: { ...receipt, signature: Buffer.alloc(64, 9).toString('base64url') } }),
  });
  assert.equal(forged.status, 401);
  assert.deepEqual(await forged.json(), { error: 'receipt_signature' });
  const credentialLeak = await fetch(`${active.base}/v1/key-directory/observations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer must-not-cross-boundary' },
    body: JSON.stringify({ snapshot, receipt }),
  });
  assert.equal(credentialLeak.status, 400);
  assert.deepEqual(await credentialLeak.json(), { error: 'credentials_forbidden' });
  assert.equal(await active.witness.getStatement(checkpoint), null);
});
