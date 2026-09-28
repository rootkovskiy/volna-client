'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const ACCOUNT = 'account_alice_123';
const OTHER_ACCOUNT = 'account_other_123';
const pending = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const row = (id = 'thread_12345678') => ({
  id, partner: { id: 'account_bobby_123', username: 'bobby', name: 'Bobby', avatarUrl: null, isVerified: false },
  encryptionMode: 'MATRIX_V1', protocolVersion: 1, messages: [],
  lastMessageText: 'unverified server content', lastMessageAt: '2026-09-05T00:00:00.000Z',
});
const verified = (rows) => rows.map((item) => ({ ...item, lastMessageText: 'endpoint preview', messages: [{
  id: 'message_12345678', threadId: item.id, senderAccountId: ACCOUNT,
  text: 'private timeline', createdAt: item.lastMessageAt, reactions: [], securityMode: 'e2ee',
}] }));

async function fixture({ decorate = async (_account, rows) => verified(rows), fetchPage } = {}) {
  const { createMessagingSurfaceController } = await import('../src/messaging-surface-controller.mjs');
  const calls = [];
  const controller = createMessagingSurfaceController({
    apiOrigin: 'https://api.example.test',
    fetch: async (url, init) => {
      calls.push({ url, init });
      return fetchPage ? fetchPage(url, init) : Response.json({ items: [row()], nextCursor: 'next-page' });
    },
    getSecureMessagingClient: async () => {
      throw new Error('MLS must not block Matrix identity rows');
    },
    loadMessagingCapabilities: async () => ({ rolloutEnabled: false }),
    matrixMessaging: { decorateThreads: decorate },
  });
  return { controller, calls };
}

test('an identical timestamp cannot reuse a preview belonging to a different latest message', async () => {
  let serverRow = { ...row(), lastMessageId: 'message_first_123' };
  const { controller } = await fixture({ fetchPage: async () => Response.json({ items: [serverRow] }) });
  await controller.listThreads(ACCOUNT);
  serverRow = { ...serverRow, lastMessageId: 'message_second_123' };
  let initial;
  await controller.listThreads(ACCOUNT, { onInitialPage: page => { initial = page.items[0]; } });
  assert.equal(initial.previewAvailable, false);
  assert.equal(initial.lastMessageText, null);
});

test('encrypted history with deletions still requires endpoint projection and cannot reuse API plaintext', async () => {
  const state = { hasDeletions: true, clearedBefore: null, deletedMessageIds: [] };
  const { controller } = await fixture({ fetchPage: async url => Response.json(url.includes('/deletions/check') ? state : { items: [{ ...row(), lastMessageId: 'message_12345678', visibility: state }] }) });
  await controller.listThreads(ACCOUNT);
  let initial;
  await controller.listThreads(ACCOUNT, { onInitialPage: page => { initial = page.items[0]; } });
  assert.equal(initial.lastMessageText, null);
  assert.equal(initial.previewAvailable, false);
});

test('identity rows paint while crypto is blocked; provisional content is redacted and final preview is endpoint-owned', async () => {
  const crypto = pending();
  const initial = pending();
  const { controller, calls } = await fixture({ decorate: async (_account, rows) => { await crypto.promise; return verified(rows); } });
  let finished = false;
  const work = controller.listThreads(ACCOUNT, { onInitialPage: initial.resolve }).then((page) => { finished = true; return page; });
  const page = await initial.promise;
  assert.equal(finished, false);
  assert.equal(page.items[0].partner.name, 'Bobby');
  assert.equal(page.items[0].lastMessageText, null);
  assert.equal(page.items[0].previewPending, true);
  assert.deepEqual(page.items[0].messages, []);
  assert.equal(controller.getThreadListSnapshot(ACCOUNT), null);
  crypto.resolve();
  assert.equal((await work).items[0].lastMessageText, 'endpoint preview');
  const snapshot = controller.getThreadListSnapshot(ACCOUNT);
  assert.deepEqual(snapshot.items[0].messages, []);
  assert.equal(snapshot.nextCursor, 'next-page');
  snapshot.items[0].partner.name = 'changed by caller';
  assert.equal(controller.getThreadListSnapshot(ACCOUNT).items[0].partner.name, 'Bobby');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.cache, 'no-store');
});

test('mounted verified inbox does not repaint pending text on repeated background reads', async () => {
  const { mergeThreadListPage } = await import('../src/thread-list-presentation.mjs');
  const crypto = pending();
  let reads = 0;
  const { controller } = await fixture({ decorate: async (_account, rows) => {
    if (++reads === 2) await crypto.promise;
    return verified(rows);
  } });
  let visible = [];
  const first = await controller.listThreads(ACCOUNT, {
    onInitialPage: page => { visible = mergeThreadListPage(visible, page, true, true); },
  });
  assert.equal(visible[0].previewPending, true);
  visible = mergeThreadListPage(visible, first, true, false);
  assert.equal(visible[0].lastMessageText, 'endpoint preview');
  const verifiedRows = visible;
  const refresh = controller.listThreads(ACCOUNT, {
    onInitialPage: page => { visible = mergeThreadListPage(visible, page, true, true); },
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.strictEqual(visible, verifiedRows);
  assert.equal(visible[0].lastMessageText, 'endpoint preview');
  crypto.resolve();
  visible = mergeThreadListPage(visible, await refresh, true, false);
  assert.equal(visible[0].lastMessageText, 'endpoint preview');
});

test('return snapshot never skips a fresh authorized read and expires after 60 seconds', async (t) => {
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const { controller, calls } = await fixture();
  await controller.listThreads(ACCOUNT);
  now += 59_999;
  assert.ok(controller.getThreadListSnapshot(ACCOUNT));
  now += 1;
  assert.equal(controller.getThreadListSnapshot(ACCOUNT), null);
  await controller.listThreads(ACCOUNT);
  await controller.listThreads(ACCOUNT);
  assert.equal(calls.length, 3);
});

test('ready empty preview survives refresh but not identity, time or protocol changes', async () => {
  let serverRow = row();
  const { controller } = await fixture({
    fetchPage: async () => Response.json({ items: [serverRow] }),
    decorate: async (_account, rows) => rows.map(item => ({ ...item, lastMessageText: null })),
  });
  await controller.listThreads(ACCOUNT);
  let phase;
  await controller.listThreads(ACCOUNT, { onInitialPage: page => { phase = page.items[0]; } });
  assert.equal(phase.previewAvailable, true);
  assert.equal(phase.previewPending, true); // no fresh security claim
  assert.equal(phase.lastMessageText, null);
  for (const change of [
    { lastMessageAt: '2026-09-06T00:00:00.000Z' },
    { partner: { ...row().partner, id: 'account_changed_123' } },
    { protocolVersion: 2 },
  ]) {
    serverRow = { ...row(), ...change };
    const refresh = controller.listThreads(ACCOUNT, { onInitialPage: page => { phase = page.items[0]; } });
    if (change.protocolVersion) await assert.rejects(refresh, { code: 'unsupported_protocol' });
    else await refresh;
    assert.equal(phase.previewAvailable, false);
    assert.equal(phase.lastMessageText, null);
    serverRow = row();
    await controller.listThreads(ACCOUNT);
  }
});

test('a local decrypted timeline date does not invalidate an unchanged server row', async () => {
  const { controller } = await fixture({
    fetchPage: async () => Response.json({ items: [{ ...row(), lastMessageId: 'message_12345678' }] }),
    decorate: async (_account, rows) => rows.map(item => ({
      ...item, lastMessageAt: '2026-09-04T00:00:00.000Z', lastMessageText: 'verified local preview',
    })),
  });
  await controller.listThreads(ACCOUNT);
  let provisional;
  await controller.listThreads(ACCOUNT, { onInitialPage: page => { provisional = page.items[0]; } });
  assert.equal(provisional.previewAvailable, true);
  assert.equal(provisional.lastMessageText, 'verified local preview');
  assert.equal(provisional.lastMessageAt, '2026-09-05T00:00:00.000Z');
});

test('pagination updates its own rows without replacing the first-page snapshot', async () => {
  const { controller } = await fixture({ fetchPage: async (url) => Response.json({
    items: [row(url.includes('cursor=') ? 'thread_second_123' : 'thread_12345678')],
    nextCursor: url.includes('cursor=') ? null : 'next-page',
  }) });
  await controller.listThreads(ACCOUNT);
  const phases = [];
  const page = await controller.listThreads(ACCOUNT, { cursor: 'next-page', onInitialPage: (page) => phases.push(page) });
  assert.equal(phases[0].items[0].id, 'thread_second_123');
  assert.equal(page.items[0].lastMessageText, 'endpoint preview');
  assert.equal(controller.getThreadListSnapshot(ACCOUNT).items[0].id, 'thread_12345678');
});

test('logout invalidates in-flight crypto results; they cannot repopulate a cleared session', async () => {
  const crypto = pending();
  const initial = pending();
  const { controller } = await fixture({ decorate: async (_account, rows) => { await crypto.promise; return verified(rows); } });
  const work = controller.listThreads(ACCOUNT, { onInitialPage: initial.resolve });
  await initial.promise;
  controller.clearThreadListSnapshot(ACCOUNT);
  crypto.resolve();
  await assert.rejects(work, { code: 'thread_list_cancelled' });
  assert.equal(controller.getThreadListSnapshot(ACCOUNT), null);
});

test('switching accounts evicts the old snapshot and blocks the old pending response', async () => {
  const crypto = pending();
  const initial = pending();
  const { controller } = await fixture({ decorate: async (account, rows) => {
    if (account === ACCOUNT) await crypto.promise;
    return verified(rows);
  } });
  const old = controller.listThreads(ACCOUNT, { onInitialPage: initial.resolve });
  await initial.promise;
  assert.equal(controller.getThreadListSnapshot(OTHER_ACCOUNT), null);
  await controller.listThreads(OTHER_ACCOUNT);
  crypto.resolve();
  await assert.rejects(old, { code: 'thread_list_cancelled' });
  assert.equal(controller.getThreadListSnapshot(ACCOUNT), null);
  assert.ok(controller.getThreadListSnapshot(OTHER_ACCOUNT));
});

test('leaving the screen suppresses the late result and snapshot write', async () => {
  const crypto = pending();
  const initial = pending();
  const abort = new AbortController();
  const { controller } = await fixture({ decorate: async (_account, rows) => { await crypto.promise; return verified(rows); } });
  const work = controller.listThreads(ACCOUNT, { signal: abort.signal, onInitialPage: initial.resolve });
  await initial.promise;
  abort.abort();
  crypto.resolve();
  await assert.rejects(work, { code: 'thread_list_cancelled' });
  assert.equal(controller.getThreadListSnapshot(ACCOUNT), null);
});

test('slow older refresh cannot overwrite a newer verified snapshot', async () => {
  const slow = pending();
  const initial = pending();
  let sequence = 0;
  const { controller } = await fixture({ decorate: async (_account, rows) => {
    const number = ++sequence;
    if (number === 1) await slow.promise;
    return verified(rows).map((item) => ({ ...item, lastMessageText: `preview ${number}` }));
  } });
  const older = controller.listThreads(ACCOUNT, { onInitialPage: initial.resolve });
  await initial.promise;
  await controller.listThreads(ACCOUNT);
  slow.resolve();
  await older;
  assert.equal(controller.getThreadListSnapshot(ACCOUNT).items[0].lastMessageText, 'preview 2');
});

test('crypto failure retains early identity rows and a new request can retry', async () => {
  let fail = true;
  let initial;
  const { controller } = await fixture({ decorate: async (_account, rows) => {
    if (fail) throw new Error('crypto offline');
    return verified(rows);
  } });
  await assert.rejects(controller.listThreads(ACCOUNT, { onInitialPage: (page) => { initial = page; } }), /crypto offline/);
  assert.equal(initial.items.length, 1);
  assert.equal(initial.items[0].lastMessageText, null);
  fail = false;
  assert.equal((await controller.listThreads(ACCOUNT)).items[0].lastMessageText, 'endpoint preview');
});

test('authorization failure discards the snapshot; an empty inbox never waits on Matrix', async () => {
  let status = 200;
  const { controller } = await fixture({ fetchPage: async () => status === 200
    ? Response.json({ items: [row()], nextCursor: null }) : new Response('', { status }) });
  await controller.listThreads(ACCOUNT);
  status = 403;
  await assert.rejects(controller.listThreads(ACCOUNT), { code: 'thread_list_access_revoked' });
  assert.equal(controller.getThreadListSnapshot(ACCOUNT), null);
  const empty = await fixture({
    fetchPage: async () => Response.json({ items: [], nextCursor: null }),
    decorate: async () => { throw new Error('empty inbox must not initialize crypto'); },
  });
  assert.deepEqual(await empty.controller.listThreads(ACCOUNT), { items: [], nextCursor: null });
});

test('a long valid message produces a bounded preview instead of breaking the inbox', async () => {
  const { controller } = await fixture({ decorate: async (_account, rows) => verified(rows).map((item) => ({ ...item, lastMessageText: 'a'.repeat(4000) })) });
  const result = await controller.listThreads(ACCOUNT);
  assert.equal(result.items[0].lastMessageText.length, 1000);
  assert.equal(controller.getThreadListSnapshot(ACCOUNT).items[0].lastMessageText.length, 1000);
});

test('oversized pages fail before any provisional rows are published', async () => {
  const { controller } = await fixture({ fetchPage: async () => Response.json({ items: Array.from({ length: 31 }, (_, index) => row(`thread_long_${index}`)), nextCursor: null }) });
  await assert.rejects(controller.listThreads(ACCOUNT, { onInitialPage: () => assert.fail('oversized list must not paint') }), { code: 'thread_page_items' });
  assert.equal(controller.getThreadListSnapshot(ACCOUNT), null);
});
