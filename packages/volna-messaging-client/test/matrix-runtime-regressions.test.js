'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { normalizeContentEvent } = require('../src');

// Execute the actual private engine closures, with only their platform/network
// boundaries replaced. No copied queue/send implementation and no real accounts.
function closures(file, names, bindings) {
  const text = fs.readFileSync(path.join(__dirname, '../src', file), 'utf8');
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const nodes = new Map();
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && names.includes(node.name.text)) nodes.set(node.name.text, node);
    if (ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text)) nodes.set(node.name.text, node);
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && ts.isIdentifier(node.left) && names.includes(node.left.text)) nodes.set(node.left.text, node);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  const code = names.map(name => { assert.ok(nodes.has(name), name); const node = nodes.get(name); return ts.isVariableDeclaration(node) || ts.isBinaryExpression(node) ? `const ${node.getText(ast)};` : node.getText(ast); }).join('\n');
  const js = ts.transpileModule(`${code}\nmodule.exports = { ${names.join(', ')} };`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const context = { ...bindings, module: { exports: {} }, TextEncoder, TextDecoder, Uint8Array, URL, Date, JSON, AbortSignal, __DEV__: false };
  vm.runInNewContext(js, context, { filename: file });
  return context.module.exports;
}

test('Web page opening waits for SDK decryption and rejects a retired session before projection', async () => {
  for (const retired of [false, true]) {
    let finish, projected = false, active = true, started;
    const decryption = new Promise(resolve => { finish = resolve; });
    const decryptStarted = new Promise(resolve => { started = resolve; });
    const encrypted = { getWireType: () => 'm.room.encrypted' };
    const room = { getLiveTimeline: () => ({ getEvents: () => [encrypted, { getWireType: () => 'm.room.member' }] }) };
    const handle = { credentials: { userId: '@own:test' }, deviceKey: {}, roomByThreadId: new Map(), threadById: new Map(), client: {
      getCrypto() { return {}; }, joinRoom: async () => {}, scrollback: async (_room, limit) => { assert.equal(limit, 100); },
      decryptEventIfNeeded(event) { assert.equal(event, encrypted); started(); return decryption; },
    } };
    const engine = closures('matrix-engine-web.ts', ['openThread'], {
      capabilities: async () => ({ enabled: true }), request: async () => ({ ok: true, json: async () => ({ roomId: '!room:test', ownMatrixUserId: '@own:test', partnerMatrixUserId: '@peer:test' }) }),
      getHandle: async () => handle, matrixServerName: () => 'test', matrixUserIdForAccount: () => '@peer:test',
      requireMatrixRecipientCrypto: () => ({ bindRoomKeyRecipients: async () => {} }), assertRoomContract: async () => room,
      assertMatrixKeyActive() { if (!active) throw Error('retired'); }, matrixThread() { projected = true; return {}; },
    });
    const task = engine.openThread('account', { id: 'thread', partner: { id: 'peer' } });
    await decryptStarted; assert.equal(projected, false);
    active = !retired; finish();
    if (retired) { await assert.rejects(task, /retired/); assert.equal(projected, false); }
    else { await task; assert.equal(projected, true); }
  }
});

test('history pagination coalesces, preserves a measured anchor and fences departed screens', async () => {
  for (const outcome of ['success', 'moved', 'failure', 'departed']) {
    let resolve, reject, calls = 0, committed, error = false, refresh = 0;
    const pending = new Promise((yes, no) => { resolve = yes; reject = no; });
    const historyBusy = { current: false }, openRevision = { current: 4 }, historyAnchor = { current: null }, historyOffset = { current: 15 };
    const engine = closures('react-native-messages.tsx', ['loadEarlier'], {
      thread: { hasMoreHistory: true, messages: [{ id: 'old' }] }, historyBusy, openRevision, historyAnchor,
      historyScrollArmed: { current: true }, nearBottom: { current: true },
      historyRowY: { current: new Map([['old', 60]]) }, historyOffset,
      historyRefreshQueued: { current: true }, accountId: 'fixture', partnerUsername: 'peer',
      controller: { openThread: async (_account, _peer, options) => { calls++; assert.equal(options.markRead, false); assert.equal(options.loadEarlier, true); return pending; } },
      setHistoryLoading() {}, setHistoryError: value => { error = value; }, setThread: value => { committed = value; },
      open: () => { refresh++; },
    });
    const first = engine.loadEarlier();
    await engine.loadEarlier(); assert.equal(calls, 1);
    if (outcome === 'moved') historyOffset.current = 70;
    if (outcome === 'departed') openRevision.current++;
    if (outcome === 'failure') reject(Error('transport')); else resolve({ messages: [{ id: 'older' }, { id: 'old' }] });
    await first;
    if (outcome === 'success' || outcome === 'moved') {
      assert.equal(committed.messages[0].id, 'older');
      assert.equal(JSON.stringify(historyAnchor.current), JSON.stringify({ id: 'old', y: 60, offset: historyOffset.current }));
      assert.equal(refresh, 1); assert.equal(historyBusy.current, false);
    } else {
      assert.equal(committed, undefined); assert.equal(historyAnchor.current, null);
      assert.equal(error, outcome === 'failure');
      assert.equal(refresh, outcome === 'failure' ? 1 : 0);
    }
  }
});

test('Web history availability follows the SDK cursor even on empty projected pages', async () => {
  let cursor = 'opaque_cursor';
  const engine = closures('matrix-engine-web.ts', ['matrixThread'], { messagesForRoom: async () => [] });
  const handle = { client: { getRoom: () => ({ getLiveTimeline: () => ({ getEvents: () => [], getPaginationToken: direction => { assert.equal(direction, 'b'); return cursor; } }) }) } };
  assert.equal((await engine.matrixThread(handle, { messages: [] }, '!room:test')).hasMoreHistory, true);
  cursor = null;
  assert.equal((await engine.matrixThread(handle, { messages: [] }, '!room:test')).hasMoreHistory, false);
});

async function nativeHistoryFixture(count = 3200) {
  const { projectMatrixContentEvents } = await import('../src/matrix-event-policy.mjs');
  const { encodeMatrixMessageContent, decodeMatrixMessageContent } = await import('../src/matrix-message-codec.mjs');
  const { messagePreview } = await import('../src/messaging-surface-controller.mjs');
  const thread = { id: 'thread_history', partner: { id: 'account_bobby' }, encryptionMode: 'MATRIX_V1', messages: [], lastReadAt: null };
  const roomId = '!history:example.org';
  const handle = { active: true, accountId: 'account_alice', deviceKey: new Uint8Array(32),
    credentials: { userId: '@account_alice:example.org', deviceId: 'device_alice', expiresAt: Date.now() + 600000 },
    roomByThreadId: new Map(), threadByRoomId: new Map(), recordsByThreadId: new Map(),
    pendingByLogicalId: new Map(), listeners: new Set(), refreshPromise: null };
  const all = Array.from({ length: count }, (_, i) => {
    const event = { v: 1, kind: 'message.create', logicalMessageId: `message_history_${String(i).padStart(5, '0')}`,
      clientCreatedAt: new Date(1800000000000 + i * 1000).toISOString(), text: `История ${i}` };
    return { authenticated: true, eventId: `$history_${i}`, senderUserId: '@account_bobby:example.org', timestamp: 1800000000000 + i * 1000,
      contentJson: JSON.stringify(encodeMatrixMessageContent(event, { body: 'fixture', deviceId: 'device_bobby' })) };
  });
  let loaded = Math.min(100, count), revision = 0, timelineId = 'timeline_first', pages = 0, failPage = false, gate, validations = 0, restarts = 0;
  let afterContract = async () => {}, flush = async () => {};
  const snapshot = () => ({ accountId: handle.accountId, roomId, timelineId, revision: ++revision,
    hasMoreHistory: loaded < all.length, hasUndecryptableEvents: false, events: all.slice(-loaded) });
  const nativeBridge = {
    bindRoomKeyRecipients: async () => {}, openRoom: async () => snapshot(), closeRoom: async () => {},
    paginateRoom: async (_account, _room, limit) => {
      assert.equal(limit, 100); pages++; if (gate) await gate;
      if (failPage) throw Error('page offline');
      loaded = Math.min(all.length, loaded + limit); return snapshot();
    },
  };
  const engine = closures('matrix-engine-native.ts', ['openNativeRoom', 'admitNativeTimeline', 'processNativeSnapshot', 'matrixThread', 'projectedMessages'], {
    nativeBridge, requireNativeRoomRuntime() {}, assertMatrixKeyActive() { if (!handle.active) throw Error('closed'); },
    SAFE_ID: /^[\w-]+$/, SAFE_ROOM_ID: /^!/, SAFE_EVENT_ID: /^\$/, SAFE_MATRIX_USER_ID: /^@/,
    handles: new Map([[handle.accountId, Promise.resolve(handle)]]),
    matrixServerName: () => 'example.org', matrixUserIdForAccount: id => `@${id}:example.org`,
    matrixDeviceProjectionId: (_user, id) => id, matrixEnvelopeId: id => id.replace('$', 'envelope_'),
    decodeMatrixMessageContent, normalizeContentEvent, projectMatrixContentEvents, messagePreview,
    assertRoomContract: async () => { validations++; await afterContract(); }, flushPendingForThread: () => flush(), notifyThread() {},
  });
  return { engine, thread, roomId, handle, all, nativeBridge, snapshot,
    get pages() { return pages; }, get validations() { return validations; },
    set failPage(value) { failPage = value; }, set gate(value) { gate = value; },
    resetTimeline() { loaded = Math.min(100, count); timelineId = `timeline_restart_${++restarts}`; revision = 0; },
    set loaded(value) { loaded = value; },
    set afterContract(value) { afterContract = value; }, set flush(value) { flush = value; },
  };
}

test('native QR bridge validates bounded state and fences completion after logout', async () => {
  const { base64UrlToBytes } = await import('../src/mls-runtime.mjs');
  const common = { SAFE_ID: /^[A-Za-z0-9_-]{8,80}$/, SAFE_MATRIX_USER_ID: /^@[a-z]+:test$/,
    base64UrlToBytes, objectRecord(value) { assert.ok(value && typeof value === 'object'); return value; } };
  const { normalizeNativeVerification } = closures('matrix-engine-native.ts', ['normalizeNativeVerification'], common);
  const original = { id: 'verify_123', phase: 'ready', initiatedByMe: true, otherUserId: '@peer:test',
    otherDeviceId: 'device_123', sasDecimal: null, sasEmoji: [], qrCodeBase64: null, qrSupported: false };
  assert.equal(normalizeNativeVerification(original).qrSupported, false, 'old native builds retain SAS');
  const qr = Buffer.from('MATRIX test-only QR').toString('base64url');
  assert.equal(normalizeNativeVerification({ ...original, qrSupported: true, qrCodeBase64: qr }).qrCodeBase64, qr);
  assert.equal(normalizeNativeVerification({ ...original, phase: 'started', qrSupported: true, qrNeedsConfirmation: true }).qrNeedsConfirmation, true);
  for (const invalid of [
    { qrCodeBase64: qr }, { qrNeedsConfirmation: true }, { qrSupported: true, qrNeedsConfirmation: true },
    { qrSupported: true, qrCodeBase64: 'a'.repeat(3000) }, { qrSupported: true, qrCodeBase64: 'YWJj=' },
    { qrSupported: true, qrCodeBase64: 'A' }, { qrSupported: 'true' }, { qrNeedsConfirmation: 1 },
  ]) assert.throws(() => normalizeNativeVerification({ ...original, ...invalid }));

  let runtime = { features: ['qr-verification-v1'] }, calls = 0, finish;
  const handle = { active: true, accountId: 'account_123', deviceKey: new Uint8Array(32) };
  const bridge = { generateQrVerification: async (accountId, id) => { assert.equal(accountId, handle.accountId); assert.equal(id, original.id); calls++; return original; },
    scanQrVerification: async (_account, _id, data) => { assert.equal(data, qr); calls++; return original; } };
  const engine = closures('matrix-engine-native.ts', ['verificationAction', 'qrVerification'], {
    nativeBridge: bridge, requireNativeSecurityRuntime: () => runtime, base64UrlToBytes, normalizeNativeVerification,
    getHandle: async () => handle, assertMatrixKeyActive: key => assert.equal(key, handle.deviceKey),
    safeIdentifier: value => { assert.match(value, common.SAFE_ID); return value; },
  });
  await engine.qrVerification(handle.accountId, original.id);
  await engine.qrVerification(handle.accountId, original.id, qr);
  assert.equal(calls, 2);
  assert.throws(() => engine.qrVerification(handle.accountId, original.id, 'A'));
  runtime = { features: [] };
  assert.throws(() => engine.qrVerification(handle.accountId, original.id), /не поддерживает/);
  assert.equal(calls, 2, 'invalid payload or unavailable feature never enters the bridge');
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const pending = engine.verificationAction(handle.accountId, original.id, () => new Promise(resolve => { finish = resolve; entered(); }));
  await started; handle.active = false; finish(original);
  await assert.rejects(pending, /no longer active/);
});

test('native first-use security waits for exact published keys without trusting or reviving a retired endpoint', async () => {
  const { waitForPublishedMatrixDevice } = await import('../src/matrix-device-publication.mjs');
  for (const outcome of ['published', 'already-published', 'changed', 'retired', 'incomplete']) {
    const userId = '@own:test', deviceId = 'current_device';
    const ed = Buffer.alloc(32, 1).toString('base64'), curve = Buffer.alloc(32, 2).toString('base64');
    const handle = { accountId: 'account', active: true, deviceKey: {}, credentials: { userId, deviceId } };
    let calls = 0;
    const engine = closures('matrix-engine-native.ts', ['getRoomSecurity'], {
      requireNativeSecurityRuntime() {}, getHandle: async () => handle,
      assertMatrixKeyActive() { assert.equal(handle.active, true); },
      waitForPublishedMatrixDevice,
      nativeBridge: { getSecurityState: async () => ({ cryptoVersion: 'test', crossSigningReady: false, secretStorageReady: false,
        currentDevice: { userId, deviceId, ed25519: ed, curve25519: curve },
        identities: [{ userId, masterKey: null, verified: false, changed: false }], pendingVerification: null }) },
      matrixAuthedRequest: async () => {
        calls++;
        if (calls === 2 && outcome === 'retired') handle.active = false;
        const present = calls > 1 || outcome === 'already-published';
        return { failures: outcome === 'incomplete' ? { test: {} } : {}, device_keys: { [userId]: present ? {
          [deviceId]: { user_id: userId, device_id: deviceId,
            keys: { [`ed25519:${deviceId}`]: outcome === 'changed' ? curve : ed, [`curve25519:${deviceId}`]: curve },
            algorithms: ['m.olm.v1.curve25519-aes-sha2', 'm.megolm.v1.aes-sha2'] },
        } : {} } };
      },
      objectRecord(value) { if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('invalid record'); return value; },
      optionalObjectRecord: value => value ?? {}, SAFE_MATRIX_USER_ID: /^@.+:.+$/, SAFE_ID: /^[a-z_]+$/,
      MATRIX_ENCRYPTION_ALGORITHM: 'm.megolm.v1.aes-sha2', matrixBase64ToBytes(value) { assert.equal(Buffer.from(value, 'base64').length, 32); },
      hasRecoveryKey: async () => false,
    });
    if (outcome === 'changed') await assert.rejects(engine.getRoomSecurity('account', null), /не совпадают/);
    else if (outcome === 'retired') await assert.rejects(engine.getRoomSecurity('account', null), /session is closed/);
    else if (outcome === 'incomplete') await assert.rejects(engine.getRoomSecurity('account', null), /query was incomplete/);
    else {
      const security = await engine.getRoomSecurity('account', null);
      assert.equal(security.ownDevices.length, 1);
      assert.equal(security.ownDevices[0].current, true);
      assert.equal(security.ownDevices[0].verified, false);
      assert.equal(security.ownDevices[0].signedByOwner, false);
    }
    assert.equal(calls, ['already-published', 'incomplete'].includes(outcome) ? 1 : 2);
  }
});

test('native paginates 3200 messages with complete order and preserves old-target edits/reactions', async () => {
  const h = await nativeHistoryFixture();
  let result = await h.engine.openNativeRoom(h.handle, h.thread, h.roomId);
  assert.equal(result.messages.length, 100); assert.equal(result.hasMoreHistory, true);
  while (result.hasMoreHistory) {
    result = await h.engine.openNativeRoom(h.handle, h.thread, h.roomId, undefined, true);
  }
  assert.equal(h.pages, 31); assert.equal(result.messages.length, 3200);
  assert.deepEqual(Array.from(result.messages, m => m.text), Array.from({ length: 3200 }, (_, i) => `История ${i}`));
  assert.equal(h.validations, 64, 'recheck room contract after every page and initial timeline admission');
  const { encodeMatrixMessageContent } = await import('../src/matrix-message-codec.mjs');
  for (const [i, change] of [
    { v: 1, kind: 'message.edit', logicalMessageId: 'edit_history_first', targetLogicalMessageId: 'message_history_00000', text: 'Исправлено', clientCreatedAt: new Date(1800010000000).toISOString() },
    { v: 1, kind: 'message.reaction', logicalMessageId: 'react_history_first', targetLogicalMessageId: 'message_history_00000', emoji: '🔥', clientCreatedAt: new Date(1800010000001).toISOString() },
  ].entries()) {
    h.all.push({ authenticated: true, eventId: `$change_${i}`, senderUserId: '@account_bobby:example.org', timestamp: 1800010000000 + i,
      contentJson: JSON.stringify(encodeMatrixMessageContent(change, { body: 'fixture', deviceId: 'device_bobby' })) });
  }
  h.loaded = h.all.length;
  await h.engine.processNativeSnapshot(h.snapshot());
  result = h.engine.matrixThread(h.handle, h.thread);
  assert.equal(result.messages.length, 3200); assert.equal(result.messages[0].text, 'Исправлено');
  assert.equal(result.messages[0].reactions[0].emoji, '🔥');
  await h.engine.openNativeRoom(h.handle, h.thread, h.roomId, undefined, true);
  assert.equal(h.pages, 31, 'reaching the start stops network pagination');
});

test('native page requests coalesce, retain loaded rows on failure and reject late/foreign snapshots', async () => {
  const h = await nativeHistoryFixture(400);
  await h.engine.openNativeRoom(h.handle, h.thread, h.roomId);
  let finish; h.gate = new Promise(resolve => { finish = resolve; });
  const pending = Array.from({ length: 12 }, () => h.engine.openNativeRoom(h.handle, h.thread, h.roomId, undefined, true));
  await new Promise(resolve => setImmediate(resolve)); assert.equal(h.pages, 1);
  finish(); await Promise.all(pending); h.gate = null;
  assert.equal(h.engine.matrixThread(h.handle, h.thread).messages.length, 200);
  h.failPage = true;
  await assert.rejects(h.engine.openNativeRoom(h.handle, h.thread, h.roomId, undefined, true), /offline/);
  assert.equal(h.engine.matrixThread(h.handle, h.thread).messages.length, 200);
  assert.equal(h.engine.matrixThread(h.handle, h.thread).hasMoreHistory, true);
  h.failPage = false;
  await h.engine.openNativeRoom(h.handle, h.thread, h.roomId, undefined, true);
  assert.equal(h.engine.matrixThread(h.handle, h.thread).messages.length, 300);
  const stale = h.snapshot(); stale.revision = 0; stale.events = [];
  await h.engine.processNativeSnapshot(stale);
  await h.engine.processNativeSnapshot({ ...h.snapshot(), timelineId: 'retired_timeline', events: [] });
  await h.engine.processNativeSnapshot({ ...h.snapshot(), accountId: 'account_foreign', events: [] });
  assert.equal(h.engine.matrixThread(h.handle, h.thread).messages.length, 300);
  h.handle.active = false;
  await assert.rejects(h.engine.openNativeRoom(h.handle, h.thread, h.roomId, undefined, true), /closed/);
});

test('native late page completion after logout is fenced before it can replace accepted history', async () => {
  const h = await nativeHistoryFixture(500);
  await h.engine.openNativeRoom(h.handle, h.thread, h.roomId);
  let finish; h.gate = new Promise(resolve => { finish = resolve; });
  const pending = h.engine.openNativeRoom(h.handle, h.thread, h.roomId, undefined, true);
  await new Promise(resolve => setImmediate(resolve));
  h.handle.active = false; finish();
  await assert.rejects(pending, /closed/);
  assert.equal(h.handle.recordsByThreadId.get(h.thread.id).length, 100);
});

test('native admits the latest live revision queued during page IO only after a successful room check', async () => {
  for (const failContract of [false, true]) {
    const h = await nativeHistoryFixture(500);
    await h.engine.openNativeRoom(h.handle, h.thread, h.roomId);
    const existing = h.snapshot();
    if (failContract) h.afterContract = async () => {
      h.loaded = 250;
      await h.engine.processNativeSnapshot(h.snapshot());
      throw Error('room access revoked');
    };
    else h.flush = async () => {
      h.loaded = 250;
      await h.engine.processNativeSnapshot(h.snapshot());
      await h.engine.processNativeSnapshot({ ...existing, events: [] });
      await h.engine.processNativeSnapshot({ ...h.snapshot(), timelineId: 'timeline_retired', events: [] });
    };
    const task = h.engine.openNativeRoom(h.handle, h.thread, h.roomId, undefined, true);
    if (failContract) await assert.rejects(task, /revoked/);
    else assert.equal((await task).messages.length, 250);
    assert.equal(h.engine.matrixThread(h.handle, h.thread).messages.length, failContract ? 100 : 250);
    assert.equal(h.handle.pendingTimelineSnapshots?.size ?? 0, 0);
  }
});

test('large native history uses fresh bounded deletion checks on every page and preserves the SDK cursor', async () => {
  const h = await nativeHistoryFixture(1700);
  const { createMessagingSurfaceController } = await import('../src/messaging-surface-controller.mjs');
  const base = 1800000000000;
  let clearedBefore = null, checks = 0;
  const removed = new Set(['message_history_00010', 'message_history_00600', 'message_history_01699']);
  const controller = createMessagingSurfaceController({ apiOrigin: 'https://fixture.test',
    getSecureMessagingClient: async () => { throw Error('MLS must not run'); }, loadMessagingCapabilities: async () => ({}),
    fetch: async (url, init) => {
      if (url.endsWith('/deletions/check')) {
        const ids = JSON.parse(init.body).messageIds;
        assert.ok(ids.length <= 500); checks++;
        return Response.json({ hasDeletions: true, clearedBefore, deletedMessageIds: ids.filter(id => removed.has(id)) });
      }
      assert.ok(url.endsWith('/chats/with/bobby?read=false'));
      return Response.json({ ...h.thread, partner: { ...h.thread.partner, username: 'bobby', name: 'Bobby', avatarUrl: null, isVerified: false },
        visibility: { hasDeletions: true, clearedBefore, deletedMessageIds: [] } });
    },
    matrixMessaging: { capabilities: async () => ({ enabled: true }),
      openThread: (_account, value, options) => h.engine.openNativeRoom(h.handle, value, h.roomId, undefined, options.loadEarlier) },
  });
  let result = await controller.openThread(h.handle.accountId, 'bobby', { markRead: false });
  while (result.hasMoreHistory) result = await controller.openThread(h.handle.accountId, 'bobby', { markRead: false, loadEarlier: true });
  assert.equal(result.messages.length, 1697);
  assert.ok(result.messages.every(message => !removed.has(message.id))); assert.ok(checks > 17);
  clearedBefore = new Date(base + 999 * 1000).toISOString();
  result = await controller.openThread(h.handle.accountId, 'bobby', { markRead: false });
  assert.equal(result.messages.length, 699);
  assert.ok(result.messages.every(message => Date.parse(message.createdAt) > Date.parse(clearedBefore)));
});

test('native empty and untrusted-only pages keep the actual SDK continuation and recovery requires a new authenticated snapshot', async () => {
  const h = await nativeHistoryFixture(300);
  for (const row of h.all) row.authenticated = false;
  let result = await h.engine.openNativeRoom(h.handle, h.thread, h.roomId);
  assert.equal(result.messages.length, 0); assert.equal(result.hasMoreHistory, true);
  result = await h.engine.openNativeRoom(h.handle, h.thread, h.roomId, undefined, true);
  assert.equal(result.messages.length, 0); assert.equal(result.hasMoreHistory, true);
  result = await h.engine.openNativeRoom(h.handle, h.thread, h.roomId, undefined, true);
  assert.equal(result.messages.length, 0); assert.equal(result.hasMoreHistory, false);
  const recovered = h.snapshot(); recovered.hasUndecryptableEvents = true;
  await h.engine.processNativeSnapshot(recovered);
  assert.equal(h.engine.matrixThread(h.handle, h.thread).hasUndecryptableEvents, true);
  // Successful key import itself changes nothing; only the native SDK's fresh
  // authenticated timeline can make an old event visible.
  for (const row of h.all) row.authenticated = true;
  await h.engine.processNativeSnapshot(h.snapshot());
  assert.equal(h.engine.matrixThread(h.handle, h.thread).messages.length, 300);
  assert.equal(h.engine.matrixThread(h.handle, h.thread).hasUndecryptableEvents, false);
});

test('native session restarts restore the loaded history depth across repeated refreshes', async () => {
  const h = await nativeHistoryFixture(1200);
  await h.engine.openNativeRoom(h.handle, h.thread, h.roomId);
  for (let i = 0; i < 6; i++) await h.engine.openNativeRoom(h.handle, h.thread, h.roomId, undefined, true);
  assert.equal(h.engine.matrixThread(h.handle, h.thread).messages.length, 700);
  let rotations = 0, starts = 0;
  const refresh = closures('matrix-engine-native.ts', ['renewHandle'], {
    ...h.engine, nativeBridge: h.nativeBridge,
    refreshCredentials: async () => ({ ...h.handle.credentials, accessToken: `access_${++rotations}` }),
    isAuthenticationFailure: () => false, saveCredentials: async () => {}, registerDevice: async () => {},
    startNativeSession: async () => { starts++; h.resetTimeline(); },
    matrixUserIdForAccount: id => `@${id}:example.org`, matrixServerName: () => 'example.org',
    assertRoomContract: async () => {}, flushPendingForThread: async () => {
      await h.engine.processNativeSnapshot({ ...h.snapshot(), hasUndecryptableEvents: true });
    }, scheduleRefresh() {},
  });
  const retired = h.snapshot();
  for (let hour = 0; hour < 24; hour++) {
    await Promise.all(Array.from({ length: 8 }, () => refresh.renewHandle(h.handle)));
    const result = h.engine.matrixThread(h.handle, h.thread);
    assert.equal(result.messages.length, 700); assert.equal(result.messages[0].text, 'История 500');
    assert.equal(result.hasMoreHistory, true);
    assert.equal(result.hasUndecryptableEvents, true, 'live updates queued during refresh are drained after admission');
    await h.engine.processNativeSnapshot({ ...retired, revision: retired.revision + 10000, events: [] });
    assert.equal(h.engine.matrixThread(h.handle, h.thread).messages.length, 700);
  }
  assert.equal(rotations, 24); assert.equal(starts, 24);
});

test('native explicit retry restores the previous window after refresh backfill failed', async () => {
  const h = await nativeHistoryFixture(800);
  await h.engine.openNativeRoom(h.handle, h.thread, h.roomId);
  for (let page = 0; page < 4; page++) await h.engine.openNativeRoom(h.handle, h.thread, h.roomId, undefined, true);
  const refresh = closures('matrix-engine-native.ts', ['renewHandle'], {
    ...h.engine, nativeBridge: h.nativeBridge,
    refreshCredentials: async () => h.handle.credentials, isAuthenticationFailure: () => false,
    saveCredentials: async () => {}, registerDevice: async () => {},
    startNativeSession: async () => { h.resetTimeline(); h.failPage = true; },
    matrixUserIdForAccount: id => `@${id}:example.org`, matrixServerName: () => 'example.org',
    assertRoomContract: async () => {}, flushPendingForThread: async () => {}, scheduleRefresh() {},
  });
  await refresh.renewHandle(h.handle);
  assert.equal(h.engine.matrixThread(h.handle, h.thread).messages.length, 500);
  assert.equal(h.engine.matrixThread(h.handle, h.thread).hasMoreHistory, true, 'failed restart preserves the retry cursor');
  const retired = h.handle.timelines.get(h.roomId);
  assert.equal(retired.retired, true, 'failed new timeline cannot publish');
  await h.engine.processNativeSnapshot({ ...h.snapshot(), timelineId: retired.id, revision: retired.revision + 10000, events: [] });
  assert.equal(h.engine.matrixThread(h.handle, h.thread).messages.length, 500);
  h.failPage = false;
  const reopened = await h.engine.openNativeRoom(h.handle, h.thread, h.roomId);
  assert.equal(reopened.messages.length, 500);
  assert.equal(reopened.messages[0].text, 'История 300');
  assert.equal(reopened.hasMoreHistory, true);
});

test('native rotation retries encrypted persistence without reusing a spent refresh token or restarting the device', async () => {
  const { createMatrixCredentialRefresher } = await import('../src/matrix-token-refresh.mjs');
  let writes = 0, calls = 0, available = false, active = true;
  const credentials = { deviceId: 'device_retained', accessToken: 'access_old', refreshToken: 'refresh_old', expiresAt: 1 };
  const engine = closures('matrix-engine-native.ts', ['refreshCredentials'], {
    createMatrixCredentialRefresher, credentialRefreshers: new WeakMap(),
    assertMatrixKeyActive() { if (!active) throw Error('closed'); },
    request: async () => Response.json({ enabled: true }),
    matrixRequest: async () => { calls++; return { access_token: 'access_new', refresh_token: 'refresh_new', expires_in_ms: 600000 }; },
    saveCredentials: async () => { writes++; if (!available) throw Error('storage'); },
  });
  credentials.homeserverUrl = 'https://matrix.example.org';
  await assert.rejects(engine.refreshCredentials('account_alice', {}, credentials), /storage/);
  assert.equal(credentials.refreshToken, 'refresh_old');
  available = true;
  const result = await engine.refreshCredentials('account_alice', {}, credentials);
  assert.equal(calls, 1); assert.equal(writes, 2); assert.equal(result.deviceId, 'device_retained');
  assert.equal(result.refreshToken, 'refresh_new');
  active = false;
  await assert.rejects(engine.refreshCredentials('account_alice', {}, credentials), /closed/);
  assert.equal(calls, 1);
});

test('Web/native warmup respects disabled runtime and cancellation before initialization', async () => {
  for (const file of ['matrix-engine-web.ts', 'matrix-engine-native.ts']) {
    let opened = 0;
    let enabled = false;
    let duringCapabilities;
    const engine = closures(file, ['warmup'], {
      capabilities: async () => { duringCapabilities?.(); return { enabled }; },
      getHandle: async () => { opened++; },
    });
    await engine.warmup('account_fixture', new AbortController().signal);
    assert.equal(opened, 0);
    enabled = true;
    const aborted = new AbortController(); aborted.abort();
    await engine.warmup('account_fixture', aborted.signal);
    assert.equal(opened, 0);
    const late = new AbortController(); duringCapabilities = () => late.abort();
    await engine.warmup('account_fixture', late.signal);
    assert.equal(opened, 0);
    duringCapabilities = undefined;
    await engine.warmup('account_fixture', new AbortController().signal);
    assert.equal(opened, 1);
  }
});

test('actual Web/native encrypted writers reject a retired key, including empty removals', async () => {
  const lifecycle = await import('../src/matrix-key-lifecycle.mjs');
  const { xchacha20poly1305 } = await import('@noble/ciphers/chacha.js');
  const { bytesToBase64Url } = await import('../src/mls-runtime.mjs');
  for (const file of ['matrix-engine-web.ts', 'matrix-engine-native.ts']) {
    let writes = 0;
    const names = ['saveCredentials', 'saveOutbox', 'saveNotificationOutbox', ...(file.includes('web') ? ['saveSecretStorageKey'] : [])];
    const engine = closures(file, names, {
      ...lifecycle, xchacha20poly1305, bytesToBase64Url, bytes: value => new TextEncoder().encode(value),
      ExpoCrypto: { getRandomValues: value => value.fill(9) },
      AsyncStorage: { setItem: async () => { writes++; }, removeItem: async () => { writes++; } },
      credentialKey: () => 'credentials', outboxStorageKey: () => 'outbox', notificationOutboxStorageKey: () => 'notifications', secretStorageKey: () => 'secret',
      MATRIX_CREDENTIAL_AAD: new Uint8Array(), MATRIX_OUTBOX_AAD: new Uint8Array(), MATRIX_NOTIFICATION_OUTBOX_AAD: new Uint8Array(), MATRIX_SECRET_AAD: new Uint8Array(),
      MAX_OUTBOX_ITEMS: 256, MAX_OUTBOX_PLAINTEXT_BYTES: 524272, MAX_NOTIFICATION_OUTBOX_PLAINTEXT_BYTES: 131056,
    });
    const key = new Uint8Array(32).fill(7);
    await engine.saveOutbox('account_test', key, [{ text: 'legitimate control' }]);
    assert.equal(writes, 1);
    await lifecycle.closeMatrixKey(key);
    key.fill(0);
    for (const name of names) {
      const value = name === 'saveSecretStorageKey' ? { keyId: 'secret_test', privateKey: new Uint8Array(32).fill(8) } : [{ text: 'must not persist' }];
      await assert.rejects(engine[name]('account_test', key, value), /session is closed/, `${file}:${name}`);
    }
    await assert.rejects(engine.saveOutbox('account_test', key, []), /session is closed/);
    await assert.rejects(engine.saveNotificationOutbox('account_test', key, []), /session is closed/);
    assert.equal(writes, 1);
  }
});

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('Web Matrix development origins permit only literal loopback over HTTP', () => {
  const {safeHttpOrigin} = closures('matrix-engine-web.ts',['safeHttpOrigin'],{});
  for(const host of ['localhost','127.0.0.1','127.0.0.2','127.255.0.3']) {
    assert.equal(safeHttpOrigin(`http://${host}:43105`),`http://${host}:43105`);
  }
  for(const host of ['localhost.evil.test','127.0.0.2.evil.test','128.0.0.1','192.168.1.1']) {
    assert.throws(()=>safeHttpOrigin(`http://${host}:43105`),/HTTPS/);
  }
  assert.equal(safeHttpOrigin('https://volna.social'),'https://volna.social');
});

test('Web room validation waits for sync and all lazy members before enforcing the unchanged contract', async () => {
  const { EventEmitter } = require('node:events');
  const { waitForMatrixJoinedRoom } = await import('../src/matrix-room-readiness.mjs');
  const client = new EventEmitter();
  const own = '@volna_alice:volna.social', peer = '@volna_bobby:volna.social', service = '@volna_messaging:volna.social';
  let joined = false, extra = false, loaded = 0, active = true;
  const room = { getMyMembership: () => joined ? 'join' : 'invite',
    loadMembersIfNeeded: async () => { loaded++; }, currentState: { getStateEvents(type) {
      if (type === 'encryption') return { getContent: () => ({ algorithm: 'megolm' }) };
      if (type === 'thread') return { getContent: () => ({ v: 1, threadId: 'thread_fixture' }) };
      if (type === 'member') { assert.ok(loaded > 0); return [own, peer, service, ...(extra ? ['@outsider:volna.social'] : [])].map(id => ({ getStateKey: () => id, getContent: () => ({membership:'join'}) })); }
      if (type === 'power') return {getContent: () => ({users:{[service]:100},state_default:100,invite:100,kick:100,ban:100,redact:100})};
    } } };
  client.getRoom = () => joined ? room : null;
  client.isRoomEncrypted = async () => true;
  const engine = closures('matrix-engine-web.ts', ['assertRoomContract'], {
    waitForMatrixJoinedRoom, assertMatrixKeyActive: () => { if(!active) throw Error('closed'); },
    EventType:{RoomEncryption:'encryption',RoomMember:'member',RoomPowerLevels:'power'},
    MATRIX_ENCRYPTION_ALGORITHM:'megolm', MATRIX_THREAD_STATE_TYPE:'thread',
    matrixServerName: () => 'volna.social', matrixUserIdForAccount: () => peer, safeIdentifier:x=>x,
  });
  const handle = {client, credentials:{userId:own},deviceKey:new Uint8Array(32)};
  const thread = {id:'thread_fixture',partner:{id:'bobby'}};
  const pending = engine.assertRoomContract(handle,thread,'!room:volna.social');
  assert.equal(loaded,0);
  joined=true;client.emit('sync','SYNCING');
  assert.equal(await pending,room);
  extra=true;
  await assert.rejects(engine.assertRoomContract(handle,thread,'!room:volna.social'),/participant set mismatch/);
  extra=false;room.loadMembersIfNeeded=async()=>{active=false;};
  await assert.rejects(engine.assertRoomContract(handle,thread,'!room:volna.social'),/closed/);
  assert.equal(client.listenerCount('sync'),0);
});

test('Web/native explicit retry retains the event and waits for the real send result', async () => {
  for (const file of ['matrix-engine-web.ts', 'matrix-engine-native.ts']) {
    const ready = deferred(), finish = deferred();
    const pendingMap = new Map(), records = new Map();
    let stored = [], sent, settled = false;
    const handle = { accountId: 'alice', credentials: { userId: '@alice:example.test', deviceId: 'device_test' },
      deviceKey: new Uint8Array(32), roomByThreadId: new Map([['thread_test', '!room:example.test']]),
      localPending: pendingMap, pendingByLogicalId: pendingMap, recordsByThreadId: records };
    const thread = { id: 'thread_test', partner: { id: 'bobby' }, encryptionMode: 'MATRIX_V1', messages: [{ securityMode: 'e2ee' }] };
    const event = { v: 1, kind: 'message.create', logicalMessageId: 'message_retry', clientCreatedAt: '2026-09-14T00:00:00.000Z', text: 'retained draft' };
    const send = async (_handle, pending) => { sent = pending; ready.resolve(); await finish.promise; };
    const engine = closures(file, ['sendContentEvent'], {
      getHandle: async () => handle, openThread: async () => thread, assertRoomContract: async () => {},
      safeIdentifier: value => value, normalizeContentEvent, getRoomSecurity: async () => ({ partnerDevices: [{ signedByOwner: true }] }),
      mutateOutbox: async (_account, _key, mutate) => { stored = mutate(stored); },
      sendPending: send, submitPending: send, matrixDeviceProjectionId: () => 'device_test', notifyThread() {},
      matrixThread: () => ({ messages: [] }),
    });
    const first = engine.sendContentEvent('alice', thread, event).then(() => { settled = true; });
    await ready.promise;
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(settled, false, `${file}: no 250 ms synthetic acknowledgement`);
    finish.resolve(); await first;
    const original = sent;
    await engine.sendContentEvent('alice', thread, { ...event, clientCreatedAt: '2026-09-14T00:01:00.000Z' });
    assert.equal(sent, original); assert.equal(stored.length, 1);
    assert.equal(sent.event.clientCreatedAt, event.clientCreatedAt);
    if (file.includes('native')) assert.equal(records.get(thread.id).length, 1);
    pendingMap.set(event.logicalMessageId, { ...original, partnerAccountId: 'outsider' });
    await assert.rejects(engine.sendContentEvent('alice', thread, event), /retry destination mismatch/);
  }
});

test('Web/native simultaneous retries wait for one in-flight writer', async () => {
  for (const file of ['matrix-engine-web.ts', 'matrix-engine-native.ts']) {
    const ready = deferred(), finish = deferred();
    let writes = 0, secondSettled = false;
    const pending = { id: 'message_retry', threadId: 'thread_test', partnerAccountId: 'bobby', roomId: '!room:example.test', event: {}, submitted: false };
    const handle = { active: true, accountId: 'alice', credentials: { userId: '@alice:example.test', deviceId: 'device_test' },
      pendingSendIds: new Set(), submittingSendIds: new Set(), pendingByLogicalId: new Map(), localPending: new Map(),
      roomByThreadId: new Map([[pending.threadId, pending.roomId]]),
      threadByRoomId: new Map([[pending.roomId, { id: pending.threadId, partner: { id: pending.partnerAccountId } }]]),
      client: { getCrypto: () => ({}), joinRoom: async () => {} } };
    const write = async () => { writes++; ready.resolve(); await finish.promise; return { event_id: '$sent' }; };
    const method = file.includes('web') ? 'sendPending' : 'submitPending';
    const engine = closures(file, [method], {
      request: async () => ({ ok: true, json: async () => ({ roomId: pending.roomId, ownMatrixUserId: handle.credentials.userId, partnerMatrixUserId: '@bobby:example.test' }) }),
      requireMatrixRecipientCrypto: () => ({ bindRoomKeyRecipients: async () => {} }),
      matrixServerName: () => 'example.test', matrixUserIdForAccount: () => '@bobby:example.test',
      assertRoomContract: async () => ({}), normalizeContentEvent: value => value, encodeMatrixMessageContent: value => value,
      previewForEvent: () => '', safeIdentifier: value => value, sendMatrixContentOnce: write,
      nativeBridge: { bindRoomKeyRecipients: async () => {}, sendMessage: write },
      mutateOutbox: async () => {}, mutateNotificationOutbox: async () => {}, flushNotificationOutbox: async () => {},
    });
    const first = engine[method](handle, pending);
    await ready.promise;
    const second = engine[method](handle, pending).then(() => { secondSettled = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(secondSettled, false); assert.equal(writes, 1);
    finish.resolve(); await Promise.all([first, second]);
    assert.equal(writes, 1);
  }
});

test('Web denial before encrypted transport preserves the draft outside the auto-send queue', async () => {
  let stored = [];
  const pending = new Map();
  const thread = { id: 'thread_test', partner: { id: 'bobby' }, encryptionMode: 'MATRIX_V1', messages: [{ securityMode: 'e2ee' }] };
  const handle = { localPending: pending, roomByThreadId: new Map([[thread.id, '!room:example.test']]) };
  const engine = closures('matrix-engine-web.ts', ['sendContentEvent'], {
    getHandle: async () => handle, openThread: async () => thread, assertRoomContract: async () => {}, safeIdentifier: x => x, normalizeContentEvent,
    mutateOutbox: async (_a, _k, mutate) => { stored = mutate(stored); },
    sendPending: async () => { throw Object.assign(Error('denied'), { code: 'matrix_send_not_authorized' }); },
  });
  await assert.rejects(engine.sendContentEvent('alice', thread, { v: 1, kind: 'message.create', logicalMessageId: 'message_retry', clientCreatedAt: new Date().toISOString(), text: 'draft' }), /denied/);
  assert.equal(stored.length, 0); assert.equal(pending.size, 0);
});

test('explicit send reopens a left room only through authorization and never changes its bound destination', async () => {
  for (const file of ['matrix-engine-web.ts', 'matrix-engine-native.ts']) {
    const roomByThreadId = new Map([['thread_test', '!room:volna.social']]);
    let opened = 0, persisted = 0, allowed = false, redirect = false;
    const handle = { roomByThreadId, client: { getRoom: () => ({ getMyMembership: () => 'leave' }) } };
    const engine = closures(file, ['sendContentEvent'], {
      getHandle: async () => handle, safeIdentifier: x => x, normalizeContentEvent,
      openThread: async (_account, thread) => { opened++; if (!allowed) throw Error('blocked'); if (redirect) roomByThreadId.set(thread.id, '!other:volna.social'); return thread; },
      assertRoomContract: async () => {},
      getRoomSecurity: async () => ({ partnerDevices: [] }),
      mutateOutbox: async () => { persisted++; },
    });
    const thread = { id: 'thread_test', partner: { id: 'bobby' }, encryptionMode: 'MATRIX_V1', messages: [] };
    const event = { v: 1, kind: 'message.create', logicalMessageId: 'message_test', clientCreatedAt: new Date().toISOString(), text: 'fixture' };
    await assert.rejects(engine.sendContentEvent('alice', thread, event), /blocked/);
    allowed = true;
    await assert.rejects(engine.sendContentEvent('alice', thread, event), error => error.code === 'matrix_recipient_not_ready');
    redirect = true;
    await assert.rejects(engine.sendContentEvent('alice', thread, event), /binding changed/);
    assert.equal(opened, 3); assert.equal(persisted, 0);
  }
});

test('Web/native attachment-only timelines use the shared preview and retain an empty shell preview', async () => {
  const { messagePreview } = await import('../src/messaging-surface-controller.mjs');
  const message = { id: 'message_test', createdAt: '2026-09-14T00:00:00.000Z', attachment: { kind: 'music', title: 'Fixture', artist: 'QA' }, securityMode: 'e2ee' };
  const web = closures('matrix-engine-web.ts', ['matrixThread'], { messagePreview, messagesForRoom: async () => [message] });
  const projected = await web.matrixThread({ client: { getRoom: () => null } }, { messages: [], lastMessageText: 'Чат создан' }, '!room:volna.social');
  assert.equal(projected.lastMessageText, messagePreview(message));
  assert.notEqual(projected.lastMessageText, 'Чат создан');
  let items = [message];
  const native = closures('matrix-engine-native.ts', ['matrixThread'], { messagePreview, projectedMessages: () => items });
  const nativeHandle = { roomByThreadId: new Map() };
  assert.equal(native.matrixThread(nativeHandle, { messages: [] }).lastMessageText, messagePreview(message));
  items = [];
  assert.equal(native.matrixThread(nativeHandle, { messages: [], lastMessageText: 'previous' }).lastMessageText, 'previous');
});

test('Matrix refresh preserves identity, rotates both credentials, and treats outages as retryable', async () => {
  const { createMatrixCredentialRefresher } = await import('../src/matrix-token-refresh.mjs');
  let status = 200, saved = 0, requests = 0;
  class MatrixError extends Error { constructor(value, httpStatus) { super(value.error); this.httpStatus = httpStatus; } }
  const credentials = { userId: '@fixture:example.test', deviceId: 'device_fixture', homeserverUrl: 'https://matrix.test', refreshToken: 'old', accessToken: 'old' };
  const engine = closures('matrix-engine-web.ts', ['refreshCredentials'], {
    createMatrixCredentialRefresher, credentialRefreshers: new WeakMap(), assertMatrixKeyActive() {},
    MatrixError, request: async () => ({ ok: true }), saveCredentials: async () => { saved++; },
    globalThis: { fetch: async () => { requests++; return { status, ok: status === 200, json: async () => ({ access_token: 'next', refresh_token: 'next_refresh', expires_in_ms: 600000, error: 'fixture' }) }; } },
  });
  const result = await engine.refreshCredentials('account', new Uint8Array(32), credentials, 'old');
  assert.equal(result.accessToken, 'next'); assert.equal(credentials.refreshToken, 'next_refresh');
  assert.equal(credentials.deviceId, 'device_fixture'); assert.equal(saved, 1);
  status = 503;
  await assert.rejects(engine.refreshCredentials('account', new Uint8Array(32), credentials, 'next_refresh'), error => !(error instanceof MatrixError));
  status = 403;
  await assert.rejects(engine.refreshCredentials('account', new Uint8Array(32), credentials, 'next_refresh'), error => error instanceof MatrixError);
  assert.equal(saved, 1); assert.equal(requests, 3);
});

test('Web recovery rotation requires local verified keys and preserves identity and backup', async () => {
  let verified = false, haveKeys = true, matchingBackup = true, generated = 0, persisted = 0;
  let options;
  const bytes = new Uint8Array(32).fill(7);
  const crypto = {
    getDeviceVerificationStatus: async () => ({ isVerified: () => verified }),
    getCrossSigningStatus: async () => ({ privateKeysCachedLocally: { masterKey: haveKeys, selfSigningKey: haveKeys, userSigningKey: haveKeys } }),
    getKeyBackupInfo: async () => ({ version: 'existing' }),
    isKeyBackupTrusted: async () => ({ trusted: true, matchesDecryptionKey: matchingBackup }),
    createRecoveryKeyFromPassphrase: async () => { generated++; return { privateKey: bytes, encodedPrivateKey: 'new_key' }; },
    bootstrapSecretStorage: async value => { options = value; },
  };
  const handle = { credentials: { userId: 'alice', deviceId: 'device' }, deviceKey: new Uint8Array(32),
    client: { getCrypto: () => crypto, secretStorage: { getDefaultKeyId: async () => 'key_id' } } };
  const engine = closures('matrix-engine-web.ts', ['resetRecovery'], {
    getHandle: async () => handle, assertMatrixKeyActive() {}, secretStorageKeys: new Map(), saveSecretStorageKey: async () => { persisted++; },
  });
  await assert.rejects(engine.resetRecovery('alice'), /Подтвердите/);
  verified = true; haveKeys = false;
  await assert.rejects(engine.resetRecovery('alice'), /Подтвердите/);
  haveKeys = true; matchingBackup = false;
  await assert.rejects(engine.resetRecovery('alice'), /резервной копии/);
  assert.equal(generated, 0);
  matchingBackup = true;
  assert.equal((await engine.resetRecovery('alice')).recoveryKey, 'new_key');
  assert.equal(options.setupNewSecretStorage, true);
  assert.equal(options.setupNewKeyBackup, false);
  assert.equal(persisted, 1);
  assert.ok(bytes.every(byte => byte === 0));
});

test('native recovery rotation rejects old binaries and unready devices before mutation', async () => {
  let supported = false, ready = false, resets = 0;
  const nativeBridge = {
    getSecurityState: async () => ({ crossSigningReady: ready, secretStorageReady: ready }),
    resetRecovery: async () => { resets++; return 'N'.repeat(48); },
  };
  const engine = closures('matrix-engine-native.ts', ['resetRecovery'], {
    getHandle: async () => ({ credentials: { userId: 'alice' } }), nativeBridge,
    requireNativeRecoveryRuntime: () => ({ features: supported ? ['recovery-key-rotation-v1'] : [] }), hasRecoveryKey: async () => true,
  });
  await assert.rejects(engine.resetRecovery('alice'), /Обновите/);
  supported = true;
  await assert.rejects(engine.resetRecovery('alice'), /подтверждённом/);
  assert.equal(resets, 0);
  ready = true;
  assert.equal((await engine.resetRecovery('alice')).recoveryKey.length, 48);
  assert.equal(resets, 1);
});

test('Web reports unavailable encrypted history without inventing a message and clears it after decryption', async () => {
  let failed = true;
  const handle = { client: { getRoom: () => ({ getLiveTimeline: () => ({ getPaginationToken: () => null, getEvents: () => [
    { getWireType: () => 'm.room.encrypted', isDecryptionFailure: () => failed },
  ] }) }) } };
  const engine = closures('matrix-engine-web.ts', ['matrixThread'], { messagesForRoom: async () => [] });
  const thread = { id: 'thread', messages: [], lastMessageAt: null, lastMessageText: null };
  let result = await engine.matrixThread(handle, thread, '!room:example.org');
  assert.equal(result.hasUndecryptableEvents, true);
  assert.equal(result.messages.length, 0);
  failed = false;
  result = await engine.matrixThread(handle, thread, '!room:example.org');
  assert.equal(result.hasUndecryptableEvents, false);
});

test('native availability hints remain separate from authenticated message content and clear on recovery', async () => {
  const thread = { id: 'thread_test', partner: { id: 'bob' }, messages: [] };
  const handle = { active: true, accountId: 'alice', credentials: { userId: '@alice:example.org' },
    roomByThreadId: new Map([['thread_test', '!room:example.org']]), timelines: new Map([['!room:example.org', { id: 'timeline_test', revision: -1 }]]),
    threadByRoomId: new Map([['!room:example.org', thread]]), recordsByThreadId: new Map(), pendingByLogicalId: new Map() };
  const engine = closures('matrix-engine-native.ts', ['processNativeSnapshot', 'matrixThread'], {
    SAFE_ID: /^\w+$/, SAFE_ROOM_ID: /^!/, SAFE_EVENT_ID: /^\$/, SAFE_MATRIX_USER_ID: /^@/,
    handles: new Map([['alice', Promise.resolve(handle)]]), matrixServerName: () => 'example.org',
    matrixUserIdForAccount: id => `@${id}:example.org`, notifyThread() {}, projectedMessages: () => [],
  });
  for (const unavailable of [true, false]) {
    await engine.processNativeSnapshot({ accountId: 'alice', roomId: '!room:example.org', events: [
      { authenticated: false, contentJson: '{"text":"untrusted"}' },
    ], timelineId: 'timeline_test', revision: unavailable ? 1 : 2, hasMoreHistory: false, hasUndecryptableEvents: unavailable });
    const result = engine.matrixThread(handle, thread);
    assert.equal(result.hasUndecryptableEvents, unavailable);
    assert.equal(result.messages.length, 0);
  }
});

async function lifecycleEngine(file, storage = {}) {
  const lifecycle = await import('../src/matrix-key-lifecycle.mjs');
  const { xchacha20poly1305 } = await import('@noble/ciphers/chacha.js');
  const { bytesToBase64Url, base64UrlToBytes } = await import('../src/mls-runtime.mjs');
  const records = new Map(), validation = deferred(), entered = deferred();
  let logoutPending = false;
  const owner = { assertActive() {}, pendingLogout: () => logoutPending ? 'generation_fixture' : null,
    acknowledgeLogout() { logoutPending = false; }, async release() {} };
  const accountId = `account_${file.includes('web') ? 'web' : 'native'}_race`;
  const handle = { accountId, owner, active: true, credentials: { deviceId: 'device_test' }, deviceKey: new Uint8Array(32).fill(7),
    storage: { clear: async () => records.clear(), destroyMemoryKey() {} }, refreshTimer: null, listeners: new Set(),
    roomByThreadId: new Map([['thread_test', '!room:volna.social']]), localPending: new Map(), pendingByLogicalId: new Map(), recordsByThreadId: new Map(),
    client: { logout: async () => {}, stopClient() {}, getRoom: () => ({ getMyMembership: () => 'join' }) },
  };
  const bindings = { ...lifecycle, xchacha20poly1305, bytesToBase64Url, base64UrlToBytes, normalizeContentEvent,
    storeOwnership: { requestLogout() { logoutPending = true; }, acquire: async () => owner },
    bytes: value => new TextEncoder().encode(value), ExpoCrypto: { getRandomValues: value => value.fill(9) },
    AsyncStorage: {
      getItem: async key => records.get(key) ?? null, setItem: async (key, value) => { records.set(key, value); },
      multiRemove: async keys => keys.forEach(key => records.delete(key)), removeItem: async key => { records.delete(key); }, ...storage,
    },
    credentialKey: () => 'credentials', deviceStorageKey: () => 'device', outboxStorageKey: () => 'outbox', notificationOutboxStorageKey: () => 'notifications', secretStorageKey: () => 'secret',
    MATRIX_OUTBOX_AAD: new TextEncoder().encode('VOLNA-MATRIX-OUTBOX-V1'), MAX_OUTBOX_ITEMS: 256, MAX_OUTBOX_PLAINTEXT_BYTES: 524272,
    SAFE_ID: /^[A-Za-z0-9_-]{8,80}$/, SAFE_ROOM_ID: /^![^\s:]{1,255}:[^\s]{1,255}$/, outboxLocks: new Map(), handles: new Map([[accountId, Promise.resolve(handle)]]), secretStorageKeys: new Map(),
    safeIdentifier: value => value, getHandle: async () => handle, openThread: async (_account, thread) => thread,
    getRoomSecurity: async () => ({ partnerDevices: [{ signedByOwner: true }] }),
    assertRoomContract: async () => { entered.resolve(); await validation.promise; },
    nativeBridge: { logoutSession: async () => {}, stopSession: async () => {} }, releaseGlobalListenersIfIdle() {},
    matrixThread: async () => ({ messages: [] }), matrixDeviceProjectionId: () => 'device_test', notifyThread() {}, submitPending: async () => {}, sendPending: async () => {},
    setTimeout, clearTimeout,
  };
  const engine = closures(file, ['sendContentEvent', 'loadOutbox', 'saveOutbox', 'mutateOutbox', 'logout', 'release', ...(file.includes('web') ? ['cleanPendingLogout'] : [])], bindings);
  return { engine, records, handle, accountId, entered, validation, lifecycle, bindings };
}

async function webOpeningFixture({ failStorage = false, busy = false, pendingLogout = false } = {}) {
  const fixture = await lifecycleEngine('matrix-engine-web.ts');
  const trace = [], cryptoReady = deferred();
  let invalidate, held = false, retired = false;
  const owner = { assertActive() { if (retired) throw Object.assign(Error('retired'), { code: 'matrix_store_retired' }); },
    pendingLogout: () => pendingLogout ? 'generation_test' : null, acknowledgeLogout() { trace.push('ack'); pendingLogout = false; }, async release() { trace.push('unlock'); held = false; } };
  const client = { on() {}, off() {}, stopClient() { trace.push('stop'); },
    initRustCrypto: async () => { trace.push('crypto'); await cryptoReady.promise; },
    getCrypto: () => ({ setDeviceIsolationMode() {}, getVerificationRequestsToDeviceInProgress: () => [], userHasCrossSigningKeys: async () => true }),
  };
  const credentials = { homeserverUrl: 'https://matrix.test', userId: '@fixture:test', deviceId: 'device_fixture', accessToken: 'fixture' };
  const bindings = { ...fixture.bindings, handles: new Map(),
    storeOwnership: { acquire: async (_id, callback) => {
      if (busy) throw Object.assign(Error('busy'), { code: 'matrix_store_busy' });
      assert.equal(held, false); held = true; invalidate = () => { retired = true; callback(); }; trace.push('lock'); return owner;
    } },
    capabilities: async () => ({ enabled: true }), getOrCreateDeviceId: async () => { trace.push('device'); return 'device_fixture'; },
    createExpoMessagingStorage: () => ({ wrappingKeyId: 'key', wrappingKeyProvider: { getKey: async () => { if (failStorage) throw Error('store denied'); return new Uint8Array(32).fill(7); } }, destroyMemoryKey() { trace.push('zero'); } }),
    loadCredentials: async () => { assert.equal(pendingLogout, false); return credentials; }, loadSecretStorageKey: async () => null,
    createClient: () => client, createMatrixVerificationFetch: ({ fetch }) => fetch, createEncryptedMatrixFetch: fetch => fetch,
    globalThis: { fetch: async () => ({ ok: true, json: async () => ({ user_id: credentials.userId, device_id: credentials.deviceId }) }) },
    request: async () => ({ ok: true }), CryptoEvent: { VerificationRequestReceived: 'verify' },
    bytesToBase64Url: () => 'fixture', sha256: () => new Uint8Array(32),
    OnlySignedDevicesIsolationMode: class {}, requireMatrixRecipientCrypto() {},
    startPreparedSync: async () => { trace.push('sync'); }, refreshRoomIndex: async () => {}, flushOutbox: async () => {},
  };
  const engine = closures('matrix-engine-web.ts', ['getHandle', 'cleanPendingLogout', 'release'], bindings);
  return { ...fixture, engine, trace, cryptoReady, get held() { return held; }, invalidate: () => invalidate() };
}

test('Web opens device/crypto storage only after ownership, and releases after stopping the SDK', async () => {
  const f = await webOpeningFixture(); f.cryptoReady.resolve();
  const handle = await f.engine.getHandle(f.accountId);
  assert.deepEqual(f.trace, ['lock', 'device', 'crypto', 'sync']);
  assert.ok(handle.deviceKey.some(Boolean));
  await f.engine.release(f.accountId);
  assert.equal(f.trace.at(-1), 'unlock'); assert.ok(f.trace.indexOf('stop') < f.trace.indexOf('unlock'));
  assert.ok(handle.deviceKey.every(x => x === 0)); assert.equal(f.held, false);
});

test('a pending cross-tab logout is cleaned before the next Web device or credential read', async () => {
  const f = await webOpeningFixture({ pendingLogout: true }); f.cryptoReady.resolve();
  await f.engine.getHandle(f.accountId);
  assert.deepEqual(f.trace.slice(0, 3), ['lock', 'ack', 'device']);
  assert.equal(f.records.size, 0);
  await f.engine.release(f.accountId);
});

test('busy Web ownership and pre-SDK storage failures do not leave a lock or open a device', async () => {
  const busy = await webOpeningFixture({ busy: true });
  await assert.rejects(busy.engine.getHandle(busy.accountId), { code: 'matrix_store_busy' });
  assert.deepEqual(busy.trace, []);
  const failed = await webOpeningFixture({ failStorage: true });
  await assert.rejects(failed.engine.getHandle(failed.accountId), /store denied/);
  assert.deepEqual(failed.trace, ['lock', 'device', 'unlock']); assert.equal(failed.held, false);
});

test('retirement during Rust initialization cannot start sync or release before the SDK stops', async () => {
  const f = await webOpeningFixture();
  const opening = f.engine.getHandle(f.accountId);
  const rejected = assert.rejects(opening, { code: 'matrix_store_retired' });
  while (!f.trace.includes('crypto')) await new Promise(resolve => setImmediate(resolve));
  f.invalidate(); assert.equal(f.held, true);
  f.cryptoReady.resolve(); await rejected;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.trace.includes('sync'), false); assert.equal(f.trace.at(-1), 'unlock');
  assert.equal(f.held, false);
});

test('logout in a non-owning Web tab never reads or removes another owner\'s encrypted records', async () => {
  const f = await lifecycleEngine('matrix-engine-web.ts'); f.bindings.handles.clear();
  let marked = false, read = false, erased = false;
  f.bindings.storeOwnership = { requestLogout() { marked = true; }, acquire: async () => { throw Object.assign(Error('busy'), { code: 'matrix_store_busy' }); } };
  f.bindings.AsyncStorage.getItem = async () => { read = true; };
  f.bindings.AsyncStorage.multiRemove = async () => { erased = true; };
  const engine = closures('matrix-engine-web.ts', ['logout', 'cleanPendingLogout'], f.bindings);
  await engine.logout(f.accountId);
  assert.equal(marked, true); assert.equal(read, false); assert.equal(erased, false);
});

test('a completed cross-tab logout cannot revoke a newer stored session', async () => {
  const f = await lifecycleEngine('matrix-engine-web.ts'); f.bindings.handles.clear();
  let released = false;
  f.bindings.storeOwnership = { requestLogout() {}, acquire: async () => ({ pendingLogout: () => null, release: async () => { released = true; } }) };
  f.bindings.AsyncStorage.getItem = async () => { throw Error('must not read replacement credentials'); };
  f.bindings.AsyncStorage.multiRemove = async () => { throw Error('must not erase replacement credentials'); };
  const engine = closures('matrix-engine-web.ts', ['logout', 'cleanPendingLogout'], f.bindings);
  await engine.logout(f.accountId); assert.equal(released, true);
});

test('actual send resumed after Web/native logout cannot recreate a zero-key outbox', async () => {
  for (const file of ['matrix-engine-web.ts', 'matrix-engine-native.ts']) {
    const fixture = await lifecycleEngine(file);
    const { engine, handle, accountId, entered, validation, records } = fixture;
    const send = engine.sendContentEvent(accountId, { id: 'thread_test', partner: { id: 'account_bobby' }, encryptionMode: 'MATRIX_V1' }, {
      v: 1, kind: 'message.create', logicalMessageId: 'message_test', clientCreatedAt: new Date().toISOString(), text: 'private fixture',
    });
    const rejected = assert.rejects(send, /session is closed/);
    await entered.promise;
    await engine.logout(accountId);
    assert.ok(handle.deviceKey.every(byte => byte === 0));
    validation.resolve();
    await rejected;
    assert.equal(records.size, 0);
  }
});

test('Web/native shutdown drains admitted writes; release retains ciphertext and logout removes it', async () => {
  for (const file of ['matrix-engine-web.ts', 'matrix-engine-native.ts']) {
    for (const action of ['release', 'logout']) {
      const writing = deferred(), finish = deferred();
      let removed = false, fixture;
      fixture = await lifecycleEngine(file, {
        setItem: async (key, value) => { writing.resolve(); await finish.promise; fixture.records.set(key, value); },
        multiRemove: async keys => { removed = true; keys.forEach(key => fixture.records.delete(key)); },
      });
      const { engine, accountId, handle, records, lifecycle } = fixture;
      const oldKeyCopy = handle.deviceKey.slice();
      const item = { v: 1, id: 'message_test', threadId: 'thread_test', queuedAt: new Date().toISOString(), submitted: false,
        event: { v: 1, kind: 'message.create', logicalMessageId: 'message_test', clientCreatedAt: new Date().toISOString(), text: 'valid pending' } };
      const write = engine.saveOutbox(accountId, handle.deviceKey, [item]);
      await writing.promise;
      const shutdown = engine[action](accountId);
      assert.throws(() => lifecycle.assertMatrixAccountOpen(accountId), /session is closing/);
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(removed, false);
      assert.ok(handle.deviceKey.some(byte => byte !== 0));
      finish.resolve();
      await Promise.all([write, shutdown]);
      assert.ok(handle.deviceKey.every(byte => byte === 0));
      lifecycle.assertMatrixAccountOpen(accountId);
      if (action === 'logout') assert.equal(records.size, 0);
      else assert.equal((await engine.loadOutbox(accountId, oldKeyCopy))[0].event.text, 'valid pending');
    }
  }
});

test('queued Web/native mutations cannot overwrite a replacement session after a delayed read', async () => {
  for (const file of ['matrix-engine-web.ts', 'matrix-engine-native.ts']) {
    const entered = deferred(), finish = deferred();
    const { engine, handle, accountId, records, lifecycle } = await lifecycleEngine(file, {
      getItem: async () => { entered.resolve(); await finish.promise; return null; },
    });
    const mutation = engine.mutateOutbox(accountId, handle.deviceKey, () => []);
    const rejected = assert.rejects(mutation, /session is closed/);
    await entered.promise;
    await lifecycle.closeMatrixKey(handle.deviceKey);
    handle.deviceKey.fill(0);
    records.set('outbox', 'replacement-session-ciphertext');
    finish.resolve();
    await rejected;
    assert.equal(records.get('outbox'), 'replacement-session-ciphertext');
  }
});

test('old Web SDK secret callbacks and refresh cannot modify a replacement session', async () => {
  const { createMatrixCredentialRefresher } = await import('../src/matrix-token-refresh.mjs');
  const { bindings, handle, accountId, lifecycle, records } = await lifecycleEngine('matrix-engine-web.ts');
  const entered = deferred(), finish = deferred();
  const { createOptions } = closures('matrix-engine-web.ts', ['saveCredentials', 'saveSecretStorageKey', 'refreshCredentials', 'createOptions'], {
    createMatrixCredentialRefresher, credentialRefreshers: new WeakMap(),
    ...bindings, accountId, deviceKey: handle.deviceKey,
    credentials: { homeserverUrl: 'https://matrix.example', userId: '@own:matrix.example', deviceId: 'device_test' },
    MATRIX_CREDENTIAL_AAD: new Uint8Array(), MATRIX_SECRET_AAD: new Uint8Array(),
    request: async () => { entered.resolve(); await finish.promise; return { ok: true }; },
    globalThis: { fetch: async () => ({ ok: true, json: async () => ({ access_token: 'fixture_token', expires_in_ms: 60000 }) }) },
  });
  const refresh = createOptions.tokenRefreshFunction('fixture_refresh');
  const rejected = assert.rejects(refresh, /session is closed/);
  await entered.promise;
  await lifecycle.closeMatrixKey(handle.deviceKey);
  handle.deviceKey.fill(0);
  const replacement = { keyId: 'new_secret', privateKey: new Uint8Array(32).fill(6) };
  bindings.secretStorageKeys.set(accountId, replacement);
  records.set('credentials', 'new-session-ciphertext');
  createOptions.cryptoCallbacks.cacheSecretStorageKey('old_secret', {}, new Uint8Array(32).fill(8));
  assert.equal(await createOptions.cryptoCallbacks.getSecretStorageKey({ keys: { new_secret: {} } }), null);
  assert.equal(bindings.secretStorageKeys.get(accountId), replacement);
  assert.ok(replacement.privateKey.every(byte => byte === 6));
  finish.resolve();
  await rejected;
  assert.equal(records.get('credentials'), 'new-session-ciphertext');
  assert.equal(records.has('secret'), false);
});

test('Web/native cleanup still zeroizes keys and releases shutdown lock on storage failure', async () => {
  for (const file of ['matrix-engine-web.ts', 'matrix-engine-native.ts']) {
    const { engine, accountId, handle, lifecycle } = await lifecycleEngine(file, {
      multiRemove: async () => { throw Error('fixture storage failure'); },
    });
    if (file.includes('web')) await assert.rejects(engine.logout(accountId), /fixture storage failure/);
    else await engine.logout(accountId);
    assert.ok(handle.deviceKey.every(byte => byte === 0));
    lifecycle.assertMatrixAccountOpen(accountId);
  }
});

test('both encrypted queues preserve corrupt bytes and never write over them on Web or native', async () => {
  const lifecycle = await import('../src/matrix-key-lifecycle.mjs');
  const { xchacha20poly1305 } = await import('@noble/ciphers/chacha.js');
  const { base64UrlToBytes, bytesToBase64Url } = await import('../src/mls-runtime.mjs');
  const key = new Uint8Array(32).fill(7), nonce = new Uint8Array(24).fill(8);
  for (const file of ['matrix-engine-web.ts', 'matrix-engine-native.ts']) {
    for (const notification of [false, true]) {
      const loadName = notification ? 'loadNotificationOutbox' : 'loadOutbox';
      const mutateName = notification ? 'mutateNotificationOutbox' : 'mutateOutbox';
      const aad = new TextEncoder().encode(notification ? 'VOLNA-MATRIX-NOTIFICATION-OUTBOX-V1' : 'VOLNA-MATRIX-OUTBOX-V1');
      let stored = null, writes = 0;
      const engine = closures(file, [loadName, mutateName], {
        ...lifecycle,
        AsyncStorage: { getItem: async () => stored }, outboxStorageKey: () => 'queue', notificationOutboxStorageKey: () => 'queue',
        base64UrlToBytes, xchacha20poly1305, normalizeContentEvent, MAX_OUTBOX_ITEMS: 256,
        MATRIX_OUTBOX_AAD: aad, MATRIX_NOTIFICATION_OUTBOX_AAD: aad,
        SAFE_ID: /^[A-Za-z0-9_-]{8,80}$/, SAFE_EVENT_ID: /^\$[^\s]{1,254}$/,
        outboxLocks: new Map(), notificationOutboxLocks: new Map(),
        saveOutbox: async () => { writes++; }, saveNotificationOutbox: async () => { writes++; },
      });
      assert.equal((await engine[loadName]('account_test', key)).length, 0);
      const encrypt = items => JSON.stringify({ v: 1, nonce: bytesToBase64Url(nonce), ciphertext: bytesToBase64Url(xchacha20poly1305(key, nonce, aad).encrypt(new TextEncoder().encode(JSON.stringify(items)))) });
      const valid = { v: 1, id: 'message_test', threadId: 'thread_test', queuedAt: '2026-09-05T12:00:00.000Z', submitted: false,
        eventId: '$event', event: { v: 1, kind: 'message.create', logicalMessageId: 'message_test', clientCreatedAt: '2026-09-05T12:00:00.000Z', text: 'pending' } };
      stored = encrypt([valid]);
      assert.equal((await engine[loadName]('account_test', key)).length, 1);
      for (const corrupt of ['', '{broken', '{}', encrypt({ wrong: true }), encrypt([valid, { invalid: true }])]) {
        stored = corrupt;
        await assert.rejects(engine[mutateName]('account_test', key, () => []), /данные не изменены/);
        assert.equal(stored, corrupt);
        assert.equal(writes, 0);
      }
    }
  }
});

test('every pending retry reauthorizes the room and reuses its durable Matrix transaction id', async () => {
  const { requireMatrixRecipientCrypto } = await import('../src/matrix-recipient-policy.mjs');
  let allowed = false, prepareCount = 0, checks = 0;
  const sent = [], persisted = [];
  const own = '@volna_alice:volna.social';
  const pending = { v: 1, id: 'transaction_test', threadId: 'thread_test', partnerAccountId: 'account_bobby', roomId: '!authorized:volna.social', queuedAt: new Date().toISOString(), event: { text: 'private' } };
  const engine = closures('matrix-engine-web.ts', ['sendPending'], {
    requireMatrixRecipientCrypto,
    sendMatrixContentOnce: async (client, _room, content, txn) => client.sendEvent('!authorized:volna.social', 'm.room.message', content, txn),
    request: async () => { prepareCount++; return { ok: true, json: async () => ({ roomId: '!authorized:volna.social', ownMatrixUserId: own, partnerMatrixUserId: '@volna_bobby:volna.social' }) }; },
    assertRoomContract: async (_handle, thread, room) => { checks++; assert.equal(thread.id, pending.threadId); assert.equal(room, '!authorized:volna.social'); assert.equal(thread.partner.id, 'account_bobby'); if (!allowed) throw Error('encryption missing'); },
    matrixServerName: () => 'volna.social', matrixUserIdForAccount: () => '@volna_bobby:volna.social',
    normalizeContentEvent: event => event, encodeMatrixMessageContent: event => event, previewForEvent: () => 'private', safeIdentifier: value => value,
    EventType: { RoomMessage: 'm.room.message' },
    mutateNotificationOutbox: async (_a, _k, mutate) => { persisted.push(...mutate([])); }, mutateOutbox: async () => {}, flushNotificationOutbox: async () => {},
  });
  const handle = { accountId: 'account_test', credentials: { userId: own, deviceId: 'device_test' }, deviceKey: new Uint8Array(32),
    pendingSendIds: new Set(), roomByThreadId: new Map([['thread_test', '!server-injected:volna.social']]), localPending: new Map(),
    client: { getCrypto: () => ({ getRoomKeyRecipientPolicyVersion: () => 1, getAuthenticatedBackupVersion: () => 1, bindRoomKeyRecipients: async (room, peer) => { assert.equal(room, pending.roomId); assert.equal(peer, '@volna_bobby:volna.social'); } }), joinRoom: async () => {}, sendEvent: async (...args) => { sent.push(args); return { event_id: '$same-event' }; } },
  };
  await assert.rejects(engine.sendPending(handle, pending), /encryption missing/);
  assert.equal(sent.length, 0);
  assert.equal(handle.pendingSendIds.size, 0);
  allowed = true;
  await engine.sendPending(handle, pending);
  await engine.sendPending(handle, pending);
  assert.equal(prepareCount, 3);
  assert.equal(checks, 3);
  assert.deepEqual(sent.map(args => [args[0], args[3]]), [['!authorized:volna.social', pending.id], ['!authorized:volna.social', pending.id]]);
  assert.equal(persisted.length, 2);
});

test('Web retries reject a changed peer or room and never infer missing durable recipient authority', async () => {
  const { requireMatrixRecipientCrypto } = await import('../src/matrix-recipient-policy.mjs');
  const own = '@volna_alice:volna.social';
  const pending = { v: 1, id: 'message_bound', threadId: 'thread_test', partnerAccountId: 'account_bobby', roomId: '!original:volna.social', event: {}, queuedAt: new Date().toISOString() };
  let prepared, sends = 0, writes = 0, joins = 0;
  const engine = closures('matrix-engine-web.ts', ['sendPending'], {
    requireMatrixRecipientCrypto,
    request: async () => ({ ok: true, json: async () => prepared }), assertRoomContract: async () => ({}),
    matrixServerName: () => 'volna.social', matrixUserIdForAccount: id => `@volna_${id}:volna.social`,
    safeIdentifier: value => value, normalizeContentEvent: value => value, encodeMatrixMessageContent: value => value, previewForEvent: () => '',
    sendMatrixContentOnce: async () => { sends++; return { event_id: '$sent' }; },
    mutateOutbox: async () => { writes++; }, mutateNotificationOutbox: async () => { writes++; }, flushNotificationOutbox: async () => {},
  });
  const handle = { accountId: 'account_alice', credentials: { userId: own, deviceId: 'device_alice' }, pendingSendIds: new Set(),
    roomByThreadId: new Map(), localPending: new Map(), client: { getCrypto: () => ({ getRoomKeyRecipientPolicyVersion: () => 1, getAuthenticatedBackupVersion: () => 1, bindRoomKeyRecipients: async (room, peer) => { assert.equal(room, pending.roomId); assert.equal(peer, '@volna_account_bobby:volna.social'); } }), joinRoom: async () => { joins++; } } };
  const valid = { ownMatrixUserId: own, partnerMatrixUserId: '@volna_account_bobby:volna.social', roomId: pending.roomId };
  for (const bad of [{ ...valid, partnerMatrixUserId: '@volna_messaging:volna.social' }, { ...valid, partnerMatrixUserId: '@volna_account_other:volna.social' }, { ...valid, roomId: '!other:volna.social' }]) {
    prepared = bad;
    await assert.rejects(engine.sendPending(handle, pending), /identity mismatch/);
  }
  prepared = valid;
  await assert.rejects(engine.sendPending(handle, { ...pending, partnerAccountId: undefined, roomId: undefined }), /получатель/);
  assert.equal(sends, 0); assert.equal(writes, 0); assert.equal(joins, 0);
  assert.equal(handle.pendingSendIds.size, 0);
  await engine.sendPending(handle, pending);
  assert.equal(sends, 1); assert.equal(writes, 2);
  handle.client.getCrypto = () => ({});
  await assert.rejects(engine.sendPending(handle, pending), /обновлённая библиотека/);
  assert.equal(sends, 1); assert.equal(writes, 2); assert.equal(joins, 1);
});

test('native pending sends cannot be redirected through a replaced room or peer mapping', async () => {
  const pending = { v: 1, id: 'message_bound', threadId: 'thread_test', partnerAccountId: 'account_bobby', roomId: '!original:volna.social', event: {}, submitted: false };
  let sends = 0, writes = 0;
  const engine = closures('matrix-engine-native.ts', ['submitPending'], {
    normalizeContentEvent: value => value, encodeMatrixMessageContent: value => value, previewForEvent: () => '', safeIdentifier: value => value,
    matrixUserIdForAccount: (account, server) => `@volna_${account}:${server}`, matrixServerName: () => 'volna.social',
    nativeBridge: {
      bindRoomKeyRecipients: async (account, room, peer) => {
        assert.equal(account, 'account_alice'); assert.equal(room, pending.roomId);
        assert.equal(peer, '@volna_account_bobby:volna.social');
      },
      sendMessage: async () => { sends++; },
    }, mutateOutbox: async () => { writes++; },
  });
  const handle = { active: true, accountId: 'account_alice', credentials: { deviceId: 'device_alice' }, submittingSendIds: new Set(), pendingByLogicalId: new Map(),
    roomByThreadId: new Map([['thread_test', '!other:volna.social']]), threadByRoomId: new Map() };
  await assert.rejects(engine.submitPending(handle, { ...pending }), /identity mismatch/);
  handle.roomByThreadId.set('thread_test', pending.roomId);
  handle.threadByRoomId.set(pending.roomId, { id: pending.threadId, partner: { id: 'account_other' } });
  await assert.rejects(engine.submitPending(handle, { ...pending }), /identity mismatch/);
  handle.threadByRoomId.set(pending.roomId, { id: pending.threadId, partner: { id: pending.partnerAccountId } });
  await assert.rejects(engine.submitPending(handle, { ...pending, partnerAccountId: undefined, roomId: undefined }), /получатель/);
  assert.equal(sends, 0); assert.equal(writes, 0);
  await engine.submitPending(handle, { ...pending });
  assert.equal(sends, 1); assert.equal(writes, 1);
});

test('native rejects old runtime and binds the local peer before opening a room', async () => {
  const events = [];
  let features = ['session-lifecycle', 'room-timeline-v1', 'authenticated-timeline-v1'];
  const nativeBridge = {
    getRuntimeInfo: () => ({ available: true, implementation: 'matrix-rust-sdk-ffi', apiVersion: 1, features }),
    bindRoomKeyRecipients: async (_account, room, peer) => { events.push(['bind', room, peer]); },
    openRoom: async () => { events.push(['open']); return {}; }, closeRoom: async () => {},
  };
  const engine = closures('matrix-engine-native.ts', ['requireNativeSessionRuntime', 'requireNativeRoomRuntime', 'openNativeRoom'], {
    nativeBridge, SAFE_ROOM_ID: /^![^:]+:.+$/, matrixServerName: () => 'example.org',
    matrixUserIdForAccount: (id, server) => `@${id}:${server}`,
    assertRoomContract: async () => {}, admitNativeTimeline() {}, processNativeSnapshot: async () => {}, flushPendingForThread: async () => {}, matrixThread: () => ({}),
  });
  const handle = { active: true, accountId: 'alice', credentials: { userId: '@alice:example.org' }, roomByThreadId: new Map(), threadByRoomId: new Map(), recordsByThreadId: new Map() };
  const thread = { id: 'thread', partner: { id: 'bob' } };
  await assert.rejects(engine.openNativeRoom(handle, thread, '!room:example.org'), /не поддерживает/);
  assert.equal(events.length, 0);
  features = [...features, 'strict-room-key-recipients-v1', 'authenticated-backup-v1'];
  await assert.rejects(engine.openNativeRoom(handle, thread, '!room:example.org'), /не поддерживает/);
  features.push('history-pagination-v1');
  await assert.rejects(engine.openNativeRoom(handle, thread, '!room:example.org', '@outsider:example.org'), /identity mismatch/);
  assert.equal(events.length, 0);
  await engine.openNativeRoom(handle, thread, '!room:example.org');
  assert.deepEqual(events, [['bind', '!room:example.org', '@bob:example.org'], ['open']]);
  nativeBridge.bindRoomKeyRecipients = async () => { throw new Error('immutable binding conflict'); };
  await assert.rejects(engine.openNativeRoom(handle, thread, '!other:example.org'), /identity mismatch/);
  assert.equal(events.length, 2);
});

test('native reopening preserves unbound legacy messages without blocking other bound sends', async () => {
  const legacy = { id: 'legacy_test', threadId: 'thread_test', submitted: false };
  const bound = { id: 'message_bound', threadId: 'thread_test', partnerAccountId: 'account_bobby', roomId: '!room:volna.social', submitted: false };
  const calls = [];
  const engine = closures('matrix-engine-native.ts', ['flushPendingForThread'], { submitPending: async (_handle, pending) => { calls.push(pending.id); } });
  const handle = { pendingByLogicalId: new Map([[legacy.id, legacy], [bound.id, bound]]) };
  await engine.flushPendingForThread(handle, 'thread_test');
  assert.deepEqual(calls, [bound.id]);
  assert.equal(handle.pendingByLogicalId.get(legacy.id), legacy);
});

test('Web/native encrypted outboxes retain the original peer and room, and preserve unbound legacy records', async () => {
  for (const file of ['matrix-engine-web.ts', 'matrix-engine-native.ts']) {
    const { engine, accountId, handle, records, validation } = await lifecycleEngine(file);
    validation.resolve();
    await engine.sendContentEvent(accountId, { id: 'thread_test', partner: { id: 'account_bobby' }, encryptionMode: 'MATRIX_V1' }, {
      v: 1, kind: 'message.create', logicalMessageId: 'message_test', clientCreatedAt: new Date().toISOString(), text: 'bound private fixture',
    });
    const [bound] = await engine.loadOutbox(accountId, handle.deviceKey);
    assert.equal(bound.partnerAccountId, 'account_bobby');
    assert.equal(bound.roomId, '!room:volna.social');
    assert.equal(records.get('outbox').includes('account_bobby'), false);
    for (const bad of [{ ...bound, partnerAccountId: undefined }, { ...bound, roomId: undefined }, { ...bound, partnerAccountId: 'bad' }, { ...bound, roomId: '!bad room:volna.social' }]) {
      await engine.saveOutbox(accountId, handle.deviceKey, [bad]);
      const unchanged = records.get('outbox');
      await assert.rejects(engine.mutateOutbox(accountId, handle.deviceKey, () => []), /данные не изменены/);
      assert.equal(records.get('outbox'), unchanged);
    }
    const legacy = { ...bound }; delete legacy.partnerAccountId; delete legacy.roomId;
    await engine.saveOutbox(accountId, handle.deviceKey, [legacy]);
    const unchanged = records.get('outbox');
    const [restored] = await engine.loadOutbox(accountId, handle.deviceKey);
    assert.equal(restored.partnerAccountId, undefined); assert.equal(restored.roomId, undefined);
    assert.equal(restored.event.text, legacy.event.text); assert.equal(records.get('outbox'), unchanged);
  }
});

test('Web projection and local search retain authentic incoming messages but reject clear, mismatched and bundled replacement content', async () => {
  const policy = await import('../src/matrix-event-policy.mjs');
  const { encodeMatrixMessageContent, decodeMatrixMessageContent } = await import('../src/matrix-message-codec.mjs');
  const own = '@volna_alice:volna.social', partner = '@volna_bobby:volna.social';
  const shell = { id: 'thread_test', partner: { id: 'account_bobby' }, messages: [] };
  const create = (id, text, timestamp = Date.now()) => ({
    getId: () => id, getSender: () => partner, getTs: () => timestamp,
    getWireType: () => 'm.room.encrypted', getType: () => 'm.room.message', isDecryptionFailure: () => false,
    getOriginalContent: () => encodeMatrixMessageContent({ v: 1, kind: 'message.create', logicalMessageId: id, clientCreatedAt: new Date().toISOString(), text }, { body: text, deviceId: 'device_bobby' }),
    getContent: () => { throw Error('unsigned replacement must never be read'); },
  });
  const good = create('message_original', 'find authentic incoming');
  const clear = { ...create('message_clear', 'find forged clear'), getWireType: () => 'm.room.message' };
  const mismatch = { ...create('message_mismatch', 'find mismatched sender'), badShield: true };
  const invalidTime = create('message_badtime', 'find invalid timestamp', 1e20);
  const handle = { accountId: 'account_alice', credentials: { userId: own, deviceId: 'device_alice' }, localPending: new Map(),
    roomByThreadId: new Map([['thread_test', '!room:volna.social']]), threadById: new Map([['thread_test', shell]]),
    client: { getRoom: () => ({ getLiveTimeline: () => ({ getEvents: () => [good, clear, mismatch, invalidTime] }) }),
      getCrypto: () => ({ getEncryptionInfoForEvent: async event => ({ shieldColour: event.badShield ? 2 : 1, shieldReason: event.badShield ? 99 : 1 }) }) },
  };
  const engine = closures('matrix-engine-web.ts', ['messagesForRoom', 'searchLocalMessages'], {
    ...policy, decodeMatrixMessageContent, normalizeContentEvent, matrixUserIdForAccount: () => partner, matrixServerName: () => 'volna.social',
    matrixEventId: event => event.getId(), matrixDeviceProjectionId: () => 'device_bobby',
    EventShieldColour: { NONE: 0 }, EventShieldReason: { UNVERIFIED_IDENTITY: 1 },
    capabilities: async () => ({ enabled: true }), getHandle: async () => handle,
  });
  let unavailable = false;
  const messages = await engine.messagesForRoom(handle, shell, '!room:volna.social', () => { unavailable = true; });
  assert.equal(unavailable, true, 'rejected authentication must produce an availability notice, not forged content');
  assert.equal(messages.length, 1);
  assert.equal(messages[0].senderAccountId, 'account_bobby');
  const results = await engine.searchLocalMessages('account_alice', 'find');
  assert.equal(results.length, 1);
  assert.equal(results[0].message.text, 'find authentic incoming');
});


test('account security queries only own identity without a prepared room and refuses arbitrary verification targets', async () => {
  const own = '@own:volna.social';
  const queried = [];
  const handle = { credentials: { userId: own, deviceId: 'OWN' }, verifications: new Map(), client: {
    secretStorage: { getDefaultKeyId: async () => 'existing' },
    getCrypto: () => ({
      getUserDeviceInfo: async ids => { queried.push([...ids]); return new Map([[own, new Map()]]); },
      getVersion: () => 'fixture', isCrossSigningReady: async () => true, isSecretStorageReady: async () => true,
    }),
  } };
  const secretStorageKeys = new Map();
  const web = closures('matrix-engine-web.ts', ['getRoomSecurity', 'startDeviceVerification'], { getHandle: async () => handle, verificationState: item => item, secretStorageKeys });
  const result = await web.getRoomSecurity('account', null);
  assert.deepEqual(queried, [[own]]);
  assert.equal(result.partnerDevices.length, 0);
  assert.equal(result.partnerIdentityVerified, false);
  assert.equal(result.recoveryKeyExists, true);
  assert.equal(result.secretStorageReady, false, 'a fresh endpoint must offer recovery for existing server secrets');
  secretStorageKeys.set('account', { keyId: 'obsolete', privateKey: new Uint8Array(32) });
  assert.equal((await web.getRoomSecurity('account', null)).secretStorageReady, false);
  secretStorageKeys.set('account', { keyId: 'existing', privateKey: new Uint8Array(32) });
  assert.equal((await web.getRoomSecurity('account', null)).secretStorageReady, true);
  await assert.rejects(web.startDeviceVerification('account', null, '@stranger:volna.social', 'OTHER'), /mismatch/);
});
