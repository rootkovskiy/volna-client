import type { MatrixDeviceSecurity, MatrixRoomSecurity, MatrixVerificationState } from './matrix-engine';
export declare function matrixSecurityErrorMessage(error: unknown): string;
export type MatrixSecurityDestination = 'devices' | 'partner' | 'verification' | 'recovery';
export declare function isActiveMatrixVerification(value: MatrixVerificationState | null | undefined): boolean;
export declare function selectMatrixVerification(security: MatrixRoomSecurity, current: MatrixVerificationState | null): MatrixVerificationState | null;
export declare function matrixOwnVerificationTargets(security: MatrixRoomSecurity | null): MatrixDeviceSecurity[];
export declare function matrixSecurityOverview(security: MatrixRoomSecurity | null, verification: MatrixVerificationState | null): { kind: 'loading' | 'identity-changed' | 'verification' | 'verify-current' | 'verify-other' | 'recovery' | 'ready'; title: string; description: string; action: MatrixSecurityDestination | null };
export declare function matrixDeviceDisplayName(options?: { platform?: string; userAgent?: string }): string;
export declare function matrixDeviceLabel(device: MatrixDeviceSecurity, devices: MatrixDeviceSecurity[]): string;
