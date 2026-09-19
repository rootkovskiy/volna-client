import { ed25519 } from '@noble/curves/ed25519.js';
import { base64UrlToBytes } from './mls-runtime.mjs';

const encoder = new TextEncoder();

function compareUnicodeCodePoints(left, right) {
  const leftPoints = [...left].map((value) => value.codePointAt(0));
  const rightPoints = [...right].map((value) => value.codePointAt(0));
  for (let index = 0; index < Math.min(leftPoints.length, rightPoints.length); index += 1) {
    if (leftPoints[index] !== rightPoints[index]) return leftPoints[index] - rightPoints[index];
  }
  return leftPoints.length - rightPoints.length;
}

export function matrixBase64ToBytes(value, size) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+$/.test(value)) {
    throw new Error('Matrix key encoding is invalid');
  }
  const unpadded = value.replaceAll('+', '-').replaceAll('/', '_');
  const decoded = base64UrlToBytes(unpadded, size);
  if (decoded.length !== size) throw new Error('Matrix key size is invalid');
  return decoded;
}

export function canonicalMatrixJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error('Matrix signed JSON contains a non-canonical number');
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalMatrixJson).join(',')}]`;
  if (!value || typeof value !== 'object') throw new Error('Matrix signed JSON is invalid');
  return `{${Object.keys(value).sort(compareUnicodeCodePoints).map((key) => `${JSON.stringify(key)}:${canonicalMatrixJson(value[key])}`).join(',')}}`;
}

export function unsignedMatrixPayload(value) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'signatures' && key !== 'unsigned'));
}

function matrixSignature(value, userId, keyId) {
  const signatures = value.signatures;
  if (!signatures || typeof signatures !== 'object' || Array.isArray(signatures)) return null;
  const userSignatures = signatures[userId];
  if (!userSignatures || typeof userSignatures !== 'object' || Array.isArray(userSignatures)) return null;
  const signature = userSignatures[keyId];
  return typeof signature === 'string' ? signature : null;
}

export function verifyMatrixSignedObject(value, userId, keyId, publicKey) {
  const signature = matrixSignature(value, userId, keyId);
  if (!signature) return false;
  try {
    return ed25519.verify(
      matrixBase64ToBytes(signature, 64),
      encoder.encode(canonicalMatrixJson(unsignedMatrixPayload(value))),
      matrixBase64ToBytes(publicKey, 32),
      { zip215: false },
    );
  } catch {
    return false;
  }
}

export function oneMatrixEd25519Key(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Matrix signing key is invalid');
  const entries = Object.entries(value);
  if (entries.length !== 1 || !entries[0][0].startsWith('ed25519:') || typeof entries[0][1] !== 'string') {
    throw new Error('Matrix signing key set is invalid');
  }
  return entries[0];
}
