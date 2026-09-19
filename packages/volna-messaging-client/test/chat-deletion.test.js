const test = require('node:test');
const assert = require('node:assert/strict');

const alice = 'account_alice_123', bob = 'account_bobby_123', threadId = 'thread_delete_123';
const time = n => `2026-09-15T12:00:${String(n).padStart(2, '0')}.000Z`;
const message = (id, owner, second) => ({ id, threadId, senderAccountId: owner, text: id,
  createdAt: time(second), reactions: [], securityMode: 'e2ee' });

async function fixture() {
  const { createMessagingSurfaceController } = await import('../src/messaging-surface-controller.mjs');
  const messages = [message('message_alice_123', alice, 1), message('message_bobby_123', bob, 2)];
  const operations = new Map(); let now = 10, failWrite = false, failRead = false;
  const requests = [];
  const state = (account, ids = []) => {
    const mine = [...operations.values()].filter(op => op.account === account || op.scope === 'everyone');
    return { hasDeletions: mine.length > 0,
      clearedBefore: mine.filter(op => !op.messageId).map(op => op.createdAt).sort().at(-1) ?? null,
      deletedMessageIds: mine.filter(op => ids.includes(op.messageId)).map(op => op.messageId) };
  };
  const shell = account => ({ id: threadId, partner: { id: account === alice ? bob : alice, username: account === alice ? 'bobby' : 'alice', name: 'QA', avatarUrl: null, isVerified: false },
    messages: [], encryptionMode: 'MATRIX_V1', protocolVersion: 1, visibility: state(account),
    lastMessageAt: time(2), lastMessageText: null, lastReadAt: null });
  const engine = {
    capabilities: async () => ({ enabled: true }),
    openThread: async (_, thread) => ({ ...thread, messages: [...messages] }),
    decorateThread: async (_, thread) => ({ ...thread, messages: [...messages] }),
    decorateThreads: async (_, threads) => threads.map(thread => ({ ...thread, messages: [...messages] })),
    searchLocalMessages: async () => messages.map(message => ({ threadId, message })),
    reactToMessage: async () => [...messages], editMessage: async () => [...messages], sendMessage: async () => [...messages],
  };
  const controller = account => createMessagingSurfaceController({ apiOrigin: 'https://api.test', matrixMessaging: engine,
    loadMessagingCapabilities: async () => ({}), getSecureMessagingClient: async () => ({ client: { getLocalSecurityStatus: () => ({ status: 'unavailable' }) } }),
    fetch: async (url, init) => {
      const body = init?.body ? JSON.parse(init.body) : undefined; requests.push({ account, url, body });
      if (url.endsWith('/deletions/check')) return failRead ? new Response('', { status: 503 }) : Response.json(state(account, body.messageIds));
      if (url.endsWith('/deletions')) {
        if (failWrite) return new Response('', { status: 503 });
        if (!operations.has(body.operationId)) operations.set(body.operationId, { ...body, account, createdAt: time(now++) });
        return Response.json({ operationId: body.operationId });
      }
      if (url.includes('/chats/with/')) return Response.json(shell(account));
      if (url.includes('/chats?')) return Response.json({ items: [shell(account)], nextCursor: null });
      throw Error(`Unexpected route ${url}`);
    },
  });
  return { a: controller(alice), b: controller(bob), controller, messages, operations, requests,
    setFailWrite: value => { failWrite = value; }, setFailRead: value => { failRead = value; } };
}

test('self deletion survives controller recreation and keeps the other account copy; everyone removes received messages too', async () => {
  const f = await fixture(); const a = await f.a.openThread(alice, 'bobby');
  const next = await f.a.deleteContent(alice, a, { scope: 'self', messageId: a.messages[1].id, operationId: 'delete_self_1234' });
  assert.deepEqual(next.messages.map(m => m.id), [a.messages[0].id]);
  assert.equal((await f.b.openThread(bob, 'alice')).messages.length, 2);
  assert.equal((await f.controller(alice).openThread(alice, 'bobby')).messages.length, 1);
  await f.b.deleteContent(bob, await f.b.openThread(bob, 'alice'), { scope: 'everyone', messageId: a.messages[0].id, operationId: 'delete_all_12345' });
  assert.equal((await f.a.openThread(alice, 'bobby')).messages.length, 0);
  assert.deepEqual((await f.b.openThread(bob, 'alice')).messages.map(m => m.id), [a.messages[1].id]);
});

test('clear removes unloaded old history, hides the row, preserves newer messages and does not extend its cutoff on retry', async () => {
  const f = await fixture(); const a = await f.a.openThread(alice, 'bobby');
  const input = { scope: 'everyone', operationId: 'clear_both_12345' };
  await f.a.deleteContent(alice, a, input);
  f.messages.push(message('history_old_1234', bob, 0));
  assert.equal((await f.a.listThreads(alice)).items.length, 0);
  assert.equal((await f.b.openThread(bob, 'alice')).messages.length, 0);
  f.messages.push(message('message_new_1234', bob, 11));
  await f.a.deleteContent(alice, a, input);
  assert.deepEqual((await f.controller(alice).openThread(alice, 'bobby')).messages.map(m => m.id), ['message_new_1234']);
  assert.equal((await f.b.listThreads(bob)).items.length, 1);
  assert.equal(f.operations.size, 1);
});

test('self clear preserves peer history; search and mutations cannot resurrect a removed message', async () => {
  const f = await fixture(); const a = await f.a.openThread(alice, 'bobby');
  await f.a.deleteContent(alice, a, { scope: 'self', operationId: 'clear_self_12345' });
  assert.equal((await f.b.listThreads(bob)).items[0].messages.length, 2);
  assert.equal((await f.a.searchLocalMessages(alice, 'message')).length, 0);
  assert.equal((await f.a.reactToMessage(alice, a, a.messages[0].id, '👍')).length, 0);
  assert.equal((await f.a.editMessage(alice, a, a.messages[0].id, 'edited')).length, 0);
  assert.equal((await f.a.sendMessage(alice, a, { text: 'new' })).length, 0);
});

test('failed deletion retains history; unavailable retention checks fail closed; requests contain no text or attachments', async () => {
  const f = await fixture(); const a = await f.a.openThread(alice, 'bobby');
  f.setFailWrite(true);
  await assert.rejects(f.a.deleteContent(alice, a, { scope: 'everyone', operationId: 'failure_1234567' }));
  assert.equal(f.operations.size, 0); assert.equal(a.messages.length, 2);
  f.setFailWrite(false);
  await f.a.deleteContent(alice, a, { scope: 'self', messageId: a.messages[0].id, operationId: 'failure_1234567' });
  f.setFailRead(true);
  await assert.rejects(f.a.openThread(alice, 'bobby'), /message_visibility_failed/);
  for (const request of f.requests.filter(r => r.url.includes('/deletions'))) {
    assert.ok(!Object.keys(request.body).some(key => ['text', 'attachment', 'query', 'messages'].includes(key)));
  }
});

test('retention validation rejects corrupt metadata and removes old deleted placeholders', async () => {
  const { normalizeChatVisibility, visibleChatMessages } = await import('../src/chat-visibility.mjs');
  assert.throws(() => normalizeChatVisibility({ hasDeletions: true, clearedBefore: 'bad', deletedMessageIds: [] }));
  assert.throws(() => normalizeChatVisibility({ hasDeletions: true, clearedBefore: null, deletedMessageIds: ['bad'] }));
  assert.equal(visibleChatMessages([{ ...message('message_1234567', alice, 1), deletedAt: time(2) }]).length, 0);
});
