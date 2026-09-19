import { createMatrixMessagingManager } from '@volna/messaging-client/matrix-engine-native';
import VolnaMatrixNative from '@volna/matrix-native';
import { apiFetch, apiUrl, getApiSessionToken } from '../api/client';

// Session, room/message, recovery, identity and SAS operations stay inside the
// native Rust FFI contour. Unsupported verification QR remains fail-closed and
// there is never a plaintext fallback.
export const matrixMessagingManager = createMatrixMessagingManager({
  apiOrigin: apiUrl,
  fetch: apiFetch,
  getAccessToken: getApiSessionToken,
  includeCredentials: true,
  allowInsecureDevelopmentOrigin: apiUrl.startsWith('http://'),
  nativeBridge: VolnaMatrixNative,
});
