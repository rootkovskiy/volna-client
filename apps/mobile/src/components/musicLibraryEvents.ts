import type { ProfileMusicTrack } from '../types';

export type MusicLibraryChange =
  | { type: 'collection-track-added'; track: ProfileMusicTrack }
  | { type: 'collection-track-removed'; track: ProfileMusicTrack }
  | { type: 'refresh' };

const listeners = new Set<(change: MusicLibraryChange) => void>();

export function emitMusicLibraryChanged(change: MusicLibraryChange = { type: 'refresh' }) {
  listeners.forEach((listener) => listener(change));
}

export function subscribeMusicLibraryChanged(listener: (change: MusicLibraryChange) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
