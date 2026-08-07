'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const THREAD_ID = 'thread_12345678';
const ACCOUNT_ID = 'account_alice_123';

const thread = (encryptionMode) => ({
  id: THREAD_ID,
  partner: {
    id: 'account_bobby_123',
    username: 'bobby',
    name: 'Bobby',
    avatarUrl: null,
    isVerified: false,
  },
  lastMessageText: null,
  lastMessageAt: null,
  unreadCount: 0,
  lastReadAt: null,
  encryptionMode,
  protocolVersion: encryptionMode === 'MLS_V1' ? 1 : null,
  mlsEpoch: encryptionMode === 'MLS_V1' ? '1' : null,
  encryptedSince: encryptionMode === 'MLS_V1' ? '2026-08-05T10:00:00.000Z' : null,
  legacyHistoryOnly: false,
  messages: [],
});

async function controllerFixture({ localThreadSecure = true } = {}) {
  const calls = [];
  const sentEvents = [];
  const secureClient = {
    getLocalSecurityStatus: () => ({ status: 'ready' }),
    getThreadSecurityStatus: () => localThreadSecure
      ? ({ status: 'secure', epoch: '1', groupId: 'group_12345678', memberDeviceIds: ['device_12345678'] })
      : ({ status: 'unknown' }),
    createMessageEvent: (draft) => ({ v: 1, kind: 'message.create', logicalMessageId: 'message_local_123', clientCreatedAt: '2026-08-05T10:01:00.000Z', ...draft }),
    sendEvent: async (threadId, event) => { sentEvents.push({ threadId, event }); },
    getMessages: () => [{
      id: 'message_local_123',
      senderAccountId: ACCOUNT_ID,
      clientCreatedAt: '2026-08-05T10:01:00.000Z',
      createdAt: '2026-08-05T10:01:01.000Z',
      text: 'секрет',
      reactions: [],
    }],
    searchMessages: (query) => query.toLocaleLowerCase('ru-RU').includes('секрет') ? [{
      threadId: THREAD_ID,
      message: {
        id: 'message_local_123',
        senderAccountId: ACCOUNT_ID,
        clientCreatedAt: '2026-08-05T10:01:00.000Z',
        createdAt: '2026-08-05T10:01:01.000Z',
        text: 'секрет',
        reactions: [],
      },
    }] : [],
  };
  const { createMessagingSurfaceController } = await import('../src/messaging-surface-controller.mjs');
  const controller = createMessagingSurfaceController({
    apiOrigin: 'https://api.example.test',
    fetch: async (url, init = {}) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith(`/chats/${THREAD_ID}/messages`)) {
        return new Response(JSON.stringify({
          id: 'message_legacy_123',
          threadId: THREAD_ID,
          senderId: ACCOUNT_ID,
          text: JSON.parse(init.body).text,
          createdAt: '2026-08-05T10:02:00.000Z',
          editedAt: null,
          reactions: [],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      throw new Error(`unexpected request: ${url}`);
    },
    getSecureMessagingClient: async () => ({ client: secureClient }),
    loadMessagingCapabilities: async () => ({ enrollmentEnabled: true, rolloutEnabled: true }),
  });
  return { calls, controller, sentEvents };
}

test('MLS send keeps plaintext inside the public secure client and never calls a legacy message route', async () => {
  const { calls, controller, sentEvents } = await controllerFixture();
  const messages = await controller.sendMessage(ACCOUNT_ID, thread('MLS_V1'), { text: 'секрет' });
  assert.equal(messages[0].text, 'секрет');
  assert.deepEqual(sentEvents, [{
    threadId: THREAD_ID,
    event: {
      v: 1,
      kind: 'message.create',
      logicalMessageId: 'message_local_123',
      clientCreatedAt: '2026-08-05T10:01:00.000Z',
      text: 'секрет',
    },
  }]);
  assert.equal(calls.some(({ url }) => url.includes(`/chats/${THREAD_ID}/messages`)), false);
});

test('message search stays in the public endpoint client and never sends the query to the API', async () => {
  const { calls, controller } = await controllerFixture();
  const results = await controller.searchLocalMessages(ACCOUNT_ID, 'СЕКРЕТ');
  assert.equal(results.length, 1);
  assert.equal(results[0].threadId, THREAD_ID);
  assert.equal(results[0].message.text, 'секрет');
  assert.equal(calls.length, 0);
});

test('a server downgrade after a known MLS thread fails closed without a plaintext POST', async () => {
  const { calls, controller } = await controllerFixture();
  await controller.sendMessage(ACCOUNT_ID, thread('MLS_V1'), { text: 'первое' });
  await assert.rejects(
    controller.sendMessage(ACCOUNT_ID, thread('LEGACY_PLAINTEXT'), { text: 'не отправлять' }),
    (error) => error?.code === 'thread_downgrade',
  );
  assert.equal(calls.length, 0);
});

test('an unknown MLS protocol version fails closed before transport', async () => {
  const { calls, controller, sentEvents } = await controllerFixture();
  await assert.rejects(
    controller.sendMessage(ACCOUNT_ID, { ...thread('MLS_V1'), protocolVersion: 2 }, { text: 'не отправлять' }),
    (error) => error?.code === 'unsupported_protocol',
  );
  assert.equal(calls.length, 0);
  assert.equal(sentEvents.length, 0);
});

test('an explicitly legacy thread uses only the isolated legacy adapter', async () => {
  const { calls, controller, sentEvents } = await controllerFixture({ localThreadSecure: false });
  const messages = await controller.sendMessage(ACCOUNT_ID, thread('LEGACY_PLAINTEXT'), { text: 'обычный чат' });
  assert.equal(sentEvents.length, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `https://api.example.test/chats/${THREAD_ID}/messages`);
  assert.equal(JSON.parse(calls[0].init.body).text, 'обычный чат');
  assert.equal(messages[0].securityMode, 'legacy');
});

test('account resolution stays in the public controller for embedded share surfaces', async () => {
  const { createMessagingSurfaceController } = await import('../src/messaging-surface-controller.mjs');
  const controller = createMessagingSurfaceController({
    apiOrigin: 'https://api.example.test',
    fetch: async (url, init) => {
      assert.equal(String(url), 'https://api.example.test/auth/me');
      assert.equal(new Headers(init.headers).get('authorization'), 'Bearer session_token_123');
      return new Response(JSON.stringify({ account: { id: ACCOUNT_ID } }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
    getAccessToken: () => 'session_token_123',
    getSecureMessagingClient: async () => { throw new Error('not used'); },
    loadMessagingCapabilities: async () => ({ enrollmentEnabled: false, rolloutEnabled: false }),
  });
  assert.equal(await controller.resolveOwnAccountId(), ACCOUNT_ID);
});
