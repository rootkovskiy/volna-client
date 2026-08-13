import type { VolnaMlsRuntime } from './mls-runtime.mjs';
import type { OpaqueChatTransport } from './opaque-transport.mjs';

export declare class SecureMessagingClientError extends Error {
  readonly code: string;
}

export declare class SecureMessagingClient {
  constructor(options: {
    accountId: string;
    deviceId: string;
    platform: 'ios' | 'android' | 'web';
    displayName: string;
    runtime: VolnaMlsRuntime;
    transport: OpaqueChatTransport;
    storage: Record<string, any>;
  });
  restore(): Promise<Record<string, unknown>>;
  setupDevice(input?: { recoverySecret?: string }): Promise<Record<string, unknown>>;
  getPendingRecoverySecretForDisplay(): string | null;
  acknowledgeRecoverySecretSaved(): Promise<{ status: 'cleared' | 'already-cleared' }>;
  prepareIncomingDeviceTransfer(): Promise<{ status: 'transfer-pending'; draft: Record<string, unknown> }>;
  startIncomingDeviceTransfer(): Promise<Record<string, unknown>>;
  pollIncomingDeviceTransfer(): Promise<Record<string, unknown>>;
  continueIncomingDeviceTransfer(): Promise<Record<string, unknown>>;
  startOutgoingDeviceTransfer(qrPayload: string, options?: { retireSourceDevice?: boolean }): Promise<Record<string, unknown>>;
  approveOutgoingDeviceTransfer(transferId: string): Promise<Record<string, unknown>>;
  continueOutgoingDeviceTransfer(transferId: string): Promise<Record<string, unknown>>;
  cancelIncomingDeviceTransfer(): Promise<Record<string, unknown>>;
  cancelOutgoingDeviceTransfer(transferId: string): Promise<Record<string, unknown>>;
  createOutgoingDeviceTransfer(targetDeviceDraft: unknown, manifest: unknown): string;
  exportHistoryTransferChunks(plan?: unknown): string[];
  completeIncomingDeviceTransfer(approval: string | Record<string, unknown>, historyChunks?: string[]): Promise<Record<string, unknown>>;
  importHistoryTransferChunk(chunk: string): void;
  verifyOwnDirectory(): Promise<Record<string, unknown> | undefined>;
  getDeviceSecurityState(): Promise<Record<string, unknown>>;
  getLocalSecurityStatus(): Record<string, unknown>;
  getThreadSecurityStatus(threadId: string): Record<string, unknown>;
  getPendingDeviceTransfers(): Record<string, unknown>;
  revokeLinkedDevice(deviceId: string): Promise<Record<string, unknown>>;
  replenishKeyPackages(): Promise<Record<string, unknown>>;
  reconcileAllRequiredRekeys(): Promise<string[]>;
  reconcileThreadDevices(threadId: string): Promise<Record<string, unknown>>;
  retryPendingRekeys(): Promise<void>;
  retryPendingActivations(): Promise<void>;
  activateThread(threadId: string): Promise<Record<string, unknown>>;
  recoverExpiredActivation(threadId: string, state?: Record<string, unknown>): Promise<Record<string, unknown>>;
  joinPendingWelcomes(): Promise<string[]>;
  syncThread(threadId: string): Promise<Array<Record<string, unknown>>>;
  sendEvent(threadId: string, event: unknown): Promise<Record<string, unknown>>;
  createMessageEvent(input: { text?: string; attachment?: unknown }): unknown;
  createMutationEvent(kind: 'message.edit' | 'message.reaction' | 'message.delete', targetLogicalMessageId: string, value?: unknown): unknown;
  getMessages(threadId: string): Array<Record<string, unknown>>;
  searchMessages(query: string, options?: { limit?: number }): Array<{ threadId: string; message: Record<string, unknown> }>;
  retryPendingOutbox(): Promise<void>;
  subscribe(listener: (change: Record<string, unknown>) => void): () => void;
  revokeAndClear(): Promise<void>;
  destroyMemory(): void;
}

export declare function createSecureMessagingClient(options: ConstructorParameters<typeof SecureMessagingClient>[0]): SecureMessagingClient;
