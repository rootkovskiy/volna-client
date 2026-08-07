export declare class DeviceTransferError extends Error {
  readonly code: string;
}

export type TransferDeviceDraft = {
  accountId: string;
  deviceId: string;
  platform: 'ios' | 'android' | 'web';
  displayName: string;
  credential: string;
  signaturePublicKey: string;
  accountIdentityPublicKey: string;
  capabilities: string[];
};

export type DeviceTransferSession = {
  id: string;
  accountId: string;
  protocolVersion: 1;
  targetDeviceId: string;
  targetEphemeralPublicKey: string;
  targetDraftHash: string;
  targetDeviceDraft: TransferDeviceDraft;
};

export type EncryptedTransferPayload = {
  kind: 'approval' | 'history';
  sequence: number;
  previousHash: string | null;
  payload: string;
  payloadHash: string;
  ciphertextBytes: number;
};

export declare class DeviceTransferTarget {
  constructor(options: {
    randomBytes: (length: number) => Uint8Array;
    targetDeviceDraft?: TransferDeviceDraft;
    state?: unknown;
  });
  createSessionInput(): Omit<DeviceTransferSession, 'id' | 'accountId'>;
  bindSession(sessionId: string): { qrPayload: string; state: unknown };
  connect(session: DeviceTransferSession, sourceEphemeralPublicKey: string): { verificationCode: string };
  decrypt(payload: string, expected?: {
    payloadHash?: string;
    kind?: 'approval' | 'history';
    sequence?: number;
    previousHash?: string | null;
  }): {
    kind: 'approval' | 'history';
    sequence: number;
    previousHash: string | null;
    payloadHash: string;
    plaintext: Uint8Array;
  };
  exportState(): unknown;
  destroy(): void;
}

export declare class DeviceTransferSource {
  constructor(options: {
    randomBytes: (length: number) => Uint8Array;
    qrPayload?: string;
    session?: DeviceTransferSession;
    state?: unknown;
  });
  readonly publicState: { sourceEphemeralPublicKey: string; verificationCode: string };
  encryptHistory(sequence: number, plaintext: string | Uint8Array, previousHash?: string | null): EncryptedTransferPayload;
  encryptApproval(plaintext: string | Uint8Array, finalHistoryHash?: string | null): EncryptedTransferPayload;
  exportState(): unknown;
  destroy(): void;
}

export declare function createDeviceTransferTarget(options: ConstructorParameters<typeof DeviceTransferTarget>[0]): DeviceTransferTarget;
export declare function createDeviceTransferSource(options: ConstructorParameters<typeof DeviceTransferSource>[0]): DeviceTransferSource;
export declare function parseDeviceTransferQr(value: string): {
  protocolVersion: 1;
  sessionId: string;
  accountId: string;
  targetDeviceId: string;
  targetEphemeralPublicKey: string;
  targetDraftHash: string;
  transferSecret: string;
};
export declare function transferDraftHash(draft: TransferDeviceDraft): string;
export declare function hashTransferPayload(payload: string): string;
export declare function validateTransferManifest(value: unknown): {
  v: 1;
  chunkCount: number;
  finalChunkHash: string | null;
  totalCiphertextBytes: number;
};
