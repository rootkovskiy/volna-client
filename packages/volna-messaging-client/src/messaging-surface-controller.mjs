import { sha256 } from '@noble/hashes/sha2.js';
import { io } from 'socket.io-client';
import contract from './index.js';
import musicAvailability from './music-availability.js';
import communityLabels from './community-labels.js';
import { normalizeChatVisibility, visibleChatMessages } from './chat-visibility.mjs';
import { matrixStoreErrorMessage } from './matrix-store-errors.mjs';

const { normalizeContentEvent } = contract;
const ID_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;
const USERNAME_PATTERN = /^[a-z0-9_.-]{2,32}$/;
const THREAD_MODES = new Set(['E2EE_PENDING', 'MLS_V1', 'MATRIX_V1']);
const SECURE_HISTORY_PLACEHOLDER = 'Зашифрованная история недоступна на этом устройстве';
const MUSIC_ARTWORK_CACHE_TAG = 'VOLNA-MUSIC-ARTWORK-V1';
const THREAD_LIST_SNAPSHOT_TTL_MS = 60_000;
const THREAD_LIST_SNAPSHOT_MAX_BYTES = 256 * 1024;

// Host notification badges need only an invalidation, never protocol payloads.
// Keep the event name and argument boundary in the public messaging controller.
export function subscribeEncryptedActivity(socket, onActivity) {
  let active = true;
  const invalidate = () => { if (active) onActivity(); };
  socket.on('encrypted_envelope_available', invalidate);
  return () => {
    active = false;
    socket.off('encrypted_envelope_available', invalidate);
  };
}

export class MessagingSurfaceError extends Error {
  constructor(code, cause) {
    super(`VOLNA messaging surface error (${code})`);
    this.name = 'MessagingSurfaceError';
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

function fail(code, cause) {
  throw new MessagingSurfaceError(code, cause);
}

function record(value, code = 'record') {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(code);
  return value;
}

function identifier(value, code = 'identifier') {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) fail(code);
  return value;
}

function username(value) {
  const normalized = typeof value === 'string' ? value.replace(/^@/, '').trim().toLowerCase() : '';
  if (!USERNAME_PATTERN.test(normalized)) fail('username');
  return normalized;
}

function optionalString(value, maxLength, code) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || value.length > maxLength) fail(code);
  return value;
}

function date(value, code) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) fail(code);
  return value;
}

function nullableDate(value, code) {
  if (value === null || value === undefined) return null;
  return date(value, code);
}

function normalizePartner(value) {
  const partner = record(value, 'partner');
  return {
    id: identifier(partner.id, 'partner_id'),
    username: username(partner.username),
    name: optionalString(partner.name, 160, 'partner_name') || username(partner.username),
    avatarUrl: optionalString(partner.avatarUrl, 4096, 'partner_avatar_url'),
    isVerified: partner.isVerified === true,
  };
}

function normalizeReaction(value) {
  const reaction = record(value, 'reaction');
  const emoji = optionalString(reaction.emoji, 32, 'reaction_emoji');
  if (!emoji) fail('reaction_emoji');
  return { accountId: identifier(reaction.accountId, 'reaction_account_id'), emoji };
}

function httpUrl(value) {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value)) return null;
  return value.length <= 4096 ? value : null;
}

function plainRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function apiResourceUrl(origin, value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const normalized = value.trim();
  if (/^https?:\/\//i.test(normalized)) return httpUrl(normalized);
  if (!normalized.startsWith('/')) return null;
  return httpUrl(`${origin}${normalized}`);
}

function stableMusicArtworkUrl(origin, value) {
  const source = apiResourceUrl(origin, value);
  if (!source) return null;
  try {
    const url = new URL(source);
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (host === 'media.volna.social') return url.toString();
    const reviewedProvider = host === 'bcbits.com' || host.endsWith('.bcbits.com')
      || host === 'mzstatic.com' || host.endsWith('.mzstatic.com')
      || host === 'sndcdn.com' || host.endsWith('.sndcdn.com')
      || host === 'yandex.net' || host.endsWith('.yandex.net')
      || host === 'ytimg.com' || host.endsWith('.ytimg.com')
      || host === 'ggpht.com' || host.endsWith('.ggpht.com');
    if (!reviewedProvider) return source;
    url.hash = '';
    const digest = [...sha256(new TextEncoder().encode(`${MUSIC_ARTWORK_CACHE_TAG}\0${url.toString()}`))]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    return `https://media.volna.social/music/external-artwork/${digest}-300.webp`;
  } catch {
    return null;
  }
}

function bandcampTrackId(value) {
  if (typeof value !== 'string') return null;
  return value.match(/(?:\/mp3-128\/|[?/]track=)(\d{1,20})(?:[/?&#]|$)/)?.[1]
    ?? (/^\d{1,20}$/.test(value) ? value : null);
}

function stableMusicPreviewUrl(origin, provider, id, previewUrl, externalUrl, sourceTrackUrl, collectionId) {
  if (provider === 'bandcamp') {
    const trackId = bandcampTrackId(previewUrl) ?? bandcampTrackId(id);
    const releaseUrl = httpUrl(collectionId) ?? httpUrl(sourceTrackUrl) ?? httpUrl(externalUrl);
    if (trackId && releaseUrl) {
      return apiResourceUrl(origin, `/music/bandcamp/stream?url=${encodeURIComponent(releaseUrl)}&trackId=${encodeURIComponent(trackId)}`);
    }
    return /bandcamp\.com\/EmbeddedPlayer/i.test(previewUrl ?? '') ? null : apiResourceUrl(origin, previewUrl);
  }
  if (provider === 'soundcloud') {
    const trackUrl = httpUrl(sourceTrackUrl) ?? httpUrl(externalUrl) ?? httpUrl(previewUrl);
    if (trackUrl) {
      try {
        if (new URL(trackUrl).pathname.split('/').filter(Boolean).includes('sets')) return null;
      } catch {
        return null;
      }
    }
    return trackUrl
      ? apiResourceUrl(origin, `/music/soundcloud/stream?url=${encodeURIComponent(trackUrl)}`)
      : null;
  }
  if (provider === 'youtube') return null;
  if (provider === 'yandex' && !apiResourceUrl(origin, previewUrl) && /^\d{1,20}$/.test(id)) {
    return apiResourceUrl(origin, `/music/yandex/preview/${encodeURIComponent(id)}`);
  }
  if (provider === 'volna' && !apiResourceUrl(origin, previewUrl)) {
    const uploadedTrackId = id.replace(/^uploaded:/, '');
    return ID_PATTERN.test(uploadedTrackId)
      ? apiResourceUrl(origin, `/my-music/stream/${encodeURIComponent(uploadedTrackId)}`)
      : null;
  }
  return apiResourceUrl(origin, previewUrl);
}

function normalizeMusicCandidate(value, origin) {
  const envelope = plainRecord(value);
  if (!envelope) return null;
  const nestedTrack = envelope.kind === 'track' ? plainRecord(envelope.track) : null;
  const source = nestedTrack ?? envelope;
  const metadata = plainRecord(source.metadata) ?? {};
  const providerValue = source.provider ?? source.kind ?? envelope.provider ?? envelope.kind;
  const provider = ['apple', 'yandex', 'youtube', 'volna', 'soundcloud', 'bandcamp'].includes(providerValue)
    ? providerValue
    : 'volna';
  const id = String(source.id ?? source.trackId ?? source.url ?? '').trim();
  if (!id) return null;
  const title = String(source.title ?? 'Музыка').trim() || 'Музыка';
  const artist = String(source.artist ?? 'VOLNA').trim() || 'VOLNA';
  const previewUrl = typeof (source.previewUrl ?? metadata.previewUrl) === 'string'
    ? String(source.previewUrl ?? metadata.previewUrl).trim()
    : null;
  const externalUrl = httpUrl(source.externalUrl ?? source.url ?? metadata.externalUrl);
  const sourceTrackUrl = httpUrl(source.sourceTrackUrl ?? metadata.sourceTrackUrl);
  const collectionId = httpUrl(source.collectionId ?? metadata.collectionId);
  return {
    ...source,
    provider,
    id,
    title,
    artist,
    // Keep the catalog's real artwork URL until sendMessage. Existing VOLNA CDN
    // artwork is reused as-is; reviewed provider artwork is mirrored once there
    // before it enters the encrypted message body.
    artworkUrl: apiResourceUrl(origin, source.artworkUrl ?? metadata.artworkUrl),
    previewUrl: stableMusicPreviewUrl(origin, provider, id, previewUrl, externalUrl, sourceTrackUrl, collectionId),
    externalUrl,
    sourceTrackUrl,
    collectionId,
  };
}

function expandOwnMusicCandidate(value, origin) {
  const source = plainRecord(value);
  if (!source) return [];
  const releaseMetadata = plainRecord(source.releaseMetadata);
  const releaseTracks = Array.isArray(releaseMetadata?.tracks)
    ? releaseMetadata.tracks.filter((track) => plainRecord(track))
    : [];
  if (source.provider !== 'bandcamp' || !releaseTracks.length) {
    const normalized = normalizeMusicCandidate(source, origin);
    return normalized ? [normalized] : [];
  }
  const selectedTrackId = bandcampTrackId(source.previewUrl) ?? bandcampTrackId(source.id);
  const selectedTracks = selectedTrackId
    ? releaseTracks.filter((track) => plainRecord(track)?.id === selectedTrackId)
    : releaseTracks;
  const collectionId = httpUrl(releaseMetadata?.externalUrl) ?? httpUrl(source.externalUrl);
  return (selectedTracks.length ? selectedTracks : releaseTracks).flatMap((trackValue) => {
    const track = plainRecord(trackValue);
    if (!track) return [];
    const normalized = normalizeMusicCandidate({
      ...source,
      ...track,
      provider: 'bandcamp',
      artworkUrl: track.artworkUrl ?? source.artworkUrl ?? releaseMetadata?.artworkUrl,
      externalUrl: track.externalUrl ?? source.externalUrl,
      collectionId,
    }, origin);
    return normalized ? [normalized] : [];
  });
}

function normalizeMusicAttachmentForTransport(attachment, origin) {
  if (!plainRecord(attachment) || attachment.kind !== 'music') return attachment;
  const metadata = plainRecord(attachment.metadata) ?? {};
  const normalized = normalizeMusicCandidate({ ...attachment, ...metadata, metadata }, origin);
  if (!normalized) return attachment;
  return {
    ...attachment,
    metadata: {
      ...metadata,
      artworkUrl: normalized.artworkUrl,
      previewUrl: normalized.previewUrl,
      externalUrl: normalized.externalUrl,
      sourceTrackUrl: normalized.sourceTrackUrl,
      collectionId: normalized.collectionId,
    },
  };
}

function entitySnapshot(value, entityType) {
  const source = record(value, 'entity_snapshot');
  if (entityType === 'event') {
    return {
      title: optionalString(source.title, 500, 'event_title') || 'Событие',
      posterUrl: httpUrl(source.posterUrl),
      startsAt: nullableDate(source.startsAt, 'event_starts_at'),
      typeLabel: optionalString(source.typeLabel, 160, 'event_type_label'),
      cityName: optionalString(source.cityName, 160, 'event_city_name'),
      venueName: optionalString(source.venueName, 240, 'event_venue_name'),
      venueUsername: optionalString(source.venueUsername, 64, 'event_venue_username'),
      goingCount: Number.isInteger(source.goingCount) && source.goingCount >= 0 ? source.goingCount : 0,
      watchingCount: Number.isInteger(source.watchingCount) && source.watchingCount >= 0 ? source.watchingCount : 0,
      organizerName: optionalString(source.organizerName ?? source.organizerPage?.name, 160, 'event_organizer_name'),
      organizerUsername: optionalString(source.organizerUsername ?? source.organizerPage?.username, 64, 'event_organizer_username'),
    };
  }
  return {
    name: optionalString(source.name, 160, 'entity_name') || 'Профиль',
    username: optionalString(source.username, 64, 'entity_username'),
    avatarUrl: httpUrl(source.avatarUrl),
    cityName: optionalString(source.cityName, 160, 'entity_city_name'),
    subtitle: optionalString(Object.hasOwn(communityLabels.publicPageTypeLabels, source.subtitle ?? source.typeLabel)
      ? communityLabels.publicPageTypeLabels[source.subtitle ?? source.typeLabel] : source.subtitle ?? source.typeLabel, 500, 'entity_subtitle'),
    isVerified: source.isVerified === true,
  };
}

function normalizeProjectedMessage(value, threadId) {
  const message = record(value, 'projected_message');
  const deletedAt = nullableDate(message.deletedAt, 'projected_deleted_at') ?? undefined;
  const event = deletedAt ? null : normalizeContentEvent({
    v: 1,
    kind: 'message.create',
    logicalMessageId: message.id,
    clientCreatedAt: message.clientCreatedAt,
    ...(message.text === undefined ? {} : { text: message.text }),
    ...(message.attachment === undefined ? {} : { attachment: message.attachment }),
  });
  return {
    id: identifier(message.id, 'projected_message_id'),
    threadId,
    senderAccountId: identifier(message.senderAccountId, 'projected_sender_id'),
    text: event?.text,
    attachment: event?.attachment,
    createdAt: date(message.createdAt, 'projected_created_at'),
    editedAt: nullableDate(message.editedAt, 'projected_edited_at') ?? undefined,
    deletedAt,
    reactions: Array.isArray(message.reactions) ? message.reactions.map(normalizeReaction) : [],
    securityMode: 'e2ee',
  };
}

function normalizeUnifiedMessage(value, threadId) {
  const message = record(value, 'message');
  if (message.securityMode !== 'e2ee') fail('unencrypted_message_rejected');
  const deletedAt = nullableDate(message.deletedAt, 'message_deleted_at') ?? undefined;
  const event = deletedAt ? null : normalizeContentEvent({
    v: 1,
    kind: 'message.create',
    logicalMessageId: message.id,
    clientCreatedAt: message.createdAt,
    ...(message.text === undefined ? {} : { text: message.text }),
    ...(message.attachment === undefined ? {} : { attachment: message.attachment }),
  });
  return {
    id: identifier(message.id, 'message_id'),
    threadId: identifier(message.threadId ?? threadId, 'message_thread_id'),
    senderAccountId: identifier(message.senderAccountId, 'message_sender_id'),
    text: event?.text,
    attachment: event?.attachment,
    createdAt: date(message.createdAt, 'message_created_at'),
    editedAt: nullableDate(message.editedAt, 'message_edited_at') ?? undefined,
    deletedAt,
    reactions: Array.isArray(message.reactions) ? message.reactions.map(normalizeReaction) : [],
    securityMode: message.securityMode,
  };
}

export function messagePreview(message) {
  if (!message) return 'Чат создан';
  if (message.deletedAt) return 'Сообщение удалено';
  if (message.text?.trim()) return message.text.trim().replace(/\s+/g, ' ');
  if (message.attachment?.kind === 'location') return '📍 Геопозиция';
  if (message.attachment?.kind === 'music') return `🎵 ${message.attachment.artist} — ${message.attachment.title}`;
  if (message.attachment?.kind === 'entity') {
    if (message.attachment.entityType === 'event') return `📅 ${message.attachment.snapshot?.title ?? 'Событие'}`;
    return `◉ ${message.attachment.snapshot?.name ?? 'Профиль'}`;
  }
  return 'Сообщение';
}

function normalizeThread(value) {
  const thread = record(value, 'thread');
  if (!THREAD_MODES.has(thread.encryptionMode)) fail('thread_encryption_mode');
  const rawMessages = Array.isArray(thread.messages) ? thread.messages : [];
  const threadId = identifier(thread.id, 'thread_id');
  const messages = rawMessages.map((message) => normalizeUnifiedMessage(message, threadId));
  return {
    id: threadId,
    partner: normalizePartner(thread.partner),
    lastMessageText: optionalString(typeof thread.lastMessageText === 'string' ? thread.lastMessageText.slice(0, 1000) : thread.lastMessageText, 1000, 'thread_preview'),
    lastMessageAt: nullableDate(thread.lastMessageAt, 'thread_last_message_at'),
    ...(thread.lastMessageId === undefined ? {} : { lastMessageId: thread.lastMessageId === null ? null : identifier(thread.lastMessageId, 'last_message_id') }),
    unreadCount: Number.isInteger(thread.unreadCount) && thread.unreadCount >= 0 ? thread.unreadCount : 0,
    lastReadAt: nullableDate(thread.lastReadAt, 'thread_last_read_at'),
    encryptionMode: thread.encryptionMode,
    protocolVersion: thread.protocolVersion === null || thread.protocolVersion === undefined ? null : Number(thread.protocolVersion),
    mlsEpoch: typeof thread.mlsEpoch === 'string' ? thread.mlsEpoch : null,
    encryptedSince: nullableDate(thread.encryptedSince, 'thread_encrypted_since'),
    ...(thread.visibility === undefined ? {} : { visibility: normalizeChatVisibility(thread.visibility) }),
    messages,
  };
}

function randomClientId(prefix) {
  const random = globalThis.crypto?.randomUUID?.().replaceAll('-', '') ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${random}`.slice(0, 80);
}

async function readError(response, fallback) {
  try {
    const payload = await response.clone().json();
    const message = Array.isArray(payload?.message) ? payload.message[0] : payload?.message;
    if (typeof message === 'string' && message.trim()) return message.trim();
  } catch {
    // The public transport never places response bodies in logs.
  }
  return fallback;
}

export function createMessagingSurfaceController(options) {
  if (!options || typeof options.apiOrigin !== 'string' || typeof options.fetch !== 'function') fail('controller_options');
  if (typeof options.getSecureMessagingClient !== 'function' || typeof options.loadMessagingCapabilities !== 'function') fail('controller_secure_runtime');
  const origin = options.apiOrigin.replace(/\/$/, '');
  const knownSecureThreads = new Set();
  // A render snapshot belongs to one live account session, never HTTP/storage.
  // Retain only the first 30 rows and no timelines or attachment payloads.
  let threadListSession = null;
  const getThreadListSnapshot = (accountId) => {
    identifier(accountId, 'account_id');
    if (threadListSession?.accountId !== accountId) return null;
    const snapshot = threadListSession.snapshot;
    if (!snapshot || Date.now() - snapshot.savedAt >= THREAD_LIST_SNAPSHOT_TTL_MS) {
      threadListSession.snapshot = null;
      return null;
    }
    return JSON.parse(snapshot.json);
  };
  const clearThreadListSnapshot = (accountId) => {
    if (threadListSession?.accountId === accountId) {
      threadListSession.snapshot = null;
      threadListSession = null;
    }
  };

  const request = async (path, init = {}) => {
    const accessToken = typeof options.getAccessToken === 'function' ? await options.getAccessToken() : undefined;
    const headers = new Headers(init.headers);
    if (accessToken !== undefined) {
      if (typeof accessToken !== 'string' || !accessToken) fail('access_token');
      headers.set('Authorization', `Bearer ${accessToken}`);
    }
    const response = await options.fetch(`${origin}${path}`, {
      ...init,
      headers,
      cache: 'no-store',
      ...(options.includeCredentials === true ? { credentials: 'include' } : {}),
    });
    return response;
  };

  const secureHandle = async (accountId) => options.getSecureMessagingClient(identifier(accountId, 'account_id'));

  const visibilityRevisions = new Map();
  const checkNotificationVisibility = async (threadId, messageIds) => {
    identifier(threadId, 'thread_id');
    if (!Array.isArray(messageIds) || messageIds.length > 500) fail('message_visibility_failed');
    messageIds.forEach(id => identifier(id, 'message_id'));
    const response = await request(`/chats/${encodeURIComponent(threadId)}/deletions/check`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messageIds }),
    });
    if (!response.ok) fail('message_visibility_failed', new Error('Не удалось проверить удалённые сообщения. Повторите обновление.'));
    const state = normalizeChatVisibility(await response.json());
    if (!state) fail('message_visibility_failed');
    return state;
  };
  const filterThreadVisibility = async (thread, force = false, summaryOnly = false) => {
    const revision = visibilityRevisions.get(thread.id) ?? 0;
    let messages = visibleChatMessages(thread.messages, thread.visibility);
    let state = thread.visibility;
    if (state?.hasDeletions || force || revision > 0) {
      const chunks = messages.length ? Array.from({ length: Math.ceil(messages.length / 500) }, (_, index) => messages.slice(index * 500, index * 500 + 500)) : [[]];
      const kept = [];
      for (const chunk of chunks) {
        const next = await checkNotificationVisibility(thread.id, chunk.map(message => message.id));
        if (!state?.clearedBefore || (next.clearedBefore && Date.parse(next.clearedBefore) > Date.parse(state.clearedBefore))) state = next;
        kept.push(...visibleChatMessages(chunk, next));
      }
      messages = visibleChatMessages(kept, state);
    }
    if ((visibilityRevisions.get(thread.id) ?? 0) !== revision) return filterThreadVisibility(thread, true);
    const changed = state?.hasDeletions || messages.length !== thread.messages.length;
    const last = messages.at(-1);
    return { ...thread, messages, ...(state ? { visibility: state } : {}), ...(changed ? {
      lastMessageText: last ? messagePreview(last) : null,
      lastMessageAt: last?.createdAt ?? null,
      unreadCount: messages.filter(message => message.senderAccountId === thread.partner.id
        && Date.parse(message.createdAt) > (thread.lastReadAt ? Date.parse(thread.lastReadAt) : 0)).length,
    } : {}) };
  };

  const deleteContent = async (accountId, threadValue, { scope, messageId, operationId }) => {
    const thread = normalizeThread(threadValue);
    identifier(accountId, 'account_id');
    if (!['self', 'everyone'].includes(scope)) fail('deletion_scope');
    const response = await request(`/chats/${encodeURIComponent(thread.id)}/deletions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        scope, operationId: identifier(operationId, 'operation_id'),
        ...(messageId === undefined ? {} : { messageId: identifier(messageId, 'message_id') }),
      }),
    });
    if (!response.ok) fail('message_delete_failed', new Error(response.status >= 500
      ? 'Не удалось удалить. Попробуйте ещё раз.' : await readError(response, 'Не удалось удалить. Попробуйте ещё раз.')));
    visibilityRevisions.set(thread.id, (visibilityRevisions.get(thread.id) ?? 0) + 1);
    clearThreadListSnapshot(accountId);
    return filterThreadVisibility({ ...thread,
      hasUndecryptableEvents: messageId !== undefined && threadValue.hasUndecryptableEvents === true }, true);
  };

  const resolveOwnAccountId = async () => {
    const response = await request('/auth/me');
    if (!response.ok) fail('account_lookup_failed', new Error(await readError(response, 'Не удалось определить текущий аккаунт')));
    const payload = record(await response.json(), 'account_response');
    return identifier(record(payload.account, 'account').id, 'account_id');
  };

  const assertNoDowngrade = async (accountId, thread) => {
    if (thread.encryptionMode === 'MLS_V1' || thread.encryptionMode === 'MATRIX_V1') {
      if (thread.protocolVersion !== 1) fail('unsupported_protocol');
      knownSecureThreads.add(thread.id);
      return;
    }
    if (knownSecureThreads.has(thread.id)) fail('thread_downgrade');
    const handle = await secureHandle(accountId);
    if (handle.client.getLocalSecurityStatus().status !== 'ready') return;
    const local = handle.client.getThreadSecurityStatus(thread.id);
    if (local.status === 'secure') fail('thread_downgrade');
  };

  const secureMessages = async (accountId, threadId, { sync = false } = {}) => {
    const handle = await secureHandle(accountId);
    if (handle.client.getLocalSecurityStatus().status !== 'ready') fail('security_setup_required');
    if (sync) {
      await handle.client.joinPendingWelcomes();
      const local = handle.client.getThreadSecurityStatus(threadId);
      if (local.status !== 'secure') fail('secure_state_missing');
      await handle.client.syncThread(threadId);
    }
    return handle.client.getMessages(threadId).map((message) => normalizeProjectedMessage(message, threadId));
  };

  const searchMlsMessages = async (accountId, queryValue, { limit = 100 } = {}) => {
    identifier(accountId, 'account_id');
    if (typeof queryValue !== 'string') fail('message_search_query');
    const query = queryValue.trim();
    if (query.normalize('NFKC').length < 2) return [];
    const handle = await secureHandle(accountId);
    if (handle.client.getLocalSecurityStatus().status !== 'ready') return [];
    return handle.client.searchMessages(query, { limit }).map((result) => {
      const value = record(result, 'message_search_result');
      const threadId = identifier(value.threadId, 'message_search_thread_id');
      return { threadId, message: normalizeProjectedMessage(value.message, threadId) };
    });
  };

  const refreshThreadAfterActivation = async (accountId, partnerUsername, originalThread) => {
    const handle = await secureHandle(accountId);
    if (handle.client.getLocalSecurityStatus().status !== 'ready') fail('security_setup_required');
    await handle.client.activateThread(originalThread.id);
    const response = await request(`/chats/with/${encodeURIComponent(partnerUsername)}`, { method: 'POST' });
    if (!response.ok) fail('thread_refresh_failed', new Error(await readError(response, 'Не удалось подтвердить защищённый чат')));
    const activated = normalizeThread({ ...await response.json(), messages: [], lastMessageText: null });
    if (activated.id !== originalThread.id || activated.encryptionMode !== 'MLS_V1' || activated.protocolVersion !== 1) fail('activation_downgrade');
    knownSecureThreads.add(activated.id);
    activated.messages = await secureMessages(accountId, activated.id, { sync: true });
    activated.lastMessageText = messagePreview(activated.messages.at(-1));
    return activated;
  };

  const prepareOpenedThread = async (accountId, thread, { allowActivation = true, loadEarlier = false } = {}) => {
    if (thread.encryptionMode === 'MLS_V1') {
      await assertNoDowngrade(accountId, thread);
      if (thread.protocolVersion !== 1) fail('unsupported_protocol');
      thread.messages = await secureMessages(accountId, thread.id, { sync: true });
      thread.lastMessageText = messagePreview(thread.messages.at(-1));
      return thread;
    }
    if (options.matrixMessaging) {
      const capabilities = await options.matrixMessaging.capabilities();
      if (capabilities.enabled) {
        const matrixThread = allowActivation
          ? await options.matrixMessaging.openThread(accountId, thread, { loadEarlier })
          : await options.matrixMessaging.decorateThread(accountId, thread);
        if (matrixThread.encryptionMode === 'MATRIX_V1') {
          await assertNoDowngrade(accountId, matrixThread);
          knownSecureThreads.add(matrixThread.id);
          return {
            ...normalizeThread(matrixThread),
            // Only the endpoint engine may supply this hint, never API metadata.
            hasUndecryptableEvents: matrixThread.hasUndecryptableEvents === true,
            hasMoreHistory: matrixThread.hasMoreHistory === true,
          };
        }
        if (allowActivation) fail('matrix_activation_failed');
      }
    }
    await assertNoDowngrade(accountId, thread);
    if (!allowActivation) fail('encrypted_messaging_unavailable');
    const capabilities = await options.loadMessagingCapabilities();
    if (!capabilities.rolloutEnabled) fail('encrypted_messaging_unavailable');
    return refreshThreadAfterActivation(accountId, thread.partner.username, thread);
  };

  const listThreads = async (accountId, { cursor, pageSize = 30, onInitialPage, signal } = {}) => {
    identifier(accountId, 'account_id');
    if (threadListSession?.accountId !== accountId) {
      if (threadListSession) threadListSession.snapshot = null;
      threadListSession = { accountId, snapshot: null, revision: 0 };
    }
    const session = threadListSession;
    const revision = !cursor ? ++session.revision : session.revision;
    const assertActive = () => {
      if (signal?.aborted || threadListSession !== session) fail('thread_list_cancelled');
    };
    assertActive();
    const boundedPageSize = Math.min(50, Math.max(1, Number.isInteger(pageSize) ? pageSize : 30));
    const query = new URLSearchParams({ pageSize: String(boundedPageSize) });
    if (cursor) query.set('cursor', String(cursor));
    const response = await request(`/chats?${query.toString()}`, { signal });
    assertActive();
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        clearThreadListSnapshot(accountId);
        fail('thread_list_access_revoked', new Error(await readError(response, 'Нет доступа к сообщениям')));
      }
      fail('thread_list_failed', new Error(await readError(response, 'Не удалось открыть сообщения')));
    }
    const page = record(await response.json(), 'thread_page');
    assertActive();
    if (!Array.isArray(page.items) || page.items.length > boundedPageSize) fail('thread_page_items');
    const rawItems = page.items.map(item => normalizeThread({ ...item, messages: [], lastMessageText: null }));
    const nextCursor = typeof page.nextCursor === 'string' ? page.nextCursor : null;
    const previous = new Map((getThreadListSnapshot(accountId)?.items ?? []).map((item) => [item.id, item]));
    // Identity rows can paint before crypto starts. Do not expose an unverified
    // server preview or claim a verified security state in this provisional page.
    onInitialPage?.({
      items: rawItems.flatMap((thread) => {
        const saved = previous.get(thread.id);
        const samePreview = Boolean(saved && saved.lastMessageAt === thread.lastMessageAt
          && saved.lastMessageId === thread.lastMessageId
          && saved.partner.id === thread.partner.id && saved.encryptionMode === thread.encryptionMode
          && saved.protocolVersion === thread.protocolVersion);
        const reusable = samePreview && saved.encryptionMode !== 'E2EE_PENDING'
          && !thread.visibility?.hasDeletions && !thread.visibility?.clearedBefore
          && !thread.visibility?.deletedMessageIds.length;
        if ((thread.visibility?.clearedBefore || visibilityRevisions.has(thread.id)) && !reusable) return [];
        return [{ ...thread, messages: [], lastMessageText: reusable ? saved.lastMessageText : null, previewAvailable: reusable, previewPending: true }];
      }),
      nextCursor,
    });
    assertActive();
    const items = [];
    for (const thread of rawItems) {
      if (thread.encryptionMode === 'MLS_V1') {
        await assertNoDowngrade(accountId, thread);
        try {
          thread.messages = await secureMessages(accountId, thread.id);
          thread.lastMessageText = messagePreview(thread.messages.at(-1));
        } catch (error) {
          if (error?.code === 'security_setup_required' || error?.code === 'secure_state_missing') {
            thread.messages = [];
            thread.lastMessageText = SECURE_HISTORY_PLACEHOLDER;
          } else {
            throw error;
          }
        }
      }
      items.push(thread);
    }
    const decoratedItems = options.matrixMessaging && items.length
      ? await options.matrixMessaging.decorateThreads(accountId, items)
      : items;
    assertActive();
    for (const thread of decoratedItems) {
      await assertNoDowngrade(accountId, thread);
      if (thread.encryptionMode === 'MATRIX_V1') knownSecureThreads.add(thread.id);
    }
    assertActive();
    const result = {
      items: (await Promise.all(decoratedItems.map(thread => filterThreadVisibility({ ...normalizeThread(thread), hasUndecryptableEvents: thread.hasUndecryptableEvents === true }, false, true))))
        .filter(thread => !thread.visibility?.clearedBefore || thread.messages.length > 0 || thread.hasUndecryptableEvents
),
      nextCursor,
    };
    if (!cursor && pageSize === 30 && session.revision === revision) {
      const json = JSON.stringify({ ...result, items: result.items.slice(0, 30).map((thread) => ({ ...thread, messages: [] })) });
      session.snapshot = json.length * 2 <= THREAD_LIST_SNAPSHOT_MAX_BYTES ? { json, savedAt: Date.now() } : null;
    }
    return result;
  };

  const openThread = async (accountId, partnerUsername, optionsValue = {}) => {
    const normalizedUsername = username(partnerUsername);
    const response = await request(`/chats/with/${encodeURIComponent(normalizedUsername)}${optionsValue.markRead === false ? '?read=false' : ''}`, { method: 'POST' });
    if (!response.ok) fail('thread_open_failed', new Error(await readError(response, 'Не удалось открыть чат')));
    return filterThreadVisibility(await prepareOpenedThread(accountId, normalizeThread({ ...await response.json(), messages: [], lastMessageText: null }), optionsValue));
  };

  const sendMessage = async (accountId, threadValue, draft) => {
    const thread = normalizeThread(threadValue);
    await assertNoDowngrade(accountId, thread);
    if (thread.encryptionMode === 'E2EE_PENDING') fail('encrypted_messaging_unavailable');
    let preparedAttachment = draft?.attachment;
    if (preparedAttachment?.kind === 'music') {
      const sourceArtworkUrl = plainRecord(preparedAttachment.metadata)?.artworkUrl;
      const stableArtworkUrl = stableMusicArtworkUrl(origin, sourceArtworkUrl);
      if (typeof sourceArtworkUrl === 'string' && stableArtworkUrl && stableArtworkUrl !== sourceArtworkUrl) {
        try {
          const artworkResponse = await request('/music/artwork/cache', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: sourceArtworkUrl }),
          });
          if (artworkResponse.ok) {
            const artwork = plainRecord(await artworkResponse.json());
            if (typeof artwork?.artworkUrl === 'string') {
              preparedAttachment = {
                ...preparedAttachment,
                metadata: { ...preparedAttachment.metadata, artworkUrl: artwork.artworkUrl },
              };
            }
          }
        } catch {
          // Artwork is decorative. A cache outage must never block an encrypted send.
        }
      }
    }
    const transportDraft = preparedAttachment?.kind === 'music'
      ? { ...draft, attachment: normalizeMusicAttachmentForTransport(preparedAttachment, origin) }
      : draft;
    if (thread.encryptionMode === 'MLS_V1') {
      const handle = await secureHandle(accountId);
      if (handle.client.getLocalSecurityStatus().status !== 'ready') fail('security_setup_required');
      const event = handle.client.createMessageEvent(transportDraft);
      await handle.client.sendEvent(thread.id, event);
      return secureMessages(accountId, thread.id);
    }
    if (thread.encryptionMode === 'MATRIX_V1') {
      if (!options.matrixMessaging) fail('matrix_runtime_missing');
      return options.matrixMessaging.sendMessage(accountId, thread, transportDraft);
    }
    fail('encrypted_messaging_unavailable');
  };

  const editMessage = async (accountId, threadValue, messageId, text) => {
    const thread = normalizeThread(threadValue);
    await assertNoDowngrade(accountId, thread);
    if (thread.encryptionMode === 'MLS_V1') {
      const handle = await secureHandle(accountId);
      const event = handle.client.createMutationEvent('message.edit', identifier(messageId, 'message_id'), text);
      await handle.client.sendEvent(thread.id, event);
      return secureMessages(accountId, thread.id);
    }
    if (thread.encryptionMode === 'MATRIX_V1') {
      if (!options.matrixMessaging) fail('matrix_runtime_missing');
      return options.matrixMessaging.editMessage(accountId, thread, identifier(messageId, 'message_id'), text);
    }
    fail('encrypted_messaging_unavailable');
  };

  const reactToMessage = async (accountId, threadValue, messageId, emoji, currentMineEmoji = null) => {
    const thread = normalizeThread(threadValue);
    await assertNoDowngrade(accountId, thread);
    const normalizedEmoji = typeof emoji === 'string' && emoji.length <= 32 && emoji.trim() ? emoji : fail('reaction_emoji');
    const nextEmoji = currentMineEmoji === normalizedEmoji ? null : normalizedEmoji;
    if (thread.encryptionMode === 'MLS_V1') {
      const handle = await secureHandle(accountId);
      const event = handle.client.createMutationEvent('message.reaction', identifier(messageId, 'message_id'), nextEmoji);
      await handle.client.sendEvent(thread.id, event);
      return secureMessages(accountId, thread.id);
    }
    if (thread.encryptionMode === 'MATRIX_V1') {
      if (!options.matrixMessaging) fail('matrix_runtime_missing');
      return options.matrixMessaging.reactToMessage(accountId, thread, identifier(messageId, 'message_id'), nextEmoji);
    }
    fail('encrypted_messaging_unavailable');
  };

  const searchProfiles = async (queryValue, { shareRecipients = false } = {}) => {
    const normalized = typeof queryValue === 'string' ? queryValue.trim().replace(/^@/, '') : '';
    const path = shareRecipients
      ? `/chats/share-recipients/list${normalized.length >= 3 ? `?q=${encodeURIComponent(normalized)}` : ''}`
      : `/profiles?pageSize=30&q=${encodeURIComponent(normalized)}`;
    const response = await request(path);
    if (!response.ok) fail('profile_search_failed', new Error(await readError(response, 'Не удалось загрузить людей')));
    const payload = await response.json();
    const items = Array.isArray(payload) ? payload : record(payload, 'profile_page').items;
    if (!Array.isArray(items)) fail('profile_search_items');
    return items.map((item) => normalizePartner(item));
  };

  const searchAttachments = async (queryValue) => {
    const normalized = typeof queryValue === 'string' ? queryValue.trim().replace(/^@/, '') : '';
    if (normalized.length < 3) return { accounts: [], communities: [], events: [] };
    const response = await request(`/search?q=${encodeURIComponent(normalized)}`);
    if (!response.ok) fail('attachment_search_failed', new Error(await readError(response, 'Не удалось выполнить поиск')));
    const payload = record(await response.json(), 'attachment_search');
    return {
      accounts: Array.isArray(payload.accounts) ? payload.accounts : [],
      communities: Array.isArray(payload.communities) ? payload.communities : [],
      events: Array.isArray(payload.events) ? payload.events : [],
    };
  };

  const loadOwnMusic = async () => {
    const response = await request('/my-music');
    if (!response.ok) fail('music_load_failed', new Error(await readError(response, 'Не удалось загрузить вашу музыку')));
    const payload = record(await response.json(), 'music_library');
    const uploadedTracks = Array.isArray(payload.tracks) ? payload.tracks.flatMap((value) => {
      const track = plainRecord(value);
      if (!track || track.status !== 'READY' || typeof track.id !== 'string' || !httpUrl(track.publicUrl)) return [];
      const normalized = normalizeMusicCandidate({
        id: `uploaded:${track.id}`,
        provider: 'volna',
        title: track.title,
        artist: track.artist ?? 'VOLNA',
        artworkUrl: track.artworkUrl,
        previewUrl: `/my-music/stream/${encodeURIComponent(track.id)}`,
        externalUrl: track.publicUrl,
        durationSeconds: track.durationSeconds,
      }, origin);
      return normalized ? [normalized] : [];
    }) : [];
    const profileTracks = Array.isArray(payload.profileTracks)
      ? payload.profileTracks.flatMap((value) => expandOwnMusicCandidate(value, origin))
      : [];
    return [...uploadedTracks, ...profileTracks];
  };

  const searchMusic = async (queryValue) => {
    const query = typeof queryValue === 'string' ? queryValue.trim() : '';
    if (query.length < 2) return [];
    const results = await Promise.allSettled(['apple', 'yandex'].map(async (provider) => {
      const response = await request(`/music/${provider}/search?q=${encodeURIComponent(query)}`);
      if (!response.ok) return [];
      const payload = await response.json();
      return Array.isArray(payload?.tracks) ? payload.tracks : Array.isArray(payload) ? payload : [];
    }));
    return results.flatMap((result) => result.status === 'fulfilled' ? result.value : []).flatMap((value) => {
      const normalized = normalizeMusicCandidate(value, origin);
      return normalized ? [normalized] : [];
    });
  };

  const resolveMusic = async (urlValue) => {
    const url = httpUrl(typeof urlValue === 'string' ? urlValue.trim() : '');
    if (!url) fail('music_url');
    const response = await request(`/music/resolve?url=${encodeURIComponent(url)}`);
    if (!response.ok) fail('music_resolve_failed', new Error(await readError(response, 'Не удалось распознать ссылку')));
    const resolved = record(await response.json(), 'resolved_music');
    if (resolved.kind === 'track' && plainRecord(resolved.track)) {
      return { ...resolved, track: normalizeMusicCandidate(resolved.track, origin) ?? resolved.track };
    }
    return normalizeMusicCandidate(resolved, origin) ?? resolved;
  };

  const resolveMusicPlayback = (attachment) => {
    const normalized = normalizeMusicAttachmentForTransport(attachment, origin);
    const metadata = plainRecord(normalized?.metadata) ?? {};
    return {
      previewUrl: httpUrl(metadata.previewUrl),
      externalUrl: httpUrl(metadata.sourceTrackUrl) ?? httpUrl(metadata.externalUrl),
    };
  };

  const resolveMusicArtwork = (attachment) => {
    const metadata = plainRecord(attachment?.metadata) ?? {};
    return stableMusicArtworkUrl(origin, metadata.artworkUrl);
  };

  // Explicit playback only. Merely rendering decrypted messages must not cause a provider lookup.
  const checkMusicAvailabilityForPlayback = async (attachment) => {
    const resolved = resolveMusicPlayback(attachment);
    const identity = musicAvailability.musicAvailabilityIdentity({ provider: attachment.provider, externalUrl: resolved.externalUrl });
    if (!identity) return null;
    const cached = musicAvailability.getMusicAvailability(identity.key);
    if (cached && cached.expiresAt > Date.now()) return cached;
    try {
      const response = await request('/music/availability', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tracks: [{ provider: identity.provider, externalUrl: identity.externalUrl }] }) });
      if (!response.ok) return null;
      const value = (await response.json()).items?.[0];
      musicAvailability.setMusicAvailability(identity.key, value);
      return musicAvailability.getMusicAvailability(identity.key);
    } catch { return null; }
  };

  const searchLocalMessages = async (accountId, queryValue, { limit = 100 } = {}) => {
    const boundedLimit = Math.min(500, Math.max(1, limit));
    const [mlsResults, matrixResults] = await Promise.all([
      searchMlsMessages(accountId, queryValue, { limit: boundedLimit }),
      options.matrixMessaging
        ? options.matrixMessaging.searchLocalMessages(accountId, queryValue, { limit: boundedLimit })
        : [],
    ]);
    const seen = new Set();
    const candidates = [...matrixResults, ...mlsResults].filter((result) => {
      const key = `${result.threadId}\0${result.message.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, boundedLimit);
    const visible = new Set();
    for (const threadId of new Set(candidates.map(result => result.threadId))) {
      const filtered = await filterThreadVisibility({ id: threadId, partner: { id: '' }, lastReadAt: null,
        messages: candidates.filter(result => result.threadId === threadId).map(result => result.message) }, true);
      for (const message of filtered.messages) visible.add(`${threadId}\0${message.id}`);
    }
    return candidates.filter(result => visible.has(`${result.threadId}\0${result.message.id}`));
  };

  const loadChatActivity = async (accountId, threadIds, signal) => {
    identifier(accountId, 'account_id');
    threadIds.forEach(id => identifier(id, 'thread_id'));
    const response = await request('/chats/activity', { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ threadIds }) });
    if (!response.ok) fail('chat_activity_unavailable');
    const rows = await response.json();
    if (!Array.isArray(rows)) fail('chat_activity_invalid');
    const result = {};
    for (const row of rows) {
      if (!threadIds.includes(row?.threadId)) continue;
      const until = row.presence?.onlineUntil;
      result[row.threadId] = {
        presence: row.presence ? { lastSeenAt: typeof row.presence.lastSeenAt === 'string' ? row.presence.lastSeenAt : null,
          onlineUntil: Number.isFinite(until) && Number.isFinite(row.serverNow) ? Date.now() + Math.max(0, Math.min(75_000, until - row.serverNow)) : null } : null,
        partnerLastReadAt: typeof row.partnerLastReadAt === 'string' ? row.partnerLastReadAt : null,
      };
    }
    return result;
  };

  const subscribeRealtime = async ({ accountId, thread, onEncryptedEnvelope, onThreadUpdated, onReconnect, onActivity, onChatStateUpdated }) => {
    identifier(accountId, 'account_id');
    const accessToken = typeof options.getAccessToken === 'function' ? await options.getAccessToken() : undefined;
    const socket = io(`${origin}/chat`, {
      transports: ['websocket'],
      auth: accessToken ? { token: accessToken } : {},
      withCredentials: options.includeCredentials === true,
      reconnection: true,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 10_000,
    });
    const normalizedThread = thread ? normalizeThread(thread) : null;
    let disposed = false;
    const join = () => {
      if (disposed) return;
      onChatStateUpdated?.();
      if (normalizedThread) socket.emit('join_thread', { threadId: normalizedThread.id });
      // Events may have been missed while offline; always fetch fresh state.
      onActivity?.();
      if (normalizedThread) onReconnect?.(); else onThreadUpdated?.();
    };
    const encrypted = (signal) => {
      const value = record(signal, 'encrypted_signal');
      const threadId = identifier(value.threadId, 'encrypted_signal_thread_id');
      onActivity?.();
      onEncryptedEnvelope?.(threadId);
    };
    socket.on('connect', join);
    // Transport connect can precede async session authentication on the server.
    // Rejoin once authenticated so a rejected early join cannot lose messages.
    socket.on('session_ready', join);
    socket.on('chat_state_updated', () => { if (!disposed) onChatStateUpdated?.(); });
    socket.on('notifications_resync', () => { if (!disposed) onChatStateUpdated?.(); });
    socket.on('thread_updated', () => { onActivity?.(); onThreadUpdated?.(); });
    socket.on('chat_visibility_updated', value => {
      const threadId = identifier(value?.threadId, 'visibility_thread_id');
      visibilityRevisions.set(threadId, (visibilityRevisions.get(threadId) ?? 0) + 1);
      clearThreadListSnapshot(accountId);
      onActivity?.(); onEncryptedEnvelope?.(threadId); onThreadUpdated?.();
    });
    socket.on('encrypted_envelope_available', encrypted);
    let releaseMatrixSubscription = () => undefined;
    if (options.matrixMessaging) {
      // The socket must be disposable even while Matrix is starting or fails.
      void options.matrixMessaging.subscribe(accountId, (threadId) => {
          if (disposed) return;
          onActivity?.();
          onEncryptedEnvelope?.(threadId);
          onThreadUpdated?.();
        }).then((release) => {
          if (disposed) release();
          else releaseMatrixSubscription = release;
        }).catch(() => undefined);
    }
    return () => {
      disposed = true;
      releaseMatrixSubscription();
      if (normalizedThread) socket.emit('leave_thread', { threadId: normalizedThread.id });
      socket.off('connect', join);
      socket.off('session_ready', join);
      socket.off('chat_state_updated');
      socket.off('notifications_resync');
      socket.off('thread_updated');
      socket.off('chat_visibility_updated');
      socket.off('encrypted_envelope_available', encrypted);
      socket.disconnect();
    };
  };

  const getMatrixRoomSecurity = async (accountId, threadValue) => {
    const thread = normalizeThread(threadValue);
    if (thread.encryptionMode !== 'MATRIX_V1' || !options.matrixMessaging) fail('matrix_runtime_missing');
    return options.matrixMessaging.getRoomSecurity(identifier(accountId, 'account_id'), thread);
  };

  const verifyMatrixDevice = async (accountId, threadValue, userId, deviceId, expectedEd25519) => {
    const thread = normalizeThread(threadValue);
    if (thread.encryptionMode !== 'MATRIX_V1' || !options.matrixMessaging) fail('matrix_runtime_missing');
    return options.matrixMessaging.verifyDevice(
      identifier(accountId, 'account_id'),
      thread,
      userId,
      deviceId,
      expectedEd25519,
    );
  };

  const setupMatrixRecovery = async (accountId) => {
    if (!options.matrixMessaging) fail('matrix_runtime_missing');
    return options.matrixMessaging.setupRecovery(identifier(accountId, 'account_id'));
  };

  const recoverMatrixSecurity = async (accountId, recoveryKey) => {
    if (!options.matrixMessaging || typeof recoveryKey !== 'string') fail('matrix_runtime_missing');
    return options.matrixMessaging.recoverSecurity(identifier(accountId, 'account_id'), recoveryKey);
  };

  const resetMatrixRecovery = async (accountId) => {
    if (!options.matrixMessaging) fail('matrix_runtime_missing');
    try { return await options.matrixMessaging.resetRecovery(identifier(accountId, 'account_id')); }
    catch (error) { fail('matrix_recovery_reset_failed', error); }
  };

  const startMatrixDeviceVerification = async (accountId, threadValue, userId, deviceId) => {
    const thread = normalizeThread(threadValue);
    if (thread.encryptionMode !== 'MATRIX_V1' || !options.matrixMessaging) fail('matrix_runtime_missing');
    return options.matrixMessaging.startDeviceVerification(identifier(accountId, 'account_id'), thread, userId, deviceId);
  };

  const matrixVerificationAction = (method) => async (accountId, verificationId, payload) => {
    if (!options.matrixMessaging) fail('matrix_runtime_missing');
    return options.matrixMessaging[method](identifier(accountId, 'account_id'), verificationId, ...(payload === undefined ? [] : [payload]));
  };

  const acceptMatrixVerification = matrixVerificationAction('acceptVerification');
  const startMatrixSasVerification = matrixVerificationAction('startSasVerification');
  const generateMatrixQrVerification = matrixVerificationAction('generateQrVerification');
  const scanMatrixQrVerification = matrixVerificationAction('scanQrVerification');
  const confirmMatrixVerification = matrixVerificationAction('confirmVerification');
  const mismatchMatrixVerification = matrixVerificationAction('mismatchVerification');
  const cancelMatrixVerification = matrixVerificationAction('cancelVerification');

  return Object.freeze({
    deleteContent,
    editMessage: async (accountId, thread, ...args) => (await filterThreadVisibility({ ...thread, messages: await editMessage(accountId, thread, ...args) }, thread.visibility !== undefined)).messages,
    acceptMatrixVerification,
    cancelMatrixVerification,
    confirmMatrixVerification,
    generateMatrixQrVerification,
    getMatrixRoomSecurity,
    listThreads,
    getThreadListSnapshot,
    clearThreadListSnapshot,
    loadOwnMusic,
    openThread,
    recoverMatrixSecurity,
    reactToMessage: async (accountId, thread, ...args) => (await filterThreadVisibility({ ...thread, messages: await reactToMessage(accountId, thread, ...args) }, thread.visibility !== undefined)).messages,
    resolveOwnAccountId,
    resolveMusic,
    resolveMusicArtwork,
    resolveMusicPlayback,
    checkMusicAvailabilityForPlayback,
    checkNotificationVisibility,
    markMessageRead: async (accountId, threadValue, messageId) => {
      const thread = normalizeThread(threadValue);
      await assertNoDowngrade(accountId, thread);
      if (!['MLS_V1', 'MATRIX_V1'].includes(thread.encryptionMode)
        || !thread.messages.some(message => message.id === messageId && message.securityMode === 'e2ee' && message.senderAccountId !== accountId)) return;
      const response = await request(`/chats/${encodeURIComponent(thread.id)}/read`, { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messageId: identifier(messageId, 'message_id') }) });
      if (!response.ok) fail('message_read_failed');
    },
    searchAttachments,
    searchMusic,
    searchLocalMessages,
    searchProfiles,
    sendMessage: async (accountId, thread, draft) => (await filterThreadVisibility({ ...thread, messages: await sendMessage(accountId, thread, draft) }, thread.visibility !== undefined)).messages,
    scanMatrixQrVerification,
    setupMatrixRecovery,
    resetMatrixRecovery,
    startMatrixDeviceVerification,
    startMatrixSasVerification,
    subscribeRealtime,
    loadChatActivity,
    verifyMatrixDevice,
    mismatchMatrixVerification,
  });
}

export function messagingSurfaceErrorMessage(error) {
  const ownershipMessage = matrixStoreErrorMessage(error);
  if (ownershipMessage) return ownershipMessage;
  const code = error?.code;
  if (code === 'matrix_recipient_not_ready') return 'Собеседник ещё не настроил защищённые сообщения. Отправьте сообщение после его первого входа в чат.';
  const causeMessage = error?.cause instanceof Error ? error.cause.message : null;
  if (causeMessage) return causeMessage;
  if (code === 'thread_downgrade' || code === 'activation_downgrade') return 'Защита чата изменилась. Отправка заблокирована до проверки устройств';
  if (code === 'encrypted_messaging_unavailable') return 'Защищённые чаты пока недоступны. Попробуйте позже.';
  if (code === 'security_setup_required') return 'Сначала настройте защищённые сообщения на этом устройстве';
  if (code === 'secure_state_missing') return 'На устройстве нет подтверждённого ключевого состояния этого чата';
  if (code === 'unsupported_protocol') return 'Для этого чата требуется обновление приложения';
  if (code === 'matrix_activation_failed' || code === 'matrix_runtime_missing') return 'Защищённый Matrix-чат сейчас недоступен';
  return 'Не удалось выполнить действие с сообщениями';
}
