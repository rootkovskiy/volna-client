'use strict';

const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const test = require('node:test');
const contract = require('../src');

const random = (length) => new Uint8Array(randomBytes(length));

function directoryRecord(identity) {
  return {
    accountId: identity.accountId,
    deviceId: identity.deviceId,
    platform: identity.platform,
    displayName: identity.displayName,
    capabilities: identity.capabilities,
    credential: identity.credential,
    signaturePublicKey: identity.signaturePublicKey,
    accountIdentityPublicKey: identity.accountIdentityPublicKey,
    accountIdentitySignature: identity.accountIdentitySignature,
  };
}

async function withWitnessQuorum(verification) {
  const { ed25519 } = await import('@noble/curves/ed25519.js');
  const {
    bytesToBase64Url,
    canonicalKeyDirectoryWitnessStatement,
    keyDirectoryLabel,
    verifyKeyDirectoryWitnessQuorum,
  } = await import('../src/mls-runtime.mjs');
  const privateKeys = [new Uint8Array(32).fill(11), new Uint8Array(32).fill(12)];
  const policy = {
    threshold: 2,
    maxStatementAgeMs: 60_000,
    witnesses: privateKeys.map((privateKey, index) => ({
      id: `witness_${index + 1}`,
      publicKey: bytesToBase64Url(ed25519.getPublicKey(privateKey)),
    })),
  };
  const checkpoint = {
    version: 1,
    directoryLabel: keyDirectoryLabel(verification.accountId),
    identityFingerprint: verification.identityFingerprint,
    entryCount: verification.entryHashes.length,
    headHash: verification.headHash,
  };
  const observedAt = new Date().toISOString();
  const statements = policy.witnesses.map((witness, index) => {
    const unsigned = { version: 1, witnessId: witness.id, checkpoint, observedAt };
    return {
      ...unsigned,
      signature: bytesToBase64Url(ed25519.sign(
        canonicalKeyDirectoryWitnessStatement(unsigned),
        privateKeys[index],
      )),
    };
  });
  return {
    ...verification,
    witnessQuorum: verifyKeyDirectoryWitnessQuorum({
      accountId: verification.accountId,
      identityFingerprint: verification.identityFingerprint,
      entryCount: verification.entryHashes.length,
      headHash: verification.headHash,
      statements,
      policy,
    }),
  };
}

test('MLS runtime creates a verified two-device group and exchanges opaque messages', async () => {
  const { createMlsRuntime } = await import('../src/mls-runtime.mjs');
  const wrappingKey = random(32);
  const options = {
    randomBytes: random,
    wrappingKeyProvider: { getKey: () => wrappingKey.slice() },
  };
  const alice = createMlsRuntime(options);
  const bob = createMlsRuntime(options);
  const aliceIdentity = await alice.createDeviceIdentity({
    accountId: 'account_alice',
    deviceId: 'device_alice',
    platform: 'web',
    displayName: 'Alice browser',
    capabilities: ['mls-v1'],
  });
  const bobIdentity = await bob.createDeviceIdentity({
    accountId: 'account_bobby',
    deviceId: 'device_bobby',
    platform: 'android',
    displayName: 'Bob phone',
    capabilities: ['mls-v1'],
  });
  const [bobKeyPackage] = await bob.createKeyPackages(1);
  const activation = await alice.createGroup({
    threadId: 'thread_secure_1',
    claims: [{
      claimId: 'claim_bobby_1',
      recipientAccountId: bobIdentity.accountId,
      recipientDeviceId: bobIdentity.deviceId,
      platform: bobIdentity.platform,
      displayName: bobIdentity.displayName,
      capabilities: bobIdentity.capabilities,
      credential: bobIdentity.credential,
      signaturePublicKey: bobIdentity.signaturePublicKey,
      accountIdentityPublicKey: bobIdentity.accountIdentityPublicKey,
      accountIdentitySignature: bobIdentity.accountIdentitySignature,
      keyPackage: bobKeyPackage,
    }],
  });
  await bob.joinGroup({
    threadId: 'thread_secure_1',
    groupId: activation.groupId,
    welcome: activation.welcomes[0].payload,
    members: [directoryRecord(aliceIdentity), directoryRecord(bobIdentity)],
  });

  const aad = contract.canonicalEnvelopeAad({
    protocolVersion: 1,
    threadId: 'thread_secure_1',
    senderAccountId: 'account_alice',
    senderDeviceId: 'device_alice',
    clientEnvelopeId: 'envelope_alice_1',
    kind: 'APPLICATION',
    epoch: '1',
  });
  const encrypted = await alice.encrypt({
    threadId: 'thread_secure_1',
    aad,
    event: {
      v: 1,
      kind: 'message.create',
      logicalMessageId: 'message_alice_1',
      clientCreatedAt: '2026-08-03T12:00:00.000Z',
      text: 'секрет',
    },
  });
  assert.equal(encrypted.epoch, '1');
  assert.equal(encrypted.ciphertext.includes('секрет'), false);
  const received = await bob.process({
    threadId: 'thread_secure_1',
    aad,
    epoch: '1',
    ciphertext: encrypted.ciphertext,
  });
  assert.equal(received.event.text, 'секрет');

  await assert.rejects(
    bob.process({
      threadId: 'thread_secure_1',
      aad,
      epoch: '1',
      ciphertext: encrypted.ciphertext,
    }),
  );
  const secondAad = contract.canonicalEnvelopeAad({
    protocolVersion: 1,
    threadId: 'thread_secure_1',
    senderAccountId: 'account_alice',
    senderDeviceId: 'device_alice',
    clientEnvelopeId: 'envelope_alice_2',
    kind: 'APPLICATION',
    epoch: '1',
  });
  const secondEncrypted = await alice.encrypt({
    threadId: 'thread_secure_1',
    aad: secondAad,
    event: {
      v: 1,
      kind: 'message.create',
      logicalMessageId: 'message_alice_2',
      clientCreatedAt: '2026-08-03T12:01:00.000Z',
      text: 'после ошибки',
    },
  });
  const receivedAfterRollback = await bob.process({
    threadId: 'thread_secure_1',
    aad: secondAad,
    epoch: '1',
    ciphertext: secondEncrypted.ciphertext,
  });
  assert.equal(receivedAfterRollback.event.text, 'после ошибки');

  const persisted = await bob.exportEncryptedState({ wrappingKeyId: 'device-state-v1' });
  assert.equal(persisted.includes(bobIdentity.recoverySecret), false);
  const restored = createMlsRuntime(options);
  await restored.importEncryptedState({ wrappingKeyId: 'device-state-v1', state: persisted });
  assert.deepEqual(restored.getGroupState('thread_secure_1'), bob.getGroupState('thread_secure_1'));
});

test('initial activation recovery atomically replaces both local MLS group states', async () => {
  const { createMlsRuntime } = await import('../src/mls-runtime.mjs');
  const wrappingKey = random(32);
  const options = { randomBytes: random, wrappingKeyProvider: { getKey: () => wrappingKey.slice() } };
  const alice = createMlsRuntime(options);
  const bob = createMlsRuntime(options);
  const aliceIdentity = await alice.createDeviceIdentity({
    accountId: 'account_alice', deviceId: 'device_alice', platform: 'web', displayName: 'Alice browser', capabilities: ['mls-v1'],
  });
  const bobIdentity = await bob.createDeviceIdentity({
    accountId: 'account_bobby', deviceId: 'device_bobby', platform: 'android', displayName: 'Bob phone', capabilities: ['mls-v1'],
  });
  const claim = async (claimId) => {
    const [keyPackage] = await bob.createKeyPackages(1);
    return {
      claimId,
      recipientAccountId: bobIdentity.accountId,
      recipientDeviceId: bobIdentity.deviceId,
      platform: bobIdentity.platform,
      displayName: bobIdentity.displayName,
      capabilities: bobIdentity.capabilities,
      credential: bobIdentity.credential,
      signaturePublicKey: bobIdentity.signaturePublicKey,
      accountIdentityPublicKey: bobIdentity.accountIdentityPublicKey,
      accountIdentitySignature: bobIdentity.accountIdentitySignature,
      keyPackage,
    };
  };
  const initial = await alice.createGroup({ threadId: 'thread_recover_1', claims: [await claim('claim_initial_1')] });
  await bob.joinGroup({
    threadId: 'thread_recover_1',
    groupId: initial.groupId,
    welcome: initial.welcomes[0].payload,
    members: [directoryRecord(aliceIdentity), directoryRecord(bobIdentity)],
  });

  const recovered = await alice.replaceInitialGroup({
    threadId: 'thread_recover_1',
    previousGroupId: initial.groupId,
    claims: [await claim('claim_recovery_1')],
  });
  assert.notEqual(recovered.groupId, initial.groupId);
  await bob.replaceInitialGroupFromWelcome({
    threadId: 'thread_recover_1',
    previousGroupId: initial.groupId,
    groupId: recovered.groupId,
    epoch: recovered.epoch,
    welcome: recovered.welcomes[0].payload,
    members: [directoryRecord(aliceIdentity), directoryRecord(bobIdentity)],
  });
  assert.equal(alice.getGroupState('thread_recover_1').groupId, recovered.groupId);
  assert.equal(bob.getGroupState('thread_recover_1').groupId, recovered.groupId);
});

test('directory verification rejects a server-injected device', async () => {
  const { createMlsRuntime, verifyDirectoryDevice } = await import('../src/mls-runtime.mjs');
  const runtime = createMlsRuntime({ randomBytes: random });
  const identity = await runtime.createDeviceIdentity({
    accountId: 'account_alice',
    deviceId: 'device_alice',
    platform: 'ios',
    displayName: 'Alice phone',
    capabilities: ['mls-v1'],
  });
  assert.throws(
    () => verifyDirectoryDevice({ ...directoryRecord(identity), deviceId: 'device_mallory' }),
    /directory_credential_binding/,
  );
});

test('directory verifier accepts the canonical server hash chain', async () => {
  const { createHash } = require('node:crypto');
  const { verifyKeyDirectoryChain } = await import('../src/mls-runtime.mjs');
  const firstPayload = {
    version: 1,
    operation: 'REGISTER',
    accountId: 'account_alice',
    deviceId: 'device_alice',
    platform: 'web',
    displayName: 'Alice browser',
    credentialHash: '1'.repeat(64),
    signatureKeyHash: '2'.repeat(64),
    accountIdentityKeyHash: '3'.repeat(64),
    accountIdentitySignature: Buffer.alloc(64, 4).toString('base64url'),
    capabilities: ['mls-v1'],
    registeredAt: '2026-08-03T12:00:00.000Z',
    revokedAt: null,
    recordedAt: '2026-08-03T12:00:00.000Z',
  };
  const firstHash = createHash('sha256')
    .update(Buffer.from(JSON.stringify(['VOLNA-CHAT-KEY-DIRECTORY', 1, null, firstPayload]), 'utf8'))
    .digest('hex');
  const secondPayload = {
    ...firstPayload,
    operation: 'REVOKE',
    revokedAt: '2026-08-03T13:00:00.000Z',
    recordedAt: '2026-08-03T13:00:00.000Z',
  };
  const secondHash = createHash('sha256')
    .update(Buffer.from(JSON.stringify(['VOLNA-CHAT-KEY-DIRECTORY', 1, firstHash, secondPayload]), 'utf8'))
    .digest('hex');
  const entries = [
    { previousHash: null, entryHash: firstHash, payload: firstPayload },
    { previousHash: firstHash, entryHash: secondHash, payload: secondPayload },
  ];
  assert.equal(verifyKeyDirectoryChain(entries, secondHash), secondHash);
});

test('directory snapshot binds hash-chain entries to a master-authorized device', async () => {
  const { createHash } = require('node:crypto');
  const { createMlsRuntime, verifyKeyDirectorySnapshot } = await import('../src/mls-runtime.mjs');
  const runtime = createMlsRuntime({ randomBytes: random });
  const identity = await runtime.createDeviceIdentity({
    accountId: 'account_alice',
    deviceId: 'device_alice',
    platform: 'web',
    displayName: 'Alice browser',
    capabilities: ['mls-v1'],
  });
  const digest = (value) => createHash('sha256').update(Buffer.from(value, 'base64url')).digest('hex');
  const registeredAt = '2026-08-03T12:00:00.000Z';
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
    .update(Buffer.from(JSON.stringify(['VOLNA-CHAT-KEY-DIRECTORY', 1, null, payload]), 'utf8'))
    .digest('hex');
  const verification = verifyKeyDirectorySnapshot({
    accountId: identity.accountId,
    identity: {
      accountId: identity.accountId,
      publicKey: identity.accountIdentityPublicKey,
      keyHash: digest(identity.accountIdentityPublicKey),
    },
    devices: [{
      ...directoryRecord(identity),
      id: identity.deviceId,
      status: 'ACTIVE',
      registeredAt,
      revokedAt: null,
    }],
    entries: [{
      deviceId: identity.deviceId,
      operation: 'DEVICE_REGISTERED',
      previousHash: null,
      entryHash,
      payload,
    }],
    headHash: entryHash,
  });
  assert.equal(verification.identityFingerprint, digest(identity.accountIdentityPublicKey));
  assert.equal(verification.devices[0].status, 'ACTIVE');
  assert.deepEqual(verification.entryHashes, [entryHash]);
  const witnessed = await withWitnessQuorum(verification);
  assert.equal(runtime.pinDirectoryVerification(witnessed).advanced, true);
  assert.equal(runtime.pinDirectoryVerification(witnessed).advanced, false);
  assert.throws(
    () => runtime.pinDirectoryVerification({
      ...witnessed,
      headHash: null,
      entryHashes: [],
      witnessQuorum: {
        ...witnessed.witnessQuorum,
        checkpoint: { ...witnessed.witnessQuorum.checkpoint, entryCount: 0, headHash: null },
      },
    }),
    /directory_rollback/,
  );
  assert.throws(
    () => runtime.pinDirectoryVerification({
      ...witnessed,
      headHash: 'f'.repeat(64),
      entryHashes: ['f'.repeat(64)],
      witnessQuorum: {
        ...witnessed.witnessQuorum,
        checkpoint: { ...witnessed.witnessQuorum.checkpoint, headHash: 'f'.repeat(64) },
      },
    }),
    /directory_split_view/,
  );
});

test('directory checkpoint requires a fresh independent witness quorum and rejects a split view', async () => {
  const { ed25519 } = await import('@noble/curves/ed25519.js');
  const {
    bytesToBase64Url,
    canonicalKeyDirectoryWitnessStatement,
    keyDirectoryLabel,
    verifyKeyDirectoryWitnessQuorum,
  } = await import('../src/mls-runtime.mjs');
  const accountId = 'account_alice';
  const checkpoint = {
    version: 1,
    directoryLabel: keyDirectoryLabel(accountId),
    identityFingerprint: '1'.repeat(64),
    entryCount: 2,
    headHash: '2'.repeat(64),
  };
  const observedAt = '2026-08-07T12:00:00.000Z';
  const privateKeys = [new Uint8Array(32).fill(3), new Uint8Array(32).fill(4)];
  const policy = {
    threshold: 2,
    maxStatementAgeMs: 60_000,
    witnesses: privateKeys.map((privateKey, index) => ({
      id: `witness_${index + 1}`,
      publicKey: bytesToBase64Url(ed25519.getPublicKey(privateKey)),
    })),
  };
  const statement = (index, value = checkpoint) => {
    const unsigned = {
      version: 1,
      witnessId: policy.witnesses[index].id,
      checkpoint: value,
      observedAt,
    };
    return {
      ...unsigned,
      signature: bytesToBase64Url(ed25519.sign(
        canonicalKeyDirectoryWitnessStatement(unsigned),
        privateKeys[index],
      )),
    };
  };

  const verified = verifyKeyDirectoryWitnessQuorum({
    accountId,
    identityFingerprint: checkpoint.identityFingerprint,
    entryCount: checkpoint.entryCount,
    headHash: checkpoint.headHash,
    statements: [statement(0), statement(1)],
    policy,
    now: Date.parse(observedAt) + 30_000,
  });
  assert.deepEqual(verified.witnessIds, ['witness_1', 'witness_2']);
  assert.equal(verified.threshold, 2);

  assert.throws(
    () => verifyKeyDirectoryWitnessQuorum({
      accountId,
      identityFingerprint: checkpoint.identityFingerprint,
      entryCount: checkpoint.entryCount,
      headHash: checkpoint.headHash,
      statements: [statement(0)],
      policy,
      now: Date.parse(observedAt) + 30_000,
    }),
    /directory_witness_quorum/,
  );

  const fork = { ...checkpoint, headHash: 'f'.repeat(64) };
  assert.throws(
    () => verifyKeyDirectoryWitnessQuorum({
      accountId,
      identityFingerprint: checkpoint.identityFingerprint,
      entryCount: checkpoint.entryCount,
      headHash: checkpoint.headHash,
      statements: [statement(0), statement(1, fork)],
      policy,
      now: Date.parse(observedAt) + 30_000,
    }),
    /directory_witness_checkpoint/,
  );

  assert.throws(
    () => verifyKeyDirectoryWitnessQuorum({
      accountId,
      identityFingerprint: checkpoint.identityFingerprint,
      entryCount: checkpoint.entryCount,
      headHash: checkpoint.headHash,
      statements: [statement(0), statement(1)],
      policy,
      now: Date.parse(observedAt) + 60_001,
    }),
    /directory_witness_stale/,
  );
});

test('MLS rekey adds a transferred device with Welcome and removes the old device before new application data', async () => {
  const { createMlsRuntime, mlsRosterHash } = await import('../src/mls-runtime.mjs');
  const wrappingKey = random(32);
  const options = { randomBytes: random, wrappingKeyProvider: { getKey: () => wrappingKey.slice() } };
  const aliceOld = createMlsRuntime(options);
  const aliceNew = createMlsRuntime(options);
  const bob = createMlsRuntime(options);
  const aliceOldIdentity = await aliceOld.createDeviceIdentity({
    accountId: 'account_alice', deviceId: 'device_alice_old', platform: 'ios', displayName: 'Old iPhone', capabilities: ['mls-v1'],
  });
  const bobIdentity = await bob.createDeviceIdentity({
    accountId: 'account_bobby', deviceId: 'device_bobby', platform: 'android', displayName: 'Bob phone', capabilities: ['mls-v1'],
  });
  const pendingDraft = await aliceNew.createPendingTransferDeviceIdentity({
    accountId: 'account_alice',
    deviceId: 'device_alice_new',
    platform: 'ios',
    displayName: 'New iPhone',
    capabilities: ['mls-v1', 'transfer-v1'],
    accountIdentityPublicKey: aliceOldIdentity.accountIdentityPublicKey,
  });
  const approval = aliceOld.authorizeTransferredDevice(pendingDraft);
  const aliceNewIdentity = aliceNew.completeTransferredDeviceIdentity(approval);
  assert.equal(aliceNewIdentity.accountIdentityPublicKey, aliceOldIdentity.accountIdentityPublicKey);

  const [bobPackage] = await bob.createKeyPackages(1);
  const activation = await aliceOld.createGroup({
    threadId: 'thread_rekey_1',
    claims: [{
      claimId: 'claim_bobby_1',
      recipientAccountId: bobIdentity.accountId,
      recipientDeviceId: bobIdentity.deviceId,
      platform: bobIdentity.platform,
      displayName: bobIdentity.displayName,
      capabilities: bobIdentity.capabilities,
      credential: bobIdentity.credential,
      signaturePublicKey: bobIdentity.signaturePublicKey,
      accountIdentityPublicKey: bobIdentity.accountIdentityPublicKey,
      accountIdentitySignature: bobIdentity.accountIdentitySignature,
      keyPackage: bobPackage,
    }],
  });
  await bob.joinGroup({
    threadId: 'thread_rekey_1',
    groupId: activation.groupId,
    welcome: activation.welcomes[0].payload,
    members: [directoryRecord(aliceOldIdentity), directoryRecord(bobIdentity)],
  });

  const [newPackage] = await aliceNew.createKeyPackages(1);
  const allRecords = [directoryRecord(aliceOldIdentity), directoryRecord(aliceNewIdentity), directoryRecord(bobIdentity)];
  const addRosterHash = mlsRosterHash(allRecords);
  const addAad = contract.canonicalEnvelopeAad({
    protocolVersion: 1,
    threadId: 'thread_rekey_1',
    senderAccountId: 'account_alice',
    senderDeviceId: 'device_alice_old',
    clientEnvelopeId: 'envelope_rekey_add_1',
    kind: 'COMMIT',
    epoch: '2',
    operationId: 'operation_rekey_add_1',
    rosterHash: addRosterHash,
  });
  const added = await aliceOld.prepareRekey({
    threadId: 'thread_rekey_1',
    operationId: 'operation_rekey_add_1',
    baseEpoch: '1',
    targetEpoch: '2',
    rosterHash: addRosterHash,
    targetMembers: allRecords,
    removeDeviceIds: [],
    claims: [{
      claimId: 'claim_alice_new_1',
      recipientAccountId: aliceNewIdentity.accountId,
      recipientDeviceId: aliceNewIdentity.deviceId,
      platform: aliceNewIdentity.platform,
      displayName: aliceNewIdentity.displayName,
      capabilities: aliceNewIdentity.capabilities,
      credential: aliceNewIdentity.credential,
      signaturePublicKey: aliceNewIdentity.signaturePublicKey,
      accountIdentityPublicKey: aliceNewIdentity.accountIdentityPublicKey,
      accountIdentitySignature: aliceNewIdentity.accountIdentitySignature,
      keyPackage: newPackage,
    }],
    aad: addAad,
  });
  await aliceNew.joinGroup({
    threadId: 'thread_rekey_1',
    groupId: activation.groupId,
    epoch: '2',
    welcome: added.welcomes[0].payload,
    members: allRecords,
  });
  const allExpected = aliceNew.getGroupState('thread_rekey_1').members;
  await bob.process({
    threadId: 'thread_rekey_1', aad: addAad, epoch: '2', ciphertext: added.ciphertext, expectedMembers: allExpected,
  });
  aliceOld.commitPreparedRekey('operation_rekey_add_1');
  assert.equal(aliceOld.getGroupState('thread_rekey_1').members.length, 3);

  const remainingRecords = [directoryRecord(aliceNewIdentity), directoryRecord(bobIdentity)];
  const removeRosterHash = mlsRosterHash(remainingRecords);
  const removeAad = contract.canonicalEnvelopeAad({
    protocolVersion: 1,
    threadId: 'thread_rekey_1',
    senderAccountId: 'account_bobby',
    senderDeviceId: 'device_bobby',
    clientEnvelopeId: 'envelope_rekey_remove_1',
    kind: 'COMMIT',
    epoch: '3',
    operationId: 'operation_rekey_remove_1',
    rosterHash: removeRosterHash,
  });
  const removed = await bob.prepareRekey({
    threadId: 'thread_rekey_1',
    operationId: 'operation_rekey_remove_1',
    baseEpoch: '2',
    targetEpoch: '3',
    rosterHash: removeRosterHash,
    targetMembers: remainingRecords,
    removeDeviceIds: ['device_alice_old'],
    claims: [],
    aad: removeAad,
  });
  const remainingExpected = aliceNew.getGroupState('thread_rekey_1').members.filter((member) => member.deviceId !== 'device_alice_old');
  await aliceNew.process({
    threadId: 'thread_rekey_1', aad: removeAad, epoch: '3', ciphertext: removed.ciphertext, expectedMembers: remainingExpected,
  });
  bob.commitPreparedRekey('operation_rekey_remove_1');

  const applicationAad = contract.canonicalEnvelopeAad({
    protocolVersion: 1,
    threadId: 'thread_rekey_1',
    senderAccountId: 'account_bobby',
    senderDeviceId: 'device_bobby',
    clientEnvelopeId: 'envelope_after_remove_1',
    kind: 'APPLICATION',
    epoch: '3',
  });
  const encrypted = await bob.encrypt({
    threadId: 'thread_rekey_1',
    aad: applicationAad,
    event: {
      v: 1,
      kind: 'message.create',
      logicalMessageId: 'message_after_remove_1',
      clientCreatedAt: '2026-08-03T15:00:00.000Z',
      text: 'new epoch only',
    },
  });
  const received = await aliceNew.process({
    threadId: 'thread_rekey_1', aad: applicationAad, epoch: '3', ciphertext: encrypted.ciphertext,
  });
  assert.equal(received.event.text, 'new epoch only');
  await assert.rejects(() => aliceOld.process({
    threadId: 'thread_rekey_1', aad: applicationAad, epoch: '3', ciphertext: encrypted.ciphertext,
  }));
});
