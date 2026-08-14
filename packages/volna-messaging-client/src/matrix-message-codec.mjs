import contract from './index.js';

const { normalizeContentEvent, utf8ByteLength } = contract;
export const VOLNA_MATRIX_MSGTYPE = 'social.volna.message.v1';
export const VOLNA_MATRIX_CONTENT_KEY = 'social.volna.content';
export const VOLNA_MATRIX_DEVICE_KEY = 'social.volna.device_id';
const MAX_MATRIX_CONTENT_BYTES = 64 * 1024;

export class MatrixMessageCodecError extends Error {
  constructor(code) {
    super(`VOLNA Matrix message codec error (${code})`);
    this.name = 'MatrixMessageCodecError';
    this.code = code;
  }
}

function fail(code) {
  throw new MatrixMessageCodecError(code);
}

function safeBody(value) {
  if (typeof value !== 'string') fail('body');
  const normalized = value.replace(/\r\n?/g, '\n').trim();
  if (!normalized || normalized.length > 1000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(normalized)) fail('body');
  return normalized;
}

function safeDeviceId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{8,80}$/.test(value)) fail('device_id');
  return value;
}

export function encodeMatrixMessageContent(eventValue, options = {}) {
  const event = normalizeContentEvent(eventValue);
  const body = safeBody(options.body ?? 'Сообщение VOLNA');
  const deviceId = safeDeviceId(options.deviceId);
  const content = {
    msgtype: VOLNA_MATRIX_MSGTYPE,
    body,
    [VOLNA_MATRIX_CONTENT_KEY]: event,
    [VOLNA_MATRIX_DEVICE_KEY]: deviceId,
  };
  if (utf8ByteLength(JSON.stringify(content)) > MAX_MATRIX_CONTENT_BYTES) fail('content_size');
  return content;
}

export function decodeMatrixMessageContent(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('content');
  if (value.msgtype !== VOLNA_MATRIX_MSGTYPE) return null;
  const allowed = new Set(['msgtype', 'body', VOLNA_MATRIX_CONTENT_KEY, VOLNA_MATRIX_DEVICE_KEY]);
  if (Object.keys(value).some((key) => !allowed.has(key))) fail('content_keys');
  const body = safeBody(value.body);
  const deviceId = safeDeviceId(value[VOLNA_MATRIX_DEVICE_KEY]);
  const event = normalizeContentEvent(value[VOLNA_MATRIX_CONTENT_KEY]);
  if (utf8ByteLength(JSON.stringify(value)) > MAX_MATRIX_CONTENT_BYTES) fail('content_size');
  return { body, deviceId, event };
}
