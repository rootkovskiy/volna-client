export type MusicAvailability = { state: 'available' | 'unavailable' | 'deleted' | 'unknown'; checkedAt: number; expiresAt: number };
export type MusicAvailabilityTrack = { provider?: string; externalUrl?: string | null; sourceTrackUrl?: string | null };
export type MusicAvailabilityIdentity = { key: string; provider: string; externalUrl: string };
export function musicAvailabilityIdentity(track: MusicAvailabilityTrack): MusicAvailabilityIdentity | null;
export function getMusicAvailability(key: string | null): MusicAvailability | null;
export function setMusicAvailability(key: string, value: MusicAvailability): void;
export function clearMusicAvailability(): void;
export function subscribeMusicAvailability(listener: () => void): () => void;
export function musicUnavailableLabel(value: MusicAvailability | null, provider?: string): string | null;
