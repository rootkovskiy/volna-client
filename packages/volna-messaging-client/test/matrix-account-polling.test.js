const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const storeErrors = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/matrix-store-errors.mjs'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, allowJs: true }, fileName: 'store-errors.js',
}).outputText, { exports: storeErrors.exports, Error });
const presentation = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/matrix-security-presentation.mjs'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, allowJs: true }, fileName: 'presentation.js',
}).outputText, { exports: presentation.exports, Error, require(name) {
  assert.equal(name, './matrix-store-errors.mjs'); return storeErrors.exports;
} });

function harness(getAccountSecurity) {
  const slots = [], effects = [], queued = [], timers = new Map();
  let cursor = 0, clock = 0, timerId = 0, tree;
  const react = {
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = initial;
      return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }];
    },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useEffect(fn, deps) {
      const i = cursor++, old = effects[i];
      if (!old || deps.some((v, n) => v !== old.deps[n])) queued.push(() => {
        old?.cleanup?.(); effects[i] = { deps, cleanup: fn() };
      });
    },
  };
  const create = (type, props) => ({ type, props });
  const context = { exports: {}, Error,
    setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { at: clock + ms, fn }); return id; },
    clearTimeout(id) { timers.delete(id); },
    require(name) {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx: create, jsxs: create };
      if (name === 'react-native') return { View: 'View', ScrollView: 'ScrollView', Platform: { OS: 'android' }, StyleSheet: { create: x => x }, BackHandler: { addEventListener: () => ({ remove() {} }) } };
      if (name === 'expo-camera') return { useCameraPermissions: () => [null, async () => ({ granted: false })] };
      if (name === './screen-top-bar') return { ScreenTopBar: 'header' };
      if (name === './matrix-security-flow') return { MatrixSecurityFlow: 'flow', MatrixSecurityAction: 'action' };
      if (name === './matrix-security-presentation.mjs') return { ...presentation.exports, selectMatrixVerification: next => next.pendingVerifications?.[0] ?? null };
      if (name === './mls-runtime.mjs') return {};
      if (name === './matrix-qr-payload.mjs') return { matrixQrPayload() { throw new Error('Polling must not scan a QR code'); } };
      throw new Error(name);
    },
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/matrix-account-security.tsx'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText, context);
  const props = { accountId: 'qa_a', manager: { getAccountSecurity }, onBack() {} };
  function render() { cursor = 0; tree = context.exports.MatrixAccountSecurityScreen(props); while (queued.length) queued.shift()(); }
  function find(node) { if (node?.type === 'flow') return node.props; for (const child of [node?.props?.children].flat(Infinity)) { if (child && typeof child === 'object') { const value = find(child); if (value) return value; } } }
  async function settle() { for (let i = 0; i < 8; i++) await Promise.resolve(); render(); }
  render();
  return {
    settle, flow: () => find(tree),
    async advance(ms) {
      const end = clock + ms;
      while (true) {
        const next = [...timers].filter(([, t]) => t.at <= end).sort((a,b) => a[1].at - b[1].at)[0];
        if (!next) break;
        clock = next[1].at; timers.delete(next[0]); next[1].fn(); await settle();
      }
      clock = end; await settle();
    },
    unmount() { effects.forEach(effect => effect?.cleanup?.()); },
    timerCount: () => timers.size,
  };
}

test('account security stops network polling after failure and explicit retry resumes it', async () => {
  let calls = 0, fail = true;
  const security = { ownDevices: [], pendingVerifications: [] };
  const h = harness(async () => { calls++; if (fail) throw new Error('Fixture connection failure'); return security; });
  await h.settle();
  assert.equal(h.flow().error, presentation.exports.matrixSecurityErrorMessage(new Error('Fixture connection failure')));
  await h.advance(60000);
  assert.equal(calls, 1, 'failed initialization must not hammer the device-binding endpoint');
  fail = false; h.flow().onRetry(); await h.settle();
  assert.equal(calls, 2); assert.equal(h.flow().error, null);
  await h.advance(1500); assert.equal(calls, 3);
  h.unmount(); assert.equal(h.timerCount(), 0);
});

test('rapid retry does not duplicate an in-flight read and a late read cannot restart polling after close', async () => {
  let calls = 0, resolve;
  const h = harness(() => { calls++; return new Promise(done => { resolve = done; }); });
  h.flow().onRetry(); h.flow().onRetry();
  await h.advance(5000); assert.equal(calls, 1);
  h.unmount(); resolve({ ownDevices: [], pendingVerifications: [] });
  await h.settle(); assert.equal(h.timerCount(), 0);
});
