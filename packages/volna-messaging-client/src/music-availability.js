'use strict';

// Public, endpoint-only display state. Reading it must never disclose a private chat's track to a server.
function musicAvailabilityIdentity(track) {
  const provider = track?.provider;
  const value = track?.sourceTrackUrl || track?.externalUrl;
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.searchParams.has('secret_token')) return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    let canonical;
    if (provider === 'youtube') {
      if (!['youtube.com', 'm.youtube.com', 'youtu.be'].includes(host)) return null;
      const id = host === 'youtu.be' ? url.pathname.slice(1) : url.searchParams.get('v') || url.pathname.match(/^\/(?:shorts|embed)\/([^/]+)/)?.[1];
      if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
      canonical = `https://www.youtube.com/watch?v=${id}`;
    } else {
      const allowed = provider === 'soundcloud' ? host === 'soundcloud.com' && /^\/[^/]+\/(?:sets\/)?[^/]+\/?$/.test(url.pathname)
        : provider === 'bandcamp' ? /^[a-z0-9-]+\.bandcamp\.com$/.test(host) && /^\/(track|album)\/[^/]+\/?$/.test(url.pathname)
        : provider === 'apple' ? host === 'music.apple.com'
        : provider === 'yandex' ? ['music.yandex.ru', 'music.yandex.com', 'music.yandex.kz'].includes(host) : false;
      if (!allowed) return null;
      const appleId = provider === 'apple' ? url.searchParams.get('i') : null;
      if (appleId && !/^\d+$/.test(appleId)) return null;
      url.hostname = host; url.search = ''; url.hash = '';
      if (appleId) url.searchParams.set('i', appleId);
      canonical = url.toString().replace(/\/$/, '');
    }
    return { key: `${provider}:${canonical}`, provider, externalUrl: canonical };
  } catch { return null; }
}

const entries = new Map();
const listeners = new Set();
function getMusicAvailability(key) { return key ? entries.get(key) || null : null; }
function setMusicAvailability(key, value) {
  if (!key || !value || !['available', 'unavailable', 'deleted', 'unknown'].includes(value.state)
    || !Number.isFinite(value.checkedAt) || !Number.isFinite(value.expiresAt)) return;
  const previous = entries.get(key);
  // A failed recheck is not evidence that a previously missing source returned.
  if (value.state === 'unknown' && ['unavailable', 'deleted'].includes(previous?.state)) {
    value = { ...previous, expiresAt: value.expiresAt };
  }
  entries.delete(key); entries.set(key, Object.freeze({ ...value }));
  while (entries.size > 256) entries.delete(entries.keys().next().value);
  listeners.forEach((listener) => listener());
}
function clearMusicAvailability() { entries.clear(); listeners.forEach((listener) => listener()); }
function subscribeMusicAvailability(listener) { listeners.add(listener); return () => listeners.delete(listener); }
function musicUnavailableLabel(value, provider) {
  if (value?.state === 'deleted') return `Удалён из ${({ soundcloud: 'SoundCloud', bandcamp: 'Bandcamp', youtube: 'YouTube', apple: 'Apple Music', yandex: 'Яндекс Музыки' })[provider] || 'источника'}`;
  return value?.state === 'unavailable' ? 'Трек недоступен' : null;
}
module.exports = { musicAvailabilityIdentity, getMusicAvailability, setMusicAvailability, clearMusicAvailability, subscribeMusicAvailability, musicUnavailableLabel };
