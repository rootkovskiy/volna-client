import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = (path) => readFile(resolve(root, path), 'utf8');
const sdkManifest = JSON.parse(await read('sdk/manifest.json'));
if (sdkManifest.android.sha256 !== '476d3586d6b6dbfff16798ea605d73bd92acdeb375e69af1fb22d99296c2c160'
  || sdkManifest.android.allArchitecturesComplete !== true
  || sdkManifest.android.elfLoadAlignmentBytes !== 16384
  || JSON.stringify(sdkManifest.android.abis) !== JSON.stringify(['arm64-v8a', 'armeabi-v7a', 'x86', 'x86_64'])) {
  throw new Error('Android four-ABI recipient artifact pin mismatch');
}
const pinnedSources = {
  webRust: ['955837c4677cd7e92e79447169b69666c0debae6', 'bdd99e2de79634ee5cabcb4c9dab78fba0e6bcbb58f5261fda2e2c6a725c4cb1'],
  wasm: ['93abc64b195b24a1335a3e796a16f4e3ccf0e3e1', '2ec12c12d3a6ad56e78f723b352be959f4f5af0de9b26e23eb43f06abce242de'],
  android: ['1e6a409be052f35e0021538212e116b3a86edaa8', '9a15b4d65edb1ddb93fe279b5db4e6beed711a61f080c1b1b14eb33c986aa90a'],
  ios: ['15a3ce2369a1e96fcad02cb2b1da3198ef23348a', 'ade15255dadaf53efdbd2469a53a31283c081951c4b8853a0c03fdeef005aaed'],
};
for (const [platform, [revision, hash]] of Object.entries(pinnedSources)) {
  const pin = sdkManifest.sources[platform];
  if (pin.revision !== revision || pin.patchSha256 !== hash
    || createHash('sha256').update(await readFile(resolve(root, 'sdk', pin.patch))).digest('hex') !== hash) {
    throw new Error(`Custom SDK source/patch pin mismatch: ${platform}`);
  }
}
const androidDigest = createHash('sha256');
if (sdkManifest.android.parts) {
  for (const part of sdkManifest.android.parts) {
    if (!/^matrix-sdk-android-26\.08\.13-volna\.1\.aar\.part[0-9]{2}$/.test(part.file)) throw new Error('Unexpected Android artifact part');
    const bytes = await readFile(resolve(root, 'sdk', part.file));
    if (createHash('sha256').update(bytes).digest('hex') !== part.sha256) throw new Error('Android artifact part hash mismatch');
    androidDigest.update(bytes);
  }
} else androidDigest.update(await readFile(resolve(root, 'sdk', sdkManifest.android.artifact)));
if (androidDigest.digest('hex') !== sdkManifest.android.sha256) throw new Error('Android SDK artifact hash mismatch');

const [androidBuild, androidModule, typescript, podspec, iosModule, prepare] = await Promise.all([
  read('android/build.gradle'),
  read('android/src/main/java/social/volna/matrix/VolnaMatrixNativeModule.kt'),
  read('src/index.ts'),
  read('ios/VolnaMatrixNative.podspec'),
  read('ios/VolnaMatrixNativeModule.swift'),
  read('scripts/prepare-ios-framework.mjs'),
]);

const checks = [
  [androidModule.includes('authenticatedBackupVersion() == 1u') && androidModule.includes('upgradeAuthenticatedBackup(false)') && androidModule.includes('upgradeAuthenticatedBackup(true)'), 'Android authenticated-backup runtime integration is missing'],
  [typescript.includes("'authenticated-backup-v1'") && androidModule.includes('"authenticated-backup-v1"') && !iosModule.includes('"authenticated-backup-v1"'), 'Authenticated-backup platform attestation is incorrect'],
  [androidModule.includes('roomKeyRecipientPolicyVersion() == 1u') && androidModule.includes('encryption.bindRoomKeyRecipients(roomId, peerId)'), 'Android recipient binding is missing'],
  [iosModule.includes('roomKeyRecipientPolicyVersion() == 1') && iosModule.includes('encryption.bindRoomKeyRecipients(roomId: roomId, peerId: peerId)'), 'iOS recipient binding is missing'],
  [androidBuild.includes('implementation files(recipientArtifact)') && androidBuild.includes("MessageDigest.getInstance('SHA-256')"), 'Android custom SDK integrity gate missing'],
  [androidModule.includes('AsyncFunction("startSession")'), 'Android session lifecycle bridge is missing'],
  [androidModule.includes('AsyncFunction("stopSession")'), 'Android session stop bridge is missing'],
  [androidModule.includes('AsyncFunction("logoutSession")'), 'Android session logout bridge is missing'],
  [androidModule.includes('AsyncFunction("openRoom")'), 'Android encrypted room bridge is missing'],
  [androidModule.includes('AsyncFunction("paginateRoom")'), 'Android room pagination bridge is missing'],
  [androidModule.includes('AsyncFunction("sendMessage")'), 'Android encrypted send bridge is missing'],
  [androidModule.includes('Events(SESSION_CHANGED_EVENT, ROOM_TIMELINE_EVENT, VERIFICATION_CHANGED_EVENT)'), 'Android room/security events are missing'],
  [androidModule.includes('MessageType.Other(VOLNA_MESSAGE_TYPE, body)'), 'Android strict VOLNA Matrix message type is missing'],
  [androidModule.includes('AsyncFunction("setupRecovery")'), 'Android recovery setup bridge is missing'],
  [androidModule.includes('AsyncFunction("recoverSecurity")'), 'Android recovery import bridge is missing'],
  [androidModule.includes('.roomKeyRecipientStrategy(CollectStrategy.IDENTITY_BASED_STRATEGY)'), 'Android signed-device key isolation is missing'],
  [androidModule.includes('AsyncFunction("getSecurityState")'), 'Android Matrix identity inspection is missing'],
  [androidModule.includes('AsyncFunction("startSasVerification")'), 'Android Matrix SAS verification is missing'],
  [androidModule.includes('.sqliteStore(store)'), 'Android encrypted Matrix store is not configured'],
  [androidModule.includes('.disableAutomaticTokenRefresh()'), 'Android token refresh bypasses VOLNA session validation'],
  [iosModule.includes('AsyncFunction("startSession")'), 'iOS session lifecycle bridge is missing'],
  [iosModule.includes('AsyncFunction("stopSession")'), 'iOS session stop bridge is missing'],
  [iosModule.includes('AsyncFunction("logoutSession")'), 'iOS session logout bridge is missing'],
  [iosModule.includes('AsyncFunction("openRoom")'), 'iOS encrypted room bridge is missing'],
  [iosModule.includes('AsyncFunction("paginateRoom")'), 'iOS room pagination bridge is missing'],
  [iosModule.includes('AsyncFunction("sendMessage")'), 'iOS encrypted send bridge is missing'],
  [iosModule.includes('Events(sessionChangedEvent, roomTimelineEvent, verificationChangedEvent)'), 'iOS room/security events are missing'],
  [iosModule.includes('.other(msgtype: volnaMessageType, body: body)'), 'iOS strict VOLNA Matrix message type is missing'],
  [iosModule.includes('AsyncFunction("setupRecovery")'), 'iOS recovery setup bridge is missing'],
  [iosModule.includes('AsyncFunction("recoverSecurity")'), 'iOS recovery import bridge is missing'],
  [iosModule.includes('.roomKeyRecipientStrategy(strategy: .identityBasedStrategy)'), 'iOS signed-device key isolation is missing'],
  [iosModule.includes('AsyncFunction("getSecurityState")'), 'iOS Matrix identity inspection is missing'],
  [iosModule.includes('AsyncFunction("startSasVerification")'), 'iOS Matrix SAS verification is missing'],
  [iosModule.includes('.sqliteStore(config: store)'), 'iOS encrypted Matrix store is not configured'],
  [iosModule.includes('.disableAutomaticTokenRefresh()'), 'iOS token refresh bypasses VOLNA session validation'],
  [typescript.includes('storeKeyBase64Url: string'), 'TypeScript session key contract is missing'],
  [typescript.includes("'session-lifecycle'"), 'TypeScript runtime feature attestation is missing'],
  [typescript.includes("'room-timeline-v1'"), 'TypeScript room runtime feature attestation is missing'],
  [typescript.includes("'history-pagination-v1'") && androidModule.includes('"history-pagination-v1"') && iosModule.includes('"history-pagination-v1"'), 'Native end-of-history feature attestation is missing'],
  [typescript.includes('hasMoreHistory: boolean') && typescript.includes('timelineId: string') && typescript.includes('revision: number'), 'Native pagination snapshot contract is missing'],
  [androidModule.includes('listenerGeneration') && iosModule.includes('listenerGeneration') && androidModule.includes('refreshTimelineListener') && iosModule.includes('refreshTimelineListener'), 'Native stale-listener fence is missing'],
  [!androidModule.includes('MAX_TIMELINE_EVENTS') && !iosModule.includes('maxTimelineEvents'), 'Do not truncate the SDK-indexed diff vector'],
  [typescript.includes("'recovery-v1'"), 'TypeScript recovery runtime feature attestation is missing'],
  [typescript.includes("'identity-security-v1'"), 'TypeScript identity runtime feature attestation is missing'],
  [typescript.includes("'sas-verification-v1'"), 'TypeScript SAS runtime feature attestation is missing'],
  [typescript.includes('addRoomTimelineListener'), 'TypeScript room timeline bridge is missing'],
  [podspec.includes("../vendor/MatrixSDKFFI.xcframework"), 'iOS XCFramework is not linked'],
  [podspec.includes("../vendor/MatrixRustSDK/**/*.swift"), 'iOS generated Swift UniFFI bindings are not compiled'],
  [prepare.includes("prepareSdkSource('ios')"), 'iOS must build the pinned custom source'],
  [prepare.includes("process.platform !== 'darwin'") && prepare.includes("'--locked'"), 'iOS build platform/lock guard missing'],
  [prepare.includes('roomKeyRecipientPolicyVersion') && prepare.includes('bindRoomKeyRecipients'), 'iOS custom recipient binding check missing'],
  [prepare.includes("'matrix_sdk_ffi.swift'"), 'iOS high-level Client/Room/Timeline bindings are not required'],
];

const failure = checks.find(([passed]) => !passed);
if (failure) throw new Error(failure[1]);

console.log('Matrix custom source pins and native bridge contracts verified; this is not an iOS compilation result');
