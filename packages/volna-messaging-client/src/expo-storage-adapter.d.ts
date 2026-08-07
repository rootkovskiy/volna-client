export declare class ExpoMessagingStorageError extends Error {
  readonly code: string;
}

export declare function createExpoMessagingStorage(accountId: string, deviceId: string): {
  wrappingKeyId: string;
  randomBytes(length: number): Uint8Array;
  wrappingKeyProvider: { getKey(keyId: string): Promise<Uint8Array> };
  messageStore: {
    loadAllThreads(): Promise<Record<string, unknown[]>>;
    saveAllThreads(
      threads: Record<string, unknown[]>,
      changes?: { changedThreadIds: string[]; appendOnlyThreadIds: string[] },
    ): Promise<{ changed: boolean; revision: number }>;
    clear(): Promise<void>;
    destroyMemory(): void;
  };
  loadEncryptedState(): Promise<string | null>;
  saveEncryptedState(state: string): Promise<void>;
  clear(): Promise<void>;
  destroyMemoryKey(): void;
};
