import AsyncStorage from '@react-native-async-storage/async-storage';
import { sha256 } from '@noble/hashes/sha2.js';
import * as ExpoCrypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { createEncryptedMessageStore } from './encrypted-message-store.mjs';
import { base64UrlToBytes, bytesToBase64Url } from './mls-runtime.mjs';

const STORAGE_PREFIX = '@volna/e2ee/v1';
const WEB_DATABASE_NAME = 'volna-e2ee-device-keys-v1';
const WEB_DATABASE_VERSION = 1;
const WEB_KEY_STORE = 'keys';
const WEB_KEY_ALGORITHM = 'AES-GCM';

export class ExpoMessagingStorageError extends Error {
  readonly code: string;

  constructor(code: string, cause?: unknown) {
    super(`VOLNA messaging storage error (${code})`, cause === undefined ? undefined : { cause });
    this.name = 'ExpoMessagingStorageError';
    this.code = code;
  }
}

function fail(code: string, cause?: unknown): never {
  throw new ExpoMessagingStorageError(code, cause);
}

function storageId(accountId: string, deviceId: string) {
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(accountId) || !/^[A-Za-z0-9_-]{8,80}$/.test(deviceId)) {
    fail('storage_scope');
  }
  return `${accountId}:${deviceId}`;
}

function stateStorageKey(scope: string) {
  return `${STORAGE_PREFIX}/state/${scope}`;
}

function wrappingStorageKey(scope: string) {
  return `${STORAGE_PREFIX}/wrapping/${scope}`;
}

function secureStoreKey(scope: string) {
  return `volna_e2ee_${bytesToBase64Url(sha256(new TextEncoder().encode(scope)))}`;
}

function randomBytes(length: number) {
  if (!Number.isSafeInteger(length) || length < 1 || length > 1024) fail('rng_length');
  const bytes = new Uint8Array(length);
  try {
    ExpoCrypto.getRandomValues(bytes);
  } catch (error) {
    fail('rng_unavailable', error);
  }
  return bytes;
}

function domBytes(value: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy;
}

function webCrypto(): Crypto {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.subtle || typeof cryptoApi.getRandomValues !== 'function') fail('web_crypto_unavailable');
  return cryptoApi;
}

function isCryptoKey(value: unknown): value is CryptoKey {
  return typeof CryptoKey !== 'undefined' && value instanceof CryptoKey;
}

function openWebKeyDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new ExpoMessagingStorageError('indexeddb_unavailable'));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(WEB_DATABASE_NAME, WEB_DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(WEB_KEY_STORE)) database.createObjectStore(WEB_KEY_STORE);
    };
    request.onerror = () => reject(new ExpoMessagingStorageError('indexeddb_open', request.error));
    request.onblocked = () => reject(new ExpoMessagingStorageError('indexeddb_blocked'));
    request.onsuccess = () => resolve(request.result);
  });
}

async function withWebKeyStore<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | undefined> {
  const database = await openWebKeyDatabase();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const transaction = database.transaction(WEB_KEY_STORE, mode);
      const request = operation(transaction.objectStore(WEB_KEY_STORE));
      request.onerror = () => reject(new ExpoMessagingStorageError('indexeddb_request', request.error));
      request.onsuccess = () => resolve(request.result);
      transaction.onabort = () => reject(new ExpoMessagingStorageError('indexeddb_transaction', transaction.error));
    });
  } finally {
    database.close();
  }
}

async function getOrCreateWebDeviceKey(scope: string): Promise<CryptoKey> {
  const existing = await withWebKeyStore<CryptoKey>('readonly', (store) => store.get(scope));
  if (isCryptoKey(existing) && !existing.extractable) return existing;
  const generated = await webCrypto().subtle.generateKey(
    { name: WEB_KEY_ALGORITHM, length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  if (!isCryptoKey(generated) || generated.extractable) fail('web_key_generation');
  try {
    await withWebKeyStore('readwrite', (store) => store.add(generated, scope));
  } catch (error) {
    const concurrent = await withWebKeyStore<CryptoKey>('readonly', (store) => store.get(scope));
    if (isCryptoKey(concurrent) && !concurrent.extractable) return concurrent;
    throw error;
  }
  const persisted = await withWebKeyStore<CryptoKey>('readonly', (store) => store.get(scope));
  if (!isCryptoKey(persisted) || persisted.extractable) fail('web_key_persistence');
  return persisted;
}

async function createWrappedWebStateKey(scope: string): Promise<Uint8Array> {
  const deviceKey = await getOrCreateWebDeviceKey(scope);
  const stateKey = randomBytes(32);
  const nonce = randomBytes(12);
  try {
    const ciphertext = new Uint8Array(await webCrypto().subtle.encrypt(
      { name: WEB_KEY_ALGORITHM, iv: domBytes(nonce), additionalData: domBytes(new TextEncoder().encode(scope)), tagLength: 128 },
      deviceKey,
      domBytes(stateKey),
    ));
    await AsyncStorage.setItem(wrappingStorageKey(scope), JSON.stringify({
      v: 1,
      alg: WEB_KEY_ALGORITHM,
      nonce: bytesToBase64Url(nonce),
      ciphertext: bytesToBase64Url(ciphertext),
    }));
    return stateKey;
  } finally {
    nonce.fill(0);
  }
}

async function loadWrappedWebStateKey(scope: string): Promise<Uint8Array | null> {
  const encoded = await AsyncStorage.getItem(wrappingStorageKey(scope));
  if (encoded === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(encoded);
  } catch (error) {
    fail('web_wrapped_key_json', error);
  }
  if (
    value === null
    || typeof value !== 'object'
    || (value as { v?: unknown }).v !== 1
    || (value as { alg?: unknown }).alg !== WEB_KEY_ALGORITHM
  ) fail('web_wrapped_key');
  const nonce = base64UrlToBytes((value as { nonce: string }).nonce, 12);
  const ciphertext = base64UrlToBytes((value as { ciphertext: string }).ciphertext, 128);
  if (nonce.length !== 12 || ciphertext.length !== 48) fail('web_wrapped_key');
  const deviceKey = await withWebKeyStore<CryptoKey>('readonly', (store) => store.get(scope));
  if (!isCryptoKey(deviceKey) || deviceKey.extractable) fail('web_device_key_missing');
  try {
    const plaintext = new Uint8Array(await webCrypto().subtle.decrypt(
      { name: WEB_KEY_ALGORITHM, iv: domBytes(nonce), additionalData: domBytes(new TextEncoder().encode(scope)), tagLength: 128 },
      deviceKey,
      domBytes(ciphertext),
    ));
    if (plaintext.length !== 32) fail('web_state_key');
    return plaintext;
  } catch (error) {
    if (error instanceof ExpoMessagingStorageError) throw error;
    fail('web_state_key_decrypt', error);
  }
}

async function getNativeStateKey(scope: string): Promise<Uint8Array> {
  const key = secureStoreKey(scope);
  let encoded: string | null;
  try {
    encoded = await SecureStore.getItemAsync(key, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  } catch (error) {
    fail('secure_store_read', error);
  }
  if (encoded !== null) {
    const bytes = base64UrlToBytes(encoded, 32);
    if (bytes.length !== 32) fail('secure_store_key');
    return bytes;
  }
  const created = randomBytes(32);
  try {
    await SecureStore.setItemAsync(key, bytesToBase64Url(created), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  } catch (error) {
    created.fill(0);
    fail('secure_store_write', error);
  }
  return created;
}

export function createExpoMessagingStorage(accountId: string, deviceId: string) {
  const scope = storageId(accountId, deviceId);
  const wrappingKeyId = `device:${scope}:v1`;
  let memoryKey: Uint8Array | null = null;
  let pendingKey: Promise<Uint8Array> | null = null;

  const getKey = async () => {
    if (memoryKey !== null) return memoryKey.slice();
    pendingKey ??= (async () => {
      const loaded = Platform.OS === 'web'
        ? await loadWrappedWebStateKey(scope) ?? await createWrappedWebStateKey(scope)
        : await getNativeStateKey(scope);
      memoryKey = loaded;
      return loaded;
    })();
    try {
      return (await pendingKey).slice();
    } finally {
      pendingKey = null;
    }
  };

  const messageStore = createEncryptedMessageStore({
    scope,
    randomBytes,
    wrappingKeyProvider: { getKey: (_requestedId: string) => getKey() },
    database: {
      getItem: (key: string) => AsyncStorage.getItem(key),
      setItem: (key: string, value: string) => AsyncStorage.setItem(key, value),
      removeItem: (key: string) => AsyncStorage.removeItem(key),
      getAllKeys: async () => [...await AsyncStorage.getAllKeys()],
    },
    withLock: async <T>(name: string, operation: () => Promise<T>) => {
      const locks = Platform.OS === 'web'
        ? (globalThis.navigator as unknown as {
            locks?: { request<TValue>(name: string, options: { mode: 'exclusive' }, callback: () => Promise<TValue>): Promise<TValue> };
          } | undefined)?.locks
        : undefined;
      return locks?.request
        ? locks.request(name, { mode: 'exclusive' }, operation)
        : operation();
    },
  });

  return {
    wrappingKeyId,
    randomBytes,
    wrappingKeyProvider: { getKey: (_requestedId: string) => getKey() },
    messageStore,
    async loadEncryptedState() {
      return AsyncStorage.getItem(stateStorageKey(scope));
    },
    async saveEncryptedState(state: string) {
      if (typeof state !== 'string' || state.length === 0) fail('state_value');
      await AsyncStorage.setItem(stateStorageKey(scope), state);
    },
    async clear() {
      if (pendingKey !== null) {
        try {
          await pendingKey;
        } catch {
          // Continue cleanup even when initialization failed partway through.
        }
      }
      pendingKey = null;
      memoryKey?.fill(0);
      memoryKey = null;
      await messageStore.clear();
      await AsyncStorage.multiRemove([stateStorageKey(scope), wrappingStorageKey(scope)]);
      if (Platform.OS === 'web') {
        await withWebKeyStore('readwrite', (store) => store.delete(scope));
      } else {
        await SecureStore.deleteItemAsync(secureStoreKey(scope));
      }
    },
    destroyMemoryKey() {
      messageStore.destroyMemory();
      memoryKey?.fill(0);
      memoryKey = null;
    },
  };
}
