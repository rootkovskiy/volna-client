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
const petersburg = { cityId: 'ru-saint-petersburg', cityName: 'Санкт-Петербург', countryCode: 'RU', countryName: 'Россия' };
const empty = { cityId: '', cityName: '', countryCode: '', countryName: '' };

function loadState() {
  const context = { exports: {} };
  vm.runInNewContext(compile(fs.readFileSync(path.join(root, 'apps/mobile/src/components/catalogLocationState.ts'), 'utf8')), context);
  return context.exports;
}

const state = loadState();

function providerHarness() {
  let slots = [], cursor = 0;
  const react = {
    createContext: initial => { const context = { current: initial }; context.Provider = context; return context; },
    useContext: context => context.current,
    useCallback: callback => callback,
    useEffect: () => undefined,
    useRef: initial => { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useState: initial => {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], update => { slots[index] = typeof update === 'function' ? update(slots[index]) : update; }];
    },
  };
  const context = { exports: {}, require(name) {
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime') return { jsx: (provider, props) => { provider.current = props.value; return props.children; } };
    if (name === './catalogLocationState') return state;
    if (name === '@react-native-async-storage/async-storage') return { default: {} };
    if (name === '../api/client') return { apiFetch: () => {}, apiUrl: '' };
    if (name === '../location/detectCity') return { nearestSelectableCity: () => null };
    if (name === '../location/foregroundLocation') return { resolveForegroundLocation: () => null };
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

test('Events and Locations keep one geographic choice across screen remounts', () => {
  const account = providerHarness();
  assert.equal(account.read(), null);
  account.choose('nearby', { ...moscow, dateFrom: '21.09.2026', venue: { id: 'private-draft' } });
  for (let navigation = 0; navigation < 4; navigation++) assert.deepEqual({ ...account.read() }, moscow);
  account.choose('nearby', { ...empty, countryCode: 'RU', countryName: 'Россия' });
  assert.equal(account.read().countryCode, 'RU');
  account.choose('nearby', empty);
  assert.deepEqual({ ...account.read() }, empty);
});

test('Communities keeps an independent choice and provider account remount resets memory', () => {
  const account = providerHarness();
  account.choose('nearby', moscow);
  account.choose('communities', empty);
  assert.deepEqual({ ...account.read() }, moscow);
  assert.deepEqual({ ...account.read('communities') }, empty);
  account.resetAccount();
  assert.equal(account.read(), null);
  assert.equal(account.read('communities'), null);
});

test('persisted account choices survive reload and malformed storage is ignored', () => {
  let selected = state.selectCatalogLocation(state.emptyCatalogLocationState(), 'nearby', moscow);
  selected = state.selectCatalogLocation(selected, 'communities', empty);
  const restored = state.parseCatalogLocationState(state.serializeCatalogLocationState(selected));
  assert.deepEqual({ ...restored.choices.nearby }, moscow);
  assert.deepEqual({ ...restored.choices.communities }, empty);
  assert.equal(state.parseCatalogLocationState('{broken').choices.nearby, null);
  assert.equal(state.parseCatalogLocationState(JSON.stringify({ version: 1, choices: { nearby: { cityId: 1 }, communities: null } })).choices.nearby, null);
});

test('fresh GPS changes a city only after the detected city changed between sessions', () => {
  let selected = state.applyDetectedCatalogCity(state.emptyCatalogLocationState(), petersburg);
  selected = state.selectCatalogLocation(selected, 'nearby', moscow);
  assert.deepEqual({ ...state.applyDetectedCatalogCity(selected, petersburg).choices.nearby }, moscow);
  assert.deepEqual({ ...state.applyDetectedCatalogCity(selected, moscow).choices.nearby }, moscow);
  const travelled = state.applyDetectedCatalogCity(selected, { ...petersburg, cityId: 'ru-kazan', cityName: 'Казань' });
  assert.equal(travelled.choices.nearby.cityId, 'ru-kazan');
  for (const choice of [empty, { ...empty, countryCode: 'RU', countryName: 'Россия' }]) {
    assert.deepEqual({ ...state.applyDetectedCatalogCity(state.selectCatalogLocation(selected, 'nearby', choice), moscow).choices.nearby }, choice);
  }
});

test('catalog screens delegate automatic detection to the account provider', () => {
  const app = fs.readFileSync(path.join(root, 'apps/mobile/App.tsx'), 'utf8');
  assert.match(app, /CatalogLocationProvider accountId=\{props\.ownAccountId\}/);
  for (const screen of ['EventScreens', 'CommunityScreens']) {
    const source = fs.readFileSync(path.join(root, `apps/mobile/src/screens/${screen}.tsx`), 'utf8');
    assert.doesNotMatch(source, /resolveForegroundLocation/);
  }
});
