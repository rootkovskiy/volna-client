'use strict';

const assert = require('node:assert/strict');
const { createHash, randomBytes } = require('node:crypto');
const test = require('node:test');

const random = (length) => new Uint8Array(randomBytes(length));
const safetyNumber = (fingerprint) => BigInt(`0x${fingerprint}`)
  .toString(10)
  .padStart(78, '0')
  .slice(0, 60)
  .match(/.{1,5}/g)
  .join(' ');

function memoryMessageStore(initial = {}) {
  let threads = JSON.parse(JSON.stringify(initial));
  const saves = [];
  return {
    loadAllThreads: async () => JSON.parse(JSON.stringify(threads)),
    saveAllThreads: async (value, changes) => {
      const changed = JSON.stringify(threads) !== JSON.stringify(value);
      threads = JSON.parse(JSON.stringify(value));
      saves.push(changes === undefined ? undefined : JSON.parse(JSON.stringify(changes)));
      return { changed, revision: 1 };
    },
    clear: async () => { threads = {}; },
    destroyMemory: () => undefined,
    snapshot: () => JSON.parse(JSON.stringify(threads)),
    saves,
  };
}

test('secure client registers, persists, and restores without server-held recovery material', async () => {
  const [{ createMlsRuntime, keyDirectoryLabel }, { createSecureMessagingClient }] = await Promise.all([
    import('../src/mls-runtime.mjs'),
    import('../src/secure-messaging-client.mjs'),
  ]);
  const wrappingKey = random(32);
  let encryptedState = null;
  let available = 0;
  let registeredIdentity = null;
  const messageStore = memoryMessageStore();
  const storage = {
    wrappingKeyId: 'device-state-v1',
    randomBytes: random,
    wrappingKeyProvider: { getKey: () => wrappingKey.slice() },
    messageStore,
    loadEncryptedState: async () => encryptedState,
    saveEncryptedState: async (value) => { encryptedState = value; },
    clear: async () => { encryptedState = null; },
    destroyMemoryKey: () => undefined,
  };
  const transport = {
    capabilities: async () => ({ enrollmentEnabled: true, rolloutEnabled: false }),
    listOwnDevices: async () => ({ identity: registeredIdentity, devices: [] }),
    createDeviceChallenge: async () => ({ challengeId: 'challenge_0001', challenge: 'AQIDBA', expiresAt: '2026-08-03T13:00:00.000Z' }),
    registerDevice: async (input) => {
      registeredIdentity = {
        accountId: 'account_alice',
        publicKey: input.accountIdentityPublicKey,
        keyHash: createHash('sha256')
          .update(Buffer.from(input.accountIdentityPublicKey, 'base64url'))
          .digest('hex'),
      };
      return {
        identity: registeredIdentity,
        device: { id: input.deviceId },
      };
    },
    getDirectory: async () => ({
      identity: registeredIdentity,
      devices: [{ id: 'device_alice', status: 'ACTIVE' }],
      verification: {
        accountId: 'account_alice',
        identityFingerprint: registeredIdentity.keyHash,
        safetyNumber: safetyNumber(registeredIdentity.keyHash),
        headHash: null,
        entryHashes: [],
        witnessQuorum: {
          checkpoint: {
            version: 1,
            directoryLabel: keyDirectoryLabel('account_alice'),
            identityFingerprint: registeredIdentity.keyHash,
            entryCount: 0,
            headHash: null,
          },
          threshold: 2,
          witnessIds: ['witness_1', 'witness_2'],
          oldestObservedAt: new Date().toISOString(),
        },
      },
    }),
    keyPackageStatus: async () => ({ deviceId: 'device_alice', available, target: 3, maximum: 100, oldestExpiresAt: null }),
    uploadKeyPackages: async (_deviceId, packages) => { available += packages.length; },
    sendEnvelope: async () => { throw new Error('not used'); },
  };
  const runtime = createMlsRuntime({ randomBytes: random, wrappingKeyProvider: storage.wrappingKeyProvider });
  const client = createSecureMessagingClient({
    accountId: 'account_alice',
    deviceId: 'device_alice',
    platform: 'web',
    displayName: 'Alice browser',
    runtime,
    transport,
    storage,
  });
  const setup = await client.setupDevice();
  assert.equal(setup.status, 'ready');
  assert.equal(typeof setup.recoverySecret, 'string');
  assert.equal(available, 3);
  assert.equal(encryptedState.includes(setup.recoverySecret), false);

  const restoredRuntime = createMlsRuntime({ randomBytes: random, wrappingKeyProvider: storage.wrappingKeyProvider });
  const restored = createSecureMessagingClient({
    accountId: 'account_alice',
    deviceId: 'device_alice',
    platform: 'web',
    displayName: 'Alice browser',
    runtime: restoredRuntime,
    transport,
    storage,
  });
  const result = await restored.restore();
  assert.equal(result.status, 'ready');
  assert.equal(result.identity.accountId, 'account_alice');
});

test('secure client migrates projections out of MLS state and searches decrypted history only on the endpoint', async () => {
  const { createSecureMessagingClient } = await import('../src/secure-messaging-client.mjs');
  const storedMessages = memoryMessageStore();
  const messageRecord = {
    envelopeId: 'envelope_search_1',
    senderAccountId: 'account_bobby',
    senderDeviceId: 'device_bobby',
    serverCreatedAt: '2026-08-07T12:00:00.000Z',
    event: {
      v: 1,
      kind: 'message.create',
      logicalMessageId: 'message_search_1',
      clientCreatedAt: '2026-08-07T11:59:59.000Z',
      text: 'Секретная встреча у музея',
    },
  };
  const legacyApplicationState = {
    v: 1,
    deviceRegistered: true,
    threads: {
      thread_secure_1: {
        records: [messageRecord],
        processedEnvelopeIds: ['envelope_search_1'],
        rejectedEnvelopeIds: [],
        envelopeCursor: 'cursor_search_1',
      },
    },
    pendingActivations: {},
    pendingRekeys: {},
    pendingOutbox: {},
    incomingTransfer: null,
    outgoingTransfers: {},
  };
  let persistedRuntimeState = null;
  let savedEncryptedState = null;
  const runtime = {
    importEncryptedState: async () => undefined,
    getIdentityStatus: () => ({ status: 'ready' }),
    getIdentitySummary: () => ({
      accountId: 'account_alice',
      deviceId: 'device_alice',
      accountIdentityPublicKey: 'identity_alice',
    }),
    getApplicationState: () => JSON.parse(JSON.stringify(legacyApplicationState)),
    setApplicationState: (value) => { persistedRuntimeState = JSON.parse(JSON.stringify(value)); },
    exportEncryptedState: async () => JSON.stringify(persistedRuntimeState),
    pinDirectoryVerification: () => ({ advanced: false }),
    destroy: () => undefined,
  };
  let networkCalls = 0;
  const client = createSecureMessagingClient({
    accountId: 'account_alice',
    deviceId: 'device_alice',
    platform: 'web',
    displayName: 'Alice browser',
    runtime,
    transport: {
      capabilities: async () => ({ enrollmentEnabled: false, rolloutEnabled: false, membershipRekeyEnabled: false }),
      getDirectory: async () => {
        networkCalls += 1;
        return {
          identity: { publicKey: 'identity_alice' },
          devices: [{ id: 'device_alice', status: 'ACTIVE' }],
          verification: {},
        };
      },
    },
    storage: {
      wrappingKeyId: 'device-state-v1',
      randomBytes: random,
      messageStore: storedMessages,
      loadEncryptedState: async () => 'legacy-encrypted-state',
      saveEncryptedState: async (value) => { savedEncryptedState = value; },
    },
  });

  assert.equal((await client.restore()).status, 'ready');
  assert.deepEqual(storedMessages.snapshot(), { thread_secure_1: [messageRecord] });
  assert.deepEqual(persistedRuntimeState.threads.thread_secure_1.records, []);
  assert.equal(savedEncryptedState.includes('Секретная встреча'), false);
  const callsBeforeSearch = networkCalls;
  const matches = client.searchMessages('ВСТРЕЧА');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].threadId, 'thread_secure_1');
  assert.equal(matches[0].message.text, 'Секретная встреча у музея');
  assert.equal(networkCalls, callsBeforeSearch);
});

test('secure client checkpoints forward pages and quarantines colliding content events', async () => {
  const { createSecureMessagingClient } = await import('../src/secure-messaging-client.mjs');
  const stored = [];
  const pageMessageStore = memoryMessageStore();
  const pages = new Map([
    [undefined, {
      items: [{
        id: 'envelope_remote_1',
        threadId: 'thread_secure_1',
        senderId: 'account_bobby',
        senderDeviceId: 'device_bobby',
        clientEnvelopeId: 'client_remote_01',
        kind: 'APPLICATION',
        epoch: '1',
        ciphertext: 'AQID',
        createdAt: '2026-08-03T12:00:00.000Z',
      }],
      nextCursor: 'cursor_page_0001',
      checkpointCursor: 'cursor_page_0001',
    }],
    ['cursor_page_0001', {
      items: [{
        id: 'envelope_remote_2',
        threadId: 'thread_secure_1',
        senderId: 'account_bobby',
        senderDeviceId: 'device_bobby',
        clientEnvelopeId: 'client_remote_02',
        kind: 'APPLICATION',
        epoch: '1',
        ciphertext: 'BAUG',
        createdAt: '2026-08-03T12:01:00.000Z',
      }],
      nextCursor: null,
      checkpointCursor: 'cursor_page_0002',
    }],
  ]);
  let processCount = 0;
  let extraDevice = false;
  let appState = null;
  const runtime = {
    importEncryptedState: async () => undefined,
    getIdentitySummary: () => ({
      accountId: 'account_alice',
      deviceId: 'device_alice',
      accountIdentityPublicKey: 'identity_alice',
    }),
    getApplicationState: () => appState,
    setApplicationState: (value) => { appState = value; },
    exportEncryptedState: async () => JSON.stringify(appState),
    getGroupState: () => ({
      groupId: 'group_secure_1',
      epoch: '1',
      members: [
        { accountId: 'account_alice', deviceId: 'device_alice' },
        { accountId: 'account_bobby', deviceId: 'device_bobby' },
      ],
    }),
    process: async () => {
      processCount += 1;
      return {
        stateChanged: true,
        sender: { accountId: 'account_bobby', deviceId: 'device_bobby' },
        event: {
          v: 1,
          kind: 'message.create',
          logicalMessageId: 'message_remote_1',
          clientCreatedAt: '2026-08-03T12:00:00.000Z',
          text: processCount === 1 ? 'first' : 'collision',
        },
      };
    },
    createKeyPackages: async () => [],
    pinDirectoryVerification: () => ({ advanced: false }),
    destroy: () => undefined,
  };
  const storage = {
    wrappingKeyId: 'device-state-v1',
    randomBytes: random,
    messageStore: pageMessageStore,
    loadEncryptedState: async () => 'encrypted',
    saveEncryptedState: async (value) => { stored.push(value); },
    clear: async () => undefined,
  };
  const transport = {
    capabilities: async () => ({ enrollmentEnabled: true, rolloutEnabled: true }),
    getDirectory: async (accountId) => {
      const devices = [{
        id: accountId === 'account_alice' ? 'device_alice' : 'device_bobby',
        accountId,
        status: 'ACTIVE',
      }];
      if (extraDevice && accountId === 'account_bobby') {
        devices.push({ id: 'device_bobby_2', accountId, status: 'ACTIVE' });
      }
      return {
        identity: { publicKey: accountId === 'account_alice' ? 'identity_alice' : 'identity_bobby' },
        devices,
        verification: {},
      };
    },
    keyPackageStatus: async () => ({ deviceId: 'device_alice', available: 3, target: 3, maximum: 100 }),
    listPendingWelcomes: async () => [],
    getThreadState: async () => ({
      encryptionMode: 'MLS_V1',
      groupId: 'group_secure_1',
      epoch: '1',
      identities: [
        { accountId: 'account_alice', publicKey: 'identity_alice' },
        { accountId: 'account_bobby', publicKey: 'identity_bobby' },
      ],
      devices: [
        { id: 'device_alice', accountId: 'account_alice', status: 'ACTIVE', isMember: true, removedAt: null },
        { id: 'device_bobby', accountId: 'account_bobby', status: 'ACTIVE', isMember: true, removedAt: null },
        ...(extraDevice
          ? [{ id: 'device_bobby_2', accountId: 'account_bobby', status: 'ACTIVE', isMember: false, removedAt: null }]
          : []),
      ],
    }),
    listEnvelopes: async (_threadId, _deviceId, cursor) => pages.get(cursor),
  };
  appState = {
    v: 1,
    deviceRegistered: true,
    threads: {},
    pendingActivations: {},
    pendingOutbox: {},
  };
  const client = createSecureMessagingClient({
    accountId: 'account_alice',
    deviceId: 'device_alice',
    platform: 'web',
    displayName: 'Alice browser',
    runtime,
    transport,
    storage,
  });
  await client.restore();
  const messages = await client.syncThread('thread_secure_1');
  assert.equal(messages.length, 1);
  assert.equal(messages[0].text, 'first');
  assert.equal(processCount, 2);
  assert.equal(stored.length >= 2, true);
  assert.ok(pageMessageStore.saves.some((changes) => (
    changes?.changedThreadIds?.includes('thread_secure_1')
    && changes?.appendOnlyThreadIds?.includes('thread_secure_1')
  )));
  assert.deepEqual(appState.threads.thread_secure_1.rejectedEnvelopeIds, ['envelope_remote_2']);
  assert.equal(appState.threads.thread_secure_1.envelopeCursor, 'cursor_page_0002');
  extraDevice = true;
  await assert.rejects(() => client.syncThread('thread_secure_1'), /thread_rekey_required/);
});

test('device history transfer retries the exact encrypted chunk after a crash', async () => {
  const [{ createDeviceTransferTarget }, { createSecureMessagingClient }] = await Promise.all([
    import('../src/device-transfer.mjs'),
    import('../src/secure-messaging-client.mjs'),
  ]);
  const targetDraft = {
    accountId: 'account_alice',
    deviceId: 'device_target',
    platform: 'web',
    displayName: 'Target browser',
    credential: 'AQID',
    signaturePublicKey: 'BAUG',
    accountIdentityPublicKey: 'BwgJ',
    capabilities: ['mls-v1', 'transfer-v1'],
  };
  const target = createDeviceTransferTarget({ randomBytes: random, targetDeviceDraft: targetDraft });
  const transferId = 'transfer_crash_1';
  const qrPayload = target.bindSession(transferId).qrPayload;
  const session = {
    id: transferId,
    accountId: 'account_alice',
    ...target.createSessionInput(),
    sourceDeviceId: null,
    sourceEphemeralPublicKey: null,
    status: 'PENDING',
  };
  target.destroy();

  let savedState = null;
  let uploadedChunk = null;
  let failAfterFirstUpload = true;
  const makeRuntime = () => {
    let runtimeState = null;
    return {
      authorizeTransferredDevice: (draft) => ({
        v: 1,
        targetDeviceId: draft.deviceId,
        sourceDeviceId: 'device_source',
        recoverySecret: 'recovery_secret_only_inside_ciphertext',
        accountIdentitySignature: 'account_signature_only_inside_ciphertext',
      }),
      setApplicationState: (value) => { runtimeState = JSON.parse(JSON.stringify(value)); },
      exportEncryptedState: async () => JSON.stringify(runtimeState),
      destroy: () => undefined,
    };
  };
  const storage = {
    wrappingKeyId: 'device-state-v1',
    randomBytes: random,
    messageStore: memoryMessageStore(),
    saveEncryptedState: async (encoded) => {
      const candidate = JSON.parse(encoded);
      const transfer = candidate.outgoingTransfers[transferId];
      if (failAfterFirstUpload && uploadedChunk !== null && transfer?.nextSequence === 1) {
        failAfterFirstUpload = false;
        throw new Error('simulated crash after upload');
      }
      savedState = encoded;
    },
  };
  const transport = {
    capabilities: async () => ({ deviceTransferEnabled: true }),
    getDeviceTransfer: async () => session,
    connectDeviceTransferSource: async (_id, input) => ({
      ...session,
      sourceDeviceId: input.sourceDeviceId,
      sourceEphemeralPublicKey: input.sourceEphemeralPublicKey,
    }),
    uploadDeviceTransferChunk: async (_id, input) => {
      if (uploadedChunk === null) uploadedChunk = JSON.parse(JSON.stringify(input));
      else assert.deepEqual(input, uploadedChunk);
      return { created: uploadedChunk === null };
    },
    approveDeviceTransfer: async () => ({ ...session, status: 'APPROVED' }),
  };
  const initialState = {
    v: 1,
    deviceRegistered: true,
    threads: {
      thread_secure_1: {
        records: [{
          envelopeId: 'envelope_before_crash',
          senderAccountId: 'account_alice',
          senderDeviceId: 'device_source',
          serverCreatedAt: '2026-08-03T12:00:00.000Z',
          event: {
            v: 1,
            kind: 'message.create',
            logicalMessageId: 'message_before_crash',
            clientCreatedAt: '2026-08-03T12:00:00.000Z',
            text: 'history before transfer',
          },
        }],
        processedEnvelopeIds: ['envelope_before_crash'],
        rejectedEnvelopeIds: [],
        envelopeCursor: null,
      },
    },
    pendingActivations: {},
    pendingRekeys: {},
    pendingOutbox: {},
    incomingTransfer: null,
    outgoingTransfers: {},
  };
  const first = createSecureMessagingClient({
    accountId: 'account_alice',
    deviceId: 'device_source',
    platform: 'web',
    displayName: 'Source browser',
    runtime: makeRuntime(),
    transport,
    storage,
  });
  first.ready = true;
  first.applicationState = initialState;
  const started = await first.startOutgoingDeviceTransfer(qrPayload);
  await assert.rejects(
    () => first.approveOutgoingDeviceTransfer(started.transferId),
    /state_persist_failed/,
  );
  assert.notEqual(savedState, null);
  assert.notEqual(uploadedChunk, null);

  const second = createSecureMessagingClient({
    accountId: 'account_alice',
    deviceId: 'device_source',
    platform: 'web',
    displayName: 'Source browser',
    runtime: makeRuntime(),
    transport,
    storage,
  });
  second.ready = true;
  second.applicationState = JSON.parse(savedState);
  second.applicationState.threads.thread_secure_1.records = storage.messageStore.snapshot().thread_secure_1;
  second.applicationState.threads.thread_secure_1.records.push({
    envelopeId: 'envelope_after_crash',
    senderAccountId: 'account_alice',
    senderDeviceId: 'device_source',
    serverCreatedAt: '2026-08-03T12:01:00.000Z',
    event: {
      v: 1,
      kind: 'message.create',
      logicalMessageId: 'message_after_crash',
      clientCreatedAt: '2026-08-03T12:01:00.000Z',
      text: 'newer message is outside the frozen transfer snapshot',
    },
  });
  const resumed = await second.approveOutgoingDeviceTransfer(transferId);
  assert.equal(resumed.status, 'waiting-target-registration');
  assert.equal(second.applicationState.outgoingTransfers[transferId].nextSequence, 1);
  assert.equal(second.applicationState.outgoingTransfers[transferId].inFlightChunk, null);
});

test('expired initial activation is replaced without retaining old projection or ciphertext outbox', async () => {
  const { createSecureMessagingClient } = await import('../src/secure-messaging-client.mjs');
  let appState = {
    v: 1,
    deviceRegistered: true,
    threads: {
      thread_recovery_1: {
        records: [{ envelopeId: 'envelope_old_1' }],
        processedEnvelopeIds: ['envelope_old_1'],
        rejectedEnvelopeIds: [],
        envelopeCursor: null,
      },
    },
    pendingActivations: {},
    pendingRekeys: {},
    pendingOutbox: {
      envelope_pending_1: {
        threadId: 'thread_recovery_1',
        body: { epoch: '1', ciphertext: 'old-group-ciphertext' },
        event: { kind: 'message.create' },
      },
      envelope_other_1: {
        threadId: 'thread_unrelated_1',
        body: { epoch: '4', ciphertext: 'unrelated-ciphertext' },
        event: { kind: 'message.create' },
      },
    },
    incomingTransfer: null,
    outgoingTransfers: {},
  };
  let localGroup = { groupId: 'group_expired_1', epoch: '1', members: [] };
  let recoveryBody = null;
  const runtime = {
    getGroupState: () => localGroup,
    replaceInitialGroup: async (input) => {
      assert.equal(input.previousGroupId, 'group_expired_1');
      localGroup = { groupId: 'group_replaced_1', epoch: '1', members: [] };
      return {
        protocolVersion: 1,
        groupId: localGroup.groupId,
        epoch: '1',
        claimIds: ['keypackage_bobby_1'],
        welcomes: [{ recipientDeviceId: 'device_bobby', payload: 'replacement-welcome' }],
      };
    },
    abortPreparedRekey: () => false,
    setApplicationState: (value) => { appState = JSON.parse(JSON.stringify(value)); },
    exportEncryptedState: async () => JSON.stringify(appState),
    destroy: () => undefined,
  };
  const recoveredState = {
    threadId: 'thread_recovery_1',
    encryptionMode: 'MLS_V1',
    groupId: 'group_replaced_1',
    epoch: '1',
    ready: false,
    initialActivationRecoveryAllowed: false,
    plaintextFallback: false,
  };
  const transport = {
    claimKeyPackages: async () => ({
      claims: [{
        claimId: 'keypackage_bobby_1',
        recipientAccountId: 'account_bobby',
        recipientDeviceId: 'device_bobby',
      }],
    }),
    recoverThreadActivation: async (_threadId, body) => {
      recoveryBody = body;
      return recoveredState;
    },
  };
  const client = createSecureMessagingClient({
    accountId: 'account_alice',
    deviceId: 'device_alice',
    platform: 'web',
    displayName: 'Alice browser',
    runtime,
    transport,
    storage: {
      wrappingKeyId: 'device-state-v1',
      randomBytes: random,
      messageStore: memoryMessageStore(),
      saveEncryptedState: async () => undefined,
    },
  });
  client.ready = true;
  client.applicationState = appState;
  client.verifyThreadDirectoryState = async () => ({
    activeDevices: [
      { id: 'device_alice', accountId: 'account_alice' },
      { id: 'device_bobby', accountId: 'account_bobby' },
    ],
    devicesById: new Map([
      ['device_alice', { id: 'device_alice', accountId: 'account_alice' }],
      ['device_bobby', { id: 'device_bobby', accountId: 'account_bobby' }],
    ]),
  });

  const result = await client.recoverExpiredActivation('thread_recovery_1', {
    ...recoveredState,
    groupId: 'group_expired_1',
    initialActivationRecoveryAllowed: true,
  });
  assert.equal(result.groupId, 'group_replaced_1');
  assert.equal(recoveryBody.previousGroupId, 'group_expired_1');
  assert.equal(recoveryBody.groupId, 'group_replaced_1');
  assert.equal(appState.threads.thread_recovery_1, undefined);
  assert.equal(appState.pendingOutbox.envelope_pending_1, undefined);
  assert.notEqual(appState.pendingOutbox.envelope_other_1, undefined);
  assert.equal(appState.pendingActivations.thread_recovery_1, undefined);
});

test('stale pre-server activation is abandoned and recreated from fresh key packages', async () => {
  const { createSecureMessagingClient } = await import('../src/secure-messaging-client.mjs');
  let appState = {
    v: 1,
    deviceRegistered: true,
    threads: {},
    pendingActivations: {
      thread_stale_activation: {
        protocolVersion: 1,
        groupId: 'group_stale_1',
        epoch: '1',
        senderDeviceId: 'device_alice',
        claimIds: ['keypackage_stale_1'],
        welcomes: [{ recipientDeviceId: 'device_bobby', payload: 'stale-welcome' }],
      },
    },
    pendingRekeys: {},
    pendingOutbox: {},
    incomingTransfer: null,
    outgoingTransfers: {},
  };
  let localGroup = { groupId: 'group_stale_1', epoch: '1', members: [] };
  let abandoned = null;
  let activationAttempts = 0;
  const runtime = {
    abandonInitialGroup: (_threadId, groupId) => {
      abandoned = groupId;
      localGroup = null;
      return true;
    },
    createGroup: async () => {
      localGroup = { groupId: 'group_fresh_1', epoch: '1', members: [] };
      return {
        protocolVersion: 1,
        groupId: localGroup.groupId,
        epoch: '1',
        claimIds: ['keypackage_fresh_1'],
        welcomes: [{ recipientDeviceId: 'device_bobby', payload: 'fresh-welcome' }],
      };
    },
    setApplicationState: (value) => { appState = JSON.parse(JSON.stringify(value)); },
    exportEncryptedState: async () => JSON.stringify(appState),
    destroy: () => undefined,
  };
  const legacyState = {
    threadId: 'thread_stale_activation',
    encryptionMode: 'LEGACY_PLAINTEXT',
    groupId: null,
    epoch: '0',
    ready: false,
    initialActivationRecoveryAllowed: false,
    plaintextFallback: false,
  };
  const transport = {
    capabilities: async () => ({ rolloutEnabled: true }),
    getThreadState: async () => legacyState,
    claimKeyPackages: async () => ({
      claims: [{
        claimId: 'keypackage_fresh_1',
        recipientAccountId: 'account_bobby',
        recipientDeviceId: 'device_bobby',
      }],
    }),
    activateThread: async (_threadId, body) => {
      activationAttempts += 1;
      if (activationAttempts === 1) {
        const conflict = new Error('expired key-package reservation');
        conflict.status = 409;
        throw conflict;
      }
      return {
        ...legacyState,
        encryptionMode: 'MLS_V1',
        groupId: body.groupId,
        epoch: body.epoch,
      };
    },
  };
  const client = createSecureMessagingClient({
    accountId: 'account_alice',
    deviceId: 'device_alice',
    platform: 'web',
    displayName: 'Alice browser',
    runtime,
    transport,
    storage: {
      wrappingKeyId: 'device-state-v1',
      randomBytes: random,
      messageStore: memoryMessageStore(),
      saveEncryptedState: async () => undefined,
    },
  });
  client.ready = true;
  client.applicationState = appState;
  client.verifyThreadDirectoryState = async () => ({
    activeDevices: [
      { id: 'device_alice', accountId: 'account_alice' },
      { id: 'device_bobby', accountId: 'account_bobby' },
    ],
    devicesById: new Map([
      ['device_alice', { id: 'device_alice', accountId: 'account_alice' }],
      ['device_bobby', { id: 'device_bobby', accountId: 'account_bobby' }],
    ]),
  });

  const result = await client.activateThread('thread_stale_activation');
  assert.equal(result.groupId, 'group_fresh_1');
  assert.equal(abandoned, 'group_stale_1');
  assert.equal(activationAttempts, 2);
  assert.equal(appState.pendingActivations.thread_stale_activation, undefined);
});

test('replacement Welcome must name the exact local initial group it supersedes', async () => {
  const { createSecureMessagingClient } = await import('../src/secure-messaging-client.mjs');
  let appState = {
    v: 1,
    deviceRegistered: true,
    threads: { thread_welcome_replace: { records: [], processedEnvelopeIds: [], rejectedEnvelopeIds: [], envelopeCursor: null } },
    pendingActivations: {},
    pendingRekeys: {},
    pendingOutbox: {},
    incomingTransfer: null,
    outgoingTransfers: {},
  };
  let localGroup = { groupId: 'group_original_1', epoch: '1', members: [] };
  let replaced = false;
  let acknowledged = false;
  const runtime = {
    getGroupState: () => localGroup,
    replaceInitialGroupFromWelcome: async (input) => {
      assert.equal(input.previousGroupId, 'group_original_1');
      localGroup = { groupId: input.groupId, epoch: input.epoch, members: [] };
      replaced = true;
    },
    joinGroup: async () => undefined,
    setApplicationState: (value) => { appState = JSON.parse(JSON.stringify(value)); },
    exportEncryptedState: async () => JSON.stringify(appState),
    destroy: () => undefined,
  };
  const state = {
    threadId: 'thread_welcome_replace',
    encryptionMode: 'MLS_V1',
    groupId: 'group_replacement_1',
    epoch: '1',
    ready: false,
    initialActivationRecoveryAllowed: false,
    rekeyRequired: false,
    devices: [
      { id: 'device_alice', isMember: true, removedAt: null },
      { id: 'device_bobby', isMember: true, removedAt: null },
    ],
  };
  const transport = {
    listPendingWelcomes: async () => acknowledged ? [] : [{
      id: 'welcome_replace_1',
      threadId: state.threadId,
      groupId: state.groupId,
      epoch: '1',
      payload: 'replacement-welcome',
      replacesGroupId: 'group_original_1',
      rekeyOperationId: null,
      rosterHash: null,
      commitEnvelopeId: null,
    }],
    getThreadState: async () => state,
    acknowledgeWelcome: async () => { acknowledged = true; },
  };
  const client = createSecureMessagingClient({
    accountId: 'account_alice',
    deviceId: 'device_alice',
    platform: 'web',
    displayName: 'Alice browser',
    runtime,
    transport,
    storage: {
      wrappingKeyId: 'device-state-v1',
      randomBytes: random,
      messageStore: memoryMessageStore(),
      saveEncryptedState: async () => undefined,
    },
  });
  client.ready = true;
  client.applicationState = appState;
  client.verifyThreadDirectoryState = async () => ({
    activeDevices: [{ id: 'device_alice' }, { id: 'device_bobby' }],
    rosterHash: null,
  });

  assert.deepEqual(await client.joinPendingWelcomes(), ['thread_welcome_replace']);
  assert.equal(replaced, true);
  assert.equal(acknowledged, true);
  assert.equal(appState.threads.thread_welcome_replace, undefined);
});

test('a corrupt expired initial Welcome triggers a fresh MLS activation instead of stranding the chat', async () => {
  const { createSecureMessagingClient } = await import('../src/secure-messaging-client.mjs');
  let appState = {
    v: 1,
    deviceRegistered: true,
    threads: {},
    pendingActivations: {},
    pendingRekeys: {},
    pendingOutbox: {},
    incomingTransfer: null,
    outgoingTransfers: {},
  };
  let localGroup = null;
  let recovered = false;
  let acknowledgedCorruptWelcome = false;
  const missingGroup = () => {
    const error = new Error('missing group');
    error.code = 'group_missing';
    throw error;
  };
  const runtime = {
    getGroupState: () => localGroup ?? missingGroup(),
    joinGroup: async () => { throw new Error('corrupt Welcome'); },
    createGroup: async () => {
      localGroup = { groupId: 'group_after_corrupt_1', epoch: '1', members: [] };
      return {
        protocolVersion: 1,
        groupId: localGroup.groupId,
        epoch: '1',
        claimIds: ['keypackage_bobby_2'],
        welcomes: [{ recipientDeviceId: 'device_bobby', payload: 'fresh-welcome' }],
      };
    },
    abortPreparedRekey: () => false,
    setApplicationState: (value) => { appState = JSON.parse(JSON.stringify(value)); },
    exportEncryptedState: async () => JSON.stringify(appState),
    destroy: () => undefined,
  };
  const expiredState = {
    threadId: 'thread_corrupt_welcome',
    encryptionMode: 'MLS_V1',
    groupId: 'group_corrupt_old_1',
    epoch: '1',
    ready: false,
    initialActivationRecoveryAllowed: true,
    rekeyRequired: false,
    plaintextFallback: false,
    devices: [
      { id: 'device_alice', isMember: true, removedAt: null },
      { id: 'device_bobby', isMember: true, removedAt: null },
    ],
  };
  const transport = {
    listPendingWelcomes: async () => [{
      id: 'welcome_corrupt_1',
      threadId: expiredState.threadId,
      groupId: expiredState.groupId,
      epoch: '1',
      payload: 'corrupt-welcome',
      replacesGroupId: null,
      rekeyOperationId: null,
      rosterHash: null,
      commitEnvelopeId: null,
    }],
    getThreadState: async () => expiredState,
    claimKeyPackages: async () => ({
      claims: [{
        claimId: 'keypackage_bobby_2',
        recipientAccountId: 'account_bobby',
        recipientDeviceId: 'device_bobby',
      }],
    }),
    recoverThreadActivation: async (_threadId, body) => {
      recovered = true;
      return {
        ...expiredState,
        groupId: body.groupId,
        initialActivationRecoveryAllowed: false,
      };
    },
    acknowledgeWelcome: async () => { acknowledgedCorruptWelcome = true; },
  };
  const client = createSecureMessagingClient({
    accountId: 'account_alice',
    deviceId: 'device_alice',
    platform: 'web',
    displayName: 'Alice browser',
    runtime,
    transport,
    storage: {
      wrappingKeyId: 'device-state-v1',
      randomBytes: random,
      messageStore: memoryMessageStore(),
      saveEncryptedState: async () => undefined,
    },
  });
  client.ready = true;
  client.applicationState = appState;
  client.verifyThreadDirectoryState = async () => ({
    activeDevices: [
      { id: 'device_alice', accountId: 'account_alice' },
      { id: 'device_bobby', accountId: 'account_bobby' },
    ],
    devicesById: new Map([
      ['device_alice', { id: 'device_alice', accountId: 'account_alice' }],
      ['device_bobby', { id: 'device_bobby', accountId: 'account_bobby' }],
    ]),
    rosterHash: null,
  });

  assert.deepEqual(await client.joinPendingWelcomes(), ['thread_corrupt_welcome']);
  assert.equal(recovered, true);
  assert.equal(localGroup.groupId, 'group_after_corrupt_1');
  assert.equal(acknowledgedCorruptWelcome, false);
});
