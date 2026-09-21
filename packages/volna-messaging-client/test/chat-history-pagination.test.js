const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function pagerHarness() {
  const slots = [], frames = new Map(); let cursor = 0, effects = [], id = 0;
  const effect = (fn, deps) => {
    const index = cursor++;
    if (!deps || !slots[index] || deps.some((value, i) => value !== slots[index].deps?.[i])) {
      effects.push(() => { slots[index]?.cleanup?.(); slots[index] = { deps, cleanup: fn() }; });
    }
  };
  const react = {
    useRef: value => slots[cursor++] ??= { current: value },
    useCallback: fn => { const index = cursor++; return slots[index] ??= fn; },
    useEffect: effect, useLayoutEffect: effect,
  };
  const context = { exports: {}, require: name => { assert.equal(name, 'react'); return react; },
    requestAnimationFrame: fn => { frames.set(++id, fn); return id; }, cancelAnimationFrame: id => frames.delete(id) };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/chat-history-pagination.ts'), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return {
    render(options) { cursor = 0; const result = context.exports.useChatHistoryPagination(options); const pending = effects; effects = []; pending.forEach(fn => fn()); return result; },
    settle() { for (let i = 0; i < 2; i++) { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn()); } },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}

test('short chats continue through service-only pages without a scroll or size change, stopping at SDK end', () => {
  const h = pagerHarness(); let calls = 0;
  const options = { enabled: true, revision: 0, canLoad: () => true, load: () => calls++ };
  let pager = h.render(options); h.settle(); assert.equal(calls, 0, 'wait for measurements');
  pager.onLayout(600); pager.onContentSizeChange(600); h.settle(); assert.equal(calls, 1);
  pager = h.render({ ...options, revision: 1 }); h.settle(); assert.equal(calls, 2);
  h.render({ ...options, revision: 2, enabled: false }); h.settle(); assert.equal(calls, 2);
});

test('long chats open at the latest messages; approaching top continues even through unchanged pages', () => {
  const h = pagerHarness(); let calls = 0;
  const options = { enabled: true, revision: 0, canLoad: () => true, load: () => calls++ };
  const pager = h.render(options);
  pager.onLayout(500); pager.onContentSizeChange(2000); h.settle(); assert.equal(calls, 0);
  pager.onScroll(1500, 2000, 500); h.settle(); assert.equal(calls, 0);
  pager.onScroll(45, 2000, 500); pager.check(); pager.check(); h.settle(); assert.equal(calls, 1);
  h.render({ ...options, revision: 1 }); h.settle(); assert.equal(calls, 2);
  pager.onContentSizeChange(2800); pager.restoreOffset(845); h.render({ ...options, revision: 2 }); h.settle();
  assert.equal(calls, 2, 'a restored reading anchor ends the automatic burst');
});

test('busy, error, background and pending anchor fence queued work; resize and resume recheck geometry', () => {
  const h = pagerHarness(); let calls = 0, allowed = false;
  const options = { enabled: true, revision: 0, canLoad: () => allowed, load: () => calls++ };
  const pager = h.render(options); pager.onLayout(400); pager.onContentSizeChange(600);
  allowed = true; pager.onLayout(700); h.render({ ...options, enabled: false }); h.settle(); assert.equal(calls, 0);
  h.render({ ...options, revision: 1 }); h.settle(); assert.equal(calls, 1);
  allowed = false; pager.check(); h.settle(); assert.equal(calls, 1);
  allowed = true; h.render({ ...options, revision: 2 }); h.settle(); assert.equal(calls, 2);
  pager.check(); h.unmount(); h.settle(); assert.equal(calls, 2, 'no request after route/account retirement');
});

test('a chat only slightly taller than the viewport can reach older history', () => {
  const h = pagerHarness(); let calls = 0;
  const pager = h.render({ enabled: true, revision: 0, canLoad: () => true, load: () => calls++ });
  pager.onLayout(500); pager.onContentSizeChange(600); h.settle();
  pager.onScroll(100, 600, 500); h.settle(); assert.equal(calls, 0);
  pager.onScroll(20, 600, 500); h.settle(); assert.equal(calls, 1);
});

function loadHarness() {
  const source = fs.readFileSync(path.join(__dirname, '../src/react-native-messages.tsx'), 'utf8');
  const ast = ts.createSourceFile('chat.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback; const visit = node => { if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'loadEarlier') callback = node.initializer.getText(ast); ts.forEachChild(node, visit); }; visit(ast);
  const context = { exports: {}, accountId: 'alice', partnerUsername: 'bob',
    thread: { hasMoreHistory: true, messages: [{ id: 'current' }] },
    historyBusy: { current: false }, historyOperation: { current: 0 }, historyEmptyPages: { current: 0 },
    historyPager: { isShort: () => false }, nearBottom: { current: false }, openRevision: { current: 0 },
    historyOffset: { current: 40 }, historyRowY: { current: new Map([['current', 12]]) },
    historyAnchor: { current: null }, historyRefreshQueued: { current: false },
    setHistoryLoading(value) { context.busy = value; }, setHistoryError(value) { context.error = value; },
    setThread(next) { context.thread = next; }, open() { context.refreshes++; }, refreshes: 0,
  };
  vm.runInNewContext(ts.transpileModule(`exports.load = ${callback}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return context;
}

test('actual page operation coalesces, passes explicit bounded request and retains measured reading anchor', async () => {
  const h = loadHarness(); let finish, calls = 0;
  h.controller = { openThread(_account, _peer, options) { assert.equal(options.loadEarlier, true); assert.equal(options.markRead, false); calls++; return new Promise(resolve => { finish = resolve; }); } };
  const request = h.exports.load(); await h.exports.load(); assert.equal(calls, 1);
  h.historyOffset.current = 60; h.historyRefreshQueued.current = true;
  finish({ hasMoreHistory: true, messages: [{ id: 'older' }, { id: 'current' }] }); await request;
  assert.equal(h.historyAnchor.current.offset, 60); assert.equal(h.historyAnchor.current.y, 12);
  assert.equal(h.historyBusy.current, false); assert.equal(h.refreshes, 1);
});

test('five pages without older visible rows pause without inventing SDK end; retry resets the budget', async () => {
  const h = loadHarness(); h.controller = { openThread: async () => ({ ...h.thread }) };
  for (let i = 0; i < 5; i++) await h.exports.load();
  assert.equal(h.error, true); assert.equal(h.thread.hasMoreHistory, true); assert.equal(h.thread.messages[0].id, 'current');
  await h.exports.load(true); assert.equal(h.error, false); assert.equal(h.historyEmptyPages.current, 1);
  h.controller.openThread = async () => ({ ...h.thread, hasMoreHistory: false });
  await h.exports.load(); assert.equal(h.historyEmptyPages.current, 0);
});

test('failed pages retain rows and retry; stale completion cannot replace a newer projection or strand busy state', async () => {
  const h = loadHarness(); const original = h.thread;
  h.controller = { openThread: async () => { throw Error('offline'); } };
  await h.exports.load(); assert.equal(h.thread, original); assert.equal(h.error, true); assert.equal(h.busy, false);
  let finish; h.controller.openThread = () => new Promise(resolve => { finish = resolve; });
  const pending = h.exports.load(true); h.openRevision.current++;
  finish({ messages: [], hasMoreHistory: false }); await pending;
  assert.equal(h.thread, original); assert.equal(h.historyBusy.current, false);
  const retired = h.exports.load(); h.historyOperation.current++; h.openRevision.current++; h.busy = 'retired';
  finish({ messages: [], hasMoreHistory: false }); await retired;
  assert.equal(h.busy, 'retired'); assert.equal(h.thread, original);
});
