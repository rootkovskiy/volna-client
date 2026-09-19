const assert = require('node:assert/strict');
const { test, before } = require('node:test');
let createMatrixVerificationFetch, waitForPublishedMatrixDevice;
before(async () => ({ createMatrixVerificationFetch, waitForPublishedMatrixDevice } = await import('../src/matrix-device-publication.mjs')));
const expected = { userId: '@fixture:test', deviceId: 'fixture-device', ed25519: 'ed-public', curve25519: 'curve-public' };
const published = () => ({ user_id: expected.userId, device_id: expected.deviceId,
  keys: { [`ed25519:${expected.deviceId}`]: expected.ed25519, [`curve25519:${expected.deviceId}`]: expected.curve25519 } });

test('verification waits for publication of this exact endpoint, without changing trust', async () => {
  let reads = 0;
  const device = published();
  await waitForPublishedMatrixDevice({ ...expected, readDevice: async () => ++reads === 1 ? undefined : device });
  assert.equal(reads, 2);
  assert.deepEqual(device, published());
});

test('publication does not accept a different owner, device, Ed25519 or Curve25519 key', async () => {
  for (const device of [
    { ...published(), user_id: '@other:test' }, { ...published(), device_id: 'other' },
    { ...published(), keys: { ...published().keys, [`ed25519:${expected.deviceId}`]: 'other' } },
    { ...published(), keys: { ...published().keys, [`curve25519:${expected.deviceId}`]: 'other' } },
  ]) await assert.rejects(waitForPublishedMatrixDevice({ ...expected, readDevice: async () => device }), /не совпадают/);
});

test('authorization/network failure cannot be treated as published device keys', async () => {
  const error = new Error('query denied');
  await assert.rejects(waitForPublishedMatrixDevice({ ...expected, readDevice: async () => { throw error; } }), error);
});

test('publication aborts a stalled query after five seconds with an actionable error', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal;
  const pending = waitForPublishedMatrixDevice({ ...expected, readDevice: async (value) => {
    signal = value;
    return new Promise((_resolve, reject) => value.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  } });
  t.mock.timers.tick(5_000);
  await assert.rejects(pending, /начните проверку снова/);
  assert.equal(signal.aborted, true);
});

const selfRequest = { type: 'm.key.verification.request', sender: expected.userId, content: { from_device: 'fresh-device', transaction_id: 'fresh-transaction' } };
test('a self-verification refreshes its device keys before the unchanged sync reaches Crypto', async () => {
  const snapshot = JSON.stringify({ next_batch: 'cursor', device_lists: { changed: [expected.userId] },
    to_device: { events: [selfRequest, selfRequest] }, rooms: { opaque: 'untouched' } });
  const response = new Response(snapshot);
  let refreshes = 0, refreshed = false;
  const guardedFetch = createMatrixVerificationFetch({ homeserverUrl: 'https://matrix.test', userId: expected.userId,
    fetch: async () => response, refreshOwnDeviceKeys: async () => { refreshes++; await Promise.resolve(); refreshed = true; } });
  const result = await guardedFetch('https://matrix.test/_matrix/client/v3/sync');
  assert.equal(refreshed, true);
  assert.equal(refreshes, 1, 'bounded to one refresh per batch');
  assert.equal(result, response);
  assert.equal(await result.text(), snapshot, 'transport must not rewrite cryptographic events');
});

test('ordinary sync, peer requests and another origin never trigger own-key refresh', async () => {
  for (const [url, events] of [
    ['https://matrix.test/_matrix/client/v3/sync', []],
    ['https://matrix.test/_matrix/client/v3/sync', [{ ...selfRequest, sender: '@other:test' }]],
    ['https://other.test/_matrix/client/v3/sync', [selfRequest]],
    ['https://matrix.test/_matrix/client/v3/keys/query', [selfRequest]],
  ]) {
    const guardedFetch = createMatrixVerificationFetch({ homeserverUrl: 'https://matrix.test', userId: expected.userId,
      fetch: async () => new Response(JSON.stringify({ to_device: { events } })),
      refreshOwnDeviceKeys: async () => assert.fail('unexpected refresh'),
    });
    await guardedFetch(new URL(url));
  }
});

test('failed own-key refresh cannot acknowledge a sync batch and silently lose its verification', async () => {
  const error = new Error('keys unavailable');
  const guardedFetch = createMatrixVerificationFetch({ homeserverUrl: 'https://matrix.test', userId: expected.userId,
    fetch: async () => new Response(JSON.stringify({ to_device: { events: [selfRequest] } })),
    refreshOwnDeviceKeys: async () => { throw error; },
  });
  await assert.rejects(guardedFetch(new Request('https://matrix.test/_matrix/client/r0/sync')), error);
});
