import { requireOptionalNativeModule } from 'expo';

export type MatrixNativeRuntimeInfo = {
  available: true;
  implementation: 'matrix-rust-sdk-ffi';
  bindingVersion: string;
  platform: 'android' | 'ios';
  apiVersion: 1;
  features: readonly MatrixNativeFeature[];
};

export type MatrixNativeFeature = 'session-lifecycle' | 'room-timeline-v1' | 'history-pagination-v1' | 'authenticated-timeline-v1' | 'strict-room-key-recipients-v1' | 'authenticated-backup-v1' | 'recovery-v1' | 'recovery-key-rotation-v1' | 'identity-security-v1' | 'sas-verification-v1' | 'qr-verification-v1';

export type MatrixNativeSessionOptions = {
  accountId: string;
  homeserverUrl: string;
  userId: string;
  deviceId: string;
  accessToken: string;
  refreshToken: string | null;
  storeKeyBase64Url: string;
};

export type MatrixNativeSessionInfo = {
  accountId: string;
  homeserverUrl: string;
  userId: string;
  deviceId: string;
  running: true;
};

export type MatrixNativeSessionChangedEvent = {
  accountId: string;
  homeserverUrl: string;
  userId: string;
  deviceId: string;
  accessToken: string;
  refreshToken: string | null;
};

export type MatrixNativeRoomEvent = {
  authenticated: true;
  eventId: string;
  senderUserId: string;
  timestamp: number;
  contentJson: string;
};

export type MatrixNativeRoomSnapshot = {
  accountId: string;
  roomId: string;
  /** Unique per opened native timeline, with monotonic snapshot revisions. */
  timelineId: string;
  revision: number;
  /** Authoritative SDK start-of-history result, independent of visible rows. */
  hasMoreHistory: boolean;
  hasUndecryptableEvents?: boolean;
  events: MatrixNativeRoomEvent[];
};

export type MatrixNativeVerificationState = {
  id: string;
  phase: 'requested' | 'ready' | 'started' | 'cancelled' | 'done';
  initiatedByMe: boolean;
  otherUserId: string;
  otherDeviceId: string | null;
  sasDecimal: [number, number, number] | null;
  sasEmoji: Array<[string, string]>;
  qrCodeBase64: string | null;
  qrSupported: boolean;
  qrNeedsConfirmation?: boolean;
};

export type MatrixNativeSecurityState = {
  cryptoVersion: string;
  crossSigningReady: boolean;
  secretStorageReady: boolean;
  currentDevice: {
    userId: string;
    deviceId: string;
    ed25519: string | null;
    curve25519: string | null;
  };
  identities: Array<{
    userId: string;
    masterKey: string | null;
    verified: boolean;
    changed: boolean;
  }>;
  pendingVerification: MatrixNativeVerificationState | null;
};

export type MatrixNativeVerificationChangedEvent = {
  accountId: string;
  verification: MatrixNativeVerificationState;
};

type NativeSubscription = { remove(): void };

type VolnaMatrixNativeModule = {
  getRuntimeInfo(): MatrixNativeRuntimeInfo;
  startSession(
    accountId: string,
    homeserverUrl: string,
    userId: string,
    deviceId: string,
    accessToken: string,
    refreshToken: string | null,
    storeKeyBase64Url: string,
  ): Promise<MatrixNativeSessionInfo>;
  stopSession(accountId: string): Promise<void>;
  logoutSession(accountId: string): Promise<void>;
  listRoomIds(accountId: string): Promise<string[]>;
  bindRoomKeyRecipients(accountId: string, roomId: string, peerId: string): Promise<void>;
  openRoom(accountId: string, roomId: string): Promise<MatrixNativeRoomSnapshot>;
  paginateRoom(accountId: string, roomId: string, limit: number): Promise<MatrixNativeRoomSnapshot>;
  sendMessage(accountId: string, roomId: string, contentJson: string): Promise<void>;
  closeRoom(accountId: string, roomId: string): Promise<void>;
  setupRecovery(accountId: string): Promise<string>;
  resetRecovery?(accountId: string): Promise<string>;
  recoverSecurity(accountId: string, recoveryKey: string): Promise<void>;
  getSecurityState(accountId: string, userIds: string[]): Promise<MatrixNativeSecurityState>;
  startDeviceVerification(accountId: string, userId: string, deviceId: string): Promise<MatrixNativeVerificationState>;
  acceptVerification(accountId: string, verificationId: string): Promise<MatrixNativeVerificationState>;
  startSasVerification(accountId: string, verificationId: string): Promise<MatrixNativeVerificationState>;
  generateQrVerification?(accountId: string, verificationId: string): Promise<MatrixNativeVerificationState>;
  scanQrVerification?(accountId: string, verificationId: string, qrCodeBase64: string): Promise<MatrixNativeVerificationState>;
  confirmVerification(accountId: string, verificationId: string): Promise<MatrixNativeVerificationState>;
  mismatchVerification(accountId: string, verificationId: string): Promise<MatrixNativeVerificationState>;
  cancelVerification(accountId: string, verificationId: string): Promise<MatrixNativeVerificationState>;
  addListener(
    eventName: 'onSessionChanged' | 'onRoomTimeline' | 'onVerificationChanged',
    listener: ((event: MatrixNativeSessionChangedEvent) => void) | ((event: MatrixNativeRoomSnapshot) => void) | ((event: MatrixNativeVerificationChangedEvent) => void),
  ): NativeSubscription;
};

const nativeModule = requireOptionalNativeModule<VolnaMatrixNativeModule>('VolnaMatrixNative');
const safeId = /^[A-Za-z0-9_-]{8,80}$/;
const safeRoomId = /^![^\s:]{1,255}:[^\s]{1,255}$/;
const safeMatrixUserId = /^@[a-z0-9._=/\-]+:[a-z0-9.-]+(?::[0-9]+)?$/;

function requireRuntime() {
  if (!nativeModule) throw new Error('Matrix Rust SDK is unavailable in this native build');
  return nativeModule;
}

function validateSessionOptions(options: MatrixNativeSessionOptions) {
  if (!safeId.test(options.accountId)) throw new Error('Invalid Matrix account id');
  if (!safeId.test(options.deviceId)) throw new Error('Invalid Matrix device id');
  if (!/^@[a-z0-9._=/\-]+:[a-z0-9.-]+(?::[0-9]+)?$/.test(options.userId)) throw new Error('Invalid Matrix user id');
  if (!options.accessToken || options.accessToken.length > 4096) throw new Error('Invalid Matrix access token');
  if (options.refreshToken !== null && (!options.refreshToken || options.refreshToken.length > 4096)) {
    throw new Error('Invalid Matrix refresh token');
  }
  if (!/^[A-Za-z0-9_-]{43}$/.test(options.storeKeyBase64Url)) throw new Error('Invalid Matrix store key');
  const url = new URL(options.homeserverUrl);
  if (url.username || url.password
    || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) {
    throw new Error('Matrix homeserver requires HTTPS');
  }
}

const VolnaMatrixNative = Object.freeze({
  getRuntimeInfo: () => nativeModule?.getRuntimeInfo() ?? null,
  startSession: (options: MatrixNativeSessionOptions) => {
    validateSessionOptions(options);
    return requireRuntime().startSession(
      options.accountId,
      options.homeserverUrl,
      options.userId,
      options.deviceId,
      options.accessToken,
      options.refreshToken,
      options.storeKeyBase64Url,
    );
  },
  stopSession: (accountId: string) => {
    if (!safeId.test(accountId)) throw new Error('Invalid Matrix account id');
    return requireRuntime().stopSession(accountId);
  },
  logoutSession: (accountId: string) => {
    if (!safeId.test(accountId)) throw new Error('Invalid Matrix account id');
    return requireRuntime().logoutSession(accountId);
  },
  addSessionChangedListener: (listener: (event: MatrixNativeSessionChangedEvent) => void) => (
    requireRuntime().addListener('onSessionChanged', listener as (event: MatrixNativeSessionChangedEvent) => void)
  ),
  listRoomIds: (accountId: string) => {
    if (!safeId.test(accountId)) throw new Error('Invalid Matrix account id');
    return requireRuntime().listRoomIds(accountId);
  },
  bindRoomKeyRecipients: (accountId: string, roomId: string, peerId: string) => {
    if (!safeId.test(accountId)) throw new Error('Invalid Matrix account id');
    if (!safeRoomId.test(roomId)) throw new Error('Invalid Matrix room id');
    if (!safeMatrixUserId.test(peerId)) throw new Error('Invalid Matrix peer id');
    return requireRuntime().bindRoomKeyRecipients(accountId, roomId, peerId);
  },
  openRoom: (accountId: string, roomId: string) => {
    if (!safeId.test(accountId)) throw new Error('Invalid Matrix account id');
    if (!safeRoomId.test(roomId)) throw new Error('Invalid Matrix room id');
    return requireRuntime().openRoom(accountId, roomId);
  },
  paginateRoom: (accountId: string, roomId: string, limit: number) => {
    if (!safeId.test(accountId)) throw new Error('Invalid Matrix account id');
    if (!safeRoomId.test(roomId)) throw new Error('Invalid Matrix room id');
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error('Invalid Matrix pagination limit');
    return requireRuntime().paginateRoom(accountId, roomId, limit);
  },
  sendMessage: (accountId: string, roomId: string, contentJson: string) => {
    if (!safeId.test(accountId)) throw new Error('Invalid Matrix account id');
    if (!safeRoomId.test(roomId)) throw new Error('Invalid Matrix room id');
    if (typeof contentJson !== 'string' || !contentJson || new TextEncoder().encode(contentJson).length > 64 * 1024) {
      throw new Error('Invalid Matrix message content');
    }
    return requireRuntime().sendMessage(accountId, roomId, contentJson);
  },
  closeRoom: (accountId: string, roomId: string) => {
    if (!safeId.test(accountId)) throw new Error('Invalid Matrix account id');
    if (!safeRoomId.test(roomId)) throw new Error('Invalid Matrix room id');
    return requireRuntime().closeRoom(accountId, roomId);
  },
  setupRecovery: (accountId: string) => {
    if (!safeId.test(accountId)) throw new Error('Invalid Matrix account id');
    return requireRuntime().setupRecovery(accountId);
  },
  resetRecovery: (accountId: string) => {
    if (!safeId.test(accountId)) throw new Error('Invalid Matrix account id');
    const runtime = requireRuntime();
    if (!runtime.resetRecovery) throw new Error('Update VOLNA to replace the recovery key');
    return runtime.resetRecovery(accountId);
  },
  recoverSecurity: (accountId: string, recoveryKey: string) => {
    if (!safeId.test(accountId)) throw new Error('Invalid Matrix account id');
    if (typeof recoveryKey !== 'string' || recoveryKey !== recoveryKey.trim() || recoveryKey.length < 32 || recoveryKey.length > 512) {
      throw new Error('Invalid Matrix recovery key');
    }
    return requireRuntime().recoverSecurity(accountId, recoveryKey);
  },
  getSecurityState: (accountId: string, userIds: string[]) => {
    if (!safeId.test(accountId)) throw new Error('Invalid Matrix account id');
    if (!Array.isArray(userIds) || userIds.length < 1 || userIds.length > 4 || userIds.some((userId) => !safeMatrixUserId.test(userId))) {
      throw new Error('Invalid Matrix identity query');
    }
    return requireRuntime().getSecurityState(accountId, userIds);
  },
  startDeviceVerification: (accountId: string, userId: string, deviceId: string) => {
    if (!safeId.test(accountId)) throw new Error('Invalid Matrix account id');
    if (!safeMatrixUserId.test(userId)) throw new Error('Invalid Matrix user id');
    if (!safeId.test(deviceId)) throw new Error('Invalid Matrix device id');
    return requireRuntime().startDeviceVerification(accountId, userId, deviceId);
  },
  acceptVerification: (accountId: string, verificationId: string) => {
    if (!safeId.test(accountId) || !safeId.test(verificationId)) throw new Error('Invalid Matrix verification id');
    return requireRuntime().acceptVerification(accountId, verificationId);
  },
  startSasVerification: (accountId: string, verificationId: string) => {
    if (!safeId.test(accountId) || !safeId.test(verificationId)) throw new Error('Invalid Matrix verification id');
    return requireRuntime().startSasVerification(accountId, verificationId);
  },
  generateQrVerification: (accountId: string, verificationId: string) => {
    if (!safeId.test(accountId) || !safeId.test(verificationId)) throw new Error('Invalid Matrix verification id');
    const runtime = requireRuntime();
    if (!runtime.getRuntimeInfo().features.includes('qr-verification-v1') || !runtime.generateQrVerification) throw new Error('Matrix verification QR is unavailable');
    return runtime.generateQrVerification(accountId, verificationId);
  },
  scanQrVerification: (accountId: string, verificationId: string, qrCodeBase64: string) => {
    if (!safeId.test(accountId) || !safeId.test(verificationId)) throw new Error('Invalid Matrix verification id');
    if (!/^[A-Za-z0-9_-]{1,2731}$/.test(qrCodeBase64)) throw new Error('Invalid Matrix verification QR');
    const runtime = requireRuntime();
    if (!runtime.getRuntimeInfo().features.includes('qr-verification-v1') || !runtime.scanQrVerification) throw new Error('Matrix verification QR is unavailable');
    return runtime.scanQrVerification(accountId, verificationId, qrCodeBase64);
  },
  confirmVerification: (accountId: string, verificationId: string) => {
    if (!safeId.test(accountId) || !safeId.test(verificationId)) throw new Error('Invalid Matrix verification id');
    return requireRuntime().confirmVerification(accountId, verificationId);
  },
  mismatchVerification: (accountId: string, verificationId: string) => {
    if (!safeId.test(accountId) || !safeId.test(verificationId)) throw new Error('Invalid Matrix verification id');
    return requireRuntime().mismatchVerification(accountId, verificationId);
  },
  cancelVerification: (accountId: string, verificationId: string) => {
    if (!safeId.test(accountId) || !safeId.test(verificationId)) throw new Error('Invalid Matrix verification id');
    return requireRuntime().cancelVerification(accountId, verificationId);
  },
  addRoomTimelineListener: (listener: (event: MatrixNativeRoomSnapshot) => void) => (
    requireRuntime().addListener('onRoomTimeline', listener as (event: MatrixNativeRoomSnapshot) => void)
  ),
  addVerificationChangedListener: (listener: (event: MatrixNativeVerificationChangedEvent) => void) => (
    requireRuntime().addListener('onVerificationChanged', listener as (event: MatrixNativeVerificationChangedEvent) => void)
  ),
});

export default VolnaMatrixNative;
