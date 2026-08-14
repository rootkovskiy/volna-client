import { createMatrixMessagingManager } from '@volna/messaging-client/matrix-engine-native';
import { apiFetch, apiUrl, getApiSessionToken } from '../api/client';

// Native intentionally remains unavailable until the official Matrix Rust SDK
// bindings are present in the signed VOLNA build. There is no plaintext fallback.
export const matrixMessagingManager = createMatrixMessagingManager({
  apiOrigin: apiUrl,
  fetch: apiFetch,
  getAccessToken: getApiSessionToken,
  includeCredentials: true,
});
