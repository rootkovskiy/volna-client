const test = require('node:test');
const assert = require('node:assert/strict');

test('old or partial SDK capability fails closed before room binding', async () => {
  const { requireMatrixRecipientCrypto } = await import('../src/matrix-recipient-policy.mjs');
  for (const candidate of [null, {}, { getRoomKeyRecipientPolicyVersion: () => 0, bindRoomKeyRecipients() {} }, { getRoomKeyRecipientPolicyVersion: () => 1 }]) {
    assert.throws(() => requireMatrixRecipientCrypto(candidate), /обновлённая библиотека/);
  }
});

test('recipient facade preserves the exact immutable binding and propagates rejection', async () => {
  const { requireMatrixRecipientCrypto } = await import('../src/matrix-recipient-policy.mjs');
  const calls = [];
  const candidate = { getRoomKeyRecipientPolicyVersion: () => 1, getAuthenticatedBackupVersion: () => 1, async bindRoomKeyRecipients(room, peer) {
    calls.push([room, peer]);
    throw new Error('binding conflict');
  } };
  assert.equal(requireMatrixRecipientCrypto(candidate), candidate);
  await assert.rejects(() => requireMatrixRecipientCrypto(candidate).bindRoomKeyRecipients('!fixture:example.org', '@peer:example.org'), /binding conflict/);
  assert.deepEqual(calls, [['!fixture:example.org', '@peer:example.org']]);
});

test('SDK with recipient enforcement but no authenticated backup capability is rejected', async () => {
  const { requireMatrixRecipientCrypto } = await import('../src/matrix-recipient-policy.mjs');
  for (const version of [undefined, 0, 2]) {
    const candidate = { getRoomKeyRecipientPolicyVersion: () => 1, bindRoomKeyRecipients() {},
      ...(version === undefined ? {} : { getAuthenticatedBackupVersion: () => version }) };
    assert.throws(() => requireMatrixRecipientCrypto(candidate), /обновлённая библиотека/);
  }
});
