'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

test('Matrix codec round-trips VOLNA music and Unicode emoji inside the encrypted event', async () => {
  const { encodeMatrixMessageContent, decodeMatrixMessageContent } = await import('../src/matrix-message-codec.mjs');
  const event = {
    v: 1,
    kind: 'message.create',
    logicalMessageId: 'message_matrix_1',
    clientCreatedAt: '2026-08-14T00:00:00.000Z',
    text: 'слушай 🌊',
    attachment: {
      kind: 'music',
      provider: 'volna',
      id: 'uploaded:track_matrix_1',
      title: 'Волна',
      artist: 'Артист',
      metadata: { artworkUrl: 'https://media.volna.social/music/track.webp' },
    },
  };
  const encoded = encodeMatrixMessageContent(event, { body: 'слушай 🌊', deviceId: 'matrix_device_1' });
  assert.deepEqual(JSON.parse(JSON.stringify(decodeMatrixMessageContent(encoded))), {
    body: 'слушай 🌊',
    deviceId: 'matrix_device_1',
    event,
  });
});

test('Matrix codec rejects unreviewed plaintext fields and invalid payloads', async () => {
  const { encodeMatrixMessageContent, decodeMatrixMessageContent } = await import('../src/matrix-message-codec.mjs');
  const encoded = encodeMatrixMessageContent({
    v: 1,
    kind: 'message.create',
    logicalMessageId: 'message_matrix_2',
    clientCreatedAt: '2026-08-14T00:00:00.000Z',
    text: 'ok',
  }, { body: 'ok', deviceId: 'matrix_device_2' });
  assert.throws(() => decodeMatrixMessageContent({ ...encoded, unexpected: 'leak' }), /content_keys/);
  assert.throws(() => decodeMatrixMessageContent({ ...encoded, body: '\u0000' }), /body/);
});
