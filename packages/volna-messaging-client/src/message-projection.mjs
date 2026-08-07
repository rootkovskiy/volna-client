import contract from './index.js';

const { normalizeContentEvent } = contract;
const ID_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;

export class MessageProjectionError extends Error {
  constructor(code) {
    super(`VOLNA message projection error (${code})`);
    this.name = 'MessageProjectionError';
    this.code = code;
  }
}

function fail(code) {
  throw new MessageProjectionError(code);
}

function assertId(value, code) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) fail(code);
  return value;
}

function assertIsoDate(value, code) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) fail(code);
  return value;
}

function normalizeRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('record');
  const event = normalizeContentEvent(value.event);
  return {
    envelopeId: assertId(value.envelopeId, 'envelope_id'),
    senderAccountId: assertId(value.senderAccountId, 'sender_account_id'),
    senderDeviceId: assertId(value.senderDeviceId, 'sender_device_id'),
    serverCreatedAt: assertIsoDate(value.serverCreatedAt, 'server_created_at'),
    event,
  };
}

function compareRecords(left, right) {
  const byTime = Date.parse(left.serverCreatedAt) - Date.parse(right.serverCreatedAt);
  return byTime || left.envelopeId.localeCompare(right.envelopeId);
}

export function projectContentEvents(recordsValue) {
  if (!Array.isArray(recordsValue)) fail('records');
  const records = recordsValue.map(normalizeRecord).sort(compareRecords);
  const seenEnvelopes = new Set();
  const seenEvents = new Map();
  const messages = new Map();

  for (const record of records) {
    if (seenEnvelopes.has(record.envelopeId)) continue;
    seenEnvelopes.add(record.envelopeId);
    const encodedEvent = JSON.stringify(record.event);
    const previousEvent = seenEvents.get(record.event.logicalMessageId);
    if (previousEvent !== undefined) {
      if (previousEvent !== encodedEvent) fail('logical_event_collision');
      continue;
    }
    seenEvents.set(record.event.logicalMessageId, encodedEvent);

    if (record.event.kind === 'message.create') {
      if (messages.has(record.event.logicalMessageId)) continue;
      messages.set(record.event.logicalMessageId, {
        id: record.event.logicalMessageId,
        senderAccountId: record.senderAccountId,
        senderDeviceId: record.senderDeviceId,
        text: record.event.text,
        attachment: record.event.attachment,
        clientCreatedAt: record.event.clientCreatedAt,
        createdAt: record.serverCreatedAt,
        editedAt: undefined,
        deletedAt: undefined,
        reactions: [],
      });
      continue;
    }

    const target = messages.get(record.event.targetLogicalMessageId);
    if (target === undefined) continue;
    if (record.event.kind === 'message.edit') {
      if (target.senderAccountId !== record.senderAccountId || target.deletedAt !== undefined) continue;
      target.text = record.event.text;
      target.editedAt = record.serverCreatedAt;
      continue;
    }
    if (record.event.kind === 'message.delete') {
      if (target.senderAccountId !== record.senderAccountId || target.deletedAt !== undefined) continue;
      target.text = undefined;
      target.attachment = undefined;
      target.deletedAt = record.serverCreatedAt;
      continue;
    }
    const withoutSender = target.reactions.filter((reaction) => reaction.accountId !== record.senderAccountId);
    target.reactions = record.event.emoji === null
      ? withoutSender
      : [...withoutSender, { accountId: record.senderAccountId, emoji: record.event.emoji }];
  }

  return [...messages.values()].sort((left, right) => {
    const byTime = Date.parse(left.createdAt) - Date.parse(right.createdAt);
    return byTime || left.id.localeCompare(right.id);
  });
}

export class MessageProjection {
  constructor(records = []) {
    if (!Array.isArray(records)) fail('records');
    this.records = records.map(normalizeRecord);
    this.envelopeIds = new Set(this.records.map((record) => record.envelopeId));
    this.logicalEvents = new Map();
    for (const record of this.records) this.recordLogicalEvent(record);
  }

  append(recordValue) {
    const record = normalizeRecord(recordValue);
    if (this.envelopeIds.has(record.envelopeId)) return false;
    if (!this.recordLogicalEvent(record)) return false;
    this.records.push(record);
    this.envelopeIds.add(record.envelopeId);
    return true;
  }

  recordLogicalEvent(record) {
    const encoded = JSON.stringify(record.event);
    const previous = this.logicalEvents.get(record.event.logicalMessageId);
    if (previous !== undefined) {
      if (previous !== encoded) fail('logical_event_collision');
      return false;
    }
    this.logicalEvents.set(record.event.logicalMessageId, encoded);
    return true;
  }

  snapshot() {
    return projectContentEvents(this.records);
  }

  exportRecords() {
    return this.records.map((record) => ({
      ...record,
      event: normalizeContentEvent(record.event),
    }));
  }
}
