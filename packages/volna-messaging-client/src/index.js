'use strict';

const CHAT_PROTOCOL_VERSION = 1;
const CHAT_CIPHERSUITE = 'MLS_128_DHKEMX25519_CHACHA20POLY1305_SHA256_Ed25519';
const MAX_CHAT_TEXT_CHARS = 1000;
const MAX_CONTENT_EVENT_BYTES = 64 * 1024;
const MAX_ENVELOPE_CIPHERTEXT_BYTES = 96 * 1024;
const MAX_WELCOME_BYTES = 96 * 1024;
const MAX_KEY_PACKAGE_BYTES = 16 * 1024;
const MAX_DEVICE_CREDENTIAL_BYTES = 8 * 1024;
const MAX_DEVICE_SIGNATURE_KEY_BYTES = 256;
const MAX_DEVICE_SIGNATURE_BYTES = 512;
const MAX_ACTIVE_DEVICES_PER_ACCOUNT = 8;
const MAX_TOTAL_DEVICES_PER_ACCOUNT = 32;
const MAX_KEY_PACKAGES_PER_DEVICE = 100;
const MAX_TRANSFER_CHUNK_BYTES = 192 * 1024;
const MAX_TRANSFER_CHUNKS = 128;
const MAX_TRANSFER_TOTAL_BYTES = MAX_TRANSFER_CHUNK_BYTES * MAX_TRANSFER_CHUNKS;
const MAX_TRANSFER_WIRE_PAYLOAD_BYTES = MAX_TRANSFER_CHUNK_BYTES + 4096;

const ID_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;
const EPOCH_PATTERN = /^(?:0|[1-9][0-9]{0,19})$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const FORBIDDEN_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const ENVELOPE_KINDS = new Set(['APPLICATION', 'COMMIT']);
const DEVICE_PLATFORMS = new Set(['ios', 'android', 'web']);
const CONTENT_KINDS = new Set(['message.create', 'message.edit', 'message.reaction', 'message.delete']);
const ENTITY_TYPES = new Set(['account', 'publicPage', 'event']);
const MUSIC_PROVIDERS = new Set(['apple', 'yandex', 'youtube', 'volna', 'soundcloud', 'bandcamp']);

class MessagingContractError extends Error {
  constructor(code) {
    super(`Invalid messaging payload (${code})`);
    this.name = 'MessagingContractError';
    this.code = code;
  }
}

function fail(code) {
  throw new MessagingContractError(code);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertPlainObject(value, code) {
  if (!isPlainObject(value)) fail(code);
  return value;
}

function assertExactKeys(value, allowed, code) {
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_OBJECT_KEYS.has(key) || !allowed.has(key)) fail(code);
  }
}

function assertId(value, code) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) fail(code);
  return value;
}

function assertOptionalString(value, maxLength, code) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value.length > maxLength) fail(code);
  return value;
}

function assertRequiredString(value, maxLength, code) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) fail(code);
  return value;
}

function assertDate(value) {
  if (typeof value !== 'string' || !ISO_DATE_PATTERN.test(value) || !Number.isFinite(Date.parse(value))) {
    fail('client_created_at');
  }
  return value;
}

function normalizeText(value, { required = false } = {}) {
  if (typeof value !== 'string') {
    if (required) fail('text');
    return undefined;
  }
  const normalized = value.replace(/\r\n?/g, '\n');
  if (normalized.length > MAX_CHAT_TEXT_CHARS || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(normalized)) {
    fail('text');
  }
  if (required && !normalized.trim()) fail('text');
  return normalized;
}

function normalizeBoundedJson(value, depth = 0, budget = { nodes: 0 }) {
  budget.nodes += 1;
  if (depth > 5 || budget.nodes > 256) fail('attachment_metadata');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('attachment_metadata');
    return value;
  }
  if (typeof value === 'string') {
    if (value.length > 4096) fail('attachment_metadata');
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 64) fail('attachment_metadata');
    return value.map((item) => normalizeBoundedJson(item, depth + 1, budget));
  }
  const object = assertPlainObject(value, 'attachment_metadata');
  const keys = Object.keys(object);
  if (keys.length > 64) fail('attachment_metadata');
  const normalized = Object.create(null);
  for (const key of keys.sort()) {
    if (FORBIDDEN_OBJECT_KEYS.has(key) || key.length > 80) fail('attachment_metadata');
    normalized[key] = normalizeBoundedJson(object[key], depth + 1, budget);
  }
  return normalized;
}

function normalizeAttachment(value) {
  if (value === undefined || value === null) return undefined;
  const attachment = assertPlainObject(value, 'attachment');
  if (attachment.kind === 'location') {
    assertExactKeys(attachment, new Set(['kind', 'latitude', 'longitude', 'accuracy']), 'attachment_location_keys');
    if (typeof attachment.latitude !== 'number' || !Number.isFinite(attachment.latitude) || attachment.latitude < -90 || attachment.latitude > 90) fail('attachment_latitude');
    if (typeof attachment.longitude !== 'number' || !Number.isFinite(attachment.longitude) || attachment.longitude < -180 || attachment.longitude > 180) fail('attachment_longitude');
    if (attachment.accuracy !== undefined && (typeof attachment.accuracy !== 'number' || !Number.isFinite(attachment.accuracy) || attachment.accuracy < 0 || attachment.accuracy > 100000)) fail('attachment_accuracy');
    return {
      kind: 'location',
      latitude: attachment.latitude,
      longitude: attachment.longitude,
      ...(attachment.accuracy === undefined ? {} : { accuracy: attachment.accuracy }),
    };
  }
  if (attachment.kind === 'entity') {
    assertExactKeys(attachment, new Set(['kind', 'entityType', 'id', 'snapshot']), 'attachment_entity_keys');
    if (!ENTITY_TYPES.has(attachment.entityType)) fail('attachment_entity_type');
    const normalized = {
      kind: 'entity',
      entityType: attachment.entityType,
      id: assertId(attachment.id, 'attachment_entity_id'),
    };
    if (attachment.snapshot !== undefined) normalized.snapshot = normalizeBoundedJson(attachment.snapshot);
    if (utf8ByteLength(JSON.stringify(normalized)) > 32 * 1024) fail('attachment_entity_size');
    return normalized;
  }
  if (attachment.kind === 'music') {
    assertExactKeys(attachment, new Set(['kind', 'provider', 'id', 'title', 'artist', 'metadata']), 'attachment_music_keys');
    if (!MUSIC_PROVIDERS.has(attachment.provider)) fail('attachment_music_provider');
    const normalized = {
      kind: 'music',
      provider: attachment.provider,
      id: assertRequiredString(attachment.id, 1000, 'attachment_music_id'),
      title: assertRequiredString(attachment.title, 500, 'attachment_music_title'),
      artist: assertRequiredString(attachment.artist, 500, 'attachment_music_artist'),
    };
    if (attachment.metadata !== undefined) normalized.metadata = normalizeBoundedJson(attachment.metadata);
    if (utf8ByteLength(JSON.stringify(normalized)) > 32 * 1024) fail('attachment_music_size');
    return normalized;
  }
  fail('attachment_kind');
}

function normalizeContentEvent(input) {
  const event = assertPlainObject(input, 'content_event');
  if (event.v !== CHAT_PROTOCOL_VERSION) fail('content_version');
  if (!CONTENT_KINDS.has(event.kind)) fail('content_kind');
  const common = {
    v: CHAT_PROTOCOL_VERSION,
    kind: event.kind,
    logicalMessageId: assertId(event.logicalMessageId, 'logical_message_id'),
    clientCreatedAt: assertDate(event.clientCreatedAt),
  };

  if (event.kind === 'message.create') {
    assertExactKeys(event, new Set(['v', 'kind', 'logicalMessageId', 'clientCreatedAt', 'text', 'attachment']), 'message_create_keys');
    const text = normalizeText(event.text);
    const attachment = normalizeAttachment(event.attachment);
    if (!text?.trim() && !attachment) fail('message_create_empty');
    return { ...common, ...(text === undefined ? {} : { text }), ...(attachment === undefined ? {} : { attachment }) };
  }
  if (event.kind === 'message.edit') {
    assertExactKeys(event, new Set(['v', 'kind', 'logicalMessageId', 'clientCreatedAt', 'targetLogicalMessageId', 'text']), 'message_edit_keys');
    return {
      ...common,
      targetLogicalMessageId: assertId(event.targetLogicalMessageId, 'target_logical_message_id'),
      text: normalizeText(event.text, { required: true }),
    };
  }
  if (event.kind === 'message.reaction') {
    assertExactKeys(event, new Set(['v', 'kind', 'logicalMessageId', 'clientCreatedAt', 'targetLogicalMessageId', 'emoji']), 'message_reaction_keys');
    const emoji = event.emoji === null ? null : assertRequiredString(event.emoji, 32, 'reaction_emoji');
    return { ...common, targetLogicalMessageId: assertId(event.targetLogicalMessageId, 'target_logical_message_id'), emoji };
  }
  assertExactKeys(event, new Set(['v', 'kind', 'logicalMessageId', 'clientCreatedAt', 'targetLogicalMessageId']), 'message_delete_keys');
  return { ...common, targetLogicalMessageId: assertId(event.targetLogicalMessageId, 'target_logical_message_id') };
}

function encodeContentEvent(input) {
  const encoded = JSON.stringify(normalizeContentEvent(input));
  if (utf8ByteLength(encoded) > MAX_CONTENT_EVENT_BYTES) fail('content_size');
  return encoded;
}

function decodeContentEvent(encoded) {
  if (typeof encoded !== 'string' || utf8ByteLength(encoded) > MAX_CONTENT_EVENT_BYTES) fail('content_size');
  let parsed;
  try {
    parsed = JSON.parse(encoded);
  } catch {
    fail('content_json');
  }
  return normalizeContentEvent(parsed);
}

function normalizeEnvelopeAad(input) {
  const aad = assertPlainObject(input, 'aad');
  assertExactKeys(aad, new Set(['protocolVersion', 'threadId', 'senderAccountId', 'senderDeviceId', 'clientEnvelopeId', 'kind', 'epoch', 'operationId', 'rosterHash']), 'aad_keys');
  if (aad.protocolVersion !== CHAT_PROTOCOL_VERSION) fail('aad_version');
  if (!ENVELOPE_KINDS.has(aad.kind)) fail('aad_kind');
  if (typeof aad.epoch !== 'string' || !EPOCH_PATTERN.test(aad.epoch)) fail('aad_epoch');
  const operationId = aad.operationId === undefined || aad.operationId === null
    ? undefined
    : assertId(aad.operationId, 'aad_operation_id');
  const rosterHash = aad.rosterHash === undefined || aad.rosterHash === null
    ? undefined
    : (typeof aad.rosterHash === 'string' && /^[0-9a-f]{64}$/.test(aad.rosterHash)
      ? aad.rosterHash
      : fail('aad_roster_hash'));
  if (aad.kind === 'APPLICATION' && (operationId !== undefined || rosterHash !== undefined)) fail('aad_application_transition');
  if (aad.kind === 'COMMIT' && (operationId === undefined || rosterHash === undefined)) fail('aad_commit_transition');
  return {
    protocolVersion: CHAT_PROTOCOL_VERSION,
    threadId: assertId(aad.threadId, 'aad_thread_id'),
    senderAccountId: assertId(aad.senderAccountId, 'aad_sender_account_id'),
    senderDeviceId: assertId(aad.senderDeviceId, 'aad_sender_device_id'),
    clientEnvelopeId: assertId(aad.clientEnvelopeId, 'aad_client_envelope_id'),
    kind: aad.kind,
    epoch: aad.epoch,
    ...(operationId === undefined ? {} : { operationId }),
    ...(rosterHash === undefined ? {} : { rosterHash }),
  };
}

function canonicalEnvelopeAad(input) {
  const aad = normalizeEnvelopeAad(input);
  return JSON.stringify([
    'VOLNA-CHAT-AAD',
    aad.protocolVersion,
    aad.threadId,
    aad.senderAccountId,
    aad.senderDeviceId,
    aad.clientEnvelopeId,
    aad.kind,
    aad.epoch,
    aad.operationId ?? null,
    aad.rosterHash ?? null,
  ]);
}

function decodedBase64UrlLength(value, code = 'base64url') {
  if (typeof value !== 'string' || value.length === 0 || value.length % 4 === 1 || !BASE64URL_PATTERN.test(value)) fail(code);
  const remainder = value.length % 4;
  if (remainder !== 0) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const finalValue = alphabet.indexOf(value[value.length - 1]);
    if ((remainder === 2 && (finalValue & 0x0f) !== 0) || (remainder === 3 && (finalValue & 0x03) !== 0)) fail(code);
  }
  return Math.floor((value.length * 6) / 8);
}

function assertBase64Url(value, maxBytes, code) {
  const size = decodedBase64UrlLength(value, code);
  if (size === 0 || size > maxBytes) fail(code);
  return value;
}

function normalizeOpaqueEnvelopeInput(input) {
  const envelope = assertPlainObject(input, 'envelope');
  assertExactKeys(envelope, new Set(['protocolVersion', 'senderDeviceId', 'clientEnvelopeId', 'kind', 'epoch', 'ciphertext', 'operationId', 'rosterHash']), 'envelope_keys');
  if (envelope.protocolVersion !== CHAT_PROTOCOL_VERSION) fail('envelope_version');
  if (!ENVELOPE_KINDS.has(envelope.kind)) fail('envelope_kind');
  if (typeof envelope.epoch !== 'string' || !EPOCH_PATTERN.test(envelope.epoch)) fail('envelope_epoch');
  const operationId = envelope.operationId === undefined || envelope.operationId === null
    ? undefined
    : assertId(envelope.operationId, 'envelope_operation_id');
  const rosterHash = envelope.rosterHash === undefined || envelope.rosterHash === null
    ? undefined
    : (typeof envelope.rosterHash === 'string' && /^[0-9a-f]{64}$/.test(envelope.rosterHash)
      ? envelope.rosterHash
      : fail('envelope_roster_hash'));
  if (envelope.kind === 'APPLICATION' && (operationId !== undefined || rosterHash !== undefined)) fail('envelope_application_transition');
  if (envelope.kind === 'COMMIT' && (operationId === undefined || rosterHash === undefined)) fail('envelope_commit_transition');
  return {
    protocolVersion: CHAT_PROTOCOL_VERSION,
    senderDeviceId: assertId(envelope.senderDeviceId, 'envelope_sender_device_id'),
    clientEnvelopeId: assertId(envelope.clientEnvelopeId, 'envelope_client_id'),
    kind: envelope.kind,
    epoch: envelope.epoch,
    ciphertext: assertBase64Url(envelope.ciphertext, MAX_ENVELOPE_CIPHERTEXT_BYTES, 'envelope_ciphertext'),
    ...(operationId === undefined ? {} : { operationId }),
    ...(rosterHash === undefined ? {} : { rosterHash }),
  };
}

function normalizeTransferDeviceDraft(input) {
  const draft = assertPlainObject(input, 'transfer_device_draft');
  assertExactKeys(draft, new Set([
    'accountId',
    'deviceId',
    'platform',
    'displayName',
    'credential',
    'signaturePublicKey',
    'accountIdentityPublicKey',
    'capabilities',
  ]), 'transfer_device_draft_keys');
  if (!DEVICE_PLATFORMS.has(draft.platform)) fail('transfer_device_platform');
  const displayName = assertRequiredString(draft.displayName, 80, 'transfer_device_display_name').trim();
  if (!displayName) fail('transfer_device_display_name');
  if (!Array.isArray(draft.capabilities) || draft.capabilities.length === 0 || draft.capabilities.length > 16) {
    fail('transfer_device_capabilities');
  }
  return {
    accountId: assertId(draft.accountId, 'transfer_account_id'),
    deviceId: assertId(draft.deviceId, 'transfer_device_id'),
    platform: draft.platform,
    displayName,
    credential: assertBase64Url(draft.credential, MAX_DEVICE_CREDENTIAL_BYTES, 'transfer_device_credential'),
    signaturePublicKey: assertBase64Url(draft.signaturePublicKey, MAX_DEVICE_SIGNATURE_KEY_BYTES, 'transfer_device_signature_key'),
    accountIdentityPublicKey: assertBase64Url(draft.accountIdentityPublicKey, MAX_DEVICE_SIGNATURE_KEY_BYTES, 'transfer_account_identity_key'),
    capabilities: [...new Set(draft.capabilities.map((value) => assertRequiredString(value, 80, 'transfer_device_capability')))].sort(),
  };
}

function canonicalTransferDeviceDraft(input) {
  const draft = normalizeTransferDeviceDraft(input);
  return JSON.stringify([
    'VOLNA-CHAT-TRANSFER-DEVICE',
    CHAT_PROTOCOL_VERSION,
    draft.accountId,
    draft.deviceId,
    draft.platform,
    draft.displayName,
    draft.credential,
    draft.signaturePublicKey,
    draft.accountIdentityPublicKey,
    draft.capabilities,
  ]);
}

function normalizeDeviceTransferSessionInput(input) {
  const session = assertPlainObject(input, 'transfer_session');
  assertExactKeys(session, new Set([
    'protocolVersion',
    'targetDeviceId',
    'targetEphemeralPublicKey',
    'targetDraftHash',
    'targetDeviceDraft',
  ]), 'transfer_session_keys');
  if (session.protocolVersion !== CHAT_PROTOCOL_VERSION) fail('transfer_session_version');
  if (typeof session.targetDraftHash !== 'string' || !/^[0-9a-f]{64}$/.test(session.targetDraftHash)) {
    fail('transfer_draft_hash');
  }
  const targetDeviceDraft = normalizeTransferDeviceDraft(session.targetDeviceDraft);
  const targetDeviceId = assertId(session.targetDeviceId, 'transfer_target_device_id');
  if (targetDeviceDraft.deviceId !== targetDeviceId) fail('transfer_target_device_binding');
  return {
    protocolVersion: CHAT_PROTOCOL_VERSION,
    targetDeviceId,
    targetEphemeralPublicKey: assertBase64Url(session.targetEphemeralPublicKey, 32, 'transfer_target_ephemeral_key'),
    targetDraftHash: session.targetDraftHash,
    targetDeviceDraft,
  };
}

function normalizeDeviceTransferSourceInput(input) {
  const source = assertPlainObject(input, 'transfer_source');
  assertExactKeys(source, new Set([
    'protocolVersion',
    'sourceDeviceId',
    'sourceEphemeralPublicKey',
  ]), 'transfer_source_keys');
  if (source.protocolVersion !== CHAT_PROTOCOL_VERSION) fail('transfer_source_version');
  if (decodedBase64UrlLength(source.sourceEphemeralPublicKey, 'transfer_source_ephemeral_key') !== 32) {
    fail('transfer_source_ephemeral_key');
  }
  return {
    protocolVersion: CHAT_PROTOCOL_VERSION,
    sourceDeviceId: assertId(source.sourceDeviceId, 'transfer_source_device_id'),
    sourceEphemeralPublicKey: source.sourceEphemeralPublicKey,
  };
}

function normalizeDeviceTransferChunkInput(input) {
  const chunk = assertPlainObject(input, 'transfer_chunk');
  assertExactKeys(chunk, new Set([
    'protocolVersion',
    'sourceDeviceId',
    'sequence',
    'previousHash',
    'payload',
    'payloadHash',
    'ciphertextBytes',
  ]), 'transfer_chunk_keys');
  if (chunk.protocolVersion !== CHAT_PROTOCOL_VERSION) fail('transfer_chunk_version');
  if (!Number.isSafeInteger(chunk.sequence) || chunk.sequence < 0 || chunk.sequence >= MAX_TRANSFER_CHUNKS) {
    fail('transfer_chunk_sequence');
  }
  const previousHash = chunk.previousHash === null
    ? null
    : (typeof chunk.previousHash === 'string' && /^[0-9a-f]{64}$/.test(chunk.previousHash)
      ? chunk.previousHash
      : fail('transfer_chunk_previous_hash'));
  if (typeof chunk.payloadHash !== 'string' || !/^[0-9a-f]{64}$/.test(chunk.payloadHash)) {
    fail('transfer_chunk_payload_hash');
  }
  if (
    !Number.isSafeInteger(chunk.ciphertextBytes)
    || chunk.ciphertextBytes < 16
    || chunk.ciphertextBytes > MAX_TRANSFER_CHUNK_BYTES + 16
  ) fail('transfer_chunk_ciphertext_size');
  return {
    protocolVersion: CHAT_PROTOCOL_VERSION,
    sourceDeviceId: assertId(chunk.sourceDeviceId, 'transfer_chunk_source_device_id'),
    sequence: chunk.sequence,
    previousHash,
    payload: assertBase64Url(chunk.payload, MAX_TRANSFER_WIRE_PAYLOAD_BYTES, 'transfer_chunk_payload'),
    payloadHash: chunk.payloadHash,
    ciphertextBytes: chunk.ciphertextBytes,
  };
}

function normalizeTransferManifest(input) {
  const manifest = assertPlainObject(input, 'transfer_manifest');
  assertExactKeys(manifest, new Set([
    'v',
    'chunkCount',
    'finalChunkHash',
    'totalCiphertextBytes',
  ]), 'transfer_manifest_keys');
  if (manifest.v !== CHAT_PROTOCOL_VERSION) fail('transfer_manifest_version');
  if (
    !Number.isSafeInteger(manifest.chunkCount)
    || manifest.chunkCount < 0
    || manifest.chunkCount > MAX_TRANSFER_CHUNKS
  ) fail('transfer_manifest_chunks');
  const finalChunkHash = manifest.chunkCount === 0
    ? (manifest.finalChunkHash === null ? null : fail('transfer_manifest_hash'))
    : (typeof manifest.finalChunkHash === 'string' && /^[0-9a-f]{64}$/.test(manifest.finalChunkHash)
      ? manifest.finalChunkHash
      : fail('transfer_manifest_hash'));
  if (
    !Number.isSafeInteger(manifest.totalCiphertextBytes)
    || manifest.totalCiphertextBytes < 0
    || manifest.totalCiphertextBytes > MAX_TRANSFER_TOTAL_BYTES + 16 * MAX_TRANSFER_CHUNKS
  ) fail('transfer_manifest_size');
  return {
    v: CHAT_PROTOCOL_VERSION,
    chunkCount: manifest.chunkCount,
    finalChunkHash,
    totalCiphertextBytes: manifest.totalCiphertextBytes,
  };
}

function normalizeDeviceTransferApprovalInput(input) {
  const approval = assertPlainObject(input, 'transfer_approval');
  assertExactKeys(approval, new Set([
    'protocolVersion',
    'sourceDeviceId',
    'sourceEphemeralPublicKey',
    'approvalPayload',
    'approvalPayloadHash',
    'manifest',
    'retireSourceDevice',
  ]), 'transfer_approval_keys');
  const source = normalizeDeviceTransferSourceInput({
    protocolVersion: approval.protocolVersion,
    sourceDeviceId: approval.sourceDeviceId,
    sourceEphemeralPublicKey: approval.sourceEphemeralPublicKey,
  });
  if (typeof approval.approvalPayloadHash !== 'string' || !/^[0-9a-f]{64}$/.test(approval.approvalPayloadHash)) {
    fail('transfer_approval_payload_hash');
  }
  if (typeof approval.retireSourceDevice !== 'boolean') fail('transfer_retire_source');
  return {
    ...source,
    approvalPayload: assertBase64Url(
      approval.approvalPayload,
      MAX_TRANSFER_WIRE_PAYLOAD_BYTES,
      'transfer_approval_payload',
    ),
    approvalPayloadHash: approval.approvalPayloadHash,
    manifest: normalizeTransferManifest(approval.manifest),
    retireSourceDevice: approval.retireSourceDevice,
  };
}

function canonicalMlsRoster(input) {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_ACTIVE_DEVICES_PER_ACCOUNT * 2) {
    fail('mls_roster');
  }
  const members = input.map((memberValue) => {
    const member = assertPlainObject(memberValue, 'mls_roster_member');
    assertExactKeys(member, new Set([
      'accountId',
      'deviceId',
      'signaturePublicKey',
      'accountIdentityKeyHash',
    ]), 'mls_roster_member_keys');
    if (decodedBase64UrlLength(member.signaturePublicKey, 'mls_roster_signature_key') !== 32) {
      fail('mls_roster_signature_key');
    }
    if (decodedBase64UrlLength(member.accountIdentityKeyHash, 'mls_roster_identity_hash') !== 32) {
      fail('mls_roster_identity_hash');
    }
    return {
      accountId: assertId(member.accountId, 'mls_roster_account_id'),
      deviceId: assertId(member.deviceId, 'mls_roster_device_id'),
      signaturePublicKey: member.signaturePublicKey,
      accountIdentityKeyHash: member.accountIdentityKeyHash,
    };
  }).sort((left, right) => left.deviceId.localeCompare(right.deviceId));
  if (new Set(members.map((member) => member.deviceId)).size !== members.length) fail('mls_roster_duplicate');
  return JSON.stringify([
    'VOLNA-CHAT-MLS-ROSTER',
    CHAT_PROTOCOL_VERSION,
    members.map((member) => [
      member.accountId,
      member.deviceId,
      member.signaturePublicKey,
      member.accountIdentityKeyHash,
    ]),
  ]);
}

function normalizeMlsRekeyCommit(input) {
  const commit = assertPlainObject(input, 'rekey_commit');
  assertExactKeys(commit, new Set([
    'protocolVersion',
    'senderDeviceId',
    'clientEnvelopeId',
    'operationId',
    'epoch',
    'rosterHash',
    'ciphertext',
    'claimIds',
    'welcomes',
  ]), 'rekey_commit_keys');
  if (commit.protocolVersion !== CHAT_PROTOCOL_VERSION) fail('rekey_version');
  if (typeof commit.epoch !== 'string' || !EPOCH_PATTERN.test(commit.epoch) || commit.epoch === '0') fail('rekey_epoch');
  if (typeof commit.rosterHash !== 'string' || !/^[0-9a-f]{64}$/.test(commit.rosterHash)) fail('rekey_roster_hash');
  if (!Array.isArray(commit.claimIds) || commit.claimIds.length > MAX_ACTIVE_DEVICES_PER_ACCOUNT * 2) fail('rekey_claims');
  const claimIds = commit.claimIds.map((value) => assertId(value, 'rekey_claim_id'));
  if (new Set(claimIds).size !== claimIds.length) fail('rekey_claims');
  if (!Array.isArray(commit.welcomes) || commit.welcomes.length !== claimIds.length) fail('rekey_welcomes');
  const welcomes = commit.welcomes.map((value) => {
    const welcome = assertPlainObject(value, 'rekey_welcome');
    assertExactKeys(welcome, new Set(['recipientDeviceId', 'payload']), 'rekey_welcome_keys');
    return {
      recipientDeviceId: assertId(welcome.recipientDeviceId, 'rekey_welcome_device_id'),
      payload: assertBase64Url(welcome.payload, MAX_WELCOME_BYTES, 'rekey_welcome_payload'),
    };
  });
  if (new Set(welcomes.map((welcome) => welcome.recipientDeviceId)).size !== welcomes.length) fail('rekey_welcomes');
  return {
    protocolVersion: CHAT_PROTOCOL_VERSION,
    senderDeviceId: assertId(commit.senderDeviceId, 'rekey_sender_device_id'),
    clientEnvelopeId: assertId(commit.clientEnvelopeId, 'rekey_client_envelope_id'),
    operationId: assertId(commit.operationId, 'rekey_operation_id'),
    epoch: commit.epoch,
    rosterHash: commit.rosterHash,
    ciphertext: assertBase64Url(commit.ciphertext, MAX_ENVELOPE_CIPHERTEXT_BYTES, 'rekey_ciphertext'),
    claimIds,
    welcomes,
  };
}

function normalizeDeviceRegistration(input) {
  const device = assertPlainObject(input, 'device');
  assertExactKeys(device, new Set(['challengeId', 'deviceId', 'platform', 'displayName', 'credential', 'signaturePublicKey', 'accountIdentityPublicKey', 'accountIdentitySignature', 'proofSignature', 'capabilities']), 'device_keys');
  if (!DEVICE_PLATFORMS.has(device.platform)) fail('device_platform');
  const displayName = assertRequiredString(device.displayName, 80, 'device_display_name').trim();
  if (!displayName) fail('device_display_name');
  if (!Array.isArray(device.capabilities) || device.capabilities.length === 0 || device.capabilities.length > 16) fail('device_capabilities');
  const capabilities = [...new Set(device.capabilities.map((value) => assertRequiredString(value, 80, 'device_capability')))];
  return {
    challengeId: assertId(device.challengeId, 'device_challenge_id'),
    deviceId: assertId(device.deviceId, 'device_id'),
    platform: device.platform,
    displayName,
    credential: assertBase64Url(device.credential, MAX_DEVICE_CREDENTIAL_BYTES, 'device_credential'),
    signaturePublicKey: assertBase64Url(device.signaturePublicKey, MAX_DEVICE_SIGNATURE_KEY_BYTES, 'device_signature_key'),
    accountIdentityPublicKey: assertBase64Url(device.accountIdentityPublicKey, MAX_DEVICE_SIGNATURE_KEY_BYTES, 'account_identity_key'),
    accountIdentitySignature: assertBase64Url(device.accountIdentitySignature, MAX_DEVICE_SIGNATURE_BYTES, 'account_identity_signature'),
    proofSignature: assertBase64Url(device.proofSignature, MAX_DEVICE_SIGNATURE_BYTES, 'device_proof_signature'),
    capabilities,
  };
}

function canonicalDeviceRegistrationProof(input) {
  const proof = assertPlainObject(input, 'device_proof');
  assertExactKeys(proof, new Set(['challengeId', 'challenge', 'accountId', 'deviceId', 'platform', 'displayName', 'credential', 'signaturePublicKey', 'accountIdentityPublicKey', 'accountIdentitySignature', 'capabilities']), 'device_proof_keys');
  if (!DEVICE_PLATFORMS.has(proof.platform)) fail('device_platform');
  const displayName = assertRequiredString(proof.displayName, 80, 'device_display_name').trim();
  if (!displayName) fail('device_display_name');
  if (!Array.isArray(proof.capabilities) || proof.capabilities.length === 0 || proof.capabilities.length > 16) fail('device_capabilities');
  const capabilities = [...new Set(proof.capabilities.map((value) => assertRequiredString(value, 80, 'device_capability')))].sort();
  return JSON.stringify([
    'VOLNA-CHAT-DEVICE-REGISTRATION',
    CHAT_PROTOCOL_VERSION,
    assertId(proof.challengeId, 'device_challenge_id'),
    assertBase64Url(proof.challenge, 64, 'device_challenge'),
    assertId(proof.accountId, 'device_account_id'),
    assertId(proof.deviceId, 'device_id'),
    proof.platform,
    displayName,
    assertBase64Url(proof.credential, MAX_DEVICE_CREDENTIAL_BYTES, 'device_credential'),
    assertBase64Url(proof.signaturePublicKey, MAX_DEVICE_SIGNATURE_KEY_BYTES, 'device_signature_key'),
    assertBase64Url(proof.accountIdentityPublicKey, MAX_DEVICE_SIGNATURE_KEY_BYTES, 'account_identity_key'),
    assertBase64Url(proof.accountIdentitySignature, MAX_DEVICE_SIGNATURE_BYTES, 'account_identity_signature'),
    capabilities,
  ]);
}

function canonicalDeviceAuthorization(input) {
  const authorization = assertPlainObject(input, 'device_authorization');
  assertExactKeys(authorization, new Set(['accountId', 'deviceId', 'platform', 'displayName', 'credential', 'signaturePublicKey', 'capabilities']), 'device_authorization_keys');
  if (!DEVICE_PLATFORMS.has(authorization.platform)) fail('device_platform');
  const displayName = assertRequiredString(authorization.displayName, 80, 'device_display_name').trim();
  if (!displayName) fail('device_display_name');
  if (!Array.isArray(authorization.capabilities) || authorization.capabilities.length === 0 || authorization.capabilities.length > 16) fail('device_capabilities');
  const capabilities = [...new Set(authorization.capabilities.map((value) => assertRequiredString(value, 80, 'device_capability')))].sort();
  return JSON.stringify([
    'VOLNA-CHAT-DEVICE-AUTHORIZATION',
    CHAT_PROTOCOL_VERSION,
    assertId(authorization.accountId, 'device_account_id'),
    assertId(authorization.deviceId, 'device_id'),
    authorization.platform,
    displayName,
    assertBase64Url(authorization.credential, MAX_DEVICE_CREDENTIAL_BYTES, 'device_credential'),
    assertBase64Url(authorization.signaturePublicKey, MAX_DEVICE_SIGNATURE_KEY_BYTES, 'device_signature_key'),
    capabilities,
  ]);
}

function normalizeKeyPackageUpload(input) {
  const upload = assertPlainObject(input, 'key_package_upload');
  assertExactKeys(upload, new Set(['deviceId', 'protocolVersion', 'ciphersuite', 'keyPackages']), 'key_package_upload_keys');
  if (upload.protocolVersion !== CHAT_PROTOCOL_VERSION) fail('key_package_version');
  if (upload.ciphersuite !== CHAT_CIPHERSUITE) fail('key_package_ciphersuite');
  if (!Array.isArray(upload.keyPackages) || upload.keyPackages.length === 0 || upload.keyPackages.length > 50) fail('key_package_count');
  const keyPackages = upload.keyPackages.map((value) => assertBase64Url(value, MAX_KEY_PACKAGE_BYTES, 'key_package'));
  if (new Set(keyPackages).size !== keyPackages.length) fail('key_package_duplicate');
  return {
    deviceId: assertId(upload.deviceId, 'key_package_device_id'),
    protocolVersion: CHAT_PROTOCOL_VERSION,
    ciphersuite: CHAT_CIPHERSUITE,
    keyPackages,
  };
}

function normalizeE2eeActivation(input) {
  const activation = assertPlainObject(input, 'activation');
  assertExactKeys(activation, new Set(['protocolVersion', 'senderDeviceId', 'groupId', 'epoch', 'claimIds', 'welcomes']), 'activation_keys');
  if (activation.protocolVersion !== CHAT_PROTOCOL_VERSION) fail('activation_version');
  if (typeof activation.epoch !== 'string' || activation.epoch !== '1') fail('activation_epoch');
  const groupBytes = decodedBase64UrlLength(activation.groupId, 'activation_group_id');
  if (groupBytes < 16 || groupBytes > 64) fail('activation_group_id');
  if (!Array.isArray(activation.claimIds) || activation.claimIds.length === 0 || activation.claimIds.length > MAX_ACTIVE_DEVICES_PER_ACCOUNT * 2 - 1) fail('activation_claims');
  const claimIds = activation.claimIds.map((value) => assertId(value, 'activation_claim_id'));
  if (new Set(claimIds).size !== claimIds.length) fail('activation_claims');
  if (!Array.isArray(activation.welcomes) || activation.welcomes.length !== claimIds.length) fail('activation_welcomes');
  const welcomes = activation.welcomes.map((value) => {
    const welcome = assertPlainObject(value, 'activation_welcome');
    assertExactKeys(welcome, new Set(['recipientDeviceId', 'payload']), 'activation_welcome_keys');
    return {
      recipientDeviceId: assertId(welcome.recipientDeviceId, 'activation_recipient_device_id'),
      payload: assertBase64Url(welcome.payload, MAX_WELCOME_BYTES, 'activation_welcome_payload'),
    };
  });
  if (new Set(welcomes.map((welcome) => welcome.recipientDeviceId)).size !== welcomes.length) fail('activation_welcomes');
  return {
    protocolVersion: CHAT_PROTOCOL_VERSION,
    senderDeviceId: assertId(activation.senderDeviceId, 'activation_sender_device_id'),
    groupId: activation.groupId,
    epoch: '1',
    claimIds,
    welcomes,
  };
}

function normalizeE2eeActivationRecovery(input) {
  const recovery = assertPlainObject(input, 'activation_recovery');
  assertExactKeys(recovery, new Set([
    'protocolVersion',
    'senderDeviceId',
    'previousGroupId',
    'groupId',
    'epoch',
    'claimIds',
    'welcomes',
  ]), 'activation_recovery_keys');
  const activation = normalizeE2eeActivation({
    protocolVersion: recovery.protocolVersion,
    senderDeviceId: recovery.senderDeviceId,
    groupId: recovery.groupId,
    epoch: recovery.epoch,
    claimIds: recovery.claimIds,
    welcomes: recovery.welcomes,
  });
  const previousGroupBytes = decodedBase64UrlLength(recovery.previousGroupId, 'activation_recovery_group');
  if (previousGroupBytes < 16 || previousGroupBytes > 64 || recovery.previousGroupId === activation.groupId) {
    fail('activation_recovery_group');
  }
  return { ...activation, previousGroupId: recovery.previousGroupId };
}

function utf8ByteLength(value) {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
}

module.exports = {
  CHAT_CIPHERSUITE,
  CHAT_PROTOCOL_VERSION,
  MAX_ACTIVE_DEVICES_PER_ACCOUNT,
  MAX_TOTAL_DEVICES_PER_ACCOUNT,
  MAX_CHAT_TEXT_CHARS,
  MAX_CONTENT_EVENT_BYTES,
  MAX_DEVICE_CREDENTIAL_BYTES,
  MAX_DEVICE_SIGNATURE_BYTES,
  MAX_DEVICE_SIGNATURE_KEY_BYTES,
  MAX_ENVELOPE_CIPHERTEXT_BYTES,
  MAX_WELCOME_BYTES,
  MAX_KEY_PACKAGE_BYTES,
  MAX_KEY_PACKAGES_PER_DEVICE,
  MAX_TRANSFER_CHUNK_BYTES,
  MAX_TRANSFER_CHUNKS,
  MAX_TRANSFER_TOTAL_BYTES,
  MAX_TRANSFER_WIRE_PAYLOAD_BYTES,
  MessagingContractError,
  canonicalDeviceAuthorization,
  canonicalDeviceRegistrationProof,
  canonicalTransferDeviceDraft,
  canonicalMlsRoster,
  canonicalEnvelopeAad,
  decodeContentEvent,
  decodedBase64UrlLength,
  encodeContentEvent,
  normalizeContentEvent,
  normalizeDeviceRegistration,
  normalizeDeviceTransferApprovalInput,
  normalizeDeviceTransferChunkInput,
  normalizeDeviceTransferSessionInput,
  normalizeDeviceTransferSourceInput,
  normalizeE2eeActivation,
  normalizeE2eeActivationRecovery,
  normalizeEnvelopeAad,
  normalizeKeyPackageUpload,
  normalizeOpaqueEnvelopeInput,
  normalizeMlsRekeyCommit,
  normalizeTransferManifest,
  normalizeTransferDeviceDraft,
  utf8ByteLength,
};
