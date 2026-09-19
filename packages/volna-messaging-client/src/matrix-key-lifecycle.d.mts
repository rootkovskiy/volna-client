export declare function assertMatrixKeyActive(key: Uint8Array): void;
export declare function bindMatrixKeyGuard(key: Uint8Array, guard: () => void): void;
export declare function withMatrixKeyWrite<T>(key: Uint8Array, operation: () => Promise<T>): Promise<T>;
export declare function closeMatrixKey(key: Uint8Array): Promise<void>;
export declare function assertMatrixAccountOpen(accountId: string): void;
export declare function withMatrixAccountShutdown<T>(accountId: string, operation: () => Promise<T>): Promise<T>;
