import type { DecryptedEventRecord, ProjectedMessage } from './message-projection.mjs';
import type { MatrixClient, Room } from 'matrix-js-sdk';
export function createEncryptedMatrixFetch(fetch: typeof globalThis.fetch, homeserverUrl: string): typeof globalThis.fetch;
export function originalEncryptedMatrixContent(event: { getWireType(): string; getType(): string; isDecryptionFailure(): boolean; getOriginalContent(): unknown }): unknown | null;
export function projectMatrixContentEvents(records: DecryptedEventRecord[]): ProjectedMessage[];
export function sendMatrixContentOnce(client: MatrixClient, room: Room, content: unknown, transactionId: string): Promise<{ event_id: string }>;
