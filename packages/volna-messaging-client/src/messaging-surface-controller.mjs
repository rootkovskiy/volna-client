import { io } from 'socket.io-client';
import contract from './index.js';

const { normalizeContentEvent } = contract;
const ID_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;
const USERNAME_PATTERN = /^[a-z0-9_.-]{2,32}$/;
const THREAD_MODES = new Set(['LEGACY_PLAINTEXT', 'MLS_V1']);
const SECURE_HISTORY_PLACEHOLDER = 'Зашифрованная история недоступна на этом устройстве';

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
    subtitle: optionalString(source.subtitle ?? source.typeLabel, 500, 'entity_subtitle'),
    isVerified: source.isVerified === true,
  };
}

function normalizeLegacyAttachment(message) {
  if (message.locationLatitude !== null && message.locationLatitude !== undefined && message.locationLongitude !== null && message.locationLongitude !== undefined) {
    const latitude = Number(message.locationLatitude);
    const longitude = Number(message.locationLongitude);
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      return {
        kind: 'location',
        latitude,
        longitude,
        ...(Number.isFinite(Number(message.locationAccuracy)) ? { accuracy: Number(message.locationAccuracy) } : {}),
      };
    }
  }
  if (message.event) {
    return {
      kind: 'entity',
      entityType: 'event',
      id: identifier(message.eventId ?? message.event.id, 'event_id'),
      snapshot: entitySnapshot(message.event, 'event'),
    };
  }
  if (message.entity) {
    const source = record(message.entity, 'legacy_entity');
    const entityType = source.entityType === 'account' ? 'account' : 'publicPage';
    return {
      kind: 'entity',
      entityType,
      id: identifier(source.id ?? (entityType === 'account' ? message.attachedAccountId : message.attachedPublicPageId), 'entity_id'),
      snapshot: entitySnapshot(source, entityType),
    };
  }
  if (message.audioRelease) {
    const release = record(message.audioRelease, 'audio_release');
    const metadata = record(release.metadata ?? {}, 'audio_release_metadata');
    const releaseId = optionalString(release.id, 1000, 'audio_release_id') || optionalString(release.releaseUrl, 1000, 'audio_release_url');
    if (releaseId) {
      return {
        kind: 'music',
        provider: ['soundcloud', 'bandcamp', 'youtube', 'volna'].includes(release.provider) ? release.provider : 'volna',
        id: releaseId,
        title: optionalString(metadata.title, 500, 'audio_release_title') || 'Аудио-релиз',
        artist: optionalString(metadata.artist, 500, 'audio_release_artist') || 'VOLNA',
        metadata: {
          artworkUrl: httpUrl(metadata.artworkUrl),
          externalUrl: httpUrl(release.releaseUrl),
          previewUrl: httpUrl(metadata.previewUrl),
          collectionTitle: optionalString(metadata.title, 500, 'audio_release_collection'),
        },
      };
    }
  }
  if (message.trackId || message.trackTitle) {
    const provider = ['apple', 'yandex', 'youtube', 'volna', 'soundcloud', 'bandcamp'].includes(message.trackProvider)
      ? message.trackProvider
      : 'volna';
    return {
      kind: 'music',
      provider,
      id: optionalString(message.trackId, 1000, 'track_id') || `legacy_${identifier(message.id, 'message_id')}`,
      title: optionalString(message.trackTitle, 500, 'track_title') || 'Музыка',
      artist: optionalString(message.trackArtist, 500, 'track_artist') || 'VOLNA',
      metadata: {
        album: optionalString(message.trackAlbum, 500, 'track_album'),
        artworkUrl: httpUrl(message.trackArtworkUrl),
        previewUrl: httpUrl(message.trackPreviewUrl),
        externalUrl: httpUrl(message.trackExternalUrl),
      },
    };
  }
  return undefined;
}

export function normalizeLegacyMessage(value) {
  const message = record(value, 'legacy_message');
  const text = optionalString(message.text, 1000, 'legacy_message_text');
  return {
    id: identifier(message.id, 'message_id'),
    threadId: identifier(message.threadId, 'message_thread_id'),
    senderAccountId: identifier(message.senderId, 'message_sender_id'),
    text: text?.length ? text : undefined,
    attachment: normalizeLegacyAttachment(message),
    createdAt: date(message.createdAt, 'message_created_at'),
    editedAt: nullableDate(message.editedAt, 'message_edited_at') ?? undefined,
    deletedAt: undefined,
    reactions: Array.isArray(message.reactions) ? message.reactions.map(normalizeReaction) : [],
    securityMode: 'legacy',
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
  if (message.securityMode !== 'legacy' && message.securityMode !== 'e2ee') return normalizeLegacyMessage(message);
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
    lastMessageText: optionalString(thread.lastMessageText, 1000, 'thread_preview'),
    lastMessageAt: nullableDate(thread.lastMessageAt, 'thread_last_message_at'),
    unreadCount: Number.isInteger(thread.unreadCount) && thread.unreadCount >= 0 ? thread.unreadCount : 0,
    lastReadAt: nullableDate(thread.lastReadAt, 'thread_last_read_at'),
    encryptionMode: thread.encryptionMode,
    protocolVersion: thread.protocolVersion === null || thread.protocolVersion === undefined ? null : Number(thread.protocolVersion),
    mlsEpoch: typeof thread.mlsEpoch === 'string' ? thread.mlsEpoch : null,
    encryptedSince: nullableDate(thread.encryptedSince, 'thread_encrypted_since'),
    legacyHistoryOnly: thread.legacyHistoryOnly === true,
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

function legacyPayload(draft) {
  const event = normalizeContentEvent({
    v: 1,
    kind: 'message.create',
    logicalMessageId: randomClientId('message'),
    clientCreatedAt: new Date().toISOString(),
    ...(draft.text === undefined ? {} : { text: draft.text }),
    ...(draft.attachment === undefined ? {} : { attachment: draft.attachment }),
  });
  const payload = { clientMessageId: randomClientId('legacy') };
  if (event.text !== undefined) payload.text = event.text;
  const attachment = event.attachment;
  if (!attachment) return payload;
  if (attachment.kind === 'location') {
    payload.locationLatitude = attachment.latitude;
    payload.locationLongitude = attachment.longitude;
    if (attachment.accuracy !== undefined) payload.locationAccuracy = attachment.accuracy;
    return payload;
  }
  if (attachment.kind === 'entity') {
    if (attachment.entityType === 'account') payload.attachedAccountId = attachment.id;
    else if (attachment.entityType === 'publicPage') payload.attachedPublicPageId = attachment.id;
    else payload.eventId = attachment.id;
    return payload;
  }
  const metadata = record(attachment.metadata ?? {}, 'music_metadata');
  const externalUrl = httpUrl(metadata.sourceTrackUrl) ?? httpUrl(metadata.externalUrl);
  if (attachment.provider === 'soundcloud') payload.soundcloudMusicUrl = externalUrl;
  else if (attachment.provider === 'bandcamp') payload.bandcampMusicUrl = externalUrl;
  else if (attachment.provider === 'volna') payload.uploadedTrackId = attachment.id.replace(/^uploaded:/, '');
  else {
    payload.trackProvider = attachment.provider;
    payload.trackId = attachment.id.replace(/^(apple|yandex|youtube):/, '');
  }
  return payload;
}

export function createMessagingSurfaceController(options) {
  if (!options || typeof options.apiOrigin !== 'string' || typeof options.fetch !== 'function') fail('controller_options');
  if (typeof options.getSecureMessagingClient !== 'function' || typeof options.loadMessagingCapabilities !== 'function') fail('controller_secure_runtime');
  const origin = options.apiOrigin.replace(/\/$/, '');
  const knownSecureThreads = new Set();

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

  const resolveOwnAccountId = async () => {
    const response = await request('/auth/me');
    if (!response.ok) fail('account_lookup_failed', new Error(await readError(response, 'Не удалось определить текущий аккаунт')));
    const payload = record(await response.json(), 'account_response');
    return identifier(record(payload.account, 'account').id, 'account_id');
  };

  const assertNoDowngrade = async (accountId, thread) => {
    if (thread.encryptionMode === 'MLS_V1') {
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

  const searchLocalMessages = async (accountId, queryValue, { limit = 100 } = {}) => {
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
    const activated = normalizeThread(await response.json());
    if (activated.id !== originalThread.id || activated.encryptionMode !== 'MLS_V1' || activated.protocolVersion !== 1) fail('activation_downgrade');
    knownSecureThreads.add(activated.id);
    activated.messages = await secureMessages(accountId, activated.id, { sync: true });
    activated.lastMessageText = messagePreview(activated.messages.at(-1));
    return activated;
  };

  const prepareOpenedThread = async (accountId, thread, { allowActivation = true } = {}) => {
    await assertNoDowngrade(accountId, thread);
    if (thread.encryptionMode === 'MLS_V1') {
      if (thread.protocolVersion !== 1) fail('unsupported_protocol');
      thread.messages = await secureMessages(accountId, thread.id, { sync: true });
      thread.lastMessageText = messagePreview(thread.messages.at(-1));
      return thread;
    }
    if (!allowActivation || thread.messages.length > 0) return thread;
    const capabilities = await options.loadMessagingCapabilities();
    if (!capabilities.rolloutEnabled) return thread;
    return refreshThreadAfterActivation(accountId, thread.partner.username, thread);
  };

  const listThreads = async (accountId, { cursor, pageSize = 30 } = {}) => {
    identifier(accountId, 'account_id');
    const query = new URLSearchParams({ pageSize: String(Math.min(50, Math.max(1, pageSize))) });
    if (cursor) query.set('cursor', String(cursor));
    const response = await request(`/chats?${query.toString()}`);
    if (!response.ok) fail('thread_list_failed', new Error(await readError(response, 'Не удалось открыть сообщения')));
    const page = record(await response.json(), 'thread_page');
    if (!Array.isArray(page.items)) fail('thread_page_items');
    const items = [];
    for (const item of page.items) {
      const thread = normalizeThread(item);
      await assertNoDowngrade(accountId, thread);
      if (thread.encryptionMode === 'MLS_V1') {
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
    return { items, nextCursor: typeof page.nextCursor === 'string' ? page.nextCursor : null };
  };

  const openThread = async (accountId, partnerUsername, optionsValue = {}) => {
    const normalizedUsername = username(partnerUsername);
    const response = await request(`/chats/with/${encodeURIComponent(normalizedUsername)}`, { method: 'POST' });
    if (!response.ok) fail('thread_open_failed', new Error(await readError(response, 'Не удалось открыть чат')));
    return prepareOpenedThread(accountId, normalizeThread(await response.json()), optionsValue);
  };

  const sendMessage = async (accountId, threadValue, draft) => {
    const thread = normalizeThread(threadValue);
    await assertNoDowngrade(accountId, thread);
    if (thread.encryptionMode === 'MLS_V1') {
      const handle = await secureHandle(accountId);
      if (handle.client.getLocalSecurityStatus().status !== 'ready') fail('security_setup_required');
      const event = handle.client.createMessageEvent(draft);
      await handle.client.sendEvent(thread.id, event);
      return secureMessages(accountId, thread.id);
    }
    const response = await request(`/chats/${encodeURIComponent(thread.id)}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(legacyPayload(draft)),
    });
    if (!response.ok) fail('message_send_failed', new Error(await readError(response, 'Не удалось отправить сообщение')));
    return [...thread.messages, normalizeLegacyMessage(await response.json())];
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
    const response = await request(`/chats/${encodeURIComponent(thread.id)}/messages/${encodeURIComponent(identifier(messageId, 'message_id'))}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!response.ok) fail('message_edit_failed', new Error(await readError(response, 'Не удалось изменить сообщение')));
    const updated = normalizeLegacyMessage(await response.json());
    return thread.messages.map((message) => message.id === updated.id ? updated : message);
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
    const response = await request(`/chats/${encodeURIComponent(thread.id)}/messages/${encodeURIComponent(identifier(messageId, 'message_id'))}/reaction`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emoji: normalizedEmoji }),
    });
    if (!response.ok) fail('message_reaction_failed', new Error(await readError(response, 'Не удалось поставить реакцию')));
    const change = record(await response.json(), 'reaction_change');
    return thread.messages.map((message) => message.id !== change.messageId ? message : {
      ...message,
      reactions: [
        ...message.reactions.filter((reaction) => reaction.accountId !== change.accountId),
        ...(typeof change.emoji === 'string' && change.emoji ? [{ accountId: change.accountId, emoji: change.emoji }] : []),
      ],
    });
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
    return Array.isArray(payload.profileTracks) ? payload.profileTracks : [];
  };

  const searchMusic = async (queryValue) => {
    const query = typeof queryValue === 'string' ? queryValue.trim() : '';
    if (query.length < 2) return [];
    const results = await Promise.all(['apple', 'yandex'].map(async (provider) => {
      const response = await request(`/music/${provider}/search?q=${encodeURIComponent(query)}`);
      if (!response.ok) return [];
      const payload = await response.json();
      return Array.isArray(payload) ? payload : [];
    }));
    return results.flat();
  };

  const resolveMusic = async (urlValue) => {
    const url = httpUrl(typeof urlValue === 'string' ? urlValue.trim() : '');
    if (!url) fail('music_url');
    const response = await request(`/music/resolve?url=${encodeURIComponent(url)}`);
    if (!response.ok) fail('music_resolve_failed', new Error(await readError(response, 'Не удалось распознать ссылку')));
    return record(await response.json(), 'resolved_music');
  };

  const subscribeRealtime = async ({ accountId, thread, onEncryptedEnvelope, onLegacyMessage, onLegacyReaction, onThreadUpdated, onActivity }) => {
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
    const join = () => {
      if (normalizedThread?.encryptionMode === 'LEGACY_PLAINTEXT') socket.emit('join_thread', { threadId: normalizedThread.id });
    };
    const encrypted = (signal) => {
      const value = record(signal, 'encrypted_signal');
      const threadId = identifier(value.threadId, 'encrypted_signal_thread_id');
      onActivity?.();
      onEncryptedEnvelope?.(threadId);
    };
    const legacyMessage = (value) => {
      const message = normalizeLegacyMessage(value);
      onActivity?.();
      onLegacyMessage?.(message);
    };
    const legacyReaction = (value) => {
      const change = record(value, 'reaction_change');
      onLegacyReaction?.({
        threadId: identifier(change.threadId, 'reaction_thread_id'),
        messageId: identifier(change.messageId, 'reaction_message_id'),
        accountId: identifier(change.accountId, 'reaction_account_id'),
        emoji: typeof change.emoji === 'string' ? change.emoji : null,
      });
    };
    join();
    socket.on('connect', join);
    socket.on('thread_updated', () => { onActivity?.(); onThreadUpdated?.(); });
    socket.on('encrypted_envelope_available', encrypted);
    socket.on('message_created', legacyMessage);
    socket.on('message_updated', legacyMessage);
    socket.on('message_reaction_updated', legacyReaction);
    return () => {
      if (normalizedThread?.encryptionMode === 'LEGACY_PLAINTEXT') socket.emit('leave_thread', { threadId: normalizedThread.id });
      socket.off('connect', join);
      socket.off('thread_updated');
      socket.off('encrypted_envelope_available', encrypted);
      socket.off('message_created', legacyMessage);
      socket.off('message_updated', legacyMessage);
      socket.off('message_reaction_updated', legacyReaction);
      socket.disconnect();
    };
  };

  return Object.freeze({
    editMessage,
    listThreads,
    loadOwnMusic,
    openThread,
    reactToMessage,
    resolveOwnAccountId,
    resolveMusic,
    searchAttachments,
    searchMusic,
    searchLocalMessages,
    searchProfiles,
    sendMessage,
    subscribeRealtime,
  });
}

export function messagingSurfaceErrorMessage(error) {
  const code = error?.code;
  const causeMessage = error?.cause instanceof Error ? error.cause.message : null;
  if (causeMessage) return causeMessage;
  if (code === 'thread_downgrade' || code === 'activation_downgrade') return 'Защита чата изменилась. Отправка заблокирована до проверки устройств';
  if (code === 'security_setup_required') return 'Сначала настройте защищённые сообщения на этом устройстве';
  if (code === 'secure_state_missing') return 'На устройстве нет подтверждённого ключевого состояния этого чата';
  if (code === 'unsupported_protocol') return 'Для этого чата требуется обновление приложения';
  return 'Не удалось выполнить действие с сообщениями';
}
