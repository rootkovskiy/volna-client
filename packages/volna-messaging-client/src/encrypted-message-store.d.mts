export type EncryptedMessageDatabase = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  getAllKeys(): Promise<string[]>;
};

export declare class EncryptedMessageStoreError extends Error {
  readonly code: string;
}

export declare function createEncryptedMessageStore(options: {
  scope: string;
  database: EncryptedMessageDatabase;
  randomBytes(length: number): Uint8Array;
  wrappingKeyProvider: { getKey(keyId: string): Uint8Array | string | Promise<Uint8Array | string> };
  withLock?: <T>(name: string, operation: () => Promise<T>) => Promise<T>;
}): {
  loadAllThreads(): Promise<Record<string, unknown[]>>;
  saveAllThreads(
    threads: Record<string, unknown[]>,
    changes?: {
      changedThreadIds: string[];
      appendOnlyThreadIds: string[];
    },
  ): Promise<{ changed: boolean; revision: number }>;
  clear(): Promise<void>;
  destroyMemory(): void;
};
