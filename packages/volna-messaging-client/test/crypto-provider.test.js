'use strict';

const assert = require('node:assert/strict');
const { createHmac, hkdfSync } = require('node:crypto');
const test = require('node:test');

test('pure HKDF-SHA256 matches the platform implementation', async () => {
  const { pureCryptoInternalsForTest } = await import('../src/crypto-provider.mjs');
  const ikm = Buffer.from('0b'.repeat(22), 'hex');
  const salt = Buffer.from('000102030405060708090a0b0c', 'hex');
  const info = Buffer.from('f0f1f2f3f4f5f6f7f8f9', 'hex');
  const expectedPrk = createHmac('sha256', salt).update(ikm).digest();
  const actualPrk = pureCryptoInternalsForTest.hkdfExtract(salt, ikm);
  assert.deepEqual(Buffer.from(actualPrk), expectedPrk);
  const expectedOkm = Buffer.from(hkdfSync('sha256', ikm, salt, info, 42));
  const actualOkm = pureCryptoInternalsForTest.hkdfExpand(actualPrk, info, 42);
  assert.deepEqual(Buffer.from(actualOkm), expectedOkm);
  actualPrk.fill(0);
  actualOkm.fill(0);
  expectedPrk.fill(0);
  expectedOkm.fill(0);
});
