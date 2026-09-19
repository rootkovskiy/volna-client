import { assertDownloadActive, audioFileExtension, downloadResponseError, MAX_DEVICE_DOWNLOAD_BYTES, MAX_DEVICE_DOWNLOADS, MAX_DOWNLOAD_BYTES, type DownloadRecord, type DownloadStorage, type LocalDownload } from './downloadTypes';

type Stored = DownloadRecord & { audio: Blob; artwork?: Blob };
const urls = new Map<string, LocalDownload>();
let database: Promise<IDBDatabase> | undefined;
function open() {
  if (!database) database = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('В этом браузере недоступно локальное хранилище')); return; }
    const request = indexedDB.open('volna-device-music-v1', 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('tracks')) request.result.createObjectStore('tracks', { keyPath: 'key' });
      if (!request.result.objectStoreNames.contains('control')) request.result.createObjectStore('control');
    };
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); database = undefined; }; resolve(request.result); };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Закройте другие вкладки VOLNA и повторите'));
  }).catch((error) => { database = undefined; throw error; });
  return database;
}
async function transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('tracks', mode);
    const request = action(tx.objectStore('tracks'));
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = tx.onerror = () => reject(tx.error || request.error || new Error('Не удалось сохранить файл'));
  });
}
function release(key: string) {
  const old = urls.get(key);
  if (old) { URL.revokeObjectURL(old.uri); if (old.artworkUri) URL.revokeObjectURL(old.artworkUri); urls.delete(key); }
}
function materialize(row: Stored): LocalDownload {
  const existing = urls.get(row.key);
  if (existing?.savedAt === row.savedAt) {
    const { audio: _audio, artwork, ...record } = row;
    const result = { ...record, uri: existing.uri, artworkUri: existing.artworkUri || (artwork ? URL.createObjectURL(artwork) : undefined) };
    urls.set(row.key, result);
    return result;
  }
  release(row.key);
  const { audio, artwork, ...record } = row;
  const result = { ...record, uri: URL.createObjectURL(audio), artworkUri: artwork ? URL.createObjectURL(artwork) : undefined };
  urls.set(row.key, result);
  return result;
}
async function readEpoch() {
  const db = await open();
  return new Promise<number>((resolve, reject) => {
    const tx = db.transaction('control', 'readonly'); const request = tx.objectStore('control').get('epoch');
    tx.oncomplete = () => resolve(request.result ?? 0);
    tx.onabort = tx.onerror = () => reject(tx.error || request.error);
  });
}
async function commit(row: Stored, epoch: number) {
  const db = await open();
  // Recheck the bound in the same transaction as the write: tabs share a device.
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['tracks', 'control'], 'readwrite'); const store = tx.objectStore('tracks');
    const currentEpoch = tx.objectStore('control').get('epoch');
    let capacityError: Error | undefined;
    currentEpoch.onsuccess = () => {
      if ((currentEpoch.result ?? 0) !== epoch) { capacityError = new Error('Скачивания были удалены. Запустите загрузку заново.'); tx.abort(); return; }
      const request = store.getAll();
      request.onsuccess = () => {
        const others = (request.result as Stored[]).filter((item) => item.key !== row.key);
        if (others.length >= MAX_DEVICE_DOWNLOADS || others.reduce((total, item) => total + item.bytes, row.bytes) > MAX_DEVICE_DOWNLOAD_BYTES) {
          capacityError = new Error('Освободите место: удалите ненужные скачивания'); tx.abort(); return;
        }
        store.put(row);
      };
    };
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(capacityError || tx.error || new Error('Не удалось сохранить файл'));
  });
}
async function fetchBlob(url: string, max: number, signal: AbortSignal, progress?: (received: number, total: number) => void): Promise<Blob> {
  const response = await fetch(url, { signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!response.ok || !response.body) throw downloadResponseError(response.status);
  const total = Number(response.headers.get('content-length')) || 0;
  if (total > max) { await response.body.cancel(); throw new Error('Файл слишком большой для скачивания'); }
  const reader = response.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > max) throw new Error('Файл слишком большой для скачивания');
      chunks.push(new Uint8Array(value)); progress?.(received, total);
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  if (!received || (total && received !== total)) throw new Error('Загрузка оборвалась. Скачайте трек ещё раз.');
  return new Blob(chunks, { type: response.headers.get('content-type') || 'application/octet-stream' });
}
export const downloadStorage: DownloadStorage = {
  async list() {
    const rows = await transaction<Stored[]>('readonly', (store) => store.getAll());
    const keys = new Set(rows.map((row) => row.key));
    for (const key of urls.keys()) if (!keys.has(key)) release(key);
    return rows.filter((row) => row.audio instanceof Blob && row.audio.size === row.bytes).map(materialize);
  },
  async save(record, url, artworkUrl, signal, progress) {
    const epoch = await readEpoch();
    void navigator.storage?.persist?.().catch(() => false);
    const audio = await fetchBlob(url, MAX_DOWNLOAD_BYTES, signal, (received, total) => progress({ received, total }));
    const extension = audioFileExtension(new Uint8Array(await audio.slice(0, 16).arrayBuffer()));
    let artwork: Blob | undefined;
    if (artworkUrl) {
      try { const candidate = await fetchBlob(artworkUrl, 3 * 1024 * 1024, signal); if (/^image\/(jpeg|png|webp|avif)(;|$)/i.test(candidate.type)) artwork = candidate; } catch { /* Audio remains useful without a cover. */ }
    }
    assertDownloadActive(signal);
    const row: Stored = { ...record, bytes: audio.size, audio: new Blob([audio], { type: extension === 'mp3' ? 'audio/mpeg' : 'audio/mp4' }), artwork };
    await commit(row, epoch);
    return materialize(row);
  },
  async remove(key) { await transaction('readwrite', (store) => store.delete(key)); release(key); },
  async clear() {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['tracks', 'control'], 'readwrite');
      const control = tx.objectStore('control'); const request = control.get('epoch');
      request.onsuccess = () => { control.put((request.result ?? 0) + 1, 'epoch'); tx.objectStore('tracks').clear(); };
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(tx.error || new Error('Не удалось удалить скачанное'));
    });
    for (const key of urls.keys()) release(key);
  },
  async repair(key, savedAt, track, artworkUrl, signal) {
    const before = await transaction<Stored | undefined>('readonly', (store) => store.get(key));
    if (!before || before.savedAt !== savedAt) return;
    let artwork = before.artwork;
    if (!artwork && artworkUrl) {
      try { const candidate = await fetchBlob(artworkUrl, 3 * 1024 * 1024, signal); if (/^image\/(jpeg|png|webp|avif)(;|$)/i.test(candidate.type)) artwork = candidate; } catch { /* Retry on the next visit; keep audio and public fallback. */ }
    }
    assertDownloadActive(signal);
    const db = await open();
    const row = await new Promise<Stored | undefined>((resolve, reject) => {
      const tx = db.transaction('tracks', 'readwrite'); const store = tx.objectStore('tracks');
      const request = store.get(key); let result: Stored | undefined;
      request.onsuccess = () => {
        const current = request.result as Stored | undefined;
        if (!signal.aborted && current?.savedAt === savedAt) {
          result = { ...current, track, metadataVersion: 2, artwork: current.artwork || artwork };
          store.put(result);
        }
      };
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () => reject(tx.error || new Error('Не удалось обновить описание'));
    });
    return row ? materialize(row) : undefined;
  },
};
