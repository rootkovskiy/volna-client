import type { MusicReleaseParticipant } from '../types';
/** Public music only. Device storage never contains account/session or chat data. */
export type DownloadTrack = {
  id: string; title: string; artist: string | null; previewUrl: string;
  provider?: 'soundcloud' | 'bandcamp' | 'youtube' | 'volna' | 'apple' | 'yandex';
  externalUrl?: string | null; sourceTrackUrl?: string; artworkUrl?: string | null;
  collectionTitle?: string | null; collectionId?: string | null;
  releaseId?: string; releaseDate?: string | null; genres?: string[];
  labelName?: string | null; labelUsername?: string | null; participants?: MusicReleaseParticipant[];
  isLiveStream?: boolean; startSeconds?: number; clipDurationSeconds?: number;
  downloadKey?: string;
  queueSource?: 'device-downloads';
};
export type DownloadRecord = { key: string; track: DownloadTrack; bytes: number; savedAt: number; metadataVersion?: number };
export type LocalDownload = DownloadRecord & { uri: string; artworkUri?: string };
export type DownloadProgress = { received: number; total: number };
export const MAX_DOWNLOAD_BYTES = 256 * 1024 * 1024;
export const MAX_DEVICE_DOWNLOAD_BYTES = 2 * 1024 * 1024 * 1024;
export const MAX_DEVICE_DOWNLOADS = 500;
export function downloadResponseError(status: number): Error {
  return new Error(status === 415
    ? 'Этот источник не отдаёт готовый MP3. Поток HLS или защищённое аудио скачать пока нельзя.'
    : status === 429 || status === 503
      ? 'Скачивание временно недоступно. Попробуйте через несколько секунд.'
      : 'Не удалось скачать трек. Проверьте соединение и попробуйте ещё раз.');
}
export function assertDownloadActive(signal: AbortSignal) {
  if (signal.aborted) { const error = new Error('Загрузка отменена'); error.name = 'AbortError'; throw error; }
}

export function downloadIdentity(track: DownloadTrack): string {
  if (track.downloadKey) return track.downloadKey;
  const source = track.sourceTrackUrl || track.externalUrl || track.previewUrl;
  // A Bandcamp album can contain many concrete audio files with one external URL.
  return JSON.stringify([track.provider, track.provider === 'bandcamp' || track.provider === 'volna' ? track.id : source]);
}

export function downloadableTrack(track: DownloadTrack): boolean {
  return !track.isLiveStream
    && (track.provider === 'soundcloud' || track.provider === 'bandcamp' || track.provider === 'volna')
    && !(track.provider === 'soundcloud' && /\/sets\//.test(track.sourceTrackUrl || track.externalUrl || ''));
}

/** Whitelist metadata: never persist a queue, signed stream URL, account id or callback. */
export function downloadMetadata(track: DownloadTrack): DownloadTrack {
  return {
    id: track.id, title: track.title, artist: track.artist, provider: track.provider,
    previewUrl: '', externalUrl: track.externalUrl, sourceTrackUrl: track.sourceTrackUrl,
    collectionTitle: track.collectionTitle, collectionId: track.collectionId,
    artworkUrl: publicArtworkUrl(track.artworkUrl), releaseId: track.releaseId,
    releaseDate: track.releaseDate, genres: track.genres?.slice(0, 5),
    labelName: track.labelName, labelUsername: track.labelUsername,
    startSeconds: 0, clipDurationSeconds: Number.isFinite(track.clipDurationSeconds) ? track.clipDurationSeconds : undefined,
    participants: track.participants?.slice(0, 5).map((person) => person.entityType === 'text'
      ? { entityType: 'text', name: person.name }
      : { entityType: person.entityType, id: person.id, username: person.username, name: person.name,
        avatarUrl: publicArtworkUrl(person.avatarUrl), isVerified: person.isVerified }),
  };
}

/** Only stable public artwork. Never retain signed URLs or ephemeral local URIs. */
export function publicArtworkUrl(value: string | null | undefined): string | null {
  try {
    const url = new URL(value || '');
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) return null;
    if (url.hostname !== 'media.volna.social' && !/\.(bcbits|sndcdn|mzstatic|ytimg|yandex)\.(com|net)$/.test(url.hostname)) return null;
    return url.href;
  } catch { return null; }
}

export function audioFileExtension(bytes: Uint8Array): 'mp3' | 'm4a' {
  if ((bytes[0] === 73 && bytes[1] === 68 && bytes[2] === 51)
    || (bytes[0] === 255 && (bytes[1] & 0xe0) === 0xe0 && (bytes[1] & 6) !== 0)) return 'mp3';
  if (bytes[4] === 102 && bytes[5] === 116 && bytes[6] === 121 && bytes[7] === 112) return 'm4a';
  throw new Error('Этот источник не отдаёт готовый аудиофайл. Поток HLS или защищённое аудио скачать пока нельзя.');
}

export interface DownloadStorage {
  list(): Promise<LocalDownload[]>;
  save(record: Omit<DownloadRecord, 'bytes'>, url: string, artworkUrl: string | undefined, signal: AbortSignal, progress: (value: DownloadProgress) => void): Promise<LocalDownload>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
  /** Compare-and-update metadata/cover only. Missing/replaced records are never recreated. */
  repair(key: string, savedAt: number, track: DownloadTrack, artworkUrl: string | undefined, signal: AbortSignal): Promise<LocalDownload | undefined>;
}
