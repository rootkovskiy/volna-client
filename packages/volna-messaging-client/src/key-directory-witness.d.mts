export type KeyDirectoryWitnessStore = {
  load(directoryLabel: string): Promise<Record<string, unknown> | null>;
  compareAndSwap(
    directoryLabel: string,
    expectedRevision: number | null,
    next: Record<string, unknown>,
  ): Promise<boolean>;
};

export declare class KeyDirectoryWitnessError extends Error {
  readonly code: string;
}

export declare function createMemoryKeyDirectoryWitnessStore(): KeyDirectoryWitnessStore;

export declare function createKeyDirectoryWitness(options: {
  witnessId: string;
  signingKey: Uint8Array | string;
  store: KeyDirectoryWitnessStore;
  clock?: () => number;
}): {
  readonly witnessId: string;
  readonly publicKey: string;
  observe(snapshot: unknown): Promise<Record<string, unknown>>;
  getStatement(checkpoint: {
    directoryLabel: string;
    identityFingerprint: string;
    entryCount: number;
    headHash: string | null;
  }): Promise<Record<string, unknown> | null>;
  destroy(): void;
};
