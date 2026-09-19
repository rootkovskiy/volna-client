const assert = require('node:assert/strict');
const test = require('node:test');

test('Matrix QR preserves every binary byte from Android and rejects damaged text', async () => {
  const { matrixQrPayload } = await import('../src/matrix-qr-payload.mjs');
  const bytes = Buffer.concat([Buffer.from('MATRIX'), Buffer.from([2, 0, 0, 8]), Buffer.from('testflow'), Buffer.from(Array.from({ length: 256 }, (_, i) => i))]);
  const encoded = bytes.toString('base64url');
  assert.equal(matrixQrPayload({ extra: { rawBytesBase64Url: encoded }, raw: bytes.toString('utf8') }, 'android'), encoded);
  assert.equal(matrixQrPayload({ raw: bytes.toString('latin1') }, 'web'), encoded);
  for (const bad of [{ raw: bytes.toString('latin1') }, { extra: { rawBytesBase64Url: 'A' } },
    { extra: { rawBytesBase64Url: Buffer.alloc(2049).toString('base64url') } },
    { extra: { rawBytesBase64Url: Buffer.from('https://example.invalid').toString('base64url') } },
    { extra: { rawBytesBase64Url: Buffer.from('MATRIX\u0002').toString('base64url') } },
  ]) assert.throws(() => matrixQrPayload(bad, 'android'));
  assert.throws(() => matrixQrPayload({ raw: bytes.toString('utf8') }, 'web'));
  const wrongVersion = Buffer.from(bytes); wrongVersion[6] = 3;
  assert.throws(() => matrixQrPayload({ raw: wrongVersion.toString('latin1') }, 'web'));
});
