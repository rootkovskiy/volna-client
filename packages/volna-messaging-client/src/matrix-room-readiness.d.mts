import type { MatrixClient, Room } from 'matrix-js-sdk';
export declare function waitForMatrixJoinedRoom(client: MatrixClient, roomId: string, options: {
  assertActive(): void;
  timeoutMs?: number;
}): Promise<Room>;
