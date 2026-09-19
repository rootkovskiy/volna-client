export declare class MatrixStoreOwnershipError extends Error { code: string; constructor(code: string); }
export type MatrixStoreLease = {
  assertActive(): void;
  pendingLogout(): string | null;
  acknowledgeLogout(generation: string): void;
  release(): Promise<void>;
};
export declare function createMatrixStoreOwnership(options?: {
  locks?: Pick<LockManager, 'request'>;
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  events?: Pick<Window, 'addEventListener' | 'removeEventListener' | 'dispatchEvent'>;
  newGeneration?: () => string;
}): { acquire(accountId: string, onInvalidate?: () => void): Promise<MatrixStoreLease>; requestLogout(accountId: string): void };
