// Metro uses .web.ts in browsers; native files stay in this app's sandbox.
import * as FileSystem from 'expo-file-system/legacy';
import * as Crypto from 'expo-crypto';
import { assertDownloadActive, audioFileExtension, downloadResponseError, MAX_DOWNLOAD_BYTES, type DownloadRecord, type DownloadStorage, type LocalDownload } from './downloadTypes';

const directory = `${FileSystem.documentDirectory}volna-device-music-v1/`;
type Stored = DownloadRecord & { filename: string; artworkFilename?: string };
const records = new Map<string, Stored>();
let cleanedInterruptedTransfers = false;
async function ensureDirectory() {
  if (!FileSystem.documentDirectory) throw new Error('Локальное хранилище недоступно');
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
}
function materialize(row: Stored): LocalDownload {
  const { filename, artworkFilename, ...metadata } = row;
  return { ...metadata, uri: directory + filename, artworkUri: artworkFilename ? directory + artworkFilename : undefined };
}
function safeFilename(value: unknown): value is string { return typeof value === 'string' && /^[a-f0-9]{64}\.(mp3|m4a|jpg|part|json)$/.test(value); }
const storage: DownloadStorage = {
  async list() {
    await ensureDirectory();
    records.clear();
    const filenames = await FileSystem.readDirectoryAsync(directory);
    if (!cleanedInterruptedTransfers) {
      for (const name of filenames.filter((value) => /^[a-f0-9]{64}\.part$/.test(value))) await FileSystem.deleteAsync(directory + name, { idempotent: true });
      cleanedInterruptedTransfers = true;
    }
    for (const name of filenames.filter((value) => /^[a-f0-9]{64}\.json$/.test(value))) {
      try {
        const row: Stored = JSON.parse(await FileSystem.readAsStringAsync(directory + name));
        if (!safeFilename(row.filename) || !row.key || !row.track?.id || (row.artworkFilename && !safeFilename(row.artworkFilename))) continue;
        const info = await FileSystem.getInfoAsync(directory + row.filename);
        if (info.exists && !info.isDirectory && info.size === row.bytes) {
          if (row.artworkFilename && !(await FileSystem.getInfoAsync(directory + row.artworkFilename)).exists) row.artworkFilename = undefined;
          records.set(row.key, row);
        }
      } catch { /* An incomplete metadata record is not a playable download. */ }
    }
    return [...records.values()].map(materialize);
  },
  async save(record, url, artworkUrl, signal, progress) {
    await ensureDirectory();
    const id = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, record.key);
    const temporary = directory + id + '.part';
    let tooLarge = false;
    const task = FileSystem.createDownloadResumable(url, temporary, { sessionType: FileSystem.FileSystemSessionType.FOREGROUND }, (event) => {
      progress({ received: event.totalBytesWritten, total: Math.max(0, event.totalBytesExpectedToWrite) });
      if (event.totalBytesWritten > MAX_DOWNLOAD_BYTES || event.totalBytesExpectedToWrite > MAX_DOWNLOAD_BYTES) { tooLarge = true; void task.cancelAsync().catch(() => undefined); }
    });
    let coverTask: ReturnType<typeof FileSystem.createDownloadResumable> | undefined;
    const cancel = () => { void (coverTask || task).cancelAsync().catch(() => undefined); };
    signal.addEventListener('abort', cancel);
    let filename: string | undefined;
    let committed = false;
    try {
      assertDownloadActive(signal);
      const result = await task.downloadAsync();
      assertDownloadActive(signal);
      if (tooLarge) throw new Error('Файл слишком большой для скачивания');
      if (!result || result.status !== 200) throw downloadResponseError(result?.status ?? 0);
      const info = await FileSystem.getInfoAsync(temporary);
      if (!info.exists || info.isDirectory || !info.size || info.size > MAX_DOWNLOAD_BYTES) throw new Error('Не удалось скачать аудиофайл');
      const header = await FileSystem.readAsStringAsync(temporary, { encoding: FileSystem.EncodingType.Base64, position: 0, length: 16 });
      const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
      let bits = 0, buffer = 0; const bytes: number[] = [];
      for (const char of header.replace(/=+$/, '')) { buffer = (buffer << 6) | alphabet.indexOf(char); bits += 6; if (bits >= 8) { bits -= 8; bytes.push((buffer >> bits) & 255); } }
      filename = `${id}.${audioFileExtension(Uint8Array.from(bytes))}`;
      await FileSystem.moveAsync({ from: temporary, to: directory + filename });
      const row: Stored = { ...record, bytes: info.size, filename };
      if (artworkUrl) {
        let coverTooLarge = false;
        try {
          coverTask = FileSystem.createDownloadResumable(artworkUrl, temporary, { sessionType: FileSystem.FileSystemSessionType.FOREGROUND }, (event) => {
            if (event.totalBytesWritten > 3 * 1024 * 1024 || event.totalBytesExpectedToWrite > 3 * 1024 * 1024) { coverTooLarge = true; void coverTask?.cancelAsync().catch(() => undefined); }
          });
          const cover = await coverTask.downloadAsync();
          const mime = Object.entries(cover?.headers || {}).find(([key]) => key.toLowerCase() === 'content-type')?.[1];
          if (!coverTooLarge && cover?.status === 200 && /^image\/(jpeg|png|webp|avif)(;|$)/.test(mime || '')) {
            row.artworkFilename = `${id}.jpg`;
            await FileSystem.moveAsync({ from: temporary, to: directory + row.artworkFilename });
          }
        } catch { /* Optional cover failure must not discard the audio. */ }
        finally { coverTask = undefined; }
      }
      // The metadata commit is last: an interrupted transfer is never listed.
      await FileSystem.writeAsStringAsync(temporary, JSON.stringify(row));
      assertDownloadActive(signal);
      await FileSystem.moveAsync({ from: temporary, to: directory + id + '.json' });
      committed = true; records.set(row.key, row);
      return materialize(row);
    } finally {
      signal.removeEventListener('abort', cancel);
      await FileSystem.deleteAsync(temporary, { idempotent: true }).catch(() => undefined);
      if (!committed && filename) await FileSystem.deleteAsync(directory + filename, { idempotent: true }).catch(() => undefined);
      if (!committed) await FileSystem.deleteAsync(directory + id + '.jpg', { idempotent: true }).catch(() => undefined);
    }
  },
  async remove(key) {
    const row = records.get(key); if (!row) return;
    const id = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, key);
    await FileSystem.deleteAsync(directory + id + '.json', { idempotent: true });
    records.delete(key);
    await FileSystem.deleteAsync(directory + row.filename, { idempotent: true });
    if (row.artworkFilename) await FileSystem.deleteAsync(directory + row.artworkFilename, { idempotent: true });
  },
  async repair(key, savedAt, track, artworkUrl, signal) {
    const before = records.get(key);
    if (!before || before.savedAt !== savedAt) return;
    const id = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, key);
    const temporary = directory + id + '.part';
    const row: Stored = { ...before, track, metadataVersion: 2 };
    let committed = false;
    let task: ReturnType<typeof FileSystem.createDownloadResumable> | undefined;
    const cancel = () => { void task?.cancelAsync().catch(() => undefined); };
    signal.addEventListener('abort', cancel);
    try {
      assertDownloadActive(signal);
      if (!row.artworkFilename && artworkUrl) {
        let tooLarge = false;
        try {
          task = FileSystem.createDownloadResumable(artworkUrl, temporary, { sessionType: FileSystem.FileSystemSessionType.FOREGROUND }, (event) => {
            if (event.totalBytesWritten > 3 * 1024 * 1024 || event.totalBytesExpectedToWrite > 3 * 1024 * 1024) { tooLarge = true; cancel(); }
          });
          const cover = await task.downloadAsync();
          const mime = Object.entries(cover?.headers || {}).find(([name]) => name.toLowerCase() === 'content-type')?.[1];
          const info = await FileSystem.getInfoAsync(temporary);
          if (!tooLarge && cover?.status === 200 && /^image\/(jpeg|png|webp|avif)(;|$)/i.test(mime || '') && info.exists && !info.isDirectory && info.size > 0 && info.size <= 3 * 1024 * 1024) {
            await FileSystem.moveAsync({ from: temporary, to: directory + id + '.jpg' });
            row.artworkFilename = id + '.jpg';
          }
        } catch { /* Keep the public artwork fallback; audio is never touched. */ }
      }
      assertDownloadActive(signal);
      await FileSystem.writeAsStringAsync(temporary, JSON.stringify(row));
      assertDownloadActive(signal);
      await FileSystem.moveAsync({ from: temporary, to: directory + id + '.json' });
      committed = true;
      records.set(key, row);
      return materialize(row);
    } finally {
      signal.removeEventListener('abort', cancel);
      await FileSystem.deleteAsync(temporary, { idempotent: true }).catch(() => undefined);
      if (!committed && !before.artworkFilename && row.artworkFilename) await FileSystem.deleteAsync(directory + row.artworkFilename, { idempotent: true }).catch(() => undefined);
    }
  },
  async clear() {
    await ensureDirectory();
    const filenames = await FileSystem.readDirectoryAsync(directory);
    let failed = false;
    // Only this adapter's exact hash-named files, never the parent app directory.
    for (const name of filenames.filter(safeFilename)) {
      try {
        const info = await FileSystem.getInfoAsync(directory + name);
        if (info.exists && !info.isDirectory) await FileSystem.deleteAsync(directory + name, { idempotent: true });
      }
      catch { failed = true; }
    }
    records.clear();
    if (failed) throw new Error('Не удалось удалить все локальные файлы. Попробуйте ещё раз.');
  },
};

// File metadata commits and removal must not race or resurrect a deleted copy.
let operations: Promise<unknown> = Promise.resolve();
function serial<T>(action: () => Promise<T>): Promise<T> {
  const next = operations.then(action, action); operations = next.catch(() => undefined); return next;
}
export const downloadStorage: DownloadStorage = {
  list: () => serial(() => storage.list()),
  save: (...args) => serial(() => storage.save(...args)),
  repair: (...args) => serial(() => storage.repair(...args)),
  remove: (...args) => serial(() => storage.remove(...args)),
  clear: () => serial(() => storage.clear()),
};
