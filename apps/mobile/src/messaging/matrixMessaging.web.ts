import type { MatrixMessagingCapabilities, MatrixMessagingManager } from '@volna/messaging-client/matrix-engine-web';
import { apiFetch, apiUrl, getApiSessionToken } from '../api/client';

let managerPromise: Promise<MatrixMessagingManager> | null = null;
let capabilitiesPromise: Promise<MatrixMessagingCapabilities> | null = null;

const capabilities = () => {
  capabilitiesPromise ??= apiFetch(`${apiUrl.replace(/\/$/, '')}/messaging/matrix/capabilities`, {
    cache: 'no-store',
    credentials: 'include',
  }).then(async (response) => {
    if (!response.ok) throw new Error('Не удалось проверить Matrix runtime');
    const value = await response.json() as Partial<MatrixMessagingCapabilities>;
    return {
      enabled: value.enabled === true,
      protocol: 'MATRIX_V1' as const,
      loginType: typeof value.loginType === 'string' ? value.loginType : 'social.volna.session',
      homeserverUrl: typeof value.homeserverUrl === 'string' ? value.homeserverUrl : null,
      serverName: typeof value.serverName === 'string' ? value.serverName : null,
      nativeRuntimeRequired: true,
      productionReleaseBlocked: value.productionReleaseBlocked === true,
    };
  }).catch((error) => {
    capabilitiesPromise = null;
    throw error;
  });
  return capabilitiesPromise;
};

const manager = () => {
  managerPromise ??= import('@volna/messaging-client/matrix-engine-web').then(({ createMatrixMessagingManager }) => (
    createMatrixMessagingManager({
      apiOrigin: apiUrl,
      fetch: apiFetch,
      getAccessToken: getApiSessionToken,
      includeCredentials: true,
    })
  )).catch((error) => {
    managerPromise = null;
    throw error;
  });
  return managerPromise;
};

// Keep the Rust/WASM crypto SDK out of the initial application bundle. It is
// loaded by a messaging surface or deferred authenticated-session warmup.
export const matrixMessagingManager: MatrixMessagingManager = {
  capabilities,
  warmup: async (accountId, signal) => {
    if (signal.aborted || !(await capabilities()).enabled || signal.aborted) return;
    const runtime = await manager();
    if (!signal.aborted) await runtime.warmup(accountId, signal);
  },
  decorateThread: async (...args) => (await capabilities()).enabled ? (await manager()).decorateThread(...args) : args[1],
  decorateThreads: async (...args) => (await capabilities()).enabled ? (await manager()).decorateThreads(...args) : args[1],
  openThread: async (...args) => (await manager()).openThread(...args),
  sendMessage: async (...args) => (await manager()).sendMessage(...args),
  editMessage: async (...args) => (await manager()).editMessage(...args),
  reactToMessage: async (...args) => (await manager()).reactToMessage(...args),
  searchLocalMessages: async (...args) => (await capabilities()).enabled ? (await manager()).searchLocalMessages(...args) : [],
  getRoomSecurity: async (...args) => (await manager()).getRoomSecurity(...args),
  getAccountSecurity: async (...args) => (await manager()).getAccountSecurity(...args),
  startOwnDeviceVerification: async (...args) => (await manager()).startOwnDeviceVerification(...args),
  verifyDevice: async (...args) => (await manager()).verifyDevice(...args),
  setupRecovery: async (...args) => (await manager()).setupRecovery(...args),
  resetRecovery: async (...args) => (await manager()).resetRecovery(...args),
  recoverSecurity: async (...args) => (await manager()).recoverSecurity(...args),
  startDeviceVerification: async (...args) => (await manager()).startDeviceVerification(...args),
  acceptVerification: async (...args) => (await manager()).acceptVerification(...args),
  startSasVerification: async (...args) => (await manager()).startSasVerification(...args),
  generateQrVerification: async (...args) => (await manager()).generateQrVerification(...args),
  scanQrVerification: async (...args) => (await manager()).scanQrVerification(...args),
  confirmVerification: async (...args) => (await manager()).confirmVerification(...args),
  mismatchVerification: async (...args) => (await manager()).mismatchVerification(...args),
  cancelVerification: async (...args) => (await manager()).cancelVerification(...args),
  subscribe: async (...args) => (await capabilities()).enabled ? (await manager()).subscribe(...args) : () => undefined,
  release: async (...args) => managerPromise ? (await managerPromise).release(...args) : undefined,
  logout: async (...args) => (await manager()).logout(...args),
};
