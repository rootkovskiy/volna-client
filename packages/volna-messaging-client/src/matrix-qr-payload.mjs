import { base64UrlToBytes, bytesToBase64Url } from './mls-runtime.mjs';

/** Transport decoding only. The Matrix SDK authenticates keys and transaction. */
export function matrixQrPayload(result, platform) {
  let bytes;
  if (platform === 'android') {
    // Never reconstruct binary keys from ML Kit's Unicode displayValue/rawValue.
    bytes = base64UrlToBytes(result?.extra?.rawBytesBase64Url, 2048);
  } else {
    const raw = result?.raw || result?.data;
    if (typeof raw !== 'string' || raw.length > 2048 || /[^\x00-\xff]/.test(raw)) throw new Error('Invalid Matrix QR payload');
    bytes = Uint8Array.from(raw, char => char.charCodeAt(0));
  }
  try {
    if (bytes.length < 90 || String.fromCharCode(...bytes.subarray(0, 6)) !== 'MATRIX' || bytes[6] !== 2) throw new Error('Invalid Matrix QR payload');
    return bytesToBase64Url(bytes);
  } finally { bytes.fill(0); }
}
