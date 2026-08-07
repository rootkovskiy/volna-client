import { createExpoSecureMessagingManager } from '@volna/messaging-client/expo-secure-messaging';
import { createMessagingSurfaceController } from '@volna/messaging-client/messaging-surface-controller';
import { apiFetch, apiUrl, getApiSessionToken } from '../api/client';

const manager = createExpoSecureMessagingManager({
  apiOrigin: apiUrl,
  fetch: apiFetch,
  includeCredentials: true,
  allowInsecureDevelopmentOrigin: apiUrl.startsWith('http://'),
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
