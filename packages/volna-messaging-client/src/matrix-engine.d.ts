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
  partnerIdentityVerified: boolean;
  partnerIdentityChanged: boolean;
  ownDevices: MatrixDeviceSecurity[];
  partnerDevices: MatrixDeviceSecurity[];
  pendingVerifications: MatrixVerificationState[];
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
};

export type MatrixMessagingManager = {
  capabilities(): Promise<MatrixMessagingCapabilities>;
  decorateThread(accountId: string, thread: MessagingThread): Promise<MessagingThread>;
  decorateThreads(accountId: string, threads: MessagingThread[]): Promise<MessagingThread[]>;
  openThread(accountId: string, thread: MessagingThread): Promise<MessagingThread>;
  sendMessage(accountId: string, thread: MessagingThread, draft: { text?: string; attachment?: MessagingAttachment }): Promise<MessagingMessage[]>;
  editMessage(accountId: string, thread: MessagingThread, messageId: string, text: string): Promise<MessagingMessage[]>;
  reactToMessage(accountId: string, thread: MessagingThread, messageId: string, emoji: string | null): Promise<MessagingMessage[]>;
  searchLocalMessages(accountId: string, query: string, options?: { limit?: number }): Promise<Array<{ threadId: string; message: MessagingMessage }>>;
  getRoomSecurity(accountId: string, thread: MessagingThread): Promise<MatrixRoomSecurity>;
  verifyDevice(accountId: string, thread: MessagingThread, userId: string, deviceId: string, expectedEd25519: string): Promise<MatrixRoomSecurity>;
  setupRecovery(accountId: string): Promise<{ recoveryKey: string }>;
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
}): MatrixMessagingManager;
