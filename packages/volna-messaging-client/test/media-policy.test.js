'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

test('automatic message media loads are restricted to the public VOLNA CDN', async () => {
  const { safeHttpsUrl, trustedPublicMediaUrl } = await import('../src/media-policy.mjs');
  assert.equal(trustedPublicMediaUrl('https://media.volna.social/chat/image.webp'), 'https://media.volna.social/chat/image.webp');
  assert.equal(trustedPublicMediaUrl('https://tracker.example/pixel.gif'), null);
  assert.equal(trustedPublicMediaUrl('http://media.volna.social/plaintext.webp'), null);
  assert.equal(trustedPublicMediaUrl('https://user:pass@media.volna.social/private.webp'), null);
  assert.equal(safeHttpsUrl('javascript:alert(1)'), null);
  assert.equal(safeHttpsUrl('file:///etc/passwd'), null);
  assert.equal(safeHttpsUrl('https://music.example/preview.mp3'), 'https://music.example/preview.mp3');
});
