import { useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { apiFetch, apiUrl } from '../api/client';
import { clearMusicAvailability, getMusicAvailability, musicAvailabilityIdentity, musicUnavailableLabel, setMusicAvailability, subscribeMusicAvailability, type MusicAvailability, type MusicAvailabilityIdentity, type MusicAvailabilityTrack } from '@volna/messaging-client/music-availability';

const pending = new Map<string, { identity: MusicAvailabilityIdentity; resolve: (value: MusicAvailability | null) => void; promise: Promise<MusicAvailability | null> }>();
const observed = new Map<string, { identity: MusicAvailabilityIdentity; count: number }>();
let scheduled = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let generation = 0;
let polling: ReturnType<typeof setInterval> | null = null;
let removeAppListener: (() => void) | null = null;

function unknown(): MusicAvailability { const checkedAt = Date.now(); return { state: 'unknown', checkedAt, expiresAt: checkedAt + 30_000 }; }

async function flush() {
  const epoch = generation;
  while (pending.size && epoch === generation) {
    const batch = [...pending.entries()].slice(0, 8);
    let items: MusicAvailability[] = [];
    try {
      const response = await apiFetch(`${apiUrl}/music/availability`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tracks: batch.map(([, entry]) => ({ provider: entry.identity.provider, externalUrl: entry.identity.externalUrl })) }),
      });
      if (response.ok) items = (await response.json()).items ?? [];
    } catch { /* A transport error is unknown, never a removal signal. */ }
    batch.forEach(([key, entry], index) => {
      const value = items[index] ?? unknown();
      if (epoch === generation) { setMusicAvailability(key, value); pending.delete(key); }
      entry.resolve(epoch === generation ? getMusicAvailability(key) : null);
    });
  }
  if (epoch === generation) scheduled = false;
}

export function checkMusicAvailability(track: MusicAvailabilityTrack): Promise<MusicAvailability | null> {
  const identity = musicAvailabilityIdentity(track);
  if (!identity) return Promise.resolve(null);
  const cached = getMusicAvailability(identity.key);
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached);
  const existing = pending.get(identity.key);
  if (existing) return existing.promise;
  if (pending.size >= 256) return Promise.resolve(null);
  let resolve!: (value: MusicAvailability | null) => void;
  const promise = new Promise<MusicAvailability | null>((done) => { resolve = done; });
  pending.set(identity.key, { identity, promise, resolve });
  if (!scheduled) { scheduled = true; flushTimer = setTimeout(() => { flushTimer = null; void flush(); }, 30); }
  return promise;
}

function refreshObserved() {
  if (AppState.currentState !== 'active') return;
  for (const { identity } of observed.values()) void checkMusicAvailability(identity);
}

export function resetMusicAvailability() {
  generation += 1;
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  pending.forEach((entry) => entry.resolve(null)); pending.clear();
  scheduled = false; clearMusicAvailability();
}

export function useMusicAvailability(track: MusicAvailabilityTrack, enabled = true) {
  const identity = musicAvailabilityIdentity(track);
  const key = identity?.key ?? null;
  const status = useSyncExternalStore(subscribeMusicAvailability, () => getMusicAvailability(key), () => null);
  useEffect(() => {
    if (!enabled || !identity || !key) return;
    const existing = observed.get(key);
    if (existing) existing.count += 1;
    else if (observed.size < 256) observed.set(key, { identity, count: 1 });
    void checkMusicAvailability(identity);
    if (!polling) {
      polling = setInterval(refreshObserved, 60_000);
      const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') refreshObserved(); });
      removeAppListener = () => subscription.remove();
    }
    return () => {
      const current = observed.get(key);
      if (current && --current.count <= 0) observed.delete(key);
      if (!observed.size) {
        if (polling) clearInterval(polling);
        polling = null; removeAppListener?.(); removeAppListener = null;
      }
    };
  }, [key, enabled]);
  return { status, label: musicUnavailableLabel(status, track.provider) };
}

export function isKnownMusicUnavailable(track: MusicAvailabilityTrack) {
  return Boolean(musicUnavailableLabel(getMusicAvailability(musicAvailabilityIdentity(track)?.key ?? null), track.provider));
}
