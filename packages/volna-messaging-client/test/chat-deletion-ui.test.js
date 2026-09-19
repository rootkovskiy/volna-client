const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = ts.createSourceFile('messages.tsx', fs.readFileSync(path.join(__dirname, '../src/react-native-messages.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function find(predicate) {
  let found; function visit(node) { if (predicate(node)) found = node; ts.forEachChild(node, visit); } visit(source);
  assert.ok(found); return found;
}
function evaluate(expression, bindings) {
  const context = { ...bindings, exports: {}, require: () => ({ jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }) };
  vm.runInNewContext(ts.transpileModule(expression, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return context.exports.value;
}
test('the actual shared confirmation has separate explicit scopes, cancellation and disables every submission while busy', () => {
  const declaration = find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'DeletionSheet');
  const component = evaluate(`${declaration.getText(source)}; exports.value = DeletionSheet;`, { Sheet: 'Sheet', Text: 'Text', Pressable: 'Pressable', LoadingIndicator: 'LoadingIndicator', ui: {} });
  for (const message of [false, true]) for (const busy of [false, true]) {
    let cancelled = 0; const scopes = [];
    const tree = component({ isVisible: true, message, busy, error: 'Не удалось удалить', onClose: () => cancelled++, onDelete: scope => scopes.push(scope) });
    assert.equal(tree.props.title, message ? 'Удалить сообщение?' : 'Удалить переписку?');
    const children = tree.props.children.flat(Infinity).filter(Boolean);
    const buttons = children.filter(child => child.type === 'Pressable');
    assert.deepEqual(Array.from(buttons, button => button.props.children.props.children), ['Удалить у меня', 'Удалить у всех', 'Отмена']);
    assert.ok(buttons.every(button => button.props.disabled === busy));
    buttons[2].props.onPress(); assert.equal(cancelled, 1); assert.equal(scopes.length, 0);
    buttons[0].props.onPress(); buttons[1].props.onPress(); assert.deepEqual(scopes, ['self', 'everyone']);
  }
});
test('removing a currently playing attachment invalidates its pending callbacks and clears only the chat player', () => {
  const effect = find(node => ts.isCallExpression(node) && node.expression.getText(source) === 'useEffect'
    && node.arguments[0]?.getText(source).includes('visibleMessageIds.includes'));
  for (const retained of [true, false]) {
    let paused = 0, replaced = 'untouched';
    const refs = Object.fromEntries(['activeIdRef', 'statusOwnerIdRef', 'loadedUrlRef', 'transitioningRequestRef', 'playbackIntentRef', 'playbackRequestRef'].map(name => [name, { current: name === 'playbackRequestRef' ? 7 : 'music_message_123' }]));
    const run = evaluate(`exports.value = ${effect.arguments[0].getText(source)};`, { ...refs,
      visibleMessageIds: retained ? ['music_message_123'] : [], setActiveId() {}, setPlaybackIntent() {}, setLoading() {},
      player: { pause: () => paused++, replace: value => { replaced = value; } },
    });
    run(); assert.equal(paused, retained ? 0 : 1);
    assert.equal(replaced, retained ? 'untouched' : null);
    assert.equal(refs.playbackRequestRef.current, retained ? 7 : 8);
    assert.equal(refs.activeIdRef.current, retained ? 'music_message_123' : null);
  }
});
