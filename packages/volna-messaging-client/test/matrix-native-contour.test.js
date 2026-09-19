'use strict';

const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');

const packageRoot = path.resolve(__dirname, '..');
const source = (name) => readFile(path.join(packageRoot, 'src', name), 'utf8');
const nativeBridgeSource = (name) => readFile(path.resolve(packageRoot, '..', 'volna-matrix-native', name), 'utf8');

test('native Matrix room content stays in the public endpoint manager and uses no web crypto engine', async () => {
  const native = await source('matrix-engine-native.ts');
  assert.doesNotMatch(native, /matrix-js-sdk/);
  assert.doesNotMatch(native, /\/chats(?:\/|['"`])/);
  assert.match(native, /requireNativeRoomRuntime\(nativeBridge\)/);
  assert.match(native, /await nativeBridge\.openRoom/);
  assert.match(native, /decodeMatrixMessageContent\(JSON\.parse\(item\.contentJson\)\)/);
  assert.match(native, /await nativeBridge\.sendMessage/);
  assert.match(native, /projectMatrixContentEvents\(records\)/);
  assert.match(native, /item\.authenticated !== true/);
  assert.match(native, /features\.includes\('authenticated-timeline-v1'\)/);
});

test('Matrix retry queues reject overflow instead of dropping old durable entries', async () => {
  for (const file of ['matrix-engine-native.ts', 'matrix-engine-web.ts']) {
    const engine = await source(file);
    assert.match(engine, /const MAX_OUTBOX_ITEMS = 256;/);
    assert.match(engine, /items\.length > MAX_OUTBOX_ITEMS/);
    assert.match(engine, /plaintext\.length > MAX_OUTBOX_PLAINTEXT_BYTES/);
    assert.match(engine, /plaintext\.length > MAX_NOTIFICATION_OUTBOX_PLAINTEXT_BYTES/);
    assert.doesNotMatch(engine, /JSON\.stringify\(items\.slice\(-256\)\)/);
  }
});

test('native confirmed sends persist a content-free notification before acknowledgement', async () => {
  const native = await source('matrix-engine-native.ts');
  const acknowledgement = native.slice(
    native.indexOf('const acknowledgeRemoteSend'),
    native.indexOf('const processNativeSnapshot'),
  );
  const notificationWrite = acknowledgement.indexOf('await mutateNotificationOutbox');
  const sendRemoval = acknowledgement.indexOf('await mutateOutbox');
  assert.ok(notificationWrite >= 0 && sendRemoval > notificationWrite);
  assert.doesNotMatch(acknowledgement, /text|attachment|body/);
});

test('native Matrix security excludes unsigned devices and verifies the displayed cross-signing chain', async () => {
  const [engine, android, ios] = await Promise.all([
    source('matrix-engine-native.ts'),
    nativeBridgeSource('android/src/main/java/social/volna/matrix/VolnaMatrixNativeModule.kt'),
    nativeBridgeSource('ios/VolnaMatrixNativeModule.swift'),
  ]);
  assert.match(android, /roomKeyRecipientStrategy\(CollectStrategy\.IDENTITY_BASED_STRATEGY\)/);
  assert.match(ios, /roomKeyRecipientStrategy\(strategy: \.identityBasedStrategy\)/);
  assert.match(android, /getShields\(true\)/);
  assert.match(ios, /getShields\(strict: true\)/);
  assert.match(android, /debugInfo\(\)\.originalJson/);
  assert.match(ios, /debugInfo\(\)\.originalJson/);
  assert.doesNotMatch(android, /latestJson/);
  assert.doesNotMatch(ios, /latestJson/);
  assert.match(engine, /verifyMatrixSignedObject\(selfSigning, userId, masterKeyId, masterPublicKey\)/);
  assert.match(engine, /verifyMatrixSignedObject\(device, userId, ownerSigning\.keyId, ownerSigning\.publicKey\)/);
  assert.match(engine, /identity\.masterKey !== masterPublicKey/);
  assert.match(engine, /crossSigningDeviceIds\.has\(deviceId\)/);
  assert.doesNotMatch(engine, /matrix-js-sdk/);
});

test('native verification exposes SAS and rejects unavailable verification QR', async () => {
  const [engine, messages, flow] = await Promise.all([
    source('matrix-engine-native.ts'),
    source('react-native-messages.tsx'),
    source('matrix-security-flow.tsx'),
  ]);
  assert.match(engine, /nativeBridge\.startSasVerification/);
  assert.match(engine, /nativeBridge\.confirmVerification/);
  assert.match(engine, /не поддерживает verification QR/);
  assert.doesNotMatch(engine, /QrCodeData|qrLogin/i);
  assert.match(messages, /if \(!thread \|\| device\.current\) return/);
  assert.match(flow, /Подтвердить устройство/);
  assert.match(flow, /verification\.qrSupported/);
  assert.match(messages, /Math\.max\(safeAreaInsets\.bottom, 8\)/);
  assert.match(flow, /onSelect=\{own \? ownTargets\.includes\(device\)/);
  // Geometry/keyboard behavior is exercised by chat-composer.test.cjs and the
  // shared viewport tests. The contour checks ownership, not retired geometry.
  assert.match(messages, /<View style=\{ui\.messageHistory\}>\s*<ComposerFade \/>/);
  assert.doesNotMatch(messages, /composerHeight|setComposerHeight/);
  assert.match(messages, /useWebChatViewport\(ui\.composer\.backgroundColor\)/);
  assert.match(messages, /webViewport\.keyboardPaddingBottom/);
  assert.doesNotMatch(messages, /transform:\s*\[\{\s*translateY:\s*webViewport\.offsetTop/);
  assert.match(messages, /accessibilityLabel="Сообщение"[^>]*multiline=\{false\}/);
});

test('chat music controls keep playback intent stable while the media engine loads', async () => {
  const messages = await source('react-native-messages.tsx');
  assert.match(messages, /const \[playbackIntent, setPlaybackIntent\] = useState\(false\)/);
  assert.match(messages, /const playbackRequestRef = useRef\(0\)/);
  assert.match(messages, /playing: playbackIntent/);
  assert.match(messages, /loading \? <LoadingIndicator/);
  assert.doesNotMatch(messages, /ActivityIndicator/);
  assert.doesNotMatch(messages, /playing: Boolean\(status\.playing\)/);
  assert.match(messages, /fillProgress\.interpolate\(\{ inputRange: \[0, 1\], outputRange: \['0%', '100%'\] \}\)/);
  assert.match(messages, /onMoveShouldSetPanResponder: .*Math\.abs\(gesture\.dx\) > 3/);
  assert.match(messages, /setPointerCapture\?\.\(event\.pointerId\)/);
  assert.match(messages, /touchAction: 'pan-y'/);
  assert.match(messages, /onTouchEnd=\{endNativeTap\}/);
  assert.match(messages, /Math\.hypot\(pageX - start\.pageX, pageY - start\.pageY\) > 8/);
  assert.match(messages, /else \{\s*event\.preventDefault\(\);\s*clearSettle\(\);\s*updateWebScrub\(event\.currentTarget, event\.clientX, true\)/);
  assert.match(messages, /role: 'slider'/);
  assert.match(messages, /await player\.seekTo\(nextTime\)/);
});

test('public message sheets use the shared UI Kit shell without a local animation copy', async () => {
  const messages = await source('react-native-messages.tsx');
  assert.match(messages, /import \{ AppSheetModal \} from '\.\/app-sheet'/);
  assert.match(messages, /return <AppSheetModal isVisible=\{isVisible\} onClose=\{onClose\}/);
  assert.doesNotMatch(messages, /<Modal|const sheetTranslateY|const backdropOpacity/);
});
