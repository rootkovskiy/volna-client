const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

async function fixture() {
  const { waitForMatrixJoinedRoom } = await import('../src/matrix-room-readiness.mjs');
  const client = new EventEmitter();
  let room;
  client.getRoom = id => id === '!wanted:fixture' ? room : null;
  return { client, setRoom: value => { room = value; }, wait: options => waitForMatrixJoinedRoom(client, '!wanted:fixture', { assertActive() {}, ...options }) };
}

test('join acknowledgement waits for matching synced membership and removes its listener', async () => {
  const f = await fixture();
  let finished = false;
  const pending = f.wait().then(room => { finished = true; return room; });
  f.client.emit('sync', 'SYNCING');
  await Promise.resolve();
  assert.equal(finished, false);
  f.setRoom({ getMyMembership: () => 'invite' });
  f.client.emit('sync', 'SYNCING');
  await Promise.resolve();
  assert.equal(finished, false);
  const joined = { getMyMembership: () => 'join' };
  f.setRoom(joined);
  f.client.emit('sync', 'SYNCING');
  assert.equal(await pending, joined);
  assert.equal(f.client.listenerCount('sync'), 0);
  assert.equal(await f.wait(), joined);
  assert.equal(f.client.listenerCount('sync'), 0);
});

test('stopped, expired, departed and invalidated sessions fail closed and clean listeners', async () => {
  for (const mode of ['stop', 'timeout', 'leave', 'ban', 'logout']) {
    const f = await fixture();
    let active = true;
    const pending = f.wait({ timeoutMs: 10, assertActive() { if (!active) throw Error('account closed'); } });
    if (mode === 'logout') active = false;
    if (['leave', 'ban'].includes(mode)) f.setRoom({ getMyMembership: () => mode });
    if (mode !== 'timeout') f.client.emit('sync', mode === 'stop' ? 'STOPPED' : 'SYNCING');
    await assert.rejects(pending, /stopped|timeout|membership|closed/);
    assert.equal(f.client.listenerCount('sync'), 0);
  }
});
