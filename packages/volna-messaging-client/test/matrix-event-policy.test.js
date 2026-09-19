'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');

test('Matrix transport refuses plaintext timeline sends before any network I/O', async () => {
  const { createEncryptedMatrixFetch } = await import('../src/matrix-event-policy.mjs');
  const calls = [];
  const fetch = createEncryptedMatrixFetch(async (...args) => { calls.push(args); return new Response('{}'); }, 'https://volna.social');
  for (const version of ['v3', 'r0']) {
    for (const type of ['m.room.message', 'm%2Eroom%2Emessage', 'm.reaction']) {
      await assert.rejects(fetch(`https://volna.social/_matrix/client/${version}/rooms/!room%3Avolna.social/send/${type}/txn`, { method: 'PUT' }), /заблокирована/);
    }
  }
  assert.equal(calls.length, 0);
  for (const path of ['/v3/rooms/!room/send/m.room.encrypted/txn', '/v3/sync', '/v3/sendToDevice/m.key.verification.request/txn']) {
    await fetch(new Request(`https://volna.social/_matrix/client${path}`));
  }
  assert.equal(calls.length, 3);
});

test('encrypted provenance and original content are mandatory, unsigned replacement is ignored', async () => {
  const { originalEncryptedMatrixContent } = await import('../src/matrix-event-policy.mjs');
  const authentic = { text: 'authentic' };
  const event = {
    getWireType: () => 'm.room.encrypted', getType: () => 'm.room.message', isDecryptionFailure: () => false,
    getOriginalContent: () => authentic, getContent: () => { throw Error('UNSIGNED replacement was read'); },
  };
  assert.equal(originalEncryptedMatrixContent(event), authentic);
  assert.equal(originalEncryptedMatrixContent({ ...event, getWireType: () => 'm.room.message' }), null);
  assert.equal(originalEncryptedMatrixContent({ ...event, isDecryptionFailure: () => true }), null);
});

test('one authenticated collision cannot hide later messages or authorize another sender edit', async () => {
  const { projectMatrixContentEvents } = await import('../src/matrix-event-policy.mjs');
  const record = (id, text, second, logicalId = id) => ({
    envelopeId: id, senderAccountId: 'account_alice', senderDeviceId: 'device_alice',
    serverCreatedAt: `2026-09-05T12:00:0${second}.000Z`,
    event: { v: 1, kind: 'message.create', logicalMessageId: logicalId, clientCreatedAt: `2026-09-05T12:00:0${second}.000Z`, text },
  });
  const original = record('message_original', 'original', 0);
  const collision = record('envelope_poison', 'forged', 1, 'message_original');
  const later = record('message_later', 'later', 2);
  const forgedEdit = { ...record('message_forged', 'forged edit', 3), senderAccountId: 'account_bobby', senderDeviceId: 'device_bobby' };
  forgedEdit.event = { ...forgedEdit.event, kind: 'message.edit', targetLogicalMessageId: 'message_original' };
  assert.deepEqual(projectMatrixContentEvents([later, collision, original, forgedEdit]).map(m => m.text), ['original', 'later']);
});

test('Matrix retry reuses a failed local echo and does not resend an acknowledged transaction', async () => {
  const { sendMatrixContentOnce } = await import('../src/matrix-event-policy.mjs');
  let status = 'not_sent', sends = 0, retries = 0;
  const event = { get status() { return status; }, getId: () => '$confirmed', getWireType: () => 'm.room.encrypted' };
  const room = { roomId: '!room', getEventForTxnId: () => event, getLiveTimeline: () => ({ getEvents: () => [] }) };
  const client = { getUserId: () => '@self', resendEvent: async (existing, target) => { assert.equal(existing, event); assert.equal(target, room); retries++; return { event_id: '$confirmed' }; },
    sendEvent: async (_room, _type, _content, txn) => { sends++; assert.equal(txn, 'stable_txn'); return { event_id: '$confirmed' }; } };
  await sendMatrixContentOnce(client, room, {}, 'stable_txn');
  assert.equal(retries, 1);
  status = 'sent';
  assert.deepEqual(await sendMatrixContentOnce(client, room, {}, 'stable_txn'), { event_id: '$confirmed' });
  assert.equal(sends, 0);
  status = 'sending';
  await assert.rejects(sendMatrixContentOnce(client, room, {}, 'stable_txn'), /ещё отправляется/);
  room.getEventForTxnId = () => undefined;
  await sendMatrixContentOnce(client, room, {}, 'stable_txn');
  assert.equal(sends, 1);
});
