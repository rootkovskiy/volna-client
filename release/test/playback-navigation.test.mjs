import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const parse = file => ts.createSourceFile(file, fs.readFileSync(path.join(root, file), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const app = parse('apps/mobile/App.tsx');
const compile = code => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
function findAll(source, predicate) {
  const matches = [];
  function visit(node) { if (predicate(node)) matches.push(node); ts.forEachChild(node, visit); }
  visit(source); return matches;
}
function harness() {
  let request = null;
  const jsx = (type, props, key) => ({ type, props, key });
  const context = {
    exports: {}, require: () => ({ jsx, jsxs: jsx }),
    useState: () => [request, value => { request = typeof value === 'function' ? value(request) : value; }],
    useCallback: callback => callback,
    AppTopBarProvider: 'topbar', CatalogLocationProvider: 'account', DevelopmentLoadingScreen: 'loading', GlobalAudioProvider: 'audio',
    ScreenContinuityProvider: 'screens', MainAppContent: 'content',
  };
  const declarations = app.statements.filter(node => ts.isFunctionDeclaration(node) && ['MainApp', 'MainAppSession'].includes(node.name?.text));
  vm.runInNewContext(compile(declarations.map(node => node.getText(app)).join('\n') + '\nexports.render = MainApp;'), context);
  return props => {
    const nodes = [];
    function walk(node, ancestors = []) {
      if (!node) return;
      const identity = [...ancestors, `${typeof node.type === 'function' ? node.type.name : node.type}:${node.key ?? ''}`];
      nodes.push({ ...node, identity });
      if (typeof node.type === 'function') walk(node.type(node.props), identity);
      else for (const child of [node.props.children].flat()) walk(child, identity);
    }
    walk(context.exports.render(props));
    return type => nodes.filter(node => node.type === type);
  };
}
const props = { ownAccountId: 'account-a', navigationReset: 1, activeTab: 'music', profileMode: 'view', mustChangePassword: false, onNotify() {}, onChangeTab() {} };

test('all main-tab resets preserve audio identity while remounting screen state', () => {
  const render = harness();
  const initial = render(props);
  assert.equal(initial('audio').length, 1);
  let reset = props.navigationReset;
  for (const activeTab of ['events', 'locations', 'community', 'feed', 'music', 'music']) {
    const next = render({ ...props, activeTab, navigationReset: ++reset });
    assert.deepEqual(next('audio')[0].identity, initial('audio')[0].identity);
    assert.notDeepEqual(next('screens')[0].identity, initial('screens')[0].identity);
    assert.ok(next('screens')[0].identity.includes('audio:'));
    assert.equal(next('audio')[0].props.storageScope, props.ownAccountId);
  }
  const content = app.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'MainAppContent');
  assert.equal(findAll(content, node => (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(app) === 'GlobalAudioProvider').length, 0);
});

test('account replacement changes player identity; forced password changes remove it', () => {
  const render = harness();
  const before = render(props)('audio')[0];
  const after = render({ ...props, ownAccountId: 'account-b' })('audio')[0];
  assert.notDeepEqual(after.identity, before.identity);
  assert.equal(after.props.storageScope, 'account-b');
  assert.equal(render({ ...props, mustChangePassword: true })('audio').length, 0);
});

test('player-to-post handoff survives the tab reset and acknowledges only its own request', () => {
  const render = harness();
  let target;
  const current = { ...props, onChangeTab: tab => { target = tab; } };
  const track = { id: 'fixture-track', provider: 'bandcamp' };
  render(current)('audio')[0].props.onAddTrackToPost(track);
  assert.equal(target, 'feed');
  const feed = render({ ...current, activeTab: target, navigationReset: 2 })('content')[0].props;
  assert.equal(feed.releaseComposerRequest.track, track);
  feed.onReleaseComposerRequestHandled(feed.releaseComposerRequest.nonce - 1);
  assert.ok(render(current)('content')[0].props.releaseComposerRequest);
  feed.onReleaseComposerRequestHandled(feed.releaseComposerRequest.nonce);
  assert.equal(render(current)('content')[0].props.releaseComposerRequest, null);
});

test('Feed owns accepted metadata work after acknowledging the session handoff', () => {
  const source = parse('apps/mobile/src/screens/FeedScreen.tsx');
  const effect = findAll(source, node => ts.isCallExpression(node) && node.expression.getText(source) === 'useEffect' && node.arguments[0]?.getText(source).includes('setAcceptedComposerRequest'))[0];
  assert.ok(effect);
  let accepted, acknowledged;
  const request = { nonce: 31, track: { id: 'fixture' } };
  const context = { composerRequest: request, setAcceptedComposerRequest: value => { accepted = value; }, onComposerRequestHandled: nonce => { acknowledged = nonce; } };
  const code = compile(`(${effect.arguments[0].getText(source)})();`);
  vm.runInNewContext(code, context);
  assert.equal(accepted, request); assert.equal(acknowledged, 31);
  context.composerRequest = null;
  vm.runInNewContext(code, context);
  assert.equal(accepted, request);
});
