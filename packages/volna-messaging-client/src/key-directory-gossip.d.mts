export type KeyDirectoryCheckpoint = {
  version: 1;
  directoryLabel: string;
  identityFingerprint: string;
  entryCount: number;
  headHash: string | null;
};

export type KeyDirectoryWitnessStatement = {
  version: 1;
  witnessId: string;
  checkpoint: KeyDirectoryCheckpoint;
  observedAt: string;
  signature: string;
};

export type KeyDirectoryGossipCheckpoint = {
  entryCount: number;
  headHash: string | null;
  witnessIds: string[];
  statements: Record<string, KeyDirectoryWitnessStatement>;
};

export type KeyDirectoryGossipEvidence = {
  version: 1;
  revision: number;
  directoryLabel: string;
  identityFingerprint: string;
  checkpoints: KeyDirectoryGossipCheckpoint[];
  witnesses: Record<string, KeyDirectoryWitnessStatement>;
};

export type KeyDirectoryGossipStore = {
  load(directoryLabel: string): Promise<KeyDirectoryGossipEvidence | null>;
  compareAndSwap(
    directoryLabel: string,
    expectedRevision: number | null,
    next: KeyDirectoryGossipEvidence,
  ): Promise<boolean>;
};

export declare class KeyDirectoryGossipError extends Error {
  readonly code: string;
}

export declare function createMemoryKeyDirectoryGossipStore(): KeyDirectoryGossipStore;

export declare function createKeyDirectoryGossipMonitor(options: {
  policy: { witnesses: Array<{ id: string; publicKey: string }> };
  store: KeyDirectoryGossipStore;
}): {
  observe(statement: unknown): Promise<KeyDirectoryGossipEvidence>;
  getEvidence(directoryLabel: string): Promise<KeyDirectoryGossipEvidence | null>;
};
