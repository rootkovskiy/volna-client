export type RefreshCredentials = { accessToken: string; refreshToken: string; expiresAt: number };
export declare function createMatrixCredentialRefresher<T extends RefreshCredentials>(options: {
  credentials: T;
  assertActive(): void;
  checkSession(): Promise<void>;
  rotate(token: string): Promise<{ access_token?: unknown; refresh_token?: unknown; expires_in_ms?: unknown }>;
  persist(credentials: T): Promise<void>;
  now?: () => number;
}): (requestedToken: string) => Promise<{ accessToken: string; refreshToken: string; expiry: Date }>;
