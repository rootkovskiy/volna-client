import { Chacha20Poly1305 } from '@hpke/chacha20poly1305';
import { Dhkem, KdfId, KemId } from '@hpke/common';
import { CipherSuite } from '@hpke/core';
import { X25519 } from '@hpke/dhkem-x25519';
import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { makeGenericHpke } from 'ts-mls/crypto/implementation/hpke.js';

const HPKE_VERSION = new Uint8Array([72, 80, 75, 69, 45, 118, 49]);
const EMPTY = new Uint8Array();

export class VolnaCryptoError extends Error {
  constructor(code, cause) {
    super(`VOLNA messaging crypto error (${code})`, cause === undefined ? undefined : { cause });
    this.name = 'VolnaCryptoError';
    this.code = code;
  }
}

export function exactBytes(value, expectedLength, code = 'bytes') {
  if (!(value instanceof Uint8Array) || value.byteLength !== expectedLength) {
    throw new VolnaCryptoError(code);
  }
  return value;
}

export function exactArrayBuffer(value) {
  if (!(value instanceof Uint8Array)) throw new VolnaCryptoError('array_buffer');
  return value.slice().buffer;
}

function toBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new VolnaCryptoError('byte_source');
}

function concatBytes(...values) {
  const length = values.reduce((total, value) => total + value.byteLength, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const value of values) {
    result.set(value, offset);
    offset += value.byteLength;
  }
  return result;
}

function constantTimeEqual(left, right) {
  if (!(left instanceof Uint8Array) || !(right instanceof Uint8Array) || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

function hkdfExtract(saltSource, ikmSource) {
  const salt = toBytes(saltSource);
  const ikm = toBytes(ikmSource);
  return hmac(sha256, salt.byteLength === 0 ? new Uint8Array(32) : salt, ikm);
}

function hkdfExpand(prkSource, infoSource, length) {
  const prk = toBytes(prkSource);
  const info = toBytes(infoSource);
  if (!Number.isSafeInteger(length) || length < 0 || length > 255 * 32) {
    throw new VolnaCryptoError('hkdf_length');
  }
  const output = new Uint8Array(length);
  let previous = EMPTY;
  let offset = 0;
  try {
    for (let counter = 1; offset < length; counter += 1) {
      const expandedInput = concatBytes(previous, info, Uint8Array.of(counter));
      let next;
      try {
        next = hmac(sha256, prk, expandedInput);
      } finally {
        expandedInput.fill(0);
      }
      if (previous !== EMPTY) previous.fill(0);
      previous = next;
      const take = Math.min(previous.length, length - offset);
      output.set(previous.subarray(0, take), offset);
      offset += take;
    }
    return output;
  } finally {
    if (previous !== EMPTY) previous.fill(0);
  }
}

class PureHkdfSha256 {
  constructor() {
    this.id = KdfId.HkdfSha256;
    this.hashSize = 32;
    this.suiteId = undefined;
  }

  init(suiteId) {
    this.suiteId = toBytes(suiteId).slice();
  }

  assertInitialized() {
    if (this.suiteId === undefined) throw new VolnaCryptoError('hpke_kdf_not_initialized');
  }

  buildLabeledIkm(label, ikm) {
    this.assertInitialized();
    return concatBytes(HPKE_VERSION, this.suiteId, toBytes(label), toBytes(ikm));
  }

  buildLabeledInfo(label, info, length) {
    this.assertInitialized();
    if (!Number.isSafeInteger(length) || length < 0 || length > 0xffff) {
      throw new VolnaCryptoError('hpke_labeled_length');
    }
    return concatBytes(
      Uint8Array.of((length >>> 8) & 0xff, length & 0xff),
      HPKE_VERSION,
      this.suiteId,
      toBytes(label),
      toBytes(info),
    );
  }

  async extract(salt, ikm) {
    return exactArrayBuffer(hkdfExtract(salt, ikm));
  }

  async expand(prk, info, length) {
    return exactArrayBuffer(hkdfExpand(prk, info, length));
  }

  async extractAndExpand(salt, ikm, info, length) {
    const prk = hkdfExtract(salt, ikm);
    try {
      return exactArrayBuffer(hkdfExpand(prk, info, length));
    } finally {
      prk.fill(0);
    }
  }

  async labeledExtract(salt, label, ikm) {
    return this.extract(salt, this.buildLabeledIkm(label, ikm));
  }

  async labeledExpand(prk, label, info, length) {
    return this.expand(prk, this.buildLabeledInfo(label, info, length), length);
  }
}

class SecureDhkemX25519HkdfSha256 extends Dhkem {
  constructor(randomBytes) {
    const kdf = new PureHkdfSha256();
    super(KemId.DhkemX25519HkdfSha256, new X25519(kdf), kdf);
    this.id = KemId.DhkemX25519HkdfSha256;
    this.secretSize = 32;
    this.encSize = 32;
    this.publicKeySize = 32;
    this.privateKeySize = 32;
    this.randomBytes = randomBytes;
  }

  async generateKeyPair() {
    const seed = secureRandom(this.randomBytes, 32);
    try {
      return await this.deriveKeyPair(exactArrayBuffer(seed));
    } finally {
      seed.fill(0);
    }
  }
}

function secureRandom(randomBytes, length) {
  let value;
  try {
    value = randomBytes(length);
  } catch (error) {
    throw new VolnaCryptoError('rng_failed', error);
  }
  return exactBytes(value, length, 'rng_output');
}

function makeMlsKdf() {
  return {
    size: 32,
    async extract(salt, ikm) {
      return hkdfExtract(salt, ikm);
    },
    async expand(prk, info, length) {
      return hkdfExpand(prk, info, length);
    },
  };
}

function makeMlsHash() {
  return {
    async digest(data) {
      return sha256(data);
    },
    async mac(key, data) {
      return hmac(sha256, key, data);
    },
    async verifyMac(key, mac, data) {
      const expected = hmac(sha256, key, data);
      try {
        return constantTimeEqual(mac, expected);
      } finally {
        expected.fill(0);
      }
    },
  };
}

function makeMlsSignature(randomBytes) {
  return {
    async sign(signKey, message) {
      return ed25519.sign(message, exactBytes(signKey, 32, 'signature_private_key'));
    },
    async verify(publicKey, message, signature) {
      try {
        return ed25519.verify(
          exactBytes(signature, 64, 'signature'),
          message,
          exactBytes(publicKey, 32, 'signature_public_key'),
        );
      } catch {
        return false;
      }
    },
    async keygen() {
      const signKey = secureRandom(randomBytes, 32);
      return { signKey, publicKey: ed25519.getPublicKey(signKey) };
    },
  };
}

async function makeHpke(randomBytes) {
  const lowLevelAead = {
    async encrypt(key, nonce, aad, plaintext) {
      return chacha20poly1305(key, nonce, aad).encrypt(plaintext);
    },
    async decrypt(key, nonce, aad, ciphertext) {
      return chacha20poly1305(key, nonce, aad).decrypt(ciphertext);
    },
  };
  const suite = new CipherSuite({
    kem: new SecureDhkemX25519HkdfSha256(randomBytes),
    kdf: new PureHkdfSha256(),
    aead: new Chacha20Poly1305(),
  });
  return makeGenericHpke(
    {
      kem: 'DHKEM-X25519-HKDF-SHA256',
      kdf: 'HKDF-SHA256',
      aead: 'CHACHA20POLY1305',
    },
    lowLevelAead,
    suite,
  );
}

export function createVolnaCryptoProvider(randomBytes) {
  if (typeof randomBytes !== 'function') throw new VolnaCryptoError('rng_missing');
  return {
    async getCiphersuiteImpl(ciphersuite) {
      if (
        ciphersuite?.name !== 'MLS_128_DHKEMX25519_CHACHA20POLY1305_SHA256_Ed25519'
        || ciphersuite.hash !== 'SHA-256'
        || ciphersuite.signature !== 'Ed25519'
      ) {
        throw new VolnaCryptoError('unsupported_ciphersuite');
      }
      return {
        name: ciphersuite.name,
        rng: { randomBytes: (length) => secureRandom(randomBytes, length) },
        hash: makeMlsHash(),
        kdf: makeMlsKdf(),
        signature: makeMlsSignature(randomBytes),
        hpke: await makeHpke(randomBytes),
      };
    },
  };
}

export const pureCryptoInternalsForTest = Object.freeze({
  hkdfExtract,
  hkdfExpand,
});
