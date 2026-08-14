import type { MessagingCapabilities, MessagingClientHandle } from './expo-secure-messaging';
import type { MatrixMessagingManager, MatrixRoomSecurity, MatrixVerificationState } from './matrix-engine';

export type MessagingMode = 'LEGACY_PLAINTEXT' | 'MLS_V1' | 'MATRIX_V1';
export type MessagingPartner = { id: string; username: string; name: string; avatarUrl: string | null; isVerified: boolean };
export type MessagingAttachment =
  | { kind: 'location'; latitude: number; longitude: number; accuracy?: number }
  | { kind: 'entity'; entityType: 'account' | 'publicPage' | 'event'; id: string; snapshot?: Record<string, any> }
  | { kind: 'music'; provider: 'apple' | 'yandex' | 'youtube' | 'volna' | 'soundcloud' | 'bandcamp'; id: string; title: string; artist: string; metadata?: Record<string, any> };
export type MessagingMessage = {
  id: string;
  threadId: string;
  senderAccountId: string;
  text?: string;
  attachment?: MessagingAttachment;
  createdAt: string;
  editedAt?: string;
  deletedAt?: string;
  reactions: Array<{ accountId: string; emoji: string }>;
  securityMode: 'legacy' | 'e2ee';
};
export type MessagingThread = {
  id: string;
  partner: MessagingPartner;
  lastMessageText: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
  lastReadAt: string | null;
  encryptionMode: MessagingMode;
  protocolVersion: number | null;
  mlsEpoch: string | null;
  encryptedSince: string | null;
  legacyHistoryOnly: boolean;
  messages: MessagingMessage[];
};

export declare class MessagingSurfaceError extends Error { readonly code: string }
export declare function normalizeLegacyMessage(value: unknown): MessagingMessage;
export declare function messagePreview(message?: MessagingMessage | null): string;
export declare function messagingSurfaceErrorMessage(error: unknown): string;

export type MessagingSurfaceController = ReturnType<typeof createMessagingSurfaceController>;
export declare function createMessagingSurfaceController(options: {
  apiOrigin: string;
  fetch: typeof globalThis.fetch;
  getSecureMessagingClient(accountId: string): Promise<MessagingClientHandle>;
  loadMessagingCapabilities(): Promise<MessagingCapabilities>;
  matrixMessaging?: MatrixMessagingManager;
  getAccessToken?(): string | undefined | Promise<string | undefined>;
  includeCredentials?: boolean;
}): {
  listThreads(accountId: string, options?: { cursor?: string | null; pageSize?: number }): Promise<{ items: MessagingThread[]; nextCursor: string | null }>;
  openThread(accountId: string, username: string, options?: { allowActivation?: boolean }): Promise<MessagingThread>;
  sendMessage(accountId: string, thread: MessagingThread, draft: { text?: string; attachment?: MessagingAttachment }): Promise<MessagingMessage[]>;
  editMessage(accountId: string, thread: MessagingThread, messageId: string, text: string): Promise<MessagingMessage[]>;
  reactToMessage(accountId: string, thread: MessagingThread, messageId: string, emoji: string, currentMineEmoji?: string | null): Promise<MessagingMessage[]>;
  resolveOwnAccountId(): Promise<string>;
  searchProfiles(query: string, options?: { shareRecipients?: boolean }): Promise<MessagingPartner[]>;
  searchLocalMessages(accountId: string, query: string, options?: { limit?: number }): Promise<Array<{ threadId: string; message: MessagingMessage }>>;
  getMatrixRoomSecurity(accountId: string, thread: MessagingThread): Promise<MatrixRoomSecurity>;
  verifyMatrixDevice(accountId: string, thread: MessagingThread, userId: string, deviceId: string, expectedEd25519: string): Promise<MatrixRoomSecurity>;
  setupMatrixRecovery(accountId: string): Promise<{ recoveryKey: string }>;
  recoverMatrixSecurity(accountId: string, recoveryKey: string): Promise<void>;
  startMatrixDeviceVerification(accountId: string, thread: MessagingThread, userId: string, deviceId: string): Promise<MatrixVerificationState>;
  acceptMatrixVerification(accountId: string, verificationId: string): Promise<MatrixVerificationState>;
  startMatrixSasVerification(accountId: string, verificationId: string): Promise<MatrixVerificationState>;
  generateMatrixQrVerification(accountId: string, verificationId: string): Promise<MatrixVerificationState>;
  scanMatrixQrVerification(accountId: string, verificationId: string, qrCodeBase64: string): Promise<MatrixVerificationState>;
  confirmMatrixVerification(accountId: string, verificationId: string): Promise<MatrixVerificationState>;
  mismatchMatrixVerification(accountId: string, verificationId: string): Promise<MatrixVerificationState>;
  cancelMatrixVerification(accountId: string, verificationId: string): Promise<MatrixVerificationState>;
  searchAttachments(query: string): Promise<{ accounts: Array<Record<string, unknown>>; communities: Array<Record<string, unknown>>; events: Array<Record<string, unknown>> }>;
  loadOwnMusic(): Promise<Array<Record<string, any>>>;
  searchMusic(query: string): Promise<Array<Record<string, any>>>;
  resolveMusic(url: string): Promise<Record<string, any>>;
  subscribeRealtime(options: {
    accountId: string;
    thread?: MessagingThread | null;
    onEncryptedEnvelope?(threadId: string): void;
    onLegacyMessage?(message: MessagingMessage): void;
    onLegacyReaction?(change: { threadId: string; messageId: string; accountId: string; emoji: string | null }): void;
    onThreadUpdated?(): void;
    onActivity?(): void;
  }): Promise<() => void>;
};
