import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ExpoCrypto from 'expo-crypto';
import { Platform } from 'react-native';
import {
  createSecureMessagingClient,
  type SecureMessagingClient,
} from './secure-messaging-client.mjs';
import { createExpoMessagingStorage } from './expo-storage-adapter';
import { createMlsRuntime } from './mls-runtime.mjs';
import {
  createOpaqueChatTransport,
  type KeyTransparencyWitnessPolicy,
} from './opaque-transport.mjs';

const DEVICE_ID_VERSION = 1;
const deviceIdKey = (accountId: string) => `volna:e2ee:device-id:v${DEVICE_ID_VERSION}:${accountId}`;

export type MessagingCapabilities = {
  enrollmentEnabled: boolean;
  rolloutEnabled: boolean;
  deviceTransferEnabled: boolean;
  membershipRekeyEnabled: boolean;
  keyTransparencyReady: boolean;
};

export type MessagingClientHandle = {
  client: SecureMessagingClient;
  deviceId: string;
  restoration: Record<string, unknown>;
};

export type ExpoSecureMessagingManagerOptions = {
  apiOrigin: string;
  fetch: typeof globalThis.fetch;
  witnessFetch?: typeof globalThis.fetch;
  getAccessToken?: () => string | undefined | Promise<string | undefined>;
  includeCredentials?: boolean;
  allowInsecureDevelopmentOrigin?: boolean;
  keyTransparencyPolicy?: KeyTransparencyWitnessPolicy;
};

function assertAccountId(accountId: string) {
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(accountId)) throw new Error('Некорректный идентификатор аккаунта');
}

async function getOrCreateDeviceId(accountId: string) {
  assertAccountId(accountId);
  const key = deviceIdKey(accountId);
  const existing = await AsyncStorage.getItem(key);
  if (existing && /^[A-Za-z0-9_-]{8,80}$/.test(existing)) return existing;
  const created = `device_${ExpoCrypto.randomUUID().replaceAll('-', '')}`;
  await AsyncStorage.setItem(key, created);
  return created;
}

function deviceDisplayName() {
  if (Platform.OS === 'ios') return 'iPhone или iPad';
  if (Platform.OS === 'android') return 'Android-устройство';
  return 'Веб-браузер';
}

export function createExpoSecureMessagingManager(options: ExpoSecureMessagingManagerOptions) {
  if (!options || typeof options.apiOrigin !== 'string' || typeof options.fetch !== 'function') {
    throw new Error('Некорректная конфигурация защищённых сообщений');
  }
  const handles = new Map<string, Promise<MessagingClientHandle>>();
  const createTransport = () => createOpaqueChatTransport({
    apiOrigin: options.apiOrigin,
    fetch: options.fetch,
    witnessFetch: options.witnessFetch,
    getAccessToken: options.getAccessToken ?? (() => undefined),
    includeCredentials: options.includeCredentials === true,
    allowInsecureDevelopmentOrigin: options.allowInsecureDevelopmentOrigin === true,
    keyTransparencyPolicy: options.keyTransparencyPolicy,
  });

  const loadMessagingCapabilities = async (): Promise<MessagingCapabilities> => {
    const value = await createTransport().capabilities();
    const keyTransparencyReady = options.keyTransparencyPolicy !== undefined;
    return {
      enrollmentEnabled: value.enrollmentEnabled === true && keyTransparencyReady,
      rolloutEnabled: value.rolloutEnabled === true && keyTransparencyReady,
      deviceTransferEnabled: value.deviceTransferEnabled === true && keyTransparencyReady,
      membershipRekeyEnabled: value.membershipRekeyEnabled === true && keyTransparencyReady,
      keyTransparencyReady,
    };
  };

  const getSecureMessagingClient = (accountId: string): Promise<MessagingClientHandle> => {
    assertAccountId(accountId);
    const existing = handles.get(accountId);
    if (existing) return existing;
    const pending = (async () => {
      const deviceId = await getOrCreateDeviceId(accountId);
      const storage = createExpoMessagingStorage(accountId, deviceId);
      const runtime = createMlsRuntime({
        randomBytes: storage.randomBytes,
        wrappingKeyProvider: storage.wrappingKeyProvider,
      });
      const client = createSecureMessagingClient({
        accountId,
        deviceId,
        platform: Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'web',
        displayName: deviceDisplayName(),
        runtime,
        transport: createTransport(),
        storage,
      });
      const restoration = await client.restore();
      return { client, deviceId, restoration };
    })();
    handles.set(accountId, pending);
    pending.catch(() => {
      if (handles.get(accountId) === pending) handles.delete(accountId);
    });
    return pending;
  };

  const releaseSecureMessagingClient = async (accountId: string) => {
    assertAccountId(accountId);
    const pending = handles.get(accountId);
    handles.delete(accountId);
    if (!pending) return;
    try {
      const { client } = await pending;
      client.destroyMemory();
    } catch {
      // Initialization may have failed before a client handle existed.
    }
  };

  return Object.freeze({
    getSecureMessagingClient,
    loadMessagingCapabilities,
    releaseSecureMessagingClient,
  });
}
