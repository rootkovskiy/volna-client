import contract from './index.js';
import {
  createDeviceTransferSource,
  createDeviceTransferTarget,
  parseDeviceTransferQr,
  validateTransferManifest,
} from './device-transfer.mjs';
import { MessageProjection, MessageProjectionError } from './message-projection.mjs';
import { mlsRosterHash } from './mls-runtime.mjs';

const {
  CHAT_PROTOCOL_VERSION,
  MAX_TRANSFER_CHUNK_BYTES,
  MAX_TRANSFER_CHUNKS,
  canonicalEnvelopeAad,
  normalizeContentEvent,
  normalizeDeviceTransferChunkInput,
  utf8ByteLength,
} = contract;

const CLIENT_STATE_VERSION = 1;
const ID_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;
const MAX_PROCESSED_ENVELOPES_PER_THREAD = 20_000;
const MAX_SYNC_ENVELOPES = 5_000;
const TRANSPARENCY_ACTIVATION_TIMEOUT_MS = 20_000;

export class SecureMessagingClientError extends Error {
  constructor(code, cause) {
    super(`VOLNA secure messaging client error (${code})`, cause === undefined ? undefined : { cause });
    this.name = 'SecureMessagingClientError';
    this.code = code;
  }
}

function fail(code, cause) {
  throw new SecureMessagingClientError(code, cause);
}

function object(value, code) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(code);
  return value;
}

function id(value, code) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) fail(code);
  return value;
}

function initialApplicationState() {
  return {
    v: CLIENT_STATE_VERSION,
    deviceRegistered: false,
    pendingRecoverySecretForDisplay: null,
    threads: {},
    pendingActivations: {},
    pendingRekeys: {},
    pendingOutbox: {},
    incomingTransfer: null,
    outgoingTransfers: {},
  };
}

function normalizeApplicationState(value) {
  if (value === null) return initialApplicationState();
  const state = object(value, 'client_state');
  if (state.v !== CLIENT_STATE_VERSION) fail('client_state_version');
  return {
    v: CLIENT_STATE_VERSION,
    deviceRegistered: state.deviceRegistered === true,
    pendingRecoverySecretForDisplay: state.pendingRecoverySecretForDisplay === undefined
      || state.pendingRecoverySecretForDisplay === null
      ? null
      : typeof state.pendingRecoverySecretForDisplay === 'string'
        && /^[A-Za-z0-9_-]{43}$/.test(state.pendingRecoverySecretForDisplay)
        ? state.pendingRecoverySecretForDisplay
        : fail('client_pending_recovery_secret'),
    threads: object(state.threads, 'client_threads'),
    pendingActivations: object(state.pendingActivations, 'client_activations'),
    pendingRekeys: state.pendingRekeys === undefined ? {} : object(state.pendingRekeys, 'client_rekeys'),
    pendingOutbox: object(state.pendingOutbox, 'client_outbox'),
    incomingTransfer: state.incomingTransfer === undefined || state.incomingTransfer === null
      ? null
      : object(state.incomingTransfer, 'client_incoming_transfer'),
    outgoingTransfers: state.outgoingTransfers === undefined ? {} : object(state.outgoingTransfers, 'client_outgoing_transfers'),
  };
}

function clone(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    fail('client_state_json', error);
  }
}

function utf8Decode(bytes) {
  if (!(bytes instanceof Uint8Array)) fail('utf8_bytes');
  let value = '';
  for (let index = 0; index < bytes.length;) {
    const first = bytes[index++];
    let point;
    if (first < 0x80) point = first;
    else if ((first & 0xe0) === 0xc0) {
      if (index >= bytes.length) fail('utf8_decode');
      const second = bytes[index++];
      if ((second & 0xc0) !== 0x80) fail('utf8_decode');
      point = ((first & 0x1f) << 6) | (second & 0x3f);
      if (point < 0x80) fail('utf8_decode');
    } else if ((first & 0xf0) === 0xe0) {
      if (index + 1 >= bytes.length) fail('utf8_decode');
      const second = bytes[index++];
      const third = bytes[index++];
      if ((second & 0xc0) !== 0x80 || (third & 0xc0) !== 0x80) fail('utf8_decode');
      point = ((first & 0x0f) << 12) | ((second & 0x3f) << 6) | (third & 0x3f);
      if (point < 0x800 || (point >= 0xd800 && point <= 0xdfff)) fail('utf8_decode');
    } else if ((first & 0xf8) === 0xf0) {
      if (index + 2 >= bytes.length) fail('utf8_decode');
      const second = bytes[index++];
      const third = bytes[index++];
      const fourth = bytes[index++];
      if ((second & 0xc0) !== 0x80 || (third & 0xc0) !== 0x80 || (fourth & 0xc0) !== 0x80) fail('utf8_decode');
      point = ((first & 0x07) << 18) | ((second & 0x3f) << 12) | ((third & 0x3f) << 6) | (fourth & 0x3f);
      if (point < 0x10000 || point > 0x10ffff) fail('utf8_decode');
    } else fail('utf8_decode');
    value += point <= 0xffff
      ? String.fromCharCode(point)
      : String.fromCharCode(0xd800 + ((point - 0x10000) >>> 10), 0xdc00 + ((point - 0x10000) & 0x3ff));
  }
  return value;
}

function createHistoryTransferPlan(applicationState) {
  return {
    v: 1,
    threads: Object.keys(applicationState.threads).sort().map((threadId) => {
      id(threadId, 'history_thread_id');
      const state = threadState(applicationState, threadId);
      return {
        threadId,
        envelopeIds: state.records.map((record) => id(record.envelopeId, 'history_envelope_id')),
      };
    }),
  };
}

function normalizeHistoryTransferPlan(value) {
  const plan = object(value, 'history_transfer_plan');
  if (Object.keys(plan).sort().join(',') !== 'threads,v' || plan.v !== 1 || !Array.isArray(plan.threads)) {
    fail('history_transfer_plan');
  }
  const seenThreads = new Set();
  const threads = plan.threads.map((threadValue) => {
    const thread = object(threadValue, 'history_transfer_plan_thread');
    if (
      Object.keys(thread).sort().join(',') !== 'envelopeIds,threadId'
      || !Array.isArray(thread.envelopeIds)
      || thread.envelopeIds.length > MAX_PROCESSED_ENVELOPES_PER_THREAD
    ) fail('history_transfer_plan_thread');
    const threadId = id(thread.threadId, 'history_thread_id');
    const envelopeIds = thread.envelopeIds.map((value) => id(value, 'history_envelope_id'));
    if (seenThreads.has(threadId) || new Set(envelopeIds).size !== envelopeIds.length) fail('history_transfer_plan_duplicate');
    seenThreads.add(threadId);
    return { threadId, envelopeIds };
  });
  if (threads.some((thread, index) => index > 0 && threads[index - 1].threadId >= thread.threadId)) {
    fail('history_transfer_plan_order');
  }
  return { v: 1, threads };
}

function threadState(applicationState, threadId) {
  const current = applicationState.threads[threadId];
  if (current !== undefined) {
    const value = object(current, 'client_thread_state');
    if (!Array.isArray(value.records) || !Array.isArray(value.processedEnvelopeIds)) fail('client_thread_state');
    return value;
  }
    const created = { records: [], processedEnvelopeIds: [], rejectedEnvelopeIds: [], envelopeCursor: null };
  applicationState.threads[threadId] = created;
  return created;
}

function mergeProjectionRecords(...recordSets) {
  const recordsByEnvelope = new Map();
  for (const recordsValue of recordSets) {
    if (!Array.isArray(recordsValue)) fail('client_thread_records');
    const records = new MessageProjection(recordsValue).exportRecords();
    for (const record of records) {
      const encoded = JSON.stringify(record);
      const previous = recordsByEnvelope.get(record.envelopeId);
      if (previous !== undefined && previous.encoded !== encoded) fail('client_thread_record_collision');
      recordsByEnvelope.set(record.envelopeId, { encoded, record });
    }
  }
  return new MessageProjection([...recordsByEnvelope.values()].map(({ record }) => record)).exportRecords();
}

function normalizedSearchText(value) {
  return typeof value === 'string'
    ? value.normalize('NFKC').toLocaleLowerCase('ru-RU')
    : '';
}

function searchableMessageText(message) {
  const values = [message.text];
  const attachment = message.attachment;
  if (attachment?.kind === 'music') values.push(attachment.title, attachment.artist);
  if (attachment?.kind === 'entity' && attachment.snapshot && typeof attachment.snapshot === 'object') {
    values.push(
      attachment.snapshot.name,
      attachment.snapshot.title,
      attachment.snapshot.username,
      attachment.snapshot.locationName,
    );
  }
  return normalizedSearchText(values.filter((value) => typeof value === 'string').join('\n'));
}

function sameIdentifierSet(first, second) {
  const left = [...first].sort();
  const right = [...second].sort();
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function randomIdentifier(randomBytes, prefix) {
  const bytes = randomBytes(18);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let encoded = '';
  let accumulator = 0;
  let bits = 0;
  for (const byte of bytes) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      encoded += alphabet[(accumulator >>> bits) & 0x3f];
      accumulator &= (1 << bits) - 1;
    }
  }
  if (bits > 0) encoded += alphabet[(accumulator << (6 - bits)) & 0x3f];
  bytes.fill(0);
  return `${prefix}_${encoded}`;
}

export function createSecureMessagingClient(options) {
  return new SecureMessagingClient(options);
}

export class SecureMessagingClient {
  constructor(optionsValue) {
    const options = object(optionsValue, 'client_options');
    this.accountId = id(options.accountId, 'account_id');
    this.deviceId = id(options.deviceId, 'device_id');
    if (typeof options.platform !== 'string' || typeof options.displayName !== 'string') fail('device_metadata');
    if (options.runtime === undefined || options.transport === undefined || options.storage === undefined) fail('client_dependencies');
    this.platform = options.platform;
    this.displayName = options.displayName;
    this.runtime = options.runtime;
    this.transport = options.transport;
    this.storage = options.storage;
    this.messageStore = object(options.storage.messageStore, 'message_store');
    if (
      typeof this.messageStore.loadAllThreads !== 'function'
      || typeof this.messageStore.saveAllThreads !== 'function'
      || typeof this.messageStore.clear !== 'function'
      || typeof this.messageStore.destroyMemory !== 'function'
    ) fail('message_store');
    this.applicationState = initialApplicationState();
    this.ready = false;
    this.listeners = new Set();
    this.activationRecoveryRetries = new Set();
    this.projectionChanges = new Map();
  }

  subscribe(listener) {
    if (typeof listener !== 'function') fail('listener');
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(change) {
    for (const listener of this.listeners) listener(change);
  }

  markProjectionChange(threadIdValue, mode) {
    const threadId = id(threadIdValue, 'thread_id');
    if (mode !== 'append' && mode !== 'replace') fail('projection_change_mode');
    if (mode === 'replace' || this.projectionChanges.get(threadId) === undefined) {
      this.projectionChanges.set(threadId, mode);
    }
  }

  async restore() {
    const encrypted = await this.storage.loadEncryptedState();
    if (encrypted === null) return { status: 'needs-setup' };
    await this.runtime.importEncryptedState({ wrappingKeyId: this.storage.wrappingKeyId, state: encrypted });
    const identityStatus = this.runtime.getIdentityStatus?.();
    if (identityStatus?.status === 'transfer-pending') {
      if (identityStatus.accountId !== this.accountId || identityStatus.deviceId !== this.deviceId) fail('restored_identity_scope');
      this.applicationState = normalizeApplicationState(this.runtime.getApplicationState());
      await this.restoreMessageProjections();
      return { status: 'transfer-pending', draft: this.runtime.getPendingTransferDeviceDraft() };
    }
    const identity = this.runtime.getIdentitySummary();
    if (identity.accountId !== this.accountId || identity.deviceId !== this.deviceId) fail('restored_identity_scope');
    this.applicationState = normalizeApplicationState(this.runtime.getApplicationState());
    await this.restoreMessageProjections();
    const capabilities = await this.transport.capabilities();
    if (!capabilities.enrollmentEnabled && !this.applicationState.deviceRegistered) fail('enrollment_disabled');
    if (!this.applicationState.deviceRegistered) {
      return { status: 'registration-pending', identity, rolloutEnabled: capabilities.rolloutEnabled };
    }
    await this.verifyOwnDirectory(identity);
    this.ready = true;
    if (this.applicationState.incomingTransfer?.phase === 'identity-complete') {
      this.applicationState.incomingTransfer = {
        transferId: id(this.applicationState.incomingTransfer.transferId, 'transfer_id'),
        phase: 'registered',
      };
      await this.persist();
    }
    if (capabilities.enrollmentEnabled) await this.replenishKeyPackages();
    if (capabilities.membershipRekeyEnabled) {
      await this.joinPendingWelcomes();
      await this.retryPendingRekeys();
    }
    if (capabilities.rolloutEnabled) {
      await this.retryPendingActivations();
      await this.retryPendingOutbox();
    }
    return { status: 'ready', identity, rolloutEnabled: capabilities.rolloutEnabled };
  }

  async restoreMessageProjections() {
    let stored;
    try {
      stored = object(await this.messageStore.loadAllThreads(), 'message_store_threads');
    } catch (error) {
      this.runtime.destroy();
      this.messageStore.destroyMemory();
      this.applicationState = initialApplicationState();
      fail('message_store_load_failed', error);
    }
    let migrationRequired = false;
    const threadIds = new Set([...Object.keys(this.applicationState.threads), ...Object.keys(stored)]);
    for (const threadIdValue of threadIds) {
      const threadId = id(threadIdValue, 'thread_id');
      const hadRuntimeThread = Object.prototype.hasOwnProperty.call(this.applicationState.threads, threadId);
      const local = threadState(this.applicationState, threadId);
      const legacyRecords = new MessageProjection(local.records).exportRecords();
      const storedRecords = stored[threadId] === undefined
        ? []
        : new MessageProjection(stored[threadId]).exportRecords();
      const merged = mergeProjectionRecords(storedRecords, legacyRecords);
      const projectionChanged = (
        legacyRecords.length > 0
        || stored[threadId] === undefined
        || JSON.stringify(merged) !== JSON.stringify(storedRecords)
      );
      if (projectionChanged) {
        migrationRequired = true;
        this.markProjectionChange(threadId, 'replace');
      } else if (!hadRuntimeThread) {
        migrationRequired = true;
      }
      local.records = merged;
    }
    if (migrationRequired) await this.persist();
  }

  async setupDevice({ recoverySecret } = {}) {
    if (this.ready) return {
      status: 'ready',
      identity: this.runtime.getIdentitySummary(),
      recoverySecret: this.applicationState.pendingRecoverySecretForDisplay ?? undefined,
    };
    const capabilities = await this.transport.capabilities();
    if (!capabilities.enrollmentEnabled) fail('enrollment_disabled');
    const directory = await this.transport.listOwnDevices();
    const existingIdentityStatus = this.runtime.getIdentityStatus?.();
    if (existingIdentityStatus?.status === 'ready') {
      const existingIdentity = this.runtime.getIdentitySummary();
      if (
        existingIdentity.accountId !== this.accountId
        || existingIdentity.deviceId !== this.deviceId
        || (directory.identity !== null && directory.identity.publicKey !== existingIdentity.accountIdentityPublicKey)
      ) fail('pending_registration_identity_mismatch');
      await this.completeRegistration();
      this.ready = true;
      await this.replenishKeyPackages();
      await this.persist();
      return {
        status: 'ready',
        identity: existingIdentity,
        recoverySecret: this.applicationState.pendingRecoverySecretForDisplay ?? undefined,
      };
    }
    if (directory.identity !== null && typeof recoverySecret !== 'string') {
      return {
        status: 'recovery-required',
        identityFingerprint: directory.identity.keyHash,
      };
    }
    const created = await this.runtime.createDeviceIdentity({
      accountId: this.accountId,
      deviceId: this.deviceId,
      platform: this.platform,
      displayName: this.displayName,
      capabilities: ['mls-v1'],
      ...(recoverySecret === undefined ? {} : { recoverySecret }),
    });
    if (directory.identity !== null && created.accountIdentityPublicKey !== directory.identity.publicKey) {
      this.runtime.destroy();
      fail('recovery_identity_mismatch');
    }
    this.applicationState = initialApplicationState();
    this.applicationState.pendingRecoverySecretForDisplay = created.recoverySecret ?? null;
    this.projectionChanges.clear();
    await this.persist();
    await this.completeRegistration();
    this.ready = true;
    await this.replenishKeyPackages();
    await this.persist();
    return {
      status: 'ready',
      identity: this.runtime.getIdentitySummary(),
      recoverySecret: created.recoverySecret,
    };
  }

  getPendingRecoverySecretForDisplay() {
    return this.applicationState.pendingRecoverySecretForDisplay;
  }

  async acknowledgeRecoverySecretSaved() {
    this.requireReady();
    if (this.applicationState.pendingRecoverySecretForDisplay === null) return { status: 'already-cleared' };
    this.applicationState.pendingRecoverySecretForDisplay = null;
    await this.persist();
    return { status: 'cleared' };
  }

  async prepareIncomingDeviceTransfer() {
    if (this.ready) fail('client_already_ready');
    const capabilities = await this.transport.capabilities();
    if (!capabilities.enrollmentEnabled) fail('enrollment_disabled');
    const directory = await this.transport.listOwnDevices();
    if (directory.identity === null) fail('transfer_identity_missing');
    const draft = await this.runtime.createPendingTransferDeviceIdentity({
      accountId: this.accountId,
      deviceId: this.deviceId,
      platform: this.platform,
      displayName: this.displayName,
      capabilities: ['mls-v1', 'transfer-v1'],
      accountIdentityPublicKey: directory.identity.publicKey,
    });
    this.applicationState = initialApplicationState();
    this.projectionChanges.clear();
    await this.persist();
    return { status: 'transfer-pending', draft };
  }

  async startIncomingDeviceTransfer() {
    if (this.ready) fail('client_already_ready');
    const capabilities = await this.transport.capabilities();
    if (!capabilities.deviceTransferEnabled) fail('device_transfer_disabled');
    let pending = this.applicationState.incomingTransfer;
    let target;
    if (pending === null) {
      const identityStatus = this.runtime.getIdentityStatus?.();
      const prepared = identityStatus?.status === 'transfer-pending'
        ? { draft: this.runtime.getPendingTransferDeviceDraft() }
        : await this.prepareIncomingDeviceTransfer();
      target = createDeviceTransferTarget({
        randomBytes: this.storage.randomBytes,
        targetDeviceDraft: prepared.draft,
      });
      const session = await this.transport.createDeviceTransfer(target.createSessionInput());
      const bound = target.bindSession(session.id);
      pending = {
        transferId: session.id,
        phase: 'waiting-source',
        targetState: bound.state,
      };
      this.applicationState.incomingTransfer = pending;
      await this.persist();
      target.destroy();
      return { status: 'waiting-source', session, qrPayload: bound.qrPayload };
    }
    if (pending.phase === 'registered' || pending.phase === 'identity-complete') {
      return { status: 'registered', transferId: id(pending.transferId, 'transfer_id') };
    }
    target = createDeviceTransferTarget({ randomBytes: this.storage.randomBytes, state: pending.targetState });
    const session = await this.transport.getDeviceTransfer(id(pending.transferId, 'transfer_id'));
    const bound = target.bindSession(session.id);
    target.destroy();
    return { status: pending.phase, session, qrPayload: bound.qrPayload };
  }

  async pollIncomingDeviceTransfer() {
    const pending = this.applicationState.incomingTransfer;
    if (pending === null) fail('incoming_transfer_missing');
    const transferId = id(pending.transferId, 'transfer_id');
    if (pending.phase === 'registered') return this.continueIncomingDeviceTransfer();
    if (pending.phase === 'identity-complete') {
      await this.completeRegistration();
      this.ready = true;
      await this.replenishKeyPackages();
      this.applicationState.incomingTransfer = { transferId, phase: 'registered' };
      await this.persist();
      return { status: 'registered', transferId };
    }
    const target = createDeviceTransferTarget({ randomBytes: this.storage.randomBytes, state: pending.targetState });
    try {
      const session = await this.transport.getDeviceTransfer(transferId);
      if (session.status === 'CANCELLED' || session.status === 'EXPIRED') fail('incoming_transfer_expired');
      if (session.sourceDeviceId === null || session.sourceEphemeralPublicKey === null) {
        return { status: 'waiting-source', session };
      }
      const channel = target.connect(session, session.sourceEphemeralPublicKey);
      if (session.status === 'PENDING') {
        pending.phase = 'confirm-code';
        await this.persist();
        return { status: 'confirm-code', verificationCode: channel.verificationCode, session };
      }
      if (session.status !== 'APPROVED' || session.approvalPayload === null || session.approvalPayloadHash === null) {
        fail('incoming_transfer_status');
      }
      const manifest = validateTransferManifest(session.manifest);
      const approval = target.decrypt(session.approvalPayload, {
        kind: 'approval',
        sequence: 0,
        previousHash: manifest.finalChunkHash,
        payloadHash: session.approvalPayloadHash,
      });
      const approvalText = utf8Decode(approval.plaintext);
      approval.plaintext.fill(0);
      let approvalObject;
      try {
        approvalObject = object(JSON.parse(approvalText), 'transfer_approval');
      } catch (error) {
        if (error instanceof SecureMessagingClientError) throw error;
        fail('transfer_approval', error);
      }
      if (
        approvalObject.sourceDeviceId !== session.sourceDeviceId
        || approvalObject.targetDeviceId !== this.deviceId
        || JSON.stringify(validateTransferManifest(approvalObject.manifest)) !== JSON.stringify(manifest)
      ) fail('transfer_approval_binding');
      let afterSequence = -1;
      let expectedPreviousHash = null;
      let importedChunkCount = 0;
      while (true) {
        const page = await this.transport.listDeviceTransferChunks(transferId, afterSequence);
        if (JSON.stringify(page.manifest) !== JSON.stringify(manifest)) fail('incoming_transfer_manifest_changed');
        for (const item of page.items) {
          if (item.sequence !== afterSequence + 1) fail('incoming_transfer_chunk_sequence');
          const decrypted = target.decrypt(item.payload, {
            kind: 'history',
            sequence: item.sequence,
            previousHash: expectedPreviousHash,
            payloadHash: item.payloadHash,
          });
          const historyChunk = utf8Decode(decrypted.plaintext);
          decrypted.plaintext.fill(0);
          this.importHistoryTransferChunk(historyChunk);
          importedChunkCount += 1;
          afterSequence = item.sequence;
          expectedPreviousHash = item.payloadHash;
        }
        if (page.nextAfterSequence === null) break;
        if (page.nextAfterSequence !== afterSequence) fail('incoming_transfer_chunk_cursor');
      }
      if (importedChunkCount !== manifest.chunkCount || expectedPreviousHash !== manifest.finalChunkHash) {
        fail('incoming_transfer_manifest');
      }
      await this.completeIncomingDeviceTransfer(approvalText);
      return {
        status: 'registered',
        verificationCode: channel.verificationCode,
        transferId,
      };
    } finally {
      target.destroy();
    }
  }

  async continueIncomingDeviceTransfer() {
    this.requireReady();
    const pending = this.applicationState.incomingTransfer;
    if (pending === null || pending.phase !== 'registered') fail('incoming_transfer_not_registered');
    const transferId = id(pending.transferId, 'transfer_id');
    await this.joinPendingWelcomes();
    let finalized = await this.transport.finalizeDeviceTransfer(transferId);
    if (finalized.rekeyRequiredThreadIds.length > 0) {
      const waitingForSource = [];
      for (const threadId of finalized.rekeyRequiredThreadIds) {
        try {
          this.runtime.getGroupState(threadId);
        } catch {
          waitingForSource.push(threadId);
          continue;
        }
        await this.reconcileThreadDevices(threadId);
      }
      if (waitingForSource.length > 0) {
        return { status: 'waiting-membership', transferId, threadIds: waitingForSource };
      }
      finalized = await this.transport.finalizeDeviceTransfer(transferId);
    }
    if (finalized.completed) {
      this.applicationState.incomingTransfer = null;
      await this.persist();
      return { status: 'completed', transferId };
    }
    return { status: 'rekeying', transferId, threadIds: finalized.rekeyRequiredThreadIds };
  }

  async startOutgoingDeviceTransfer(qrPayload, { retireSourceDevice = true } = {}) {
    this.requireReady();
    const capabilities = await this.transport.capabilities();
    if (!capabilities.deviceTransferEnabled) fail('device_transfer_disabled');
    if (typeof retireSourceDevice !== 'boolean') fail('transfer_retire_source');
    const qr = parseDeviceTransferQr(qrPayload);
    if (qr.accountId !== this.accountId || qr.targetDeviceId === this.deviceId) fail('transfer_qr_account');
    const session = await this.transport.getDeviceTransfer(qr.sessionId);
    const source = createDeviceTransferSource({ randomBytes: this.storage.randomBytes, qrPayload, session });
    try {
      const connected = await this.transport.connectDeviceTransferSource(session.id, {
        protocolVersion: CHAT_PROTOCOL_VERSION,
        sourceDeviceId: this.deviceId,
        sourceEphemeralPublicKey: source.publicState.sourceEphemeralPublicKey,
      });
      this.applicationState.outgoingTransfers[session.id] = {
        transferId: session.id,
        sourceState: source.exportState(),
        retireSourceDevice,
        phase: 'confirm-code',
        createdAt: new Date().toISOString(),
        nextSequence: 0,
        finalChunkHash: null,
        totalCiphertextBytes: 0,
        historyPlan: null,
        plannedChunkCount: null,
        inFlightChunk: null,
        approval: null,
      };
      await this.persist();
      return {
        status: 'confirm-code',
        transferId: session.id,
        targetDevice: connected.targetDeviceDraft,
        verificationCode: source.publicState.verificationCode,
      };
    } finally {
      source.destroy();
    }
  }

  async approveOutgoingDeviceTransfer(transferIdValue) {
    this.requireReady();
    const transferId = id(transferIdValue, 'transfer_id');
    const pending = object(this.applicationState.outgoingTransfers[transferId], 'outgoing_transfer');
    const source = createDeviceTransferSource({ randomBytes: this.storage.randomBytes, state: pending.sourceState });
    try {
      if (pending.historyPlan === null) {
        pending.historyPlan = createHistoryTransferPlan(this.applicationState);
        const plannedChunks = this.exportHistoryTransferChunks(pending.historyPlan);
        pending.plannedChunkCount = plannedChunks.length;
        await this.persist();
      }
      const chunks = this.exportHistoryTransferChunks(pending.historyPlan);
      if (pending.plannedChunkCount === null) {
        pending.plannedChunkCount = chunks.length;
        await this.persist();
      } else if (pending.plannedChunkCount !== chunks.length) fail('transfer_history_plan_changed');
      while (pending.nextSequence < chunks.length) {
        if (pending.inFlightChunk === null) {
          pending.inFlightChunk = source.encryptHistory(
            pending.nextSequence,
            chunks[pending.nextSequence],
            pending.finalChunkHash,
          );
          await this.persist();
        }
        const encrypted = object(pending.inFlightChunk, 'transfer_in_flight_chunk');
        const normalized = normalizeDeviceTransferChunkInput({
          protocolVersion: CHAT_PROTOCOL_VERSION,
          sourceDeviceId: this.deviceId,
          sequence: encrypted.sequence,
          previousHash: encrypted.previousHash,
          payload: encrypted.payload,
          payloadHash: encrypted.payloadHash,
          ciphertextBytes: encrypted.ciphertextBytes,
        });
        if (normalized.sequence !== pending.nextSequence || normalized.previousHash !== pending.finalChunkHash) {
          fail('transfer_in_flight_binding');
        }
        await this.transport.uploadDeviceTransferChunk(transferId, {
          ...normalized,
        });
        pending.nextSequence += 1;
        pending.finalChunkHash = normalized.payloadHash;
        pending.totalCiphertextBytes += normalized.ciphertextBytes;
        pending.inFlightChunk = null;
        await this.persist();
      }
      const manifest = validateTransferManifest({
        v: CHAT_PROTOCOL_VERSION,
        chunkCount: pending.nextSequence,
        finalChunkHash: pending.finalChunkHash,
        totalCiphertextBytes: pending.totalCiphertextBytes,
      });
      if (pending.approval === null) {
        const session = await this.transport.getDeviceTransfer(transferId);
        const plaintext = this.createOutgoingDeviceTransfer(session.targetDeviceDraft, manifest);
        pending.approval = source.encryptApproval(plaintext, manifest.finalChunkHash);
        await this.persist();
      }
      const approved = await this.transport.approveDeviceTransfer(transferId, {
        protocolVersion: CHAT_PROTOCOL_VERSION,
        sourceDeviceId: this.deviceId,
        sourceEphemeralPublicKey: source.publicState.sourceEphemeralPublicKey,
        approvalPayload: pending.approval.payload,
        approvalPayloadHash: pending.approval.payloadHash,
        manifest,
        retireSourceDevice: pending.retireSourceDevice,
      });
      pending.phase = 'waiting-target-registration';
      await this.persist();
      return {
        status: 'waiting-target-registration',
        transferId,
        verificationCode: source.publicState.verificationCode,
        session: approved,
      };
    } finally {
      source.destroy();
    }
  }

  async continueOutgoingDeviceTransfer(transferIdValue) {
    this.requireReady();
    const transferId = id(transferIdValue, 'transfer_id');
    const pending = object(this.applicationState.outgoingTransfers[transferId], 'outgoing_transfer');
    const session = await this.transport.getDeviceTransfer(transferId);
    if (session.status === 'APPROVED') return { status: 'waiting-target-registration', transferId };
    if (session.status === 'COMPLETED') {
      delete this.applicationState.outgoingTransfers[transferId];
      await this.persist();
      return { status: 'completed', transferId };
    }
    if (session.status !== 'TARGET_REGISTERED') fail('outgoing_transfer_status');
    const rekeyed = await this.reconcileAllRequiredRekeys();
    pending.phase = 'waiting-target-join';
    await this.persist();
    return { status: 'waiting-target-join', transferId, rekeyedThreadIds: rekeyed };
  }

  createOutgoingDeviceTransfer(targetDeviceDraft, manifestValue) {
    this.requireReady();
    const manifest = validateTransferManifest(manifestValue);
    const authorization = this.runtime.authorizeTransferredDevice(targetDeviceDraft);
    return JSON.stringify({
      ...authorization,
      createdAt: new Date().toISOString(),
      manifest: clone(manifest),
    });
  }

  exportHistoryTransferChunks(planValue = undefined) {
    this.requireReady();
    const chunks = [];
    const plan = planValue === undefined
      ? createHistoryTransferPlan(this.applicationState)
      : normalizeHistoryTransferPlan(planValue);
    for (const plannedThread of plan.threads) {
      const { threadId } = plannedThread;
      const local = threadState(this.applicationState, threadId);
      const currentRecords = new MessageProjection(local.records).exportRecords();
      const recordsByEnvelope = new Map(currentRecords.map((record) => [record.envelopeId, record]));
      const records = plannedThread.envelopeIds.map((envelopeId) => {
        const record = recordsByEnvelope.get(envelopeId);
        if (record === undefined) fail('history_transfer_record_missing');
        return record;
      });
      let batch = [];
      for (const record of records) {
        const candidate = JSON.stringify({ v: 1, threadId, records: [...batch, record] });
        if (utf8ByteLength(candidate) > MAX_TRANSFER_CHUNK_BYTES) {
          if (batch.length === 0) fail('history_record_too_large');
          chunks.push(JSON.stringify({ v: 1, threadId, records: batch }));
          batch = [record];
          if (utf8ByteLength(JSON.stringify({ v: 1, threadId, records: batch })) > MAX_TRANSFER_CHUNK_BYTES) {
            fail('history_record_too_large');
          }
        } else {
          batch.push(record);
        }
      }
      if (batch.length > 0) chunks.push(JSON.stringify({ v: 1, threadId, records: batch }));
      if (chunks.length > MAX_TRANSFER_CHUNKS) fail('history_transfer_too_large');
    }
    return chunks;
  }

  async completeIncomingDeviceTransfer(approvalValue, historyChunks = []) {
    if (this.ready) fail('client_already_ready');
    const approval = typeof approvalValue === 'string'
      ? (() => {
          try { return object(JSON.parse(approvalValue), 'transfer_approval'); } catch (error) { fail('transfer_approval', error); }
        })()
      : object(approvalValue, 'transfer_approval');
    if (
      Object.keys(approval).sort().join(',') !== 'accountIdentitySignature,createdAt,manifest,recoverySecret,sourceDeviceId,targetDeviceId,v'
      || typeof approval.createdAt !== 'string'
      || !Number.isFinite(Date.parse(approval.createdAt))
      || approval.v !== 1
      || approval.targetDeviceId !== this.deviceId
      || typeof approval.sourceDeviceId !== 'string'
      || typeof approval.recoverySecret !== 'string'
      || typeof approval.accountIdentitySignature !== 'string'
      || !Array.isArray(historyChunks)
      || historyChunks.length > MAX_TRANSFER_CHUNKS
    ) fail('transfer_approval');
    id(approval.sourceDeviceId, 'transfer_source_device_id');
    validateTransferManifest(approval.manifest);
    this.runtime.completeTransferredDeviceIdentity({
      recoverySecret: approval.recoverySecret,
      accountIdentitySignature: approval.accountIdentitySignature,
    });
    for (const chunk of historyChunks) this.importHistoryTransferChunk(chunk);
    if (this.applicationState.incomingTransfer !== null) {
      this.applicationState.incomingTransfer = {
        transferId: id(this.applicationState.incomingTransfer.transferId, 'transfer_id'),
        phase: 'identity-complete',
      };
    }
    await this.persist();
    await this.completeRegistration();
    this.ready = true;
    await this.replenishKeyPackages();
    if (this.applicationState.incomingTransfer?.phase === 'identity-complete') {
      this.applicationState.incomingTransfer = {
        transferId: id(this.applicationState.incomingTransfer.transferId, 'transfer_id'),
        phase: 'registered',
      };
    }
    await this.persist();
    return { status: 'ready', identity: this.runtime.getIdentitySummary(), sourceDeviceId: approval.sourceDeviceId };
  }

  importHistoryTransferChunk(chunkValue) {
    let chunk;
    try {
      chunk = object(JSON.parse(typeof chunkValue === 'string' ? chunkValue : String(chunkValue)), 'history_chunk');
    } catch (error) {
      if (error instanceof SecureMessagingClientError) throw error;
      fail('history_chunk', error);
    }
    if (Object.keys(chunk).sort().join(',') !== 'records,threadId,v' || chunk.v !== 1 || !Array.isArray(chunk.records)) {
      fail('history_chunk');
    }
    const threadId = id(chunk.threadId, 'history_thread_id');
    const local = threadState(this.applicationState, threadId);
    const recordsByEnvelope = new Map(local.records.map((record) => [record.envelopeId, record]));
    for (const record of chunk.records) {
      const normalized = new MessageProjection([record]).exportRecords()[0];
      const existing = recordsByEnvelope.get(normalized.envelopeId);
      if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(normalized)) fail('history_record_collision');
      recordsByEnvelope.set(normalized.envelopeId, normalized);
    }
    const merged = [...recordsByEnvelope.values()].sort((left, right) => {
      const dateOrder = Date.parse(left.serverCreatedAt) - Date.parse(right.serverCreatedAt);
      return dateOrder === 0 ? left.envelopeId.localeCompare(right.envelopeId) : dateOrder;
    });
    const projection = new MessageProjection(merged);
    local.records = projection.exportRecords();
    this.markProjectionChange(threadId, 'replace');
    local.processedEnvelopeIds = [...new Set([
      ...local.processedEnvelopeIds,
      ...chunk.records.map((record) => id(record.envelopeId, 'history_envelope_id')),
    ])].slice(-MAX_PROCESSED_ENVELOPES_PER_THREAD);
  }

  async completeRegistration() {
    const identity = this.runtime.getIdentitySummary();
    const challenge = await this.transport.createDeviceChallenge();
    const registration = this.runtime.signDeviceRegistrationChallenge(challenge);
    const registered = await this.transport.registerDevice(registration);
    if (
      registered.identity.accountId !== this.accountId
      || registered.identity.publicKey !== identity.accountIdentityPublicKey
      || registered.device.id !== this.deviceId
    ) fail('registration_response_binding');
    const registrationStatus = registered.device.status ?? 'ACTIVE';
    if (registrationStatus === 'PENDING_TRANSPARENCY') {
      await this.waitForTransparencyActivation();
    } else if (registrationStatus !== 'ACTIVE') {
      fail('registration_device_inactive');
    }
    await this.verifyOwnDirectory(identity);
    this.applicationState.deviceRegistered = true;
    await this.persist();
  }

  async waitForTransparencyActivation() {
    if (typeof this.transport.getDeviceTransparencyStatus !== 'function') fail('transparency_status_missing');
    const deadline = Date.now() + TRANSPARENCY_ACTIVATION_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const status = await this.transport.getDeviceTransparencyStatus(this.deviceId);
      if (status.status === 'ACTIVE') return;
      if (status.status === 'REVOKED') fail('transparency_device_revoked');
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      const waitMs = Math.min(status.retryAfterMs ?? 750, remaining);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    fail('transparency_activation_timeout');
  }

  async verifyOwnDirectory(identity = this.runtime.getIdentitySummary()) {
    const directory = await this.transport.getDirectory(this.accountId);
    if (
      directory.identity?.publicKey !== identity.accountIdentityPublicKey
      || !directory.devices.some((device) => device.id === this.deviceId && device.status === 'ACTIVE')
    ) fail('registration_directory_binding');
    if (typeof this.runtime.pinDirectoryVerification !== 'function') fail('directory_verifier_missing');
    return this.runtime.pinDirectoryVerification(directory.verification);
  }

  async getDeviceSecurityState() {
    const value = await this.transport.listOwnDevices();
    return {
      currentDeviceId: this.deviceId,
      identityFingerprint: value.identity?.keyHash ?? null,
      devices: value.devices,
    };
  }

  getLocalSecurityStatus() {
    if (this.ready) return { status: 'ready' };
    const identity = this.runtime.getIdentityStatus?.();
    if (identity?.status === 'transfer-pending') {
      return {
        status: 'transfer-pending',
        incomingTransferPhase: this.applicationState.incomingTransfer?.phase ?? null,
      };
    }
    if (identity?.status === 'ready' && !this.applicationState.deviceRegistered) {
      return { status: 'registration-pending' };
    }
    return { status: 'needs-setup' };
  }

  getThreadSecurityStatus(threadIdValue) {
    this.requireReady();
    const threadId = id(threadIdValue, 'thread_id');
    try {
      const group = this.runtime.getGroupState(threadId);
      return {
        status: 'secure',
        epoch: group.epoch,
        groupId: group.groupId,
        memberDeviceIds: group.members.map((member) => member.deviceId),
      };
    } catch (error) {
      if (error?.code === 'group_missing') return { status: 'unknown' };
      throw error;
    }
  }

  getPendingDeviceTransfers() {
    const outgoing = Object.values(this.applicationState.outgoingTransfers).map((value) => {
      const pending = object(value, 'outgoing_transfer');
      const transferId = id(pending.transferId, 'transfer_id');
      const source = createDeviceTransferSource({ randomBytes: this.storage.randomBytes, state: pending.sourceState });
      try {
        return {
          transferId,
          phase: typeof pending.phase === 'string' ? pending.phase : fail('outgoing_transfer_phase'),
          retireSourceDevice: pending.retireSourceDevice === true,
          verificationCode: source.publicState.verificationCode,
          createdAt: typeof pending.createdAt === 'string' && Number.isFinite(Date.parse(pending.createdAt))
            ? pending.createdAt
            : null,
        };
      } finally {
        source.destroy();
      }
    }).sort((left, right) => (left.createdAt ?? '').localeCompare(right.createdAt ?? ''));
    return {
      incoming: this.applicationState.incomingTransfer === null
        ? null
        : {
            transferId: id(this.applicationState.incomingTransfer.transferId, 'transfer_id'),
            phase: this.applicationState.incomingTransfer.phase,
          },
      outgoing,
    };
  }

  async cancelIncomingDeviceTransfer() {
    if (this.ready) fail('incoming_transfer_already_registered');
    const pending = this.applicationState.incomingTransfer;
    if (pending === null) fail('incoming_transfer_missing');
    const transferId = id(pending.transferId, 'transfer_id');
    await this.transport.cancelDeviceTransfer(transferId);
    this.runtime.destroy();
    this.applicationState = initialApplicationState();
    try {
      await this.storage.clear();
    } catch (error) {
      fail('state_clear_failed', error);
    }
    this.emit({ type: 'device-transfer-cancelled', transferId, direction: 'incoming' });
    return { status: 'cancelled', transferId };
  }

  async cancelOutgoingDeviceTransfer(transferIdValue) {
    this.requireReady();
    const transferId = id(transferIdValue, 'transfer_id');
    if (this.applicationState.outgoingTransfers[transferId] === undefined) fail('outgoing_transfer_missing');
    await this.transport.cancelDeviceTransfer(transferId);
    delete this.applicationState.outgoingTransfers[transferId];
    await this.persist();
    this.emit({ type: 'device-transfer-cancelled', transferId, direction: 'outgoing' });
    return { status: 'cancelled', transferId };
  }

  async revokeLinkedDevice(deviceIdValue) {
    this.requireReady();
    const deviceId = id(deviceIdValue, 'device_id');
    if (deviceId === this.deviceId) fail('cannot_revoke_current_device');
    const result = await this.transport.revokeDevice(deviceId);
    await this.reconcileAllRequiredRekeys();
    return result;
  }

  async verifyThreadDirectoryState(stateValue) {
    const state = object(stateValue, 'thread_directory_state');
    if (!Array.isArray(state.identities) || !Array.isArray(state.devices)) fail('thread_directory');
    const identities = new Map();
    for (const identity of state.identities) {
      const accountId = id(identity.accountId, 'thread_directory_account');
      if (identities.has(accountId)) fail('thread_directory_identity');
      identities.set(accountId, identity);
    }
    if (identities.size !== 2 || !identities.has(this.accountId)) fail('thread_directory_identity');
    if (typeof this.runtime.pinDirectoryVerification !== 'function') fail('directory_verifier_missing');

    const activeDevices = [];
    const directoryDevicesById = new Map();
    for (const [accountId, identity] of identities) {
      const directory = await this.transport.getDirectory(accountId);
      if (directory.identity?.publicKey !== identity.publicKey) fail('thread_directory_identity');
      this.runtime.pinDirectoryVerification(directory.verification);
      for (const device of directory.devices) {
        if (device.accountId !== accountId) fail('thread_directory_device');
        if (directoryDevicesById.has(device.id)) fail('thread_directory_device');
        directoryDevicesById.set(device.id, device);
        if (device.status === 'ACTIVE') activeDevices.push(device);
      }
    }
    const stateDevicesById = new Map();
    for (const device of state.devices) {
      const directoryDevice = directoryDevicesById.get(device.id);
      if (
        directoryDevice === undefined
        || stateDevicesById.has(device.id)
        || directoryDevice.accountId !== device.accountId
        || directoryDevice.status !== device.status
        || directoryDevice.credential !== device.credential
        || directoryDevice.signaturePublicKey !== device.signaturePublicKey
        || directoryDevice.accountIdentitySignature !== device.accountIdentitySignature
        || JSON.stringify([...(directoryDevice.capabilities ?? [])].sort()) !== JSON.stringify([...(device.capabilities ?? [])].sort())
      ) fail('thread_directory_device');
      stateDevicesById.set(device.id, directoryDevice);
    }
    if (
      activeDevices.some((device) => !stateDevicesById.has(device.id))
      || !directoryDevicesById.has(this.deviceId)
      || directoryDevicesById.get(this.deviceId).status !== 'ACTIVE'
    ) {
      fail('thread_directory_mismatch');
    }
    const currentMemberDevices = state.devices
      .filter((device) => device.isMember === true && device.removedAt === null)
      .map((device) => directoryDevicesById.get(device.id));
    if (currentMemberDevices.some((device) => device === undefined)) fail('thread_directory_member');
    const rosterHash = typeof state.targetRosterHash === 'string' ? mlsRosterHash(activeDevices) : null;
    if (typeof state.targetRosterHash === 'string' && state.targetRosterHash !== rosterHash) fail('thread_roster_hash');
    const rekeyRequired = !sameIdentifierSet(
      currentMemberDevices.map((device) => device.id),
      activeDevices.map((device) => device.id),
    );
    return {
      activeDevices,
      currentMemberDevices,
      devicesById: directoryDevicesById,
      stateDevicesById,
      rosterHash,
      rekeyRequired,
    };
  }

  async verifyRekeyOperationDirectory(operationValue) {
    const operation = object(operationValue, 'rekey_operation');
    if (!Array.isArray(operation.identities) || !Array.isArray(operation.devices) || !Array.isArray(operation.targetDeviceIds)) {
      fail('rekey_directory');
    }
    const identityByAccount = new Map(operation.identities.map((identity) => [
      id(identity.accountId, 'rekey_identity_account'),
      identity,
    ]));
    const targetMembers = [];
    for (const [accountId, identity] of identityByAccount) {
      const directory = await this.transport.getDirectory(accountId);
      if (directory.identity?.publicKey !== identity.publicKey) fail('rekey_identity');
      this.runtime.pinDirectoryVerification(directory.verification);
      for (const targetDeviceId of operation.targetDeviceIds) {
        const operationDevice = operation.devices.find((device) => device.id === targetDeviceId && device.accountId === accountId);
        if (operationDevice === undefined) continue;
        const directoryDevice = directory.devices.find((device) => device.id === targetDeviceId);
        if (
          directoryDevice === undefined
          || directoryDevice.credential !== operationDevice.credential
          || directoryDevice.signaturePublicKey !== operationDevice.signaturePublicKey
          || directoryDevice.accountIdentitySignature !== operationDevice.accountIdentitySignature
        ) fail('rekey_device_directory');
        targetMembers.push(directoryDevice);
      }
    }
    if (
      !sameIdentifierSet(targetMembers.map((device) => device.id), operation.targetDeviceIds)
      || mlsRosterHash(targetMembers) !== operation.rosterHash
    ) fail('rekey_roster');
    return targetMembers;
  }

  async replenishKeyPackages() {
    this.requireReady();
    const status = await this.transport.keyPackageStatus(this.deviceId);
    const needed = Math.max(0, Math.min(50, status.target - status.available));
    if (needed === 0) return status;
    const packages = await this.runtime.createKeyPackages(needed);
    await this.transport.uploadKeyPackages(this.deviceId, packages);
    await this.persist();
    return this.transport.keyPackageStatus(this.deviceId);
  }

  async reconcileAllRequiredRekeys() {
    this.requireReady();
    const required = await this.transport.listRequiredRekeys(this.deviceId);
    const completed = [];
    for (const item of required) {
      await this.reconcileThreadDevices(item.threadId);
      completed.push(item.threadId);
    }
    return completed;
  }

  async reconcileThreadDevices(threadIdValue) {
    this.requireReady();
    const threadId = id(threadIdValue, 'thread_id');
    const pending = this.applicationState.pendingRekeys[threadId];
    if (pending !== undefined) return this.finishPreparedRekey(threadId, pending);
    const state = await this.transport.getThreadState(threadId);
    if (state.encryptionMode !== 'MLS_V1') fail('rekey_thread_not_mls');
    const trusted = await this.verifyThreadDirectoryState(state);
    const localGroup = this.runtime.getGroupState(threadId);
    if (localGroup.groupId !== state.groupId || localGroup.epoch !== state.epoch) fail('rekey_local_epoch');
    const operation = await this.transport.prepareThreadRekey(threadId, this.deviceId);
    if (operation.required === false) return state;
    if (
      operation.senderDeviceId !== this.deviceId
      || operation.baseEpoch !== localGroup.epoch
      || operation.targetEpoch !== (BigInt(localGroup.epoch) + 1n).toString()
      || operation.rosterHash !== trusted.rosterHash
      || !sameIdentifierSet(operation.targetDeviceIds, trusted.activeDevices.map((device) => device.id))
      || !sameIdentifierSet(operation.addedDeviceIds, operation.claims.map((claim) => claim.recipientDeviceId))
    ) fail('rekey_operation_binding');
    const clientEnvelopeId = randomIdentifier(this.storage.randomBytes, 'envelope');
    const aad = canonicalEnvelopeAad({
      protocolVersion: CHAT_PROTOCOL_VERSION,
      threadId,
      senderAccountId: this.accountId,
      senderDeviceId: this.deviceId,
      clientEnvelopeId,
      kind: 'COMMIT',
      epoch: operation.targetEpoch,
      operationId: operation.id,
      rosterHash: operation.rosterHash,
    });
    const prepared = await this.runtime.prepareRekey({
      threadId,
      operationId: operation.id,
      baseEpoch: operation.baseEpoch,
      targetEpoch: operation.targetEpoch,
      rosterHash: operation.rosterHash,
      targetMembers: trusted.activeDevices,
      removeDeviceIds: operation.removedDeviceIds,
      claims: operation.claims,
      aad,
    });
    const body = {
      protocolVersion: CHAT_PROTOCOL_VERSION,
      senderDeviceId: this.deviceId,
      clientEnvelopeId,
      operationId: operation.id,
      epoch: prepared.epoch,
      rosterHash: prepared.rosterHash,
      ciphertext: prepared.ciphertext,
      claimIds: prepared.claimIds,
      welcomes: prepared.welcomes,
    };
    this.applicationState.pendingRekeys[threadId] = { operationId: operation.id, body };
    await this.persist();
    return this.finishPreparedRekey(threadId, this.applicationState.pendingRekeys[threadId]);
  }

  async finishPreparedRekey(threadId, pendingValue) {
    const pending = object(pendingValue, 'pending_rekey');
    const operationId = id(pending.operationId, 'rekey_operation_id');
    const prepared = this.runtime.getPreparedRekey(operationId);
    if (prepared === null || prepared.threadId !== threadId) fail('pending_rekey_state');
    try {
      const committed = await this.transport.commitThreadRekey(threadId, operationId, pending.body);
      return this.commitPreparedRekeyLocally(threadId, operationId, prepared, committed);
    } catch (error) {
      if (error?.status !== 409) throw error;
      let operation;
      try {
        operation = await this.transport.getThreadRekey(threadId, operationId);
      } catch {
        throw error;
      }
      if (operation.status === 'COMMITTED' || operation.status === 'READY') {
        const body = object(pending.body, 'pending_rekey_body');
        if (
          operation.envelope !== null
          && operation.envelope.clientEnvelopeId === body.clientEnvelopeId
          && operation.envelope.ciphertext === body.ciphertext
          && operation.envelope.operationId === operationId
          && operation.envelope.rosterHash === prepared.rosterHash
        ) return this.commitPreparedRekeyLocally(threadId, operationId, prepared, operation);
        throw error;
      }
      if (operation.status !== 'PREPARED' && operation.status !== 'EXPIRED' && operation.status !== 'ABORTED') {
        throw error;
      }
      if (operation.status === 'PREPARED') {
        await this.transport.abortThreadRekey(threadId, operationId, this.deviceId);
      }
      this.runtime.abortPreparedRekey(operationId);
      delete this.applicationState.pendingRekeys[threadId];
      await this.persist();
      return this.reconcileThreadDevices(threadId);
    }
  }

  async commitPreparedRekeyLocally(threadId, operationId, prepared, committedValue) {
    const committed = object(committedValue, 'rekey_commit_response');
    const envelope = committed.envelope === null ? null : object(committed.envelope, 'rekey_commit_envelope');
    if (
      committed.id !== operationId
      || committed.targetEpoch !== prepared.targetEpoch
      || committed.rosterHash !== prepared.rosterHash
      || envelope === null
      || envelope.operationId !== operationId
      || envelope.rosterHash !== prepared.rosterHash
    ) fail('rekey_commit_response');
    this.runtime.commitPreparedRekey(operationId);
    const local = threadState(this.applicationState, threadId);
    if (!local.processedEnvelopeIds.includes(envelope.id)) {
      local.processedEnvelopeIds.push(envelope.id);
      local.processedEnvelopeIds = local.processedEnvelopeIds.slice(-MAX_PROCESSED_ENVELOPES_PER_THREAD);
    }
    delete this.applicationState.pendingRekeys[threadId];
    await this.persist();
    this.emit({ type: 'thread-rekeyed', threadId, epoch: committed.targetEpoch });
    return committed;
  }

  async retryPendingRekeys() {
    this.requireReady();
    for (const threadId of Object.keys(this.applicationState.pendingRekeys)) {
      await this.finishPreparedRekey(threadId, this.applicationState.pendingRekeys[threadId]);
    }
  }

  async activateThread(threadIdValue) {
    this.requireReady();
    const threadId = id(threadIdValue, 'thread_id');
    const pending = this.applicationState.pendingActivations[threadId];
    if (pending !== undefined) return this.finishActivation(threadId, pending);
    const capabilities = await this.transport.capabilities();
    if (!capabilities.rolloutEnabled) fail('rollout_disabled');
    let current = await this.transport.getThreadState(threadId);
    let trustedDirectory = await this.verifyThreadDirectoryState(current);
    if (current.encryptionMode === 'MLS_V1') {
      if (current.initialActivationRecoveryAllowed === true) {
        await this.joinPendingWelcomes();
        const refreshed = await this.transport.getThreadState(threadId);
        if (refreshed.ready) return refreshed;
        if (refreshed.initialActivationRecoveryAllowed === true) {
          return this.recoverExpiredActivation(threadId, refreshed);
        }
        current = refreshed;
        trustedDirectory = await this.verifyThreadDirectoryState(current);
      }
      const local = this.runtime.getGroupState(threadId);
      if (local.groupId !== current.groupId) fail('thread_group_mismatch');
      if (!sameIdentifierSet(
        local.members.map((member) => member.deviceId),
        trustedDirectory.activeDevices.map((device) => device.id),
      )) return this.reconcileThreadDevices(threadId);
      return current;
    }
    const claimed = await this.transport.claimKeyPackages(threadId, this.deviceId);
    const expectedClaims = trustedDirectory.activeDevices.filter((device) => device.id !== this.deviceId);
    if (
      !sameIdentifierSet(claimed.claims.map((claim) => claim.recipientDeviceId), expectedClaims.map((device) => device.id))
      || claimed.claims.some((claim) => trustedDirectory.devicesById.get(claim.recipientDeviceId)?.accountId !== claim.recipientAccountId)
    ) fail('claim_directory_mismatch');
    const activation = await this.runtime.createGroup({ threadId, claims: claimed.claims });
    const body = { ...activation, senderDeviceId: this.deviceId };
    this.applicationState.pendingActivations[threadId] = body;
    await this.persist();
    return this.finishActivation(threadId, body);
  }

  async finishActivation(threadId, body) {
    const isRecovery = typeof body.previousGroupId === 'string';
    let state;
    try {
      state = isRecovery
        ? await this.transport.recoverThreadActivation(threadId, body)
        : await this.transport.activateThread(threadId, body);
    } catch (error) {
      if (error?.status !== 409) throw error;
      return this.resolveActivationConflict(threadId, body, error);
    }
    if (
      state.encryptionMode !== 'MLS_V1'
      || state.groupId !== body.groupId
      || state.epoch !== body.epoch
      || state.plaintextFallback !== false
    ) fail('activation_response_binding');
    delete this.applicationState.pendingActivations[threadId];
    await this.persist();
    this.emit({ type: isRecovery ? 'thread-activation-recovered' : 'thread-activated', threadId });
    if (!isRecovery && state.initialActivationRecoveryAllowed === true) {
      return this.recoverExpiredActivation(threadId, state);
    }
    return state;
  }

  async resolveActivationConflict(threadId, body, originalError) {
    let state;
    try {
      state = await this.transport.getThreadState(threadId);
    } catch {
      throw originalError;
    }
    if (
      state.encryptionMode === 'MLS_V1'
      && state.groupId === body.groupId
      && state.epoch === body.epoch
      && state.plaintextFallback === false
    ) {
      delete this.applicationState.pendingActivations[threadId];
      await this.persist();
      this.emit({
        type: typeof body.previousGroupId === 'string' ? 'thread-activation-recovered' : 'thread-activated',
        threadId,
      });
      if (typeof body.previousGroupId !== 'string' && state.initialActivationRecoveryAllowed === true) {
        return this.recoverExpiredActivation(threadId, state);
      }
      return state;
    }

    if (state.encryptionMode === 'LEGACY_PLAINTEXT' && typeof body.previousGroupId !== 'string') {
      this.discardInitialGroupCandidate(threadId, body.groupId, false);
      await this.persist();
      return this.activateThread(threadId);
    }

    if (
      state.encryptionMode === 'MLS_V1'
      && state.groupId !== body.groupId
      && state.epoch === '1'
      && state.plaintextFallback === false
    ) {
      this.discardInitialGroupCandidate(threadId, body.groupId, true);
      await this.persist();
      await this.joinPendingWelcomes();
      const local = this.runtime.getGroupState(threadId);
      if (local.groupId !== state.groupId || local.epoch !== state.epoch) fail('activation_race_join');
      return state;
    }

    if (
      typeof body.previousGroupId === 'string'
      && state.encryptionMode === 'MLS_V1'
      && state.groupId === body.previousGroupId
      && state.initialActivationRecoveryAllowed === true
    ) {
      this.discardInitialGroupCandidate(threadId, body.groupId, true);
      await this.persist();
      if (!this.activationRecoveryRetries.has(threadId)) {
        this.activationRecoveryRetries.add(threadId);
        try {
          return await this.recoverExpiredActivation(threadId, state);
        } finally {
          this.activationRecoveryRetries.delete(threadId);
        }
      }
    }
    throw originalError;
  }

  async recoverExpiredActivation(threadIdValue, stateValue = undefined) {
    this.requireReady();
    const threadId = id(threadIdValue, 'thread_id');
    const pending = this.applicationState.pendingActivations[threadId];
    if (pending !== undefined && typeof pending.previousGroupId === 'string') {
      return this.finishActivation(threadId, pending);
    }
    const state = stateValue === undefined ? await this.transport.getThreadState(threadId) : object(stateValue, 'recovery_state');
    if (
      state.encryptionMode !== 'MLS_V1'
      || state.initialActivationRecoveryAllowed !== true
      || state.ready !== false
      || state.groupId === null
      || state.epoch !== '1'
      || state.plaintextFallback !== false
    ) fail('initial_activation_recovery_unavailable');
    const trustedDirectory = await this.verifyThreadDirectoryState(state);
    const claimed = await this.transport.claimKeyPackages(threadId, this.deviceId);
    const expectedClaims = trustedDirectory.activeDevices.filter((device) => device.id !== this.deviceId);
    if (
      !sameIdentifierSet(claimed.claims.map((claim) => claim.recipientDeviceId), expectedClaims.map((device) => device.id))
      || claimed.claims.some((claim) => trustedDirectory.devicesById.get(claim.recipientDeviceId)?.accountId !== claim.recipientAccountId)
    ) fail('claim_directory_mismatch');

    let localGroup = null;
    try {
      localGroup = this.runtime.getGroupState(threadId);
    } catch (error) {
      if (error?.code !== 'group_missing') throw error;
    }
    if (localGroup !== null && (localGroup.groupId !== state.groupId || localGroup.epoch !== '1')) {
      fail('initial_activation_recovery_local_group');
    }
    const activation = localGroup === null
      ? await this.runtime.createGroup({ threadId, claims: claimed.claims })
      : await this.runtime.replaceInitialGroup({
          threadId,
          previousGroupId: state.groupId,
          claims: claimed.claims,
        });
    const body = {
      ...activation,
      senderDeviceId: this.deviceId,
      previousGroupId: state.groupId,
    };
    this.clearInitialGroupLocalData(threadId);
    this.applicationState.pendingActivations[threadId] = body;
    await this.persist();
    return this.finishActivation(threadId, body);
  }

  async retryPendingActivations() {
    this.requireReady();
    for (const threadId of Object.keys(this.applicationState.pendingActivations)) {
      try {
        await this.finishActivation(threadId, this.applicationState.pendingActivations[threadId]);
      } catch (error) {
        if (error?.status !== 409 || this.applicationState.pendingActivations[threadId] !== undefined) throw error;
        const state = await this.transport.getThreadState(threadId);
        if (state.encryptionMode === 'LEGACY_PLAINTEXT') await this.activateThread(threadId);
        else if (state.initialActivationRecoveryAllowed === true) await this.recoverExpiredActivation(threadId, state);
        else throw error;
      }
    }
  }

  clearInitialGroupLocalData(threadId) {
    delete this.applicationState.threads[threadId];
    this.projectionChanges.delete(threadId);
    const pendingRekey = this.applicationState.pendingRekeys[threadId];
    if (pendingRekey !== undefined) {
      if (typeof pendingRekey.operationId === 'string') this.runtime.abortPreparedRekey(pendingRekey.operationId);
      delete this.applicationState.pendingRekeys[threadId];
    }
    for (const [clientEnvelopeId, pending] of Object.entries(this.applicationState.pendingOutbox)) {
      if (pending?.threadId === threadId) delete this.applicationState.pendingOutbox[clientEnvelopeId];
    }
    delete this.applicationState.pendingActivations[threadId];
  }

  discardInitialGroupCandidate(threadId, groupId, clearThreadData) {
    try {
      this.runtime.abandonInitialGroup(threadId, groupId);
    } catch (error) {
      if (error?.code !== 'group_missing') throw error;
    }
    if (clearThreadData) this.clearInitialGroupLocalData(threadId);
    else delete this.applicationState.pendingActivations[threadId];
  }

  async joinPendingWelcomes() {
    this.requireReady();
    const joined = [];
    for (let batch = 0; batch < 5; batch += 1) {
      const welcomes = await this.transport.listPendingWelcomes(this.deviceId);
      if (welcomes.length === 0) break;
      for (const welcome of welcomes) {
        const state = await this.transport.getThreadState(welcome.threadId);
        if (state.encryptionMode !== 'MLS_V1' || state.groupId !== welcome.groupId || state.epoch !== welcome.epoch) {
          fail('welcome_thread_state');
        }
        const trustedDirectory = await this.verifyThreadDirectoryState(state);
        const memberDeviceIds = state.devices
          .filter((device) => device.isMember === true && device.removedAt === null)
          .map((device) => device.id);
        if (!sameIdentifierSet(memberDeviceIds, trustedDirectory.activeDevices.map((device) => device.id))) {
          fail('thread_rekey_required');
        }
        if (welcome.rosterHash !== null && welcome.rosterHash !== trustedDirectory.rosterHash) {
          fail('welcome_roster_hash');
        }
        if (welcome.rekeyOperationId !== null) {
          const operation = await this.transport.getThreadRekey(welcome.threadId, welcome.rekeyOperationId);
          if (
            operation.rosterHash !== trustedDirectory.rosterHash
            || operation.targetEpoch !== welcome.epoch
            || !sameIdentifierSet(operation.targetDeviceIds, trustedDirectory.activeDevices.map((device) => device.id))
            || operation.envelope?.id !== welcome.commitEnvelopeId
          ) fail('welcome_rekey_binding');
        }
        let localGroup = null;
        try {
          localGroup = this.runtime.getGroupState(welcome.threadId);
        } catch (error) {
          if (error?.code !== 'group_missing') throw error;
        }
        const pendingActivation = this.applicationState.pendingActivations[welcome.threadId];
        if (
          localGroup !== null
          && localGroup.groupId !== welcome.groupId
          && pendingActivation?.groupId === localGroup.groupId
          && (pendingActivation.previousGroupId ?? null) === welcome.replacesGroupId
        ) {
          this.discardInitialGroupCandidate(welcome.threadId, localGroup.groupId, true);
          await this.persist();
          localGroup = null;
        }
        try {
          if (localGroup !== null && localGroup.groupId !== welcome.groupId) {
            if (
              welcome.replacesGroupId !== localGroup.groupId
              || localGroup.epoch !== '1'
              || welcome.epoch !== '1'
              || welcome.rekeyOperationId !== null
              || welcome.commitEnvelopeId !== null
            ) fail('welcome_group_replacement_binding');
            await this.runtime.replaceInitialGroupFromWelcome({
              threadId: welcome.threadId,
              previousGroupId: welcome.replacesGroupId,
              groupId: welcome.groupId,
              epoch: welcome.epoch,
              welcome: welcome.payload,
              members: trustedDirectory.activeDevices,
            });
            this.clearInitialGroupLocalData(welcome.threadId);
          } else {
            await this.runtime.joinGroup({
              threadId: welcome.threadId,
              groupId: welcome.groupId,
              epoch: welcome.epoch,
              welcome: welcome.payload,
              members: trustedDirectory.activeDevices,
            });
          }
        } catch (error) {
          if (state.initialActivationRecoveryAllowed !== true) throw error;
          await this.recoverExpiredActivation(welcome.threadId, state);
          joined.push(welcome.threadId);
          return joined;
        }
        if (welcome.commitEnvelopeId !== null) {
          const local = threadState(this.applicationState, welcome.threadId);
          if (!local.processedEnvelopeIds.includes(welcome.commitEnvelopeId)) {
            local.processedEnvelopeIds.push(welcome.commitEnvelopeId);
            local.processedEnvelopeIds = local.processedEnvelopeIds.slice(-MAX_PROCESSED_ENVELOPES_PER_THREAD);
          }
        }
        await this.persist();
        await this.transport.acknowledgeWelcome(welcome.id);
        joined.push(welcome.threadId);
        this.emit({ type: 'thread-joined', threadId: welcome.threadId });
      }
    }
    return joined;
  }

  async syncThread(threadIdValue) {
    this.requireReady();
    const threadId = id(threadIdValue, 'thread_id');
    let state = await this.transport.getThreadState(threadId);
    if (state.encryptionMode !== 'MLS_V1') return [];
    if (state.initialActivationRecoveryAllowed === true) {
      await this.joinPendingWelcomes();
      state = await this.transport.getThreadState(threadId);
      if (state.initialActivationRecoveryAllowed === true) {
        state = await this.recoverExpiredActivation(threadId, state);
      }
    }
    const trustedDirectory = await this.verifyThreadDirectoryState(state);
    if (trustedDirectory.rekeyRequired && state.rekeyRequired !== true) fail('thread_rekey_required');
    const localGroup = this.runtime.getGroupState(threadId);
    if (localGroup.groupId !== state.groupId || BigInt(localGroup.epoch) > BigInt(state.epoch)) {
      fail('thread_group_state');
    }
    const local = threadState(this.applicationState, threadId);
    let cursor = local.envelopeCursor ?? undefined;
    let total = 0;
    const processed = new Set(local.processedEnvelopeIds);
    const rejected = new Set(Array.isArray(local.rejectedEnvelopeIds) ? local.rejectedEnvelopeIds : []);
    const projection = new MessageProjection(local.records);
    let changed = false;
    while (true) {
      const page = await this.transport.listEnvelopes(threadId, this.deviceId, cursor);
      total += page.items.length;
      if (total > MAX_SYNC_ENVELOPES) fail('sync_limit');
      for (const envelope of page.items) {
        if (processed.has(envelope.id)) continue;
        let expectedMembers;
        if (envelope.kind === 'COMMIT') {
          if (envelope.operationId === undefined || envelope.rosterHash === undefined) fail('rekey_envelope_metadata');
          const operation = await this.transport.getThreadRekey(threadId, envelope.operationId);
          if (
            operation.envelope?.id !== envelope.id
            || operation.targetEpoch !== envelope.epoch
            || operation.rosterHash !== envelope.rosterHash
          ) fail('rekey_envelope_binding');
          expectedMembers = await this.verifyRekeyOperationDirectory(operation);
        }
        const aad = canonicalEnvelopeAad({
          protocolVersion: CHAT_PROTOCOL_VERSION,
          threadId,
          senderAccountId: envelope.senderId,
          senderDeviceId: envelope.senderDeviceId,
          clientEnvelopeId: envelope.clientEnvelopeId,
          kind: envelope.kind,
          epoch: envelope.epoch,
          operationId: envelope.operationId,
          rosterHash: envelope.rosterHash,
        });
        const result = await this.runtime.process({
          threadId,
          aad,
          epoch: envelope.epoch,
          ciphertext: envelope.ciphertext,
          ...(expectedMembers === undefined ? {} : { expectedMembers }),
        });
        if (result.rejected === true) {
          rejected.add(envelope.id);
        } else if (result.event !== undefined) {
          try {
            projection.append({
              envelopeId: envelope.id,
              senderAccountId: result.sender.accountId,
              senderDeviceId: result.sender.deviceId,
              serverCreatedAt: envelope.createdAt,
              event: result.event,
            });
          } catch (error) {
            if (!(error instanceof MessageProjectionError)) throw error;
            rejected.add(envelope.id);
          }
        } else if (
          envelope.kind === 'COMMIT'
          && (
            result.transition?.operationId !== envelope.operationId
            || result.transition?.rosterHash !== envelope.rosterHash
            || result.transition?.epoch !== envelope.epoch
          )
        ) {
          fail('rekey_transition_binding');
        }
        processed.add(envelope.id);
        changed = true;
      }
      local.processedEnvelopeIds = [...processed].slice(-MAX_PROCESSED_ENVELOPES_PER_THREAD);
      local.rejectedEnvelopeIds = [...rejected].slice(-MAX_PROCESSED_ENVELOPES_PER_THREAD);
      local.envelopeCursor = page.checkpointCursor;
      const nextRecords = projection.exportRecords();
      if (nextRecords.length > local.records.length) this.markProjectionChange(threadId, 'append');
      local.records = nextRecords;
      if (changed || page.checkpointCursor !== cursor) await this.persist();
      if (page.nextCursor === null || page.nextCursor === undefined) break;
      cursor = page.nextCursor;
    }
    const finalGroup = this.runtime.getGroupState(threadId);
    if (
      finalGroup.epoch !== state.epoch
      || !sameIdentifierSet(
        finalGroup.members.map((member) => member.deviceId),
        trustedDirectory.currentMemberDevices.map((device) => device.id),
      )
    ) fail('thread_sync_state');
    if (
      state.ready
      && !sameIdentifierSet(
        finalGroup.members.map((member) => member.deviceId),
        trustedDirectory.activeDevices.map((device) => device.id),
      )
    ) fail('thread_ready_roster');
    if (changed) {
      this.emit({ type: 'messages-updated', threadId });
    }
    return projection.snapshot();
  }

  async sendEvent(threadIdValue, eventValue) {
    this.requireReady();
    const threadId = id(threadIdValue, 'thread_id');
    let state = await this.transport.getThreadState(threadId);
    if (state.initialActivationRecoveryAllowed === true) {
      await this.joinPendingWelcomes();
      state = await this.transport.getThreadState(threadId);
      if (state.initialActivationRecoveryAllowed === true) {
        state = await this.recoverExpiredActivation(threadId, state);
      }
    }
    if (state.rekeyRequired) {
      await this.reconcileThreadDevices(threadId);
      state = await this.transport.getThreadState(threadId);
    }
    if (!state.ready || state.rekeyRequired) fail('thread_transition_pending');
    const trusted = await this.verifyThreadDirectoryState(state);
    const currentGroup = this.runtime.getGroupState(threadId);
    if (
      currentGroup.groupId !== state.groupId
      || currentGroup.epoch !== state.epoch
      || !sameIdentifierSet(
        currentGroup.members.map((member) => member.deviceId),
        trusted.activeDevices.map((device) => device.id),
      )
    ) fail('thread_sync_required');
    const event = normalizeContentEvent(eventValue);
    const group = currentGroup;
    const clientEnvelopeId = randomIdentifier(this.storage.randomBytes, 'envelope');
    const aad = canonicalEnvelopeAad({
      protocolVersion: CHAT_PROTOCOL_VERSION,
      threadId,
      senderAccountId: this.accountId,
      senderDeviceId: this.deviceId,
      clientEnvelopeId,
      kind: 'APPLICATION',
      epoch: group.epoch,
    });
    const encrypted = await this.runtime.encrypt({ threadId, aad, event });
    const body = {
      protocolVersion: CHAT_PROTOCOL_VERSION,
      senderDeviceId: this.deviceId,
      clientEnvelopeId,
      kind: 'APPLICATION',
      epoch: encrypted.epoch,
      ciphertext: encrypted.ciphertext,
    };
    this.applicationState.pendingOutbox[clientEnvelopeId] = { threadId, body, event };
    await this.persist();
    const envelope = await this.deliverPending(clientEnvelopeId);
    return envelope;
  }

  createMessageEvent(inputValue) {
    const input = object(inputValue, 'message_input');
    return normalizeContentEvent({
      v: CHAT_PROTOCOL_VERSION,
      kind: 'message.create',
      logicalMessageId: randomIdentifier(this.storage.randomBytes, 'message'),
      clientCreatedAt: new Date().toISOString(),
      ...(input.text === undefined ? {} : { text: input.text }),
      ...(input.attachment === undefined ? {} : { attachment: input.attachment }),
    });
  }

  createMutationEvent(kind, targetLogicalMessageId, value = undefined) {
    const base = {
      v: CHAT_PROTOCOL_VERSION,
      kind,
      logicalMessageId: randomIdentifier(this.storage.randomBytes, 'event'),
      targetLogicalMessageId: id(targetLogicalMessageId, 'target_message_id'),
      clientCreatedAt: new Date().toISOString(),
    };
    if (kind === 'message.edit') return normalizeContentEvent({ ...base, text: value });
    if (kind === 'message.reaction') return normalizeContentEvent({ ...base, emoji: value });
    if (kind === 'message.delete') return normalizeContentEvent(base);
    fail('mutation_kind');
  }

  getMessages(threadIdValue) {
    this.requireReady();
    const threadId = id(threadIdValue, 'thread_id');
    const local = threadState(this.applicationState, threadId);
    return new MessageProjection(local.records).snapshot();
  }

  searchMessages(queryValue, optionsValue = {}) {
    this.requireReady();
    const query = normalizedSearchText(typeof queryValue === 'string' ? queryValue.trim() : '');
    if (query.length < 2 || query.length > 200) return [];
    const options = object(optionsValue, 'message_search_options');
    const limit = options.limit === undefined ? 100 : options.limit;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) fail('message_search_limit');
    const results = [];
    for (const threadId of Object.keys(this.applicationState.threads)) {
      id(threadId, 'thread_id');
      const local = threadState(this.applicationState, threadId);
      for (const message of new MessageProjection(local.records).snapshot()) {
        if (message.deletedAt !== undefined || !searchableMessageText(message).includes(query)) continue;
        results.push({ threadId, message: clone(message) });
      }
    }
    return results
      .sort((left, right) => {
        const byTime = Date.parse(right.message.createdAt) - Date.parse(left.message.createdAt);
        return byTime || right.message.id.localeCompare(left.message.id);
      })
      .slice(0, limit);
  }

  async retryPendingOutbox() {
    this.requireReady();
    for (const envelopeId of Object.keys(this.applicationState.pendingOutbox)) {
      await this.deliverPending(envelopeId);
    }
  }

  async deliverPending(clientEnvelopeId) {
    const pending = object(this.applicationState.pendingOutbox[clientEnvelopeId], 'pending_envelope');
    const envelope = await this.transport.sendEnvelope(pending.threadId, pending.body);
    if (envelope.clientEnvelopeId !== clientEnvelopeId || envelope.threadId !== pending.threadId) fail('send_response_binding');
    const identity = this.runtime.getIdentitySummary();
    const local = threadState(this.applicationState, pending.threadId);
    const projection = new MessageProjection(local.records);
    projection.append({
      envelopeId: envelope.id,
      senderAccountId: identity.accountId,
      senderDeviceId: identity.deviceId,
      serverCreatedAt: envelope.createdAt,
      event: pending.event,
    });
    local.records = projection.exportRecords();
    this.markProjectionChange(pending.threadId, 'append');
    if (!local.processedEnvelopeIds.includes(envelope.id)) {
      local.processedEnvelopeIds.push(envelope.id);
      local.processedEnvelopeIds = local.processedEnvelopeIds.slice(-MAX_PROCESSED_ENVELOPES_PER_THREAD);
    }
    delete this.applicationState.pendingOutbox[clientEnvelopeId];
    await this.persist();
    this.emit({ type: 'messages-updated', threadId: pending.threadId });
    return envelope;
  }

  async persist() {
    try {
      const projections = {};
      const persistedApplicationState = clone(this.applicationState);
      for (const threadId of Object.keys(this.applicationState.threads)) {
        const local = threadState(this.applicationState, id(threadId, 'thread_id'));
        projections[threadId] = new MessageProjection(local.records).exportRecords();
        persistedApplicationState.threads[threadId].records = [];
      }
      const changedThreadIds = [...this.projectionChanges.keys()]
        .filter((threadId) => projections[threadId] !== undefined)
        .sort();
      const appendOnlyThreadIds = changedThreadIds
        .filter((threadId) => this.projectionChanges.get(threadId) === 'append');
      await this.messageStore.saveAllThreads(projections, { changedThreadIds, appendOnlyThreadIds });
      this.runtime.setApplicationState(persistedApplicationState);
      const encrypted = await this.runtime.exportEncryptedState({ wrappingKeyId: this.storage.wrappingKeyId });
      await this.storage.saveEncryptedState(encrypted);
      this.projectionChanges.clear();
    } catch (error) {
      this.runtime.destroy();
      this.messageStore.destroyMemory();
      this.applicationState = initialApplicationState();
      this.activationRecoveryRetries.clear();
      this.projectionChanges.clear();
      this.ready = false;
      fail('state_persist_failed', error);
    }
  }

  async revokeAndClear() {
    let revocationError;
    if (this.ready) {
      try {
        await this.transport.revokeDevice(this.deviceId);
      } catch (error) {
        revocationError = error;
      }
    }
    this.runtime.destroy();
    this.messageStore.destroyMemory();
    this.applicationState = initialApplicationState();
    this.activationRecoveryRetries.clear();
    this.projectionChanges.clear();
    this.ready = false;
    try {
      await this.storage.clear();
    } catch (error) {
      fail('state_clear_failed', error);
    }
    if (revocationError !== undefined) fail('device_revocation_unconfirmed', revocationError);
  }

  destroyMemory() {
    this.runtime.destroy();
    this.messageStore.destroyMemory();
    this.storage.destroyMemoryKey?.();
    this.applicationState = initialApplicationState();
    this.activationRecoveryRetries.clear();
    this.ready = false;
    this.listeners.clear();
  }

  requireReady() {
    if (!this.ready) fail('client_not_ready');
  }
}
