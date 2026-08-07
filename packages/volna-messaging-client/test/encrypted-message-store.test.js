'use strict';

const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const test = require('node:test');

const random = (length) => new Uint8Array(randomBytes(length));

function memoryDatabase() {
  const values = new Map();
  const writes = [];
  let rejectedKey = null;
  return {
    values,
    writes,
    rejectNextWrite(key) { rejectedKey = key; },
    async getItem(key) { return values.get(key) ?? null; },
    async setItem(key, value) {
      if (key === rejectedKey) {
        rejectedKey = null;
        throw new Error('simulated crash');
      }
      writes.push(key);
      values.set(key, value);
    },
    async removeItem(key) { values.delete(key); },
    async getAllKeys() { return [...values.keys()]; },
  };
}

function record(text, envelopeId = 'envelope_local_1') {
  return {
    envelopeId,
    senderAccountId: 'account_alice',
    senderDeviceId: 'device_alice',
    serverCreatedAt: '2026-08-07T12:00:00.000Z',
    event: {
      v: 1,
      kind: 'message.create',
      logicalMessageId: `message_${envelopeId}`,
      clientCreatedAt: '2026-08-07T11:59:59.000Z',
      text,
    },
  };
}

test('encrypted message store keeps thread ids and plaintext out of the database and survives interrupted manifest commits', async () => {
  const { createEncryptedMessageStore } = await import('../src/encrypted-message-store.mjs');
  const database = memoryDatabase();
  const wrappingKey = random(32);
  const store = createEncryptedMessageStore({
    scope: 'account_alice:device_alice',
    database,
    randomBytes: random,
    wrappingKeyProvider: { getKey: async () => wrappingKey.slice() },
  });

  await store.saveAllThreads({ thread_secure_1: [record('совершенно секретно')] });
  assert.deepEqual(await store.loadAllThreads(), { thread_secure_1: [record('совершенно секретно')] });
  const persisted = JSON.stringify([...database.values.entries()]);
  assert.equal(persisted.includes('thread_secure_1'), false);
  assert.equal(persisted.includes('совершенно секретно'), false);
  assert.equal(persisted.includes('account_alice'), false);

  const manifestKey = database.writes.at(-1);
  database.rejectNextWrite(manifestKey);
  await assert.rejects(
    store.saveAllThreads({ thread_secure_1: [record('новая версия')] }),
    /database_write/,
  );
  assert.deepEqual(await store.loadAllThreads(), { thread_secure_1: [record('совершенно секретно')] });
  assert.equal(database.values.size, 3);

  await store.saveAllThreads({});
  assert.deepEqual(await store.loadAllThreads(), {});
  await store.clear();
  assert.equal(database.values.size, 0);
  store.destroyMemory();
  wrappingKey.fill(0);
});

test('encrypted message store rejects authenticated-record tampering', async () => {
  const { createEncryptedMessageStore } = await import('../src/encrypted-message-store.mjs');
  const database = memoryDatabase();
  const store = createEncryptedMessageStore({
    scope: 'account_alice:device_alice',
    database,
    randomBytes: random,
    wrappingKeyProvider: { getKey: async () => new Uint8Array(32).fill(9) },
  });
  await store.saveAllThreads({ thread_secure_1: [record('не менять')] });
  const recordKey = database.writes[0];
  const envelope = JSON.parse(database.values.get(recordKey));
  envelope.ciphertext = `${envelope.ciphertext.slice(0, -1)}${envelope.ciphertext.endsWith('A') ? 'B' : 'A'}`;
  database.values.set(recordKey, JSON.stringify(envelope));
  await assert.rejects(() => store.loadAllThreads(), /decrypt/);
});

test('append-only persistence rewrites only one bounded encrypted chunk', async () => {
  const { createEncryptedMessageStore } = await import('../src/encrypted-message-store.mjs');
  const database = memoryDatabase();
  const store = createEncryptedMessageStore({
    scope: 'account_alice:device_alice',
    database,
    randomBytes: random,
    wrappingKeyProvider: { getKey: async () => new Uint8Array(32).fill(7) },
  });
  const threadOne = Array.from({ length: 1_024 }, (_, index) => record(
    `история первого диалога ${index.toString().padStart(4, '0')} ${'x'.repeat(64)}`,
    `envelope_first_${index.toString().padStart(6, '0')}`,
  ));
  const threadTwo = Array.from({ length: 1_024 }, (_, index) => record(
    `история второго диалога ${index.toString().padStart(4, '0')} ${'y'.repeat(64)}`,
    `envelope_second_${index.toString().padStart(6, '0')}`,
  ));
  const threads = {
    thread_secure_1: threadOne,
    thread_secure_2: threadTwo,
  };
  await store.saveAllThreads(threads);
  database.writes.length = 0;

  threads.thread_secure_1 = [...threadOne, record('только новый хвост', 'envelope_first_999999')];
  await store.saveAllThreads(threads, {
    changedThreadIds: ['thread_secure_1'],
    appendOnlyThreadIds: ['thread_secure_1'],
  });

  assert.equal(database.writes.length, 3, 'one chunk, one thread index, and one manifest must be committed');
  assert.ok(
    Math.max(...database.writes.map((key) => Buffer.byteLength(database.values.get(key), 'utf8'))) < 128 * 1024,
    'an append must not rewrite the complete long thread blob',
  );
  assert.equal((await store.loadAllThreads()).thread_secure_1.length, 1_025);

  database.writes.length = 0;
  await store.saveAllThreads(threads, { changedThreadIds: [], appendOnlyThreadIds: [] });
  assert.equal(database.writes.length, 0, 'an unchanged projection snapshot must perform no writes');
});
