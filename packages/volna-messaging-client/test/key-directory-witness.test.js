'use strict';

const assert = require('node:assert/strict');
const { createHash, randomBytes } = require('node:crypto');
const test = require('node:test');

const random = (length) => new Uint8Array(randomBytes(length));
const digest = (value) => createHash('sha256').update(Buffer.from(value, 'base64url')).digest('hex');

function device(identity, registeredAt) {
  return {
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
  };
}

function registrationEntry(identity, registeredAt, previousHash) {
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
    deviceId: identity.deviceId,
    operation: 'DEVICE_REGISTERED',
    previousHash,
    entryHash,
    payload,
    createdAt: registeredAt,
  };
}

test('independent witness signs only an append-only directory and permanently rejects a fork', async () => {
  const [{ createMlsRuntime, keyDirectoryLabel, verifyKeyDirectoryWitnessQuorum }, {
    createKeyDirectoryWitness,
    createMemoryKeyDirectoryWitnessStore,
  }] = await Promise.all([
    import('../src/mls-runtime.mjs'),
    import('../src/key-directory-witness.mjs'),
  ]);
  const firstRuntime = createMlsRuntime({ randomBytes: random });
  const secondRuntime = createMlsRuntime({ randomBytes: random });
  const forkRuntime = createMlsRuntime({ randomBytes: random });
  const first = await firstRuntime.createDeviceIdentity({
    accountId: 'account_alice',
    deviceId: 'device_alice_1',
    platform: 'web',
    displayName: 'Alice browser',
    capabilities: ['mls-v1'],
  });
  const second = await secondRuntime.createDeviceIdentity({
    accountId: first.accountId,
    deviceId: 'device_alice_2',
    platform: 'ios',
    displayName: 'Alice phone',
    capabilities: ['mls-v1'],
    recoverySecret: first.recoverySecret,
  });
  const forkDevice = await forkRuntime.createDeviceIdentity({
    accountId: first.accountId,
    deviceId: 'device_alice_3',
    platform: 'android',
    displayName: 'Injected fork',
    capabilities: ['mls-v1'],
    recoverySecret: first.recoverySecret,
  });
  const firstAt = '2026-08-07T10:00:00.000Z';
  const secondAt = '2026-08-07T10:30:00.000Z';
  const firstEntry = registrationEntry(first, firstAt, null);
  const secondEntry = registrationEntry(second, secondAt, firstEntry.entryHash);
  const forkEntry = registrationEntry(forkDevice, secondAt, firstEntry.entryHash);
  const identity = {
    accountId: first.accountId,
    publicKey: first.accountIdentityPublicKey,
    keyHash: digest(first.accountIdentityPublicKey),
    createdAt: firstAt,
  };
  const snapshot = (identities, entries) => ({
    accountId: first.accountId,
    identity,
    devices: identities.map((value, index) => device(value, index === 0 ? firstAt : secondAt)),
    entries,
    headHash: entries.at(-1)?.entryHash ?? null,
  });
  const firstSnapshot = snapshot([first], [firstEntry]);
  const secondSnapshot = snapshot([first, second], [firstEntry, secondEntry]);
  const forkSnapshot = snapshot([first, forkDevice], [firstEntry, forkEntry]);
  const now = Date.parse('2026-08-07T12:00:00.000Z');
  const raceStore = createMemoryKeyDirectoryWitnessStore();
  const raceWitnesses = [1, 2].map(() => createKeyDirectoryWitness({
    witnessId: 'witness_race',
    signingKey: new Uint8Array(32).fill(20),
    store: raceStore,
    clock: () => now,
  }));
  const race = await Promise.allSettled([
    raceWitnesses[0].observe(secondSnapshot),
    raceWitnesses[1].observe(forkSnapshot),
  ]);
  assert.equal(race.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(race.filter((result) => result.status === 'rejected' && /split_view/.test(result.reason?.message)).length, 1);
  raceWitnesses.forEach((witness) => witness.destroy());

  const witnesses = [
    createKeyDirectoryWitness({
      witnessId: 'witness_1',
      signingKey: new Uint8Array(32).fill(21),
      store: createMemoryKeyDirectoryWitnessStore(),
      clock: () => now,
    }),
    createKeyDirectoryWitness({
      witnessId: 'witness_2',
      signingKey: new Uint8Array(32).fill(22),
      store: createMemoryKeyDirectoryWitnessStore(),
      clock: () => now,
    }),
  ];

  await witnesses[0].observe(firstSnapshot);
  const statements = await Promise.all(witnesses.map((witness) => witness.observe(secondSnapshot)));
  await assert.rejects(() => witnesses[0].observe(firstSnapshot), /rollback/);
  await assert.rejects(() => witnesses[0].observe(forkSnapshot), /split_view/);

  const checkpoint = {
    directoryLabel: keyDirectoryLabel(first.accountId),
    identityFingerprint: identity.keyHash,
    entryCount: 2,
    headHash: secondEntry.entryHash,
  };
  assert.deepEqual(await witnesses[0].getStatement(checkpoint), statements[0]);
  assert.equal(await witnesses[0].getStatement({ ...checkpoint, headHash: forkEntry.entryHash }), null);
  assert.equal(JSON.stringify(statements).includes(first.accountId), false);

  const verified = verifyKeyDirectoryWitnessQuorum({
    accountId: first.accountId,
    identityFingerprint: identity.keyHash,
    entryCount: 2,
    headHash: secondEntry.entryHash,
    statements,
    policy: {
      threshold: 2,
      maxStatementAgeMs: 60_000,
      witnesses: witnesses.map((witness) => ({ id: witness.witnessId, publicKey: witness.publicKey })),
    },
    now: now + 30_000,
  });
  assert.deepEqual(verified.witnessIds, ['witness_1', 'witness_2']);
  witnesses.forEach((witness) => witness.destroy());
});
