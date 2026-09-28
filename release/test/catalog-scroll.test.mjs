import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function scrollHarness(memory = new Map()) {
  const slots = [];
  let cursor = 0;
  const react = {
    createContext: () => ({}),
    useContext: () => memory,
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useLayoutEffect(effect) { effect(); },
    useCallback: callback => callback,
    useState(initial) { const index = cursor++; return [slots[index] ??= typeof initial === 'function' ? initial() : initial, value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }]; },
  };
  const context = { exports: {}, require(name) {
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime') return { jsx: () => null };
    throw Error(name);
  } };
  const source = fs.readFileSync(path.join(root, 'apps/mobile/src/components/ScreenContinuity.tsx'), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, context);
  return { memory, render(key, options = {}) { cursor = 0; return context.exports.useScreenScroll(key, options); } };
}

test('early PWA touch keeps a fresh event list at the user offset after its first page arrives', () => {
  const h = scrollHarness();
  const commands = [];
  let scroll = h.render('events:music', { loading: true });
  scroll.ref({ scrollToOffset: ({ offset }) => commands.push(offset) });
  scroll.onLayout({ nativeEvent: { layout: { height: 400 } } });
  scroll.onContentSizeChange(400, 900);
  scroll.onTouchStart();
  scroll.onScroll({ nativeEvent: { contentOffset: { y: 280 }, layoutMeasurement: { height: 400 } } });
  scroll = h.render('events:music', { loading: false });
  scroll.onContentSizeChange(400, 1800);
  assert.deepEqual(commands, []);
  assert.equal(h.memory.get('events:music'), 280);
});

test('saved scroll restores if untouched, but a new category resets once at navigation', () => {
  const h = scrollHarness(new Map([['events:music', 700]]));
  const commands = [];
  let scroll = h.render('events:music', { loading: true });
  scroll.ref({ scrollToOffset: ({ offset }) => commands.push(offset) });
  scroll.onLayout({ nativeEvent: { layout: { height: 400 } } });
  scroll.onContentSizeChange(400, 1100);
  h.render('events:music', { loading: false });
  assert.equal(commands.at(-1), 700);
  scroll = h.render('events:cinema', { loading: true });
  assert.equal(commands.at(-1), 0);
  scroll.onTouchStart();
  h.render('events:cinema', { loading: false }).onContentSizeChange(400, 1500);
  assert.equal(commands.filter(offset => offset === 0).length, 1);
});
