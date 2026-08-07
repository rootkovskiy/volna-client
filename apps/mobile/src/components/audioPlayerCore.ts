export type AudioProvider = 'apple' | 'yandex' | 'soundcloud' | 'bandcamp' | 'youtube' | 'volna';

export function uploadedTrackPlayerId(trackId: string) {
  return `uploaded:${trackId.trim()}`;
}

export function uploadedTrackIdFromPlayerId(playerId: string) {
  return playerId.startsWith('uploaded:') ? playerId.slice('uploaded:'.length) : null;
}

export function uploadedTrackPlaylistKey(trackId: string) {
  return `upload:${trackId.trim()}`;
}

type PlaybackQueueItem = {
  id: string;
  previewUrl?: string | null;
  collectionId?: string | null;
  releaseId?: string | null;
};

function playbackQueueCollectionKey(item: PlaybackQueueItem) {
  return item.collectionId?.trim() || item.releaseId?.trim() || item.id;
}

function playbackReleaseGroupKey(item: PlaybackQueueItem) {
  const releaseId = item.releaseId?.trim();
  if (releaseId) return `release:${releaseId}`;
  const collectionId = item.collectionId?.trim();
  return collectionId ? `collection:${collectionId}` : null;
}

export function releaseTrackPosition<T extends PlaybackQueueItem>(
  track: T & { queue?: T[] },
  currentQueueIndex: number,
) {
  const releaseGroupKey = playbackReleaseGroupKey(track);
  if (!releaseGroupKey) return null;
  if (!track.queue?.length) return { position: 1, total: 1 };

  const releaseQueueIndexes = track.queue.flatMap((item, index) => (
    playbackReleaseGroupKey(item) === releaseGroupKey ? [index] : []
  ));
  if (!releaseQueueIndexes.length) return { position: 1, total: 1 };

  const position = releaseQueueIndexes.indexOf(currentQueueIndex);
  return {
    position: position >= 0 ? position + 1 : 1,
    total: releaseQueueIndexes.length,
  };
}

export function boundedPlaybackQueue<T extends PlaybackQueueItem>(
  queue: T[],
  target: T,
  previousCollections = 1,
  nextCollections = 3,
) {
  const exactTargetIndex = queue.findIndex((item) => item.id === target.id && item.previewUrl === target.previewUrl);
  const targetIndex = exactTargetIndex >= 0 ? exactTargetIndex : queue.findIndex((item) => item.id === target.id);
  if (targetIndex < 0) return target.id ? [target] : [];

  const groups: Array<{ start: number; end: number }> = [];
  let groupStart = 0;
  for (let index = 1; index <= queue.length; index += 1) {
    if (index < queue.length && playbackQueueCollectionKey(queue[index]) === playbackQueueCollectionKey(queue[groupStart])) continue;
    groups.push({ start: groupStart, end: index });
    groupStart = index;
  }
  const groupIndex = groups.findIndex((group) => targetIndex >= group.start && targetIndex < group.end);
  if (groupIndex < 0) return [target];
  const firstGroup = Math.max(0, groupIndex - previousCollections);
  const lastGroup = Math.min(groups.length - 1, groupIndex + nextCollections);
  return queue.slice(groups[firstGroup].start, groups[lastGroup].end);
}

export function normalizeMusicTrackTitle(provider: AudioProvider | undefined, value: string) {
  const title = value.trim();
  if (provider !== 'youtube') return title;
  const trailingBracket = /\s*(?:\(([^()]*)\)|\[([^\[\]]*)\]|\{([^{}]*)\})\s*$/u.exec(title);
  if (!trailingBracket) return title;
  const contents = trailingBracket[1] ?? trailingBracket[2] ?? trailingBracket[3] ?? '';
  const removableMarker = /(?:^|[^A-Za-zА-Яа-яЁё0-9])(?:video|official|clip|клип)(?=$|[^A-Za-zА-Яа-яЁё0-9])/i;
  return removableMarker.test(contents) ? title.slice(0, trailingBracket.index).trimEnd() : title;
}

export function normalizeYouTubeTrackMetadata(value: string, fallbackArtist?: string | null) {
  const normalizedTitle = normalizeMusicTrackTitle('youtube', value);
  const artistAndTitle = /^(.+?)\s+(?:-|–|—)\s+(.+)$/u.exec(normalizedTitle);
  if (!artistAndTitle) return { artist: fallbackArtist?.trim() || 'Неизвестный', title: normalizedTitle };
  return { artist: artistAndTitle[1].trim(), title: artistAndTitle[2].trim() };
}

export function normalizedExternalTrackUrl(value: string) {
  try { const url = new URL(value.trim()); url.hash = ''; url.search = ''; return url.toString().replace(/\/$/, '').toLowerCase(); }
  catch { return value.trim().replace(/\/$/, '').toLowerCase(); }
}

export function normalizedSavableTrackUrl(provider: Exclude<AudioProvider, 'volna'>, value: string) {
  if (provider !== 'apple') return normalizedExternalTrackUrl(value);
  try { const url = new URL(value.trim()); const id = url.searchParams.get('i'); url.hash = ''; url.search = ''; if (id) url.searchParams.set('i', id); return url.toString().replace(/\/$/, '').toLowerCase(); }
  catch { return value.trim().replace(/\/$/, '').toLowerCase(); }
}

export function providerName(provider: AudioProvider | undefined) {
  return provider === 'bandcamp' ? 'Bandcamp' : provider === 'soundcloud' ? 'SoundCloud' : provider === 'youtube' ? 'YouTube' : provider === 'apple' ? 'Apple Music' : provider === 'yandex' ? 'Яндекс Музыка' : 'VOLNA';
}

export function providerLink(provider: AudioProvider | undefined, externalUrl?: string | null) {
  if (!externalUrl || provider === 'volna') return null;
  return { label: provider === 'apple' ? 'Слушать в Apple Music' : provider === 'yandex' ? 'Слушать в Яндекс Музыке' : provider === 'soundcloud' ? 'Слушать на SoundCloud' : provider === 'youtube' ? 'Открыть на YouTube' : 'Слушать на Bandcamp', url: externalUrl };
}

export type ShuffleQueueState = {
  history: string[];
  position: number;
  queueSignature: string;
  remaining: string[];
};

function uniqueQueueIds(ids: string[]) {
  return Array.from(new Set(ids.filter(Boolean)));
}

export function shuffleQueueIds(ids: string[], random: () => number = Math.random) {
  const shuffled = [...ids];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

export function createShuffleQueueState(ids: string[], currentId: string, random: () => number = Math.random): ShuffleQueueState {
  const queueIds = uniqueQueueIds(ids);
  return {
    history: [currentId],
    position: 0,
    queueSignature: queueIds.join('\n'),
    remaining: shuffleQueueIds(queueIds.filter((id) => id !== currentId), random),
  };
}

export function ensureShuffleQueueState(
  state: ShuffleQueueState | null,
  ids: string[],
  currentId: string,
  random: () => number = Math.random,
) {
  const queueIds = uniqueQueueIds(ids);
  const queueSignature = queueIds.join('\n');
  if (!state || state.queueSignature !== queueSignature || state.history[state.position] !== currentId) {
    return createShuffleQueueState(queueIds, currentId, random);
  }
  return state;
}

export function takeNextShuffledTrack(
  state: ShuffleQueueState,
  ids: string[],
  currentId: string,
  repeat: boolean,
  random: () => number = Math.random,
) {
  let nextState = ensureShuffleQueueState(state, ids, currentId, random);
  if (nextState.position < nextState.history.length - 1) {
    nextState = { ...nextState, position: nextState.position + 1 };
    return { id: nextState.history[nextState.position], state: nextState };
  }
  if (!nextState.remaining.length && repeat) {
    nextState = createShuffleQueueState(ids, currentId, random);
  }
  const [id, ...remaining] = nextState.remaining;
  if (!id) return { id: null, state: nextState };
  const history = nextState.history.slice(0, nextState.position + 1).concat(id);
  nextState = { ...nextState, history, position: history.length - 1, remaining };
  return { id, state: nextState };
}

export function takePreviousShuffledTrack(state: ShuffleQueueState, ids: string[], currentId: string) {
  let nextState = ensureShuffleQueueState(state, ids, currentId);
  if (nextState.position <= 0) return { id: null, state: nextState };
  nextState = { ...nextState, position: nextState.position - 1 };
  return { id: nextState.history[nextState.position], state: nextState };
}
