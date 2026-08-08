'use strict';

const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const test = require('node:test');

const random = (length) => new Uint8Array(randomBytes(length));

function memoryDatabase() {
  const values = new Map();
  const writes = [];
  return {
    values,
    writes,
    async getItem(key) { return values.get(key) ?? null; },
    async setItem(key, value) { writes.push(key); values.set(key, value); },
    async removeItem(key) { values.delete(key); },
    async getAllKeys() { return [...values.keys()]; },
  };
}

function record(thread, index) {
  const suffix = index.toString().padStart(6, '0');
  return {
    envelopeId: `envelope_${thread}_${suffix}`,
    senderAccountId: index % 2 === 0 ? 'account_alice' : 'account_bob',
    senderDeviceId: index % 2 === 0 ? 'device_alice' : 'device_bob_1',
    serverCreatedAt: '2026-08-08T12:00:00.000Z',
    event: {
      v: 1,
      kind: 'message.create',
      logicalMessageId: `message_${thread}_${suffix}`,
      clientCreatedAt: '2026-08-08T11:59:59.000Z',
      text: `секретная большая история ${thread}/${suffix} ${'x'.repeat(96)}`,
    },
  };
}

test('32k-message encrypted history remains chunked, append-bounded, and plaintext-free at rest', { timeout: 60_000 }, async (t) => {
  const { createEncryptedMessageStore } = await import('../src/encrypted-message-store.mjs');
  const database = memoryDatabase();
  const wrappingKey = random(32);
  const store = createEncryptedMessageStore({
    scope: 'account_scale:device_scale',
    database,
    randomBytes: random,
    wrappingKeyProvider: { getKey: async () => wrappingKey.slice() },
  });
  const threads = Object.fromEntries(Array.from({ length: 8 }, (_, threadIndex) => {
    const thread = threadIndex.toString().padStart(2, '0');
    return [`thread_scale_${thread}`, Array.from({ length: 4_096 }, (_, index) => record(thread, index))];
  }));
  const saveStarted = performance.now();
  await store.saveAllThreads(threads);
  const saveMs = performance.now() - saveStarted;
  const persisted = JSON.stringify([...database.values]);
  for (const secret of ['thread_scale_00', 'account_alice', 'device_bob_1', 'секретная большая история', 'envelope_00_000000']) {
    assert.equal(persisted.includes(secret), false, `persisted database leaked ${secret}`);
  }
  assert.equal(database.values.size, 265, '256 chunks, eight indexes, and one manifest are expected');

  const loadStarted = performance.now();
  const loaded = await store.loadAllThreads();
  const loadMs = performance.now() - loadStarted;
  assert.equal(Object.keys(loaded).length, 8);
  assert.equal(loaded.thread_scale_00.length, 4_096);
  assert.equal(loaded.thread_scale_07.at(-1).event.text, threads.thread_scale_07.at(-1).event.text);
  assert.ok(saveMs < 30_000, `desktop Node save exceeded the smoke ceiling: ${saveMs.toFixed(0)} ms`);
  assert.ok(loadMs < 30_000, `desktop Node load exceeded the smoke ceiling: ${loadMs.toFixed(0)} ms`);

  database.writes.length = 0;
  threads.thread_scale_00 = [...threads.thread_scale_00, record('00', 4_096)];
  await store.saveAllThreads(threads, {
    changedThreadIds: ['thread_scale_00'],
    appendOnlyThreadIds: ['thread_scale_00'],
  });
  assert.equal(database.writes.length, 3, 'one tail chunk, one index, and one manifest must be rewritten');
  assert.ok(Math.max(...database.writes.map((key) => Buffer.byteLength(database.values.get(key), 'utf8'))) < 128 * 1024);
  t.diagnostic(`32k history: save=${saveMs.toFixed(0)}ms load=${loadMs.toFixed(0)}ms encryptedRecords=${database.values.size}`);
  store.destroyMemory();
  wrappingKey.fill(0);
});
