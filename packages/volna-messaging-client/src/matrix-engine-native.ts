import type { MatrixMessagingManager } from './matrix-engine';

const unavailable = () => {
  throw new Error('Официальный Matrix Rust SDK требует нативную development/production сборку VOLNA');
};

export function createMatrixMessagingManager(): MatrixMessagingManager {
  return Object.freeze({
    capabilities: async () => ({
      enabled: false,
      protocol: 'MATRIX_V1' as const,
      loginType: 'social.volna.session',
      homeserverUrl: null,
      serverName: null,
      nativeRuntimeRequired: true,
      productionReleaseBlocked: true,
    }),
    decorateThread: async (_accountId, thread) => thread,
    decorateThreads: async (_accountId, threads) => threads,
    openThread: unavailable,
    sendMessage: unavailable,
    editMessage: unavailable,
    reactToMessage: unavailable,
    searchLocalMessages: async () => [],
    getRoomSecurity: unavailable,
    verifyDevice: unavailable,
    setupRecovery: unavailable,
    recoverSecurity: unavailable,
    startDeviceVerification: unavailable,
    acceptVerification: unavailable,
    startSasVerification: unavailable,
    generateQrVerification: unavailable,
    scanQrVerification: unavailable,
    confirmVerification: unavailable,
    mismatchVerification: unavailable,
    cancelVerification: unavailable,
    subscribe: async () => () => undefined,
    release: async () => undefined,
    logout: async () => undefined,
  }) as MatrixMessagingManager;
}
