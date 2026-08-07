export type SecureRandomBytes = (length: number) => Uint8Array;

export type WrappingKeyProvider = {
  getKey(keyId: string): Uint8Array | string | Promise<Uint8Array | string>;
};

export type DeviceIdentityInput = {
  accountId: string;
  deviceId: string;
  platform: 'ios' | 'android' | 'web';
  displayName: string;
  capabilities?: string[];
  recoverySecret?: string;
};

export type DeviceDirectoryRecord = {
  accountId: string;
  id?: string;
  deviceId?: string;
  platform: 'ios' | 'android' | 'web';
  displayName: string;
  capabilities: string[];
  credential: string;
  signaturePublicKey: string;
  accountIdentityPublicKey?: string;
  accountIdentitySignature: string;
  identity?: { publicKey: string };
};

export type KeyPackageClaim = {
  claimId: string;
  recipientAccountId: string;
  recipientDeviceId: string;
  platform: 'ios' | 'android' | 'web';
  displayName: string;
  capabilities: string[];
  credential: string;
  signaturePublicKey: string;
  accountIdentityPublicKey: string;
  accountIdentitySignature: string;
  keyPackage: string;
};

export declare class MlsRuntimeError extends Error {
  readonly code: string;
}

export declare function bytesToBase64Url(bytes: Uint8Array): string;
export declare function base64UrlToBytes(value: string, maximumBytes?: number): Uint8Array;
export declare function encodeDeviceCredential(input: {
  accountId: string;
  deviceId: string;
  signaturePublicKey: Uint8Array;
  accountIdentityKeyHash: Uint8Array;
}): Uint8Array;
export declare function decodeDeviceCredential(bytes: Uint8Array): {
  accountId: string;
  deviceId: string;
  signaturePublicKey: Uint8Array;
  accountIdentityKeyHash: Uint8Array;
};
export declare function accountIdentityFingerprint(publicKey: Uint8Array | string): string;
export declare function formatSafetyNumber(publicKey: Uint8Array | string): string;
export declare function mlsRosterHash(members: unknown[]): string;
export declare function verifyDirectoryDevice(input: DeviceDirectoryRecord): {
  accountId: string;
  deviceId: string;
  identityFingerprint: string;
  safetyNumber: string;
};
export declare function verifyKeyDirectoryChain(entries: unknown[], expectedHead?: string): string | null;
export declare function keyDirectoryLabel(accountId: string): string;
export declare function canonicalKeyDirectoryWitnessStatement(input: {
  version: 1;
  witnessId: string;
  checkpoint: {
    version: 1;
    directoryLabel: string;
    identityFingerprint: string;
    entryCount: number;
    headHash: string | null;
  };
  observedAt: string;
}): Uint8Array;
export declare function verifyKeyDirectoryWitnessQuorum(input: {
  accountId: string;
  identityFingerprint: string;
  entryCount: number;
  headHash: string | null;
  statements: unknown[];
  policy: {
    threshold: number;
    maxStatementAgeMs: number;
    witnesses: Array<{ id: string; publicKey: string }>;
  };
  now?: number;
}): {
  checkpoint: {
    version: 1;
    directoryLabel: string;
    identityFingerprint: string;
    entryCount: number;
    headHash: string | null;
  };
  threshold: number;
  witnessIds: string[];
  oldestObservedAt: string;
};
export declare function verifyKeyDirectorySnapshot(input: {
  accountId: string;
  identity: unknown;
  devices: unknown[];
  entries: unknown[];
  headHash: string | null;
}): {
  accountId: string;
  identityFingerprint: string;
  safetyNumber: string;
  headHash: string | null;
  entryHashes: string[];
  devices: Array<Record<string, unknown>>;
};

export declare class VolnaMlsRuntime {
  constructor(options: { randomBytes: SecureRandomBytes; wrappingKeyProvider?: WrappingKeyProvider });
  readonly protocolVersion: 1;
  readonly ciphersuiteName: 'MLS_128_DHKEMX25519_CHACHA20POLY1305_SHA256_Ed25519';
  createDeviceIdentity(input: DeviceIdentityInput): Promise<Record<string, unknown> & {
    recoverySecret?: string;
    accountIdentityPublicKey: string;
    accountIdentitySignature: string;
    credential: string;
    signaturePublicKey: string;
  }>;
  createPendingTransferDeviceIdentity(input: Omit<DeviceIdentityInput, 'recoverySecret'> & {
    accountIdentityPublicKey: string;
  }): Promise<Record<string, unknown>>;
  getPendingTransferDeviceDraft(): Record<string, unknown>;
  authorizeTransferredDevice(draft: unknown): {
    v: 1;
    targetDeviceId: string;
    sourceDeviceId: string;
    recoverySecret: string;
    accountIdentitySignature: string;
  };
  completeTransferredDeviceIdentity(input: {
    recoverySecret: string;
    accountIdentitySignature: string;
  }): Record<string, unknown>;
  signDeviceRegistrationChallenge(input: { challengeId: string; challenge: string }): Record<string, unknown>;
  pinDirectoryVerification(input: {
    accountId: string;
    identityFingerprint: string;
    safetyNumber: string;
    headHash: string | null;
    entryHashes: string[];
    witnessQuorum: {
      checkpoint: {
        version: 1;
        directoryLabel: string;
        identityFingerprint: string;
        entryCount: number;
        headHash: string | null;
      };
      threshold: number;
      witnessIds: string[];
      oldestObservedAt: string;
    };
  }): {
    accountId: string;
    identityFingerprint: string;
    safetyNumber: string;
    headHash: string | null;
    entryHashes: string[];
    witnessQuorum: Record<string, unknown>;
    firstUse: boolean;
    advanced: boolean;
  };
  createKeyPackages(count: number): Promise<string[]>;
  createGroup(input: { threadId: string; claims: KeyPackageClaim[] }): Promise<{
    protocolVersion: 1;
    groupId: string;
    epoch: '1';
    claimIds: string[];
    welcomes: Array<{ recipientDeviceId: string; payload: string }>;
  }>;
  replaceInitialGroup(input: { threadId: string; previousGroupId: string; claims: KeyPackageClaim[] }): ReturnType<VolnaMlsRuntime['createGroup']>;
  joinGroup(input: {
    threadId: string;
    groupId: string;
    epoch?: string;
    welcome: string;
    members: DeviceDirectoryRecord[];
  }): Promise<void>;
  replaceInitialGroupFromWelcome(input: {
    threadId: string;
    previousGroupId: string;
    groupId: string;
    epoch?: string;
    welcome: string;
    members: DeviceDirectoryRecord[];
  }): Promise<void>;
  abandonInitialGroup(threadId: string, expectedGroupId: string): boolean;
  prepareRekey(input: {
    threadId: string;
    operationId: string;
    baseEpoch: string;
    targetEpoch: string;
    rosterHash: string;
    targetMembers: DeviceDirectoryRecord[];
    removeDeviceIds: string[];
    claims: KeyPackageClaim[];
    aad: string | Record<string, unknown>;
  }): Promise<{
    protocolVersion: 1;
    operationId: string;
    baseEpoch: string;
    epoch: string;
    rosterHash: string;
    claimIds: string[];
    ciphertext: string;
    welcomes: Array<{ recipientDeviceId: string; payload: string }>;
  }>;
  commitPreparedRekey(operationId: string): { groupId: string; epoch: string; members: unknown[] };
  abortPreparedRekey(operationId: string): boolean;
  getPreparedRekey(operationId: string): null | {
    operationId: string;
    threadId: string;
    baseEpoch: string;
    targetEpoch: string;
    rosterHash: string;
  };
  encrypt(input: { threadId: string; aad: string | Record<string, unknown>; plaintext?: string; event?: unknown }): Promise<{
    epoch: string;
    ciphertext: string;
  }>;
  process(input: {
    threadId: string;
    aad: string | Record<string, unknown>;
    epoch: string;
    ciphertext: string;
    expectedMembers?: unknown[];
  }): Promise<{
    event?: unknown;
    sender?: { accountId: string; deviceId: string };
    rejected?: boolean;
    rejectionReason?: 'invalid_content';
    stateChanged: boolean;
    transition?: { operationId: string; rosterHash: string; epoch: string };
  }>;
  exportEncryptedState(input: { wrappingKeyId: string }): Promise<string>;
  importEncryptedState(input: { wrappingKeyId: string; state: string }): Promise<void>;
  getGroupState(threadId: string): { groupId: string; epoch: string; members: unknown[] };
  getIdentitySummary(): Record<string, unknown>;
  getIdentityStatus(): { status: 'missing' | 'transfer-pending' | 'ready'; accountId?: string; deviceId?: string };
  setApplicationState(value: unknown): void;
  getApplicationState(): unknown;
  destroy(): void;
}

export declare function createMlsRuntime(options: {
  randomBytes: SecureRandomBytes;
  wrappingKeyProvider?: WrappingKeyProvider;
}): VolnaMlsRuntime;
