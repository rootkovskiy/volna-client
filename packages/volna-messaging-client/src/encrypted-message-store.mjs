import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { base64UrlToBytes, bytesToBase64Url } from './mls-runtime.mjs';

const STORE_TAG = 'VOLNA-CHAT-ENCRYPTED-MESSAGE-STORE';
const STORE_VERSION = 1;
const MANIFEST_FORMAT = 2;
const STORE_ALGORITHM = 'XCHACHA20-POLY1305';
const STORAGE_PREFIX = '@volna/e2ee-message-db/v1';
const ID_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const MAX_THREADS = 10_000;
const MAX_RECORDS_PER_THREAD = 20_000;
const RECORDS_PER_CHUNK = 128;
const MAX_CHUNKS_PER_THREAD = Math.ceil(MAX_RECORDS_PER_THREAD / RECORDS_PER_CHUNK);
const MAX_THREAD_PLAINTEXT_BYTES = 32 * 1024 * 1024;
const MAX_CHUNK_PLAINTEXT_BYTES = 4 * 1024 * 1024;
const MAX_INDEX_PLAINTEXT_BYTES = 512 * 1024;
const MAX_MANIFEST_PLAINTEXT_BYTES = 2 * 1024 * 1024;

export class EncryptedMessageStoreError extends Error {
  constructor(code, cause) {
    super(`VOLNA encrypted message store error (${code})`, cause === undefined ? undefined : { cause });
    this.name = 'EncryptedMessageStoreError';
    this.code = code;
  }
}

function fail(code, cause) {
  throw new EncryptedMessageStoreError(code, cause);
}

function object(value, code) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(code);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail(code);
  return value;
}

function exactKeys(value, keys, code) {
  if (Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) fail(code);
}

function id(value, code) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) fail(code);
  return value;
}

function boundedInteger(value, minimum, maximum, code) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail(code);
  return value;
}

function hex(bytes) {
  let value = '';
  for (const byte of bytes) value += byte.toString(16).padStart(2, '0');
  return value;
}

function utf8(value) {
  return new TextEncoder().encode(value);
}

function decodeUtf8(bytes, code) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    fail(code, error);
  }
}

function clone(value, code = 'clone') {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    fail(code, error);
  }
}

function encodedHashAndSize(value) {
  const bytes = utf8(JSON.stringify(value));
  try {
    return { contentHash: hex(sha256(bytes)), plaintextBytes: bytes.length };
  } finally {
    bytes.fill(0);
  }
}

function exactKey(value, code) {
  let bytes;
  try {
    bytes = typeof value === 'string' ? base64UrlToBytes(value, 32) : value;
  } catch (error) {
    fail(code, error);
  }
  if (!(bytes instanceof Uint8Array) || bytes.length !== 32) fail(code);
  return bytes.slice();
}

function parseEnvelope(encoded, maximumBytes) {
  if (typeof encoded !== 'string' || encoded.length < 1 || encoded.length > Math.ceil(maximumBytes * 4 / 3) + 512) {
    fail('encrypted_envelope');
  }
  let value;
  try {
    value = JSON.parse(encoded);
  } catch (error) {
    fail('encrypted_envelope_json', error);
  }
  value = object(value, 'encrypted_envelope');
  exactKeys(value, ['v', 'alg', 'nonce', 'ciphertext'], 'encrypted_envelope');
  if (value.v !== STORE_VERSION || value.alg !== STORE_ALGORITHM) fail('encrypted_envelope');
  let nonce;
  let ciphertext;
  try {
    nonce = base64UrlToBytes(value.nonce, 24);
    ciphertext = base64UrlToBytes(value.ciphertext, maximumBytes + 16);
  } catch (error) {
    fail('decrypt', error);
  }
  if (nonce.length !== 24 || ciphertext.length < 16 || ciphertext.length > maximumBytes + 16) fail('encrypted_envelope');
  return { nonce, ciphertext };
}

function validateStorageKey(value, prefix, seen, code) {
  if (
    typeof value !== 'string'
    || !value.startsWith(`${prefix}/`)
    || value.length > prefix.length + 128
    || seen.has(value)
  ) fail(code);
  seen.add(value);
  return value;
}

function normalizedManifest(value, prefix) {
  const manifest = object(value, 'manifest');
  const legacy = manifest.format === undefined;
  exactKeys(manifest, legacy ? ['v', 'revision', 'threads'] : ['v', 'format', 'revision', 'threads'], 'manifest');
  if (
    manifest.v !== STORE_VERSION
    || (!legacy && manifest.format !== MANIFEST_FORMAT)
    || !Number.isSafeInteger(manifest.revision)
    || manifest.revision < 0
  ) fail('manifest');
  const threadsValue = object(manifest.threads, 'manifest_threads');
  const threadEntries = Object.entries(threadsValue);
  if (threadEntries.length > MAX_THREADS) fail('manifest_threads');
  const threads = {};
  const seenStorageKeys = new Set();
  for (const [threadIdValue, descriptorValue] of threadEntries) {
    const threadId = id(threadIdValue, 'manifest_thread_id');
    const descriptor = object(descriptorValue, 'manifest_descriptor');
    if (legacy) {
      exactKeys(descriptor, ['revision', 'recordKey', 'contentHash'], 'manifest_descriptor');
      boundedInteger(descriptor.revision, 1, Number.MAX_SAFE_INTEGER, 'manifest_descriptor');
      validateStorageKey(descriptor.recordKey, prefix, seenStorageKeys, 'manifest_record_key');
      if (typeof descriptor.contentHash !== 'string' || !HASH_PATTERN.test(descriptor.contentHash)) fail('manifest_content_hash');
      threads[threadId] = {
        format: 1,
        revision: descriptor.revision,
        recordKey: descriptor.recordKey,
        contentHash: descriptor.contentHash,
      };
      continue;
    }
    exactKeys(descriptor, ['revision', 'indexKey', 'recordCount', 'plaintextBytes'], 'manifest_descriptor');
    boundedInteger(descriptor.revision, 1, Number.MAX_SAFE_INTEGER, 'manifest_descriptor');
    boundedInteger(descriptor.recordCount, 0, MAX_RECORDS_PER_THREAD, 'manifest_descriptor');
    boundedInteger(descriptor.plaintextBytes, 0, MAX_THREAD_PLAINTEXT_BYTES, 'manifest_descriptor');
    validateStorageKey(descriptor.indexKey, prefix, seenStorageKeys, 'manifest_index_key');
    threads[threadId] = {
      format: MANIFEST_FORMAT,
      revision: descriptor.revision,
      indexKey: descriptor.indexKey,
      recordCount: descriptor.recordCount,
      plaintextBytes: descriptor.plaintextBytes,
    };
  }
  return {
    v: STORE_VERSION,
    format: legacy ? 1 : MANIFEST_FORMAT,
    revision: manifest.revision,
    threads,
  };
}

function normalizedIndex(value, descriptor, prefix) {
  const index = object(value, 'thread_index');
  exactKeys(
    index,
    ['v', 'format', 'threadId', 'revision', 'recordCount', 'plaintextBytes', 'chunks'],
    'thread_index',
  );
  if (
    index.v !== STORE_VERSION
    || index.format !== MANIFEST_FORMAT
    || index.threadId !== descriptor.threadId
    || index.revision !== descriptor.revision
    || index.recordCount !== descriptor.recordCount
    || index.plaintextBytes !== descriptor.plaintextBytes
    || !Array.isArray(index.chunks)
    || index.chunks.length > MAX_CHUNKS_PER_THREAD
  ) fail('thread_index');
  const seenStorageKeys = new Set();
  let recordCount = 0;
  let plaintextBytes = 0;
  const chunks = index.chunks.map((chunkValue, position) => {
    const chunk = object(chunkValue, 'thread_chunk_descriptor');
    exactKeys(
      chunk,
      ['index', 'revision', 'recordKey', 'recordCount', 'plaintextBytes', 'contentHash'],
      'thread_chunk_descriptor',
    );
    if (chunk.index !== position) fail('thread_chunk_order');
    boundedInteger(chunk.revision, 1, Number.MAX_SAFE_INTEGER, 'thread_chunk_descriptor');
    boundedInteger(chunk.recordCount, 1, RECORDS_PER_CHUNK, 'thread_chunk_descriptor');
    boundedInteger(chunk.plaintextBytes, 1, MAX_CHUNK_PLAINTEXT_BYTES, 'thread_chunk_descriptor');
    if (position < index.chunks.length - 1 && chunk.recordCount !== RECORDS_PER_CHUNK) fail('thread_chunk_size');
    if (typeof chunk.contentHash !== 'string' || !HASH_PATTERN.test(chunk.contentHash)) fail('thread_chunk_hash');
    validateStorageKey(chunk.recordKey, prefix, seenStorageKeys, 'thread_chunk_record_key');
    recordCount += chunk.recordCount;
    plaintextBytes += chunk.plaintextBytes;
    return {
      index: chunk.index,
      revision: chunk.revision,
      recordKey: chunk.recordKey,
      recordCount: chunk.recordCount,
      plaintextBytes: chunk.plaintextBytes,
      contentHash: chunk.contentHash,
    };
  });
  if (recordCount !== index.recordCount || plaintextBytes !== index.plaintextBytes) fail('thread_index_totals');
  if ((recordCount === 0) !== (chunks.length === 0)) fail('thread_index_empty');
  return {
    v: STORE_VERSION,
    format: MANIFEST_FORMAT,
    threadId: index.threadId,
    revision: index.revision,
    recordCount,
    plaintextBytes,
    chunks,
  };
}

export function createEncryptedMessageStore(optionsValue) {
  const options = object(optionsValue, 'store_options');
  if (typeof options.scope !== 'string' || options.scope.length < 3 || options.scope.length > 200) fail('store_scope');
  if (typeof options.randomBytes !== 'function') fail('store_rng');
  const database = object(options.database, 'store_database');
  for (const method of ['getItem', 'setItem', 'removeItem', 'getAllKeys']) {
    if (typeof database[method] !== 'function') fail('store_database');
  }
  const wrappingKeyProvider = object(options.wrappingKeyProvider, 'wrapping_key_provider');
  if (typeof wrappingKeyProvider.getKey !== 'function') fail('wrapping_key_provider');
  if (options.withLock !== undefined && typeof options.withLock !== 'function') fail('store_lock');
  const scopeHash = bytesToBase64Url(sha256(utf8(JSON.stringify([STORE_TAG, STORE_VERSION, options.scope]))));
  const prefix = `${STORAGE_PREFIX}/${scopeHash}`;
  let masterKey = null;
  let pendingKey = null;
  let operationTail = Promise.resolve();

  const randomBytes = (length) => {
    let value;
    try {
      value = options.randomBytes(length);
    } catch (error) {
      fail('store_rng', error);
    }
    if (!(value instanceof Uint8Array) || value.length !== length) fail('store_rng');
    return value.slice();
  };

  const getMasterKey = async () => {
    if (masterKey !== null) return masterKey.slice();
    pendingKey ??= (async () => {
      let wrappingKey;
      let derived;
      try {
        wrappingKey = exactKey(await wrappingKeyProvider.getKey('message-projection-db:v1'), 'wrapping_key');
        derived = hkdf(
          sha256,
          wrappingKey,
          sha256(utf8(STORE_TAG)),
          utf8(JSON.stringify([STORE_TAG, STORE_VERSION, options.scope])),
          32,
        );
        masterKey = derived.slice();
      } finally {
        wrappingKey?.fill(0);
        derived?.fill(0);
      }
    })();
    try {
      await pendingKey;
      if (masterKey === null) fail('wrapping_key');
      return masterKey.slice();
    } catch (error) {
      if (error instanceof EncryptedMessageStoreError) throw error;
      fail('wrapping_key', error);
    } finally {
      pendingKey = null;
    }
  };

  const derive = (master, purpose) => hmac(sha256, master, utf8(JSON.stringify([STORE_TAG, STORE_VERSION, purpose])));
  const storageKey = (master, purpose) => {
    const material = derive(master, purpose);
    try {
      return `${prefix}/${bytesToBase64Url(material)}`;
    } finally {
      material.fill(0);
    }
  };
  const manifestStorageKey = (master) => storageKey(master, 'manifest-storage-key');
  const threadIndexStorageKey = (master, threadId, revision) => storageKey(
    master,
    `thread-index-storage-key:${threadId}:${revision}`,
  );
  const threadChunkStorageKey = (master, threadId, revision, chunkIndex) => storageKey(
    master,
    `thread-chunk-storage-key:${threadId}:${revision}:${chunkIndex}`,
  );
  const manifestAad = utf8(JSON.stringify([STORE_TAG, STORE_VERSION, scopeHash, 'manifest']));
  const legacyThreadAad = (threadId, revision) => utf8(JSON.stringify([
    STORE_TAG,
    STORE_VERSION,
    scopeHash,
    'thread',
    threadId,
    revision,
  ]));
  const threadIndexAad = (threadId, revision) => utf8(JSON.stringify([
    STORE_TAG,
    STORE_VERSION,
    MANIFEST_FORMAT,
    scopeHash,
    'thread-index',
    threadId,
    revision,
  ]));
  const threadChunkAad = (threadId, revision, chunkIndex) => utf8(JSON.stringify([
    STORE_TAG,
    STORE_VERSION,
    MANIFEST_FORMAT,
    scopeHash,
    'thread-chunk',
    threadId,
    revision,
    chunkIndex,
  ]));

  const encryptValue = (key, aad, value, maximumBytes) => {
    const plaintext = utf8(JSON.stringify(value));
    if (plaintext.length > maximumBytes) fail('plaintext_too_large');
    const nonce = randomBytes(24);
    try {
      const ciphertext = xchacha20poly1305(key, nonce, aad).encrypt(plaintext);
      return JSON.stringify({
        v: STORE_VERSION,
        alg: STORE_ALGORITHM,
        nonce: bytesToBase64Url(nonce),
        ciphertext: bytesToBase64Url(ciphertext),
      });
    } finally {
      plaintext.fill(0);
      nonce.fill(0);
    }
  };

  const decryptValue = (key, aad, encoded, maximumBytes) => {
    const envelope = parseEnvelope(encoded, maximumBytes);
    let plaintext;
    try {
      plaintext = xchacha20poly1305(key, envelope.nonce, aad).decrypt(envelope.ciphertext);
      const decoded = decodeUtf8(plaintext, 'decrypt');
      return JSON.parse(decoded);
    } catch (error) {
      if (error instanceof EncryptedMessageStoreError) throw error;
      fail('decrypt', error);
    } finally {
      plaintext?.fill(0);
      envelope.nonce.fill(0);
      envelope.ciphertext.fill(0);
    }
  };

  const databaseGet = async (key) => {
    try {
      const value = await database.getItem(key);
      if (value !== null && typeof value !== 'string') fail('database_value');
      return value;
    } catch (error) {
      if (error instanceof EncryptedMessageStoreError) throw error;
      fail('database_read', error);
    }
  };
  const databaseSet = async (key, value) => {
    try {
      await database.setItem(key, value);
    } catch (error) {
      fail('database_write', error);
    }
  };
  const databaseRemove = async (key) => {
    try {
      await database.removeItem(key);
    } catch (error) {
      fail('database_remove', error);
    }
  };
  const databaseKeys = async () => {
    try {
      const keys = await database.getAllKeys();
      if (!Array.isArray(keys) || keys.some((key) => typeof key !== 'string')) fail('database_keys');
      return keys;
    } catch (error) {
      if (error instanceof EncryptedMessageStoreError) throw error;
      fail('database_keys', error);
    }
  };

  const readManifest = async (master) => {
    const encoded = await databaseGet(manifestStorageKey(master));
    if (encoded === null) return { v: STORE_VERSION, format: MANIFEST_FORMAT, revision: 0, threads: {} };
    const key = derive(master, 'manifest-encryption-key');
    try {
      return normalizedManifest(
        decryptValue(key, manifestAad, encoded, MAX_MANIFEST_PLAINTEXT_BYTES),
        prefix,
      );
    } finally {
      key.fill(0);
    }
  };

  const readThreadIndex = async (master, threadId, descriptor) => {
    if (descriptor.format !== MANIFEST_FORMAT) fail('thread_index_format');
    const encoded = await databaseGet(descriptor.indexKey);
    if (encoded === null) fail('thread_index_missing');
    const key = derive(master, `thread-index-encryption-key:${threadId}`);
    try {
      return normalizedIndex(
        decryptValue(
          key,
          threadIndexAad(threadId, descriptor.revision),
          encoded,
          MAX_INDEX_PLAINTEXT_BYTES,
        ),
        { ...descriptor, threadId },
        prefix,
      );
    } finally {
      key.fill(0);
    }
  };

  const readChunk = async (master, threadId, descriptor) => {
    const encoded = await databaseGet(descriptor.recordKey);
    if (encoded === null) fail('thread_chunk_missing');
    const key = derive(master, `thread-chunk-encryption-key:${threadId}`);
    let value;
    try {
      value = object(
        decryptValue(
          key,
          threadChunkAad(threadId, descriptor.revision, descriptor.index),
          encoded,
          MAX_CHUNK_PLAINTEXT_BYTES,
        ),
        'thread_chunk',
      );
    } finally {
      key.fill(0);
    }
    exactKeys(value, ['v', 'format', 'threadId', 'revision', 'index', 'records'], 'thread_chunk');
    if (
      value.v !== STORE_VERSION
      || value.format !== MANIFEST_FORMAT
      || value.threadId !== threadId
      || value.revision !== descriptor.revision
      || value.index !== descriptor.index
      || !Array.isArray(value.records)
      || value.records.length !== descriptor.recordCount
    ) fail('thread_chunk');
    const records = clone(value.records, 'thread_records');
    const measured = encodedHashAndSize(records);
    if (measured.contentHash !== descriptor.contentHash || measured.plaintextBytes !== descriptor.plaintextBytes) {
      fail('thread_chunk_content');
    }
    return records;
  };

  const readLegacyThread = async (master, threadId, descriptor) => {
    const encoded = await databaseGet(descriptor.recordKey);
    if (encoded === null) fail('record_missing');
    const key = derive(master, `thread-encryption-key:${threadId}`);
    let value;
    try {
      value = object(
        decryptValue(key, legacyThreadAad(threadId, descriptor.revision), encoded, MAX_THREAD_PLAINTEXT_BYTES),
        'thread_record',
      );
    } finally {
      key.fill(0);
    }
    exactKeys(value, ['v', 'threadId', 'records'], 'thread_record');
    if (value.v !== STORE_VERSION || value.threadId !== threadId || !Array.isArray(value.records)) fail('thread_record');
    if (value.records.length > MAX_RECORDS_PER_THREAD) fail('thread_records');
    const records = clone(value.records, 'thread_records');
    if (encodedHashAndSize(records).contentHash !== descriptor.contentHash) fail('thread_content_hash');
    return { records, retainedKeys: new Set([descriptor.recordKey]), index: null };
  };

  const readThread = async (master, threadId, descriptor) => {
    if (descriptor.format === 1) return readLegacyThread(master, threadId, descriptor);
    const index = await readThreadIndex(master, threadId, descriptor);
    const records = [];
    const retainedKeys = new Set([descriptor.indexKey]);
    for (const chunk of index.chunks) {
      records.push(...await readChunk(master, threadId, chunk));
      retainedKeys.add(chunk.recordKey);
    }
    if (records.length !== descriptor.recordCount) fail('thread_record_count');
    return { records, retainedKeys, index };
  };

  const cleanupOrphans = async (master, retainedValue) => {
    const retained = new Set([manifestStorageKey(master), ...retainedValue]);
    const keys = await databaseKeys();
    for (const key of keys) {
      if (key.startsWith(`${prefix}/`) && !retained.has(key)) await databaseRemove(key);
    }
  };

  const runExclusive = (operation) => {
    const run = async () => options.withLock === undefined
      ? operation()
      : options.withLock(`volna-message-store:${scopeHash}`, operation);
    const current = operationTail.then(run, run);
    operationTail = current.catch(() => undefined);
    return current;
  };

  const loadAllThreads = () => runExclusive(async () => {
    const master = await getMasterKey();
    try {
      const manifest = await readManifest(master);
      const threads = {};
      const retained = new Set();
      for (const threadId of Object.keys(manifest.threads).sort()) {
        const loaded = await readThread(master, threadId, manifest.threads[threadId]);
        threads[threadId] = loaded.records;
        for (const key of loaded.retainedKeys) retained.add(key);
      }
      await cleanupOrphans(master, retained);
      return threads;
    } finally {
      master.fill(0);
    }
  });

  const normalizeChanges = (value, sourceThreadIds) => {
    if (value === undefined) {
      return {
        changedThreadIds: new Set(sourceThreadIds),
        appendOnlyThreadIds: new Set(),
      };
    }
    const input = object(value, 'save_options');
    exactKeys(input, ['changedThreadIds', 'appendOnlyThreadIds'], 'save_options');
    if (!Array.isArray(input.changedThreadIds) || !Array.isArray(input.appendOnlyThreadIds)) fail('save_options');
    const changedThreadIds = new Set(input.changedThreadIds.map((valueItem) => id(valueItem, 'changed_thread_id')));
    const appendOnlyThreadIds = new Set(input.appendOnlyThreadIds.map((valueItem) => id(valueItem, 'append_thread_id')));
    if (changedThreadIds.size !== input.changedThreadIds.length || appendOnlyThreadIds.size !== input.appendOnlyThreadIds.length) {
      fail('save_options_duplicate');
    }
    const sourceSet = new Set(sourceThreadIds);
    if ([...changedThreadIds].some((threadId) => !sourceSet.has(threadId))) fail('changed_thread_missing');
    if ([...appendOnlyThreadIds].some((threadId) => !changedThreadIds.has(threadId))) fail('append_thread_not_changed');
    return { changedThreadIds, appendOnlyThreadIds };
  };

  const writeChunk = async (master, threadId, threadRevision, chunkIndex, records) => {
    const measured = encodedHashAndSize(records);
    if (measured.plaintextBytes < 1 || measured.plaintextBytes > MAX_CHUNK_PLAINTEXT_BYTES) fail('thread_chunk_size');
    const recordKey = threadChunkStorageKey(master, threadId, threadRevision, chunkIndex);
    const key = derive(master, `thread-chunk-encryption-key:${threadId}`);
    try {
      await databaseSet(
        recordKey,
        encryptValue(
          key,
          threadChunkAad(threadId, threadRevision, chunkIndex),
          {
            v: STORE_VERSION,
            format: MANIFEST_FORMAT,
            threadId,
            revision: threadRevision,
            index: chunkIndex,
            records,
          },
          MAX_CHUNK_PLAINTEXT_BYTES,
        ),
      );
    } finally {
      key.fill(0);
    }
    return {
      index: chunkIndex,
      revision: threadRevision,
      recordKey,
      recordCount: records.length,
      plaintextBytes: measured.plaintextBytes,
      contentHash: measured.contentHash,
    };
  };

  const writeThread = async (master, threadId, recordsValue, previousDescriptor, appendOnly) => {
    if (!Array.isArray(recordsValue) || recordsValue.length > MAX_RECORDS_PER_THREAD) fail('thread_records');
    const records = clone(recordsValue, 'thread_records');
    const previousIndex = previousDescriptor?.format === MANIFEST_FORMAT
      ? await readThreadIndex(master, threadId, previousDescriptor)
      : null;
    const nextRevision = (previousDescriptor?.revision ?? 0) + 1;
    const chunks = [];
    let nextChunkIndex = 0;
    let sourceOffset = 0;

    if (appendOnly && previousIndex !== null) {
      if (records.length < previousIndex.recordCount) fail('append_only_rollback');
      const previousPartial = previousIndex.recordCount % RECORDS_PER_CHUNK;
      const reusableChunks = previousPartial === 0
        ? previousIndex.chunks.length
        : Math.max(0, previousIndex.chunks.length - 1);
      chunks.push(...previousIndex.chunks.slice(0, reusableChunks));
      nextChunkIndex = reusableChunks;
      sourceOffset = reusableChunks * RECORDS_PER_CHUNK;
      if (previousPartial !== 0) {
        const previousLast = previousIndex.chunks.at(-1);
        const previousRecords = await readChunk(master, threadId, previousLast);
        if (JSON.stringify(previousRecords) !== JSON.stringify(records.slice(sourceOffset, previousIndex.recordCount))) {
          fail('append_only_prefix');
        }
      }
      if (records.length === previousIndex.recordCount) {
        return { descriptor: previousDescriptor, index: previousIndex, changed: false };
      }
    }

    for (let offset = sourceOffset; offset < records.length; offset += RECORDS_PER_CHUNK) {
      const chunkRecords = records.slice(offset, offset + RECORDS_PER_CHUNK);
      const measured = encodedHashAndSize(chunkRecords);
      const previousChunk = appendOnly ? null : previousIndex?.chunks[nextChunkIndex];
      if (
        previousChunk != null
        && previousChunk.recordCount === chunkRecords.length
        && previousChunk.contentHash === measured.contentHash
        && previousChunk.plaintextBytes === measured.plaintextBytes
      ) {
        chunks.push(previousChunk);
      } else {
        chunks.push(await writeChunk(master, threadId, nextRevision, nextChunkIndex, chunkRecords));
      }
      nextChunkIndex += 1;
    }

    if (chunks.length > MAX_CHUNKS_PER_THREAD) fail('thread_chunks');
    const recordCount = chunks.reduce((total, chunk) => total + chunk.recordCount, 0);
    const plaintextBytes = chunks.reduce((total, chunk) => total + chunk.plaintextBytes, 0);
    if (recordCount !== records.length || plaintextBytes > MAX_THREAD_PLAINTEXT_BYTES) fail('thread_totals');
    const sameAsPrevious = previousIndex !== null
      && recordCount === previousIndex.recordCount
      && plaintextBytes === previousIndex.plaintextBytes
      && JSON.stringify(chunks) === JSON.stringify(previousIndex.chunks);
    if (sameAsPrevious) return { descriptor: previousDescriptor, index: previousIndex, changed: false };

    const indexKey = threadIndexStorageKey(master, threadId, nextRevision);
    const index = {
      v: STORE_VERSION,
      format: MANIFEST_FORMAT,
      threadId,
      revision: nextRevision,
      recordCount,
      plaintextBytes,
      chunks,
    };
    const key = derive(master, `thread-index-encryption-key:${threadId}`);
    try {
      await databaseSet(
        indexKey,
        encryptValue(key, threadIndexAad(threadId, nextRevision), index, MAX_INDEX_PLAINTEXT_BYTES),
      );
    } finally {
      key.fill(0);
    }
    return {
      descriptor: {
        format: MANIFEST_FORMAT,
        revision: nextRevision,
        indexKey,
        recordCount,
        plaintextBytes,
      },
      index,
      changed: true,
    };
  };

  const descriptorStorageKeys = async (master, threadId, descriptor) => {
    if (descriptor.format === 1) return new Set([descriptor.recordKey]);
    const index = await readThreadIndex(master, threadId, descriptor);
    return new Set([descriptor.indexKey, ...index.chunks.map((chunk) => chunk.recordKey)]);
  };

  const saveAllThreads = (threadsValue, changesValue = undefined) => runExclusive(async () => {
    const source = object(threadsValue, 'threads');
    const sourceEntries = Object.entries(source).sort(([left], [right]) => left.localeCompare(right));
    if (sourceEntries.length > MAX_THREADS) fail('threads');
    const sourceThreadIds = sourceEntries.map(([threadIdValue]) => id(threadIdValue, 'thread_id'));
    const changes = normalizeChanges(changesValue, sourceThreadIds);
    const master = await getMasterKey();
    try {
      const previous = await readManifest(master);
      const sourceSet = new Set(sourceThreadIds);
      if (previous.format !== MANIFEST_FORMAT) {
        for (const threadId of sourceThreadIds) changes.changedThreadIds.add(threadId);
        changes.appendOnlyThreadIds.clear();
      }
      for (const threadId of sourceThreadIds) {
        if (previous.threads[threadId] === undefined) changes.changedThreadIds.add(threadId);
      }
      const removedThreadIds = Object.keys(previous.threads).filter((threadId) => !sourceSet.has(threadId));
      const nextDescriptors = {};
      const nextIndexes = new Map();
      const staleKeys = new Set();
      let changed = previous.format !== MANIFEST_FORMAT || removedThreadIds.length > 0;

      for (const [threadId, records] of sourceEntries) {
        const previousDescriptor = previous.threads[threadId];
        if (!changes.changedThreadIds.has(threadId) && previousDescriptor?.format === MANIFEST_FORMAT) {
          nextDescriptors[threadId] = previousDescriptor;
          continue;
        }
        if (previousDescriptor !== undefined) {
          for (const key of await descriptorStorageKeys(master, threadId, previousDescriptor)) staleKeys.add(key);
        }
        const written = await writeThread(
          master,
          threadId,
          records,
          previousDescriptor,
          changes.appendOnlyThreadIds.has(threadId),
        );
        nextDescriptors[threadId] = written.descriptor;
        if (written.index !== null) nextIndexes.set(threadId, written.index);
        if (written.changed) changed = true;
      }

      for (const threadId of removedThreadIds) {
        for (const key of await descriptorStorageKeys(master, threadId, previous.threads[threadId])) staleKeys.add(key);
      }

      if (!changed) return { changed: false, revision: previous.revision };
      const serializedThreads = {};
      for (const [threadId, descriptor] of Object.entries(nextDescriptors)) {
        serializedThreads[threadId] = {
          revision: descriptor.revision,
          indexKey: descriptor.indexKey,
          recordCount: descriptor.recordCount,
          plaintextBytes: descriptor.plaintextBytes,
        };
        const index = nextIndexes.get(threadId);
        if (index !== undefined) {
          staleKeys.delete(descriptor.indexKey);
          for (const chunk of index.chunks) staleKeys.delete(chunk.recordKey);
        }
      }
      const next = {
        v: STORE_VERSION,
        format: MANIFEST_FORMAT,
        revision: previous.revision + 1,
        threads: serializedThreads,
      };
      const manifestKey = derive(master, 'manifest-encryption-key');
      try {
        await databaseSet(
          manifestStorageKey(master),
          encryptValue(manifestKey, manifestAad, next, MAX_MANIFEST_PLAINTEXT_BYTES),
        );
      } finally {
        manifestKey.fill(0);
      }
      for (const staleKey of staleKeys) await databaseRemove(staleKey);
      return { changed: true, revision: next.revision };
    } finally {
      master.fill(0);
    }
  });

  const clear = () => runExclusive(async () => {
    const keys = await databaseKeys();
    for (const key of keys) {
      if (key.startsWith(`${prefix}/`)) await databaseRemove(key);
    }
    masterKey?.fill(0);
    masterKey = null;
  });

  return Object.freeze({
    loadAllThreads,
    saveAllThreads,
    clear,
    destroyMemory() {
      masterKey?.fill(0);
      masterKey = null;
    },
  });
}
