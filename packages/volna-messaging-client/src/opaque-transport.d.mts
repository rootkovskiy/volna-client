export declare class OpaqueTransportError extends Error {
  readonly code: string;
  readonly status?: number;
}

export type KeyTransparencyWitnessPolicy = {
  threshold: number;
  maxStatementAgeMs: number;
  requestTimeoutMs?: number;
  witnesses: Array<{
    id: string;
    origin: string;
    publicKey: string;
  }>;
};

export declare class OpaqueChatTransport {
  constructor(options: {
    apiOrigin: string;
    fetch: typeof globalThis.fetch;
    witnessFetch?: typeof globalThis.fetch;
    getAccessToken: () => string | undefined | Promise<string | undefined>;
    includeCredentials?: boolean;
    allowInsecureDevelopmentOrigin?: boolean;
    keyTransparencyPolicy?: KeyTransparencyWitnessPolicy;
  });
  capabilities(): Promise<Record<string, unknown>>;
  createDeviceChallenge(): Promise<{ challengeId: string; challenge: string; expiresAt: string | null }>;
  registerDevice(input: unknown): Promise<Record<string, unknown>>;
  listOwnDevices(): Promise<Record<string, unknown>>;
  createDeviceTransfer(input: unknown): Promise<Record<string, unknown>>;
  getDeviceTransfer(transferId: string): Promise<Record<string, unknown>>;
  connectDeviceTransferSource(transferId: string, input: unknown): Promise<Record<string, unknown>>;
  uploadDeviceTransferChunk(transferId: string, input: unknown): Promise<Record<string, unknown>>;
  approveDeviceTransfer(transferId: string, input: unknown): Promise<Record<string, unknown>>;
  listDeviceTransferChunks(transferId: string, afterSequence?: number): Promise<Record<string, unknown>>;
  finalizeDeviceTransfer(transferId: string): Promise<Record<string, unknown>>;
  cancelDeviceTransfer(transferId: string): Promise<Record<string, unknown>>;
  revokeDevice(deviceId: string): Promise<unknown>;
  getDirectory(accountId: string): Promise<Record<string, unknown> & {
    accountId: string;
    entryCount: number;
    headHash: string | null;
    entries: unknown[];
    verification: Record<string, unknown> & {
      witnessQuorum: {
        threshold: number;
        witnessIds: string[];
        oldestObservedAt: string;
      };
    };
  }>;
  uploadKeyPackages(deviceId: string, keyPackages: string[]): Promise<unknown>;
  keyPackageStatus(deviceId: string): Promise<{ deviceId: string; available: number; target: number; maximum: number; oldestExpiresAt: string | null }>;
  claimKeyPackages(threadId: string, requesterDeviceId: string): Promise<Record<string, unknown>>;
  activateThread(threadId: string, input: unknown): Promise<Record<string, unknown>>;
  recoverThreadActivation(threadId: string, input: unknown): Promise<Record<string, unknown>>;
  listRequiredRekeys(deviceId: string): Promise<Array<{ threadId: string; epoch: string }>>;
  prepareThreadRekey(threadId: string, requesterDeviceId: string): Promise<Record<string, unknown>>;
  getThreadRekey(threadId: string, operationId: string): Promise<Record<string, unknown>>;
  commitThreadRekey(threadId: string, operationId: string, input: unknown): Promise<Record<string, unknown>>;
  abortThreadRekey(threadId: string, operationId: string, requesterDeviceId: string): Promise<Record<string, unknown>>;
  getThreadState(threadId: string): Promise<Record<string, unknown>>;
  listPendingWelcomes(deviceId: string): Promise<Array<Record<string, unknown>>>;
  acknowledgeWelcome(welcomeId: string): Promise<unknown>;
  listEnvelopes(threadId: string, deviceId: string, cursor?: string): Promise<Record<string, unknown>>;
  sendEnvelope(threadId: string, input: unknown): Promise<Record<string, unknown>>;
}

export declare function createOpaqueChatTransport(options: ConstructorParameters<typeof OpaqueChatTransport>[0]): OpaqueChatTransport;
