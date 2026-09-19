import type { MessagingCapabilities, MessagingClientHandle } from './expo-secure-messaging';
import type { MatrixMessagingManager, MatrixRoomSecurity, MatrixVerificationState } from './matrix-engine';

export declare function subscribeEncryptedActivity(socket: {
  on(event: 'encrypted_envelope_available', listener: () => void): unknown;
  off(event: 'encrypted_envelope_available', listener: () => void): unknown;
}, onActivity: () => void): () => void;

export type MessagingMode = 'E2EE_PENDING' | 'MLS_V1' | 'MATRIX_V1';
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
  securityMode: 'e2ee';
};
export type MessagingThread = {
  visibility?: { hasDeletions: boolean; clearedBefore: string | null; deletedMessageIds: string[] };
  id: string;
  partner: MessagingPartner;
  lastMessageText: string | null;
  lastMessageAt: string | null;
  lastMessageId?: string | null;
  unreadCount: number;
  lastReadAt: string | null;
  encryptionMode: MessagingMode;
  protocolVersion: number | null;
  mlsEpoch: string | null;
  encryptedSince: string | null;
  messages: MessagingMessage[];
  /** Display-only identity row while endpoint verification/preview is pending. */
  previewPending?: boolean;
  /** Prior endpoint preview retained during a fresh authorization/crypto check. */
  previewAvailable?: boolean;
  /** Endpoint-only availability hint; never a decrypted message or proof of sender. */
  hasUndecryptableEvents?: boolean;
  /** Endpoint-owned backwards pagination; never trusted from API metadata. */
  hasMoreHistory?: boolean;
};
export type MessagingThreadListPage = { items: MessagingThread[]; nextCursor: string | null };

export declare class MessagingSurfaceError extends Error { readonly code: string }
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
  listThreads(accountId: string, options?: { cursor?: string | null; pageSize?: number; signal?: AbortSignal; onInitialPage?(page: MessagingThreadListPage): void }): Promise<MessagingThreadListPage>;
  getThreadListSnapshot(accountId: string): MessagingThreadListPage | null;
  clearThreadListSnapshot(accountId: string): void;
  openThread(accountId: string, username: string, options?: { allowActivation?: boolean; markRead?: boolean; loadEarlier?: boolean }): Promise<MessagingThread>;
  markMessageRead(accountId: string, thread: MessagingThread, messageId: string): Promise<void>;
  loadChatActivity(accountId: string, threadIds: string[], signal?: AbortSignal): Promise<Record<string, import('./chat-activity.mjs').ChatActivity>>;
  deleteContent(accountId: string, thread: MessagingThread, input: { scope: 'self' | 'everyone'; messageId?: string; operationId: string }): Promise<MessagingThread>;
  sendMessage(accountId: string, thread: MessagingThread, draft: { text?: string; attachment?: MessagingAttachment; clientRequestId?: string }): Promise<MessagingMessage[]>;
  editMessage(accountId: string, thread: MessagingThread, messageId: string, text: string): Promise<MessagingMessage[]>;
  reactToMessage(accountId: string, thread: MessagingThread, messageId: string, emoji: string, currentMineEmoji?: string | null): Promise<MessagingMessage[]>;
  resolveOwnAccountId(): Promise<string>;
  searchProfiles(query: string, options?: { shareRecipients?: boolean }): Promise<MessagingPartner[]>;
  searchLocalMessages(accountId: string, query: string, options?: { limit?: number }): Promise<Array<{ threadId: string; message: MessagingMessage }>>;
  getMatrixRoomSecurity(accountId: string, thread: MessagingThread): Promise<MatrixRoomSecurity>;
  verifyMatrixDevice(accountId: string, thread: MessagingThread, userId: string, deviceId: string, expectedEd25519: string): Promise<MatrixRoomSecurity>;
  setupMatrixRecovery(accountId: string): Promise<{ recoveryKey: string }>;
  resetMatrixRecovery(accountId: string): Promise<{ recoveryKey: string }>;
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
  resolveMusicArtwork(attachment: Extract<MessagingAttachment, { kind: 'music' }>): string | null;
  resolveMusicPlayback(attachment: Extract<MessagingAttachment, { kind: 'music' }>): { previewUrl: string | null; externalUrl: string | null };
  checkMusicAvailabilityForPlayback(attachment: Extract<MessagingAttachment, { kind: 'music' }>): Promise<import('./music-availability').MusicAvailability | null>;
  checkNotificationVisibility(threadId: string, messageIds: string[]): Promise<{ hasDeletions: boolean; clearedBefore: string | null; deletedMessageIds: string[] }>;
  subscribeRealtime(options: {
    onChatStateUpdated?(): void;
    accountId: string;
    thread?: MessagingThread | null;
    onEncryptedEnvelope?(threadId: string): void;
    onThreadUpdated?(): void;
    onReconnect?(): void;
    onActivity?(): void;
  }): Promise<() => void>;
};
