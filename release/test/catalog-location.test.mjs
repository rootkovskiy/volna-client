import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const moscow = { cityId: 'ru-moscow', cityName: 'Москва', countryCode: 'RU', countryName: 'Россия' };
const empty = { cityId: '', cityName: '', countryCode: '', countryName: '' };

function providerHarness() {
  let slots = [], cursor = 0;
  const react = {
    createContext: initial => { const context = { current: initial }; context.Provider = context; return context; },
    useContext: context => context.current,
    useCallback: callback => callback,
    useState: initial => {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], update => { slots[index] = typeof update === 'function' ? update(slots[index]) : update; }];
    },
  };
  const context = { exports: {}, require(name) {
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime') return { jsx: (provider, props) => { provider.current = props.value; return props.children; } };
    throw Error(name);
  } };
  vm.runInNewContext(compile(fs.readFileSync(path.join(root, 'apps/mobile/src/components/CatalogLocationProvider.tsx'), 'utf8')), context);
  const render = () => { cursor = 0; context.exports.CatalogLocationProvider({ children: null }); };
  render();
  return {
    read: scope => context.exports.useCatalogLocation(scope)[0],
    choose(scope, value) { context.exports.useCatalogLocation(scope)[1](value); render(); },
    resetAccount() { slots = []; render(); },
  };
}

test('new event/location consumers retain the shared choice across navigation resets', () => {
  const account = providerHarness();
  assert.equal(account.read(), null);
  account.choose('nearby', { ...moscow, dateFrom: '21.09.2026', venue: { id: 'private-draft' } });
  // Each read is a newly mounted consumer; only the account provider survives.
  for (let navigation = 0; navigation < 4; navigation++) assert.deepEqual({ ...account.read() }, moscow);
  account.choose('nearby', { ...empty, countryCode: 'RU', countryName: 'Россия' });
  assert.equal(account.read().cityId, '');
  assert.equal(account.read().countryCode, 'RU');
  account.choose('nearby', empty);
  assert.deepEqual({ ...account.read() }, empty, 'clearing is an explicit choice, not the automatic fallback');
});

test('community choice is independent, and account/logout remount clears both scopes', () => {
  const account = providerHarness();
  account.choose('nearby', moscow);
  account.choose('communities', empty);
  assert.deepEqual({ ...account.read() }, moscow);
  assert.deepEqual({ ...account.read('communities') }, empty);
  account.resetAccount();
  assert.equal(account.read(), null);
  assert.equal(account.read('communities'), null);
});

for (const screen of ['EventScreens', 'CommunityScreens']) {
  test(`${screen}: explicit city/country/clear skips automatic GPS after remount; late results cannot win`, async () => {
    const source = fs.readFileSync(path.join(root, `apps/mobile/src/screens/${screen}.tsx`), 'utf8');
    const ast = ts.createSourceFile('screen.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let effect;
    function visit(node) {
      if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect'
        && node.arguments[0]?.getText(ast).includes('const detectNearbyCity =')) effect = node.arguments[0].getText(ast);
      ts.forEachChild(node, visit);
    }
    visit(ast); assert.ok(effect);
    let requests = 0, resolvePosition; const updates = [];
    const context = { exports: {}, catalogLocation: null, apiUrl: 'https://fixture.invalid',
      resolveForegroundLocation: () => { requests++; return new Promise(resolve => { resolvePosition = resolve; }); },
      fetch: async () => ({ ok: true, json: async () => [{ id: 'ru-ekaterinburg', name: 'Екатеринбург', latitude: 56.8, longitude: 60.6, countryCode: 'RU', country: { name: 'Россия' } }] }),
      locationWasManuallyChangedRef: { current: false }, locationsManuallyChangedRef: { current: false },
      activeCatalogTabRef: { current: 'locations' }, catalogLocationsRef: { current: {} },
      nearbyCityRadiusKilometers: 120, nearbyCatalogCityRadiusKilometers: 120,
      distanceKilometers: () => 1, catalogDistanceKilometers: () => 1,
      setFilters: value => updates.push(value), setLocationFilters: value => updates.push(value),
    };
    vm.runInNewContext(compile(`exports.effect = ${effect}`), context);
    for (const choice of [moscow, empty, { ...empty, countryCode: 'RU' }]) {
      context.catalogLocation = choice;
      assert.equal(context.exports.effect(), undefined);
    }
    assert.equal(requests, 0);
    context.catalogLocation = null;
    const cleanup = context.exports.effect();
    cleanup(); // Choosing manually or leaving the account invalidates the old request.
    resolvePosition({ latitude: 56.8, longitude: 60.6 });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(updates.length, 0);
  });
}
