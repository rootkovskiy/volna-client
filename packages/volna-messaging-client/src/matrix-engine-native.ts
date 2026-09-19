import { assertMatrixKeyActive, assertMatrixAccountOpen, closeMatrixKey, withMatrixKeyWrite, withMatrixAccountShutdown } from './matrix-key-lifecycle.mjs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { sha256 } from '@noble/hashes/sha2.js';
import * as ExpoCrypto from 'expo-crypto';
import contract from './index.js';
import { messagePreview } from './messaging-surface-controller.mjs';
import { isActiveMatrixVerification, matrixDeviceDisplayName } from './matrix-security-presentation.mjs';
import { createExpoMessagingStorage } from './expo-storage-adapter';
import { base64UrlToBytes, bytesToBase64Url } from './mls-runtime.mjs';
import { type DecryptedEventRecord } from './message-projection.mjs';
import { projectMatrixContentEvents } from './matrix-event-policy.mjs';
import { createMatrixCredentialRefresher } from './matrix-token-refresh.mjs';
import { waitForPublishedMatrixDevice } from './matrix-device-publication.mjs';
import {
  decodeMatrixMessageContent,
  encodeMatrixMessageContent,
} from './matrix-message-codec.mjs';
import { matrixBase64ToBytes, oneMatrixEd25519Key, verifyMatrixSignedObject } from './matrix-signing.mjs';
import type {
  MatrixNativeRoomSnapshot,
  MatrixDeviceSecurity,
  MatrixMessagingCapabilities,
  MatrixMessagingManager,
  MatrixNativeSecurityState,
  MatrixNativeSessionBridge,
  MatrixNativeSessionChangedEvent,
  MatrixRoomSecurity,
  MatrixVerificationState,
} from './matrix-engine';
import type {
  MessagingAttachment,
  MessagingMessage,
  MessagingThread,
} from './messaging-surface-controller.mjs';

const { normalizeContentEvent } = contract;
const MATRIX_THREAD_STATE_TYPE = 'social.volna.thread';
const MATRIX_ENCRYPTION_ALGORITHM = 'm.megolm.v1.aes-sha2';
const MATRIX_CREDENTIAL_PREFIX = '@volna/matrix/credentials/v1';
const MATRIX_DEVICE_PREFIX = '@volna/matrix/device/v1';
const MATRIX_OUTBOX_PREFIX = '@volna/matrix/native-outbox/v1';
const MATRIX_NOTIFICATION_OUTBOX_PREFIX = '@volna/matrix/native-notification-outbox/v1';
const MATRIX_CREDENTIAL_AAD = new TextEncoder().encode('VOLNA-MATRIX-CREDENTIALS-V1');
const MATRIX_OUTBOX_AAD = new TextEncoder().encode('VOLNA-MATRIX-NATIVE-OUTBOX-V1');
const MATRIX_NOTIFICATION_OUTBOX_AAD = new TextEncoder().encode('VOLNA-MATRIX-NATIVE-NOTIFICATION-OUTBOX-V1');
const MAX_OUTBOX_ITEMS = 256;
const MAX_OUTBOX_PLAINTEXT_BYTES = 512 * 1024 - 16;
const MAX_NOTIFICATION_OUTBOX_PLAINTEXT_BYTES = 128 * 1024 - 16;
const REFRESH_EARLY_MS = 60_000;
const REFRESH_RETRY_MS = 30_000;
const MAX_TIMER_MS = 2_147_483_647;
const SAFE_ID = /^[A-Za-z0-9_-]{8,80}$/;
const SAFE_ROOM_ID = /^![^\s:]{1,255}:[^\s]{1,255}$/;
const SAFE_EVENT_ID = /^\$[^\s]{1,254}$/;
const SAFE_MATRIX_USER_ID = /^@[a-z0-9._=/\-]+:[a-z0-9.-]+(?::[0-9]+)?$/;

type MatrixCredentials = {
  v: 1;
  homeserverUrl: string;
  userId: string;
  deviceId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

type NativeMatrixHandle = {
  accountId: string;
  credentials: MatrixCredentials;
  deviceKey: Uint8Array;
  storage: ReturnType<typeof createExpoMessagingStorage>;
  refreshTimer: ReturnType<typeof setTimeout> | null;
  refreshPromise: Promise<void> | null;
  active: boolean;
  roomByThreadId: Map<string, string>;
  threadByRoomId: Map<string, MessagingThread>;
  recordsByThreadId: Map<string, DecryptedEventRecord[]>;
  pendingByLogicalId: Map<string, PendingMatrixSend>;
  listeners: Set<(threadId: string) => void>;
  pendingNotificationIds: Set<string>;
  acknowledgingSendIds: Set<string>;
  submittingSendIds: Set<string>;
  submittingSendTasks?: Map<string, Promise<void>>;
  roomOpenTasks?: Map<string, Promise<MessagingThread>>;
  pendingTimelineSnapshots?: Map<string, Map<string, MatrixNativeRoomSnapshot>>;
  historyDepthByRoomId?: Map<string, number>;
  timelines?: Map<string, { id: string; revision: number; hasMoreHistory: boolean; hasUndecryptableEvents: boolean; retired?: boolean }>;
};

type PendingMatrixSend = {
  v: 1;
  id: string;
  threadId: string;
  // Missing only in legacy records, which are preserved but never auto-rebound.
  partnerAccountId?: string;
  roomId?: string;
  event: unknown;
  queuedAt: string;
  submitted: boolean;
};

type PendingMatrixNotification = {
  v: 1;
  id: string;
  threadId: string;
  eventId: string;
  queuedAt: string;
};

class MatrixHttpError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'MatrixHttpError';
    this.status = status;
  }
}

function requestId(prefix: string) {
  return `${prefix}_${ExpoCrypto.randomUUID().replaceAll('-', '')}`.slice(0, 80);
}

function bytes(value: string) {
  return new TextEncoder().encode(value);
}

function safeIdentifier(value: unknown, label: string) {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) throw new Error(`Некорректный ${label}`);
  return value;
}

function safeOrigin(value: unknown, allowInsecureDevelopmentOrigin = false) {
  if (typeof value !== 'string') throw new Error('Некорректный адрес Matrix');
  const url = new URL(value);
  const localHttp = url.protocol === 'http:'
    && (allowInsecureDevelopmentOrigin || ['localhost', '127.0.0.1'].includes(url.hostname));
  if (url.username || url.password || (url.protocol !== 'https:' && !localHttp)) {
    throw new Error('Matrix требует HTTPS');
  }
  return url.origin;
}

function credentialKey(accountId: string) {
  return `${MATRIX_CREDENTIAL_PREFIX}:${accountId}`;
}

function deviceStorageKey(accountId: string) {
  return `${MATRIX_DEVICE_PREFIX}:${accountId}`;
}

function outboxStorageKey(accountId: string) {
  return `${MATRIX_OUTBOX_PREFIX}:${accountId}`;
}

function notificationOutboxStorageKey(accountId: string) {
  return `${MATRIX_NOTIFICATION_OUTBOX_PREFIX}:${accountId}`;
}

function matrixServerName(userId: string) {
  const separator = userId.indexOf(':');
  if (separator < 2 || separator === userId.length - 1) throw new Error('Matrix user id domain is missing');
  return userId.slice(separator + 1);
}

function matrixUserIdForAccount(accountId: string, serverName: string) {
  safeIdentifier(accountId, 'аккаунт Matrix');
  const hex = [...sha256(bytes(`VOLNA-MATRIX-ACCOUNT\0${accountId}`))]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
  return `@volna_${hex}:${serverName}`;
}

function matrixDeviceProjectionId(senderUserId: string, advertisedDeviceId: string) {
  return `mxdev_${bytesToBase64Url(sha256(bytes(`${senderUserId}\0${advertisedDeviceId}`))).slice(0, 40)}`;
}

function matrixEnvelopeId(eventId: string) {
  return `mx_${bytesToBase64Url(sha256(bytes(eventId))).slice(0, 48)}`;
}

function objectRecord(value: unknown, label: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Matrix ${label} is invalid`);
  return value as Record<string, unknown>;
}

function optionalObjectRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalizeNativeVerification(value: unknown): MatrixVerificationState {
  const record = objectRecord(value, 'verification state');
  const phase = record.phase;
  const otherDeviceId = record.otherDeviceId;
  const decimal = record.sasDecimal;
  const emoji = record.sasEmoji;
  if (
    typeof record.id !== 'string' || !SAFE_ID.test(record.id)
    || !['requested', 'ready', 'started', 'cancelled', 'done'].includes(String(phase))
    || typeof record.initiatedByMe !== 'boolean'
    || typeof record.otherUserId !== 'string' || !SAFE_MATRIX_USER_ID.test(record.otherUserId)
    || (otherDeviceId !== null && (typeof otherDeviceId !== 'string' || !SAFE_ID.test(otherDeviceId)))
    || (decimal !== null && (!Array.isArray(decimal) || decimal.length !== 3 || decimal.some((item) => !Number.isInteger(item) || item < 0 || item > 65535)))
    || !Array.isArray(emoji) || emoji.length > 7
    || emoji.some((item) => !Array.isArray(item) || item.length !== 2 || item.some((part) => typeof part !== 'string' || part.length > 80))
    || (record.qrCodeBase64 !== null && (typeof record.qrCodeBase64 !== 'string' || !/^[A-Za-z0-9_-]{1,2731}$/.test(record.qrCodeBase64)))
    || typeof record.qrSupported !== 'boolean'
    || (record.qrNeedsConfirmation !== undefined && typeof record.qrNeedsConfirmation !== 'boolean')
    || (!record.qrSupported && (record.qrCodeBase64 !== null || record.qrNeedsConfirmation === true))
    || (record.qrNeedsConfirmation === true && phase !== 'started')
  ) throw new Error('Matrix verification state is invalid');
  if (typeof record.qrCodeBase64 === 'string') base64UrlToBytes(record.qrCodeBase64, 2048).fill(0);
  return {
    id: record.id,
    phase: phase as MatrixVerificationState['phase'],
    initiatedByMe: record.initiatedByMe,
    otherUserId: record.otherUserId,
    otherDeviceId: otherDeviceId as string | null,
    sasDecimal: decimal as [number, number, number] | null,
    sasEmoji: emoji as Array<[string, string]>,
    qrCodeBase64: record.qrCodeBase64 as string | null,
    qrSupported: record.qrSupported,
    qrNeedsConfirmation: record.qrNeedsConfirmation === true,
  };
}

function previewForEvent(event: ReturnType<typeof normalizeContentEvent>) {
  if (event.kind === 'message.edit') return 'Изменённое сообщение VOLNA';
  if (event.kind === 'message.reaction') return event.emoji ? `Реакция ${event.emoji}` : 'Реакция удалена';
  if (event.kind === 'message.delete') return 'Сообщение удалено';
  if (event.text?.trim()) return event.text.trim().replace(/\s+/g, ' ').slice(0, 1000);
  if (event.attachment?.kind === 'music') return `🎵 ${event.attachment.artist} — ${event.attachment.title}`.slice(0, 1000);
  if (event.attachment?.kind === 'location') return '📍 Геопозиция';
  if (event.attachment?.kind === 'entity' && event.attachment.entityType === 'event') {
    const snapshot = event.attachment.snapshot;
    const title = snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot) && typeof snapshot.title === 'string'
      ? snapshot.title
      : 'Событие';
    return `📅 ${title}`.slice(0, 1000);
  }
  return 'Карточка VOLNA';
}

function isAuthenticationFailure(error: unknown) {
  return error instanceof MatrixHttpError && (error.status === 401 || error.status === 403);
}

function requireNativeSessionRuntime(nativeBridge: MatrixNativeSessionBridge) {
  const runtime = nativeBridge.getRuntimeInfo();
  if (
    !runtime
    || runtime.available !== true
    || runtime.implementation !== 'matrix-rust-sdk-ffi'
    || runtime.apiVersion !== 1
    || !runtime.features.includes('session-lifecycle')
  ) {
    throw new Error('Matrix Rust SDK отсутствует в этой нативной сборке VOLNA');
  }
  return runtime;
}

function requireNativeRoomRuntime(nativeBridge: MatrixNativeSessionBridge) {
  const runtime = requireNativeSessionRuntime(nativeBridge);
  if (!runtime.features.includes('room-timeline-v1') || !runtime.features.includes('authenticated-timeline-v1')
    || !runtime.features.includes('history-pagination-v1')
    || !runtime.features.includes('strict-room-key-recipients-v1')
    || !runtime.features.includes('authenticated-backup-v1')
    || typeof nativeBridge.bindRoomKeyRecipients !== 'function') {
    throw new Error('Эта нативная сборка VOLNA не поддерживает защищённые Matrix-комнаты');
  }
  return runtime;
}

function requireNativeRecoveryRuntime(nativeBridge: MatrixNativeSessionBridge) {
  const runtime = requireNativeRoomRuntime(nativeBridge);
  if (!runtime.features.includes('recovery-v1')) {
    throw new Error('Эта нативная сборка VOLNA не поддерживает восстановление Matrix');
  }
  return runtime;
}

function requireNativeSecurityRuntime(nativeBridge: MatrixNativeSessionBridge) {
  const runtime = requireNativeRecoveryRuntime(nativeBridge);
  if (!runtime.features.includes('identity-security-v1') || !runtime.features.includes('sas-verification-v1')) {
    throw new Error('Эта нативная сборка VOLNA не поддерживает проверку Matrix-устройств');
  }
  return runtime;
}

export function createMatrixMessagingManager(options: {
  apiOrigin: string;
  fetch: typeof globalThis.fetch;
  getAccessToken?(): string | undefined | Promise<string | undefined>;
  includeCredentials?: boolean;
  allowInsecureDevelopmentOrigin?: boolean;
  nativeBridge: MatrixNativeSessionBridge;
}): MatrixMessagingManager {
  const origin = safeOrigin(options.apiOrigin, options.allowInsecureDevelopmentOrigin === true);
  const nativeBridge = options.nativeBridge;
  if (!nativeBridge) throw new Error('Matrix native bridge is required');
  const handles = new Map<string, Promise<NativeMatrixHandle>>();
  const outboxLocks = new Map<string, Promise<void>>();
  const notificationOutboxLocks = new Map<string, Promise<void>>();
  let capabilitiesPromise: Promise<MatrixMessagingCapabilities> | null = null;
  let sessionChangedSubscription: { remove(): void } | null = null;
  let roomTimelineSubscription: { remove(): void } | null = null;

  const request = async (path: string, init: RequestInit = {}) => {
    const token = await options.getAccessToken?.();
    const headers = new Headers(init.headers);
    if (token !== undefined) {
      if (typeof token !== 'string' || token.length === 0) throw new Error('Некорректная сессия VOLNA');
      headers.set('Authorization', `Bearer ${token}`);
    }
    return options.fetch(`${origin}${path}`, {
      ...init,
      headers,
      cache: 'no-store',
      ...(options.includeCredentials ? { credentials: 'include' as const } : {}),
    });
  };

  const capabilities = async () => {
    capabilitiesPromise ??= (async () => {
      const response = await request('/messaging/matrix/capabilities');
      if (!response.ok) throw new Error('Не удалось проверить Matrix runtime');
      const value = await response.json() as Partial<MatrixMessagingCapabilities>;
      return {
        enabled: value.enabled === true,
        protocol: 'MATRIX_V1' as const,
        loginType: typeof value.loginType === 'string' ? value.loginType : 'social.volna.session',
        homeserverUrl: value.enabled ? safeOrigin(value.homeserverUrl) : null,
        serverName: typeof value.serverName === 'string' ? value.serverName : null,
        nativeRuntimeRequired: true,
        productionReleaseBlocked: value.productionReleaseBlocked === true,
      };
    })();
    const pending = capabilitiesPromise;
    try { return await pending; } catch (error) {
      if (capabilitiesPromise === pending) capabilitiesPromise = null;
      throw error;
    }
  };

  const getOrCreateDeviceId = async (accountId: string) => {
    const key = deviceStorageKey(accountId);
    const existing = await AsyncStorage.getItem(key);
    if (existing && SAFE_ID.test(existing)) return existing;
    const created = `matrix_${ExpoCrypto.randomUUID().replaceAll('-', '')}`;
    await AsyncStorage.setItem(key, created);
    return created;
  };

  const saveCredentials = async (accountId: string, key: Uint8Array, credentials: MatrixCredentials) => withMatrixKeyWrite(key, async () => {
    const nonce = new Uint8Array(24);
    ExpoCrypto.getRandomValues(nonce);
    const plaintext = bytes(JSON.stringify(credentials));
    try {
      const ciphertext = xchacha20poly1305(key, nonce, MATRIX_CREDENTIAL_AAD).encrypt(plaintext);
      await AsyncStorage.setItem(credentialKey(accountId), JSON.stringify({
        v: 1,
        nonce: bytesToBase64Url(nonce),
        ciphertext: bytesToBase64Url(ciphertext),
      }));
    } finally {
      plaintext.fill(0);
      nonce.fill(0);
    }
  });

  const loadCredentials = async (accountId: string, key: Uint8Array): Promise<MatrixCredentials | null> => {
    const encoded = await AsyncStorage.getItem(credentialKey(accountId));
    if (!encoded) return null;
    try {
      const envelope = JSON.parse(encoded) as { v?: unknown; nonce?: unknown; ciphertext?: unknown };
      if (envelope.v !== 1 || typeof envelope.nonce !== 'string' || typeof envelope.ciphertext !== 'string') return null;
      const nonce = base64UrlToBytes(envelope.nonce, 24);
      const ciphertext = base64UrlToBytes(envelope.ciphertext, 8 * 1024);
      const plaintext = xchacha20poly1305(key, nonce, MATRIX_CREDENTIAL_AAD).decrypt(ciphertext);
      try {
        const value = JSON.parse(new TextDecoder().decode(plaintext)) as Partial<MatrixCredentials>;
        if (
          value.v !== 1
          || typeof value.homeserverUrl !== 'string'
          || typeof value.userId !== 'string'
          || typeof value.deviceId !== 'string'
          || typeof value.accessToken !== 'string'
          || typeof value.refreshToken !== 'string'
          || !Number.isSafeInteger(value.expiresAt)
          || !value.accessToken
          || !value.refreshToken
          || !SAFE_ID.test(value.deviceId)
          || !/^@[a-z0-9._=/\-]+:[a-z0-9.-]+(?::[0-9]+)?$/.test(value.userId)
        ) return null;
        return {
          v: 1,
          homeserverUrl: safeOrigin(value.homeserverUrl),
          userId: value.userId,
          deviceId: value.deviceId,
          accessToken: value.accessToken,
          refreshToken: value.refreshToken,
          expiresAt: value.expiresAt as number,
        };
      } finally {
        plaintext.fill(0);
      }
    } catch {
      return null;
    }
  };

  const loadOutbox = async (accountId: string, key: Uint8Array): Promise<PendingMatrixSend[]> => {
    const encoded = await AsyncStorage.getItem(outboxStorageKey(accountId));
    if (encoded === null) return [];
    try {
      const envelope = JSON.parse(encoded) as { v?: unknown; nonce?: unknown; ciphertext?: unknown };
      if (envelope.v !== 1 || typeof envelope.nonce !== 'string' || typeof envelope.ciphertext !== 'string') throw new Error('Не удалось прочитать очередь Matrix. Сохранённые данные не изменены.');
      const nonce = base64UrlToBytes(envelope.nonce, 24);
      const ciphertext = base64UrlToBytes(envelope.ciphertext, 512 * 1024);
      const plaintext = xchacha20poly1305(key, nonce, MATRIX_OUTBOX_AAD).decrypt(ciphertext);
      try {
        const items = JSON.parse(new TextDecoder().decode(plaintext)) as unknown;
        if (!Array.isArray(items) || items.length > MAX_OUTBOX_ITEMS) throw new Error('Не удалось прочитать очередь Matrix. Сохранённые данные не изменены.');
        return items.flatMap((item) => {
          if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Не удалось прочитать очередь Matrix. Сохранённые данные не изменены.');
          const value = item as Partial<PendingMatrixSend>;
          if (
            value.v !== 1
            || typeof value.id !== 'string'
            || typeof value.threadId !== 'string'
            || typeof value.queuedAt !== 'string'
            || typeof value.submitted !== 'boolean'
            || !SAFE_ID.test(value.id)
            || !SAFE_ID.test(value.threadId)
            || !Number.isFinite(Date.parse(value.queuedAt))
          ) throw new Error('Не удалось прочитать очередь Matrix. Сохранённые данные не изменены.');
          if ((value.partnerAccountId !== undefined || value.roomId !== undefined) && (
            typeof value.partnerAccountId !== 'string' || !SAFE_ID.test(value.partnerAccountId)
            || typeof value.roomId !== 'string' || !SAFE_ROOM_ID.test(value.roomId)
          )) throw new Error('Не удалось прочитать очередь Matrix. Сохранённые данные не изменены.');
          try {
            return [{
              v: 1 as const,
              id: value.id,
              threadId: value.threadId,
              ...(value.partnerAccountId === undefined ? {} : { partnerAccountId: value.partnerAccountId, roomId: value.roomId }),
              event: normalizeContentEvent(value.event),
              queuedAt: value.queuedAt,
              submitted: value.submitted,
            }];
          } catch {
            throw new Error('Не удалось прочитать очередь Matrix. Сохранённые данные не изменены.');
          }
        });
      } finally {
        plaintext.fill(0);
      }
    } catch {
      throw new Error('Не удалось прочитать очередь Matrix. Сохранённые данные не изменены.');
    }
  };

  const saveOutbox = async (accountId: string, key: Uint8Array, items: PendingMatrixSend[]) => withMatrixKeyWrite(key, async () => {
    if (!items.length) {
      await AsyncStorage.removeItem(outboxStorageKey(accountId));
      return;
    }
    if (items.length > MAX_OUTBOX_ITEMS) throw new Error('Очередь Matrix переполнена');
    const nonce = new Uint8Array(24);
    ExpoCrypto.getRandomValues(nonce);
    const plaintext = bytes(JSON.stringify(items));
    try {
      if (plaintext.length > MAX_OUTBOX_PLAINTEXT_BYTES) throw new Error('Очередь Matrix переполнена');
      const ciphertext = xchacha20poly1305(key, nonce, MATRIX_OUTBOX_AAD).encrypt(plaintext);
      await AsyncStorage.setItem(outboxStorageKey(accountId), JSON.stringify({
        v: 1,
        nonce: bytesToBase64Url(nonce),
        ciphertext: bytesToBase64Url(ciphertext),
      }));
    } finally {
      plaintext.fill(0);
      nonce.fill(0);
    }
  });

  const mutateOutbox = async (
    accountId: string,
    key: Uint8Array,
    mutate: (items: PendingMatrixSend[]) => PendingMatrixSend[],
  ) => {
    const previous = outboxLocks.get(accountId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(async () => {
      assertMatrixKeyActive(key);
      const items = await loadOutbox(accountId, key);
      assertMatrixKeyActive(key);
      await saveOutbox(accountId, key, mutate(items));
    });
    outboxLocks.set(accountId, current);
    try {
      await current;
    } finally {
      if (outboxLocks.get(accountId) === current) outboxLocks.delete(accountId);
    }
  };

  const loadNotificationOutbox = async (accountId: string, key: Uint8Array): Promise<PendingMatrixNotification[]> => {
    const encoded = await AsyncStorage.getItem(notificationOutboxStorageKey(accountId));
    if (encoded === null) return [];
    try {
      const envelope = JSON.parse(encoded) as { v?: unknown; nonce?: unknown; ciphertext?: unknown };
      if (envelope.v !== 1 || typeof envelope.nonce !== 'string' || typeof envelope.ciphertext !== 'string') throw new Error('Не удалось прочитать очередь Matrix. Сохранённые данные не изменены.');
      const nonce = base64UrlToBytes(envelope.nonce, 24);
      const ciphertext = base64UrlToBytes(envelope.ciphertext, 128 * 1024);
      const plaintext = xchacha20poly1305(key, nonce, MATRIX_NOTIFICATION_OUTBOX_AAD).decrypt(ciphertext);
      try {
        const items = JSON.parse(new TextDecoder().decode(plaintext)) as unknown;
        if (!Array.isArray(items) || items.length > MAX_OUTBOX_ITEMS) throw new Error('Не удалось прочитать очередь Matrix. Сохранённые данные не изменены.');
        return items.flatMap((item) => {
          if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Не удалось прочитать очередь Matrix. Сохранённые данные не изменены.');
          const value = item as Partial<PendingMatrixNotification>;
          if (
            value.v !== 1
            || typeof value.id !== 'string'
            || typeof value.threadId !== 'string'
            || typeof value.eventId !== 'string'
            || typeof value.queuedAt !== 'string'
            || !SAFE_ID.test(value.id)
            || !SAFE_ID.test(value.threadId)
            || !SAFE_EVENT_ID.test(value.eventId)
            || !Number.isFinite(Date.parse(value.queuedAt))
          ) throw new Error('Не удалось прочитать очередь Matrix. Сохранённые данные не изменены.');
          return [{ v: 1 as const, id: value.id, threadId: value.threadId, eventId: value.eventId, queuedAt: value.queuedAt }];
        });
      } finally {
        plaintext.fill(0);
      }
    } catch {
      throw new Error('Не удалось прочитать очередь Matrix. Сохранённые данные не изменены.');
    }
  };

  const saveNotificationOutbox = async (
    accountId: string,
    key: Uint8Array,
    items: PendingMatrixNotification[],
  ) => withMatrixKeyWrite(key, async () => {
    if (!items.length) {
      await AsyncStorage.removeItem(notificationOutboxStorageKey(accountId));
      return;
    }
    if (items.length > MAX_OUTBOX_ITEMS) throw new Error('Очередь Matrix-уведомлений переполнена');
    const nonce = new Uint8Array(24);
    ExpoCrypto.getRandomValues(nonce);
    const plaintext = bytes(JSON.stringify(items));
    try {
      if (plaintext.length > MAX_NOTIFICATION_OUTBOX_PLAINTEXT_BYTES) {
        throw new Error('Очередь Matrix-уведомлений переполнена');
      }
      const ciphertext = xchacha20poly1305(key, nonce, MATRIX_NOTIFICATION_OUTBOX_AAD).encrypt(plaintext);
      await AsyncStorage.setItem(notificationOutboxStorageKey(accountId), JSON.stringify({
        v: 1,
        nonce: bytesToBase64Url(nonce),
        ciphertext: bytesToBase64Url(ciphertext),
      }));
    } finally {
      plaintext.fill(0);
      nonce.fill(0);
    }
  });

  const mutateNotificationOutbox = async (
    accountId: string,
    key: Uint8Array,
    mutate: (items: PendingMatrixNotification[]) => PendingMatrixNotification[],
  ) => {
    const previous = notificationOutboxLocks.get(accountId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(async () => {
      assertMatrixKeyActive(key);
      const items = await loadNotificationOutbox(accountId, key);
      assertMatrixKeyActive(key);
      await saveNotificationOutbox(accountId, key, mutate(items));
    });
    notificationOutboxLocks.set(accountId, current);
    try {
      await current;
    } finally {
      if (notificationOutboxLocks.get(accountId) === current) notificationOutboxLocks.delete(accountId);
    }
  };

  const matrixRequest = async (url: string, init: RequestInit, message: string) => {
    const response = await globalThis.fetch(url, { ...init, cache: 'no-store', credentials: 'omit' });
    const value = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) throw new MatrixHttpError(
      typeof value.error === 'string' ? value.error : message,
      response.status,
    );
    return value;
  };

  const login = async (accountId: string, requestedDeviceId: string): Promise<MatrixCredentials> => {
    const sessionResponse = await request('/messaging/matrix/session', { method: 'POST' });
    if (!sessionResponse.ok) throw new MatrixHttpError('Не удалось создать одноразовую Matrix-сессию', sessionResponse.status);
    const session = await sessionResponse.json() as Record<string, unknown>;
    if (
      session.loginType !== 'social.volna.session'
      || typeof session.loginToken !== 'string'
      || typeof session.matrixUserId !== 'string'
      || !SAFE_MATRIX_USER_ID.test(session.matrixUserId)
    ) throw new Error('VOLNA вернула некорректную Matrix-сессию');
    const homeserverUrl = safeOrigin(session.homeserverUrl);
    const serverName = matrixServerName(session.matrixUserId);
    const feature = await capabilities();
    if (
      session.matrixUserId !== matrixUserIdForAccount(accountId, serverName)
      || feature.serverName !== serverName
      || feature.homeserverUrl !== homeserverUrl
    ) throw new Error('VOLNA вернула несовместимую Matrix identity');
    const value = await matrixRequest(
      new URL('/_matrix/client/v3/login', homeserverUrl).toString(),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: session.loginType,
          user: session.matrixUserId,
          token: session.loginToken,
          device_id: requestedDeviceId,
          initial_device_display_name: matrixDeviceDisplayName({ platform: nativeBridge.getRuntimeInfo()?.platform ?? 'native' }),
          refresh_token: true,
        }),
      },
      'Matrix login failed',
    );
    if (
      typeof value.access_token !== 'string'
      || typeof value.refresh_token !== 'string'
      || typeof value.expires_in_ms !== 'number'
      || !Number.isSafeInteger(value.expires_in_ms)
      || value.expires_in_ms <= 0
      || value.user_id !== session.matrixUserId
      || value.device_id !== requestedDeviceId
    ) throw new Error('Matrix не вернул ограниченную по времени device session');
    return {
      v: 1,
      homeserverUrl,
      userId: value.user_id,
      deviceId: value.device_id,
      accessToken: value.access_token,
      refreshToken: value.refresh_token,
      expiresAt: Date.now() + value.expires_in_ms,
    };
  };

  const credentialRefreshers = new WeakMap<MatrixCredentials, ReturnType<typeof createMatrixCredentialRefresher<MatrixCredentials>>>();
  const refreshCredentials = async (accountId: string, deviceKey: Uint8Array, credentials: MatrixCredentials): Promise<MatrixCredentials> => {
    let refresh = credentialRefreshers.get(credentials);
    if (!refresh) {
      refresh = createMatrixCredentialRefresher({
        credentials,
        assertActive: () => assertMatrixKeyActive(deviceKey),
        checkSession: async () => {
          const sessionCheck = await request('/messaging/matrix/capabilities');
          if (!sessionCheck.ok) throw new Error('Сессия VOLNA больше не активна');
          const sessionCapability = await sessionCheck.json() as { enabled?: unknown };
          if (sessionCapability.enabled !== true) throw new Error('Matrix-сообщения выключены');
        },
        rotate: (refreshToken) => matrixRequest(
          new URL('/_matrix/client/v3/refresh', credentials.homeserverUrl).toString(),
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ refresh_token: refreshToken }),
          },
          'Matrix token refresh failed',
        ),
        persist: (next) => saveCredentials(accountId, deviceKey, next),
      });
      credentialRefreshers.set(credentials, refresh);
    }
    await refresh(credentials.refreshToken);
    return credentials;
  };

  const validateCredentials = async (credentials: MatrixCredentials) => {
    const value = await matrixRequest(
      new URL('/_matrix/client/v3/account/whoami', credentials.homeserverUrl).toString(),
      { headers: { Authorization: `Bearer ${credentials.accessToken}` } },
      'Matrix session validation failed',
    );
    return value.user_id === credentials.userId
      && (value.device_id === undefined || value.device_id === credentials.deviceId);
  };

  const registerDevice = async (credentials: MatrixCredentials) => {
    const response = await request('/messaging/matrix/device', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: credentials.userId, deviceId: credentials.deviceId }),
    });
    if (!response.ok) throw new Error('Не удалось связать Matrix-устройство с сессией VOLNA');
  };

  const startNativeSession = async (
    accountId: string,
    credentials: MatrixCredentials,
    deviceKey: Uint8Array,
  ) => {
    const started = await nativeBridge.startSession({
      accountId,
      homeserverUrl: credentials.homeserverUrl,
      userId: credentials.userId,
      deviceId: credentials.deviceId,
      accessToken: credentials.accessToken,
      refreshToken: credentials.refreshToken,
      storeKeyBase64Url: bytesToBase64Url(deviceKey),
    });
    if (
      started.accountId !== accountId
      || started.userId !== credentials.userId
      || started.deviceId !== credentials.deviceId
      || started.running !== true
    ) {
      await nativeBridge.stopSession(accountId).catch(() => undefined);
      throw new Error('Matrix native session identity mismatch');
    }
  };

  const updateFromNativeEvent = async (event: MatrixNativeSessionChangedEvent) => {
    if (!SAFE_ID.test(event.accountId)) return;
    let eventHomeserverUrl: string;
    try { eventHomeserverUrl = safeOrigin(event.homeserverUrl, options.allowInsecureDevelopmentOrigin === true); } catch { return; }
    const pending = handles.get(event.accountId);
    if (!pending) return;
    const handle = await pending.catch(() => null);
    if (
      !handle?.active
      || event.userId !== handle.credentials.userId
      || event.deviceId !== handle.credentials.deviceId
      || eventHomeserverUrl !== handle.credentials.homeserverUrl
      || typeof event.accessToken !== 'string'
      || !event.accessToken
    ) return;
    handle.credentials = {
      ...handle.credentials,
      accessToken: event.accessToken,
      refreshToken: event.refreshToken || handle.credentials.refreshToken,
    };
    await saveCredentials(handle.accountId, handle.deviceKey, handle.credentials);
  };

  const ensureSessionChangedListener = () => {
    sessionChangedSubscription ??= nativeBridge.addSessionChangedListener((event) => {
      void updateFromNativeEvent(event).catch(() => undefined);
    });
  };

  const releaseSessionChangedListenerIfIdle = () => {
    if (handles.size !== 0 || sessionChangedSubscription === null) return;
    sessionChangedSubscription.remove();
    sessionChangedSubscription = null;
  };

  const matrixAuthedRequest = (
    handle: NativeMatrixHandle,
    path: string,
    message: string,
    init: RequestInit = {},
  ) => matrixRequest(
    new URL(path, handle.credentials.homeserverUrl).toString(),
    {
      ...init,
      headers: {
        Authorization: `Bearer ${handle.credentials.accessToken}`,
        ...(init.headers ?? {}),
      },
    },
    message,
  );

  const hasRecoveryKey = async (handle: NativeMatrixHandle) => {
    const path = `/_matrix/client/v3/user/${encodeURIComponent(handle.credentials.userId)}/account_data/m.secret_storage.default_key`;
    const response = await options.fetch(new URL(path, handle.credentials.homeserverUrl).toString(), {
      headers: { Authorization: `Bearer ${handle.credentials.accessToken}` }, cache: 'no-store',
    });
    const value = await response.json();
    if (response.status === 404 && value?.errcode === 'M_NOT_FOUND') return false;
    if (!response.ok || typeof value?.key !== 'string' || !value.key) throw new Error('Не удалось проверить существующий ключ восстановления');
    return true;
  };

  const readRoomBinding = async (handle: NativeMatrixHandle, roomId: string) => {
    const value = await matrixAuthedRequest(
      handle,
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/${encodeURIComponent(MATRIX_THREAD_STATE_TYPE)}/`,
      'Matrix thread binding is unavailable',
    );
    if (value.v !== 1 || typeof value.threadId !== 'string' || !SAFE_ID.test(value.threadId)) {
      throw new Error('Matrix thread binding mismatch');
    }
    return value.threadId;
  };

  const assertRoomContract = async (
    handle: NativeMatrixHandle,
    thread: MessagingThread,
    roomId: string,
    partnerMatrixUserId = matrixUserIdForAccount(thread.partner.id, matrixServerName(handle.credentials.userId)),
  ) => {
    if (!SAFE_ROOM_ID.test(roomId) || !SAFE_MATRIX_USER_ID.test(partnerMatrixUserId)) {
      throw new Error('Matrix room identity mismatch');
    }
    const roomPath = `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}`;
    const [encryption, binding, ownMember, partnerMember, serviceMember, joined, power] = await Promise.all([
      matrixAuthedRequest(handle, `${roomPath}/state/m.room.encryption/`, 'Matrix room encryption is unavailable'),
      matrixAuthedRequest(handle, `${roomPath}/state/${encodeURIComponent(MATRIX_THREAD_STATE_TYPE)}/`, 'Matrix thread binding is unavailable'),
      matrixAuthedRequest(handle, `${roomPath}/state/m.room.member/${encodeURIComponent(handle.credentials.userId)}`, 'Matrix own membership is unavailable'),
      matrixAuthedRequest(handle, `${roomPath}/state/m.room.member/${encodeURIComponent(partnerMatrixUserId)}`, 'Matrix partner membership is unavailable'),
      matrixAuthedRequest(handle, `${roomPath}/state/m.room.member/${encodeURIComponent(`@volna_messaging:${matrixServerName(handle.credentials.userId)}`)}`, 'Matrix service membership is unavailable'),
      matrixAuthedRequest(handle, `${roomPath}/joined_members`, 'Matrix room members are unavailable'),
      matrixAuthedRequest(handle, `${roomPath}/state/m.room.power_levels/`, 'Matrix room authorization is unavailable'),
    ]);
    if (encryption.algorithm !== MATRIX_ENCRYPTION_ALGORITHM) throw new Error('Matrix room encryption algorithm mismatch');
    if (binding.v !== 1 || binding.threadId !== thread.id) throw new Error('Matrix thread binding mismatch');
    const serviceUserId = `@volna_messaging:${matrixServerName(handle.credentials.userId)}`;
    if (
      ownMember.membership !== 'join'
      || !['join', 'invite'].includes(String(partnerMember.membership))
      || serviceMember.membership !== 'join'
    ) throw new Error('Matrix room participant set mismatch');
    const joinedIds = joined.joined && typeof joined.joined === 'object' && !Array.isArray(joined.joined)
      ? Object.keys(joined.joined)
      : [];
    const expectedMembers = new Set([handle.credentials.userId, partnerMatrixUserId, serviceUserId]);
    if (
      joinedIds.some((userId) => !expectedMembers.has(userId))
      || !joinedIds.includes(handle.credentials.userId)
      || !joinedIds.includes(serviceUserId)
    ) throw new Error('Matrix room participant set mismatch');
    const users = power.users && typeof power.users === 'object' && !Array.isArray(power.users)
      ? power.users as Record<string, unknown>
      : {};
    if (
      users[serviceUserId] !== 100
      || power.state_default !== 100
      || power.invite !== 100
      || power.kick !== 100
      || power.ban !== 100
      || power.redact !== 100
    ) throw new Error('Matrix room authorization contract mismatch');
  };

  const notifyThread = (handle: NativeMatrixHandle, threadId: string) => {
    for (const listener of handle.listeners) {
      try { listener(threadId); } catch { /* Listener failures do not stop crypto sync. */ }
    }
  };

  const projectedMessages = (handle: NativeMatrixHandle, thread: MessagingThread): MessagingMessage[] => {
    const records = handle.recordsByThreadId.get(thread.id) ?? [];
    return projectMatrixContentEvents(records).map((message) => ({
      id: message.id,
      threadId: thread.id,
      senderAccountId: message.senderAccountId,
      ...(message.text === undefined ? {} : { text: message.text }),
      ...(message.attachment === undefined ? {} : { attachment: message.attachment as MessagingAttachment }),
      createdAt: message.createdAt,
      ...(message.editedAt === undefined ? {} : { editedAt: message.editedAt }),
      ...(message.deletedAt === undefined ? {} : { deletedAt: message.deletedAt }),
      reactions: message.reactions,
      securityMode: 'e2ee' as const,
    }));
  };

  const matrixThread = (handle: NativeMatrixHandle, thread: MessagingThread): MessagingThread => {
    const matrixMessages = projectedMessages(handle, thread);
    const messages = matrixMessages;
    const last = messages.at(-1);
    const roomId = handle.roomByThreadId.get(thread.id);
    const timeline = roomId ? handle.timelines?.get(roomId) : undefined;
    return {
      ...thread,
      hasMoreHistory: timeline?.hasMoreHistory === true,
      hasUndecryptableEvents: timeline?.hasUndecryptableEvents === true,
      encryptionMode: 'MATRIX_V1',
      protocolVersion: 1,
      mlsEpoch: null,
      encryptedSince: matrixMessages[0]?.createdAt ?? thread.encryptedSince,
      unreadCount: matrixMessages.filter(message => message.senderAccountId !== handle.accountId && !message.deletedAt
        && Date.parse(message.createdAt) > (thread.lastReadAt ? Date.parse(thread.lastReadAt) : 0)).length,
      messages,
      lastMessageAt: last?.createdAt ?? thread.lastMessageAt,
      lastMessageText: last ? messagePreview(last) : thread.lastMessageText,
    };
  };

  const deliverNotification = async (handle: NativeMatrixHandle, pending: PendingMatrixNotification) => {
    if (!handle.active || handle.pendingNotificationIds.has(pending.id)) return;
    handle.pendingNotificationIds.add(pending.id);
    try {
      const response = await request(`/messaging/matrix/threads/${encodeURIComponent(pending.threadId)}/notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId: pending.eventId, messageId: pending.id }),
      });
      if (!response.ok) throw new Error(`Matrix notification failed (${response.status})`);
      await mutateNotificationOutbox(handle.accountId, handle.deviceKey, (items) => items.filter((item) => item.id !== pending.id));
    } finally {
      handle.pendingNotificationIds.delete(pending.id);
    }
  };

  const flushNotificationOutbox = async (handle: NativeMatrixHandle) => {
    for (const pending of await loadNotificationOutbox(handle.accountId, handle.deviceKey)) {
      if (!handle.active) return;
      await deliverNotification(handle, pending).catch(() => undefined);
    }
  };

  const acknowledgeRemoteSend = async (
    handle: NativeMatrixHandle,
    pending: PendingMatrixSend,
    eventId: string,
  ) => {
    if (handle.acknowledgingSendIds.has(pending.id)) return;
    handle.acknowledgingSendIds.add(pending.id);
    try {
      const notification: PendingMatrixNotification = {
        v: 1,
        id: pending.id,
        threadId: pending.threadId,
        eventId,
        queuedAt: new Date().toISOString(),
      };
      // The generic, content-free push request is durable before the local send
      // is acknowledged, so an API outage cannot silently lose notification.
      await mutateNotificationOutbox(handle.accountId, handle.deviceKey, (items) => [
        ...items.filter((item) => item.id !== notification.id),
        notification,
      ]);
      await mutateOutbox(handle.accountId, handle.deviceKey, (items) => items.filter((item) => item.id !== pending.id));
      handle.pendingByLogicalId.delete(pending.id);
      void flushNotificationOutbox(handle).catch(() => undefined);
    } finally {
      handle.acknowledgingSendIds.delete(pending.id);
    }
  };

  const processNativeSnapshot = async (snapshot: MatrixNativeRoomSnapshot, admittedHandle?: NativeMatrixHandle) => {
    if (!SAFE_ID.test(snapshot.accountId) || !SAFE_ROOM_ID.test(snapshot.roomId) || !Array.isArray(snapshot.events)) return;
    const pendingHandle = handles.get(snapshot.accountId);
    const handle = pendingHandle ? await pendingHandle.catch(() => null) : null;
    if (!handle?.active || handles.get(snapshot.accountId) !== pendingHandle) return;
    const thread = handle.threadByRoomId.get(snapshot.roomId);
    if (!thread) return;
    // Page/refresh results commit only after their current room contract check.
    if (!admittedHandle && (handle.refreshPromise || handle.roomOpenTasks?.has(snapshot.roomId))) {
      // A live event can arrive while the page contract/outbox is awaiting IO.
      // Retain the newest revision, but admit it only if that operation succeeds
      // and this exact timeline is still current. Keep at most two generations.
      if (typeof snapshot.timelineId !== 'string' || !Number.isSafeInteger(snapshot.revision)) return;
      const rooms = handle.pendingTimelineSnapshots ??= new Map();
      const queued = rooms.get(snapshot.roomId) ?? new Map<string, MatrixNativeRoomSnapshot>();
      if ((queued.get(snapshot.timelineId)?.revision ?? -1) < snapshot.revision) queued.set(snapshot.timelineId, snapshot);
      while (queued.size > 2) queued.delete(queued.keys().next().value!);
      rooms.set(snapshot.roomId, queued);
      return;
    }
    if (admittedHandle && admittedHandle !== handle) return;
    const timeline = handle.timelines?.get(snapshot.roomId);
    if (!timeline || timeline.retired || timeline.id !== snapshot.timelineId || !Number.isSafeInteger(snapshot.revision)
      || snapshot.revision <= timeline.revision || typeof snapshot.hasMoreHistory !== 'boolean') return;
    timeline.revision = snapshot.revision;
    timeline.hasMoreHistory = snapshot.hasMoreHistory;
    timeline.hasUndecryptableEvents = snapshot.hasUndecryptableEvents === true;
    const partnerMatrixUserId = matrixUserIdForAccount(thread.partner.id, matrixServerName(handle.credentials.userId));
    const accepted: Array<Omit<DecryptedEventRecord, 'event'> & {
      matrixEventId: string;
      event: ReturnType<typeof normalizeContentEvent>;
    }> = [];
    for (const item of snapshot.events) {
      if (
        !item
        || item.authenticated !== true
        || typeof item.eventId !== 'string'
        || !SAFE_EVENT_ID.test(item.eventId)
        || typeof item.senderUserId !== 'string'
        || !SAFE_MATRIX_USER_ID.test(item.senderUserId)
        || (item.senderUserId !== handle.credentials.userId && item.senderUserId !== partnerMatrixUserId)
        || typeof item.timestamp !== 'number'
        || !Number.isFinite(item.timestamp)
        || item.timestamp <= 0
        || typeof item.contentJson !== 'string'
      ) continue;
      try {
        const decoded = decodeMatrixMessageContent(JSON.parse(item.contentJson));
        if (!decoded) continue;
        accepted.push({
          matrixEventId: item.eventId,
          envelopeId: matrixEnvelopeId(item.eventId),
          senderAccountId: item.senderUserId === handle.credentials.userId ? handle.accountId : thread.partner.id,
          senderDeviceId: matrixDeviceProjectionId(item.senderUserId, decoded.deviceId),
          serverCreatedAt: new Date(item.timestamp).toISOString(),
          event: decoded.event,
        });
      } catch {
        // Foreign/malformed decrypted Matrix events never reach the VOLNA UI.
      }
    }
    const remoteLogicalIds = new Set(accepted.map((record) => record.event.logicalMessageId));
    const optimistic = [...handle.pendingByLogicalId.values()]
      .filter((pending) => pending.threadId === thread.id && !remoteLogicalIds.has(pending.id))
      .map((pending): DecryptedEventRecord => ({
        envelopeId: `local_${pending.id}`,
        senderAccountId: handle.accountId,
        senderDeviceId: matrixDeviceProjectionId(handle.credentials.userId, handle.credentials.deviceId),
        serverCreatedAt: pending.queuedAt,
        event: normalizeContentEvent(pending.event),
      }));
    handle.recordsByThreadId.set(thread.id, [...accepted, ...optimistic]);
    notifyThread(handle, thread.id);
    for (const record of accepted) {
      if (record.senderAccountId !== handle.accountId) continue;
      const pending = handle.pendingByLogicalId.get(record.event.logicalMessageId);
      if (pending) void acknowledgeRemoteSend(handle, pending, record.matrixEventId).catch(() => undefined);
    }
  };

  const ensureRoomTimelineListener = () => {
    roomTimelineSubscription ??= nativeBridge.addRoomTimelineListener((snapshot) => {
      void processNativeSnapshot(snapshot).catch(() => undefined);
    });
  };

  const releaseGlobalListenersIfIdle = () => {
    releaseSessionChangedListenerIfIdle();
    if (handles.size !== 0 || roomTimelineSubscription === null) return;
    roomTimelineSubscription.remove();
    roomTimelineSubscription = null;
  };

  const submitPending = async (handle: NativeMatrixHandle, pending: PendingMatrixSend) => {
    const tasks = handle.submittingSendTasks ??= new Map<string, Promise<void>>();
    const running = tasks.get(pending.id);
    if (running) return running;
    if (!handle.active) throw new Error('Matrix session is closed');
    if (pending.submitted) return;
    const task = (async () => {
    if (!pending.partnerAccountId || !pending.roomId) {
      throw new Error('Не сохранён получатель старого сообщения. Автоотправка остановлена, сообщение не удалено.');
    }
    const roomId = handle.roomByThreadId.get(pending.threadId);
    if (!roomId) throw new Error('Matrix room is not prepared');
    const thread = handle.threadByRoomId.get(roomId);
    if (roomId !== pending.roomId || thread?.id !== pending.threadId || thread.partner.id !== pending.partnerAccountId) {
      throw new Error('Matrix identity mismatch');
    }
    handle.submittingSendIds.add(pending.id);
    try {
      await nativeBridge.bindRoomKeyRecipients(handle.accountId, pending.roomId,
        matrixUserIdForAccount(pending.partnerAccountId, matrixServerName(handle.credentials.userId)));
      const event = normalizeContentEvent(pending.event);
      const content = encodeMatrixMessageContent(event, {
        body: previewForEvent(event),
        deviceId: safeIdentifier(handle.credentials.deviceId, 'Matrix device id'),
      });
      await nativeBridge.sendMessage(handle.accountId, roomId, JSON.stringify(content));
      pending.submitted = true;
      handle.pendingByLogicalId.set(pending.id, pending);
      await mutateOutbox(handle.accountId, handle.deviceKey, (items) => items.map((item) => (
        item.id === pending.id ? { ...item, submitted: true } : item
      )));
    } finally {
      handle.submittingSendIds.delete(pending.id);
    }
    })();
    tasks.set(pending.id, task);
    try { await task; } finally { if (tasks.get(pending.id) === task) tasks.delete(pending.id); }
  };

  const flushPendingForThread = async (handle: NativeMatrixHandle, threadId: string) => {
    for (const pending of handle.pendingByLogicalId.values()) {
      // Keep unbound legacy messages visible without blocking the conversation
      // or guessing their destination from freshly downloaded room state.
      if (pending.threadId === threadId && !pending.submitted && pending.partnerAccountId && pending.roomId) {
        await submitPending(handle, pending);
      }
    }
  };

  const openNativeRoom = async (
    handle: NativeMatrixHandle,
    thread: MessagingThread,
    roomId: string,
    partnerMatrixUserId?: string,
    loadEarlier = false,
  ): Promise<MessagingThread> => {
    requireNativeRoomRuntime(nativeBridge);
    if (!SAFE_ROOM_ID.test(roomId)) throw new Error('Matrix room id is invalid');
    const expectedPeer = matrixUserIdForAccount(thread.partner.id, matrixServerName(handle.credentials.userId));
    if (partnerMatrixUserId !== undefined && partnerMatrixUserId !== expectedPeer) throw new Error('Matrix identity mismatch');
    await handle.refreshPromise;
    if (!handle.active) throw new Error('Matrix session is closed');
    const boundRoom = handle.roomByThreadId.get(thread.id);
    const boundThread = handle.threadByRoomId.get(roomId);
    if ((boundRoom && boundRoom !== roomId) || (boundThread && (boundThread.id !== thread.id || boundThread.partner.id !== thread.partner.id))) {
      throw new Error('Matrix identity mismatch');
    }
    const tasks = handle.roomOpenTasks ??= new Map<string, Promise<MessagingThread>>();
    const running = tasks.get(roomId);
    if (running) return running;
    const task = (async () => {
    await nativeBridge.bindRoomKeyRecipients(handle.accountId, roomId, expectedPeer);
    if (!handle.active) throw new Error('Matrix session is closed');
    handle.roomByThreadId.set(thread.id, roomId);
    handle.threadByRoomId.set(roomId, thread);
    try {
      let snapshot = await nativeBridge.openRoom(handle.accountId, roomId);
      await assertRoomContract(handle, thread, roomId, partnerMatrixUserId);
      if (!handle.active) throw new Error('Matrix session is closed');
      // A failed refresh/reopen must not silently shrink an already read window.
      if (handle.timelines?.get(roomId)?.retired || handle.timelines?.get(roomId)?.id !== snapshot.timelineId) {
        const depth = handle.historyDepthByRoomId?.get(roomId) ?? 100;
        for (let loaded = 100; loaded < depth && snapshot.hasMoreHistory; loaded += 100) {
          if (!handle.active) throw new Error('Matrix session is closed');
          snapshot = await nativeBridge.paginateRoom(handle.accountId, roomId, 100);
        }
        await assertRoomContract(handle, thread, roomId, partnerMatrixUserId);
      }
      if (loadEarlier && snapshot.hasMoreHistory) {
        snapshot = await nativeBridge.paginateRoom(handle.accountId, roomId, 100);
        const depths = handle.historyDepthByRoomId ??= new Map();
        depths.set(roomId, (depths.get(roomId) ?? 100) + 100);
        await assertRoomContract(handle, thread, roomId, partnerMatrixUserId);
      }
      admitNativeTimeline(handle, snapshot, roomId);
      await processNativeSnapshot(snapshot, handle);
      await flushPendingForThread(handle, thread.id);
      return matrixThread(handle, thread);
    } catch (error) {
      // A failed page retains its authenticated projection and retry cursor.
      // The controller still rechecks access/deletion metadata before rendering.
      if (!handle.timelines?.has(roomId)) {
        handle.roomByThreadId.delete(thread.id);
        handle.threadByRoomId.delete(roomId);
        // Keep the last accepted rows for the screen's explicit retry path.
        await nativeBridge.closeRoom(handle.accountId, roomId).catch(() => undefined);
      }
      throw error;
    }
    })();
    tasks.set(roomId, task);
    let completed = false;
    try { await task; completed = true; } finally {
      if (tasks.get(roomId) === task) tasks.delete(roomId);
      const queued = handle.pendingTimelineSnapshots?.get(roomId)?.get(handle.timelines?.get(roomId)?.id ?? '');
      handle.pendingTimelineSnapshots?.delete(roomId);
      if (completed && queued) await processNativeSnapshot(queued, handle);
    }
    return matrixThread(handle, thread);
  };

  const admitNativeTimeline = (handle: NativeMatrixHandle, snapshot: MatrixNativeRoomSnapshot, roomId: string) => {
    if (!handle.active) throw new Error('Matrix session is closed');
    assertMatrixKeyActive(handle.deviceKey);
    if (snapshot.accountId !== handle.accountId || snapshot.roomId !== roomId
      || typeof snapshot.timelineId !== 'string' || !/^[A-Za-z0-9_-]{8,80}$/.test(snapshot.timelineId)
      || !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0
      || typeof snapshot.hasMoreHistory !== 'boolean' || !Array.isArray(snapshot.events)) {
      throw new Error('Invalid Matrix timeline snapshot');
    }
    const timelines = handle.timelines ??= new Map();
    if (timelines.get(roomId)?.retired && timelines.get(roomId)?.id === snapshot.timelineId) {
      throw new Error('Matrix timeline is retired');
    }
    if (timelines.get(roomId)?.id !== snapshot.timelineId) {
      timelines.set(roomId, { id: snapshot.timelineId, revision: -1, hasMoreHistory: true, hasUndecryptableEvents: false });
    }
  };

  const refreshRoomIndex = async (handle: NativeMatrixHandle) => {
    requireNativeRoomRuntime(nativeBridge);
    const roomIds = (await nativeBridge.listRoomIds(handle.accountId)).filter((roomId) => SAFE_ROOM_ID.test(roomId)).slice(0, 128);
    for (const roomId of roomIds) {
      if ([...handle.roomByThreadId.values()].includes(roomId)) continue;
      try {
        await nativeBridge.openRoom(handle.accountId, roomId);
        const threadId = await readRoomBinding(handle, roomId);
        handle.roomByThreadId.set(threadId, roomId);
      } catch {
        await nativeBridge.closeRoom(handle.accountId, roomId).catch(() => undefined);
      }
    }
  };

  let renewHandle: (handle: NativeMatrixHandle) => Promise<void>;

  const scheduleRefresh = (handle: NativeMatrixHandle, retryDelay?: number) => {
    if (!handle.active) return;
    if (handle.refreshTimer !== null) clearTimeout(handle.refreshTimer);
    const requestedDelay = retryDelay ?? Math.max(1_000, handle.credentials.expiresAt - Date.now() - REFRESH_EARLY_MS);
    handle.refreshTimer = setTimeout(() => {
      handle.refreshTimer = null;
      void renewHandle(handle).catch(() => {
        if (handle.active) scheduleRefresh(handle, REFRESH_RETRY_MS);
      });
    }, Math.min(MAX_TIMER_MS, requestedDelay));
  };

  renewHandle = async (handle: NativeMatrixHandle) => {
    if (!handle.active) return;
    if (handle.refreshPromise) return handle.refreshPromise;
    const admittedRooms = new Set<string>();
    const pending = (async () => {
      let credentials: MatrixCredentials;
      try {
        credentials = await refreshCredentials(handle.accountId, handle.deviceKey, handle.credentials);
      } catch (error) {
        if (!isAuthenticationFailure(error)) throw error;
        credentials = await login(handle.accountId, handle.credentials.deviceId);
      }
      if (!handle.active) return;
      await saveCredentials(handle.accountId, handle.deviceKey, credentials);
      handle.credentials = credentials;
      await registerDevice(credentials);
      if (!handle.active) return;
      await Promise.allSettled(handle.roomOpenTasks?.values() ?? []);
      if (!handle.active) return;
      // Retain cursor/availability presentation if reopening fails, while fencing
      // every callback from the stopped SDK. A new UUID must be admitted first.
      for (const timeline of handle.timelines?.values() ?? []) timeline.retired = true;
      await startNativeSession(handle.accountId, credentials, handle.deviceKey);
      for (const [roomId, thread] of handle.threadByRoomId) {
        try {
          await nativeBridge.bindRoomKeyRecipients(handle.accountId, roomId,
            matrixUserIdForAccount(thread.partner.id, matrixServerName(handle.credentials.userId)));
          let snapshot = await nativeBridge.openRoom(handle.accountId, roomId);
          const depth = handle.historyDepthByRoomId?.get(roomId) ?? 100;
          for (let loaded = 100; loaded < depth && snapshot.hasMoreHistory; loaded += 100) {
            if (!handle.active) throw new Error('Matrix session is closed');
            snapshot = await nativeBridge.paginateRoom(handle.accountId, roomId, 100);
          }
          await assertRoomContract(handle, thread, roomId);
          admitNativeTimeline(handle, snapshot, roomId);
          await processNativeSnapshot(snapshot, handle);
          admittedRooms.add(roomId);
          await flushPendingForThread(handle, thread.id);
        } catch {
          // Retain the loaded window/depth. A subsequent explicit open validates
          // the room and restores that depth before admitting a new timeline.
        }
      }
      scheduleRefresh(handle);
    })();
    handle.refreshPromise = pending;
    try {
      await pending;
    } finally {
      if (handle.refreshPromise === pending) handle.refreshPromise = null;
      const queued = handle.pendingTimelineSnapshots;
      handle.pendingTimelineSnapshots = undefined;
      for (const [roomId, snapshots] of queued ?? []) {
        const snapshot = snapshots.get(handle.timelines?.get(roomId)?.id ?? '');
        if (admittedRooms.has(roomId) && snapshot) await processNativeSnapshot(snapshot, handle);
      }
    }
  };

  const getHandle = (accountIdValue: string) => {
    const accountId = safeIdentifier(accountIdValue, 'аккаунт Matrix');
    assertMatrixAccountOpen(accountId);
    const existing = handles.get(accountId);
    if (existing) return existing;
    const pending = (async () => {
      const feature = await capabilities();
      if (!feature.enabled) throw new Error('Matrix-сообщения пока выключены');
      requireNativeRoomRuntime(nativeBridge);
      ensureSessionChangedListener();
      ensureRoomTimelineListener();
      const requestedDeviceId = await getOrCreateDeviceId(accountId);
      const storage = createExpoMessagingStorage(accountId, requestedDeviceId);
      const deviceKey = await storage.wrappingKeyProvider.getKey(storage.wrappingKeyId);
      try {
        let credentials = await loadCredentials(accountId, deviceKey);
        if (credentials && credentials.deviceId !== requestedDeviceId) credentials = null;
        if (credentials) {
          try {
            if (credentials.expiresAt <= Date.now() + REFRESH_EARLY_MS) credentials = await refreshCredentials(accountId, deviceKey, credentials);
            else if (!await validateCredentials(credentials)) credentials = null;
          } catch (error) {
            if (isAuthenticationFailure(error)) credentials = null;
            else throw error;
          }
        }
        if (!credentials) credentials = await login(accountId, requestedDeviceId);
        await saveCredentials(accountId, deviceKey, credentials);
        await registerDevice(credentials);
        await startNativeSession(accountId, credentials, deviceKey);
        const queued = await loadOutbox(accountId, deviceKey);
        const handle: NativeMatrixHandle = {
          accountId,
          credentials,
          deviceKey,
          storage,
          refreshTimer: null,
          refreshPromise: null,
          active: true,
          roomByThreadId: new Map(),
          threadByRoomId: new Map(),
          recordsByThreadId: new Map(),
          pendingByLogicalId: new Map(queued.map((item) => [item.id, item])),
          listeners: new Set(),
          pendingNotificationIds: new Set(),
          acknowledgingSendIds: new Set(),
          submittingSendIds: new Set(),
        };
        scheduleRefresh(handle);
        void flushNotificationOutbox(handle).catch(() => undefined);
        return handle;
      } catch (error) {
        await closeMatrixKey(deviceKey);
        deviceKey.fill(0);
        storage.destroyMemoryKey();
        throw error;
      }
    })();
    handles.set(accountId, pending);
    pending.catch(() => {
      if (handles.get(accountId) === pending) {
        handles.delete(accountId);
        releaseGlobalListenersIfIdle();
      }
    });
    return pending;
  };

  const decorateThreads = async (accountId: string, threads: MessagingThread[]) => {
    if (!(await capabilities()).enabled || !threads.some((thread) => thread.encryptionMode !== 'MLS_V1')) return threads;
    const handle = await getHandle(accountId);
    await refreshRoomIndex(handle);
    return Promise.all(threads.map(async (thread) => {
      if (thread.encryptionMode === 'MLS_V1') return thread;
      const roomId = handle.roomByThreadId.get(thread.id);
      if (!roomId) return thread;
      return openNativeRoom(handle, thread, roomId);
    }));
  };

  const decorateThread = async (accountId: string, thread: MessagingThread) => (
    (await decorateThreads(accountId, [thread]))[0] ?? thread
  );

  const openThread = async (accountId: string, thread: MessagingThread, options: { loadEarlier?: boolean } = {}) => {
    if (!(await capabilities()).enabled || thread.encryptionMode === 'MLS_V1') return thread;
    const response = await request(`/messaging/matrix/threads/${encodeURIComponent(thread.id)}/prepare`, { method: 'POST' });
    if (!response.ok) throw new Error('Не удалось подготовить Matrix-комнату');
    const prepared = await response.json() as { roomId?: unknown; ownMatrixUserId?: unknown; partnerMatrixUserId?: unknown };
    const handle = await getHandle(accountId);
    const expectedPartner = matrixUserIdForAccount(thread.partner.id, matrixServerName(handle.credentials.userId));
    if (
      prepared.ownMatrixUserId !== handle.credentials.userId
      || prepared.partnerMatrixUserId !== expectedPartner
      || typeof prepared.roomId !== 'string'
      || !SAFE_ROOM_ID.test(prepared.roomId)
    ) throw new Error('Matrix identity mismatch');
    return openNativeRoom(handle, thread, prepared.roomId, expectedPartner, options.loadEarlier === true);
  };

  const sendContentEvent = async (accountId: string, thread: MessagingThread, eventValue: unknown) => {
    const handle = await getHandle(accountId);
    if (thread.encryptionMode === 'MLS_V1') throw new Error('MLS thread cannot use Matrix transport');
    const previousRoomId = handle.roomByThreadId.get(thread.id);
    const opened = await openThread(accountId, thread);
    const roomId = handle.roomByThreadId.get(opened.id);
    if (previousRoomId && roomId !== previousRoomId) throw new Error('Matrix room binding changed');
    if (!roomId || opened.encryptionMode !== 'MATRIX_V1') throw new Error('Matrix room is not prepared');
    const partnerAccountId = safeIdentifier(opened.partner.id, 'Некорректный получатель Matrix');
    await assertRoomContract(handle, opened, roomId);
    const event = normalizeContentEvent(eventValue);
    if (event.kind === 'message.create' && !opened.messages?.some(message => message.securityMode === 'e2ee')) {
      const security = await getRoomSecurity(accountId, opened);
      if (!security.partnerDevices.some(device => device.signedByOwner)) {
        throw Object.assign(new Error('Собеседник ещё не настроил защищённые сообщения. Отправьте сообщение после его первого входа в чат.'), { code: 'matrix_recipient_not_ready' });
      }
    }
    const retained = handle.pendingByLogicalId.get(event.logicalMessageId);
    if (retained && (retained.threadId !== opened.id || retained.partnerAccountId !== partnerAccountId || retained.roomId !== roomId)) {
      throw new Error('Matrix retry destination mismatch');
    }
    const pending: PendingMatrixSend = retained ?? {
      v: 1,
      id: event.logicalMessageId,
      threadId: opened.id,
      partnerAccountId,
      roomId,
      event,
      queuedAt: new Date().toISOString(),
      submitted: false,
    };
    await mutateOutbox(accountId, handle.deviceKey, (items) => [...items.filter((item) => item.id !== pending.id), pending]);
    handle.pendingByLogicalId.set(pending.id, pending);
    const previous = handle.recordsByThreadId.get(opened.id) ?? [];
    handle.recordsByThreadId.set(opened.id, [...previous.filter(record => record.envelopeId !== `local_${pending.id}`), {
      envelopeId: `local_${pending.id}`,
      senderAccountId: handle.accountId,
      senderDeviceId: matrixDeviceProjectionId(handle.credentials.userId, handle.credentials.deviceId),
      serverCreatedAt: pending.queuedAt,
      event: pending.event,
    }]);
    notifyThread(handle, opened.id);
    await submitPending(handle, pending);
    return matrixThread(handle, opened).messages;
  };

  const sendMessage = (accountId: string, thread: MessagingThread, draft: { text?: string; attachment?: MessagingAttachment; clientRequestId?: string }) => sendContentEvent(accountId, thread, {
    v: 1,
    kind: 'message.create',
    logicalMessageId: draft.clientRequestId ? safeIdentifier(draft.clientRequestId, 'Некорректный идентификатор отправки') : requestId('message'),
    clientCreatedAt: new Date().toISOString(),
    ...(draft.text === undefined ? {} : { text: draft.text }),
    ...(draft.attachment === undefined ? {} : { attachment: draft.attachment }),
  });

  const editMessage = (accountId: string, thread: MessagingThread, messageId: string, text: string) => sendContentEvent(accountId, thread, {
    v: 1,
    kind: 'message.edit',
    logicalMessageId: requestId('edit'),
    targetLogicalMessageId: messageId,
    clientCreatedAt: new Date().toISOString(),
    text,
  });

  const reactToMessage = (accountId: string, thread: MessagingThread, messageId: string, emoji: string | null) => sendContentEvent(accountId, thread, {
    v: 1,
    kind: 'message.reaction',
    logicalMessageId: requestId('reaction'),
    targetLogicalMessageId: messageId,
    clientCreatedAt: new Date().toISOString(),
    emoji,
  });

  const searchLocalMessages = async (accountId: string, queryValue: string, { limit = 100 } = {}) => {
    const query = queryValue.trim().normalize('NFKC').toLocaleLowerCase('ru-RU');
    if (query.length < 2 || !(await capabilities()).enabled) return [];
    const handle = await getHandle(accountId);
    const results: Array<{ threadId: string; message: MessagingMessage }> = [];
    for (const thread of handle.threadByRoomId.values()) {
      for (const message of projectedMessages(handle, thread)) {
        const haystack = `${message.text ?? ''} ${JSON.stringify(message.attachment ?? null)}`.normalize('NFKC').toLocaleLowerCase('ru-RU');
        if (haystack.includes(query)) results.push({ threadId: thread.id, message });
        if (results.length >= Math.min(500, Math.max(1, limit))) return results;
      }
    }
    return results;
  };

  const getRoomSecurity = async (accountId: string, thread: MessagingThread | null): Promise<MatrixRoomSecurity> => {
    if (thread && thread.encryptionMode !== 'MATRIX_V1') throw new Error('Matrix room is not active');
    requireNativeSecurityRuntime(nativeBridge);
    const handle = await getHandle(accountId);
    const partnerUserId = thread ? matrixUserIdForAccount(thread.partner.id, matrixServerName(handle.credentials.userId)) : null;
    if (thread && partnerUserId) {
      const roomId = handle.roomByThreadId.get(thread.id);
      if (!roomId) throw new Error('Matrix room is not prepared');
      await assertRoomContract(handle, thread, roomId, partnerUserId);
    }
    const userIds = partnerUserId ? [handle.credentials.userId, partnerUserId] : [handle.credentials.userId];
    const assertActive = () => {
      if (!handle.active) throw new Error('Matrix session is closed');
      assertMatrixKeyActive(handle.deviceKey);
    };
    const readKeys = async (signal?: AbortSignal) => {
      assertActive();
      const response = await matrixAuthedRequest(handle, '/_matrix/client/v3/keys/query', 'Matrix device keys are unavailable', {
        method: 'POST', signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ device_keys: Object.fromEntries(userIds.map((userId) => [userId, []])), timeout: 10_000 }),
      });
      assertActive();
      if (Object.keys(optionalObjectRecord(response.failures)).length) throw new Error('Matrix device key query was incomplete');
      return response;
    };
    let [nativeState, keyResponse] = await Promise.all([
      nativeBridge.getSecurityState(handle.accountId, userIds),
      readKeys(),
    ]);
    assertActive();
    const state = nativeState as MatrixNativeSecurityState;
    if (
      typeof state.cryptoVersion !== 'string' || state.cryptoVersion.length > 120
      || typeof state.crossSigningReady !== 'boolean'
      || typeof state.secretStorageReady !== 'boolean'
      || !Array.isArray(state.identities)
      || state.identities.length !== userIds.length
    ) throw new Error('Matrix native security state is invalid');
    const currentDevice = objectRecord(state.currentDevice, 'current device');
    if (
      currentDevice.userId !== handle.credentials.userId
      || currentDevice.deviceId !== handle.credentials.deviceId
      || typeof currentDevice.ed25519 !== 'string'
      || typeof currentDevice.curve25519 !== 'string'
    ) throw new Error('Matrix current device identity mismatch');
    // First sync publishes the fresh endpoint asynchronously. Wait only for
    // that exact local key pair; publication never grants identity trust.
    const publishedCurrentDevice = () => optionalObjectRecord(
      objectRecord(keyResponse.device_keys, 'device key response')[handle.credentials.userId],
    )[handle.credentials.deviceId];
    if (publishedCurrentDevice() === undefined) {
      await waitForPublishedMatrixDevice({
        userId: handle.credentials.userId, deviceId: handle.credentials.deviceId,
        ed25519: currentDevice.ed25519, curve25519: currentDevice.curve25519,
        readDevice: async (signal: AbortSignal) => {
          keyResponse = await readKeys(signal);
          return publishedCurrentDevice();
        },
      });
    }
    assertActive();
    const deviceKeysByUser = objectRecord(keyResponse.device_keys, 'device key response');
    const masterKeys = optionalObjectRecord(keyResponse.master_keys);
    const selfSigningKeys = optionalObjectRecord(keyResponse.self_signing_keys);
    const identityByUser = new Map(state.identities.map((identity) => {
      if (
        !identity || typeof identity !== 'object'
        || !SAFE_MATRIX_USER_ID.test(identity.userId)
        || (identity.masterKey !== null && typeof identity.masterKey !== 'string')
        || typeof identity.verified !== 'boolean'
        || typeof identity.changed !== 'boolean'
      ) throw new Error('Matrix native identity state is invalid');
      return [identity.userId, identity] as const;
    }));

    const projectDevices = (userId: string): MatrixDeviceSecurity[] => {
      const identity = identityByUser.get(userId);
      if (!identity) throw new Error('Matrix native identity state is incomplete');
      const masterValue = masterKeys[userId];
      const selfSigningValue = selfSigningKeys[userId];
      let ownerSigning: { keyId: string; publicKey: string } | null = null;
      const crossSigningDeviceIds = new Set<string>();
      if (masterValue !== undefined || selfSigningValue !== undefined || identity.masterKey !== null) {
        const master = objectRecord(masterValue, 'master key');
        const selfSigning = objectRecord(selfSigningValue, 'self-signing key');
        if (master.user_id !== userId || selfSigning.user_id !== userId) throw new Error('Matrix cross-signing user mismatch');
        if (!Array.isArray(master.usage) || master.usage.length !== 1 || master.usage[0] !== 'master') throw new Error('Matrix master key usage is invalid');
        if (!Array.isArray(selfSigning.usage) || selfSigning.usage.length !== 1 || selfSigning.usage[0] !== 'self_signing') throw new Error('Matrix self-signing key usage is invalid');
        const [masterKeyId, masterPublicKey] = oneMatrixEd25519Key(master.keys);
        const [selfSigningKeyId, selfSigningPublicKey] = oneMatrixEd25519Key(selfSigning.keys);
        crossSigningDeviceIds.add(masterKeyId.slice('ed25519:'.length));
        crossSigningDeviceIds.add(selfSigningKeyId.slice('ed25519:'.length));
        if (
          identity.masterKey !== masterPublicKey
          || !verifyMatrixSignedObject(selfSigning, userId, masterKeyId, masterPublicKey)
        ) throw new Error('Matrix cross-signing chain is invalid');
        ownerSigning = { keyId: selfSigningKeyId, publicKey: selfSigningPublicKey };
      }
      const devices = objectRecord(deviceKeysByUser[userId], 'user device keys');
      return Object.entries(devices).map(([deviceId, rawDevice]) => {
        if (!SAFE_ID.test(deviceId)) throw new Error('Matrix device id is invalid');
        if (crossSigningDeviceIds.has(deviceId)) throw new Error('Matrix device id collides with a cross-signing key');
        const device = objectRecord(rawDevice, 'device keys');
        if (device.user_id !== userId || device.device_id !== deviceId) throw new Error('Matrix device identity mismatch');
        if (!Array.isArray(device.algorithms)
          || !device.algorithms.includes('m.olm.v1.curve25519-aes-sha2')
          || !device.algorithms.includes(MATRIX_ENCRYPTION_ALGORITHM)) throw new Error('Matrix device algorithms are incomplete');
        const keys = objectRecord(device.keys, 'device keys');
        const ed25519KeyId = `ed25519:${deviceId}`;
        const curve25519KeyId = `curve25519:${deviceId}`;
        const ed25519Key = keys[ed25519KeyId];
        const curve25519Key = keys[curve25519KeyId];
        if (typeof ed25519Key !== 'string' || typeof curve25519Key !== 'string') throw new Error('Matrix device keys are incomplete');
        matrixBase64ToBytes(ed25519Key, 32);
        matrixBase64ToBytes(curve25519Key, 32);
        const signedByOwner = ownerSigning !== null
          && verifyMatrixSignedObject(device, userId, ownerSigning.keyId, ownerSigning.publicKey);
        const displayNameValue = optionalObjectRecord(device.unsigned).device_display_name;
        const current = userId === handle.credentials.userId && deviceId === handle.credentials.deviceId;
        if (current && (ed25519Key !== currentDevice.ed25519 || curve25519Key !== currentDevice.curve25519)) {
          throw new Error('Matrix current device keys changed');
        }
        return {
          userId,
          deviceId,
          displayName: typeof displayNameValue === 'string' ? displayNameValue.slice(0, 160) : null,
          ed25519: ed25519Key,
          curve25519: curve25519Key,
          current,
          verified: signedByOwner && identity.verified,
          signedByOwner,
        };
      }).sort((left, right) => Number(right.current) - Number(left.current) || left.deviceId.localeCompare(right.deviceId));
    };

    const partnerIdentity = partnerUserId ? identityByUser.get(partnerUserId) : null;
    if (partnerUserId && !partnerIdentity) throw new Error('Matrix partner identity is unavailable');
    const ownDevices = projectDevices(handle.credentials.userId);
    if (!ownDevices.some((device) => device.current)) throw new Error('Matrix current device keys are unavailable');
    const pendingVerification = state.pendingVerification === null ? null : normalizeNativeVerification(state.pendingVerification);
    const recoveryKeyExists = await hasRecoveryKey(handle);
    assertActive();
    return {
      cryptoVersion: state.cryptoVersion,
      crossSigningReady: state.crossSigningReady,
      secretStorageReady: state.secretStorageReady,
      recoveryKeyExists,
      partnerIdentityVerified: partnerIdentity?.verified ?? false,
      partnerIdentityChanged: partnerIdentity?.changed ?? false,
      ownDevices,
      partnerDevices: partnerUserId ? projectDevices(partnerUserId) : [],
      pendingVerifications: pendingVerification && userIds.includes(pendingVerification.otherUserId) && isActiveMatrixVerification(pendingVerification) ? [pendingVerification] : [],
      verificationUpdates: pendingVerification && userIds.includes(pendingVerification.otherUserId) ? [pendingVerification] : [],
    };
  };

  const verifyDevice = async (
    accountId: string,
    thread: MessagingThread,
    userId: string,
    deviceId: string,
    expectedEd25519: string,
  ) => {
    const current = await getRoomSecurity(accountId, thread);
    const device = current.partnerDevices.find((item) => item.userId === userId && item.deviceId === deviceId);
    if (!device || device.ed25519 !== expectedEd25519) throw new Error('Отпечаток Matrix-устройства изменился');
    if (!device.verified) throw new Error('Используйте SAS-проверку: ручная отметка устройства не поддерживается Rust FFI');
    return current;
  };

  const startDeviceVerification = async (accountId: string, thread: MessagingThread | null, userId: string, deviceId: string) => {
    const security = await getRoomSecurity(accountId, thread);
    const device = [...security.ownDevices, ...security.partnerDevices]
      .find((item) => item.userId === userId && item.deviceId === deviceId);
    if (!device) throw new Error('Matrix device verification target is unavailable');
    // This snapshot validates the server-published device keys against native
    // Crypto. Never send a request before our own device appears in that roster.
    if (!security.ownDevices.some((item) => item.current)) {
      throw new Error('Это устройство ещё подключается к защите сообщений. Попробуйте начать проверку через несколько секунд.');
    }
    const handle = await getHandle(accountId);
    return normalizeNativeVerification(await nativeBridge.startDeviceVerification(handle.accountId, userId, deviceId));
  };

  const verificationAction = async (
    accountId: string,
    verificationIdValue: string,
    action: (accountId: string, verificationId: string) => Promise<MatrixVerificationState>,
  ) => {
    const handle = await getHandle(accountId);
    requireNativeSecurityRuntime(nativeBridge);
    const verificationId = safeIdentifier(verificationIdValue, 'Matrix verification id');
    assertMatrixKeyActive(handle.deviceKey);
    if (!handle.active) throw new Error('Matrix session is no longer active');
    const result = await action(handle.accountId, verificationId);
    assertMatrixKeyActive(handle.deviceKey);
    if (!handle.active) throw new Error('Matrix session is no longer active');
    return normalizeNativeVerification(result);
  };

  const setupRecovery = async (accountId: string) => {
    const handle = await getHandle(accountId);
    requireNativeRecoveryRuntime(nativeBridge);
    if (await hasRecoveryKey(handle)) throw new Error('Ключ восстановления уже создан. Используйте сохранённый ключ или другое подтверждённое устройство.');
    const recoveryKey = await nativeBridge.setupRecovery(handle.accountId);
    if (typeof recoveryKey !== 'string' || recoveryKey.length < 32 || recoveryKey.length > 512) {
      throw new Error('Matrix вернул некорректный ключ восстановления');
    }
    return { recoveryKey };
  };

  const resetRecovery = async (accountId: string) => {
    const handle = await getHandle(accountId);
    const runtime = requireNativeRecoveryRuntime(nativeBridge);
    if (!runtime.features.includes('recovery-key-rotation-v1') || typeof nativeBridge.resetRecovery !== 'function') {
      throw new Error('Обновите приложение, чтобы заменить ключ восстановления.');
    }
    if (!await hasRecoveryKey(handle)) throw new Error('Ключ ещё не создан. Используйте первую настройку восстановления.');
    const state = await nativeBridge.getSecurityState(accountId, [handle.credentials.userId]);
    if (!state.crossSigningReady || !state.secretStorageReady) throw new Error('Замените ключ на подтверждённом устройстве, где восстановление уже настроено.');
    const recoveryKey = await nativeBridge.resetRecovery(accountId);
    if (typeof recoveryKey !== 'string' || recoveryKey.length < 32 || recoveryKey.length > 512) throw new Error('Matrix вернул некорректный ключ восстановления');
    return { recoveryKey };
  };

  const recoverSecurity = async (accountId: string, recoveryKeyValue: string) => {
    const recoveryKey = recoveryKeyValue.trim();
    if (recoveryKey.length < 32 || recoveryKey.length > 512) throw new Error('Некорректный ключ восстановления');
    const handle = await getHandle(accountId);
    requireNativeRecoveryRuntime(nativeBridge);
    await nativeBridge.recoverSecurity(handle.accountId, recoveryKey);
  };

  const release = async (accountIdValue: string) => {
    const accountId = safeIdentifier(accountIdValue, 'аккаунт Matrix');
    return withMatrixAccountShutdown(accountId, async () => {
    const pending = handles.get(accountId);
    handles.delete(accountId);
    if (!pending) {
      releaseGlobalListenersIfIdle();
      return;
    }
    let handle: NativeMatrixHandle | null = null;
    try {
      handle = await pending;
      handle.active = false;
      await closeMatrixKey(handle.deviceKey);
      handle.listeners.clear();
      if (handle.refreshTimer !== null) clearTimeout(handle.refreshTimer);
      await handle.refreshPromise?.catch(() => undefined);
      await nativeBridge.stopSession(accountId);
    } catch {
      // Initialization or shutdown failure retains only encrypted durable state.
    } finally {
      handle?.deviceKey.fill(0);
      handle?.storage.destroyMemoryKey();
      releaseGlobalListenersIfIdle();
    }
    });
  };

  const logout = async (accountIdValue: string) => {
    const accountId = safeIdentifier(accountIdValue, 'аккаунт Matrix');
    return withMatrixAccountShutdown(accountId, async () => {
    const pending = handles.get(accountId);
    handles.delete(accountId);
    let handle: NativeMatrixHandle | null = null;
    let storage: ReturnType<typeof createExpoMessagingStorage> | null = null;
    let deviceKey: Uint8Array | null = null;
    try {
      handle = pending ? await pending.catch(() => null) : null;
      if (handle) {
        handle.active = false;
        await closeMatrixKey(handle.deviceKey);
        handle.listeners.clear();
        if (handle.refreshTimer !== null) clearTimeout(handle.refreshTimer);
        await handle.refreshPromise?.catch(() => undefined);
        storage = handle.storage;
        deviceKey = handle.deviceKey;
      } else {
        const deviceId = await AsyncStorage.getItem(deviceStorageKey(accountId));
        if (deviceId && SAFE_ID.test(deviceId)) {
          storage = createExpoMessagingStorage(accountId, deviceId);
          deviceKey = await storage.wrappingKeyProvider.getKey(storage.wrappingKeyId).catch(() => null);
        }
      }
      await nativeBridge.logoutSession(accountId).catch(() => undefined);
    } finally {
      if (deviceKey) await closeMatrixKey(deviceKey);
      await AsyncStorage.multiRemove([
        credentialKey(accountId),
        deviceStorageKey(accountId),
        outboxStorageKey(accountId),
        notificationOutboxStorageKey(accountId),
      ]).catch(() => undefined);
      await storage?.clear().catch(() => undefined);
      deviceKey?.fill(0);
      storage?.destroyMemoryKey();
      releaseGlobalListenersIfIdle();
    }
    });
  };

  const qrVerification = (accountId: string, verificationId: string, qrCodeBase64?: string) => {
    const runtime = requireNativeSecurityRuntime(nativeBridge);
    if (!runtime.features.includes('qr-verification-v1') || !nativeBridge.generateQrVerification || !nativeBridge.scanQrVerification) {
      throw new Error('Эта версия Matrix Rust FFI не поддерживает verification QR; используйте проверку по эмодзи');
    }
    if (qrCodeBase64 !== undefined) base64UrlToBytes(qrCodeBase64, 2048).fill(0);
    return verificationAction(accountId, verificationId, (nativeAccountId, id) => qrCodeBase64 === undefined
      ? nativeBridge.generateQrVerification!(nativeAccountId, id)
      : nativeBridge.scanQrVerification!(nativeAccountId, id, qrCodeBase64));
  };

  const warmup = async (accountId: string, signal: AbortSignal) => {
    if (signal.aborted || !(await capabilities()).enabled || signal.aborted) return;
    await getHandle(accountId);
  };

  return Object.freeze({
    capabilities,
    warmup,
    decorateThread,
    decorateThreads,
    openThread,
    sendMessage,
    editMessage,
    reactToMessage,
    searchLocalMessages,
    getRoomSecurity,
    getAccountSecurity: (accountId: string) => getRoomSecurity(accountId, null),
    startOwnDeviceVerification: (accountId: string, userId: string, deviceId: string) => startDeviceVerification(accountId, null, userId, deviceId),
    verifyDevice,
    setupRecovery,
    resetRecovery,
    recoverSecurity,
    startDeviceVerification,
    acceptVerification: (accountId, verificationId) => verificationAction(accountId, verificationId, (nativeAccountId, id) => nativeBridge.acceptVerification(nativeAccountId, id)),
    startSasVerification: (accountId, verificationId) => verificationAction(accountId, verificationId, (nativeAccountId, id) => nativeBridge.startSasVerification(nativeAccountId, id)),
    generateQrVerification: (accountId, verificationId) => qrVerification(accountId, verificationId),
    scanQrVerification: (accountId, verificationId, qrCodeBase64) => qrVerification(accountId, verificationId, qrCodeBase64),
    confirmVerification: (accountId, verificationId) => verificationAction(accountId, verificationId, (nativeAccountId, id) => nativeBridge.confirmVerification(nativeAccountId, id)),
    mismatchVerification: (accountId, verificationId) => verificationAction(accountId, verificationId, (nativeAccountId, id) => nativeBridge.mismatchVerification(nativeAccountId, id)),
    cancelVerification: (accountId, verificationId) => verificationAction(accountId, verificationId, (nativeAccountId, id) => nativeBridge.cancelVerification(nativeAccountId, id)),
    subscribe: async (accountId, onThreadChanged) => {
      if (!(await capabilities()).enabled) return () => undefined;
      const handle = await getHandle(accountId);
      handle.listeners.add(onThreadChanged);
      return () => { handle.listeners.delete(onThreadChanged); };
    },
    release,
    logout,
  }) as MatrixMessagingManager;
}
