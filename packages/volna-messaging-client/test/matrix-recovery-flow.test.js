const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const rn = require('react-native-web');
const { renderToStaticMarkup } = require('react-dom/server');

test('recovery replacement has its own confirmation, requires a ready device, and keeps technical keys out of ordinary steps', async () => {
  const presentation = await import('../src/matrix-security-presentation.mjs');
  const source = fs.readFileSync(path.join(__dirname, '../src/matrix-security-flow.tsx'), 'utf8');
  const module = { exports: {} };
  const context = { module, exports: module.exports, require(name) {
    if (name === 'react-native') return rn;
    if (name === './matrix-security-presentation.mjs') return presentation;
    if (name === './loading') return { LoadingIndicator: () => null };
    if (name === './mls-runtime.mjs') return {};
    if (name === 'expo-clipboard') return {};
    if (name === 'react-native-qrcode-svg') return () => null;
    if (name === 'lucide-react-native') return new Proxy({}, { get: () => () => null });
    return require(name);
  } };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
  let replacements = 0;
  const security = { crossSigningReady: true, secretStorageReady: true, recoveryKeyExists: true,
    ownDevices: [{ current: true, verified: true, deviceId: 'private_identifier', ed25519: 'public_fingerprint' }], partnerDevices: [], pendingVerifications: [] };
  const props = { security, verification: null, busy: false, error: null, recoveryKey: '', onResetRecovery: () => { replacements++; } };
  const render = (overrides = {}) => renderToStaticMarkup(React.createElement(module.exports.MatrixSecurityFlow, { ...props, ...overrides }));
  const account = render({ scope: 'account' });
  assert.match(account, /Ваши устройства|Восстановление доступа/);
  assert.doesNotMatch(account, /Проверить собеседника/);
  const conversation = render({ scope: 'conversation' });
  assert.doesNotMatch(conversation, /Ваши устройства|Восстановление доступа|Подтвердите новое устройство/);
  const accountDiagnostics = render({ scope: 'account', initialStep: 'details' });
  assert.doesNotMatch(accountDiagnostics, /Устройства собеседника/);
  const recovery = render({ initialStep: 'recovery' });
  assert.match(recovery, /Потеряли ключ/);
  assert.doesNotMatch(recovery, /public_fingerprint|private_identifier|Заменить и создать новый ключ/);
  const confirmation = render({ initialStep: 'reset-recovery' });
  assert.match(confirmation, /Заменить и создать новый ключ/);
  assert.match(confirmation, /Сообщения, ключи от которых потеряны/);
  assert.match(confirmation, /Отмена/);
  assert.equal(replacements, 0);
  const unverified = render({ initialStep: 'reset-recovery', security: { ...security, ownDevices: [{current: true, verified: false}] } });
  assert.doesNotMatch(unverified, /Заменить и создать новый ключ/);
  assert.match(unverified, /Подтвердить устройство/);
  const saved = render({ recoveryKey: 'new_recovery_key', closeRequested: true });
  assert.match(saved, /new_recovery_key/);
  assert.match(saved, /Я сохранил ключ/);
  assert.match(saved, /Прежде чем закрыть/);
  const sas = render({ verification: { id: 'fixture', phase: 'started', initiatedByMe: true, otherUserId: 'peer', otherDeviceId: 'other',
    sasEmoji: [['🐶', 'Собака']], sasDecimal: [1234, 5678, 9012], qrCodeBase64: 'old_qr', qrSupported: true } });
  assert.match(sas, /Собака/);
  assert.match(sas, /Всё совпадает/);
  assert.doesNotMatch(sas, /Отсканируйте/);
});
