import { createExpoSecureMessagingManager } from '@volna/messaging-client/expo-secure-messaging';
import keyTransparencyPolicyDocument from '@volna/messaging-client/key-transparency-policy';
import type { C2spKeyTransparencyPolicy } from '@volna/messaging-client/opaque-transport';
import { createMessagingSurfaceController } from '@volna/messaging-client/messaging-surface-controller';
import { fetch as expoFetch } from 'expo/fetch';
import { apiFetch, apiUrl, getApiSessionToken } from '../api/client';

const keyTransparencyPolicy: C2spKeyTransparencyPolicy | undefined =
  keyTransparencyPolicyDocument.status === 'active'
  && typeof keyTransparencyPolicyDocument.logVkey === 'string'
    ? {
        mode: 'c2sp-map-v1',
        origin: keyTransparencyPolicyDocument.origin,
        logVkey: keyTransparencyPolicyDocument.logVkey,
        threshold: 2,
        maxAgeSeconds: keyTransparencyPolicyDocument.maxAgeSeconds,
        witnessVkeys: keyTransparencyPolicyDocument.witnessVkeys,
      }
    : undefined;

const manager = createExpoSecureMessagingManager({
  apiOrigin: apiUrl,
  fetch: apiFetch,
  witnessFetch: expoFetch as typeof globalThis.fetch,
  includeCredentials: true,
  allowInsecureDevelopmentOrigin: apiUrl.startsWith('http://'),
  keyTransparencyPolicy,
});

export const getSecureMessagingClient = manager.getSecureMessagingClient;
export const loadMessagingCapabilities = manager.loadMessagingCapabilities;
export const releaseSecureMessagingClient = manager.releaseSecureMessagingClient;

export const messagingSurfaceController = createMessagingSurfaceController({
  apiOrigin: apiUrl,
  fetch: apiFetch,
  getAccessToken: getApiSessionToken,
  getSecureMessagingClient: manager.getSecureMessagingClient,
  includeCredentials: true,
  loadMessagingCapabilities: manager.loadMessagingCapabilities,
});
