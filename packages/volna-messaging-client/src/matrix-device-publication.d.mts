export declare function createMatrixVerificationFetch(options: {
  fetch: typeof globalThis.fetch;
  homeserverUrl: string;
  userId: string;
  refreshOwnDeviceKeys(): Promise<unknown>;
}): typeof globalThis.fetch;
export declare function waitForPublishedMatrixDevice(options: {
  userId: string;
  deviceId: string;
  ed25519: string;
  curve25519: string;
  /** Untrusted endpoint data; the implementation validates exact identity keys. */
  readDevice(signal: AbortSignal): Promise<unknown>;
}): Promise<void>;
