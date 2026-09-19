const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const { join } = require('node:path');
const { test, before } = require('node:test');
let isActiveMatrixVerification, matrixDeviceDisplayName, matrixDeviceLabel, matrixOwnVerificationTargets, matrixSecurityOverview, selectMatrixVerification;
before(async () => {
  ({ isActiveMatrixVerification, matrixDeviceDisplayName, matrixDeviceLabel, matrixOwnVerificationTargets, matrixSecurityOverview, selectMatrixVerification } = await import('../src/matrix-security-presentation.mjs'));
});

const device = (id, current, verified) => ({ deviceId: id, userId: 'self', current, verified, displayName: 'VOLNA Web/PWA' });
const ready = () => ({ crossSigningReady: true, secretStorageReady: true, partnerIdentityChanged: false, ownDevices: [device('a', true, true)], pendingVerifications: [] });
test('ordinary confirmed device has no onboarding prompt', () => {
  assert.equal(matrixSecurityOverview(ready(), null).kind, 'ready');
  assert.equal(matrixSecurityOverview(null, null).kind, 'loading');
  assert.equal(matrixSecurityOverview({ ...ready(), ownDevices: [] }, null).kind, 'loading');
});
test('new current device can request SAS before it locally trusts its other device', () => {
  const security = { ...ready(), crossSigningReady: false, ownDevices: [device('new', true, false), device('old', false, true)] };
  assert.equal(matrixSecurityOverview(security, null).action, 'devices');
  security.ownDevices[1].verified = false;
  assert.equal(matrixSecurityOverview(security, null).action, 'devices');
  assert.equal(matrixSecurityOverview({ ...security, recoveryKeyExists: false }, null).action, 'devices');
  assert.deepEqual(matrixOwnVerificationTargets(security), [security.ownDevices[1]]);
  assert.equal(security.ownDevices[1].verified, false, 'selection must not establish trust');
  security.ownDevices.pop();
  assert.equal(matrixSecurityOverview(security, null).action, 'recovery');
  assert.equal(matrixSecurityOverview({ ...security, recoveryKeyExists: false }, null).title, 'Настройте защиту сообщений');
  assert.deepEqual(matrixOwnVerificationTargets(security), []);
  assert.deepEqual(matrixOwnVerificationTargets(null), []);
});

test('Web registers incoming verification before Rust init and the first sync, as native already does', async () => {
  const web = await readFile(join(__dirname, '../src/matrix-engine-web.ts'), 'utf8');
  const handle = web.slice(web.indexOf('const client: MatrixClient = createClient('), web.indexOf('const messagesForRoom'));
  assert.ok(handle.indexOf('client.on(CryptoEvent.VerificationRequestReceived') < handle.indexOf('await client.initRustCrypto('));
  assert.ok(handle.indexOf('client.on(CryptoEvent.VerificationRequestReceived') < handle.indexOf('await startPreparedSync(client)'));
  assert.ok(handle.indexOf('setDeviceIsolationMode') < handle.indexOf('await startPreparedSync(client)'));
  assert.match(handle, /getVerificationRequestsToDeviceInProgress\(credentials\.userId\)/);
  assert.match(handle, /client\.off\(CryptoEvent\.VerificationRequestReceived, onVerificationRequest\)/);
  assert.match(web, /item\.request\.transactionId === requestValue\.transactionId\s*&& item\.request\.otherUserId === requestValue\.otherUserId/);
  assert.match(web, /otherDeviceId: session\.request\.otherDeviceId \?\? session\.targetDeviceId/);
  assert.match(web, /registerVerification\(handle, requestValue, deviceId\)/);
  assert.match(handle, /if \(!await crypto\.userHasCrossSigningKeys\(credentials\.userId, true\)\)/);
  const android = await readFile(join(__dirname, '../../volna-matrix-native/android/src/main/java/social/volna/matrix/VolnaMatrixNativeModule.kt'), 'utf8');
  const ios = await readFile(join(__dirname, '../../volna-matrix-native/ios/VolnaMatrixNativeModule.swift'), 'utf8');
  assert.ok(android.indexOf('verificationController.setDelegate') < android.indexOf('startedSyncService.start()'));
  assert.ok(ios.indexOf('verificationController.setDelegate') < ios.indexOf('await syncService!.start()'));
});
test('another unverified device is distinct from an unverified current device', () => {
  assert.equal(matrixSecurityOverview({ ...ready(), ownDevices: [...ready().ownDevices, device('b', false, false)] }, null).kind, 'verify-other');
  assert.equal(matrixSecurityOverview({ ...ready(), secretStorageReady: false }, null).kind, 'recovery');
});
test('identity change always outranks ready or pending verification', () => {
  const overview = matrixSecurityOverview({ ...ready(), partnerIdentityChanged: true }, { phase: 'requested' });
  assert.equal(overview.kind, 'identity-changed');
  assert.equal(overview.action, 'partner');
});
test('finished and cancelled transactions never keep an onboarding prompt alive', () => {
  for (const phase of ['done', 'cancelled']) {
    assert.equal(isActiveMatrixVerification({ phase }), false);
    assert.equal(matrixSecurityOverview(ready(), { phase }).kind, 'ready');
  }
  assert.equal(matrixSecurityOverview(ready(), { phase: 'requested', initiatedByMe: false }).kind, 'verification');
});
test('terminal updates for the exact transaction replace waiting without inventing success', () => {
  const old = { id: 'one', phase: 'started' };
  const done = { id: 'one', phase: 'done' };
  assert.equal(selectMatrixVerification({ ...ready(), verificationUpdates: [done] }, old), done);
  const cancelled = { id: 'one', phase: 'cancelled' };
  assert.equal(selectMatrixVerification({ ...ready(), verificationUpdates: [cancelled] }, old), cancelled);
  assert.equal(selectMatrixVerification(ready(), old), old);
});
test('a fresh incoming verification is selected when no current transaction exists', () => {
  const incoming = { id: 'two', phase: 'requested' };
  assert.equal(selectMatrixVerification({ ...ready(), pendingVerifications: [incoming] }, null), incoming);
  const done = { id: 'one', phase: 'done' };
  assert.equal(selectMatrixVerification({ ...ready(), verificationUpdates: [done], pendingVerifications: [incoming] }, done), incoming);
});
test('device labels use available platform facts, never guessed hardware', () => {
  assert.equal(matrixDeviceDisplayName({ platform: 'ios' }), 'iOS · приложение VOLNA');
  assert.equal(matrixDeviceDisplayName({ platform: 'android' }), 'Android · приложение VOLNA');
  assert.equal(matrixDeviceDisplayName({ userAgent: 'iPhone Version/18.0 Mobile Safari/604.1' }), 'iPhone · Safari');
  assert.equal(matrixDeviceDisplayName({ userAgent: 'Windows Chrome/140.0 Safari/537.36 Edg/140.0' }), 'Windows · Edge');
  assert.equal(matrixDeviceDisplayName(), 'Браузер');
});
test('old identical names receive stable labels independent of server ordering', () => {
  const first = device('a', true, true), second = device('b', false, false);
  assert.equal(matrixDeviceLabel(first, [second, first]), 'Браузер · 1');
  assert.equal(matrixDeviceLabel(second, [first, second]), 'Браузер · 2');
  assert.equal(matrixDeviceLabel({ ...first, displayName: 'iPhone · Safari' }, []), 'iPhone · Safari');
});
test('public UX preserves real verification, one-time recovery and guarded polling', async () => {
  const source = async (name) => readFile(join(__dirname, '../src', name), 'utf8');
  const [flow, chat, web, native] = await Promise.all(['matrix-security-flow.tsx', 'react-native-messages.tsx', 'matrix-engine-web.ts', 'matrix-engine-native.ts'].map(source));
  assert.doesNotMatch(flow, /setDeviceVerified|verifyDevice\(/);
  assert.match(flow, /verification\.phase === 'cancelled'/);
  assert.match(flow, /verification\.qrNeedsConfirmation/);
  assert.match(flow, /if \(props\.recoveryKey\)/);
  assert.match(flow, /Технические сведения/);
  assert.match(chat, /matrixRecoveryKey \|\| matrixActionRunning\.current/);
  assert.match(chat, /await refreshMatrixSecurity\(\);\s*if \(active\) timer = setTimeout/);
  assert.match(web, /isSecretStorageReady\(\) \|\| await handle\.client\.secretStorage\.getDefaultKeyId\(\)/);
  assert.match(native, /if \(await hasRecoveryKey\(handle\)\) throw/);
});

test('ordinary account errors never expose SDK endpoints or identifiers', async () => {
  const { matrixSecurityErrorMessage } = await import('../src/matrix-security-presentation.mjs');
  const technical = Object.assign(new Error('MatrixError https://matrix.test/@private/device'), { httpStatus: 401 });
  assert.match(matrixSecurityErrorMessage(technical), /Выйдите из VOLNA/);
  assert.doesNotMatch(matrixSecurityErrorMessage(technical), /matrix.test|@private|device/);
  assert.equal(matrixSecurityErrorMessage(new Error('Ключ восстановления не подходит')), 'Ключ восстановления не подходит');
  assert.doesNotMatch(matrixSecurityErrorMessage(new Error('Ошибка https://matrix.test/@private')), /matrix.test|@private/);
});
