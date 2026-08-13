'use strict';

const assert = require('node:assert/strict');
const { createHash, randomBytes } = require('node:crypto');
const test = require('node:test');

function response(value, status = 200) {
  const body = JSON.stringify(value);
  return new Response(body, {
    status,
    headers: {
      'content-length': String(new TextEncoder().encode(body).byteLength),
      'content-type': 'application/json',
    },
  });
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
  const witnessReceipt = {
    version: 1,
    issuer: 'volna_directory_v1',
    checkpoint,
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    signature: Buffer.alloc(64, 1).toString('base64url'),
  };
  const privateKeys = [
    new Uint8Array(32).fill(7),
    new Uint8Array(32).fill(8),
    new Uint8Array(32).fill(9),
  ];
  const witnesses = privateKeys.map((privateKey, index) => ({
    id: `witness_${index + 1}`,
    origin: `https://witness-${index + 1}.example`,
    publicKey: bytesToBase64Url(ed25519.getPublicKey(privateKey)),
  }));
  const witnessStatement = (index, statementCheckpoint = checkpoint) => {
    const unsigned = {
      version: 1,
      witnessId: witnesses[index].id,
      checkpoint: statementCheckpoint,
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
  let witnessMode = 'stall';
  let stalledWitnessAborted = false;
  let timedOutWitnesses = 0;
  let oversizedResponseCancelled = false;
  const fetch = async (url, init = {}) => {
    const parsed = new URL(url);
    if (parsed.hostname.startsWith('witness-')) {
      witnessCalls.push({ url, init });
      const index = Number(parsed.hostname.match(/witness-(\d+)/)[1]) - 1;
      if (witnessMode === 'stall' && index === 2) {
        return new Promise((resolve, reject) => {
          init.signal.addEventListener('abort', () => {
            stalledWitnessAborted = true;
            reject(new Error('aborted'));
          }, { once: true });
        });
      }
      if (witnessMode === 'timeout' && index > 0) {
        return new Promise((resolve, reject) => {
          init.signal.addEventListener('abort', () => {
            timedOutWitnesses += 1;
            reject(new Error('aborted'));
          }, { once: true });
        });
      }
      if (witnessMode === 'oversized' && index === 0) {
        return new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(64 * 1024 + 1));
          },
          cancel() {
            oversizedResponseCancelled = true;
          },
        }), { status: 200 });
      }
      if (witnessMode === 'mismatched-checkpoint' && index === 0) {
        return response(witnessStatement(index, { ...checkpoint, headHash: 'f'.repeat(64) }));
      }
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
          witnessReceipt: null,
          entries: [secondEntry],
          nextCursor: null,
          snapshotDetailsIncluded: false,
        })
      : response({
          ...common,
          identity,
          devices,
          witnessReceipt,
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
      requestTimeoutMs: 100,
      witnesses,
    },
  });

  const directory = await transport.getDirectory(first.accountId);
  assert.equal(directory.entries.length, 2);
  assert.equal(directory.verification.witnessQuorum.threshold, 2);
  assert.deepEqual(directory.verification.witnessQuorum.witnessIds, ['witness_1', 'witness_2']);
  assert.equal(stalledWitnessAborted, true);
  assert.equal(apiCalls.length, 2);
  assert.equal(witnessCalls.length, 3);
  assert.ok(witnessCalls.every((call) => (
    call.url.endsWith('/v1/key-directory/observations')
      && call.init.method === 'POST'
      && call.init.credentials === 'omit'
      && call.init.referrerPolicy === 'no-referrer'
      && call.init.headers.Authorization === undefined
  )));
  const observations = witnessCalls.map((call) => JSON.parse(call.init.body));
  assert.ok(observations.every((observation) => (
    observation.snapshot.accountId === first.accountId
      && observation.snapshot.entries.length === 2
      && observation.snapshot.devices.length === 2
      && observation.snapshot.verification === undefined
      && observation.receipt.signature === witnessReceipt.signature
  )));

  witnessMode = 'oversized';
  apiCalls.length = 0;
  witnessCalls.length = 0;
  const boundedDirectory = await transport.getDirectory(first.accountId);
  assert.deepEqual(boundedDirectory.verification.witnessQuorum.witnessIds, ['witness_2', 'witness_3']);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(oversizedResponseCancelled, true);

  witnessMode = 'mismatched-checkpoint';
  apiCalls.length = 0;
  witnessCalls.length = 0;
  const minorityForkDirectory = await transport.getDirectory(first.accountId);
  assert.deepEqual(minorityForkDirectory.verification.witnessQuorum.witnessIds, ['witness_2', 'witness_3']);

  witnessMode = 'timeout';
  apiCalls.length = 0;
  witnessCalls.length = 0;
  await assert.rejects(() => transport.getDirectory(first.accountId), /directory_witness_verification/);
  assert.equal(timedOutWitnesses, 2);
});

test('opaque transport verifies a sparse directory map inside a fresh 2-of-3 C2SP checkpoint', async () => {
  const [{ ed25519 }, { sha256 }, runtime, kt, { createOpaqueChatTransport }] = await Promise.all([
    import('@noble/curves/ed25519.js'),
    import('@noble/hashes/sha2.js'),
    import('../src/mls-runtime.mjs'),
    import('../src/key-transparency.mjs'),
    import('../src/opaque-transport.mjs'),
  ]);
  const encoder = new TextEncoder();
  const random = (length) => new Uint8Array(randomBytes(length));
  const mls = runtime.createMlsRuntime({ randomBytes: random });
  const created = await mls.createDeviceIdentity({
    accountId: 'account_c2sp', deviceId: 'device_c2sp_1', platform: 'web', displayName: 'C2SP browser', capabilities: ['mls-v1'],
  });
  const digest = (value) => createHash('sha256').update(Buffer.from(value, 'base64url')).digest('hex');
  const registeredAt = '2026-08-13T12:00:00.000Z';
  const identity = {
    accountId: created.accountId,
    publicKey: created.accountIdentityPublicKey,
    keyHash: digest(created.accountIdentityPublicKey),
    createdAt: registeredAt,
  };
  const device = {
    id: created.deviceId,
    accountId: created.accountId,
    platform: created.platform,
    displayName: created.displayName,
    credential: created.credential,
    signaturePublicKey: created.signaturePublicKey,
    accountIdentitySignature: created.accountIdentitySignature,
    capabilities: created.capabilities,
    status: 'ACTIVE',
    transparencyGeneration: '1',
    activatedAt: registeredAt,
    registeredAt,
    lastSeenAt: registeredAt,
    revokedAt: null,
  };
  const payload = {
    version: 1,
    operation: 'REGISTER',
    accountId: created.accountId,
    deviceId: created.deviceId,
    platform: created.platform,
    displayName: created.displayName,
    credentialHash: digest(created.credential),
    signatureKeyHash: digest(created.signaturePublicKey),
    accountIdentityKeyHash: identity.keyHash,
    accountIdentitySignature: created.accountIdentitySignature,
    capabilities: created.capabilities,
    registeredAt,
    revokedAt: null,
    recordedAt: registeredAt,
  };
  const entryHash = createHash('sha256')
    .update(Buffer.from(JSON.stringify(['VOLNA-CHAT-KEY-DIRECTORY', 1, null, payload]), 'utf8'))
    .digest('hex');
  const entry = {
    id: '1', deviceId: created.deviceId, operation: 'DEVICE_REGISTERED', previousHash: null,
    entryHash, payload, createdAt: registeredAt,
  };
  const directoryLabel = runtime.keyDirectoryLabel(created.accountId);
  const leafValue = {
    version: 1,
    directoryLabel,
    identityFingerprint: identity.keyHash,
    entryCount: 1,
    headHash: entryHash,
    deviceIds: [created.deviceId],
  };
  const keyBytes = Buffer.from(directoryLabel, 'hex');
  let mapRoot = Buffer.from(kt.hashKeyTransparencyLeaf(directoryLabel, leafValue), 'hex');
  for (let depth = 31; depth >= 0; depth -= 1) {
    const children = Array(256).fill(Buffer.from(kt.keyTransparencyDefaultHash(depth + 1), 'hex'));
    children[keyBytes[depth]] = mapRoot;
    mapRoot = Buffer.from(sha256(Uint8Array.from([3, ...children.flatMap((child) => [...child])])));
  }
  const rootEntry = {
    tag: 'VOLNA-CHAT-KEY-TRANSPARENCY-ROOT',
    version: 1,
    generation: '1',
    root: mapRoot.toString('hex'),
    previousGeneration: null,
    previousRoot: null,
    updateCount: 1,
    createdAt: registeredAt,
  };
  const canonicalRootEntry = kt.canonicalKeyTransparencyRootEntry(rootEntry);
  const logRoot = kt.rfc6962LeafHash(encoder.encode(canonicalRootEntry));
  const makeVkey = (name, type, privateKey) => {
    const publicKey = ed25519.getPublicKey(privateKey);
    const keyId = sha256(Uint8Array.from([...encoder.encode(`${name}\n`), type, ...publicKey])).subarray(0, 4);
    return {
      name,
      id: keyId,
      vkey: `${name}+${Buffer.from(keyId).toString('hex')}+${Buffer.from(Uint8Array.from([type, ...publicKey])).toString('base64')}`,
    };
  };
  const logKey = new Uint8Array(32).fill(41);
  const witnessKeys = [42, 43, 44].map((value) => new Uint8Array(32).fill(value));
  const log = makeVkey('kt.volna.test/log', 1, logKey);
  const witnesses = witnessKeys.map((key, index) => makeVkey(`witness.test/${index + 1}`, 4, key));
  const body = `${log.name}\n1\n${Buffer.from(logRoot, 'hex').toString('base64')}\n`;
  const signatureLine = (name, id, payloadBytes) => `— ${name} ${Buffer.from(Uint8Array.from([...id, ...payloadBytes])).toString('base64')}\n`;
  const now = Math.floor(Date.now() / 1_000);
  const witnessLine = (index) => {
    const timestamp = new Uint8Array(8);
    new DataView(timestamp.buffer).setBigUint64(0, BigInt(now));
    const signature = ed25519.sign(encoder.encode(`cosignature/v1\ntime ${now}\n${body}`), witnessKeys[index]);
    return signatureLine(witnesses[index].name, witnesses[index].id, Uint8Array.from([...timestamp, ...signature]));
  };
  const checkpointNote = `${body}\n${signatureLine(log.name, log.id, ed25519.sign(encoder.encode(body), logKey))}${witnessLine(0)}${witnessLine(2)}`;
  const evidence = {
    version: 1,
    rootEntry,
    mapProof: { key: directoryLabel, value: leafValue, siblings: [], root: rootEntry.root },
    log: {
      entry: canonicalRootEntry,
      index: '0',
      treeSize: '1',
      root: logRoot,
      inclusionProof: [],
      checkpointNote,
      witnessNames: [witnesses[0].name, witnesses[2].name],
      oldestWitnessAt: new Date(now * 1_000).toISOString(),
    },
  };
  const directCheckpoint = kt.verifyC2spCheckpoint({
    note: checkpointNote,
    policy: {
      origin: log.name,
      logVkey: log.vkey,
      threshold: 2,
      maxAgeSeconds: 300,
      witnessVkeys: witnesses.map((witness) => witness.vkey),
    },
    now,
  });
  assert.equal(directCheckpoint.root, logRoot);
  assert.equal(kt.verifyRfc6962Inclusion({
    leaf: encoder.encode(canonicalRootEntry), index: '0', treeSize: '1', proof: [], root: logRoot,
  }), true);
  let currentEvidence = evidence;
  const transport = createOpaqueChatTransport({
    apiOrigin: 'https://volna.example',
    getAccessToken: () => 'token',
    fetch: async (url) => String(url).endsWith('/chats/e2ee/capabilities')
      ? response({
          protocolVersion: 1,
          ciphersuite: 'MLS_128_DHKEMX25519_CHACHA20POLY1305_SHA256_Ed25519',
          enrollmentEnabled: true,
          rolloutEnabled: false,
          deviceTransferEnabled: true,
          membershipRekeyEnabled: true,
          plaintextFallback: false,
          contentPlane: 'opaque-only-for-mls-v1',
          legacyHistoryServerReadable: true,
          keyTransparencyRequired: true,
          keyTransparencyVersion: 1,
          keyTransparencyPolicyStatus: 'configured',
          keyTransparencyActivationTargetMs: 3_000,
          directoryPaginationVersion: 1,
          directoryReceiptPublicKey: null,
        })
      : response({
          accountId: created.accountId,
          identity,
          devices: [device],
          entries: [entry],
          entryCount: 1,
          headHash: entryHash,
          nextCursor: null,
          snapshotDetailsIncluded: true,
          witnessReceipt: null,
          keyTransparencyEvidence: currentEvidence,
        }),
    keyTransparencyPolicy: {
      mode: 'c2sp-map-v1',
      origin: log.name,
      logVkey: log.vkey,
      threshold: 2,
      maxAgeSeconds: 300,
      witnessVkeys: witnesses.map((witness) => witness.vkey),
    },
  });
  const capabilities = await transport.capabilities();
  assert.equal(capabilities.enrollmentEnabled, true);
  assert.equal(capabilities.directoryReceiptPublicKey, null);
  assert.equal(capabilities.keyTransparencyPolicyStatus, 'configured');
  const directory = await transport.getDirectory(created.accountId);
  assert.equal(directory.verification.witnessQuorum.threshold, 2);
  assert.equal(directory.verification.witnessQuorum.witnessIds.length, 2);
  currentEvidence = structuredClone(evidence);
  currentEvidence.mapProof.root = 'ff'.repeat(32);
  await assert.rejects(() => transport.getDirectory(created.accountId), /directory_transparency/);
});
