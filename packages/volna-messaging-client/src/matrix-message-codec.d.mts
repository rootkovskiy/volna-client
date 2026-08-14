import type { ChatContentEvent } from './index';

export declare const VOLNA_MATRIX_MSGTYPE: 'social.volna.message.v1';
export declare const VOLNA_MATRIX_CONTENT_KEY: 'social.volna.content';
export declare const VOLNA_MATRIX_DEVICE_KEY: 'social.volna.device_id';

export declare class MatrixMessageCodecError extends Error {
  readonly code: string;
}

export declare function encodeMatrixMessageContent(
  event: unknown,
  options: { body?: string; deviceId: string },
): Record<string, unknown>;

export declare function decodeMatrixMessageContent(value: unknown): {
  body: string;
  deviceId: string;
  event: ChatContentEvent;
} | null;
