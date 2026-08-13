export declare const CHAT_PROTOCOL_VERSION: 1;
export declare const CHAT_CIPHERSUITE: 'MLS_128_DHKEMX25519_CHACHA20POLY1305_SHA256_Ed25519';
export declare const MAX_CHAT_TEXT_CHARS: number;
export declare const MAX_CONTENT_EVENT_BYTES: number;
export declare const MAX_ENVELOPE_CIPHERTEXT_BYTES: number;
export declare const MAX_WELCOME_BYTES: number;
export declare const MAX_KEY_PACKAGE_BYTES: number;
export declare const MAX_DEVICE_CREDENTIAL_BYTES: number;
export declare const MAX_DEVICE_SIGNATURE_KEY_BYTES: number;
export declare const MAX_DEVICE_SIGNATURE_BYTES: number;
export declare const MAX_ACTIVE_DEVICES_PER_ACCOUNT: number;
export declare const MAX_TOTAL_DEVICES_PER_ACCOUNT: number;
export declare const MAX_KEY_PACKAGES_PER_DEVICE: number;
export declare const MAX_TRANSFER_CHUNK_BYTES: number;
export declare const MAX_TRANSFER_CHUNKS: number;
export declare const MAX_TRANSFER_TOTAL_BYTES: number;
export declare const MAX_TRANSFER_WIRE_PAYLOAD_BYTES: number;

export type ChatEntityType = 'account' | 'publicPage' | 'event';
export type ChatMusicProvider = 'apple' | 'yandex' | 'youtube' | 'volna' | 'soundcloud' | 'bandcamp';
export type ChatDevicePlatform = 'ios' | 'android' | 'web';
export type ChatEnvelopeKind = 'APPLICATION' | 'COMMIT';

export type ChatContentAttachment =
  | { kind: 'location'; latitude: number; longitude: number; accuracy?: number }
  | { kind: 'entity'; entityType: ChatEntityType; id: string; snapshot?: JsonValue }
  | { kind: 'music'; provider: ChatMusicProvider; id: string; title: string; artist: string; metadata?: JsonValue };

export type ChatContentEvent =
  | { v: 1; kind: 'message.create'; logicalMessageId: string; clientCreatedAt: string; text?: string; attachment?: ChatContentAttachment }
  | { v: 1; kind: 'message.edit'; logicalMessageId: string; clientCreatedAt: string; targetLogicalMessageId: string; text: string }
  | { v: 1; kind: 'message.reaction'; logicalMessageId: string; clientCreatedAt: string; targetLogicalMessageId: string; emoji: string | null }
  | { v: 1; kind: 'message.delete'; logicalMessageId: string; clientCreatedAt: string; targetLogicalMessageId: string };

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export type EnvelopeAad = {
  protocolVersion: 1;
  threadId: string;
  senderAccountId: string;
  senderDeviceId: string;
  clientEnvelopeId: string;
  kind: ChatEnvelopeKind;
  epoch: string;
  operationId?: string;
  rosterHash?: string;
};

export type OpaqueEnvelopeInput = {
  protocolVersion: 1;
  senderDeviceId: string;
  clientEnvelopeId: string;
  kind: ChatEnvelopeKind;
  epoch: string;
  ciphertext: string;
  operationId?: string;
  rosterHash?: string;
};

export type TransferDeviceDraft = {
  accountId: string;
  deviceId: string;
  platform: ChatDevicePlatform;
  displayName: string;
  credential: string;
  signaturePublicKey: string;
  accountIdentityPublicKey: string;
  capabilities: string[];
};

export type DeviceTransferSessionInput = {
  protocolVersion: 1;
  targetDeviceId: string;
  targetEphemeralPublicKey: string;
  targetDraftHash: string;
  targetDeviceDraft: TransferDeviceDraft;
};

export type DeviceTransferSourceInput = {
  protocolVersion: 1;
  sourceDeviceId: string;
  sourceEphemeralPublicKey: string;
};

export type DeviceTransferChunkInput = {
  protocolVersion: 1;
  sourceDeviceId: string;
  sequence: number;
  previousHash: string | null;
  payload: string;
  payloadHash: string;
  ciphertextBytes: number;
};

export type DeviceTransferManifest = {
  v: 1;
  chunkCount: number;
  finalChunkHash: string | null;
  totalCiphertextBytes: number;
};

export type DeviceTransferApprovalInput = DeviceTransferSourceInput & {
  approvalPayload: string;
  approvalPayloadHash: string;
  manifest: DeviceTransferManifest;
  retireSourceDevice: boolean;
};

export type MlsRosterMember = {
  accountId: string;
  deviceId: string;
  signaturePublicKey: string;
  accountIdentityKeyHash: string;
};

export type MlsRekeyCommitInput = {
  protocolVersion: 1;
  senderDeviceId: string;
  clientEnvelopeId: string;
  operationId: string;
  epoch: string;
  rosterHash: string;
  ciphertext: string;
  claimIds: string[];
  welcomes: Array<{ recipientDeviceId: string; payload: string }>;
};

export type DeviceRegistrationInput = {
  challengeId: string;
  deviceId: string;
  platform: ChatDevicePlatform;
  displayName: string;
  credential: string;
  signaturePublicKey: string;
  accountIdentityPublicKey: string;
  accountIdentitySignature: string;
  proofSignature: string;
  capabilities: string[];
};

export type KeyPackageUploadInput = {
  deviceId: string;
  protocolVersion: 1;
  ciphersuite: typeof CHAT_CIPHERSUITE;
  keyPackages: string[];
};

export type DeviceRegistrationProofInput = Omit<DeviceRegistrationInput, 'proofSignature'> & {
  challenge: string;
  accountId: string;
};

export type E2eeActivationInput = {
  protocolVersion: 1;
  senderDeviceId: string;
  groupId: string;
  epoch: '1';
  claimIds: string[];
  welcomes: Array<{ recipientDeviceId: string; payload: string }>;
};

export type E2eeActivationRecoveryInput = E2eeActivationInput & {
  previousGroupId: string;
};

export declare class MessagingContractError extends Error {
  readonly code: string;
  constructor(code: string);
}

export declare function normalizeContentEvent(input: unknown): ChatContentEvent;
export declare function encodeContentEvent(input: unknown): string;
export declare function decodeContentEvent(encoded: string): ChatContentEvent;
export declare function normalizeEnvelopeAad(input: unknown): EnvelopeAad;
export declare function canonicalEnvelopeAad(input: unknown): string;
export declare function decodedBase64UrlLength(value: unknown, code?: string): number;
export declare function normalizeOpaqueEnvelopeInput(input: unknown): OpaqueEnvelopeInput;
export declare function normalizeDeviceRegistration(input: unknown): DeviceRegistrationInput;
export declare function canonicalDeviceAuthorization(input: Omit<DeviceRegistrationInput, 'challengeId' | 'proofSignature' | 'accountIdentityPublicKey' | 'accountIdentitySignature'> & { accountId: string }): string;
export declare function canonicalDeviceRegistrationProof(input: unknown): string;
export declare function canonicalKeyDirectorySnapshotReceipt(input: {
  version: 1;
  issuer: 'volna_directory_v1';
  checkpoint: { version: 1; directoryLabel: string; identityFingerprint: string; entryCount: number; headHash: string | null };
  issuedAt: string;
  expiresAt: string;
}): Uint8Array;
export declare function normalizeTransferDeviceDraft(input: unknown): TransferDeviceDraft;
export declare function canonicalTransferDeviceDraft(input: unknown): string;
export declare function normalizeDeviceTransferSessionInput(input: unknown): DeviceTransferSessionInput;
export declare function normalizeDeviceTransferSourceInput(input: unknown): DeviceTransferSourceInput;
export declare function normalizeDeviceTransferChunkInput(input: unknown): DeviceTransferChunkInput;
export declare function normalizeTransferManifest(input: unknown): DeviceTransferManifest;
export declare function normalizeDeviceTransferApprovalInput(input: unknown): DeviceTransferApprovalInput;
export declare function canonicalMlsRoster(input: unknown): string;
export declare function normalizeKeyPackageUpload(input: unknown): KeyPackageUploadInput;
export declare function normalizeE2eeActivation(input: unknown): E2eeActivationInput;
export declare function normalizeE2eeActivationRecovery(input: unknown): E2eeActivationRecoveryInput;
export declare function normalizeMlsRekeyCommit(input: unknown): MlsRekeyCommitInput;
export declare function utf8ByteLength(value: string): number;
