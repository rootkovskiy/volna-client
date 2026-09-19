const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function messageGroup(OS, interactive) {
  const file = 'react-native-messages.tsx';
  const source = ts.createSourceFile(file, fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), ts.ScriptTarget.Latest, true);
  const row = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'MessageRow');
  const create = (type, props) => ({ type, props });
  const context = { exports: {}, Object, Platform: { OS }, ui: {}, View: 'View', Text: 'Text', Pressable: 'Pressable', Timestamp: 'Timestamp', formatClock: () => '12:00', dayKey: () => 'day',
    require: () => ({ jsx: create, jsxs: create }),
  };
  vm.runInNewContext(ts.transpileModule(`${row.getText(source)}\nexports.row = MessageRow;`, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, context);
  let opened = 0;
  const message = { senderAccountId: 'a', createdAt: '', text: 'QA', reactions: [] };
  const tree = context.exports.row({ accountId: 'a', interactive, message, previous: message, onLongPress: () => opened++ });
  function find(node) { if (node?.type === 'Pressable') return node.props; for (const child of [node?.props?.children].flat(Infinity)) { if (child && typeof child === 'object') { const value = find(child); if (value) return value; } } }
  return { props: find(tree), opened: () => opened };
}

test('Web message actions use context click and keyboard without hijacking ordinary text/media keys', () => {
  const h = messageGroup('web', true);
  let prevented = 0, stopped = 0;
  const event = { preventDefault: () => prevented++, stopPropagation: () => stopped++, shiftKey: false, repeat: false };
  assert.equal(h.props.tabIndex, 0);
  assert.equal(h.props.dataSet['volna-touch-action'], 'true');
  h.props.onContextMenu(event);
  h.props.onKeyDown({ ...event, key: 'F10', shiftKey: true });
  h.props.onKeyDown({ ...event, key: 'ContextMenu' });
  for (const key of ['Enter', ' ', 'F10', 'a']) h.props.onKeyDown({ ...event, key });
  h.props.onKeyDown({ ...event, key: 'ContextMenu', repeat: true });
  assert.equal(h.opened(), 3); assert.equal(prevented, 3); assert.equal(stopped, 2);
});

test('native keeps long press and accessibility actions; untrusted messages get no action path', () => {
  for (const OS of ['ios', 'android', 'web']) {
    const enabled = messageGroup(OS, true);
    enabled.props.onLongPress();
    enabled.props.onAccessibilityAction({ nativeEvent: { actionName: 'longpress' } });
    assert.equal(enabled.opened(), 2);
    if (OS !== 'web') { assert.equal(enabled.props.onContextMenu, undefined); assert.equal(enabled.props.dataSet, undefined); }
    const disabled = messageGroup(OS, false);
    assert.equal(disabled.props.onLongPress, undefined);
    assert.equal(disabled.props.dataSet, undefined);
    assert.equal(disabled.props.onContextMenu, undefined);
    assert.equal(disabled.props.onKeyDown, undefined);
    assert.equal(disabled.props.accessibilityActions, undefined);
    disabled.props.onAccessibilityAction({ nativeEvent: { actionName: 'longpress' } });
    assert.equal(disabled.opened(), 0);
  }
});
