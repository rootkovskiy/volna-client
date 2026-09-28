import { assertMatrixKeyActive, assertMatrixAccountOpen, bindMatrixKeyGuard, closeMatrixKey, withMatrixKeyWrite, withMatrixAccountShutdown } from './matrix-key-lifecycle.mjs';
import { createMatrixCredentialRefresher } from './matrix-token-refresh.mjs';
import { waitForMatrixJoinedRoom } from './matrix-room-readiness.mjs';
import { createMatrixStoreOwnership, type MatrixStoreLease } from './matrix-store-ownership.mjs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { sha256 } from '@noble/hashes/sha2.js';
import * as ExpoCrypto from 'expo-crypto';
import {
  ClientEvent,
  createClient,
  EventType,
  MatrixError,
  MatrixEventEvent,
  type ICreateClientOpts,
  type MatrixClient,
  type MatrixEvent,
  RoomEvent,
  SyncState,
} from 'matrix-js-sdk';
import {
  CryptoEvent,
  EventShieldColour,
  EventShieldReason,
  OnlySignedDevicesIsolationMode,
  VerificationPhase,
  VerificationRequestEvent,
  VerifierEvent,
  type ShowQrCodeCallbacks,
  type ShowSasCallbacks,
  type VerificationRequest,
  type Verifier,
} from 'matrix-js-sdk/lib/crypto-api/index.js';
import { decodeRecoveryKey } from 'matrix-js-sdk/lib/crypto-api/recovery-key.js';
import type { Direction } from 'matrix-js-sdk/lib/models/event-timeline.js';
import contract from './index.js';
import { messagePreview } from './messaging-surface-controller.mjs';
import { matrixDeviceDisplayName } from './matrix-security-presentation.mjs';
import { requireMatrixRecipientCrypto } from './matrix-recipient-policy.mjs';
import { createMatrixVerificationFetch, waitForPublishedMatrixDevice } from './matrix-device-publication.mjs';
import { createExpoMessagingStorage } from './expo-storage-adapter';
import { bytesToBase64Url, base64UrlToBytes } from './mls-runtime.mjs';
import { createEncryptedMatrixFetch, originalEncryptedMatrixContent, projectMatrixContentEvents, sendMatrixContentOnce } from './matrix-event-policy.mjs';
import type { DecryptedEventRecord } from './message-projection.mjs';
import {
  decodeMatrixMessageContent,
  encodeMatrixMessageContent,
} from './matrix-message-codec.mjs';
import type {
  MatrixDeviceSecurity,
  MatrixMessagingManager,
  MatrixMessagingCapabilities,
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
const MATRIX_SECRET_PREFIX = '@volna/matrix/secret-storage/v1';
const MATRIX_OUTBOX_PREFIX = '@volna/matrix/outbox/v1';
const MATRIX_NOTIFICATION_OUTBOX_PREFIX = '@volna/matrix/notification-outbox/v1';
const MATRIX_CREDENTIAL_AAD = new TextEncoder().encode('VOLNA-MATRIX-CREDENTIALS-V1');
const MATRIX_SECRET_AAD = new TextEncoder().encode('VOLNA-MATRIX-SECRET-STORAGE-V1');
const MATRIX_OUTBOX_AAD = new TextEncoder().encode('VOLNA-MATRIX-OUTBOX-V1');
const MATRIX_NOTIFICATION_OUTBOX_AAD = new TextEncoder().encode('VOLNA-MATRIX-NOTIFICATION-OUTBOX-V1');
const MAX_OUTBOX_ITEMS = 256;
const MAX_OUTBOX_PLAINTEXT_BYTES = 512 * 1024 - 16;
const MAX_NOTIFICATION_OUTBOX_PLAINTEXT_BYTES = 128 * 1024 - 16;

type MatrixCredentials = {
  v: 1;
  homeserverUrl: string;
  userId: string;
  deviceId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

type MatrixHandle = {
  accountId: string;
  owner: MatrixStoreLease;
  client: MatrixClient;
  credentials: MatrixCredentials;
  deviceKey: Uint8Array;
  roomByThreadId: Map<string, string>;
  threadById: Map<string, MessagingThread>;
  localPending: Map<string, PendingMatrixSend>;
  storage: ReturnType<typeof createExpoMessagingStorage>;
  verifications: Map<string, MatrixVerificationSession>;
  pendingSendIds: Set<string>;
  pendingSendTasks?: Map<string, Promise<unknown>>;
  pendingNotificationIds: Set<string>;
};

type MatrixVerificationSession = {
  id: string;
  request: VerificationRequest;
  targetDeviceId: string | null;
  verifier: Verifier | null;
  sas: ShowSasCallbacks | null;
  qr: ShowQrCodeCallbacks | null;
  qrCodeBase64: string | null;
};

type StoredSecretStorageKey = { keyId: string; privateKey: Uint8Array };
// Legacy entries remain readable, but cannot be retried without their original
// recipient binding. Never reconstruct missing authority from a server response.
type PendingMatrixSend = { v: 1; id: string; threadId: string; partnerAccountId?: string; roomId?: string; event: unknown; queuedAt: string };
type PendingMatrixNotification = { v: 1; id: string; threadId: string; eventId: string; queuedAt: string };

function requestId(prefix: string) {
  return `${prefix}_${ExpoCrypto.randomUUID().replaceAll('-', '')}`.slice(0, 80);
}

function bytes(value: string) {
  return new TextEncoder().encode(value);
}

function safeHttpOrigin(value: unknown) {
  if (typeof value !== 'string') throw new Error('Некорректный адрес Matrix');
  const url = new URL(value);
  const loopback = url.hostname === 'localhost' || /^127(?:\.\d{1,3}){3}$/.test(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
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

function secretStorageKey(accountId: string) {
  return `${MATRIX_SECRET_PREFIX}:${accountId}`;
}

function outboxStorageKey(accountId: string) {
  return `${MATRIX_OUTBOX_PREFIX}:${accountId}`;
}

function notificationOutboxStorageKey(accountId: string) {
  return `${MATRIX_NOTIFICATION_OUTBOX_PREFIX}:${accountId}`;
}

function safeIdentifier(value: unknown, code: string) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{8,80}$/.test(value)) throw new Error(code);
  return value;
}

function matrixServerName(userId: string) {
  const separator = userId.indexOf(':');
  if (separator < 2 || separator === userId.length - 1) throw new Error('Matrix user id domain is missing');
  return userId.slice(separator + 1);
}

function matrixUserIdForAccount(accountId: string, serverName: string) {
  safeIdentifier(accountId, 'Matrix account id');
  // The API uses the hexadecimal SHA-256 prefix. Recreate it without relying on
  // server-provided participant identity.
  const hex = [...sha256(bytes(`VOLNA-MATRIX-ACCOUNT\0${accountId}`))]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
  return `@volna_${hex}:${serverName}`;
}

function matrixEventId(event: MatrixEvent) {
  const source = event.getId() ?? `${event.getSender() ?? 'unknown'}:${event.getTs()}:${JSON.stringify(event.getContent())}`;
  return `mx_${bytesToBase64Url(sha256(bytes(source))).slice(0, 48)}`;
}

function matrixDeviceProjectionId(event: MatrixEvent, advertised: string) {
  const source = `${event.getSender() ?? 'unknown'}\0${advertised}`;
  return `mxdev_${bytesToBase64Url(sha256(bytes(source))).slice(0, 40)}`;
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

export function createMatrixMessagingManager(options: {
  apiOrigin: string;
  fetch: typeof globalThis.fetch;
  getAccessToken?(): string | undefined | Promise<string | undefined>;
  includeCredentials?: boolean;
}): MatrixMessagingManager {
  const origin = safeHttpOrigin(options.apiOrigin);
  const handles = new Map<string, Promise<MatrixHandle>>();
  const secretStorageKeys = new Map<string, StoredSecretStorageKey>();
  const outboxLocks = new Map<string, Promise<void>>();
  const notificationOutboxLocks = new Map<string, Promise<void>>();
  const credentialRefreshers = new WeakMap<MatrixCredentials, ReturnType<typeof createMatrixCredentialRefresher<MatrixCredentials>>>();
  const storeOwnership = createMatrixStoreOwnership();
  let capabilitiesPromise: Promise<MatrixMessagingCapabilities> | null = null;

  const request = async (path: string, init: RequestInit = {}) => {
    const token = await options.getAccessToken?.();
    const headers = new Headers(init.headers);
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const response = await options.fetch(`${origin}${path}`, {
      ...init,
      headers,
      cache: 'no-store',
      ...(options.includeCredentials ? { credentials: 'include' as const } : {}),
    });
    return response;
  };

  const capabilities = async () => {
    capabilitiesPromise ??= (async () => {
      const response = await request('/messaging/matrix/capabilities');
      if (!response.ok) throw new Error('Не удалось проверить Matrix runtime');
      const value = await response.json() as MatrixMessagingCapabilities;
      return {
        enabled: value.enabled === true,
        protocol: 'MATRIX_V1' as const,
        loginType: typeof value.loginType === 'string' ? value.loginType : 'social.volna.session',
        homeserverUrl: value.enabled ? safeHttpOrigin(value.homeserverUrl) : null,
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
    if (existing && /^[A-Za-z0-9_-]{8,80}$/.test(existing)) return existing;
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
        const value = JSON.parse(new TextDecoder().decode(plaintext)) as MatrixCredentials;
        if (
          value.v !== 1
          || typeof value.accessToken !== 'string'
          || typeof value.refreshToken !== 'string'
          || !Number.isSafeInteger(value.expiresAt)
          || value.expiresAt <= 0
          || typeof value.userId !== 'string'
          || typeof value.deviceId !== 'string'
        ) return null;
        return { ...value, homeserverUrl: safeHttpOrigin(value.homeserverUrl) };
      } finally {
        plaintext.fill(0);
      }
    } catch {
      return null;
    }
  };

  const saveSecretStorageKey = async (accountId: string, key: Uint8Array, secret: StoredSecretStorageKey) => withMatrixKeyWrite(key, async () => {
    const nonce = new Uint8Array(24);
    ExpoCrypto.getRandomValues(nonce);
    const plaintext = bytes(JSON.stringify({
      v: 1,
      keyId: secret.keyId,
      privateKey: bytesToBase64Url(secret.privateKey),
    }));
    try {
      const ciphertext = xchacha20poly1305(key, nonce, MATRIX_SECRET_AAD).encrypt(plaintext);
      await AsyncStorage.setItem(secretStorageKey(accountId), JSON.stringify({
        v: 1,
        nonce: bytesToBase64Url(nonce),
        ciphertext: bytesToBase64Url(ciphertext),
      }));
    } finally {
      plaintext.fill(0);
      nonce.fill(0);
    }
  });

  const loadSecretStorageKey = async (accountId: string, key: Uint8Array): Promise<StoredSecretStorageKey | null> => {
    const encoded = await AsyncStorage.getItem(secretStorageKey(accountId));
    if (!encoded) return null;
    try {
      const envelope = JSON.parse(encoded) as { v?: unknown; nonce?: unknown; ciphertext?: unknown };
      if (envelope.v !== 1 || typeof envelope.nonce !== 'string' || typeof envelope.ciphertext !== 'string') return null;
      const nonce = base64UrlToBytes(envelope.nonce, 24);
      const ciphertext = base64UrlToBytes(envelope.ciphertext, 2048);
      const plaintext = xchacha20poly1305(key, nonce, MATRIX_SECRET_AAD).decrypt(ciphertext);
      try {
        const value = JSON.parse(new TextDecoder().decode(plaintext)) as { v?: unknown; keyId?: unknown; privateKey?: unknown };
        if (value.v !== 1 || typeof value.keyId !== 'string' || typeof value.privateKey !== 'string') return null;
        return {
          keyId: safeIdentifier(value.keyId, 'Matrix secret storage key id'),
          privateKey: base64UrlToBytes(value.privateKey, 64),
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
          if (value.v !== 1 || typeof value.id !== 'string' || typeof value.threadId !== 'string' || typeof value.queuedAt !== 'string') throw new Error('Не удалось прочитать очередь Matrix. Сохранённые данные не изменены.');
          if (!/^[A-Za-z0-9_-]{8,80}$/.test(value.id) || !/^[A-Za-z0-9_-]{8,80}$/.test(value.threadId)) throw new Error('Не удалось прочитать очередь Matrix. Сохранённые данные не изменены.');
          if (!Number.isFinite(Date.parse(value.queuedAt))) throw new Error('Не удалось прочитать очередь Matrix. Сохранённые данные не изменены.');
          if ((value.partnerAccountId !== undefined || value.roomId !== undefined) && (
            typeof value.partnerAccountId !== 'string' || !/^[A-Za-z0-9_-]{8,80}$/.test(value.partnerAccountId)
            || typeof value.roomId !== 'string' || !/^![^\s:]{1,255}:[^\s]{1,255}$/.test(value.roomId)
          )) throw new Error('Не удалось прочитать очередь Matrix. Сохранённые данные не изменены.');
          try { return [{ v: 1 as const, id: value.id, threadId: value.threadId,
            ...(value.partnerAccountId === undefined ? {} : { partnerAccountId: value.partnerAccountId, roomId: value.roomId }),
            event: normalizeContentEvent(value.event), queuedAt: value.queuedAt }]; }
          catch { throw new Error('Не удалось прочитать очередь Matrix. Сохранённые данные не изменены.'); }
        });
      } finally {
        plaintext.fill(0);
      }
    } catch {
      throw new Error('Не удалось прочитать очередь Matrix. Сохранённые данные не изменены.');
    }
  };

  const saveOutbox = async (accountId: string, key: Uint8Array, items: PendingMatrixSend[]) => withMatrixKeyWrite(key, async () => {
    if (!items.length) { await AsyncStorage.removeItem(outboxStorageKey(accountId)); return; }
    if (items.length > MAX_OUTBOX_ITEMS) throw new Error('Очередь Matrix переполнена');
    const nonce = new Uint8Array(24);
    ExpoCrypto.getRandomValues(nonce);
    const plaintext = bytes(JSON.stringify(items));
    try {
      if (plaintext.length > MAX_OUTBOX_PLAINTEXT_BYTES) throw new Error('Очередь Matrix переполнена');
      const ciphertext = xchacha20poly1305(key, nonce, MATRIX_OUTBOX_AAD).encrypt(plaintext);
      await AsyncStorage.setItem(outboxStorageKey(accountId), JSON.stringify({ v: 1, nonce: bytesToBase64Url(nonce), ciphertext: bytesToBase64Url(ciphertext) }));
    } finally {
      plaintext.fill(0);
      nonce.fill(0);
    }
  });

  const mutateOutbox = async (accountId: string, key: Uint8Array, mutate: (items: PendingMatrixSend[]) => PendingMatrixSend[]) => {
    const previous = outboxLocks.get(accountId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(async () => {
      assertMatrixKeyActive(key);
      const items = await loadOutbox(accountId, key);
      assertMatrixKeyActive(key);
      await saveOutbox(accountId, key, mutate(items));
    });
    outboxLocks.set(accountId, current);
    try { await current; } finally { if (outboxLocks.get(accountId) === current) outboxLocks.delete(accountId); }
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
          ) throw new Error('Не удалось прочитать очередь Matrix. Сохранённые данные не изменены.');
          if (
            !/^[A-Za-z0-9_-]{8,80}$/.test(value.id)
            || !/^[A-Za-z0-9_-]{8,80}$/.test(value.threadId)
            || value.eventId.length < 2
            || value.eventId.length > 255
            || /[\u0000-\u001f\u007f]/.test(value.eventId)
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

  const saveNotificationOutbox = async (accountId: string, key: Uint8Array, items: PendingMatrixNotification[]) => withMatrixKeyWrite(key, async () => {
    if (!items.length) { await AsyncStorage.removeItem(notificationOutboxStorageKey(accountId)); return; }
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
    try { await current; } finally {
      if (notificationOutboxLocks.get(accountId) === current) notificationOutboxLocks.delete(accountId);
    }
  };

  const login = async (accountId: string, deviceId: string): Promise<MatrixCredentials> => {
    const sessionResponse = await request('/messaging/matrix/session', { method: 'POST' });
    if (!sessionResponse.ok) throw new Error('Не удалось создать одноразовую Matrix-сессию');
    const session = await sessionResponse.json() as {
      loginType: string;
      loginToken: string;
      matrixUserId: string;
      homeserverUrl: string;
    };
    if (
      session.loginType !== 'social.volna.session'
      || typeof session.loginToken !== 'string'
      || !session.loginToken
      || typeof session.matrixUserId !== 'string'
      || !/^@[a-z0-9._=/\-]+:[a-z0-9.-]+(?::[0-9]+)?$/.test(session.matrixUserId)
    ) throw new Error('VOLNA вернула некорректную Matrix-сессию');
    const homeserverUrl = safeHttpOrigin(session.homeserverUrl);
    const serverName = matrixServerName(session.matrixUserId);
    const feature = await capabilities();
    if (
      session.matrixUserId !== matrixUserIdForAccount(accountId, serverName)
      || feature.serverName !== serverName
      || feature.homeserverUrl !== homeserverUrl
    ) throw new Error('VOLNA вернула несовместимую Matrix identity');
    const bootstrapClient = createClient({ baseUrl: homeserverUrl });
    const result = await bootstrapClient.loginRequest({
      type: session.loginType,
      user: session.matrixUserId,
      token: session.loginToken,
      device_id: deviceId,
      initial_device_display_name: matrixDeviceDisplayName({ userAgent: typeof navigator === 'undefined' ? '' : navigator.userAgent }),
      refresh_token: true,
    });
    if (!result.access_token || !result.refresh_token || !result.expires_in_ms || !result.user_id || !result.device_id) {
      throw new Error('Matrix не вернул ограниченную по времени device session');
    }
    return {
      v: 1,
      homeserverUrl,
      userId: result.user_id,
      deviceId: result.device_id,
      accessToken: result.access_token,
      refreshToken: result.refresh_token,
      expiresAt: Date.now() + result.expires_in_ms,
    };
  };

  const startPreparedSync = (client: MatrixClient) => new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      client.off(ClientEvent.Sync, onSync);
      reject(new Error('Matrix initial sync timeout'));
    }, 20_000);
    const onSync = (state: SyncState) => {
      if (state !== SyncState.Prepared) return;
      clearTimeout(timeout);
      client.off(ClientEvent.Sync, onSync);
      resolve();
    };
    client.on(ClientEvent.Sync, onSync);
    void client.startClient({ initialSyncLimit: 50, lazyLoadMembers: true }).catch((error) => {
      clearTimeout(timeout);
      client.off(ClientEvent.Sync, onSync);
      reject(error);
    });
  });

  const crossSigningAuth = (accountId: string) => async <T>(makeRequest: (authData: Record<string, unknown> | null) => Promise<T>) => {
    try {
      return await makeRequest(null);
    } catch (error) {
      const session = error instanceof MatrixError && typeof error.data?.session === 'string' ? error.data.session : null;
      if (!session) throw error;
      const response = await request('/messaging/matrix/session', { method: 'POST' });
      if (!response.ok) throw new Error('Не удалось подтвердить загрузку Matrix-ключей');
      const grant = await response.json() as { loginType?: unknown; loginToken?: unknown };
      if (grant.loginType !== 'social.volna.session' || typeof grant.loginToken !== 'string') {
        throw new Error('VOLNA вернула некорректное подтверждение Matrix');
      }
      return makeRequest({ type: grant.loginType, token: grant.loginToken, session });
    }
  };

  const verificationId = (requestValue: VerificationRequest) => (
    requestValue.transactionId && /^[A-Za-z0-9._=-]{1,255}$/.test(requestValue.transactionId)
      ? requestValue.transactionId
      : requestId('verification')
  );

  const bindVerifier = (session: MatrixVerificationSession, verifier: Verifier) => {
    session.verifier = verifier;
    verifier.on(VerifierEvent.ShowSas, (sas) => { session.sas = sas; });
    verifier.on(VerifierEvent.ShowReciprocateQr, (qr) => { session.qr = qr; });
    void verifier.verify().catch(() => undefined);
  };

  const registerVerification = (handle: MatrixHandle, requestValue: VerificationRequest, targetDeviceId: string | null = null) => {
    // The SDK can return another JS wrapper for the same Rust transaction.
    const existing = [...handle.verifications.values()].find((item) => item.request === requestValue || (
      requestValue.transactionId && item.request.transactionId === requestValue.transactionId
      && item.request.otherUserId === requestValue.otherUserId
    ));
    if (existing) {
      existing.targetDeviceId ??= targetDeviceId;
      return existing;
    }
    const id = verificationId(requestValue);
    const session: MatrixVerificationSession = {
      id,
      request: requestValue,
      targetDeviceId,
      verifier: null,
      sas: null,
      qr: null,
      qrCodeBase64: null,
    };
    handle.verifications.set(id, session);
    requestValue.on(VerificationRequestEvent.Change, () => {
      if (requestValue.verifier && session.verifier !== requestValue.verifier) bindVerifier(session, requestValue.verifier);
    });
    if (requestValue.verifier) bindVerifier(session, requestValue.verifier);
    return session;
  };

  const verificationState = (session: MatrixVerificationSession): MatrixVerificationState => {
    const phase = session.request.phase === VerificationPhase.Done
      ? 'done'
      : session.request.phase === VerificationPhase.Cancelled
        ? 'cancelled'
        : session.request.phase === VerificationPhase.Started
          ? 'started'
          : session.request.phase === VerificationPhase.Ready
            ? 'ready'
            : 'requested';
    return {
      id: session.id,
      phase,
      initiatedByMe: session.request.initiatedByMe,
      otherUserId: session.request.otherUserId,
      otherDeviceId: session.request.otherDeviceId ?? session.targetDeviceId,
      sasDecimal: session.sas?.sas.decimal ?? null,
      sasEmoji: session.sas?.sas.emoji ?? [],
      qrCodeBase64: session.qrCodeBase64,
      qrSupported: true,
      qrNeedsConfirmation: phase === 'started' && Boolean(session.qr),
    };
  };

  const refreshRoomIndex = async (handle: MatrixHandle) => {
    const before = new Set(handle.roomByThreadId.keys());
    for (const room of handle.client.getRooms()) {
      const state = room.currentState.getStateEvents(MATRIX_THREAD_STATE_TYPE, '');
      const content = state?.getContent<{ v?: unknown; threadId?: unknown }>();
      if (content?.v !== 1 || typeof content.threadId !== 'string' || !/^[A-Za-z0-9_-]{8,80}$/.test(content.threadId)) continue;
      if (room.getMyMembership() === 'invite') {
        try { await handle.client.joinRoom(room.roomId); } catch { continue; }
      }
      if (room.getMyMembership() === 'join') handle.roomByThreadId.set(content.threadId, room.roomId);
    }
    return [...handle.roomByThreadId.keys()].filter((threadId) => !before.has(threadId));
  };

  const refreshCredentials = async (accountId: string, deviceKey: Uint8Array, credentials: MatrixCredentials, refreshToken: string) => {
    let refresh = credentialRefreshers.get(credentials);
    if (!refresh) {
      refresh = createMatrixCredentialRefresher({
        credentials,
        assertActive: () => assertMatrixKeyActive(deviceKey),
        persist: (next) => saveCredentials(accountId, deviceKey, next),
        checkSession: async () => {
          const sessionCheck = await request('/messaging/matrix/capabilities');
          if (sessionCheck.status === 401 || sessionCheck.status === 403) {
            throw new MatrixError({ errcode: 'M_UNKNOWN_TOKEN', error: 'VOLNA session is no longer active' }, 401);
          }
          if (!sessionCheck.ok) throw new Error('Не удалось проверить соединение с VOLNA');
        },
        rotate: async (token) => {
          const refreshUrl = new URL('/_matrix/client/v3/refresh', credentials.homeserverUrl);
          const response = await globalThis.fetch(refreshUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ refresh_token: token }),
            signal: AbortSignal.timeout(20_000),
          });
          const value = await response.json().catch(() => ({})) as {
            access_token?: unknown;
            refresh_token?: unknown;
            expires_in_ms?: unknown;
            errcode?: string;
            error?: string;
          };
          if (response.status === 401 || response.status === 403) throw new MatrixError(value, response.status, refreshUrl.toString());
          if (!response.ok) throw new Error('Не удалось обновить соединение с сообщениями');
          return value;
        },
      });
      credentialRefreshers.set(credentials, refresh);
    }
    return refresh(refreshToken);
  };

  const getHandle = (accountIdValue: string) => {
    const accountId = safeIdentifier(accountIdValue, 'Некорректный аккаунт Matrix');
    assertMatrixAccountOpen(accountId);
    const existing = handles.get(accountId);
    if (existing) return existing.then(handle => { handle.owner.assertActive(); return handle; });
    const pending = (async () => {
      const feature = await capabilities();
      if (!feature.enabled) throw new Error('Matrix-сообщения пока выключены');
      let initializingKey: Uint8Array | undefined;
      let initializingClient: MatrixClient | undefined;
      const owner = await storeOwnership.acquire(accountId, () => {
        // Fence synchronously, including a suspended tab's first late write.
        if (initializingKey) void closeMatrixKey(initializingKey);
        initializingClient?.stopClient();
        void release(accountId).catch(() => undefined);
      });
      try {
      await cleanPendingLogout(accountId, owner);
      owner.assertActive();
      const deviceId = await getOrCreateDeviceId(accountId);
      const storage = createExpoMessagingStorage(accountId, deviceId);
      const deviceKey = await storage.wrappingKeyProvider.getKey(storage.wrappingKeyId);
      initializingKey = deviceKey;
      try {
      bindMatrixKeyGuard(deviceKey, owner.assertActive);
      owner.assertActive();
      let credentials = await loadCredentials(accountId, deviceKey);
      owner.assertActive();
      if (credentials) {
          // A temporary MatrixClient has no refresh callback and emits a noisy
          // console error as soon as a persisted short-lived token expires.
          // Probe the credential directly; the real client below owns refresh.
          const whoamiUrl = new URL('/_matrix/client/v3/account/whoami', credentials.homeserverUrl);
          const response = await globalThis.fetch(whoamiUrl, {
            headers: { Authorization: `Bearer ${credentials.accessToken}` },
          });
          const identity = await response.json().catch(() => ({})) as { user_id?: unknown; device_id?: unknown; errcode?: unknown };
          if (response.status === 401 && identity.errcode === 'M_UNKNOWN_TOKEN') {
            // Keep the same device and its keys across short-lived access-token expiry.
            await refreshCredentials(accountId, deviceKey, credentials, credentials.refreshToken);
          } else if (!response.ok) {
            throw new Error('Не удалось восстановить соединение с сообщениями');
          } else if (identity.user_id !== credentials.userId || identity.device_id !== credentials.deviceId) {
            throw new Error('Matrix stored session identity mismatch');
          }
      }
      if (!credentials) {
        owner.assertActive();
        credentials = await login(accountId, deviceId);
        await saveCredentials(accountId, deviceKey, credentials);
      }
      owner.assertActive();
      const deviceRegistration = await request('/messaging/matrix/device', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: credentials.userId, deviceId: credentials.deviceId }),
      });
      if (!deviceRegistration.ok) throw new Error('Не удалось связать Matrix-устройство с сессией VOLNA');
      const persistedSecret = await loadSecretStorageKey(accountId, deviceKey);
      owner.assertActive();
      if (persistedSecret) secretStorageKeys.set(accountId, persistedSecret);
      const createOptions: ICreateClientOpts = {
        baseUrl: credentials.homeserverUrl,
        accessToken: credentials.accessToken,
        refreshToken: credentials.refreshToken,
        userId: credentials.userId,
        deviceId: credentials.deviceId,
        timelineSupport: true,
        verificationMethods: ['m.sas.v1', 'm.qr_code.show.v1', 'm.qr_code.scan.v1', 'm.reciprocate.v1'],
        cryptoCallbacks: {
          getSecretStorageKey: async ({ keys }) => {
            try { assertMatrixKeyActive(deviceKey); } catch { return null; }
            const stored = secretStorageKeys.get(accountId);
            if (!stored || !keys[stored.keyId]) return null;
            return [stored.keyId, stored.privateKey.slice() as Uint8Array<ArrayBuffer>];
          },
          cacheSecretStorageKey: (keyId, _keyInfo, privateKey) => {
            try { assertMatrixKeyActive(deviceKey); } catch { return; }
            const stored = { keyId, privateKey: privateKey.slice() };
            secretStorageKeys.get(accountId)?.privateKey.fill(0);
            secretStorageKeys.set(accountId, stored);
            void saveSecretStorageKey(accountId, deviceKey, stored).catch(() => {
              if (secretStorageKeys.get(accountId) === stored) {
                stored.privateKey.fill(0);
                secretStorageKeys.delete(accountId);
              }
            });
          },
        },
        tokenRefreshFunction: (refreshToken) => refreshCredentials(accountId, deviceKey, credentials, refreshToken),
      };
      const client: MatrixClient = createClient({ ...createOptions, fetchFn: createMatrixVerificationFetch({
        fetch: createEncryptedMatrixFetch((input, init) => {
          owner.assertActive();
          return globalThis.fetch(input, init);
        }, credentials.homeserverUrl),
        homeserverUrl: credentials.homeserverUrl,
        userId: credentials.userId,
        refreshOwnDeviceKeys: async () => {
          const crypto = client.getCrypto();
          if (!crypto) throw new Error('Matrix Rust Crypto is unavailable');
          await crypto.userHasCrossSigningKeys(credentials.userId, true);
        },
      }) });
      initializingClient = client;
      const handle: MatrixHandle = {
        accountId,
        owner,
        client,
        credentials,
        deviceKey,
        roomByThreadId: new Map(),
        threadById: new Map(),
        localPending: new Map(),
        storage,
        verifications: new Map(),
        pendingSendIds: new Set(),
        pendingNotificationIds: new Set(),
      };
      const onVerificationRequest = (verificationRequest: VerificationRequest) => {
        registerVerification(handle, verificationRequest);
      };
      // Queued to-device requests arrive DURING the first sync, before Prepared.
      client.on(CryptoEvent.VerificationRequestReceived, onVerificationRequest);
      try {
        await client.initRustCrypto({
          cryptoDatabasePrefix: `volna-matrix-${bytesToBase64Url(sha256(bytes(accountId))).slice(0, 20)}`,
          storageKey: deviceKey.slice(),
          useIndexedDB: true,
        });
        owner.assertActive();
        const crypto = client.getCrypto();
        if (!crypto) throw new Error('Matrix Rust Crypto is unavailable');
        crypto.setDeviceIsolationMode(new OnlySignedDevicesIsolationMode());
        requireMatrixRecipientCrypto(crypto);
        await startPreparedSync(client);
        owner.assertActive();
        for (const verificationRequest of crypto.getVerificationRequestsToDeviceInProgress(credentials.userId)) {
          registerVerification(handle, verificationRequest);
        }
        // The SDK refreshes our own identity in this call. A stale local status
        // must never cause initial bootstrap to replace an existing master key.
        if (!await crypto.userHasCrossSigningKeys(credentials.userId, true)) {
          await crypto.bootstrapCrossSigning({ authUploadDeviceSigningKeys: crossSigningAuth(accountId) });
        }
        await refreshRoomIndex(handle);
        await flushOutbox(handle);
        owner.assertActive();
        return handle;
      } catch (error) {
        client.off(CryptoEvent.VerificationRequestReceived, onVerificationRequest);
        client.stopClient();
        await closeMatrixKey(deviceKey);
        secretStorageKeys.get(accountId)?.privateKey.fill(0);
        secretStorageKeys.delete(accountId);
        deviceKey.fill(0);
        storage.destroyMemoryKey();
        throw error;
      }
      } catch (error) {
        await closeMatrixKey(deviceKey);
        secretStorageKeys.get(accountId)?.privateKey.fill(0);
        secretStorageKeys.delete(accountId);
        deviceKey.fill(0);
        storage.destroyMemoryKey();
        throw error;
      }
      } catch (error) {
        initializingClient?.stopClient();
        await owner.release();
        throw error;
      }
    })();
    handles.set(accountId, pending);
    pending.catch(() => { if (handles.get(accountId) === pending) handles.delete(accountId); });
    return pending;
  };

  const messagesForRoom = async (handle: MatrixHandle, thread: MessagingThread, roomId: string, onUnavailable?: () => void): Promise<MessagingMessage[]> => {
    const room = handle.client.getRoom(roomId);
    if (!room) return [];
    const visibleEvents = room.getLiveTimeline().getEvents().filter(event => !thread.visibility?.clearedBefore
      || event.getTs() > Date.parse(thread.visibility.clearedBefore));
    const records = (await Promise.all(visibleEvents.map(async (event): Promise<DecryptedEventRecord[]> => {
      try {
      let decoded: ReturnType<typeof decodeMatrixMessageContent>;
      try { decoded = decodeMatrixMessageContent(originalEncryptedMatrixContent(event)); } catch { return []; }
      if (!decoded) return [];
      const authenticity = await handle.client.getCrypto()?.getEncryptionInfoForEvent(event);
      if (!authenticity || (authenticity.shieldColour !== EventShieldColour.NONE
          && authenticity.shieldReason !== EventShieldReason.UNVERIFIED_IDENTITY)) { onUnavailable?.(); return []; }
      const sender = event.getSender();
      const partnerMatrixUserId = matrixUserIdForAccount(thread.partner.id, matrixServerName(handle.credentials.userId));
      if (sender !== handle.credentials.userId && sender !== partnerMatrixUserId) return [];
      const senderAccountId = sender === handle.credentials.userId
        ? handle.accountId
        : thread.partner.id;
      return [{
        envelopeId: matrixEventId(event),
        senderAccountId,
        senderDeviceId: matrixDeviceProjectionId(event, decoded.deviceId),
        serverCreatedAt: new Date(event.getTs()).toISOString(),
        event: decoded.event,
      }];
      } catch { return []; }
    }))).flat();
    const remoteIds = new Set(records.filter((item) => item.senderAccountId === handle.accountId).map((item) => normalizeContentEvent(item.event).logicalMessageId));
    const optimistic: DecryptedEventRecord[] = [...handle.localPending.values()]
      .filter((item) => item.threadId === thread.id && !remoteIds.has(item.id))
      .map((item) => ({ envelopeId: `local_${item.id}`, senderAccountId: handle.accountId,
        senderDeviceId: handle.credentials.deviceId, serverCreatedAt: item.queuedAt, event: normalizeContentEvent(item.event) }));
    return projectMatrixContentEvents([...records, ...optimistic]).map((message) => ({
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

  const assertRoomContract = async (handle: MatrixHandle, thread: { id: string; partner: { id: string } }, roomId: string) => {
    const room = await waitForMatrixJoinedRoom(handle.client, roomId, {
      assertActive: () => assertMatrixKeyActive(handle.deviceKey),
    });
    // Lazy sync omits members without recent events. Validate the complete set.
    await room.loadMembersIfNeeded();
    assertMatrixKeyActive(handle.deviceKey);
    if (room.getMyMembership() !== 'join') throw new Error('Matrix room membership is missing');
    if (!await handle.client.isRoomEncrypted(roomId)) throw new Error('Matrix room encryption is missing');
    const encryption = room.currentState.getStateEvents(EventType.RoomEncryption, '');
    if (encryption?.getContent<{ algorithm?: unknown }>().algorithm !== MATRIX_ENCRYPTION_ALGORITHM) {
      throw new Error('Matrix room encryption algorithm mismatch');
    }
    const binding = room.currentState.getStateEvents(MATRIX_THREAD_STATE_TYPE, '');
    const bindingContent = binding?.getContent<{ v?: unknown; threadId?: unknown }>();
    if (bindingContent?.v !== 1 || bindingContent.threadId !== thread.id) throw new Error('Matrix thread binding mismatch');

    const serverName = matrixServerName(handle.credentials.userId);
    const partnerMatrixUserId = matrixUserIdForAccount(safeIdentifier(thread.partner.id, 'собеседник Matrix'), serverName);
    if (!partnerMatrixUserId.startsWith('@volna_') || !partnerMatrixUserId.endsWith(`:${serverName}`)
        || partnerMatrixUserId === handle.credentials.userId) throw new Error('Matrix partner identity mismatch');
    const serviceUserId = `@volna_messaging:${serverName}`;
    const expectedMembers = new Set([handle.credentials.userId, partnerMatrixUserId, serviceUserId]);
    const activeMembers = room.currentState.getStateEvents(EventType.RoomMember)
      .filter((event) => ['join', 'invite'].includes(String(event.getContent<{ membership?: string }>().membership)))
      .map((event) => event.getStateKey())
      .filter((userId): userId is string => typeof userId === 'string');
    if (
      activeMembers.some((userId) => !expectedMembers.has(userId))
      || !activeMembers.includes(handle.credentials.userId)
      || !activeMembers.includes(partnerMatrixUserId)
      || !activeMembers.includes(serviceUserId)
    ) throw new Error('Matrix room participant set mismatch');

    const power = room.currentState.getStateEvents(EventType.RoomPowerLevels, '')?.getContent<{
      users?: Record<string, unknown>;
      state_default?: unknown;
      invite?: unknown;
      kick?: unknown;
      ban?: unknown;
      redact?: unknown;
    }>();
    if (
      power?.users?.[serviceUserId] !== 100
      || power.state_default !== 100
      || power.invite !== 100
      || power.kick !== 100
      || power.ban !== 100
      || power.redact !== 100
    ) throw new Error('Matrix room authorization contract mismatch');
    return room;
  };

  const matrixThread = async (handle: MatrixHandle, thread: MessagingThread, roomId: string): Promise<MessagingThread> => {
    let authenticationUnavailable = false;
    const matrixMessages = await messagesForRoom(handle, thread, roomId, () => { authenticationUnavailable = true; });
    const messages = matrixMessages;
    const last = messages.at(-1);
    return {
      ...thread,
      encryptionMode: 'MATRIX_V1',
      protocolVersion: 1,
      mlsEpoch: null,
      encryptedSince: matrixMessages[0]?.createdAt ?? thread.encryptedSince,
      hasMoreHistory: Boolean(handle.client.getRoom(roomId)?.getLiveTimeline().getPaginationToken('b' as Direction)),
      hasUndecryptableEvents: authenticationUnavailable || (handle.client.getRoom(roomId)?.getLiveTimeline().getEvents()
        .some((event) => event.getWireType() === 'm.room.encrypted' && event.isDecryptionFailure()
          && (!thread.visibility?.clearedBefore || event.getTs() > Date.parse(thread.visibility.clearedBefore))) ?? false),
      unreadCount: matrixMessages.filter(message => message.senderAccountId !== handle.accountId && !message.deletedAt
        && Date.parse(message.createdAt) > (thread.lastReadAt ? Date.parse(thread.lastReadAt) : 0)).length,
      messages,
      lastMessageAt: last?.createdAt ?? thread.lastMessageAt,
      lastMessageText: last ? messagePreview(last) : thread.lastMessageText,
    };
  };

  const decorateThread = async (accountId: string, thread: MessagingThread) => {
    return (await decorateThreads(accountId, [thread]))[0] ?? thread;
  };

  const decorateThreads = async (accountId: string, threads: MessagingThread[]) => {
    if (!(await capabilities()).enabled || !threads.some((thread) => thread.encryptionMode !== 'MLS_V1')) return threads;
    const handle = await getHandle(accountId);
    await refreshRoomIndex(handle);
    return Promise.all(threads.map(async (thread) => {
      if (thread.encryptionMode === 'MLS_V1') return thread;
      const roomId = handle.roomByThreadId.get(thread.id);
      if (!roomId) return thread;
      await assertRoomContract(handle, thread, roomId);
      handle.threadById.set(thread.id, { ...thread, messages: [] });
      return matrixThread(handle, thread, roomId);
    }));
  };

  const openThread = async (accountId: string, thread: MessagingThread) => {
    if (!(await capabilities()).enabled || thread.encryptionMode === 'MLS_V1') return thread;
    const response = await request(`/messaging/matrix/threads/${encodeURIComponent(thread.id)}/prepare`, { method: 'POST' });
    if (!response.ok) throw new Error('Не удалось подготовить Matrix-комнату');
    const prepared = await response.json() as { roomId: string; ownMatrixUserId: string; partnerMatrixUserId: string };
    const handle = await getHandle(accountId);
    const expectedPartner = matrixUserIdForAccount(thread.partner.id, matrixServerName(handle.credentials.userId));
    if (prepared.ownMatrixUserId !== handle.credentials.userId || prepared.partnerMatrixUserId !== expectedPartner
        || typeof prepared.roomId !== 'string' || !/^![^\s:]{1,255}:[^\s]{1,255}$/.test(prepared.roomId)) {
      throw new Error('Matrix identity mismatch');
    }
    await requireMatrixRecipientCrypto(handle.client.getCrypto()).bindRoomKeyRecipients(prepared.roomId, expectedPartner);
    await handle.client.joinRoom(prepared.roomId);
    const room = await assertRoomContract(handle, thread, prepared.roomId);
    handle.roomByThreadId.set(thread.id, prepared.roomId);
    handle.threadById.set(thread.id, { ...thread, messages: [] });
    await handle.client.scrollback(room, 100);
    // /messages installs events before asynchronous Megolm decryption finishes.
    // Project the page only after the SDK has completed those attempts; otherwise
    // its rows arrive in a later realtime refresh and bypass the scroll anchor.
    await Promise.all(room.getLiveTimeline().getEvents()
      .filter(event => event.getWireType() === 'm.room.encrypted')
      .map(event => handle.client.decryptEventIfNeeded(event).catch(() => undefined)));
    assertMatrixKeyActive(handle.deviceKey);
    return matrixThread(handle, thread, prepared.roomId);
  };

  const sendPending = async (handle: MatrixHandle, pending: PendingMatrixSend) => {
    const tasks = handle.pendingSendTasks ??= new Map<string, Promise<unknown>>();
    const running = tasks.get(pending.id);
    if (running) return running;
    const task = (async () => {
    if (!pending.partnerAccountId || !pending.roomId) {
      throw new Error('Не сохранён получатель старого сообщения. Автоотправка остановлена, сообщение не удалено.');
    }
    const expectedPartner = matrixUserIdForAccount(pending.partnerAccountId, matrixServerName(handle.credentials.userId));
    handle.pendingSendIds.add(pending.id);
    try {
      // Synced social.volna.thread claims are discovery hints, not send authority.
      const response = await request(`/messaging/matrix/threads/${encodeURIComponent(pending.threadId)}/prepare`, { method: 'POST' });
      if (!response.ok) throw Object.assign(new Error('Не удалось подтвердить Matrix-комнату для отправки'), {
        code: [401, 403, 404].includes(response.status) ? 'matrix_send_not_authorized' : 'matrix_send_unavailable',
      });
      const prepared = await response.json() as { roomId?: unknown; ownMatrixUserId?: unknown; partnerMatrixUserId?: unknown };
      if (prepared.ownMatrixUserId !== handle.credentials.userId || prepared.roomId !== pending.roomId
          || prepared.partnerMatrixUserId !== expectedPartner) throw new Error('Matrix identity mismatch');
      const roomId = prepared.roomId;
      await requireMatrixRecipientCrypto(handle.client.getCrypto()).bindRoomKeyRecipients(roomId, expectedPartner);
      await handle.client.joinRoom(roomId);
      const room = await assertRoomContract(handle, { id: pending.threadId, partner: { id: pending.partnerAccountId } }, roomId);
      handle.roomByThreadId.set(pending.threadId, roomId);
      const event = normalizeContentEvent(pending.event);
      const sent = await sendMatrixContentOnce(handle.client, room, encodeMatrixMessageContent(event, {
        body: previewForEvent(event),
        deviceId: safeIdentifier(handle.credentials.deviceId, 'Matrix device id'),
      }) as any, pending.id);
      if (typeof sent.event_id !== 'string' || !sent.event_id.startsWith('$')) throw new Error('Matrix send acknowledgement is missing');
      if (typeof sent.event_id === 'string') {
        const notification: PendingMatrixNotification = {
          v: 1,
          id: pending.id,
          threadId: pending.threadId,
          eventId: sent.event_id,
          queuedAt: new Date().toISOString(),
        };
        // Persist the content-free notification before acknowledging the send
        // locally, so an API outage cannot silently lose the recipient push.
        await mutateNotificationOutbox(handle.accountId, handle.deviceKey, (items) => [
          ...items.filter((item) => item.id !== notification.id),
          notification,
        ]);
      }
      await mutateOutbox(handle.accountId, handle.deviceKey, (items) => items.filter((item) => item.id !== pending.id));
      handle.localPending.delete(pending.id);
      void flushNotificationOutbox(handle).catch(() => undefined);
      return sent;
    } finally {
      handle.pendingSendIds.delete(pending.id);
    }
    })();
    tasks.set(pending.id, task);
    try { return await task; } finally { if (tasks.get(pending.id) === task) tasks.delete(pending.id); }
  };

  const deliverNotification = async (handle: MatrixHandle, pending: PendingMatrixNotification) => {
    if (handle.pendingNotificationIds.has(pending.id)) return;
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

  const flushNotificationOutbox = async (handle: MatrixHandle) => {
    const items = await loadNotificationOutbox(handle.accountId, handle.deviceKey);
    for (const pending of items) void deliverNotification(handle, pending).catch(() => undefined);
  };

  const flushOutbox = async (handle: MatrixHandle) => {
    const items = await loadOutbox(handle.accountId, handle.deviceKey);
    for (const pending of items) {
      handle.localPending.set(pending.id, pending);
      void sendPending(handle, pending).catch(() => undefined);
    }
  };

  const sendContentEvent = async (
    accountId: string,
    thread: MessagingThread,
    eventValue: unknown,
  ) => {
    const handle = await getHandle(accountId);
    const roomId = handle.roomByThreadId.get(thread.id);
    if (!roomId || thread.encryptionMode !== 'MATRIX_V1') throw new Error('Matrix room is not prepared');
    const partnerAccountId = safeIdentifier(thread.partner.id, 'Некорректный получатель Matrix');
    // Authorize before admitting an optimistic/durable message, including a retry
    // after privacy changed. The encrypted writer reauthorizes again before sending.
    await openThread(accountId, thread);
    if (handle.roomByThreadId.get(thread.id) !== roomId) throw new Error('Matrix room binding changed');
    await assertRoomContract(handle, thread, roomId);
    const event = normalizeContentEvent(eventValue);
    if (event.kind === 'message.create' && !thread.messages?.some(message => message.securityMode === 'e2ee')) {
      const security = await getRoomSecurity(accountId, thread);
      if (!security.partnerDevices.some(device => device.signedByOwner)) {
        throw Object.assign(new Error('Собеседник ещё не настроил защищённые сообщения. Отправьте сообщение после его первого входа в чат.'), { code: 'matrix_recipient_not_ready' });
      }
    }
    const retained = handle.localPending.get(event.logicalMessageId);
    if (retained && (retained.threadId !== thread.id || retained.partnerAccountId !== partnerAccountId || retained.roomId !== roomId)) {
      throw new Error('Matrix retry destination mismatch');
    }
    const pending: PendingMatrixSend = retained ?? {
      v: 1,
      id: event.logicalMessageId,
      threadId: thread.id,
      partnerAccountId,
      roomId,
      event,
      queuedAt: new Date().toISOString(),
    };
    await mutateOutbox(accountId, handle.deviceKey, (items) => [...items.filter((item) => item.id !== pending.id), pending]);
    handle.localPending.set(pending.id, pending);
    try { await sendPending(handle, pending); }
    catch (error) {
      if ((error as { code?: string }).code === 'matrix_send_not_authorized') {
        // Denied before encryption/transport: retain the UI draft, not an auto-send.
        await mutateOutbox(accountId, handle.deviceKey, items => items.filter(item => item.id !== pending.id));
        handle.localPending.delete(pending.id);
      }
      throw error;
    }
    return (await matrixThread(handle, thread, roomId)).messages;
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
    const query = queryValue.trim().normalize('NFKC').toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
    if (query.length < 2 || !(await capabilities()).enabled) return [];
    const handle = await getHandle(accountId);
    const results: Array<{ threadId: string; message: MessagingMessage }> = [];
    for (const [threadId, roomId] of handle.roomByThreadId) {
      const shell = handle.threadById.get(threadId);
      if (!shell) continue;
      for (const message of await messagesForRoom(handle, shell, roomId)) {
        const haystack = `${message.text ?? ''} ${JSON.stringify(message.attachment ?? null)}`.normalize('NFKC').toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
        if (haystack.includes(query)) results.push({ threadId, message });
        if (results.length >= Math.min(500, Math.max(1, limit))) return results;
      }
    }
    return results;
  };

  const getRoomSecurity = async (accountId: string, thread: MessagingThread | null): Promise<MatrixRoomSecurity> => {
    if (thread && thread.encryptionMode !== 'MATRIX_V1') throw new Error('Matrix room is not active');
    const handle = await getHandle(accountId);
    if (thread) {
      const roomId = handle.roomByThreadId.get(thread.id);
      if (!roomId) throw new Error('Matrix room is not prepared');
      await assertRoomContract(handle, thread, roomId);
    }
    const crypto = handle.client.getCrypto();
    if (!crypto) throw new Error('Matrix Rust Crypto is unavailable');
    const partnerUserId = thread ? matrixUserIdForAccount(thread.partner.id, matrixServerName(handle.credentials.userId)) : null;
    const deviceMap = await crypto.getUserDeviceInfo(partnerUserId ? [handle.credentials.userId, partnerUserId] : [handle.credentials.userId], true);

    const projectDevices = async (userId: string): Promise<MatrixDeviceSecurity[]> => {
      const devices = [...(deviceMap.get(userId)?.values() ?? [])];
      return Promise.all(devices.map(async (device) => {
        const ed25519 = device.getFingerprint();
        const curve25519 = device.getIdentityKey();
        if (!ed25519 || !curve25519) throw new Error('Matrix device keys are incomplete');
        const verification = await crypto.getDeviceVerificationStatus(userId, device.deviceId);
        return {
          userId,
          deviceId: safeIdentifier(device.deviceId, 'Matrix device id'),
          displayName: typeof device.displayName === 'string' ? device.displayName.slice(0, 160) : null,
          ed25519,
          curve25519,
          current: userId === handle.credentials.userId && device.deviceId === handle.credentials.deviceId,
          verified: verification?.isVerified() === true,
          signedByOwner: verification?.signedByOwner === true,
        };
      }));
    };

    const partnerTrust = partnerUserId ? await crypto.getUserVerificationStatus(partnerUserId) : null;
    const defaultRecoveryKeyId = await handle.client.secretStorage.getDefaultKeyId();
    const localRecoveryKey = secretStorageKeys.get(accountId);

    return {
      cryptoVersion: crypto.getVersion(),
      crossSigningReady: await crypto.isCrossSigningReady(),
      // SDK readiness describes server-side secret storage, not possession of its key.
      secretStorageReady: Boolean(defaultRecoveryKeyId && localRecoveryKey?.keyId === defaultRecoveryKeyId
        && await crypto.isSecretStorageReady()),
      recoveryKeyExists: Boolean(defaultRecoveryKeyId),
      partnerIdentityVerified: partnerTrust?.isCrossSigningVerified() ?? false,
      partnerIdentityChanged: partnerTrust?.needsUserApproval ?? false,
      ownDevices: await projectDevices(handle.credentials.userId),
      partnerDevices: partnerUserId ? await projectDevices(partnerUserId) : [],
      pendingVerifications: [...handle.verifications.values()]
        .filter((item) => item.request.pending && [handle.credentials.userId, partnerUserId].includes(item.request.otherUserId))
        .map(verificationState),
      verificationUpdates: [...handle.verifications.values()]
        .filter((item) => [handle.credentials.userId, partnerUserId].includes(item.request.otherUserId))
        .slice(-32).map(verificationState),
    };
  };

  const verifyDevice = async (
    accountId: string,
    thread: MessagingThread,
    userIdValue: string,
    deviceIdValue: string,
    expectedEd25519: string,
  ) => {
    const handle = await getHandle(accountId);
    const partnerUserId = matrixUserIdForAccount(thread.partner.id, matrixServerName(handle.credentials.userId));
    const userId = userIdValue === partnerUserId ? partnerUserId : null;
    const deviceId = safeIdentifier(deviceIdValue, 'Matrix device id');
    if (!userId || typeof expectedEd25519 !== 'string' || expectedEd25519.length < 32) {
      throw new Error('Matrix device verification input is invalid');
    }
    const crypto = handle.client.getCrypto();
    if (!crypto) throw new Error('Matrix Rust Crypto is unavailable');
    const devices = await crypto.getUserDeviceInfo([userId], true);
    const device = devices.get(userId)?.get(deviceId);
    if (!device || device.getFingerprint() !== expectedEd25519) {
      throw new Error('Отпечаток Matrix-устройства изменился');
    }
    await crypto.setDeviceVerified(userId, deviceId, true);
    return getRoomSecurity(accountId, thread);
  };

  const setupRecovery = async (accountId: string) => {
    const handle = await getHandle(accountId);
    const crypto = handle.client.getCrypto();
    if (!crypto) throw new Error('Matrix Rust Crypto is unavailable');
    if (await crypto.isSecretStorageReady() || await handle.client.secretStorage.getDefaultKeyId()) {
      throw new Error('Ключ восстановления уже создан. Введите сохранённый ключ или подтвердите устройство через другое устройство.');
    }
    await crypto.bootstrapCrossSigning({ authUploadDeviceSigningKeys: crossSigningAuth(accountId) });
    const generated = await crypto.createRecoveryKeyFromPassphrase();
    try {
    if (!generated.encodedPrivateKey) throw new Error('Matrix не создал отображаемый ключ восстановления');
    await crypto.bootstrapSecretStorage({
      createSecretStorageKey: async () => generated,
      setupNewKeyBackup: true,
      setupNewSecretStorage: true,
    });
    const keyId = await handle.client.secretStorage.getDefaultKeyId();
    if (!keyId) throw new Error('Matrix не назначил ключ восстановления');
    assertMatrixKeyActive(handle.deviceKey);
    const stored = { keyId, privateKey: generated.privateKey.slice() };
    secretStorageKeys.get(accountId)?.privateKey.fill(0);
    secretStorageKeys.set(accountId, stored);
    await saveSecretStorageKey(accountId, handle.deviceKey, stored);
    return { recoveryKey: generated.encodedPrivateKey };
    } finally { generated.privateKey.fill(0); }
  };

  const resetRecovery = async (accountId: string) => {
    const handle = await getHandle(accountId);
    const crypto = handle.client.getCrypto();
    if (!crypto) throw new Error('Защита сообщений сейчас недоступна');
    const current = await crypto.getDeviceVerificationStatus(handle.credentials.userId, handle.credentials.deviceId);
    const signing = await crypto.getCrossSigningStatus();
    const cached = signing.privateKeysCachedLocally;
    if (!current?.isVerified() || !cached.masterKey || !cached.selfSigningKey || !cached.userSigningKey) {
      throw new Error('Подтвердите это устройство через другое своё устройство, прежде чем менять ключ восстановления.');
    }
    if (!await handle.client.secretStorage.getDefaultKeyId()) throw new Error('Ключ ещё не создан. Используйте первую настройку восстановления.');
    const backup = await crypto.getKeyBackupInfo();
    if (backup) {
      const trust = await crypto.isKeyBackupTrusted(backup);
      if (!trust.trusted || !trust.matchesDecryptionKey) throw new Error('На этом устройстве нет ключа текущей резервной копии. Замените ключ на прежнем подтверждённом устройстве.');
    }
    assertMatrixKeyActive(handle.deviceKey);
    const generated = await crypto.createRecoveryKeyFromPassphrase();
    try {
      if (!generated.encodedPrivateKey) throw new Error('Не удалось создать ключ восстановления');
      // Rotate only secret storage. Keep signing identity and existing backup.
      await crypto.bootstrapSecretStorage({ createSecretStorageKey: async () => generated,
        setupNewSecretStorage: true, setupNewKeyBackup: false });
      const keyId = await handle.client.secretStorage.getDefaultKeyId();
      if (!keyId) throw new Error('Не удалось подтвердить новый ключ восстановления');
      assertMatrixKeyActive(handle.deviceKey);
      const stored = { keyId, privateKey: generated.privateKey.slice() };
      secretStorageKeys.get(accountId)?.privateKey.fill(0);
      secretStorageKeys.set(accountId, stored);
      await saveSecretStorageKey(accountId, handle.deviceKey, stored);
      return { recoveryKey: generated.encodedPrivateKey };
    } finally { generated.privateKey.fill(0); }
  };

  const recoverSecurity = async (accountId: string, recoveryKey: string) => {
    const normalized = recoveryKey.trim();
    if (normalized.length < 32 || normalized.length > 512) throw new Error('Некорректный ключ восстановления');
    const handle = await getHandle(accountId);
    const crypto = handle.client.getCrypto();
    if (!crypto) throw new Error('Matrix Rust Crypto is unavailable');
    const defaultKeyId = await handle.client.secretStorage.getDefaultKeyId();
    const keyTuple = defaultKeyId ? await handle.client.secretStorage.getKey(defaultKeyId) : null;
    if (!defaultKeyId || !keyTuple) throw new Error('В аккаунте нет Matrix-ключа восстановления');
    let privateKey: Uint8Array;
    try { privateKey = decodeRecoveryKey(normalized); }
    catch { throw new Error('Некорректный ключ восстановления. Проверьте все символы сохранённого ключа.'); }
    try {
    if (!await handle.client.secretStorage.checkKey(privateKey, keyTuple[1] as any)) {
      throw new Error('Ключ восстановления не подходит');
    }
    assertMatrixKeyActive(handle.deviceKey);
    const stored = { keyId: defaultKeyId, privateKey: privateKey.slice() };
    secretStorageKeys.get(accountId)?.privateKey.fill(0);
    secretStorageKeys.set(accountId, stored);
    await crypto.bootstrapCrossSigning({ authUploadDeviceSigningKeys: crossSigningAuth(accountId) });
    const backupInfo = await crypto.getKeyBackupInfo();
    if (backupInfo) {
      await crypto.loadSessionBackupPrivateKeyFromSecretStorage();
      await crypto.checkKeyBackupAndEnable();
      await crypto.restoreKeyBackup();
    }
    await saveSecretStorageKey(accountId, handle.deviceKey, stored);
    } finally { privateKey.fill(0); }
  };

  const sessionForVerification = async (accountId: string, verificationIdValue: string) => {
    const handle = await getHandle(accountId);
    const verificationId = safeIdentifier(verificationIdValue, 'Matrix verification id');
    const session = handle.verifications.get(verificationId);
    if (!session) throw new Error('Запрос проверки Matrix не найден');
    return { handle, session };
  };

  const startDeviceVerification = async (
    accountId: string,
    thread: MessagingThread | null,
    userIdValue: string,
    deviceIdValue: string,
  ) => {
    const handle = await getHandle(accountId);
    const partnerUserId = thread ? matrixUserIdForAccount(thread.partner.id, matrixServerName(handle.credentials.userId)) : null;
    if (userIdValue !== partnerUserId && userIdValue !== handle.credentials.userId) throw new Error('Matrix verification user mismatch');
    const deviceId = safeIdentifier(deviceIdValue, 'Matrix device id');
    const crypto = handle.client.getCrypto();
    if (!crypto) throw new Error('Matrix Rust Crypto is unavailable');
    const ownKeys = await crypto.getOwnDeviceKeys();
    await waitForPublishedMatrixDevice({
      userId: handle.credentials.userId,
      deviceId: handle.credentials.deviceId,
      ...ownKeys,
      readDevice: async (signal) => {
        const response = await globalThis.fetch(new URL('/_matrix/client/v3/keys/query', handle.credentials.homeserverUrl), {
          method: 'POST', signal, cache: 'no-store', credentials: 'omit',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${handle.credentials.accessToken}` },
          body: JSON.stringify({ device_keys: { [handle.credentials.userId]: [handle.credentials.deviceId] } }),
        });
        if (!response.ok) throw new Error('Не удалось проверить готовность ключей этого устройства. Попробуйте ещё раз.');
        const value = await response.json();
        return value.device_keys?.[handle.credentials.userId]?.[handle.credentials.deviceId];
      },
    });
    const requestValue = await crypto.requestDeviceVerification(userIdValue, deviceId);
    return verificationState(registerVerification(handle, requestValue, deviceId));
  };

  const acceptVerification = async (accountId: string, verificationId: string) => {
    const { session } = await sessionForVerification(accountId, verificationId);
    await session.request.accept();
    return verificationState(session);
  };

  const startSasVerification = async (accountId: string, verificationId: string) => {
    const { session } = await sessionForVerification(accountId, verificationId);
    const verifier = await session.request.startVerification('m.sas.v1');
    if (session.verifier !== verifier) bindVerifier(session, verifier);
    return verificationState(session);
  };

  const generateQrVerification = async (accountId: string, verificationId: string) => {
    const { session } = await sessionForVerification(accountId, verificationId);
    const raw = await session.request.generateQRCode();
    if (!raw) throw new Error('QR-проверка недоступна; используйте эмодзи-код');
    session.qrCodeBase64 = bytesToBase64Url(new Uint8Array(raw));
    return verificationState(session);
  };

  const scanQrVerification = async (accountId: string, verificationId: string, qrCodeBase64: string) => {
    const { session } = await sessionForVerification(accountId, verificationId);
    const raw = base64UrlToBytes(qrCodeBase64, 2048);
    const verifier = await session.request.scanQRCode(new Uint8ClampedArray(raw));
    raw.fill(0);
    if (session.verifier !== verifier) bindVerifier(session, verifier);
    return verificationState(session);
  };

  const confirmVerification = async (accountId: string, verificationId: string) => {
    const { session } = await sessionForVerification(accountId, verificationId);
    if (session.sas) await session.sas.confirm();
    else if (session.qr) session.qr.confirm();
    else throw new Error('Код проверки ещё не готов');
    return verificationState(session);
  };

  const mismatchVerification = async (accountId: string, verificationId: string) => {
    const { session } = await sessionForVerification(accountId, verificationId);
    if (session.sas) session.sas.mismatch();
    else if (session.qr) session.qr.cancel();
    else await session.request.cancel();
    return verificationState(session);
  };

  const cancelVerification = async (accountId: string, verificationId: string) => {
    const { session } = await sessionForVerification(accountId, verificationId);
    await session.request.cancel();
    return verificationState(session);
  };

  const subscribe = async (accountId: string, onThreadChanged: (threadId: string) => void) => {
    if (!(await capabilities()).enabled) return () => undefined;
    const handle = await getHandle(accountId);
    const timeline = (event: MatrixEvent) => {
      const roomId = event.getRoomId();
      const threadId = [...handle.roomByThreadId].find(([, value]) => value === roomId)?.[0];
      if (threadId) onThreadChanged(threadId);
    };
    const sync = (state: SyncState) => {
      if (state !== SyncState.Prepared && state !== SyncState.Syncing) return;
      void (async () => {
        for (const threadId of await refreshRoomIndex(handle)) onThreadChanged(threadId);
        await flushOutbox(handle);
        await flushNotificationOutbox(handle);
      })().catch(() => undefined);
    };
    handle.client.on(RoomEvent.Timeline, timeline);
    handle.client.on(MatrixEventEvent.Decrypted, timeline);
    handle.client.on(ClientEvent.Sync, sync);
    return () => {
      handle.client.off(RoomEvent.Timeline, timeline);
      handle.client.off(MatrixEventEvent.Decrypted, timeline);
      handle.client.off(ClientEvent.Sync, sync);
    };
  };

  const cleanPendingLogout = async (accountId: string, owner: MatrixStoreLease) => {
    const generation = owner.pendingLogout();
    if (!generation) return;
    await AsyncStorage.multiRemove([
      credentialKey(accountId), secretStorageKey(accountId),
      outboxStorageKey(accountId), notificationOutboxStorageKey(accountId),
    ]);
    // Do not acknowledge a newer request that arrived during the write.
    owner.acknowledgeLogout(generation);
  };

  const release = async (accountIdValue: string) => {
    const accountId = safeIdentifier(accountIdValue, 'Некорректный аккаунт Matrix');
    return withMatrixAccountShutdown(accountId, async () => {
    const pending = handles.get(accountId);
    handles.delete(accountId);
    if (!pending) return;
    let handle: MatrixHandle | null = null;
    try {
      handle = await pending;
      await closeMatrixKey(handle.deviceKey);
      handle.client.stopClient();
      await cleanPendingLogout(accountId, handle.owner);
    } catch {
      // A partially initialized runtime has no durable plaintext state to clean up.
    } finally {
      secretStorageKeys.get(accountId)?.privateKey.fill(0);
      secretStorageKeys.delete(accountId);
      handle?.deviceKey.fill(0);
      handle?.storage.destroyMemoryKey();
      await handle?.owner.release();
    }
    });
  };

  const logout = async (accountIdValue: string) => {
    const accountId = safeIdentifier(accountIdValue, 'Некорректный аккаунт Matrix');
    // This durable, content-free marker also reaches a suspended owner. Never
    // erase another tab's live store or block VOLNA's server logout waiting for it.
    storeOwnership.requestLogout(accountId);
    return withMatrixAccountShutdown(accountId, async () => {
    const pending = handles.get(accountId);
    handles.delete(accountId);
    let storage: ReturnType<typeof createExpoMessagingStorage> | null = null;
    let deviceKey: Uint8Array | null = null;
    let owner: MatrixStoreLease | null = null;
    try {
      if (pending) {
        const handle = await pending.catch(() => null);
        if (handle) {
          owner = handle.owner;
          storage = handle.storage;
          deviceKey = handle.deviceKey;
          await closeMatrixKey(deviceKey);
          handle.client.stopClient();
          await handle.client.logout(true).catch(() => undefined);
        }
      }
      if (!owner) {
        try { owner = await storeOwnership.acquire(accountId); }
        catch (error) {
          if ((error as { code?: string }).code === 'matrix_store_busy') return;
          throw error;
        }
        // The prior owner may already have completed this logout before we
        // acquired the lock. Do not revoke a newer session opened meanwhile.
        if (!owner.pendingLogout()) return;
        const deviceId = await AsyncStorage.getItem(deviceStorageKey(accountId));
        if (deviceId && /^[A-Za-z0-9_-]{8,80}$/.test(deviceId)) {
          storage = createExpoMessagingStorage(accountId, deviceId);
          deviceKey = await storage.wrappingKeyProvider.getKey(storage.wrappingKeyId);
          const credentials = await loadCredentials(accountId, deviceKey);
          if (credentials) {
            const client = createClient({
              baseUrl: credentials.homeserverUrl,
              accessToken: credentials.accessToken,
              refreshToken: credentials.refreshToken,
              userId: credentials.userId,
              deviceId: credentials.deviceId,
            });
            await client.logout().catch(() => undefined);
          }
        }
      }
    } finally {
      if (deviceKey) await closeMatrixKey(deviceKey);
      try {
        if (owner) await cleanPendingLogout(accountId, owner);
      } finally {
        secretStorageKeys.get(accountId)?.privateKey.fill(0);
        secretStorageKeys.delete(accountId);
        deviceKey?.fill(0);
        storage?.destroyMemoryKey();
        await owner?.release();
      }
    }
    });
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
    acceptVerification,
    startSasVerification,
    generateQrVerification,
    scanQrVerification,
    confirmVerification,
    mismatchVerification,
    cancelVerification,
    subscribe,
    release,
    logout,
  });
}
