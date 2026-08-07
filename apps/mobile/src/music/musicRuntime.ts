import { apiFetch, apiUrl } from '../api/client';
import type { BandcampReleaseSnapshot, PublicPageAudioRelease } from '../types';
import type { GlobalTrackQueueItem } from '../components/GlobalAudioPlayer';
import { normalizeYouTubeTrackMetadata } from '../components/audioPlayerCore';

export type MusicProvider = 'apple' | 'yandex' | 'soundcloud' | 'bandcamp' | 'youtube' | 'volna';

export type MusicAttachment = {
  provider: MusicProvider;
  entityType: 'track' | 'release' | 'upload';
  sourceId: string;
  title: string;
  artist: string;
  artworkUrl: string | null;
  playbackUrl: string | null;
  externalUrl: string | null;
  collection: { id: string; title: string } | null;
};

export type SoundcloudReleaseSnapshot = {
  title: string;
  artist: string;
  artworkUrl: string | null;
  externalUrl: string;
  tracks: Array<{
    id: string;
    title: string;
    artist: string;
    artworkUrl: string | null;
    externalUrl: string;
    durationSeconds: number | null;
  }>;
};

export function bandcampPlaybackUrl(releaseUrl: string, trackId: string) {
  return `${apiUrl}/music/bandcamp/stream?url=${encodeURIComponent(releaseUrl)}&trackId=${encodeURIComponent(trackId)}`;
}

export function buildPlayableQueue(release: PublicPageAudioRelease | { id?: string; releaseUrl: string; genres?: string[]; metadata: BandcampReleaseSnapshot }): GlobalTrackQueueItem[] {
  const metadata = release.metadata as BandcampReleaseSnapshot;
  if (!Array.isArray(metadata.tracks)) return [];
  const provider = 'provider' in release ? release.provider : 'bandcamp';
  if (provider !== 'bandcamp' && provider !== 'soundcloud' && provider !== 'youtube') return [];
  const releaseId = 'id' in release && release.id && !release.id.startsWith('external:') ? release.id : undefined;
  const labelName = 'labelPage' in release
    ? release.labelPage?.musicLabelName?.trim() || release.labelPage?.name?.trim() || release.labelName?.trim() || null
    : null;
  const labelUsername = 'labelPage' in release ? release.labelPage?.username?.trim() || null : null;
  return metadata.tracks.flatMap((track) => {
    const soundcloudTrackUrl = track.externalUrl?.trim();
    if (provider === 'soundcloud' ? !soundcloudTrackUrl : !track.previewUrl) return [];
    const displayMetadata = provider === 'youtube' ? normalizeYouTubeTrackMetadata(track.title, track.artist) : { artist: track.artist || metadata.artist, title: track.title };
    return [{
    id: provider === 'youtube'
      ? `youtube:${track.id}`
      : provider === 'soundcloud'
        ? `soundcloud:${metadata.externalUrl || release.releaseUrl}:${track.id}`
        : `bandcamp:${metadata.externalUrl || release.releaseUrl}:${track.id}`,
    title: displayMetadata.title,
    artist: displayMetadata.artist,
    artworkUrl: track.artworkUrl || metadata.artworkUrl,
    previewUrl: provider === 'youtube'
      ? track.previewUrl!
      : provider === 'soundcloud'
        ? soundcloudTrackUrl!
        : bandcampPlaybackUrl(metadata.externalUrl || release.releaseUrl, track.id),
    externalUrl: soundcloudTrackUrl || release.releaseUrl,
    sourceTrackUrl: provider === 'soundcloud' ? soundcloudTrackUrl : undefined,
    provider,
    collectionId: metadata.externalUrl || release.releaseUrl,
    collectionTitle: provider === 'youtube' ? normalizeYouTubeTrackMetadata(metadata.title, metadata.artist).title : metadata.title,
    genres: release.genres ?? [],
    releaseId,
    labelName,
    labelUsername,
    participants: 'participants' in release ? release.participants ?? [] : [],
    startSeconds: 0,
    clipDurationSeconds: track.durationSeconds ?? 30,
  }];
  });
}

const bandcampReleaseCache = new Map<string, { expiresAt: number; value: BandcampReleaseSnapshot }>();
const bandcampReleaseRequests = new Map<string, Promise<BandcampReleaseSnapshot>>();
const BANDCAMP_METADATA_TTL_MS = 15 * 60 * 1000;

export async function getBandcampRelease(releaseUrl: string) {
  const key = releaseUrl.trim().replace(/\/$/, '');
  const cached = bandcampReleaseCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const pending = bandcampReleaseRequests.get(key);
  if (pending) return pending;
  const request = apiFetch(`${apiUrl}/music/bandcamp/release?url=${encodeURIComponent(key)}`)
    .then(async (response) => {
      if (!response.ok) throw new Error('Не удалось загрузить релиз Bandcamp');
      const value = await response.json() as BandcampReleaseSnapshot;
      bandcampReleaseCache.set(key, { expiresAt: Date.now() + BANDCAMP_METADATA_TTL_MS, value });
      return value;
    })
    .finally(() => bandcampReleaseRequests.delete(key));
  bandcampReleaseRequests.set(key, request);
  return request;
}

export function peekBandcampRelease(releaseUrl: string) {
  const key = releaseUrl.trim().replace(/\/$/, '');
  const cached = bandcampReleaseCache.get(key);
  return cached && cached.expiresAt > Date.now() ? cached.value : null;
}

const soundcloudReleaseCache = new Map<string, { expiresAt: number; value: SoundcloudReleaseSnapshot }>();
const soundcloudReleaseRequests = new Map<string, Promise<SoundcloudReleaseSnapshot>>();
const SOUNDCLOUD_METADATA_TTL_MS = 15 * 60 * 1000;

export async function getSoundcloudRelease(releaseUrl: string) {
  const key = releaseUrl.trim().replace(/\/$/, '');
  const cached = soundcloudReleaseCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const pending = soundcloudReleaseRequests.get(key);
  if (pending) return pending;
  const request = apiFetch(`${apiUrl}/music/soundcloud/release?url=${encodeURIComponent(key)}`)
    .then(async (response) => {
      if (!response.ok) throw new Error('Не удалось загрузить релиз SoundCloud');
      const value = await response.json() as SoundcloudReleaseSnapshot;
      soundcloudReleaseCache.set(key, { expiresAt: Date.now() + SOUNDCLOUD_METADATA_TTL_MS, value });
      return value;
    })
    .finally(() => soundcloudReleaseRequests.delete(key));
  soundcloudReleaseRequests.set(key, request);
  return request;
}
