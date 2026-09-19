'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const availability = require('../src/music-availability.js');

test('reading private music display state performs no transport; only explicit play can check the source', async () => {
  availability.clearMusicAvailability();
  const { createMessagingSurfaceController } = await import('../src/messaging-surface-controller.mjs');
  const calls = [];
  const controller = createMessagingSurfaceController({
    apiOrigin: 'https://api.example.test',
    fetch: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ items: [{ state: 'unavailable', checkedAt: Date.now(), expiresAt: Date.now() + 300000 }] }));
    },
    getSecureMessagingClient: async () => { throw new Error('Not used'); },
    loadMessagingCapabilities: async () => ({ enrollmentEnabled: false, rolloutEnabled: false }),
  });
  const attachment = { kind: 'music', provider: 'soundcloud', id: 'track-id', title: 'PRIVATE TITLE', artist: 'PRIVATE ARTIST', metadata: { externalUrl: 'https://soundcloud.com/artist/music' } };
  const identity = availability.musicAvailabilityIdentity({ provider: attachment.provider, ...attachment.metadata });
  controller.resolveMusicPlayback(attachment);
  assert.equal(availability.getMusicAvailability(identity.key), null);
  assert.equal(calls.length, 0);
  await controller.checkMusicAvailabilityForPlayback(attachment);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.example.test/music/availability');
  assert.equal(calls[0].init.headers.get('content-type'), 'application/json');
  assert.equal(calls[0].init.body.includes('PRIVATE'), false);
  assert.equal(availability.getMusicAvailability(identity.key).state, 'unavailable');
  await controller.checkMusicAvailabilityForPlayback(attachment);
  assert.equal(calls.length, 1);
  availability.clearMusicAvailability();
});

test('availability is memory-only, bounded, and does not conflate removed with temporarily unknown', () => {
  availability.clearMusicAvailability();
  for (let index = 0; index < 300; index++) availability.setMusicAvailability(`track-${index}`, { state: 'unknown', checkedAt: 1, expiresAt: 2 });
  assert.equal(availability.getMusicAvailability('track-0'), null);
  assert.equal(availability.musicUnavailableLabel(availability.getMusicAvailability('track-299'), 'soundcloud'), null);
  assert.equal(availability.musicUnavailableLabel({ state: 'deleted' }, 'soundcloud'), 'Удалён из SoundCloud');
  availability.clearMusicAvailability();
  assert.equal(availability.getMusicAvailability('track-299'), null);
});

test('only affirmative recovery clears a negative; an ambiguous recheck keeps its last evidence', () => {
  availability.clearMusicAvailability();
  availability.setMusicAvailability('track', { state: 'unavailable', checkedAt: 1, expiresAt: 2 });
  availability.setMusicAvailability('track', { state: 'unknown', checkedAt: 3, expiresAt: 4 });
  assert.deepEqual(availability.getMusicAvailability('track'), { state: 'unavailable', checkedAt: 1, expiresAt: 4 });
  availability.setMusicAvailability('track', { state: 'available', checkedAt: 5, expiresAt: 6 });
  assert.equal(availability.musicUnavailableLabel(availability.getMusicAvailability('track'), 'soundcloud'), null);
  availability.clearMusicAvailability();
});
