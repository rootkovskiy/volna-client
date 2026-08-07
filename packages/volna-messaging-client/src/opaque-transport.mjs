import contract from './index.js';
import { sha256 } from '@noble/hashes/sha2.js';
import {
  base64UrlToBytes,
  keyDirectoryLabel,
  verifyKeyDirectorySnapshot,
  verifyKeyDirectoryWitnessQuorum,
} from './mls-runtime.mjs';

const {
  CHAT_CIPHERSUITE,
  CHAT_PROTOCOL_VERSION,
  MAX_TOTAL_DEVICES_PER_ACCOUNT,
  normalizeDeviceTransferApprovalInput,
  normalizeDeviceTransferChunkInput,
  normalizeDeviceTransferSessionInput,
  normalizeDeviceTransferSourceInput,
  normalizeDeviceRegistration,
  normalizeE2eeActivation,
  normalizeE2eeActivationRecovery,
  normalizeKeyPackageUpload,
  normalizeMlsRekeyCommit,
  normalizeOpaqueEnvelopeInput,
  normalizeTransferDeviceDraft,
  normalizeTransferManifest,
} = contract;

const ID_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;
const HEX_HASH_PATTERN = /^[0-9a-f]{64}$/;
const MAX_RESPONSE_CHARS = 2 * 1024 * 1024;
const MAX_WITNESS_RESPONSE_CHARS = 64 * 1024;
const DIRECTORY_PAGE_SIZE = 8;

export class OpaqueTransportError extends Error {
  constructor(code, status) {
    super(`VOLNA opaque transport error (${code})`);
    this.name = 'OpaqueTransportError';
    this.code = code;
    this.status = status;
  }
}

function fail(code, status) {
  throw new OpaqueTransportError(code, status);
}

function object(value, code) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(code);
  return value;
}

function id(value, code) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) fail(code);
  return value;
}

function text(value, maximum, code) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) fail(code);
  return value;
}

function optionalDate(value, code) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) fail(code);
  return value;
}

function requiredDate(value, code) {
  const parsed = optionalDate(value, code);
  if (parsed === null) fail(code);
  return parsed;
}

function epoch(value, code) {
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]{0,19})$/.test(value)) fail(code);
  return value;
}

function nullableHash(value, code) {
  if (value === null) return null;
  if (typeof value !== 'string' || !HEX_HASH_PATTERN.test(value)) fail(code);
  return value;
}

function boolean(value, code) {
  if (typeof value !== 'boolean') fail(code);
  return value;
}

function parseIdentity(value) {
  const identity = object(value, 'identity');
  return {
    accountId: id(identity.accountId, 'identity_account_id'),
    publicKey: text(identity.publicKey, 128, 'identity_public_key'),
    keyHash: typeof identity.keyHash === 'string' && HEX_HASH_PATTERN.test(identity.keyHash)
      ? identity.keyHash
      : fail('identity_hash'),
    createdAt: optionalDate(identity.createdAt, 'identity_created_at'),
  };
}

function parseDevice(value, identityPublicKey = undefined) {
  const device = object(value, 'device');
  if (device.platform !== 'ios' && device.platform !== 'android' && device.platform !== 'web') fail('device_platform');
  if (device.status !== 'ACTIVE' && device.status !== 'REVOKED') fail('device_status');
  if (!Array.isArray(device.capabilities)) fail('device_capabilities');
  return {
    id: id(device.id, 'device_id'),
    deviceId: id(device.id, 'device_id'),
    accountId: id(device.accountId, 'device_account_id'),
    platform: device.platform,
    displayName: text(device.displayName, 80, 'device_display_name'),
    credential: text(device.credential, 12 * 1024, 'device_credential'),
    signaturePublicKey: text(device.signaturePublicKey, 512, 'device_signature_key'),
    accountIdentityPublicKey: identityPublicKey,
    accountIdentitySignature: text(device.accountIdentitySignature, 1024, 'device_identity_signature'),
    capabilities: device.capabilities.map((item) => text(item, 80, 'device_capability')),
    status: device.status,
    registeredAt: optionalDate(device.registeredAt, 'device_registered_at'),
    lastSeenAt: optionalDate(device.lastSeenAt, 'device_last_seen_at'),
    revokedAt: optionalDate(device.revokedAt, 'device_revoked_at'),
    ...(device.isMember === undefined ? {} : { isMember: Boolean(device.isMember) }),
    ...(device.joinedAt === undefined ? {} : { joinedAt: optionalDate(device.joinedAt, 'device_joined_at') }),
    ...(device.removedAt === undefined ? {} : { removedAt: optionalDate(device.removedAt, 'device_removed_at') }),
  };
}

function parseThreadState(value) {
  const state = object(value, 'thread_state');
  if (state.encryptionMode !== 'LEGACY_PLAINTEXT' && state.encryptionMode !== 'MLS_V1') fail('thread_encryption_mode');
  const identities = Array.isArray(state.identities) ? state.identities.map(parseIdentity) : [];
  const identityByAccount = new Map(identities.map((identity) => [identity.accountId, identity.publicKey]));
  const parsed = {
    threadId: id(state.threadId, 'thread_id'),
    encryptionMode: state.encryptionMode,
    protocolVersion: state.protocolVersion === null ? null : state.protocolVersion,
    groupId: state.groupId === null ? null : text(state.groupId, 128, 'group_id'),
    epoch: epoch(state.epoch, 'thread_epoch'),
    encryptedSince: optionalDate(state.encryptedSince, 'encrypted_since'),
    ready: boolean(state.ready, 'thread_ready'),
    initialActivationRecoveryAllowed: state.initialActivationRecoveryAllowed === true,
    rekeyRequired: boolean(state.rekeyRequired, 'thread_rekey_required'),
    targetRosterHash: nullableHash(state.targetRosterHash, 'thread_target_roster_hash'),
    transitionExpiresAt: optionalDate(state.transitionExpiresAt, 'thread_transition_expiry'),
    plaintextFallback: state.plaintextFallback === false ? false : fail('plaintext_fallback'),
    identities,
    devices: Array.isArray(state.devices)
      ? state.devices.map((device) => {
          const accountId = id(device.accountId, 'device_account_id');
          return parseDevice(device, identityByAccount.get(accountId));
        })
      : [],
  };
  if (parsed.encryptionMode === 'LEGACY_PLAINTEXT') {
    if (
      parsed.protocolVersion !== null
      || parsed.groupId !== null
      || parsed.epoch !== '0'
      || parsed.encryptedSince !== null
      || parsed.ready
      || parsed.rekeyRequired
      || parsed.targetRosterHash !== null
      || parsed.transitionExpiresAt !== null
    ) {
      fail('thread_legacy_state');
    }
  } else if (
    parsed.protocolVersion !== CHAT_PROTOCOL_VERSION
    || parsed.groupId === null
    || parsed.epoch === '0'
    || parsed.encryptedSince === null
    || parsed.targetRosterHash === null
  ) {
    fail('thread_mls_state');
  }
  return parsed;
}

function parseEnvelope(value) {
  const envelope = object(value, 'envelope_response');
  const normalized = normalizeOpaqueEnvelopeInput({
    protocolVersion: envelope.protocolVersion,
    senderDeviceId: envelope.senderDeviceId,
    clientEnvelopeId: envelope.clientEnvelopeId,
    kind: envelope.kind,
    epoch: envelope.epoch,
    ciphertext: envelope.ciphertext,
    operationId: envelope.operationId,
    rosterHash: envelope.rosterHash,
  });
  const ciphertextHash = typeof envelope.ciphertextHash === 'string' && HEX_HASH_PATTERN.test(envelope.ciphertextHash)
    ? envelope.ciphertextHash
    : fail('envelope_hash');
  let calculatedHash = '';
  for (const byte of sha256(base64UrlToBytes(normalized.ciphertext, 96 * 1024))) {
    calculatedHash += byte.toString(16).padStart(2, '0');
  }
  if (ciphertextHash !== calculatedHash) fail('envelope_hash');
  return {
    ...normalized,
    id: id(envelope.id, 'envelope_id'),
    threadId: id(envelope.threadId, 'envelope_thread_id'),
    senderId: id(envelope.senderId, 'envelope_sender_id'),
    ciphertextHash,
    createdAt: requiredDate(envelope.createdAt, 'envelope_created_at'),
  };
}

function parseTransferSession(value) {
  const session = object(value, 'transfer_session');
  const normalized = normalizeDeviceTransferSessionInput({
    protocolVersion: session.protocolVersion,
    targetDeviceId: session.targetDeviceId,
    targetEphemeralPublicKey: session.targetEphemeralPublicKey,
    targetDraftHash: session.targetDraftHash,
    targetDeviceDraft: session.targetDeviceDraft,
  });
  const statuses = new Set(['PENDING', 'APPROVED', 'TARGET_REGISTERED', 'COMPLETED', 'CANCELLED', 'EXPIRED']);
  if (!statuses.has(session.status)) fail('transfer_status');
  const manifest = normalizeTransferManifest(session.manifest);
  const sourceDeviceId = session.sourceDeviceId === null ? null : id(session.sourceDeviceId, 'transfer_source_device_id');
  const sourceEphemeralPublicKey = session.sourceEphemeralPublicKey === null
    ? null
    : text(session.sourceEphemeralPublicKey, 128, 'transfer_source_key');
  if ((sourceDeviceId === null) !== (sourceEphemeralPublicKey === null)) fail('transfer_source_binding');
  const approvalPayload = session.approvalPayload === null
    ? null
    : text(session.approvalPayload, 300 * 1024, 'transfer_approval_payload');
  const approvalPayloadHash = nullableHash(session.approvalPayloadHash, 'transfer_approval_hash');
  if ((approvalPayload === null) !== (approvalPayloadHash === null)) fail('transfer_approval_binding');
  return {
    ...normalized,
    id: id(session.id, 'transfer_session_id'),
    accountId: id(session.accountId, 'transfer_account_id'),
    sourceDeviceId,
    sourceEphemeralPublicKey,
    approvalPayload,
    approvalPayloadHash,
    manifest,
    retireSourceDevice: boolean(session.retireSourceDevice, 'transfer_retire_source'),
    status: session.status,
    expiresAt: requiredDate(session.expiresAt, 'transfer_expiry'),
    approvedAt: optionalDate(session.approvedAt, 'transfer_approved_at'),
    targetRegisteredAt: optionalDate(session.targetRegisteredAt, 'transfer_registered_at'),
    completedAt: optionalDate(session.completedAt, 'transfer_completed_at'),
    cancelledAt: optionalDate(session.cancelledAt, 'transfer_cancelled_at'),
    createdAt: requiredDate(session.createdAt, 'transfer_created_at'),
    updatedAt: requiredDate(session.updatedAt, 'transfer_updated_at'),
  };
}

function parseClaim(claimValue) {
  const claim = object(claimValue, 'claim');
  if (claim.platform !== 'ios' && claim.platform !== 'android' && claim.platform !== 'web') fail('claim_platform');
  if (!Array.isArray(claim.capabilities)) fail('claim_capabilities');
  return {
    claimId: id(claim.claimId, 'claim_id'),
    recipientAccountId: id(claim.recipientAccountId, 'claim_account_id'),
    recipientDeviceId: id(claim.recipientDeviceId, 'claim_device_id'),
    platform: claim.platform,
    displayName: text(claim.displayName, 80, 'claim_display_name'),
    capabilities: claim.capabilities.map((item) => text(item, 80, 'claim_capability')),
    credential: text(claim.credential, 12 * 1024, 'claim_credential'),
    signaturePublicKey: text(claim.signaturePublicKey, 512, 'claim_signature_key'),
    accountIdentityPublicKey: text(claim.accountIdentityPublicKey, 512, 'claim_identity_key'),
    accountIdentitySignature: text(claim.accountIdentitySignature, 1024, 'claim_identity_signature'),
    keyPackage: text(claim.keyPackage, 24 * 1024, 'claim_key_package'),
    expiresAt: requiredDate(claim.expiresAt, 'claim_expires_at'),
  };
}

function parseRekeyOperation(value) {
  const operation = object(value, 'rekey_operation');
  if (operation.required === false) {
    if (!Array.isArray(operation.targetDeviceIds)) fail('rekey_target_devices');
    return {
      required: false,
      threadId: id(operation.threadId, 'rekey_thread_id'),
      epoch: epoch(operation.epoch, 'rekey_epoch'),
      rosterHash: nullableHash(operation.rosterHash, 'rekey_roster_hash'),
      targetDeviceIds: operation.targetDeviceIds.map((value) => id(value, 'rekey_target_device_id')),
    };
  }
  if (operation.required !== true || operation.protocolVersion !== CHAT_PROTOCOL_VERSION) fail('rekey_operation');
  const statuses = new Set(['PREPARED', 'COMMITTED', 'READY', 'ABORTED', 'EXPIRED']);
  if (!statuses.has(operation.status)) fail('rekey_status');
  for (const key of ['targetDeviceIds', 'addedDeviceIds', 'removedDeviceIds', 'claimIds']) {
    if (!Array.isArray(operation[key])) fail('rekey_device_sets');
  }
  const identities = Array.isArray(operation.identities) ? operation.identities.map(parseIdentity) : [];
  const identityByAccount = new Map(identities.map((identity) => [identity.accountId, identity.publicKey]));
  return {
    required: true,
    id: id(operation.id, 'rekey_operation_id'),
    threadId: id(operation.threadId, 'rekey_thread_id'),
    senderDeviceId: id(operation.senderDeviceId, 'rekey_sender_device_id'),
    protocolVersion: CHAT_PROTOCOL_VERSION,
    baseEpoch: epoch(operation.baseEpoch, 'rekey_base_epoch'),
    targetEpoch: epoch(operation.targetEpoch, 'rekey_target_epoch'),
    rosterHash: nullableHash(operation.rosterHash, 'rekey_roster_hash'),
    targetDeviceIds: operation.targetDeviceIds.map((value) => id(value, 'rekey_target_device_id')),
    addedDeviceIds: operation.addedDeviceIds.map((value) => id(value, 'rekey_added_device_id')),
    removedDeviceIds: operation.removedDeviceIds.map((value) => id(value, 'rekey_removed_device_id')),
    claimIds: operation.claimIds.map((value) => id(value, 'rekey_claim_id')),
    status: operation.status,
    expiresAt: requiredDate(operation.expiresAt, 'rekey_expiry'),
    committedAt: optionalDate(operation.committedAt, 'rekey_committed_at'),
    readyAt: optionalDate(operation.readyAt, 'rekey_ready_at'),
    abortedAt: optionalDate(operation.abortedAt, 'rekey_aborted_at'),
    createdAt: requiredDate(operation.createdAt, 'rekey_created_at'),
    updatedAt: requiredDate(operation.updatedAt, 'rekey_updated_at'),
    identities,
    devices: Array.isArray(operation.devices)
      ? operation.devices.map((device) => {
          const accountId = id(device.accountId, 'rekey_device_account_id');
          return parseDevice(device, identityByAccount.get(accountId));
        })
      : [],
    claims: Array.isArray(operation.claims) ? operation.claims.map(parseClaim) : [],
    envelope: operation.envelope === null || operation.envelope === undefined
      ? null
      : parseEnvelope(operation.envelope),
  };
}

function encodeQuery(value) {
  return encodeURIComponent(value);
}

export function createOpaqueChatTransport(options) {
  return new OpaqueChatTransport(options);
}

export class OpaqueChatTransport {
  constructor(optionsValue) {
    const options = object(optionsValue, 'transport_options');
    if (typeof options.fetch !== 'function') fail('fetch_missing');
    if (typeof options.getAccessToken !== 'function') fail('token_provider_missing');
    let origin;
    try {
      origin = new URL(options.apiOrigin);
    } catch {
      fail('api_origin');
    }
    if (origin.username || origin.password || origin.search || origin.hash || (origin.protocol !== 'https:' && origin.protocol !== 'http:')) {
      fail('api_origin');
    }
    if (origin.protocol !== 'https:' && options.allowInsecureDevelopmentOrigin !== true) {
      fail('api_origin_https');
    }
    this.origin = origin.origin;
    this.fetch = options.fetch;
    this.getAccessToken = options.getAccessToken;
    this.includeCredentials = options.includeCredentials === true;
    this.keyTransparencyPolicy = this.normalizeKeyTransparencyPolicy(
      options.keyTransparencyPolicy,
      options.allowInsecureDevelopmentOrigin === true,
    );
  }

  normalizeKeyTransparencyPolicy(value, allowInsecureDevelopmentOrigin) {
    if (value === undefined) return null;
    const policy = object(value, 'directory_witness_policy');
    if (!Array.isArray(policy.witnesses) || policy.witnesses.length < 2 || policy.witnesses.length > 8) {
      fail('directory_witness_policy');
    }
    if (!Number.isSafeInteger(policy.threshold) || policy.threshold < 2 || policy.threshold > policy.witnesses.length) {
      fail('directory_witness_threshold');
    }
    if (
      !Number.isSafeInteger(policy.maxStatementAgeMs)
      || policy.maxStatementAgeMs < 60_000
      || policy.maxStatementAgeMs > 30 * 24 * 60 * 60_000
    ) fail('directory_witness_max_age');
    const seenIds = new Set();
    const seenOrigins = new Set();
    const seenKeys = new Set();
    const witnesses = policy.witnesses.map((value) => {
      const witness = object(value, 'directory_witness_policy');
      const witnessId = id(witness.id, 'directory_witness_id');
      const publicKey = text(witness.publicKey, 128, 'directory_witness_public_key');
      if (base64UrlToBytes(publicKey, 32).length !== 32) fail('directory_witness_public_key');
      let origin;
      try {
        origin = new URL(witness.origin);
      } catch {
        fail('directory_witness_origin');
      }
      if (
        origin.username
        || origin.password
        || origin.search
        || origin.hash
        || origin.origin === this.origin
        || (origin.protocol !== 'https:' && !(allowInsecureDevelopmentOrigin && origin.protocol === 'http:'))
      ) fail('directory_witness_origin');
      if (seenIds.has(witnessId) || seenOrigins.has(origin.origin) || seenKeys.has(publicKey)) {
        fail('directory_witness_not_independent');
      }
      seenIds.add(witnessId);
      seenOrigins.add(origin.origin);
      seenKeys.add(publicKey);
      return { id: witnessId, publicKey, origin: origin.origin };
    });
    return Object.freeze({
      threshold: policy.threshold,
      maxStatementAgeMs: policy.maxStatementAgeMs,
      witnesses: Object.freeze(witnesses),
    });
  }

  async request(path, init = {}) {
    const token = await this.getAccessToken();
    const headers = { Accept: 'application/json', ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }) };
    if (typeof token === 'string' && token.length > 0) headers.Authorization = `Bearer ${token}`;
    let response;
    try {
      response = await this.fetch(`${this.origin}${path}`, {
        ...init,
        headers: { ...headers, ...(init.headers ?? {}) },
        cache: 'no-store',
        credentials: this.includeCredentials ? 'include' : 'same-origin',
        redirect: 'error',
      });
    } catch {
      fail('network');
    }
    if (!response || typeof response.ok !== 'boolean' || typeof response.text !== 'function') fail('response');
    const declaredLength = Number(response.headers?.get?.('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_CHARS) fail('response_too_large', response.status);
    const body = await response.text();
    if (body.length > MAX_RESPONSE_CHARS) fail('response_too_large', response.status);
    if (!response.ok) fail(response.status === 401 ? 'unauthorized' : response.status === 409 ? 'conflict' : 'server_rejected', response.status);
    try {
      return JSON.parse(body);
    } catch {
      fail('response_json', response.status);
    }
  }

  async capabilities() {
    const value = object(await this.request('/chats/e2ee/capabilities'), 'capabilities');
    if (
      value.protocolVersion !== CHAT_PROTOCOL_VERSION
      || value.ciphersuite !== CHAT_CIPHERSUITE
      || value.plaintextFallback !== false
      || value.contentPlane !== 'opaque-only-for-mls-v1'
      || value.legacyHistoryServerReadable !== true
      || value.keyTransparencyRequired !== true
      || value.directoryPaginationVersion !== 1
    ) {
      fail('capabilities_mismatch');
    }
    return {
      protocolVersion: CHAT_PROTOCOL_VERSION,
      ciphersuite: CHAT_CIPHERSUITE,
      enrollmentEnabled: value.enrollmentEnabled === true,
      rolloutEnabled: value.rolloutEnabled === true,
      deviceTransferEnabled: value.deviceTransferEnabled === true,
      membershipRekeyEnabled: value.membershipRekeyEnabled === true,
      plaintextFallback: false,
      contentPlane: 'opaque-only-for-mls-v1',
      legacyHistoryServerReadable: true,
      keyTransparencyRequired: true,
      directoryPaginationVersion: 1,
    };
  }

  async createDeviceChallenge() {
    const value = object(await this.request('/chats/e2ee/devices/challenge', { method: 'POST', body: '{}' }), 'challenge');
    return {
      challengeId: id(value.challengeId, 'challenge_id'),
      challenge: text(value.challenge, 128, 'challenge_value'),
      expiresAt: optionalDate(value.expiresAt, 'challenge_expires_at'),
    };
  }

  async registerDevice(input) {
    const normalized = normalizeDeviceRegistration(input);
    const value = object(await this.request('/chats/e2ee/devices', { method: 'POST', body: JSON.stringify(normalized) }), 'registration');
    const identity = parseIdentity(value.identity);
    return { identity, device: parseDevice(value.device, identity.publicKey) };
  }

  async listOwnDevices() {
    const value = object(await this.request('/chats/e2ee/devices'), 'device_list');
    const identity = value.identity === null ? null : parseIdentity(value.identity);
    if (!Array.isArray(value.devices)) fail('device_list');
    return {
      identity,
      devices: value.devices.map((device) => parseDevice(device, identity?.publicKey)),
    };
  }

  async createDeviceTransfer(input) {
    const body = normalizeDeviceTransferSessionInput(input);
    return parseTransferSession(await this.request('/chats/e2ee/device-transfers', {
      method: 'POST',
      body: JSON.stringify(body),
    }));
  }

  async getDeviceTransfer(transferId) {
    return parseTransferSession(await this.request(
      `/chats/e2ee/device-transfers/${encodeQuery(id(transferId, 'transfer_id'))}`,
    ));
  }

  async connectDeviceTransferSource(transferId, input) {
    const body = normalizeDeviceTransferSourceInput(input);
    return parseTransferSession(await this.request(
      `/chats/e2ee/device-transfers/${encodeQuery(id(transferId, 'transfer_id'))}/source`,
      { method: 'POST', body: JSON.stringify(body) },
    ));
  }

  async uploadDeviceTransferChunk(transferId, input) {
    const body = normalizeDeviceTransferChunkInput(input);
    const value = object(await this.request(
      `/chats/e2ee/device-transfers/${encodeQuery(id(transferId, 'transfer_id'))}/chunks`,
      { method: 'POST', body: JSON.stringify(body) },
    ), 'transfer_chunk_receipt');
    return {
      created: boolean(value.created, 'transfer_chunk_created'),
      sequence: value.sequence === body.sequence ? body.sequence : fail('transfer_chunk_sequence'),
      payloadHash: value.payloadHash === body.payloadHash ? body.payloadHash : fail('transfer_chunk_hash'),
      manifest: normalizeTransferManifest(value.manifest),
    };
  }

  async approveDeviceTransfer(transferId, input) {
    const body = normalizeDeviceTransferApprovalInput(input);
    return parseTransferSession(await this.request(
      `/chats/e2ee/device-transfers/${encodeQuery(id(transferId, 'transfer_id'))}/approve`,
      { method: 'POST', body: JSON.stringify(body) },
    ));
  }

  async listDeviceTransferChunks(transferId, afterSequence = -1) {
    if (!Number.isSafeInteger(afterSequence) || afterSequence < -1 || afterSequence > 127) fail('transfer_after_sequence');
    const value = object(await this.request(
      `/chats/e2ee/device-transfers/${encodeQuery(id(transferId, 'transfer_id'))}/chunks?afterSequence=${afterSequence}`,
    ), 'transfer_chunks');
    if (value.transferId !== transferId || !Array.isArray(value.items)) fail('transfer_chunks');
    const items = value.items.map((chunkValue) => {
      const chunk = object(chunkValue, 'transfer_chunk');
      const normalized = normalizeDeviceTransferChunkInput({
        protocolVersion: CHAT_PROTOCOL_VERSION,
        sourceDeviceId: 'transfer_source_placeholder',
        sequence: chunk.sequence,
        previousHash: chunk.previousHash,
        payload: chunk.payload,
        payloadHash: chunk.payloadHash,
        ciphertextBytes: chunk.ciphertextBytes,
      });
      let calculatedHash = '';
      for (const byte of sha256(base64UrlToBytes(normalized.payload))) {
        calculatedHash += byte.toString(16).padStart(2, '0');
      }
      if (calculatedHash !== normalized.payloadHash) fail('transfer_chunk_hash');
      const { sourceDeviceId: _unused, protocolVersion: _version, ...result } = normalized;
      return result;
    });
    const nextAfterSequence = value.nextAfterSequence === null
      ? null
      : (Number.isSafeInteger(value.nextAfterSequence) ? value.nextAfterSequence : fail('transfer_chunk_cursor'));
    return {
      transferId,
      manifest: normalizeTransferManifest(value.manifest),
      items,
      nextAfterSequence,
    };
  }

  async finalizeDeviceTransfer(transferId) {
    const value = object(await this.request(
      `/chats/e2ee/device-transfers/${encodeQuery(id(transferId, 'transfer_id'))}/finalize`,
      { method: 'POST', body: '{}' },
    ), 'transfer_finalize');
    const session = parseTransferSession(value);
    if (!Array.isArray(value.rekeyRequiredThreadIds)) fail('transfer_rekeys');
    return {
      ...session,
      completed: boolean(value.completed, 'transfer_completed'),
      rekeyRequiredThreadIds: value.rekeyRequiredThreadIds.map((threadId) => id(threadId, 'transfer_rekey_thread_id')),
    };
  }

  async cancelDeviceTransfer(transferId) {
    return parseTransferSession(await this.request(
      `/chats/e2ee/device-transfers/${encodeQuery(id(transferId, 'transfer_id'))}`,
      { method: 'DELETE' },
    ));
  }

  revokeDevice(deviceId) {
    return this.request(`/chats/e2ee/devices/${encodeQuery(id(deviceId, 'device_id'))}`, { method: 'DELETE' });
  }

  async getDirectory(accountId) {
    const requestedAccountId = id(accountId, 'directory_account_id');
    if (this.keyTransparencyPolicy === null) fail('directory_witness_policy_missing');
    let cursor = null;
    let identity = null;
    let devices = null;
    let headHash;
    let entryCount;
    const entries = [];
    const seenCursors = new Set();
    let firstPage = true;
    do {
      const suffix = cursor === null
        ? `?pageSize=${DIRECTORY_PAGE_SIZE}`
        : `?pageSize=${DIRECTORY_PAGE_SIZE}&cursor=${encodeQuery(cursor)}`;
      const value = object(await this.request(
        `/chats/e2ee/directory/${encodeQuery(requestedAccountId)}${suffix}`,
      ), 'directory');
      const pageIdentity = value.identity === null ? null : parseIdentity(value.identity);
      if (!Array.isArray(value.devices) || !Array.isArray(value.entries)) fail('directory');
      const pageDevices = value.devices.map((device) => parseDevice(device, pageIdentity?.publicKey));
      const pageAccountId = id(value.accountId, 'directory_account_id');
      const pageHeadHash = value.headHash === null || (typeof value.headHash === 'string' && HEX_HASH_PATTERN.test(value.headHash))
        ? value.headHash
        : fail('directory_head');
      if (
        pageAccountId !== requestedAccountId
        || !Number.isSafeInteger(value.entryCount)
        || value.entryCount < 0
        || value.entryCount > MAX_TOTAL_DEVICES_PER_ACCOUNT * 2
      ) fail('directory_snapshot');
      if (firstPage) {
        if (value.snapshotDetailsIncluded !== true) fail('directory_snapshot_details');
        identity = pageIdentity;
        devices = pageDevices;
        headHash = pageHeadHash;
        entryCount = value.entryCount;
      } else if (
        value.snapshotDetailsIncluded !== false
        || pageIdentity !== null
        || pageDevices.length !== 0
        || pageHeadHash !== headHash
        || value.entryCount !== entryCount
      ) fail('directory_snapshot_changed');
      entries.push(...value.entries);
      if (entries.length > entryCount || entries.length > MAX_TOTAL_DEVICES_PER_ACCOUNT * 2) fail('directory_entries');
      if (value.nextCursor === null) {
        cursor = null;
      } else {
        cursor = text(value.nextCursor, 2_048, 'directory_cursor');
        if (seenCursors.has(cursor)) fail('directory_cursor_cycle');
        seenCursors.add(cursor);
      }
      firstPage = false;
    } while (cursor !== null);
    if (entries.length !== entryCount) fail('directory_entry_count');
    const directory = {
      accountId: requestedAccountId,
      identity,
      devices,
      entries,
      headHash,
      entryCount,
    };
    if (directory.identity === null) fail('directory_identity');
    try {
      directory.verification = verifyKeyDirectorySnapshot(directory);
    } catch {
      fail('directory_verification');
    }
    const checkpoint = {
      directoryLabel: keyDirectoryLabel(requestedAccountId),
      identityFingerprint: directory.verification.identityFingerprint,
      entryCount,
      headHash,
    };
    const statements = (await Promise.all(this.keyTransparencyPolicy.witnesses.map(async (witness) => {
      const query = new URLSearchParams({
        entryCount: String(checkpoint.entryCount),
        headHash: checkpoint.headHash ?? 'none',
        identityFingerprint: checkpoint.identityFingerprint,
      });
      let response;
      try {
        response = await this.fetch(
          `${witness.origin}/v1/key-directory/checkpoints/${checkpoint.directoryLabel}?${query.toString()}`,
          {
            method: 'GET',
            headers: { Accept: 'application/json' },
            cache: 'no-store',
            credentials: 'omit',
            redirect: 'error',
            referrerPolicy: 'no-referrer',
          },
        );
        if (!response?.ok || typeof response.text !== 'function') return null;
        const declaredLength = Number(response.headers?.get?.('content-length'));
        if (Number.isFinite(declaredLength) && declaredLength > MAX_WITNESS_RESPONSE_CHARS) return null;
        const body = await response.text();
        if (body.length > MAX_WITNESS_RESPONSE_CHARS) return null;
        const statement = object(JSON.parse(body), 'directory_witness_statement');
        return statement.witnessId === witness.id ? statement : null;
      } catch {
        return null;
      }
    }))).filter((statement) => statement !== null);
    try {
      directory.verification.witnessQuorum = verifyKeyDirectoryWitnessQuorum({
        accountId: requestedAccountId,
        identityFingerprint: directory.verification.identityFingerprint,
        entryCount,
        headHash,
        statements,
        policy: this.keyTransparencyPolicy,
      });
    } catch {
      fail('directory_witness_verification');
    }
    return directory;
  }

  uploadKeyPackages(deviceId, keyPackages) {
    const body = normalizeKeyPackageUpload({
      deviceId,
      protocolVersion: CHAT_PROTOCOL_VERSION,
      ciphersuite: CHAT_CIPHERSUITE,
      keyPackages,
    });
    return this.request('/chats/e2ee/key-packages', { method: 'POST', body: JSON.stringify(body) });
  }

  async keyPackageStatus(deviceId) {
    const requestedDeviceId = id(deviceId, 'device_id');
    const value = object(await this.request(
      `/chats/e2ee/key-packages/status?deviceId=${encodeQuery(requestedDeviceId)}`,
    ), 'key_package_status');
    if (
      value.deviceId !== requestedDeviceId
      || !Number.isSafeInteger(value.available)
      || value.available < 0
      || !Number.isSafeInteger(value.target)
      || value.target < 1
      || !Number.isSafeInteger(value.maximum)
      || value.maximum < value.target
    ) fail('key_package_status');
    return {
      deviceId: requestedDeviceId,
      available: value.available,
      target: value.target,
      maximum: value.maximum,
      oldestExpiresAt: optionalDate(value.oldestExpiresAt, 'key_package_expiry'),
    };
  }

  async claimKeyPackages(threadId, requesterDeviceId) {
    const value = object(await this.request(
      `/chats/${encodeQuery(id(threadId, 'thread_id'))}/e2ee/key-packages/claim`,
      { method: 'POST', body: JSON.stringify({ requesterDeviceId: id(requesterDeviceId, 'device_id') }) },
    ), 'claims');
    if (
      value.protocolVersion !== CHAT_PROTOCOL_VERSION
      || value.ciphersuite !== CHAT_CIPHERSUITE
      || value.threadId !== threadId
      || !Array.isArray(value.claims)
    ) fail('claims');
    return {
      protocolVersion: CHAT_PROTOCOL_VERSION,
      ciphersuite: CHAT_CIPHERSUITE,
      threadId,
      reservationExpiresAt: optionalDate(value.reservationExpiresAt, 'claim_expiry'),
      claims: value.claims.map((claimValue) => {
        const claim = object(claimValue, 'claim');
        if (claim.platform !== 'ios' && claim.platform !== 'android' && claim.platform !== 'web') fail('claim_platform');
        if (!Array.isArray(claim.capabilities)) fail('claim_capabilities');
        return {
          claimId: id(claim.claimId, 'claim_id'),
          recipientAccountId: id(claim.recipientAccountId, 'claim_account_id'),
          recipientDeviceId: id(claim.recipientDeviceId, 'claim_device_id'),
          platform: claim.platform,
          displayName: text(claim.displayName, 80, 'claim_display_name'),
          capabilities: claim.capabilities.map((item) => text(item, 80, 'claim_capability')),
          credential: text(claim.credential, 12 * 1024, 'claim_credential'),
          signaturePublicKey: text(claim.signaturePublicKey, 512, 'claim_signature_key'),
          accountIdentityPublicKey: text(claim.accountIdentityPublicKey, 512, 'claim_identity_key'),
          accountIdentitySignature: text(claim.accountIdentitySignature, 1024, 'claim_identity_signature'),
          keyPackage: text(claim.keyPackage, 24 * 1024, 'claim_key_package'),
          expiresAt: optionalDate(claim.expiresAt, 'claim_expires_at'),
        };
      }),
    };
  }

  async activateThread(threadId, input) {
    const body = normalizeE2eeActivation(input);
    return parseThreadState(await this.request(
      `/chats/${encodeQuery(id(threadId, 'thread_id'))}/e2ee/activate`,
      { method: 'POST', body: JSON.stringify(body) },
    ));
  }

  async recoverThreadActivation(threadId, input) {
    const body = normalizeE2eeActivationRecovery(input);
    return parseThreadState(await this.request(
      `/chats/${encodeQuery(id(threadId, 'thread_id'))}/e2ee/activation/recover`,
      { method: 'POST', body: JSON.stringify(body) },
    ));
  }

  async listRequiredRekeys(deviceId) {
    const value = await this.request(`/chats/e2ee/rekeys?deviceId=${encodeQuery(id(deviceId, 'device_id'))}`);
    if (!Array.isArray(value)) fail('rekey_list');
    return value.map((itemValue) => {
      const item = object(itemValue, 'rekey_list_item');
      return {
        threadId: id(item.threadId, 'rekey_thread_id'),
        epoch: epoch(item.epoch, 'rekey_epoch'),
      };
    });
  }

  async prepareThreadRekey(threadId, requesterDeviceId) {
    return parseRekeyOperation(await this.request(
      `/chats/${encodeQuery(id(threadId, 'thread_id'))}/e2ee/rekeys`,
      {
        method: 'POST',
        body: JSON.stringify({ requesterDeviceId: id(requesterDeviceId, 'device_id') }),
      },
    ));
  }

  async getThreadRekey(threadId, operationId) {
    return parseRekeyOperation(await this.request(
      `/chats/${encodeQuery(id(threadId, 'thread_id'))}/e2ee/rekeys/${encodeQuery(id(operationId, 'operation_id'))}`,
    ));
  }

  async commitThreadRekey(threadId, operationId, input) {
    const body = normalizeMlsRekeyCommit(input);
    if (body.operationId !== operationId) fail('rekey_operation_binding');
    return parseRekeyOperation(await this.request(
      `/chats/${encodeQuery(id(threadId, 'thread_id'))}/e2ee/rekeys/${encodeQuery(id(operationId, 'operation_id'))}/commit`,
      { method: 'POST', body: JSON.stringify(body) },
    ));
  }

  async abortThreadRekey(threadId, operationId, requesterDeviceId) {
    return parseRekeyOperation(await this.request(
      `/chats/${encodeQuery(id(threadId, 'thread_id'))}/e2ee/rekeys/${encodeQuery(id(operationId, 'operation_id'))}?requesterDeviceId=${encodeQuery(id(requesterDeviceId, 'device_id'))}`,
      { method: 'DELETE' },
    ));
  }

  async getThreadState(threadId) {
    return parseThreadState(await this.request(`/chats/${encodeQuery(id(threadId, 'thread_id'))}/e2ee/state`));
  }

  async listPendingWelcomes(deviceId) {
    const value = await this.request(`/chats/e2ee/welcomes?deviceId=${encodeQuery(id(deviceId, 'device_id'))}`);
    if (!Array.isArray(value)) fail('welcome_list');
    return value.map((welcomeValue) => {
      const welcome = object(welcomeValue, 'welcome');
      if (welcome.protocolVersion !== CHAT_PROTOCOL_VERSION) fail('welcome_version');
      return {
        id: id(welcome.id, 'welcome_id'),
        threadId: id(welcome.threadId, 'welcome_thread_id'),
        senderDeviceId: id(welcome.senderDeviceId, 'welcome_sender_device_id'),
        recipientDeviceId: id(welcome.recipientDeviceId, 'welcome_recipient_device_id'),
        protocolVersion: CHAT_PROTOCOL_VERSION,
        epoch: epoch(welcome.epoch, 'welcome_epoch'),
        groupId: text(welcome.groupId, 128, 'welcome_group_id'),
        payload: text(welcome.payload, 140 * 1024, 'welcome_payload'),
        replacesGroupId: welcome.replacesGroupId === null || welcome.replacesGroupId === undefined
          ? null
          : text(welcome.replacesGroupId, 128, 'welcome_replaces_group_id'),
        rekeyOperationId: welcome.rekeyOperationId === null
          ? null
          : id(welcome.rekeyOperationId, 'welcome_rekey_operation_id'),
        rosterHash: nullableHash(welcome.rosterHash, 'welcome_roster_hash'),
        commitEnvelopeId: welcome.commitEnvelopeId === null
          ? null
          : id(welcome.commitEnvelopeId, 'welcome_commit_envelope_id'),
        createdAt: optionalDate(welcome.createdAt, 'welcome_created_at'),
      };
    });
  }

  acknowledgeWelcome(welcomeId) {
    return this.request(`/chats/e2ee/welcomes/${encodeQuery(id(welcomeId, 'welcome_id'))}/ack`, { method: 'POST', body: '{}' });
  }

  async listEnvelopes(threadId, deviceId, cursor = undefined) {
    const cursorQuery = cursor === undefined ? '' : `&cursor=${encodeQuery(cursor)}`;
    const value = object(await this.request(
      `/chats/${encodeQuery(id(threadId, 'thread_id'))}/e2ee/envelopes?deviceId=${encodeQuery(id(deviceId, 'device_id'))}&pageSize=10${cursorQuery}`,
    ), 'envelope_page');
    if (!Array.isArray(value.items)) fail('envelope_page');
    return {
      items: value.items.map(parseEnvelope),
      nextCursor: value.nextCursor === null || typeof value.nextCursor === 'string' ? value.nextCursor : fail('envelope_cursor'),
      checkpointCursor: value.checkpointCursor === null || typeof value.checkpointCursor === 'string'
        ? value.checkpointCursor
        : fail('envelope_checkpoint'),
    };
  }

  async sendEnvelope(threadId, input) {
    const body = normalizeOpaqueEnvelopeInput(input);
    return parseEnvelope(await this.request(
      `/chats/${encodeQuery(id(threadId, 'thread_id'))}/e2ee/envelopes`,
      { method: 'POST', body: JSON.stringify(body) },
    ));
  }
}
