'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const THREAD_ID = 'thread_12345678';
const ACCOUNT_ID = 'account_alice_123';

test('host activity invalidation receives no encrypted payload and stops after disposal', async () => {
  const { subscribeEncryptedActivity } = await import('../src/messaging-surface-controller.mjs');
  let handler, removed;
  const calls = [];
  const stop = subscribeEncryptedActivity({
    on(name, listener) { assert.equal(name, 'encrypted_envelope_available'); handler = listener; },
    off(name, listener) { removed = listener; assert.equal(name, 'encrypted_envelope_available'); },
  }, (...args) => calls.push(args));
  handler({ threadId: THREAD_ID, arbitraryPayload: 'must stay in public boundary' });
  assert.deepEqual(calls, [[]]);
  stop(); handler({ threadId: THREAD_ID });
  assert.equal(removed, handler); assert.equal(calls.length, 1);
});

test('music search reads provider tracks envelopes and survives one unavailable provider', async () => {
  const { createMessagingSurfaceController } = await import('../src/messaging-surface-controller.mjs');
  let failed = false;
  const controller = createMessagingSurfaceController({ apiOrigin: 'https://api.test', getSecureMessagingClient: async () => { throw Error('unused'); }, loadMessagingCapabilities: async () => ({ enrollmentEnabled: false, rolloutEnabled: false }), fetch: async url => {
    const apple = String(url).includes('/apple/');
    if (!apple && failed) throw Error('provider unavailable');
    return Response.json({ tracks: [{ id: apple ? 'apple_1234' : 'yandex_1234', title: 'Fixture', artist: 'QA', provider: apple ? 'apple' : 'yandex' }] });
  } });
  assert.deepEqual((await controller.searchMusic('Fixture')).map(x => x.provider), ['apple', 'yandex']);
  failed = true;
  assert.deepEqual((await controller.searchMusic('Fixture')).map(x => x.provider), ['apple']);
  assert.equal((await controller.searchMusic(' ')).length, 0);
});

test('opening and refreshing a Matrix thread retain only the endpoint history availability hint', async () => {
  const { createMessagingSurfaceController } = await import('../src/messaging-surface-controller.mjs');
  let unavailable = true;
  const decorate = async (_account, value) => {
    assert.equal(value.hasUndecryptableEvents, undefined);
    assert.equal(value.hasMoreHistory, undefined);
    return { ...value, hasUndecryptableEvents: unavailable, hasMoreHistory: unavailable };
  };
  const controller = createMessagingSurfaceController({
    apiOrigin: 'https://api.example.test',
    fetch: async () => new Response(JSON.stringify({ ...thread('MATRIX_V1'), hasUndecryptableEvents: true, hasMoreHistory: true })),
    getSecureMessagingClient: async () => { throw new Error('MLS runtime must not run'); },
    loadMessagingCapabilities: async () => ({ enrollmentEnabled: false, rolloutEnabled: false }),
    matrixMessaging: { capabilities: async () => ({ enabled: true }), openThread: decorate, decorateThread: decorate },
  });
  assert.equal((await controller.openThread(ACCOUNT_ID, 'bobby')).hasUndecryptableEvents, true);
  assert.equal((await controller.openThread(ACCOUNT_ID, 'bobby', { markRead: false })).hasMoreHistory, true);
  unavailable = false;
  assert.equal((await controller.openThread(ACCOUNT_ID, 'bobby', { allowActivation: false })).hasUndecryptableEvents, false);
  assert.equal((await controller.openThread(ACCOUNT_ID, 'bobby', { allowActivation: false })).hasMoreHistory, false);
});

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
  protocolVersion: encryptionMode === 'MLS_V1' || encryptionMode === 'MATRIX_V1' ? 1 : null,
  mlsEpoch: encryptionMode === 'MLS_V1' ? '1' : null,
  encryptedSince: encryptionMode === 'MLS_V1' ? '2026-08-05T10:00:00.000Z' : null,
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
      if (String(url).endsWith('/deletions/check')) return Response.json({ hasDeletions: false, clearedBefore: null, deletedMessageIds: [] });
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

test('Matrix send stays in the public Matrix engine and never calls a legacy message route', async () => {
  const calls = [];
  const sent = [];
  const { createMessagingSurfaceController } = await import('../src/messaging-surface-controller.mjs');
  const controller = createMessagingSurfaceController({
    apiOrigin: 'https://api.example.test',
    fetch: async (...args) => { calls.push(args); throw new Error('legacy transport must not run'); },
    getSecureMessagingClient: async () => { throw new Error('MLS runtime must not run'); },
    loadMessagingCapabilities: async () => ({ enrollmentEnabled: false, rolloutEnabled: false }),
    matrixMessaging: {
      capabilities: async () => ({ enabled: true, protocol: 'MATRIX_V1' }),
      decorateThread: async (_accountId, value) => value,
      decorateThreads: async (_accountId, values) => values,
      openThread: async (_accountId, value) => value,
      sendMessage: async (accountId, value, draft) => {
        sent.push({ accountId, threadId: value.id, draft });
        return [{
          id: 'message_matrix_123',
          threadId: value.id,
          senderAccountId: accountId,
          text: draft.text,
          createdAt: '2026-08-14T00:00:00.000Z',
          reactions: [],
          securityMode: 'e2ee',
        }];
      },
      editMessage: async () => [],
      reactToMessage: async () => [],
      searchLocalMessages: async () => [],
      subscribe: async () => () => undefined,
      release: async () => undefined,
    },
  });
  const messages = await controller.sendMessage(ACCOUNT_ID, thread('MATRIX_V1'), { text: 'matrix секрет' });
  assert.equal(messages[0].securityMode, 'e2ee');
  assert.deepEqual(sent, [{ accountId: ACCOUNT_ID, threadId: THREAD_ID, draft: { text: 'matrix секрет' } }]);
  assert.equal(calls.length, 0);
});

test('Matrix music send converts stale provider widgets into stable credential-free playback URLs', async () => {
  const sent = [];
  const artworkCacheCalls = [];
  const { createMessagingSurfaceController } = await import('../src/messaging-surface-controller.mjs');
  const controller = createMessagingSurfaceController({
    apiOrigin: 'https://volna.example',
    fetch: async (url, init) => {
      assert.equal(String(url), 'https://volna.example/music/artwork/cache');
      artworkCacheCalls.push({ init, url: String(url) });
      return new Response(JSON.stringify({
        artworkUrl: 'https://media.volna.social/music/external-artwork/a123-300.webp',
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
    getSecureMessagingClient: async () => { throw new Error('MLS runtime must not run'); },
    loadMessagingCapabilities: async () => ({ enrollmentEnabled: false, rolloutEnabled: false }),
    matrixMessaging: {
      capabilities: async () => ({ enabled: true, protocol: 'MATRIX_V1' }),
      decorateThread: async (_accountId, value) => value,
      decorateThreads: async (_accountId, values) => values,
      openThread: async (_accountId, value) => value,
      sendMessage: async (_accountId, _thread, draft) => { sent.push(draft); return []; },
      editMessage: async () => [], reactToMessage: async () => [], searchLocalMessages: async () => [],
      subscribe: async () => () => undefined, release: async () => undefined,
    },
  });
  const attachment = {
    kind: 'music', provider: 'bandcamp', id: 'saved_track_123', title: 'Love Is Law (Reprise)', artist: 'CRUSH OF SOULS',
    metadata: {
      artworkUrl: 'https://f4.bcbits.com/img/a1234567890_10.jpg',
      previewUrl: 'https://bandcamp.com/EmbeddedPlayer/v=2/track=3990015078/size=large/',
      externalUrl: 'https://avantrecords.bandcamp.com/track/love-is-law-reprise',
    },
  };
  await controller.sendMessage(ACCOUNT_ID, thread('MATRIX_V1'), { attachment });
  assert.equal(artworkCacheCalls.length, 1);
  assert.equal(artworkCacheCalls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(artworkCacheCalls[0].init.body), { url: 'https://f4.bcbits.com/img/a1234567890_10.jpg' });
  assert.equal(sent[0].attachment.metadata.previewUrl, 'https://volna.example/music/bandcamp/stream?url=https%3A%2F%2Favantrecords.bandcamp.com%2Ftrack%2Flove-is-law-reprise&trackId=3990015078');
  assert.equal(sent[0].attachment.metadata.artworkUrl, 'https://media.volna.social/music/external-artwork/a123-300.webp');
  assert.match(controller.resolveMusicArtwork(attachment), /^https:\/\/media\.volna\.social\/music\/external-artwork\/[a-f0-9]{64}-300\.webp$/);
  assert.deepEqual(controller.resolveMusicPlayback(attachment), {
    previewUrl: 'https://volna.example/music/bandcamp/stream?url=https%3A%2F%2Favantrecords.bandcamp.com%2Ftrack%2Flove-is-law-reprise&trackId=3990015078',
    externalUrl: 'https://avantrecords.bandcamp.com/track/love-is-law-reprise',
  });
  assert.deepEqual(controller.resolveMusicPlayback({
    kind: 'music', provider: 'soundcloud', id: 'saved_set_123', title: 'Миксы', artist: 'Артист',
    metadata: { previewUrl: 'https://soundcloud.com/artist/sets/mixes', externalUrl: 'https://soundcloud.com/artist/sets/mixes' },
  }), {
    previewUrl: null,
    externalUrl: 'https://soundcloud.com/artist/sets/mixes',
  });
  for (const previewUrl of [
    'https://bandcamp.com/EmbeddedPlayer/album=123/size=large/',
    'https://artist.bandcamp.com/EmbeddedPlayer/track=123/size=large/',
  ]) {
    assert.deepEqual(controller.resolveMusicPlayback({
      kind: 'music', provider: 'bandcamp', id: 'saved_release_without_track_id', title: 'Релиз', artist: 'Артист',
      metadata: { previewUrl },
    }), { previewUrl: null, externalUrl: null });
  }
  for (const lookalikePreviewUrl of [
    'https://media.example/bandcamp.com/EmbeddedPlayer/audio.mp3',
    'https://bandcamp.com.evil.example/EmbeddedPlayer/audio.mp3',
    'https://bandcamp.com@evil.example/EmbeddedPlayer/audio.mp3',
  ]) {
    assert.deepEqual(controller.resolveMusicPlayback({
      kind: 'music', provider: 'bandcamp', id: 'saved_release_without_track_id', title: 'Релиз', artist: 'Артист',
      metadata: { previewUrl: lookalikePreviewUrl },
    }), { previewUrl: lookalikePreviewUrl, externalUrl: null });
  }
});

test('Matrix music send reuses existing VOLNA artwork without creating another cache object', async () => {
  const sent = [];
  const calls = [];
  const { createMessagingSurfaceController } = await import('../src/messaging-surface-controller.mjs');
  const controller = createMessagingSurfaceController({
    apiOrigin: 'https://volna.example',
    fetch: async (...args) => { calls.push(args); throw new Error('artwork cache must not run'); },
    getSecureMessagingClient: async () => { throw new Error('MLS runtime must not run'); },
    loadMessagingCapabilities: async () => ({ enrollmentEnabled: false, rolloutEnabled: false }),
    matrixMessaging: {
      capabilities: async () => ({ enabled: true, protocol: 'MATRIX_V1' }),
      decorateThread: async (_accountId, value) => value,
      decorateThreads: async (_accountId, values) => values,
      openThread: async (_accountId, value) => value,
      sendMessage: async (_accountId, _thread, draft) => { sent.push(draft); return []; },
      editMessage: async () => [], reactToMessage: async () => [], searchLocalMessages: async () => [],
      subscribe: async () => () => undefined, release: async () => undefined,
    },
  });
  const artworkUrl = 'https://media.volna.social/music/uploaded_track_123-artwork.webp';
  await controller.sendMessage(ACCOUNT_ID, thread('MATRIX_V1'), {
    attachment: {
      kind: 'music', provider: 'volna', id: 'uploaded:uploaded_track_123', title: 'VOLNA track', artist: 'Artist',
      metadata: { artworkUrl, previewUrl: 'https://volna.example/my-music/stream/uploaded_track_123' },
    },
  });
  assert.equal(calls.length, 0);
  assert.equal(sent[0].attachment.metadata.artworkUrl, artworkUrl);
});

test('music picker exposes uploaded tracks and expands saved releases into playable track attachments', async () => {
  const { createMessagingSurfaceController } = await import('../src/messaging-surface-controller.mjs');
  const controller = createMessagingSurfaceController({
    apiOrigin: 'https://volna.example',
    fetch: async (url) => {
      assert.equal(String(url), 'https://volna.example/my-music');
      return new Response(JSON.stringify({
        tracks: [{ id: 'uploaded_track_123', status: 'READY', title: 'Загруженный трек', artist: 'VOLNA Artist', artworkUrl: null, publicUrl: 'https://media.volna.social/music/uploaded.m4a', durationSeconds: 90 }],
        profileTracks: [{
          id: 'saved_release_123', provider: 'bandcamp', title: 'Альбом', artist: 'Артист',
          artworkUrl: 'https://f4.bcbits.com/img/a1234567890_10.jpg',
          previewUrl: 'https://bandcamp.com/EmbeddedPlayer/v=2/album=123/size=large/',
          externalUrl: 'https://artist.bandcamp.com/album/release',
          releaseMetadata: {
            externalUrl: 'https://artist.bandcamp.com/album/release',
            tracks: [
              { id: '123456789', title: 'Первый', artist: 'Артист', previewUrl: 'https://t4.bcbits.com/stream/hash/mp3-128/123456789', externalUrl: 'https://artist.bandcamp.com/track/first' },
              { id: '987654321', title: 'Второй', artist: 'Артист', previewUrl: 'https://t4.bcbits.com/stream/hash/mp3-128/987654321', externalUrl: 'https://artist.bandcamp.com/track/second' },
            ],
          },
        }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
    getSecureMessagingClient: async () => { throw new Error('not used'); },
    loadMessagingCapabilities: async () => ({ enrollmentEnabled: false, rolloutEnabled: false }),
  });
  const tracks = await controller.loadOwnMusic();
  assert.deepEqual(tracks.map(({ provider, title }) => ({ provider, title })), [
    { provider: 'volna', title: 'Загруженный трек' },
    { provider: 'bandcamp', title: 'Первый' },
    { provider: 'bandcamp', title: 'Второй' },
  ]);
  assert.equal(tracks[0].previewUrl, 'https://volna.example/my-music/stream/uploaded_track_123');
  assert.equal(tracks[1].previewUrl, 'https://volna.example/music/bandcamp/stream?url=https%3A%2F%2Fartist.bandcamp.com%2Falbum%2Frelease&trackId=123456789');
  assert.equal(tracks[2].previewUrl, 'https://volna.example/music/bandcamp/stream?url=https%3A%2F%2Fartist.bandcamp.com%2Falbum%2Frelease&trackId=987654321');
  assert.equal(tracks[1].artworkUrl, 'https://f4.bcbits.com/img/a1234567890_10.jpg');
});

test('message search stays in the public endpoint client and never sends the query to the API', async () => {
  const { calls, controller } = await controllerFixture();
  const results = await controller.searchLocalMessages(ACCOUNT_ID, 'СЕКРЕТ');
  assert.equal(results.length, 1);
  assert.equal(results[0].threadId, THREAD_ID);
  assert.equal(results[0].message.text, 'секрет');
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(calls[0].init.body), { messageIds: [results[0].message.id] });
  assert.ok(!JSON.stringify(calls).toLowerCase().includes('секрет'));
});

test('a server downgrade after a known MLS thread fails closed without a plaintext POST', async () => {
  const { calls, controller } = await controllerFixture();
  await controller.sendMessage(ACCOUNT_ID, thread('MLS_V1'), { text: 'первое' });
  await assert.rejects(
    controller.sendMessage(ACCOUNT_ID, thread('E2EE_PENDING'), { text: 'не отправлять' }),
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

test('pending encryption cannot send, edit or react over an HTTP content route', async () => {
  const { calls, controller, sentEvents } = await controllerFixture({ localThreadSecure: false });
  for (const attempt of [
    () => controller.sendMessage(ACCOUNT_ID, thread('E2EE_PENDING'), { text: 'private draft' }),
    () => controller.editMessage(ACCOUNT_ID, thread('E2EE_PENDING'), 'message_12345678', 'private edit'),
    () => controller.reactToMessage(ACCOUNT_ID, thread('E2EE_PENDING'), 'message_12345678', '❤️'),
  ]) await assert.rejects(attempt(), error => error.code === 'encrypted_messaging_unavailable');
  assert.equal(sentEvents.length, 0);
  assert.equal(calls.length, 0);
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
