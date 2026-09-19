export interface MatrixRecipientCrypto {
  getAuthenticatedBackupVersion(): number;
  getRoomKeyRecipientPolicyVersion(): number;
  bindRoomKeyRecipients(roomId: string, peerId: string): Promise<void>;
}
export declare function requireMatrixRecipientCrypto<T>(crypto: T): T & MatrixRecipientCrypto;
