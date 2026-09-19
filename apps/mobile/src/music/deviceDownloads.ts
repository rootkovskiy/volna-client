import { useEffect, useSyncExternalStore } from 'react';
import { apiFetch, apiUrl } from '../api/client';
import { downloadStorage } from './downloadStorage';
import { supportsDeviceDownloads } from './downloadDevice';
import { downloadableTrack, downloadIdentity, downloadMetadata, publicArtworkUrl, MAX_DEVICE_DOWNLOAD_BYTES, MAX_DEVICE_DOWNLOADS, MAX_DOWNLOAD_BYTES, type DownloadProgress, type DownloadTrack, type LocalDownload } from './downloadTypes';

type Job = { key: string; track: DownloadTrack; progress: DownloadProgress };
type Snapshot = { ready: boolean; items: LocalDownload[]; job: Job | null; error: string | null; clearing: boolean };
let snapshot: Snapshot = { ready: false, items: [], job: null, error: null, clearing: false };
const listeners = new Set<() => void>();
let loading: Promise<void> | null = null;
let controller: AbortController | null = null;
let revision = 0;
let transfer: Promise<void> | null = null;
let clearing: Promise<void> | null = null;
function update(patch: Partial<Snapshot>) { snapshot = { ...snapshot, ...patch }; listeners.forEach((listener) => listener()); }
export function loadDeviceDownloads(): Promise<void> {
  if (loading) return loading;
  const expectedRevision = revision;
  loading = downloadStorage.list().then((items) => { if (expectedRevision === revision) update({ ready: true, items: items.sort((a, b) => b.savedAt - a.savedAt), error: null }); })
    .catch(() => { if (expectedRevision === revision) update({ ready: true, error: 'Не удалось открыть скачивания на этом устройстве. Проверьте доступное место и настройки браузера.' }); })
    .finally(() => { loading = null; });
  return loading;
}
export function useDeviceDownloads() {
  const value = useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => snapshot, () => snapshot);
  useEffect(() => { if (!snapshot.ready) void loadDeviceDownloads(); }, []);
  return value;
}
export function findDeviceDownload(track: DownloadTrack): LocalDownload | undefined {
  return snapshot.items.find((item) => item.key === downloadIdentity(track));
}
export function downloadedPlaybackTrack<T extends DownloadTrack>(track: T): T {
  const local = findDeviceDownload(track);
  if (snapshot.clearing && (local || track.downloadKey)) throw new Error('Дождитесь удаления скачанных треков.');
  if (!local) {
    if (track.downloadKey) throw new Error('Локальная копия удалена. Скачайте трек ещё раз.');
    return track;
  }
  const metadata = track.downloadKey ? { ...track, ...local.track } : track;
  return { ...metadata, downloadKey: local.key, previewUrl: local.uri, artworkUrl: local.artworkUri || metadata.artworkUrl || local.track.artworkUrl } as T;
}
export function deviceDownloadTrack(item: LocalDownload): DownloadTrack {
  return { ...item.track, queueSource: 'device-downloads', downloadKey: item.key, previewUrl: item.uri, artworkUrl: item.artworkUri || item.track.artworkUrl };
}
export function deviceDownloadQueue() { return snapshot.items.map(deviceDownloadTrack); }
export function restrictDeviceDownloadQueue<T extends DownloadTrack & { queue?: DownloadTrack[]; queueIndex?: number; queueWindowResolver?: unknown }>(track: T): T {
  if (track.queueSource !== 'device-downloads') return track;
  if (!track.downloadKey || !findDeviceDownload(track)) throw new Error('Локальная копия удалена. Скачайте трек ещё раз.');
  const queue = (track.queue || [track]).filter((item) => item.downloadKey && findDeviceDownload(item))
    .map((item) => ({ ...downloadedPlaybackTrack(item), queueSource: 'device-downloads' as const }));
  if (!queue.some((item) => item.downloadKey === track.downloadKey)) queue.unshift({ ...downloadedPlaybackTrack(track), queueSource: 'device-downloads' });
  return { ...track, queue, queueIndex: queue.findIndex((item) => item.downloadKey === track.downloadKey), queueWindowResolver: undefined } as T;
}

async function resolveMetadata(tracks: DownloadTrack[], signal: AbortSignal): Promise<(Partial<DownloadTrack> | null)[]> {
  const response = await apiFetch(`${apiUrl}/my-music/download-metadata`, {
    method: 'POST', signal, headers: { 'Content-Type': 'application/json', 'x-volna-suppress-error-report': '1' },
    body: JSON.stringify({ tracks: tracks.map(({ id, provider, externalUrl, collectionId, releaseId }) => ({ id, provider, externalUrl, collectionId, releaseId })) }),
  });
  if (!response.ok) throw new Error('Описание временно недоступно');
  return (await response.json()).items;
}
async function localArtworkSource(value: string | null | undefined, signal: AbortSignal): Promise<string | undefined> {
  const url = publicArtworkUrl(value);
  if (!url) return;
  if (new URL(url).hostname === 'media.volna.social') return url;
  // Existing deterministic artwork cache reuses the same object, not another release/image record.
  try {
    const response = await apiFetch(`${apiUrl}/music/artwork/cache`, { method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', 'x-volna-suppress-error-report': '1' }, body: JSON.stringify({ url }) });
    if (response.ok) return publicArtworkUrl((await response.json()).artworkUrl) || url;
  } catch { /* Network failure keeps the original public fallback. */ }
  return url;
}

let repairing: Promise<void> | null = null;
let repairController: AbortController | null = null;
export function repairDeviceDownloads(sourceSignal: AbortSignal): Promise<void> {
  if (snapshot.clearing) return Promise.resolve();
  if (repairing) return repairing;
  const abort = new AbortController(); repairController = abort;
  const cancel = () => abort.abort();
  sourceSignal.addEventListener('abort', cancel);
  if (sourceSignal.aborted) abort.abort();
  const signal = abort.signal;
  repairing = (async () => {
    const pending = snapshot.items.filter((item) => item.metadataVersion !== 2 || !item.artworkUri);
    for (let offset = 0; offset < pending.length && !signal.aborted; offset += 20) {
      const batch = pending.slice(offset, offset + 20);
      const values = await resolveMetadata(batch.map((item) => item.track), signal);
      for (let index = 0; index < batch.length && !signal.aborted; index++) {
        const item = batch[index]; const value = values[index];
        if (!value && item.metadataVersion !== 2) continue;
        const track = downloadMetadata({ ...item.track, ...value, id: item.track.id, provider: item.track.provider, previewUrl: '' });
        const artwork = await localArtworkSource(track.artworkUrl, signal);
        if (artwork) track.artworkUrl = artwork;
        const result = await downloadStorage.repair(item.key, item.savedAt, track, artwork, signal);
        if (result && !signal.aborted && snapshot.items.some((row) => row.key === item.key && row.savedAt === item.savedAt)) {
          revision += 1; update({ items: snapshot.items.map((row) => row.key === item.key ? result : row) });
        }
      }
    }
  })().catch(() => { /* Offline files remain playable; retry on the next visit. */ }).finally(() => {
    sourceSignal.removeEventListener('abort', cancel); repairController = null; repairing = null;
  });
  return repairing;
}

function remoteSource(track: DownloadTrack): string {
  if (track.provider === 'soundcloud') {
    const value = new URL(track.sourceTrackUrl || track.externalUrl || '');
    if (value.protocol !== 'https:' || !['soundcloud.com', 'www.soundcloud.com'].includes(value.hostname)) throw new Error('Не удалось определить исходный трек');
    return `${apiUrl}/music/soundcloud/download?url=${encodeURIComponent(value.href)}`;
  }
  const value = new URL(track.previewUrl);
  const api = new URL(apiUrl);
  if (track.provider === 'bandcamp') {
    const ownStream = value.origin === api.origin && /^\/(?:api\/)?music\/bandcamp\/(stream|download)$/.test(value.pathname);
    const release = ownStream ? value.searchParams.get('url') : track.collectionId || track.externalUrl;
    const trackId = ownStream ? value.searchParams.get('trackId') : value.pathname.match(/\/mp3-128\/(\d+)/)?.[1] || track.id.match(/:(\d+)$/)?.[1];
    if (!release || !trackId || !/^\d{1,20}$/.test(trackId)) throw new Error('Не удалось определить трек Bandcamp. Откройте его заново.');
    // The audio CDN allows <audio> playback but does not grant fetch CORS.
    // Only this public MP3 stream is relayed; no server file or account copy.
    return `${apiUrl}/music/bandcamp/download?url=${encodeURIComponent(release)}&trackId=${encodeURIComponent(trackId)}`;
  }
  const apiStream = value.origin === api.origin && /^\/(?:api\/)?(?:music\/bandcamp\/stream|my-music\/stream\/)/.test(value.pathname);
  const publicMedia = value.protocol === 'https:' && (value.hostname === 'media.volna.social' || value.hostname.endsWith('.bcbits.com'));
  if (value.username || value.password || !(apiStream || publicMedia)) throw new Error('Этот источник пока не поддерживает скачивание');
  return value.href;
}
export function startDeviceDownload(track: DownloadTrack): Promise<void> {
  if (!supportsDeviceDownloads()) return Promise.reject(new Error('Скачивание доступно на телефонах и планшетах.'));
  if (snapshot.clearing) return Promise.reject(new Error('Дождитесь удаления скачанных треков.'));
  if (transfer) return Promise.reject(new Error('Дождитесь текущей загрузки или отмените её'));
  const operation = performDeviceDownload(track);
  transfer = operation;
  void operation.finally(() => { if (transfer === operation) transfer = null; }).catch(() => undefined);
  return operation;
}
async function performDeviceDownload(track: DownloadTrack) {
  if (snapshot.job) throw new Error('Дождитесь текущей загрузки или отмените её');
  if (!downloadableTrack(track)) throw new Error('Этот источник пока не поддерживает скачивание');
  const key = downloadIdentity(track);
  if (findDeviceDownload(track)) return;
  const source = remoteSource(track);
  const abort = new AbortController(); controller = abort;
  update({ job: { key, track, progress: { received: 0, total: 0 } } });
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; abort.abort(); }, 15 * 60_000);
  try {
    await loadDeviceDownloads();
    if (snapshot.error) throw new Error(snapshot.error);
    if (findDeviceDownload(track)) return;
    if (snapshot.items.length >= MAX_DEVICE_DOWNLOADS || snapshot.items.reduce((total, row) => total + row.bytes, 0) + MAX_DOWNLOAD_BYTES > MAX_DEVICE_DOWNLOAD_BYTES) throw new Error('Освободите место: удалите ненужные треки из «Скачанного»');
    let lastProgress = 0;
    let metadata = downloadMetadata(track); let metadataVersion = 1;
    const enrichment = new AbortController(); const enrichmentTimeout = setTimeout(() => enrichment.abort(), 12_000);
    const cancelEnrichment = () => enrichment.abort(); abort.signal.addEventListener('abort', cancelEnrichment);
    try {
      const [resolved] = await resolveMetadata([track], enrichment.signal);
      if (resolved) { metadata = downloadMetadata({ ...track, ...resolved, id: track.id, provider: track.provider }); metadataVersion = 2; }
      const artwork = await localArtworkSource(metadata.artworkUrl, enrichment.signal);
      if (artwork) metadata.artworkUrl = artwork;
    } catch { /* Existing public player metadata still survives offline enrichment failure. */ }
    finally { clearTimeout(enrichmentTimeout); abort.signal.removeEventListener('abort', cancelEnrichment); }
    const result = await downloadStorage.save({ key, track: metadata, metadataVersion, savedAt: Date.now() }, source, metadata.artworkUrl || undefined, abort.signal, (progress) => {
      if (Date.now() - lastProgress < 150 || abort.signal.aborted) return;
      lastProgress = Date.now(); update({ job: { key, track, progress } });
    });
    revision += 1; update({ items: [result, ...snapshot.items.filter((item) => item.key !== key)] });
  } catch (error) {
    if (abort.signal.aborted) {
      if (timedOut) throw new Error('Загрузка заняла слишком много времени. Проверьте соединение и попробуйте ещё раз.');
      return;
    }
    if (error instanceof Error && error.name === 'QuotaExceededError') throw new Error('На устройстве недостаточно места. Удалите ненужные скачивания.');
    // Network error messages can contain signed CDN URLs; do not expose them.
    throw new Error(error instanceof Error && /^[А-ЯЁ]/.test(error.message) ? error.message : 'Не удалось скачать трек. Проверьте интернет и свободное место.');
  } finally { clearTimeout(timeout); controller = null; update({ job: null }); }
}
export function cancelDeviceDownload() { controller?.abort(); }
export async function removeDeviceDownload(key: string) {
  if (snapshot.clearing) throw new Error('Дождитесь удаления скачанных треков.');
  await downloadStorage.remove(key);
  revision += 1; update({ items: snapshot.items.filter((item) => item.key !== key) });
}
/** The caller stops local playback before confirmation commits this operation. */
export function clearDeviceDownloads(): Promise<void> {
  if (clearing) return clearing;
  revision += 1; update({ clearing: true });
  controller?.abort(); repairController?.abort();
  clearing = (async () => {
    // A save may already be committing. Drain it before deleting so it cannot resurrect a row.
    await Promise.allSettled([transfer, repairing, loading]);
    await downloadStorage.clear();
    revision += 1; update({ ready: true, items: [], error: null });
  })().catch(async () => {
    revision += 1; await loadDeviceDownloads();
    throw new Error('Не удалось удалить все скачанные треки. Попробуйте ещё раз.');
  }).finally(() => { clearing = null; update({ clearing: false }); });
  return clearing;
}
export { downloadableTrack, downloadIdentity };
