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

export declare function canonicalKeyDirectorySnapshotReceipt(receipt: {
  version: 1;
  issuer: 'volna_directory_v1';
  checkpoint: { version: 1; directoryLabel: string; identityFingerprint: string; entryCount: number; headHash: string | null };
  issuedAt: string;
  expiresAt: string;
}): Uint8Array;

export declare function keyDirectorySnapshotReceiptPublicKey(signingKey: Uint8Array | string): string;

export declare function createKeyDirectorySnapshotReceipt(options: {
  checkpoint: { version: 1; directoryLabel: string; identityFingerprint: string; entryCount: number; headHash: string | null };
  signingKey: Uint8Array | string;
  issuedAt?: number;
  lifetimeMs?: number;
}): Record<string, unknown>;

export declare function verifyKeyDirectorySnapshotReceipt(options: {
  receipt: unknown;
  checkpoint: { version: 1; directoryLabel: string; identityFingerprint: string; entryCount: number; headHash: string | null };
  publicKey: Uint8Array | string;
  now?: number;
}): Record<string, unknown>;

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
