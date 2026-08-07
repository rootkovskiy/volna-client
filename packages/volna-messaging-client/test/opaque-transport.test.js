'use strict';

const assert = require('node:assert/strict');
const { createHash, randomBytes } = require('node:crypto');
const test = require('node:test');

function response(value, status = 200) {
  const body = JSON.stringify(value);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => name === 'content-length' ? String(body.length) : null },
    text: async () => body,
  };
}

test('opaque transport sends only bounded ciphertext envelope fields', async () => {
  const { createOpaqueChatTransport } = await import('../src/opaque-transport.mjs');
  let captured;
  const transport = createOpaqueChatTransport({
    apiOrigin: 'https://volna.example',
    getAccessToken: () => 'token',
    fetch: async (url, init) => {
      captured = { url, init };
      return response({
        id: 'envelope_server_1',
        threadId: 'thread_secure_1',
        senderId: 'account_alice',
        senderDeviceId: 'device_alice',
        clientEnvelopeId: 'envelope_alice_1',
        protocolVersion: 1,
        kind: 'APPLICATION',
        epoch: '1',
        ciphertext: 'AQID',
        ciphertextHash: createHash('sha256').update(Buffer.from('AQID', 'base64url')).digest('hex'),
        createdAt: '2026-08-03T12:00:00.000Z',
      });
    },
  });
  await transport.sendEnvelope('thread_secure_1', {
    protocolVersion: 1,
    senderDeviceId: 'device_alice',
    clientEnvelopeId: 'envelope_alice_1',
    kind: 'APPLICATION',
    epoch: '1',
    ciphertext: 'AQID',
  });
  assert.equal(captured.url, 'https://volna.example/chats/thread_secure_1/e2ee/envelopes');
  assert.deepEqual(Object.keys(JSON.parse(captured.init.body)).sort(), [
    'ciphertext', 'clientEnvelopeId', 'epoch', 'kind', 'protocolVersion', 'senderDeviceId',
  ]);
  assert.equal(captured.init.redirect, 'error');
  assert.equal(captured.init.cache, 'no-store');
});

test('opaque transport fails closed on protocol downgrade', async () => {
  const { createOpaqueChatTransport } = await import('../src/opaque-transport.mjs');
  const transport = createOpaqueChatTransport({
    apiOrigin: 'https://volna.example',
    getAccessToken: () => undefined,
    fetch: async () => response({
      protocolVersion: 1,
      ciphersuite: 'MLS_128_DHKEMX25519_CHACHA20POLY1305_SHA256_Ed25519',
      rolloutEnabled: true,
      plaintextFallback: true,
      contentPlane: 'opaque-only-for-mls-v1',
      legacyHistoryServerReadable: true,
    }),
  });
  await assert.rejects(() => transport.capabilities(), /capabilities_mismatch/);
});

test('opaque transport cannot read a key directory without pinned independent witnesses', async () => {
  const { createOpaqueChatTransport } = await import('../src/opaque-transport.mjs');
  let called = false;
  const transport = createOpaqueChatTransport({
    apiOrigin: 'https://volna.example',
    getAccessToken: () => undefined,
    fetch: async () => {
      called = true;
      return response({});
    },
  });
  await assert.rejects(() => transport.getDirectory('account_alice'), /directory_witness_policy_missing/);
  assert.equal(called, false);
  assert.throws(() => createOpaqueChatTransport({
    apiOrigin: 'https://volna.example',
    getAccessToken: () => undefined,
    fetch: async () => response({}),
    keyTransparencyPolicy: {
      threshold: 2,
      maxStatementAgeMs: 60_000,
      witnesses: [
        { id: 'witness_1', origin: 'https://volna.example', publicKey: Buffer.alloc(32, 1).toString('base64url') },
        { id: 'witness_2', origin: 'https://witness.example', publicKey: Buffer.alloc(32, 2).toString('base64url') },
      ],
    },
  }), /directory_witness_origin/);
});

test('opaque transport assembles one immutable directory snapshot and requires an independent witness quorum', async () => {
  const { ed25519 } = await import('@noble/curves/ed25519.js');
  const {
    bytesToBase64Url,
    canonicalKeyDirectoryWitnessStatement,
    createMlsRuntime,
    keyDirectoryLabel,
  } = await import('../src/mls-runtime.mjs');
  const random = (length) => new Uint8Array(randomBytes(length));
  const firstRuntime = createMlsRuntime({ randomBytes: random });
  const secondRuntime = createMlsRuntime({ randomBytes: random });
  const first = await firstRuntime.createDeviceIdentity({
    accountId: 'account_alice',
    deviceId: 'device_alice_1',
    platform: 'web',
    displayName: 'Alice browser',
    capabilities: ['mls-v1'],
  });
  const second = await secondRuntime.createDeviceIdentity({
    accountId: 'account_alice',
    deviceId: 'device_alice_2',
    platform: 'ios',
    displayName: 'Alice phone',
    capabilities: ['mls-v1'],
    recoverySecret: first.recoverySecret,
  });
  const digest = (value) => createHash('sha256').update(Buffer.from(value, 'base64url')).digest('hex');
  const device = (identity, registeredAt) => ({
    id: identity.deviceId,
    accountId: identity.accountId,
    platform: identity.platform,
    displayName: identity.displayName,
    credential: identity.credential,
    signaturePublicKey: identity.signaturePublicKey,
    accountIdentitySignature: identity.accountIdentitySignature,
    capabilities: identity.capabilities,
    status: 'ACTIVE',
    registeredAt,
    lastSeenAt: registeredAt,
    revokedAt: null,
  });
  const entry = (identity, registeredAt, previousHash) => {
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
      registeredAt,
      revokedAt: null,
      recordedAt: registeredAt,
    };
    const entryHash = createHash('sha256')
      .update(Buffer.from(JSON.stringify(['VOLNA-CHAT-KEY-DIRECTORY', 1, previousHash, payload]), 'utf8'))
      .digest('hex');
    return {
      id: previousHash === null ? '1' : '2',
      deviceId: identity.deviceId,
      operation: 'DEVICE_REGISTERED',
      previousHash,
      entryHash,
      payload,
      createdAt: registeredAt,
    };
  };
  const firstAt = '2026-08-07T11:00:00.000Z';
  const secondAt = '2026-08-07T11:30:00.000Z';
  const firstEntry = entry(first, firstAt, null);
  const secondEntry = entry(second, secondAt, firstEntry.entryHash);
  const identity = {
    accountId: first.accountId,
    publicKey: first.accountIdentityPublicKey,
    keyHash: digest(first.accountIdentityPublicKey),
    createdAt: firstAt,
  };
  const devices = [device(first, firstAt), device(second, secondAt)];
  const checkpoint = {
    version: 1,
    directoryLabel: keyDirectoryLabel(first.accountId),
    identityFingerprint: identity.keyHash,
    entryCount: 2,
    headHash: secondEntry.entryHash,
  };
  const privateKeys = [new Uint8Array(32).fill(7), new Uint8Array(32).fill(8)];
  const witnesses = privateKeys.map((privateKey, index) => ({
    id: `witness_${index + 1}`,
    origin: `https://witness-${index + 1}.example`,
    publicKey: bytesToBase64Url(ed25519.getPublicKey(privateKey)),
  }));
  const witnessStatement = (index) => {
    const unsigned = {
      version: 1,
      witnessId: witnesses[index].id,
      checkpoint,
      observedAt: new Date().toISOString(),
    };
    return {
      ...unsigned,
      signature: bytesToBase64Url(ed25519.sign(
        canonicalKeyDirectoryWitnessStatement(unsigned),
        privateKeys[index],
      )),
    };
  };
  const apiCalls = [];
  const witnessCalls = [];
  const fetch = async (url, init = {}) => {
    const parsed = new URL(url);
    if (parsed.hostname.startsWith('witness-')) {
      witnessCalls.push({ url, init });
      const index = Number(parsed.hostname.match(/witness-(\d+)/)[1]) - 1;
      return response(witnessStatement(index));
    }
    apiCalls.push(url);
    const common = {
      accountId: first.accountId,
      entryCount: 2,
      headHash: secondEntry.entryHash,
    };
    return parsed.searchParams.has('cursor')
      ? response({
          ...common,
          identity: null,
          devices: [],
          entries: [secondEntry],
          nextCursor: null,
          snapshotDetailsIncluded: false,
        })
      : response({
          ...common,
          identity,
          devices,
          entries: [firstEntry],
          nextCursor: 'cursor_page_2',
          snapshotDetailsIncluded: true,
        });
  };
  const { createOpaqueChatTransport } = await import('../src/opaque-transport.mjs');
  const transport = createOpaqueChatTransport({
    apiOrigin: 'https://volna.example',
    getAccessToken: () => 'token',
    fetch,
    keyTransparencyPolicy: {
      threshold: 2,
      maxStatementAgeMs: 60_000,
      witnesses,
    },
  });

  const directory = await transport.getDirectory(first.accountId);
  assert.equal(directory.entries.length, 2);
  assert.equal(directory.verification.witnessQuorum.threshold, 2);
  assert.deepEqual(directory.verification.witnessQuorum.witnessIds, ['witness_1', 'witness_2']);
  assert.equal(apiCalls.length, 2);
  assert.equal(witnessCalls.length, 2);
  assert.ok(witnessCalls.every((call) => call.init.credentials === 'omit' && call.init.referrerPolicy === 'no-referrer'));
});
