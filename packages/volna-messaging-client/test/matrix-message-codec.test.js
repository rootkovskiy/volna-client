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

test('Matrix codec round-trips every supported attachment in both dialog directions', async () => {
  const { encodeMatrixMessageContent, decodeMatrixMessageContent } = await import('../src/matrix-message-codec.mjs');
  const attachments = [
    { kind: 'location', latitude: 55.7558, longitude: 37.6173, accuracy: 12 },
    { kind: 'entity', entityType: 'account', id: 'account_alice_123', snapshot: { name: 'Алиса', username: 'alice' } },
    { kind: 'entity', entityType: 'publicPage', id: 'public_page_123', snapshot: { name: 'Клуб', username: 'club' } },
    { kind: 'entity', entityType: 'event', id: 'event_moscow_123', snapshot: { title: 'Концерт', startsAt: '2026-09-05T18:00:00.000Z' } },
    { kind: 'music', provider: 'bandcamp', id: 'track_bandcamp_123', title: 'Трек', artist: 'Артист', metadata: { previewUrl: 'https://volna.example/music/bandcamp/stream?trackId=123', externalUrl: 'https://artist.bandcamp.com/track/song' } },
  ];
  for (const [index, attachment] of attachments.entries()) {
    const direction = index % 2 === 0 ? 'first-to-second' : 'second-to-first';
    const event = {
      v: 1,
      kind: 'message.create',
      logicalMessageId: `message_attachment_${index}`,
      clientCreatedAt: `2026-09-04T18:0${index}:00.000Z`,
      attachment,
    };
    const encoded = encodeMatrixMessageContent(event, { body: direction, deviceId: `matrix_device_${index}` });
    const decoded = decodeMatrixMessageContent(encoded);
    assert.equal(decoded.body, direction);
    assert.deepEqual(JSON.parse(JSON.stringify(decoded.event.attachment)), attachment);
  }
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
