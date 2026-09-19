import type {
  MessagingMessage,
  MessagingThread,
  MessagingAttachment,
} from './messaging-surface-controller.mjs';

export type MatrixMessagingCapabilities = {
  enabled: boolean;
  protocol: 'MATRIX_V1';
  loginType: string;
  homeserverUrl: string | null;
  serverName: string | null;
  nativeRuntimeRequired: boolean;
  productionReleaseBlocked: boolean;
};

export type MatrixDeviceSecurity = {
  userId: string;
  deviceId: string;
  displayName: string | null;
  ed25519: string;
  curve25519: string;
  current: boolean;
  verified: boolean;
  signedByOwner: boolean;
};

export type MatrixRoomSecurity = {
  cryptoVersion: string;
  crossSigningReady: boolean;
  secretStorageReady: boolean;
  recoveryKeyExists?: boolean;
  partnerIdentityVerified: boolean;
  partnerIdentityChanged: boolean;
  ownDevices: MatrixDeviceSecurity[];
  partnerDevices: MatrixDeviceSecurity[];
  pendingVerifications: MatrixVerificationState[];
  verificationUpdates?: MatrixVerificationState[];
};

export type MatrixVerificationState = {
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
  timelineId: string;
  revision: number;
  hasMoreHistory: boolean;
  events: MatrixNativeRoomEvent[];
  /** Availability only; encrypted content is never projected as a message. */
  hasUndecryptableEvents?: boolean;
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
  pendingVerification: MatrixVerificationState | null;
};

export type MatrixNativeVerificationChangedEvent = {
  accountId: string;
  verification: MatrixVerificationState;
};

export type MatrixNativeSessionBridge = {
  getRuntimeInfo(): {
    available: true;
    implementation: 'matrix-rust-sdk-ffi';
    bindingVersion: string;
    platform: 'android' | 'ios';
    apiVersion: 1;
    features: readonly string[];
  } | null;
  startSession(options: {
    accountId: string;
    homeserverUrl: string;
    userId: string;
    deviceId: string;
    accessToken: string;
    refreshToken: string | null;
    storeKeyBase64Url: string;
  }): Promise<{
    accountId: string;
    homeserverUrl: string;
    userId: string;
    deviceId: string;
    running: true;
  }>;
  stopSession(accountId: string): Promise<void>;
  logoutSession(accountId: string): Promise<void>;
  addSessionChangedListener(listener: (event: MatrixNativeSessionChangedEvent) => void): { remove(): void };
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
  startDeviceVerification(accountId: string, userId: string, deviceId: string): Promise<MatrixVerificationState>;
  acceptVerification(accountId: string, verificationId: string): Promise<MatrixVerificationState>;
  startSasVerification(accountId: string, verificationId: string): Promise<MatrixVerificationState>;
  generateQrVerification?(accountId: string, verificationId: string): Promise<MatrixVerificationState>;
  scanQrVerification?(accountId: string, verificationId: string, qrCodeBase64: string): Promise<MatrixVerificationState>;
  confirmVerification(accountId: string, verificationId: string): Promise<MatrixVerificationState>;
  mismatchVerification(accountId: string, verificationId: string): Promise<MatrixVerificationState>;
  cancelVerification(accountId: string, verificationId: string): Promise<MatrixVerificationState>;
  addRoomTimelineListener(listener: (event: MatrixNativeRoomSnapshot) => void): { remove(): void };
  addVerificationChangedListener(listener: (event: MatrixNativeVerificationChangedEvent) => void): { remove(): void };
};

export type MatrixMessagingManager = {
  capabilities(): Promise<MatrixMessagingCapabilities>;
  warmup(accountId: string, signal: AbortSignal): Promise<void>;
  decorateThread(accountId: string, thread: MessagingThread): Promise<MessagingThread>;
  decorateThreads(accountId: string, threads: MessagingThread[]): Promise<MessagingThread[]>;
  openThread(accountId: string, thread: MessagingThread, options?: { loadEarlier?: boolean }): Promise<MessagingThread>;
  sendMessage(accountId: string, thread: MessagingThread, draft: { text?: string; attachment?: MessagingAttachment; clientRequestId?: string }): Promise<MessagingMessage[]>;
  editMessage(accountId: string, thread: MessagingThread, messageId: string, text: string): Promise<MessagingMessage[]>;
  reactToMessage(accountId: string, thread: MessagingThread, messageId: string, emoji: string | null): Promise<MessagingMessage[]>;
  searchLocalMessages(accountId: string, query: string, options?: { limit?: number }): Promise<Array<{ threadId: string; message: MessagingMessage }>>;
  getRoomSecurity(accountId: string, thread: MessagingThread): Promise<MatrixRoomSecurity>;
  getAccountSecurity(accountId: string): Promise<MatrixRoomSecurity>;
  startOwnDeviceVerification(accountId: string, userId: string, deviceId: string): Promise<MatrixVerificationState>;
  verifyDevice(accountId: string, thread: MessagingThread, userId: string, deviceId: string, expectedEd25519: string): Promise<MatrixRoomSecurity>;
  setupRecovery(accountId: string): Promise<{ recoveryKey: string }>;
  resetRecovery(accountId: string): Promise<{ recoveryKey: string }>;
  recoverSecurity(accountId: string, recoveryKey: string): Promise<void>;
  startDeviceVerification(accountId: string, thread: MessagingThread, userId: string, deviceId: string): Promise<MatrixVerificationState>;
  acceptVerification(accountId: string, verificationId: string): Promise<MatrixVerificationState>;
  startSasVerification(accountId: string, verificationId: string): Promise<MatrixVerificationState>;
  generateQrVerification(accountId: string, verificationId: string): Promise<MatrixVerificationState>;
  scanQrVerification(accountId: string, verificationId: string, qrCodeBase64: string): Promise<MatrixVerificationState>;
  confirmVerification(accountId: string, verificationId: string): Promise<MatrixVerificationState>;
  mismatchVerification(accountId: string, verificationId: string): Promise<MatrixVerificationState>;
  cancelVerification(accountId: string, verificationId: string): Promise<MatrixVerificationState>;
  subscribe(accountId: string, onThreadChanged: (threadId: string) => void): Promise<() => void>;
  release(accountId: string): Promise<void>;
  logout(accountId: string): Promise<void>;
};

export declare function createMatrixMessagingManager(options: {
  apiOrigin: string;
  fetch: typeof globalThis.fetch;
  getAccessToken?(): string | undefined | Promise<string | undefined>;
  includeCredentials?: boolean;
  allowInsecureDevelopmentOrigin?: boolean;
  nativeBridge?: MatrixNativeSessionBridge;
}): MatrixMessagingManager;
