export type KeyTransparencyLeaf = {
  version: 1;
  directoryLabel: string;
  identityFingerprint: string;
  entryCount: number;
  headHash: string;
  deviceIds: string[];
};

export type KeyTransparencyRootEntry = {
  tag: 'VOLNA-CHAT-KEY-TRANSPARENCY-ROOT';
  version: 1;
  generation: string;
  root: string;
  previousGeneration: string | null;
  previousRoot: string | null;
  updateCount: number;
  createdAt: string;
};

export type KeyTransparencyMapProof = {
  key: string;
  value: KeyTransparencyLeaf;
  siblings: Array<{ depth: number; index: number; hash: string }>;
  root: string;
};

export declare class KeyTransparencyError extends Error { readonly code: string; }
export declare const KEY_TRANSPARENCY_MAP_TAG: string;
export declare const KEY_TRANSPARENCY_ROOT_TAG: string;
export declare function keyTransparencyDefaultHash(depth: number): string;
export declare function normalizeKeyTransparencyLeaf(value: unknown): KeyTransparencyLeaf;
export declare function canonicalKeyTransparencyLeaf(value: unknown): string;
export declare function hashKeyTransparencyLeaf(key: string, value: unknown): string;
export declare function verifyKeyTransparencyMapProof(input: unknown): { key: string; value: KeyTransparencyLeaf; root: string };
export declare function normalizeKeyTransparencyRootEntry(value: unknown): KeyTransparencyRootEntry;
export declare function canonicalKeyTransparencyRootEntry(value: unknown): string;
export declare function rfc6962LeafHash(entryBytes: Uint8Array): string;
export declare function verifyRfc6962Inclusion(input: unknown): true;
export declare function normalizeC2spKeyTransparencyPolicy(policy: unknown): {
  origin: string;
  logVkey: string;
  threshold: number;
  maxAgeSeconds: number;
  witnessVkeys: string[];
};
export declare function verifyC2spCheckpoint(input: unknown): {
  origin: string;
  treeSize: string;
  root: string;
  witnessNames: string[];
  oldestWitnessTimestamp: number;
};
