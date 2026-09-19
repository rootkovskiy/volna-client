export declare function matrixBase64ToBytes(value: unknown, size: number): Uint8Array;
export declare function canonicalMatrixJson(value: unknown): string;
export declare function unsignedMatrixPayload(value: Record<string, unknown>): Record<string, unknown>;
export declare function verifyMatrixSignedObject(value: Record<string, unknown>, userId: string, keyId: string, publicKey: string): boolean;
export declare function oneMatrixEd25519Key(value: unknown): [string, string];
