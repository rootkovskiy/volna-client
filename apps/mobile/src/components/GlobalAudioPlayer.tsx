import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import * as Clipboard from 'expo-clipboard';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Airplay, Check, ChevronDown, Disc3, ListMusic, ListPlus, ListTodo, Pause, Play, Plus, Repeat1, Repeat2, Share, Shuffle, SkipBack, SkipForward, UsersRound, X } from 'lucide-react-native';
import { createContext, createElement, memo, type ReactNode, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AccessibilityInfo, ActivityIndicator, Alert, Animated, AppState, Easing, InteractionManager, Modal, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, G, LinearGradient, Path, Rect, Stop, SvgUri } from 'react-native-svg';
import { apiFetch, apiUrl, readApiError } from '../api/client';
import { musicArtworkThumbnail, profilePreviewPlayers } from '../domain';
import { AppSheetModal } from './AppSheetModal';
import { AppAnimatedImage, AppImage as Image } from './AppImage';
import { emitMusicLibraryChanged } from './musicLibraryEvents';
import { subscribePlaybackVisibilityChanged } from './playbackActivityEvents';
import { ReleaseShareModal } from './ReleaseShareModal';
import { YouTubeAudioEngine } from './YouTubeAudioEngine';
import type { YouTubeAudioEngineHandle, YouTubeAudioSnapshot } from './YouTubeAudioEngine.types';
import type { MusicReleaseParticipant, ProfileMusicTrack } from '../types';
import { normalizeExternalHttpsUrl } from '../security/externalUrls.mjs';
import { openExternalHttpsUrl } from '../security/openExternalUrl';
import {
  createShuffleQueueState,
  ensureShuffleQueueState,
  normalizedExternalTrackUrl,
  normalizedSavableTrackUrl,
  normalizeMusicTrackTitle,
  normalizeYouTubeTrackMetadata,
  providerLink,
  providerName,
  releaseTrackPosition,
  type ShuffleQueueState,
  takeNextShuffledTrack,
  takePreviousShuffledTrack,
  uploadedTrackIdFromPlayerId,
  uploadedTrackPlaylistKey,
} from './audioPlayerCore';

export const MINI_PLAYER_ENTER_DURATION_MS = 190;
export const MINI_PLAYER_EXIT_DURATION_MS = 150;
export const MINI_PLAYER_ENTER_EASING = Easing.out(Easing.cubic);
export const MINI_PLAYER_EXIT_EASING = Easing.in(Easing.cubic);

export type GlobalTrackQueueItem = {
  id: string;
  title: string;
  artist: string | null;
  artworkUrl?: string | null;
  previewUrl: string;
  externalUrl?: string | null;
  provider?: 'soundcloud' | 'bandcamp' | 'youtube' | 'volna' | 'apple' | 'yandex';
  startSeconds?: number;
  clipDurationSeconds?: number;
  sourceTrackUrl?: string;
  collectionTitle?: string | null;
  collectionId?: string | null;
  genres?: string[];
  releaseId?: string;
  labelName?: string | null;
  labelUsername?: string | null;
  participants?: MusicReleaseParticipant[];
  isLiveStream?: boolean;
  radioPageUsername?: string;
  radioStationName?: string;
  isRadioFavorite?: boolean;
};

export type GlobalTrack = GlobalTrackQueueItem & {
  queue?: GlobalTrackQueueItem[];
  queueIndex?: number;
  queueWindowResolver?: (target: GlobalTrackQueueItem) => GlobalTrackQueueItem[];
};

function activeQueueIndex(track: GlobalTrack | null | undefined) {
  const queue = track?.queue;
  if (!track || !queue?.length) return -1;
  const declaredIndex = track.queueIndex;
  if (declaredIndex !== undefined && declaredIndex >= 0 && declaredIndex < queue.length && queue[declaredIndex]?.id === track.id) {
    return declaredIndex;
  }
  const exactIndex = queue.findIndex((item) => item.id === track.id && item.previewUrl === track.previewUrl);
  if (exactIndex >= 0) return exactIndex;
  const idIndex = queue.findIndex((item) => item.id === track.id);
  if (idIndex >= 0) return idIndex;
  return queue.findIndex((item) => (
    Boolean(track.externalUrl)
    && item.provider === track.provider
    && item.externalUrl === track.externalUrl
    && item.title === track.title
  ));
}

function activeReleaseTrackPosition(track: GlobalTrack) {
  return releaseTrackPosition(track, activeQueueIndex(track));
}

function trackCollectionKey(item: GlobalTrackQueueItem) {
  return item.collectionId?.trim() || item.collectionTitle?.trim() || item.id;
}

function artworkCarouselKey(item: GlobalTrackQueueItem) {
  return [
    item.provider ?? 'volna',
    trackCollectionKey(item),
    item.artworkUrl?.trim() || 'fallback',
  ].join(':');
}

function adjacentCollectionIndexesForTrack(track: GlobalTrack | null | undefined) {
  const queue = track?.queue;
  const currentIndex = activeQueueIndex(track);
  if (!queue || currentIndex < 0 || !queue[currentIndex]) return { previous: -1, next: -1 };

  const currentKey = trackCollectionKey(queue[currentIndex]);
  let previous = currentIndex - 1;
  while (previous >= 0 && trackCollectionKey(queue[previous]) === currentKey) previous -= 1;
  if (previous >= 0) {
    const previousKey = trackCollectionKey(queue[previous]);
    while (previous > 0 && trackCollectionKey(queue[previous - 1]) === previousKey) previous -= 1;
  }

  let next = currentIndex + 1;
  while (next < queue.length && trackCollectionKey(queue[next]) === currentKey) next += 1;
  return { previous, next: next < queue.length ? next : -1 };
}

function followingCollectionIndexesForTrack(
  track: GlobalTrack | null | undefined,
  limit = 2,
) {
  const queue = track?.queue;
  const currentIndex = activeQueueIndex(track);
  if (!queue || currentIndex < 0 || !queue[currentIndex] || limit <= 0) return [];

  const indexes: number[] = [];
  let index = currentIndex + 1;
  let previousKey = trackCollectionKey(queue[currentIndex]);
  while (index < queue.length && indexes.length < limit) {
    const key = trackCollectionKey(queue[index]);
    if (key !== previousKey) {
      indexes.push(index);
      previousKey = key;
    }
    index += 1;
  }
  return indexes;
}
export type TrackComposerRequest = { nonce: number; track: GlobalTrackQueueItem };

type GlobalAudioContextValue = {
  activeTrack: GlobalTrack | null;
  isExpanded: boolean;
  setExpanded: (expanded: boolean) => void;
  isPlaying: boolean;
  isAudioLoading: boolean;
  soundcloudDiagnostic: string | null;
  progress: number;
  positionSeconds: number;
  durationSeconds: number;
  play: (track: GlobalTrack, fromSeconds?: number) => Promise<void>;
  pause: () => void;
  close: () => void;
  seek: (progress: number) => Promise<void>;
  hasPreviousTrack: boolean;
  hasNextTrack: boolean;
  playPrevious: () => Promise<void>;
  playNext: () => Promise<void>;
  hasPreviousCollection: boolean;
  hasNextCollection: boolean;
  previousCollectionTrack: GlobalTrackQueueItem | null;
  nextCollectionTrack: GlobalTrackQueueItem | null;
  previousCollectionArtworkUrl: string | null;
  nextCollectionArtworkUrl: string | null;
  playPreviousCollection: () => Promise<void>;
  playNextCollection: () => Promise<void>;
  isShuffleEnabled: boolean;
  isRepeatEnabled: boolean;
  toggleShuffle: () => void;
  toggleRepeat: () => void;
  setActiveQueue: (queue: GlobalTrackQueueItem[], queueWindowResolver?: GlobalTrack['queueWindowResolver']) => void;
  primeTrack: (track: GlobalTrackQueueItem) => void;
  canSaveToMyMusic: boolean;
  isSavedToMyMusic: boolean;
  isSavingToMyMusic: boolean;
  toggleMyMusic: () => Promise<void>;
  canSaveRadio: boolean;
  isSavedRadio: boolean;
  isSavingRadio: boolean;
  toggleFavoriteRadio: () => Promise<void>;
  selectOutputDevice: () => Promise<void>;
  openReleaseShare: () => void;
  notify: (message: string, type?: 'success' | 'error') => void;
  isTrackPlaying: (id: string) => boolean;
};

type GlobalAudioProgressContextValue = Pick<GlobalAudioContextValue, 'progress' | 'positionSeconds' | 'durationSeconds'>;
type GlobalAudioControlsContextValue = Omit<GlobalAudioContextValue, keyof GlobalAudioProgressContextValue>;

const GlobalAudioControlsContext = createContext<GlobalAudioControlsContextValue | null>(null);
const GlobalAudioProgressContext = createContext<GlobalAudioProgressContextValue | null>(null);

type PersistedAudioSession = {
  version: 1;
  track: GlobalTrackQueueItem & { queue?: GlobalTrackQueueItem[]; queueIndex?: number };
  positionSeconds: number;
  isExpanded: boolean;
  isShuffleEnabled: boolean;
  isRepeatEnabled: boolean;
  shuffleQueue?: ShuffleQueueState | null;
};

function serializableTrack(track: GlobalTrack): PersistedAudioSession['track'] {
  const { queueWindowResolver: _resolver, ...value } = track;
  return {
    ...value,
    queue: value.queue?.slice(0, 200).map((item) => ({ ...item })),
  };
}

function isPersistedAudioSession(value: unknown): value is PersistedAudioSession {
  if (!value || typeof value !== 'object') return false;
  const session = value as Partial<PersistedAudioSession>;
  const provider = session.track && typeof session.track === 'object' ? (session.track as { provider?: unknown }).provider : undefined;
  return session.version === 1
    && Boolean(session.track && typeof session.track.id === 'string' && typeof session.track.previewUrl === 'string' && typeof session.track.title === 'string')
    && (provider === 'apple' || provider === 'yandex' || provider === 'soundcloud' || provider === 'bandcamp' || provider === 'youtube' || provider === 'volna')
    && typeof session.positionSeconds === 'number'
    && Number.isFinite(session.positionSeconds)
    && typeof session.isExpanded === 'boolean'
    && typeof session.isShuffleEnabled === 'boolean'
    && typeof session.isRepeatEnabled === 'boolean';
}

function largeSoundcloudArtwork(value?: string | null) {
  return musicArtworkThumbnail(value, 'soundcloud', 500);
}

function expandedPlayerArtwork(value: string | null | undefined, provider: GlobalTrackQueueItem['provider']) {
  if (!value) return null;
  return provider === 'soundcloud' ? largeSoundcloudArtwork(value) ?? value : value;
}

type SavableTrackProvider = 'apple' | 'yandex' | 'soundcloud' | 'bandcamp' | 'youtube';
type SavableTrackDescriptor = { key: string; provider: SavableTrackProvider; externalUrl: string };
type PlayerMusicPlaylist = {
  id: string;
  name: string;
  tracks: string[];
  artworkUrl?: string | null;
  artworkThumbnailUrl?: string | null;
};
type PlayerProfileTrack = { id: string; provider: SavableTrackProvider; externalUrl: string };

function savableTrackDescriptor(track: GlobalTrackQueueItem | null | undefined): SavableTrackDescriptor | null {
  if (!track || (track.provider !== 'apple' && track.provider !== 'yandex' && track.provider !== 'soundcloud' && track.provider !== 'bandcamp' && track.provider !== 'youtube')) return null;
  const externalUrl = track.sourceTrackUrl?.trim() || track.externalUrl?.trim();
  if (!externalUrl) return null;
  return { key: `${track.provider}:${normalizedSavableTrackUrl(track.provider, externalUrl)}`, provider: track.provider, externalUrl };
}

function savableSourceTrackId(track: GlobalTrackQueueItem | null | undefined) {
  if (track?.provider !== 'bandcamp') return undefined;
  const queryTrackId = track.previewUrl.match(/[?&]trackId=([^&#]+)/)?.[1];
  if (queryTrackId) {
    try { return decodeURIComponent(queryTrackId); } catch { return queryTrackId; }
  }
  return track.id.match(/:(\d{1,20})$/)?.[1];
}

function safeUrlHost(value: string) {
  try { return new URL(value).hostname; } catch { return ''; }
}

function soundcloudEngineUrl(track: GlobalTrackQueueItem | null | undefined) {
  if (track?.provider !== 'soundcloud') return null;
  // The global queue, not the SoundCloud iframe, is the source of truth for
  // navigation. Loading the concrete sound URL also keeps Widget.load() inside
  // the user's tap. On iOS, loading a playlist and asynchronously calling
  // getSounds -> skip -> play loses the short-lived user activation and Safari
  // rejects playback intermittently.
  return track.sourceTrackUrl?.trim() || track.externalUrl?.trim() || null;
}

function soundcloudDirectStreamUrl(track: GlobalTrackQueueItem | null | undefined) {
  if (track?.provider !== 'soundcloud') return null;
  const sourceUrl = track.sourceTrackUrl?.trim() || track.externalUrl?.trim() || track.previewUrl?.trim();
  return sourceUrl ? `${apiUrl}/music/soundcloud/stream?url=${encodeURIComponent(sourceUrl)}` : null;
}

function isSoundcloudPlaylistTrack(track: GlobalTrackQueueItem | null | undefined) {
  if (track?.provider !== 'soundcloud') return false;
  // Expanded playlist items keep the `/sets/…` URL as their collectionId,
  // while sourceTrackUrl/externalUrl point at the concrete playable sound.
  // Only the playable source identifies whether this is still a placeholder.
  const value = track.sourceTrackUrl?.trim() || track.externalUrl?.trim() || track.previewUrl?.trim();
  if (!value) return false;
  try {
    return new URL(value).pathname.toLowerCase().includes('/sets/');
  } catch {
    return false;
  }
}

type SoundcloudCollectionMetadata = {
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

function listenLaterItemFromTrack(track: GlobalTrack) {
  const collectionId = track.collectionId?.trim() || null;
  const releaseId = track.releaseId?.trim() || null;
  const collectionTracks = track.queue?.filter((item) => {
    if (releaseId) return item.releaseId === releaseId;
    if (collectionId) return item.collectionId?.trim() === collectionId;
    return item.id === track.id;
  }) ?? [];
  const tracks = collectionTracks.length ? collectionTracks : [track];
  return {
    id: track.id,
    provider: track.provider ?? 'volna',
    title: track.collectionTitle?.trim() || track.title,
    artist: track.artist?.trim() || '',
    artworkUrl: track.artworkUrl ?? null,
    collectionId,
    releaseId,
    tracks: tracks.map((item) => ({
      id: item.id,
      title: item.title,
      artist: item.artist ?? '',
      artworkUrl: item.artworkUrl ?? track.artworkUrl ?? null,
      previewUrl: item.previewUrl,
      externalUrl: item.externalUrl ?? null,
      provider: item.provider ?? track.provider ?? 'volna',
      startSeconds: item.startSeconds ?? 0,
      clipDurationSeconds: item.clipDurationSeconds ?? null,
      sourceTrackUrl: item.sourceTrackUrl ?? null,
      collectionTitle: item.collectionTitle ?? track.collectionTitle ?? null,
      collectionId: item.collectionId ?? collectionId,
      genres: item.genres ?? track.genres ?? [],
      releaseId: item.releaseId ?? releaseId,
      labelName: item.labelName ?? track.labelName ?? null,
      labelUsername: item.labelUsername ?? track.labelUsername ?? null,
      participants: item.participants ?? track.participants ?? [],
    })),
  };
}

function youtubeVideoId(track: GlobalTrackQueueItem | null | undefined) {
  if (track?.provider !== 'youtube') return null;
  const direct = track.previewUrl.match(/^youtube:([\w-]{11})$/)?.[1] ?? track.id.match(/([\w-]{11})$/)?.[1];
  if (direct) return direct;
  try {
    const url = new URL(track.externalUrl || track.previewUrl);
    return url.hostname === 'youtu.be' ? url.pathname.split('/').filter(Boolean)[0] ?? null : url.searchParams.get('v');
  } catch { return null; }
}

function findSoundcloudSoundIndex(sounds: Array<{ permalink_url?: string }>, track: GlobalTrackQueueItem) {
  const targetUrl = normalizedExternalTrackUrl(track.sourceTrackUrl || track.externalUrl || '');
  if (!targetUrl) return -1;
  return sounds.findIndex((sound) => sound.permalink_url && normalizedExternalTrackUrl(sound.permalink_url) === targetUrl);
}

function isExpectedPlaybackRejection(error: unknown) {
  const name = error && typeof error === 'object' && 'name' in error
    ? String((error as { name?: unknown }).name ?? '')
    : '';
  return name === 'NotAllowedError' || name === 'AbortError';
}

function waitForWebMediaReady(media: HTMLAudioElement, timeoutMs = 1400) {
  if (media.readyState >= 2) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      media.removeEventListener('canplay', finish);
      media.removeEventListener('loadedmetadata', finish);
      media.removeEventListener('error', finish);
      clearTimeout(timeout);
      resolve();
    };
    const timeout = setTimeout(finish, timeoutMs);
    media.addEventListener('canplay', finish, { once: true });
    media.addEventListener('loadedmetadata', finish, { once: true });
    media.addEventListener('error', finish, { once: true });
  });
}

function waitForLiveWebMediaStart(media: HTMLAudioElement, timeoutMs = 12_000) {
  if (!media.paused && media.readyState >= 2) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      media.removeEventListener('playing', handleStarted);
      media.removeEventListener('canplay', handleStarted);
      media.removeEventListener('error', handleError);
      clearTimeout(timeout);
    };
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const handleStarted = () => finish(resolve);
    const handleError = () => finish(() => reject(new Error('Не удалось получить аудиопоток')));
    const timeout = setTimeout(
      () => finish(() => reject(new Error('Радиостанция не ответила вовремя'))),
      timeoutMs,
    );
    media.addEventListener('playing', handleStarted, { once: true });
    media.addEventListener('canplay', handleStarted, { once: true });
    media.addEventListener('error', handleError, { once: true });
  });
}

const APP_WEB_SURFACE_COLOR = '#ffffff';
const PLAYER_WEB_SURFACE_COLOR = '#f3f5f7';

function setWebSurfaceColor(color: string) {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  document.documentElement.style.backgroundColor = color;
  document.body.style.backgroundColor = color;
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content', color);
}

export function GlobalAudioProvider({ children, onAddTrackToPost, onNotify, storageScope }: { children: ReactNode; onAddTrackToPost: (track: GlobalTrackQueueItem) => void; onNotify: (message: string, type?: 'success' | 'error') => void; storageScope: string }) {
  const player = useAudioPlayer(null, { updateInterval: 250 });
  const preloadPlayer = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);
  const [activeTrack, setActiveTrack] = useState<GlobalTrack | null>(null);
  const [isExpanded, setExpanded] = useState(false);
  const [isReleaseShareVisible, setIsReleaseShareVisible] = useState(false);
  const [isSessionRestored, setIsSessionRestored] = useState(false);
  const [playbackIntent, setPlaybackIntent] = useState(false);
  const [isSavedToMyMusic, setIsSavedToMyMusic] = useState(false);
  const [isSavingToMyMusic, setIsSavingToMyMusic] = useState(false);
  const [isSavedRadio, setIsSavedRadio] = useState(false);
  const [isSavingRadio, setIsSavingRadio] = useState(false);
  const [isShuffleEnabled, setIsShuffleEnabled] = useState(false);
  const [isRepeatEnabled, setIsRepeatEnabled] = useState(false);
  const shuffleEnabledRef = useRef(false);
  const shuffleQueueRef = useRef<ShuffleQueueState | null>(null);
  const repeatEnabledRef = useRef(false);
  const savedStatusRequestRef = useRef(0);
  const savedStatusCacheRef = useRef(new Map<string, boolean>());
  const savedStatusInFlightRef = useRef(new Map<string, Promise<void>>());
  const savedStatusMutationVersionRef = useRef(new Map<string, number>());
  const availabilityInFlightRef = useRef(new Map<string, Promise<{ available: boolean; labelName: string | null; labelUsername: string | null; releaseTitle: string | null }>>());
  const soundcloudCollectionInFlightRef = useRef(new Map<string, Promise<SoundcloudCollectionMetadata>>());
  const lastPlaybackPublishRef = useRef<{ at: number; payload: string } | null>(null);
  const [soundcloudState, setSoundcloudState] = useState({ duration: 0, playing: false, position: 0, trackCount: 0, trackIndex: 0 });
  const [soundcloudDiagnostic, setSoundcloudDiagnostic] = useState<string | null>(null);
  const [isSoundcloudLoading, setIsSoundcloudLoading] = useState(false);
  const [soundcloudWebState, setSoundcloudWebState] = useState({ duration: 0, position: 0 });
  const [uploadedWebState, setUploadedWebState] = useState({ duration: 0, position: 0 });
  const [youtubeState, setYoutubeState] = useState({ duration: 0, loading: false, playing: false, position: 0 });
  const [progressResetTrackId, setProgressResetTrackId] = useState<string | null>(null);
  const activeTrackRef = useRef<GlobalTrack | null>(null);
  const sessionTrackRef = useRef<GlobalTrack | null>(null);
  const restoredPositionRef = useRef<{ fromSeconds: number; trackId: string } | null>(null);
  const restoredMediaNeedsLoadRef = useRef(false);
  const persistSessionRef = useRef<() => Promise<void>>(async () => undefined);
  const soundcloudWebAudioRef = useRef<HTMLAudioElement | null>(null);
  const uploadedWebAudioRef = useRef<HTMLAudioElement | null>(null);
  const preloadedWebAudioRef = useRef<HTMLAudioElement | null>(null);
  const youtubeEngineRef = useRef<YouTubeAudioEngineHandle | null>(null);
  const soundcloudFrameRef = useRef<any>(null);
  const soundcloudWidgetRef = useRef<any>(null);
  const pendingSoundcloudPlayRef = useRef<{ position: number; requestId: number; track: GlobalTrack } | null>(null);
  const soundcloudPlayRequestRef = useRef(0);
  const soundcloudConfirmedTrackRef = useRef<string | null>(null);
  const soundcloudStartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const soundcloudDiagnosticTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const soundcloudDelayedPlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const soundcloudFrameEngineUrlRef = useRef<string | null>(null);
  const [soundcloudFrameSeedUrl, setSoundcloudFrameSeedUrl] = useState<string | null>(null);
  const mediaDurationRef = useRef(0);
  const mediaPositionRef = useRef(0);
  const playRef = useRef<(track: GlobalTrack, fromSeconds?: number) => Promise<void>>(async () => undefined);
  const playNextRef = useRef<() => Promise<void>>(async () => undefined);
  const progressResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playbackRequestRef = useRef(0);
  const transitioningTrackRef = useRef<string | null>(null);
  const lastPlayedCollectionTrackRef = useRef(new Map<string, { queue?: GlobalTrackQueueItem[]; track: GlobalTrackQueueItem }>());
  const advancedFinishedTrackRef = useRef<string | null>(null);
  const publishPlaybackActivityRef = useRef<() => void>(() => undefined);
  // State restoration used to populate only `activeTrack`, while playback
  // activity publishing reads `activeTrackRef`. As a result, a restored track
  // could play normally in the mini-player but was published as "not playing"
  // and the profile kept showing its static primary track. Keep the imperative
  // mirror synchronized for every state transition, including restoration.
  useLayoutEffect(() => {
    activeTrackRef.current = activeTrack;
  }, [activeTrack]);
  useEffect(() => {
    const trackId = activeTrack?.id;
    const username = activeTrack?.radioPageUsername?.trim();
    if (!trackId || !activeTrack?.isLiveStream || !username) return;
    let cancelled = false;

    const refreshNowPlaying = async () => {
      try {
        const response = await apiFetch(`${apiUrl}/public-pages/radio-stream/${encodeURIComponent(username)}/now-playing`);
        if (!response.ok) return;
        const result = await response.json() as { artist?: string | null; title?: string | null };
        if (cancelled || !result.title?.trim()) return;
        setActiveTrack((current) => {
          if (!current || current.id !== trackId || !current.isLiveStream) return current;
          const title = result.title!.trim();
          const artist = result.artist?.trim() || 'Радиостанция';
          if (current.title === title && current.artist === artist) return current;
          return { ...current, title, artist };
        });
      } catch {
        // A station may omit ICY metadata while its audio stream remains valid.
      }
    };

    void refreshNowPlaying();
    const interval = setInterval(() => void refreshNowPlaying(), 15_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [activeTrack?.id, activeTrack?.isLiveStream, activeTrack?.radioPageUsername]);
  // SoundCloud now resolves to a direct CDN stream and uses the shared audio
  // backend. The iframe widget remains only as dormant fallback code while the
  // direct-stream prototype is validated on devices.
  const usesSoundcloud = false;
  const hasSoundcloudFrame = Boolean(soundcloudFrameSeedUrl);
  const usesUploadedWebAudio = Platform.OS === 'web' && activeTrack?.provider === 'volna';
  const usesDirectSoundcloudWebAudio = Platform.OS === 'web' && activeTrack?.provider === 'soundcloud';
  const usesYouTube = activeTrack?.provider === 'youtube';
  const activeSaveDescriptor = savableTrackDescriptor(activeTrack);
  const saveTrackKey = activeSaveDescriptor?.key ?? null;
  const saveProvider = activeSaveDescriptor?.provider ?? null;
  const saveTrackUrl = activeSaveDescriptor?.externalUrl ?? null;
  const canSaveToMyMusic = Boolean(saveProvider && saveTrackUrl);
  const canSaveRadio = Boolean(activeTrack?.isLiveStream && activeTrack.radioPageUsername);
  const sessionStorageKey = useMemo(() => `volna:audio-session:${storageScope}`, [storageScope]);
  const resolveTrackAvailability = useCallback(async (track: GlobalTrackQueueItem) => {
    if (track.isLiveStream) return { available: true, labelName: null, labelUsername: null, releaseTitle: null };
    const uploadedTrackId = track.provider === 'volna'
      ? track.id.match(/^uploaded:(.+)$/)?.[1]
        ?? track.previewUrl.match(/\/my-music\/stream\/([^/?#]+)/)?.[1]
        ?? null
      : null;
    if (!track.releaseId && !uploadedTrackId) return { available: true, labelName: track.labelName ?? null, labelUsername: track.labelUsername ?? null, releaseTitle: track.collectionTitle ?? null };
    const availabilityKey = `${track.releaseId ?? ''}:${uploadedTrackId ?? ''}`;
    const inFlight = availabilityInFlightRef.current.get(availabilityKey);
    if (inFlight) return inFlight;
    const request = (async () => {
      try {
      const response = await apiFetch(`${apiUrl}/my-music/playback-availability`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ releaseId: track.releaseId, uploadedTrackId }),
      });
      if (!response.ok) return { available: true, labelName: track.labelName ?? null, labelUsername: track.labelUsername ?? null, releaseTitle: track.collectionTitle ?? null };
      const result = await response.json() as { available?: boolean; labelName?: string | null; labelUsername?: string | null; releaseTitle?: string | null };
      return { available: result.available !== false, labelName: result.labelName ?? null, labelUsername: result.labelUsername ?? null, releaseTitle: result.releaseTitle?.trim() || null };
      } catch {
        return { available: true, labelName: track.labelName ?? null, labelUsername: track.labelUsername ?? null, releaseTitle: track.collectionTitle ?? null };
      }
    })();
    availabilityInFlightRef.current.set(availabilityKey, request);
    try {
      return await request;
    } finally {
      if (availabilityInFlightRef.current.get(availabilityKey) === request) availabilityInFlightRef.current.delete(availabilityKey);
    }
  }, []);
  const resolveSoundcloudQueueTarget = useCallback(async (
    target: GlobalTrackQueueItem,
    queue: GlobalTrackQueueItem[],
    direction: 'next' | 'previous',
  ) => {
    if (!isSoundcloudPlaylistTrack(target)) {
      const existingIndex = queue.findIndex((item) => item.id === target.id);
      return { queue, queueIndex: existingIndex, track: target };
    }
    const playlistUrl = target.collectionId?.trim() || target.externalUrl?.trim() || target.previewUrl.trim();
    let request = soundcloudCollectionInFlightRef.current.get(playlistUrl);
    if (!request) {
      request = (async () => {
        const response = await apiFetch(`${apiUrl}/music/soundcloud/release?url=${encodeURIComponent(playlistUrl)}`);
        if (!response.ok) throw new Error(await readApiError(response, 'Не удалось подготовить плейлист SoundCloud'));
        return response.json() as Promise<SoundcloudCollectionMetadata>;
      })();
      soundcloudCollectionInFlightRef.current.set(playlistUrl, request);
      void request.catch(() => {
        if (soundcloudCollectionInFlightRef.current.get(playlistUrl) === request) {
          soundcloudCollectionInFlightRef.current.delete(playlistUrl);
        }
      });
    }
    const metadata = await request;
    const expandedTracks: GlobalTrackQueueItem[] = metadata.tracks.flatMap((item, index) => {
      const externalUrl = item.externalUrl?.trim();
      if (!externalUrl) return [];
      return [{
        id: `soundcloud-playlist:${playlistUrl}:${index}:${externalUrl}`,
        title: item.title,
        artist: item.artist || target.artist,
        artworkUrl: largeSoundcloudArtwork(item.artworkUrl || metadata.artworkUrl || target.artworkUrl)
          || item.artworkUrl
          || metadata.artworkUrl
          || target.artworkUrl,
        previewUrl: externalUrl,
        externalUrl,
        provider: 'soundcloud',
        sourceTrackUrl: externalUrl,
        collectionTitle: metadata.title || target.collectionTitle || target.title,
        collectionId: playlistUrl,
        genres: target.genres,
        releaseId: target.releaseId,
        labelName: target.labelName,
        labelUsername: target.labelUsername,
        participants: target.participants,
        startSeconds: 0,
        clipDurationSeconds: item.durationSeconds ?? target.clipDurationSeconds ?? 30,
      }];
    });
    if (!expandedTracks.length) throw new Error('В плейлисте SoundCloud нет доступных треков');
    const placeholderIndex = queue.findIndex((item) => (
      item.id === target.id
      || (
        isSoundcloudPlaylistTrack(item)
        && (item.collectionId?.trim() || item.externalUrl?.trim() || item.previewUrl.trim()) === playlistUrl
      )
    ));
    const expandedQueue = placeholderIndex >= 0
      ? [...queue.slice(0, placeholderIndex), ...expandedTracks, ...queue.slice(placeholderIndex + 1)]
      : expandedTracks;
    const selectedTrack = direction === 'previous' ? expandedTracks[expandedTracks.length - 1] : expandedTracks[0];
    return {
      queue: expandedQueue,
      queueIndex: expandedQueue.findIndex((item) => item.id === selectedTrack.id),
      track: selectedTrack,
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setIsSessionRestored(false);
    void AsyncStorage.getItem(sessionStorageKey).then(async (stored) => {
      if (cancelled || !stored) return;
      try {
        const session: unknown = JSON.parse(stored);
        if (!isPersistedAudioSession(session)) {
          await AsyncStorage.removeItem(sessionStorageKey);
          return;
        }
        const availability = await resolveTrackAvailability(session.track);
        if (!availability.available) {
          await AsyncStorage.removeItem(sessionStorageKey);
          return;
        }
        let track: GlobalTrack = {
          ...session.track,
          collectionTitle: session.track.releaseId ? availability.releaseTitle ?? session.track.collectionTitle : session.track.collectionTitle,
          labelName: session.track.releaseId ? availability.labelName : session.track.labelName,
          labelUsername: session.track.releaseId ? availability.labelUsername : session.track.labelUsername,
          queue: session.track.queue?.map((item) => item.releaseId === session.track.releaseId
            ? { ...item, collectionTitle: availability.releaseTitle ?? item.collectionTitle, labelName: availability.labelName, labelUsername: availability.labelUsername }
            : item),
        };
        if (track.isLiveStream && track.radioPageUsername?.trim()) {
          try {
            const response = await apiFetch(`${apiUrl}/public-pages/${encodeURIComponent(track.radioPageUsername.trim())}`);
            if (response.ok) {
              const page = await response.json() as { radioStreamUrl?: string | null };
              const currentStreamUrl = page.radioStreamUrl?.trim();
              if (currentStreamUrl) {
                track = {
                  ...track,
                  previewUrl: currentStreamUrl,
                  queue: track.queue?.map((item) => item.id === track.id
                    ? { ...item, previewUrl: currentStreamUrl }
                    : item),
                };
              }
            }
          } catch {
            // Keep the last known stream URL when the public page is temporarily unavailable.
          }
        }
        sessionTrackRef.current = track;
        activeTrackRef.current = null;
        // React state survives in AsyncStorage, but none of the actual playback
        // backends survive an application/page restart. The first explicit play
        // after restoration must therefore load the source even though the
        // restored track id and URL match the current React state.
        restoredMediaNeedsLoadRef.current = true;
        restoredPositionRef.current = {
          trackId: track.id,
          fromSeconds: Math.max(0, (track.startSeconds ?? 0) + session.positionSeconds),
        };
        shuffleQueueRef.current = session.shuffleQueue ?? null;
        setActiveTrack(track);
        // Never cover the application on launch: restored playback starts in the mini-player.
        setExpanded(false);
        setIsShuffleEnabled(session.isShuffleEnabled);
        setIsRepeatEnabled(session.isRepeatEnabled);
      } catch {
        void AsyncStorage.removeItem(sessionStorageKey);
      }
    }).finally(() => {
      if (!cancelled) setIsSessionRestored(true);
    });
    return () => { cancelled = true; };
  }, [resolveTrackAvailability, sessionStorageKey]);
  const loadSavedStatuses = useCallback(async (tracks: Array<GlobalTrackQueueItem | GlobalTrack>) => {
    const descriptors = Array.from(new Map(tracks.flatMap((track) => {
      const descriptor = savableTrackDescriptor(track);
      return descriptor ? [[descriptor.key, descriptor] as const] : [];
    })).values()).filter((descriptor) => !savedStatusCacheRef.current.has(descriptor.key));
    const pending = descriptors.flatMap((descriptor) => {
      const request = savedStatusInFlightRef.current.get(descriptor.key);
      return request ? [request] : [];
    });
    const missing = descriptors.filter((descriptor) => !savedStatusInFlightRef.current.has(descriptor.key));
    if (!missing.length) {
      await Promise.all(pending);
      return;
    }
    const requestedVersions = new Map(missing.map((descriptor) => [descriptor.key, savedStatusMutationVersionRef.current.get(descriptor.key) ?? 0]));
    const request = (async () => {
      const response = await apiFetch(`${apiUrl}/my-music/external-track/statuses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tracks: missing.map(({ provider, externalUrl }) => ({ provider, externalUrl })) }),
      });
      if (!response.ok) throw new Error(await readApiError(response, 'Не удалось проверить треки'));
      const result = await response.json() as { statuses?: Array<{ provider?: string; externalUrl?: string; added?: boolean }> };
      result.statuses?.forEach((status) => {
        if ((status.provider !== 'apple' && status.provider !== 'yandex' && status.provider !== 'soundcloud' && status.provider !== 'bandcamp' && status.provider !== 'youtube') || !status.externalUrl) return;
        const key = `${status.provider}:${normalizedSavableTrackUrl(status.provider, status.externalUrl)}`;
        if ((savedStatusMutationVersionRef.current.get(key) ?? 0) !== requestedVersions.get(key)) return;
        savedStatusCacheRef.current.set(key, Boolean(status.added));
      });
    })();
    missing.forEach((descriptor) => savedStatusInFlightRef.current.set(descriptor.key, request));
    try {
      await Promise.all([...pending, request]);
    } finally {
      missing.forEach((descriptor) => {
        if (savedStatusInFlightRef.current.get(descriptor.key) === request) savedStatusInFlightRef.current.delete(descriptor.key);
      });
    }
  }, []);
  const isPlaying = usesYouTube ? youtubeState.playing : playbackIntent;
  const isAudioLoading = isSoundcloudLoading || Boolean(activeTrack && playbackIntent && status?.isBuffering);
  const trackStart = activeTrack?.startSeconds ?? 0;
  const usesDirectSoundcloud = activeTrack?.provider === 'soundcloud';
  const trackDuration = activeTrack?.isLiveStream
    ? 0
    : usesYouTube
    ? activeTrack?.clipDurationSeconds ?? Math.max(0, youtubeState.duration - trackStart)
    : usesDirectSoundcloudWebAudio
    ? Math.max(0, soundcloudWebState.duration)
    : usesDirectSoundcloud
    ? Math.max(0, Number(status?.duration ?? 0) - trackStart)
    : usesSoundcloud
    ? Math.max(0, soundcloudState.duration || activeTrack?.clipDurationSeconds || 0)
    : usesUploadedWebAudio
      ? Math.max(0, uploadedWebState.duration || activeTrack?.clipDurationSeconds || 0)
    : activeTrack?.clipDurationSeconds ?? Math.max(0, Number(status?.duration ?? 0) - trackStart);
  const restoredPositionSeconds = activeTrack && restoredPositionRef.current?.trackId === activeTrack.id
    ? Math.max(0, restoredPositionRef.current.fromSeconds - trackStart)
    : null;
  const rawProgress = trackDuration > 0
    ? Math.min(1, Math.max(0, restoredPositionSeconds !== null ? restoredPositionSeconds / trackDuration : usesYouTube ? (youtubeState.position - trackStart) / trackDuration : usesDirectSoundcloudWebAudio ? soundcloudWebState.position / trackDuration : usesSoundcloud ? soundcloudState.position / trackDuration : usesUploadedWebAudio ? uploadedWebState.position / trackDuration : (Number(status?.currentTime ?? trackStart) - trackStart) / trackDuration))
    : 0;
  const progress = progressResetTrackId === activeTrack?.id ? 0 : rawProgress;
  const positionSeconds = restoredPositionSeconds ?? progress * trackDuration;
  mediaDurationRef.current = trackDuration;
  mediaPositionRef.current = positionSeconds;
  sessionTrackRef.current = activeTrack;
  shuffleEnabledRef.current = isShuffleEnabled;
  repeatEnabledRef.current = isRepeatEnabled;

  useEffect(() => {
    // Web/PWA sessions authenticate with the first-party session cookie and
    // intentionally have no native bearer token. `storageScope` is the
    // authenticated account id on every platform, so it is the correct session
    // guard for publishing playback activity.
    if (!storageScope || !isSessionRestored) return;
    const publish = () => {
      const track = activeTrackRef.current;
      const playing = Boolean(track && (track.provider === 'youtube' ? youtubeState.playing : playbackIntent));
      const payload = JSON.stringify(playing && track ? {
        isPlaying: true,
        id: track.id,
        title: track.title,
        artist: track.artist ?? null,
        artworkUrl: track.artworkUrl ?? null,
        previewUrl: track.previewUrl,
        externalUrl: track.externalUrl ?? null,
        provider: track.provider ?? 'volna',
        startSeconds: track.startSeconds ?? 0,
        clipDurationSeconds: track.clipDurationSeconds ?? 30,
        isLiveStream: track.isLiveStream === true,
        radioStationName: track.isLiveStream ? track.radioStationName?.trim() || null : null,
      } : { isPlaying: false });
      const now = Date.now();
      const previous = lastPlaybackPublishRef.current;
      if (previous?.payload === payload && now - previous.at < 5_000) return;
      lastPlaybackPublishRef.current = { at: now, payload };
      void apiFetch(`${apiUrl}/profiles/me/playback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
      }).catch(() => undefined);
    };
    publishPlaybackActivityRef.current = publish;
    publish();
    if (!isPlaying || !activeTrack) return;
    const heartbeat = setInterval(publish, 30_000);
    return () => clearInterval(heartbeat);
  }, [activeTrack?.id, isPlaying, isSessionRestored, playbackIntent, storageScope, youtubeState.playing]);

  useEffect(() => subscribePlaybackVisibilityChanged(() => publishPlaybackActivityRef.current()), []);

  useEffect(() => () => {
    if (!storageScope) return;
    void apiFetch(`${apiUrl}/profiles/me/playback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isPlaying: false }),
    }).catch(() => undefined);
  }, [storageScope]);

  useEffect(() => {
    if (!isShuffleEnabled || !activeTrack?.queue?.length) {
      if (!isShuffleEnabled) shuffleQueueRef.current = null;
      return;
    }
    shuffleQueueRef.current = ensureShuffleQueueState(
      shuffleQueueRef.current,
      activeTrack.queue.map((item) => item.id),
      activeTrack.id,
    );
  }, [activeTrack?.id, activeTrack?.queue, isShuffleEnabled]);

  const playExpoAudio = useCallback(async () => {
    if (Platform.OS === 'web') {
      const media = (player as unknown as { media?: HTMLAudioElement }).media;
      if (media) {
        await media.play();
        return;
      }
    }
    player.play();
  }, [player]);

  const clearSoundcloudDiagnosticTimer = useCallback(() => {
    if (soundcloudDiagnosticTimerRef.current) clearTimeout(soundcloudDiagnosticTimerRef.current);
    soundcloudDiagnosticTimerRef.current = null;
  }, []);

  const showSoundcloudDiagnostic = useCallback((code: 'SC_READY_TIMEOUT' | 'SC_PLAY_TIMEOUT' | 'SC_WIDGET_ERROR', track: GlobalTrack, detail: string) => {
    clearSoundcloudDiagnosticTimer();
    if (activeTrackRef.current?.id !== track.id) return;
    setPlaybackIntent(false);
    setIsSoundcloudLoading(false);
    setSoundcloudState((state) => ({ ...state, playing: false }));
    const source = soundcloudEngineUrl(track);
    let sourceLabel = 'нет URL';
    if (source) {
      try { sourceLabel = `${safeUrlHost(source)}${new URL(source).pathname}`; }
      catch { sourceLabel = safeUrlHost(source) || 'некорректный URL'; }
    }
    const userAgent = Platform.OS === 'web' && typeof navigator !== 'undefined' ? navigator.userAgent : Platform.OS;
    const diagnostic = [
      `Код: ${code}`,
      `Этап: ${detail}`,
      `Трек: ${sourceLabel}`,
      `Widget: ${soundcloudWidgetRef.current ? 'создан' : 'не создан'}`,
      `Iframe: ${soundcloudFrameEngineUrlRef.current ? 'загружен' : 'не загружен'}`,
      'Задержка перед Play: 700 мс',
      `Среда: ${userAgent}`,
    ].join('\n');
    setSoundcloudDiagnostic(diagnostic);
    Alert.alert('Ошибка SoundCloud', `${diagnostic}\n\nНажмите «Скопировать» и пришлите этот текст.`, [
      { text: 'Закрыть', style: 'cancel' },
      { text: 'Скопировать', onPress: () => { void Clipboard.setStringAsync(diagnostic); } },
    ]);
  }, [clearSoundcloudDiagnosticTimer]);

  const armSoundcloudDiagnostic = useCallback((code: 'SC_READY_TIMEOUT' | 'SC_PLAY_TIMEOUT', track: GlobalTrack, detail: string) => {
    clearSoundcloudDiagnosticTimer();
    soundcloudDiagnosticTimerRef.current = setTimeout(() => showSoundcloudDiagnostic(code, track, detail), 8000);
  }, [clearSoundcloudDiagnosticTimer, showSoundcloudDiagnostic]);

  const startSoundcloudTrack = useCallback((widget: any, track: GlobalTrack, position: number, requestId: number) => {
    if (soundcloudStartTimerRef.current) clearTimeout(soundcloudStartTimerRef.current);
    soundcloudConfirmedTrackRef.current = null;
    // This must be the first Widget command made from the press handler. iOS
    // WebKit grants cross-origin media playback only during a very short user
    // activation window; waiting for getSounds/getCurrentSoundIndex first makes
    // the exact same code work on desktop but fail in Safari and Chrome on iOS.
    widget.play();
    widget.getSounds((sounds: Array<{ permalink_url?: string }>) => {
      if (requestId !== soundcloudPlayRequestRef.current || activeTrackRef.current?.id !== track.id) return;
      const targetIndex = Array.isArray(sounds) ? findSoundcloudSoundIndex(sounds, track) : -1;
      const attemptPlayback = (attempt: number) => {
        if (requestId !== soundcloudPlayRequestRef.current || activeTrackRef.current?.id !== track.id) return;
        if (soundcloudConfirmedTrackRef.current === track.id) return;
        widget.getCurrentSoundIndex((currentIndex: number) => {
          if (requestId !== soundcloudPlayRequestRef.current || activeTrackRef.current?.id !== track.id) return;
          const selectedIndex = Math.max(0, Number(currentIndex) || 0);
          if (targetIndex >= 0 && selectedIndex !== targetIndex) {
            // `skip` is asynchronous in the SoundCloud iframe. Calling play in
            // the same tick races the selection on Safari and is often lost.
            if (attempt === 0 || attempt % 3 === 0) widget.skip(targetIndex);
          } else {
            if (position > 0 && attempt === 0) widget.seekTo(position * 1000);
            widget.play();
          }
          if (attempt < 10 && soundcloudConfirmedTrackRef.current !== track.id) {
            soundcloudStartTimerRef.current = setTimeout(() => attemptPlayback(attempt + 1), 90 + attempt * 15);
          }
        });
      };
      attemptPlayback(0);
    });
  }, []);

  const primeConcreteTrack = useCallback((track: GlobalTrackQueueItem) => {
    const artworkUrl = expandedPlayerArtwork(track.artworkUrl, track.provider);
    if (artworkUrl) void Image.prefetch(artworkUrl).catch(() => undefined);
    if (track.provider === 'soundcloud') {
      // SoundCloud resolves its expiring CDN URL on first access. Warm both the
      // release-availability lookup and media source while an adjacent track is
      // playing, so automatic and button-driven queue transitions do not begin
      // with a cold provider request.
      void resolveTrackAvailability(track).catch(() => undefined);
      const streamUrl = soundcloudDirectStreamUrl(track);
      if (!streamUrl) return;
      if (Platform.OS !== 'web') {
        preloadPlayer.replace(streamUrl);
        return;
      }
      // The active SoundCloud element cannot be repurposed without interrupting
      // playback. It is safe to prepare it while another provider is active.
      if (activeTrackRef.current?.provider === 'soundcloud') return;
      const audio = soundcloudWebAudioRef.current;
      if (!audio || audio.getAttribute('src')?.trim() === streamUrl) return;
      audio.src = streamUrl;
      audio.load();
      return;
    }
    if (!track.previewUrl) return;
    if (Platform.OS !== 'web') {
      preloadPlayer.replace(track.previewUrl);
      return;
    }
    const audio = preloadedWebAudioRef.current;
    if (!audio || audio.src === track.previewUrl) return;
    audio.src = track.previewUrl;
    audio.load();
  }, [preloadPlayer, resolveTrackAvailability]);
  const primeQueueNeighbor = useCallback((track: GlobalTrackQueueItem, direction: 'next' | 'previous') => {
    if (!isSoundcloudPlaylistTrack(track)) {
      primeConcreteTrack(track);
      return;
    }
    const queue = activeTrackRef.current?.queue ?? [track];
    void resolveSoundcloudQueueTarget(track, queue, direction)
      .then((resolved) => primeConcreteTrack(resolved.track))
      .catch(() => undefined);
  }, [primeConcreteTrack, resolveSoundcloudQueueTarget]);
  const primeTrack = useCallback((track: GlobalTrackQueueItem) => {
    primeQueueNeighbor(track, 'next');
  }, [primeQueueNeighbor]);

  useEffect(() => {
    void setAudioModeAsync({ interruptionMode: 'mixWithOthers', playsInSilentMode: false, shouldPlayInBackground: false });
  }, []);
  useEffect(() => () => {
    // The provider is scoped to the authenticated application. Logging out
    // unmounts it, so stop every playback backend before the auth screen mounts.
    setPlaybackIntent(false);
    pendingSoundcloudPlayRef.current = null;
    if (soundcloudStartTimerRef.current) clearTimeout(soundcloudStartTimerRef.current);
    soundcloudStartTimerRef.current = null;
    soundcloudWidgetRef.current?.pause?.();
    const soundcloudAudio = soundcloudWebAudioRef.current;
    if (soundcloudAudio) {
      soundcloudAudio.pause();
      soundcloudAudio.removeAttribute('src');
      soundcloudAudio.load();
    }
    if (soundcloudDelayedPlayTimerRef.current) clearTimeout(soundcloudDelayedPlayTimerRef.current);
    soundcloudWidgetRef.current = null;
    const uploadedAudio = uploadedWebAudioRef.current;
    if (uploadedAudio) {
      uploadedAudio.pause();
      uploadedAudio.removeAttribute('src');
      uploadedAudio.load();
    }
    player.pause();
    player.replace(null);
    activeTrackRef.current = null;
  }, [player]);
  useEffect(() => () => {
    if (progressResetTimerRef.current) clearTimeout(progressResetTimerRef.current);
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web' && activeTrackRef.current?.provider === 'soundcloud') return;
    if (transitioningTrackRef.current === activeTrackRef.current?.id) return;
    if (status?.didJustFinish) {
      const track = activeTrackRef.current;
      if (track && repeatEnabledRef.current) {
        if (advancedFinishedTrackRef.current !== track.id) {
          advancedFinishedTrackRef.current = track.id;
          void playRef.current(track, track.startSeconds ?? 0);
        }
        return;
      }
      if (track && ((track.queue && ((track.queueIndex ?? 0) < track.queue.length - 1 || shuffleEnabledRef.current || repeatEnabledRef.current)) || repeatEnabledRef.current)) {
        if (advancedFinishedTrackRef.current !== track.id) {
          advancedFinishedTrackRef.current = track.id;
          void playNextRef.current();
        }
        return;
      }
      setPlaybackIntent(false);
      return;
    }
    const track = activeTrackRef.current;
    // Imported SoundCloud rows historically carried the generic 30-second
    // preview limit. Direct provider streams are full tracks, so only their
    // actual media end may advance the queue.
    if (!track?.clipDurationSeconds || track.provider === 'soundcloud' || !status?.playing) return;
    const end = (track.startSeconds ?? 0) + track.clipDurationSeconds;
    if (Number(status.currentTime ?? 0) < end - 0.08) return;
    if (repeatEnabledRef.current) {
      if (advancedFinishedTrackRef.current !== track.id) {
        advancedFinishedTrackRef.current = track.id;
        void playRef.current(track, track.startSeconds ?? 0);
      }
      return;
    }
    if ((track.queue && ((track.queueIndex ?? 0) < track.queue.length - 1 || shuffleEnabledRef.current || repeatEnabledRef.current)) || repeatEnabledRef.current) {
      if (advancedFinishedTrackRef.current !== track.id) {
        advancedFinishedTrackRef.current = track.id;
        void playNextRef.current();
      }
    }
    else {
      setPlaybackIntent(false);
      player.pause();
      void player.seekTo(track.startSeconds ?? 0);
    }
  }, [player, status?.currentTime, status?.didJustFinish, status?.playing]);

  useEffect(() => {
    if (Platform.OS === 'web' || !isSoundcloudLoading || !playbackIntent || activeTrack?.provider === 'youtube') return;
    if (status?.playing && !status.isBuffering) setIsSoundcloudLoading(false);
  }, [activeTrack?.provider, isSoundcloudLoading, playbackIntent, status?.isBuffering, status?.playing]);

  useEffect(() => {
    const track = activeTrackRef.current;
    if (track?.provider !== 'youtube' || !youtubeState.playing || !track.clipDurationSeconds) return;
    const end = (track.startSeconds ?? 0) + track.clipDurationSeconds;
    if (youtubeState.position < end - 0.08 || advancedFinishedTrackRef.current === track.id) return;
    advancedFinishedTrackRef.current = track.id;
    if (repeatEnabledRef.current) {
      const videoId = youtubeVideoId(track);
      if (videoId) youtubeEngineRef.current?.load(videoId, track.startSeconds ?? 0, true);
      return;
    }
    const hasFollowingTrack = Boolean(track.queue && (track.queueIndex ?? 0) < track.queue.length - 1);
    if (hasFollowingTrack || shuffleEnabledRef.current) void playNextRef.current();
    else {
      youtubeEngineRef.current?.pause();
      setPlaybackIntent(false);
      setYoutubeState((state) => ({ ...state, playing: false, position: track.startSeconds ?? 0 }));
      youtubeEngineRef.current?.seek(track.startSeconds ?? 0, false);
    }
  }, [youtubeState.playing, youtubeState.position]);

  useEffect(() => {
    if (Platform.OS !== 'web' || !hasSoundcloudFrame) return;
    let disposed = false;
    const isCurrent = () => !disposed;
    const initialize = () => {
      const frame = soundcloudFrameRef.current;
      const SC = (window as any).SC;
      if (!frame || !SC?.Widget || disposed) return;
      const widget = SC.Widget(frame);
      soundcloudWidgetRef.current = widget;
      widget.bind(SC.Widget.Events.READY, () => {
        if (!isCurrent()) return;
        widget.getDuration((milliseconds: number) => setSoundcloudState((state) => ({ ...state, duration: Math.max(0, milliseconds / 1000) })));
        widget.getSounds((sounds: unknown[]) => setSoundcloudState((state) => ({ ...state, trackCount: Array.isArray(sounds) ? sounds.length : 0 })));
        widget.getCurrentSoundIndex((index: number) => setSoundcloudState((state) => ({ ...state, trackIndex: Math.max(0, Number(index) || 0) })));
        const pending = pendingSoundcloudPlayRef.current;
        if (pending) {
          armSoundcloudDiagnostic('SC_PLAY_TIMEOUT', pending.track, 'Widget готов, но событие PLAY не пришло за 8 секунд');
          startSoundcloudTrack(widget, pending.track, Math.max(0, pending.position), pending.requestId);
        }
      });
      widget.bind(SC.Widget.Events.PLAY, () => {
        if (!isCurrent()) return;
        widget.getDuration((milliseconds: number) => setSoundcloudState((state) => ({ ...state, duration: Math.max(0, milliseconds / 1000) })));
        widget.getCurrentSoundIndex((index: number) => setSoundcloudState((state) => ({ ...state, playing: true, trackIndex: Math.max(0, Number(index) || 0) })));
        widget.getCurrentSound((sound: { title?: string; artwork_url?: string | null; permalink_url?: string; user?: { username?: string } } | null) => {
          if (!sound || !isCurrent()) return;
          const current = activeTrackRef.current;
          if (!current) return;
          const soundTrackUrl = sound.permalink_url?.trim() || undefined;
          const normalizedSoundTrackUrl = normalizedExternalTrackUrl(soundTrackUrl || '');
          const normalizedCurrentTrackUrls = [current.sourceTrackUrl, current.externalUrl]
            .filter((value): value is string => Boolean(value))
            .map(normalizedExternalTrackUrl);
          const isSameTrack = Boolean(normalizedSoundTrackUrl && normalizedCurrentTrackUrls.includes(normalizedSoundTrackUrl));
          const matchingQueueIndex = soundTrackUrl && current.queue
            ? current.queue.findIndex((item) => [item.sourceTrackUrl, item.externalUrl]
              .filter((value): value is string => Boolean(value))
              .some((value) => normalizedExternalTrackUrl(value) === normalizedSoundTrackUrl))
            : -1;
          const matchingQueueItem = matchingQueueIndex >= 0 ? current.queue?.[matchingQueueIndex] : null;
          const didChangeTrack = Boolean(matchingQueueItem && matchingQueueItem.id !== current.id)
            || Boolean(normalizedSoundTrackUrl && !normalizedCurrentTrackUrls.includes(normalizedSoundTrackUrl));
          const updated = {
            ...current,
            ...(matchingQueueItem ?? {}),
            title: sound.title?.trim() || current.title,
            artist: sound.user?.username?.trim() || current.artist,
            artworkUrl: largeSoundcloudArtwork(sound.artwork_url)
              || largeSoundcloudArtwork(current.artworkUrl)
              || current.artworkUrl,
            sourceTrackUrl: soundTrackUrl || current.sourceTrackUrl || current.externalUrl || undefined,
            queue: current.queue,
            queueIndex: matchingQueueIndex >= 0 ? matchingQueueIndex : current.queueIndex,
          };
          const expectedUrl = normalizedExternalTrackUrl(current.sourceTrackUrl || current.externalUrl || '');
          if (soundTrackUrl && normalizedExternalTrackUrl(soundTrackUrl) === expectedUrl) {
            soundcloudConfirmedTrackRef.current = current.id;
            if (pendingSoundcloudPlayRef.current?.requestId === soundcloudPlayRequestRef.current) {
              pendingSoundcloudPlayRef.current = null;
            }
            if (soundcloudStartTimerRef.current) clearTimeout(soundcloudStartTimerRef.current);
            soundcloudStartTimerRef.current = null;
          }
          const updatedCollectionId = updated.collectionId?.trim();
          if (updatedCollectionId) {
            lastPlayedCollectionTrackRef.current.set(updatedCollectionId, { queue: updated.queue, track: updated });
          }
          activeTrackRef.current = updated;
          const savedDescriptor = savableTrackDescriptor(updated);
          setIsSavedToMyMusic(savedDescriptor ? savedStatusCacheRef.current.get(savedDescriptor.key) ?? false : false);
          if (didChangeTrack) setSoundcloudState((state) => ({ ...state, position: 0 }));
          setProgressResetTrackId((trackId) => trackId === current.id || trackId === updated.id ? null : trackId);
          setActiveTrack(updated);
        });
      });
      widget.bind(SC.Widget.Events.PAUSE, () => { if (isCurrent()) setSoundcloudState((state) => ({ ...state, playing: false })); });
      widget.bind(SC.Widget.Events.FINISH, () => {
        if (!isCurrent()) return;
        setSoundcloudState((state) => ({ ...state, playing: false, position: state.duration }));
        const track = activeTrackRef.current;
        if (track && ((track.queue && ((track.queueIndex ?? 0) < track.queue.length - 1 || shuffleEnabledRef.current || repeatEnabledRef.current)) || repeatEnabledRef.current)) {
          if (advancedFinishedTrackRef.current !== track.id) {
            advancedFinishedTrackRef.current = track.id;
            void playNextRef.current();
          }
        }
        else setPlaybackIntent(false);
      });
      widget.bind(SC.Widget.Events.PLAY_PROGRESS, (event: { currentPosition?: number }) => {
        if (!isCurrent()) return;
        const position = Math.max(0, Number(event.currentPosition ?? 0) / 1000);
        // iOS can emit PLAY even when WebKit has blocked the actual media. Only
        // advancing media time proves that audible playback really started.
        if (position >= 0.25) {
          clearSoundcloudDiagnosticTimer();
          setSoundcloudDiagnostic(null);
          setIsSoundcloudLoading(false);
          setPlaybackIntent(true);
        }
        setSoundcloudState((state) => ({ ...state, position }));
      });
      if (SC.Widget.Events.ERROR) widget.bind(SC.Widget.Events.ERROR, () => {
        const track = activeTrackRef.current;
        if (track?.provider === 'soundcloud') showSoundcloudDiagnostic('SC_WIDGET_ERROR', track, 'SoundCloud Widget прислал событие ERROR');
      });
    };
    const existing = document.querySelector('script[data-volna-soundcloud-widget]');
    if ((window as any).SC?.Widget) initialize();
    else if (existing) existing.addEventListener('load', initialize, { once: true });
    else {
      const script = document.createElement('script');
      script.src = 'https://w.soundcloud.com/player/api.js';
      script.async = true;
      script.dataset.volnaSoundcloudWidget = 'true';
      script.addEventListener('load', initialize, { once: true });
      document.head.appendChild(script);
    }
    return () => {
      disposed = true;
      soundcloudWidgetRef.current = null;
    };
  }, [armSoundcloudDiagnostic, clearSoundcloudDiagnosticTimer, hasSoundcloudFrame, showSoundcloudDiagnostic, startSoundcloudTrack]);

  const play = useCallback(async (track: GlobalTrack, fromSeconds?: number) => {
    if (isSoundcloudPlaylistTrack(track)) {
      const resolved = await resolveSoundcloudQueueTarget(track, track.queue ?? [track], 'next');
      return playRef.current({
        ...resolved.track,
        queue: resolved.queue.length > 1 ? resolved.queue : undefined,
        queueIndex: resolved.queueIndex >= 0 ? resolved.queueIndex : undefined,
        queueWindowResolver: track.queueWindowResolver,
      }, fromSeconds ?? resolved.track.startSeconds ?? 0);
    }
    if (track.provider === 'youtube') {
      const normalizedMetadata = normalizeYouTubeTrackMetadata(track.title, track.artist);
      if (normalizedMetadata.title !== track.title || normalizedMetadata.artist !== track.artist) {
        track = { ...track, title: normalizedMetadata.title, artist: normalizedMetadata.artist };
      }
    } else {
      const normalizedTitle = normalizeMusicTrackTitle(track.provider, track.title);
      if (normalizedTitle !== track.title) track = { ...track, title: normalizedTitle };
    }
    if (track.provider === 'bandcamp' && !track.previewUrl.includes('/music/bandcamp/stream')) {
      const bandcampTrackId = track.previewUrl.match(/(?:\/mp3-128\/|\/track=)(\d+)/)?.[1]
        ?? track.id.match(/(?:bandcamp:|track:.*\/mp3-128\/)(\d+)/)?.[1];
      const releaseUrl = track.collectionId || track.externalUrl;
      if (bandcampTrackId && releaseUrl) {
        const stablePreviewUrl = `${apiUrl}/music/bandcamp/stream?url=${encodeURIComponent(releaseUrl)}&trackId=${encodeURIComponent(bandcampTrackId)}`;
        track = {
          ...track,
          previewUrl: stablePreviewUrl,
          queue: track.queue?.map((item) => item.id === track.id ? { ...item, previewUrl: stablePreviewUrl } : item),
        };
      }
    }
    const playbackRequestId = playbackRequestRef.current + 1;
    playbackRequestRef.current = playbackRequestId;
    // Start the server-owned existence check without awaiting it. iOS WebKit
    // expires the tap's transient media permission across this network wait,
    // which made saved Bandcamp releases stop at 0:00 with no visible error.
    const availabilityPromise = resolveTrackAvailability(track);
    profilePreviewPlayers.forEach((pausePreview) => pausePreview());
    const previousTrack = activeTrackRef.current;
    const changed = previousTrack?.id !== track.id || previousTrack?.previewUrl !== track.previewUrl;
    const restoredMediaNeedsLoad = restoredMediaNeedsLoadRef.current;
    advancedFinishedTrackRef.current = null;
    if (changed) {
      transitioningTrackRef.current = track.id;
      if (progressResetTimerRef.current) clearTimeout(progressResetTimerRef.current);
      progressResetTimerRef.current = null;
      setProgressResetTrackId(track.id);
    }
    const restoredPosition = restoredPositionRef.current?.trackId === track.id ? restoredPositionRef.current.fromSeconds : null;
    restoredPositionRef.current = null;
    const requestedSeekTarget = track.isLiveStream ? null : fromSeconds ?? (changed ? restoredPosition ?? track.startSeconds ?? 0 : null);
    const seekTarget = requestedSeekTarget !== null && Number.isFinite(requestedSeekTarget) ? Math.max(0, requestedSeekTarget) : null;
    const savedDescriptor = savableTrackDescriptor(track);
    setIsSavedToMyMusic(savedDescriptor ? savedStatusCacheRef.current.get(savedDescriptor.key) ?? false : false);
    setIsSavedRadio(Boolean(track.isLiveStream && track.isRadioFavorite));
    activeTrackRef.current = track;
    setActiveTrack(track);
    void availabilityPromise.then(async (availability) => {
      if (playbackRequestId !== playbackRequestRef.current || activeTrackRef.current?.id !== track.id) return;
      if (!availability.available) {
        playbackRequestRef.current += 1;
        soundcloudWebAudioRef.current?.pause();
        uploadedWebAudioRef.current?.pause();
        player.pause();
        player.replace(null);
        activeTrackRef.current = null;
        sessionTrackRef.current = null;
        restoredPositionRef.current = null;
        setPlaybackIntent(false);
        setIsSoundcloudLoading(false);
        setExpanded(false);
        setActiveTrack(null);
        await AsyncStorage.removeItem(sessionStorageKey).catch(() => undefined);
        return;
      }
      if (!track.releaseId) return;
      const currentTrack = activeTrackRef.current;
      if (!currentTrack || currentTrack.id !== track.id) return;
      const refreshedTrack: GlobalTrack = {
        ...currentTrack,
        collectionTitle: availability.releaseTitle ?? currentTrack.collectionTitle,
        labelName: availability.labelName,
        labelUsername: availability.labelUsername,
        queue: currentTrack.queue?.map((item) => item.releaseId === track.releaseId
          ? {
              ...item,
              collectionTitle: availability.releaseTitle ?? item.collectionTitle,
              labelName: availability.labelName,
              labelUsername: availability.labelUsername,
            }
          : item),
      };
      activeTrackRef.current = refreshedTrack;
      setActiveTrack(refreshedTrack);
    }).catch(() => undefined);
    // Never hold media playback behind an API request. Safari/iOS grants the
    // SoundCloud iframe a very short user-activation window; awaiting the
    // saved-status request here made the eventual Widget.play() intermittent.
    if (savedDescriptor && !savedStatusCacheRef.current.has(savedDescriptor.key)) {
      void loadSavedStatuses([track])
        .then(() => {
          if (activeTrackRef.current?.id !== track.id) return;
          setIsSavedToMyMusic(savedStatusCacheRef.current.get(savedDescriptor.key) ?? false);
        })
        .catch(() => undefined);
    }
    const playedCollectionId = track.collectionId?.trim();
    if (playedCollectionId) {
      lastPlayedCollectionTrackRef.current.set(playedCollectionId, { queue: track.queue, track });
    }
    setPlaybackIntent(true);
    setIsSoundcloudLoading(true);
    setSoundcloudDiagnostic(null);
    if (!(Platform.OS === 'web' && track.provider === 'soundcloud')) soundcloudWebAudioRef.current?.pause();
    if (!(Platform.OS === 'web' && track.provider === 'volna')) uploadedWebAudioRef.current?.pause();
    if (track.provider !== 'youtube') youtubeEngineRef.current?.pause();
    if (track.provider === 'youtube') {
      player.pause();
      const videoId = youtubeVideoId(track);
      if (!videoId) {
        setPlaybackIntent(false);
        setIsSoundcloudLoading(false);
        throw new Error('Некорректная ссылка YouTube');
      }
      setIsSoundcloudLoading(true);
      if (changed || restoredMediaNeedsLoad) {
        youtubeEngineRef.current?.load(videoId, seekTarget ?? track.startSeconds ?? 0, true);
        restoredMediaNeedsLoadRef.current = false;
      }
      else {
        if (seekTarget !== null) youtubeEngineRef.current?.seek(seekTarget, true);
        else youtubeEngineRef.current?.play();
      }
      transitioningTrackRef.current = null;
      setProgressResetTrackId((trackId) => trackId === track.id ? null : trackId);
      return;
    }
    if (track.provider === 'soundcloud') {
      setIsSoundcloudLoading(true);
      const directStreamUrl = soundcloudDirectStreamUrl(track);
      if (!directStreamUrl) {
        setPlaybackIntent(false);
        setIsSoundcloudLoading(false);
        throw new Error('SoundCloud: не удалось определить адрес трека');
      }
      if (Platform.OS === 'web') {
        player.pause();
        const audio = soundcloudWebAudioRef.current;
        if (!audio) {
          setPlaybackIntent(false);
          setIsSoundcloudLoading(false);
          throw new Error('SoundCloud-аудиоплеер ещё не готов');
        }
        const currentSource = audio.getAttribute('src')?.trim() ?? '';
        audio.onloadedmetadata = () => {
          if (activeTrackRef.current?.id !== track.id) return;
          setSoundcloudWebState((state) => ({ ...state, duration: Number.isFinite(audio.duration) ? audio.duration : 0 }));
        };
        audio.ontimeupdate = () => {
          if (activeTrackRef.current?.id !== track.id) return;
          setSoundcloudWebState((state) => ({ ...state, position: Math.max(0, audio.currentTime) }));
        };
        audio.onwaiting = () => { if (activeTrackRef.current?.id === track.id) setIsSoundcloudLoading(true); };
        audio.onplaying = () => {
          if (activeTrackRef.current?.id !== track.id) return;
          transitioningTrackRef.current = null;
          setPlaybackIntent(true);
          setIsSoundcloudLoading(false);
        };
        audio.onended = () => {
          if (activeTrackRef.current?.id !== track.id) return;
          setSoundcloudWebState((state) => ({ ...state, position: state.duration }));
          if (repeatEnabledRef.current) {
            audio.currentTime = track.startSeconds ?? 0;
            void audio.play().catch(() => {
              setPlaybackIntent(false);
              setIsSoundcloudLoading(false);
            });
            return;
          }
          const current = activeTrackRef.current;
          const hasFollowingTrack = Boolean(current?.queue && (current.queueIndex ?? 0) < current.queue.length - 1);
          if (hasFollowingTrack || shuffleEnabledRef.current) void playNextRef.current();
          else setPlaybackIntent(false);
        };
        audio.onerror = () => {
          if (activeTrackRef.current?.id !== track.id) return;
          setPlaybackIntent(false);
          setIsSoundcloudLoading(false);
          Alert.alert('Плеер', 'Не удалось получить аудиопоток. Попробуйте ещё раз.');
        };
        const shouldLoadSource = restoredMediaNeedsLoad
          || !currentSource
          || currentSource !== directStreamUrl
          || Boolean(audio.error);
        if (shouldLoadSource) {
          audio.pause();
          audio.src = directStreamUrl;
          audio.load();
          restoredMediaNeedsLoadRef.current = false;
          setSoundcloudWebState({ duration: 0, position: 0 });
        } else {
          restoredMediaNeedsLoadRef.current = false;
          setSoundcloudWebState({
            duration: Number.isFinite(audio.duration) ? audio.duration : 0,
            position: Math.max(0, audio.currentTime),
          });
        }
        if (!changed && seekTarget !== null) audio.currentTime = seekTarget;
        try {
          try {
            await audio.play();
          } catch (error) {
            if (!isExpectedPlaybackRejection(error)) throw error;
            await waitForWebMediaReady(audio, 3_000);
            if (playbackRequestId !== playbackRequestRef.current || activeTrackRef.current?.id !== track.id) return;
            await audio.play();
          }
          if (playbackRequestId !== playbackRequestRef.current || activeTrackRef.current?.id !== track.id) return;
          transitioningTrackRef.current = null;
          if (changed && seekTarget !== null && seekTarget > 0) audio.currentTime = seekTarget;
          setProgressResetTrackId((trackId) => trackId === track.id ? null : trackId);
        } catch (error) {
          if (playbackRequestId !== playbackRequestRef.current || activeTrackRef.current?.id !== track.id) return;
          transitioningTrackRef.current = null;
          setPlaybackIntent(false);
          setIsSoundcloudLoading(false);
          if (!isExpectedPlaybackRejection(error)) {
            Alert.alert('Плеер', 'Не удалось запустить аудиопоток. Попробуйте ещё раз.');
          }
        }
        return;
      }
      if (changed || restoredMediaNeedsLoad) {
        player.replace(directStreamUrl);
        restoredMediaNeedsLoadRef.current = false;
      }
      try {
        if (!changed && seekTarget !== null) await player.seekTo(seekTarget);
        await playExpoAudio();
        if (playbackRequestId !== playbackRequestRef.current || activeTrackRef.current?.id !== track.id) return;
        transitioningTrackRef.current = null;
        // A newly replaced media source already starts at zero. On iOS Safari,
        // seeking it back to zero immediately after play() can abort the fresh
        // autoplay transition while still resolving the play promise.
        if (changed && seekTarget !== null && seekTarget > 0) await player.seekTo(seekTarget);
        setProgressResetTrackId((trackId) => trackId === track.id ? null : trackId);
      } catch {
        if (playbackRequestId !== playbackRequestRef.current || activeTrackRef.current?.id !== track.id) return;
        transitioningTrackRef.current = null;
        setPlaybackIntent(false);
        setIsSoundcloudLoading(false);
        Alert.alert('SoundCloud', 'Не удалось получить аудиопоток. Попробуйте ещё раз.');
      }
      return;
    }
    soundcloudPlayRequestRef.current += 1;
    pendingSoundcloudPlayRef.current = null;
    if (soundcloudStartTimerRef.current) clearTimeout(soundcloudStartTimerRef.current);
    soundcloudStartTimerRef.current = null;
    soundcloudWidgetRef.current?.pause?.();
    if (Platform.OS === 'web' && track.provider === 'volna') {
      player.pause();
      const audio = uploadedWebAudioRef.current;
      if (!audio) {
        setPlaybackIntent(false);
        setIsSoundcloudLoading(false);
        throw new Error('Аудиоплеер ещё не готов');
      }
      // Restoring a persisted session restores the React track state, but the
      // browser's detached <audio> element starts empty after every page load.
      // In that case `changed` is false when the user presses play on the
      // restored mini-player, so the old code called play() without assigning
      // a source and left live radio in an endless loading state.
      const currentSource = audio.getAttribute('src')?.trim() ?? '';
      const shouldLoadSource = changed || restoredMediaNeedsLoad || !currentSource || Boolean(audio.error);
      if (shouldLoadSource) {
        audio.pause();
        audio.onloadedmetadata = () => {
          setUploadedWebState((state) => ({ ...state, duration: track.isLiveStream ? 0 : Number.isFinite(audio.duration) ? audio.duration : track.clipDurationSeconds ?? 0 }));
          if (track.isLiveStream && activeTrackRef.current?.id === track.id) setIsSoundcloudLoading(false);
        };
        audio.oncanplay = () => {
          if (track.isLiveStream && activeTrackRef.current?.id === track.id) setIsSoundcloudLoading(false);
        };
        audio.ontimeupdate = () => setUploadedWebState((state) => ({ ...state, position: Math.max(0, audio.currentTime) }));
        audio.onwaiting = () => { if (activeTrackRef.current?.id === track.id) setIsSoundcloudLoading(true); };
        audio.onplaying = () => {
          if (activeTrackRef.current?.id !== track.id) return;
          setPlaybackIntent(true);
          setIsSoundcloudLoading(false);
        };
        audio.onended = () => {
          if (activeTrackRef.current?.id !== track.id) return;
          setUploadedWebState((state) => ({ ...state, position: state.duration }));
          if (repeatEnabledRef.current) {
            audio.currentTime = track.startSeconds ?? 0;
            void audio.play().catch(() => {
              setPlaybackIntent(false);
              setIsSoundcloudLoading(false);
            });
            return;
          }
          const current = activeTrackRef.current;
          const hasFollowingTrack = Boolean(current?.queue && (current.queueIndex ?? 0) < current.queue.length - 1);
          if (hasFollowingTrack || shuffleEnabledRef.current) void playNextRef.current();
          else setPlaybackIntent(false);
        };
        audio.onerror = () => {
          if (activeTrackRef.current?.id !== track.id) return;
          setPlaybackIntent(false);
          setIsSoundcloudLoading(false);
          Alert.alert('Плеер', track.isLiveStream ? 'Не удалось получить аудиопоток радиостанции' : 'Браузер не смог загрузить этот аудиофайл');
        };
        audio.src = track.previewUrl;
        audio.load();
        restoredMediaNeedsLoadRef.current = false;
        setUploadedWebState({ duration: track.clipDurationSeconds ?? 0, position: 0 });
      }
      if (seekTarget !== null && seekTarget > 0) audio.currentTime = seekTarget;
      try {
        const playback = audio.play();
        if (track.isLiveStream) {
          void playback.catch(() => undefined);
          await waitForLiveWebMediaStart(audio);
        } else {
          await playback;
        }
        if (playbackRequestId !== playbackRequestRef.current || activeTrackRef.current?.id !== track.id) return;
        transitioningTrackRef.current = null;
        setIsSoundcloudLoading(false);
        setProgressResetTrackId((trackId) => trackId === track.id ? null : trackId);
      } catch (error) {
        if (playbackRequestId !== playbackRequestRef.current || activeTrackRef.current?.id !== track.id) return;
        transitioningTrackRef.current = null;
        setPlaybackIntent(false);
        setIsSoundcloudLoading(false);
        if (!isExpectedPlaybackRejection(error)) {
          Alert.alert(
            'Плеер',
            error instanceof Error
              ? error.message
              : track.isLiveStream
                ? 'Не удалось запустить радиостанцию'
                : 'Браузер не смог запустить этот аудиофайл',
          );
        }
      }
      return;
    }
    uploadedWebAudioRef.current?.pause();
    const persistentWebMedia = Platform.OS === 'web'
      ? (player as unknown as { media?: HTMLAudioElement }).media
      : undefined;
    if (changed || restoredMediaNeedsLoad) {
      if (persistentWebMedia) {
        // expo-audio recreates its HTMLAudioElement inside replace(). iOS
        // authorizes the existing element, not every future replacement, so a
        // later Bandcamp track can load successfully and still be denied play.
        // Keep the authorized element and replace only its source.
        player.pause();
        persistentWebMedia.src = track.previewUrl;
        persistentWebMedia.load();
      } else {
        player.replace(track.previewUrl);
      }
      restoredMediaNeedsLoadRef.current = false;
    }
    try {
      if (!changed && seekTarget !== null) await player.seekTo(seekTarget);
      try {
        await playExpoAudio();
      } catch (error) {
        const name = error && typeof error === 'object' && 'name' in error ? String((error as { name?: unknown }).name ?? '') : '';
        if (Platform.OS !== 'web' || name !== 'AbortError' || playbackRequestId !== playbackRequestRef.current || activeTrackRef.current?.id !== track.id) throw error;
        const media = persistentWebMedia ?? (player as unknown as { media?: HTMLAudioElement }).media;
        if (!media) throw error;
        await waitForWebMediaReady(media);
        if (playbackRequestId !== playbackRequestRef.current || activeTrackRef.current?.id !== track.id) return;
        await media.play();
      }
      if (playbackRequestId !== playbackRequestRef.current || activeTrackRef.current?.id !== track.id) return;
      transitioningTrackRef.current = null;
      if (Platform.OS === 'web') setIsSoundcloudLoading(false);
      if (changed && seekTarget !== null && !track.isLiveStream) await player.seekTo(seekTarget);
      if (progressResetTimerRef.current) clearTimeout(progressResetTimerRef.current);
      progressResetTimerRef.current = setTimeout(() => {
        setProgressResetTrackId((trackId) => trackId === track.id ? null : trackId);
        progressResetTimerRef.current = null;
      }, 300);
    } catch (error) {
      if (playbackRequestId !== playbackRequestRef.current || activeTrackRef.current?.id !== track.id) return;
      transitioningTrackRef.current = null;
      setPlaybackIntent(false);
      setIsSoundcloudLoading(false);
      if (!isExpectedPlaybackRejection(error)) Alert.alert('Плеер', 'Не удалось запустить воспроизведение');
    }
  }, [armSoundcloudDiagnostic, loadSavedStatuses, playExpoAudio, player, resolveSoundcloudQueueTarget, resolveTrackAvailability, sessionStorageKey, startSoundcloudTrack]);
  playRef.current = play;

  useEffect(() => {
    const queue = activeTrack?.queue;
    const currentIndex = activeTrack?.queueIndex ?? -1;
    if (!queue?.length || currentIndex < 0) return;
    const previousIndex = currentIndex - 1 >= 0
      ? currentIndex - 1
      : isRepeatEnabled ? queue.length - 1 : -1;
    const nextIndex = currentIndex + 1 < queue.length
      ? currentIndex + 1
      : isRepeatEnabled ? 0 : -1;
    const previousTrack = previousIndex >= 0 ? queue[previousIndex] : null;
    const nextTrack = nextIndex >= 0 ? queue[nextIndex] : null;
    // Prime previous first so the more likely forward transition remains the
    // source held by the single web preloader when both neighbours differ.
    if (previousTrack && previousTrack.id !== activeTrack?.id) primeQueueNeighbor(previousTrack, 'previous');
    if (nextTrack && nextTrack.id !== activeTrack?.id) primeQueueNeighbor(nextTrack, 'next');
  }, [activeTrack, isRepeatEnabled, primeQueueNeighbor]);

  useEffect(() => {
    const queue = activeTrack?.queue;
    if (!queue?.length) return;
    const artworkUrls = followingCollectionIndexesForTrack(activeTrack, 2)
      .map((index) => {
        const item = queue[index];
        return item ? expandedPlayerArtwork(item.artworkUrl, item.provider) : null;
      })
      .filter((value): value is string => Boolean(value));
    for (const artworkUrl of new Set(artworkUrls)) {
      void Image.prefetch(artworkUrl).catch(() => undefined);
    }
  }, [activeTrack?.id, activeTrack?.queue, activeTrack?.queueIndex]);

  const pause = useCallback(() => {
    playbackRequestRef.current += 1;
    transitioningTrackRef.current = null;
    setPlaybackIntent(false);
    setIsSoundcloudLoading(false);
    if (Platform.OS === 'web' && activeTrackRef.current?.provider === 'soundcloud') {
      soundcloudWebAudioRef.current?.pause();
      return;
    }
    if (Platform.OS === 'web' && activeTrackRef.current?.provider === 'volna') {
      uploadedWebAudioRef.current?.pause();
      return;
    }
    if (activeTrackRef.current?.provider === 'youtube') {
      youtubeEngineRef.current?.pause();
      return;
    }
    player.pause();
  }, [clearSoundcloudDiagnosticTimer, player]);

  const close = useCallback(() => {
    clearSoundcloudDiagnosticTimer();
    playbackRequestRef.current += 1;
    transitioningTrackRef.current = null;
    soundcloudPlayRequestRef.current += 1;
    setPlaybackIntent(false);
    setIsSoundcloudLoading(false);
    soundcloudWidgetRef.current?.pause?.();
    const soundcloudAudio = soundcloudWebAudioRef.current;
    if (soundcloudAudio) {
      soundcloudAudio.pause();
      soundcloudAudio.removeAttribute('src');
      soundcloudAudio.load();
    }
    setSoundcloudWebState({ duration: 0, position: 0 });
    if (soundcloudDelayedPlayTimerRef.current) clearTimeout(soundcloudDelayedPlayTimerRef.current);
    const uploadedAudio = uploadedWebAudioRef.current;
    if (uploadedAudio) {
      uploadedAudio.pause();
      uploadedAudio.removeAttribute('src');
      uploadedAudio.load();
    }
    setUploadedWebState({ duration: 0, position: 0 });
    youtubeEngineRef.current?.stop();
    setYoutubeState({ duration: 0, loading: false, playing: false, position: 0 });
    pendingSoundcloudPlayRef.current = null;
    if (soundcloudStartTimerRef.current) clearTimeout(soundcloudStartTimerRef.current);
    soundcloudStartTimerRef.current = null;
    soundcloudConfirmedTrackRef.current = null;
    setSoundcloudState({ duration: 0, playing: false, position: 0, trackCount: 0, trackIndex: 0 });
    player.pause();
    player.replace(null);
    activeTrackRef.current = null;
    sessionTrackRef.current = null;
    restoredMediaNeedsLoadRef.current = false;
    restoredPositionRef.current = null;
    setExpanded(false);
    setActiveTrack(null);
  }, [clearSoundcloudDiagnosticTimer, player]);

  persistSessionRef.current = async () => {
    try {
      if (!isSessionRestored) return;
      const track = sessionTrackRef.current;
      if (!track) {
        await AsyncStorage.removeItem(sessionStorageKey);
        return;
      }
      const session: PersistedAudioSession = {
        version: 1,
        track: serializableTrack(track),
        positionSeconds: Math.max(0, mediaPositionRef.current),
        isExpanded,
        isShuffleEnabled: shuffleEnabledRef.current,
        isRepeatEnabled: repeatEnabledRef.current,
        shuffleQueue: shuffleQueueRef.current,
      };
      await AsyncStorage.setItem(sessionStorageKey, JSON.stringify(session));
    } catch {
      // Playback must remain usable when device storage is temporarily unavailable.
    }
  };

  useEffect(() => {
    if (!isSessionRestored) return;
    void persistSessionRef.current();
    if (!activeTrack) return;
    const interval = setInterval(() => { void persistSessionRef.current(); }, 1500);
    return () => clearInterval(interval);
  }, [activeTrack?.id, activeTrack?.previewUrl, isExpanded, isRepeatEnabled, isSessionRestored, isShuffleEnabled, sessionStorageKey]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') void persistSessionRef.current();
    });
    if (Platform.OS !== 'web' || typeof window === 'undefined') return () => subscription.remove();
    const persistBeforeExit = () => { void persistSessionRef.current(); };
    window.addEventListener('pagehide', persistBeforeExit);
    return () => {
      subscription.remove();
      window.removeEventListener('pagehide', persistBeforeExit);
    };
  }, []);

  const seek = useCallback(async (nextProgress: number) => {
    const track = activeTrackRef.current;
    if (!track || track.isLiveStream || !Number.isFinite(nextProgress)) return;
    if (Platform.OS === 'web' && track.provider === 'soundcloud') {
      const audio = soundcloudWebAudioRef.current;
      const duration = soundcloudWebState.duration || audio?.duration || 0;
      if (!audio || !Number.isFinite(duration) || duration <= 0) return;
      const target = Math.min(1, Math.max(0, nextProgress)) * duration;
      audio.currentTime = target;
      setSoundcloudWebState((state) => ({ ...state, position: target }));
      return;
    }
    if (Platform.OS === 'web' && track.provider === 'volna') {
      const audio = uploadedWebAudioRef.current;
      const duration = uploadedWebState.duration || audio?.duration || track.clipDurationSeconds || 0;
      if (!audio || !Number.isFinite(duration) || duration <= 0) return;
      const target = Math.min(1, Math.max(0, nextProgress)) * duration;
      audio.currentTime = target;
      setUploadedWebState((state) => ({ ...state, position: target }));
      return;
    }
    if (track.provider === 'youtube') {
      const start = track.startSeconds ?? 0;
      const duration = track.clipDurationSeconds ?? Math.max(0, youtubeState.duration - start);
      if (!Number.isFinite(duration) || duration <= 0) return;
      const target = start + Math.min(1, Math.max(0, nextProgress)) * duration;
      youtubeEngineRef.current?.seek(target, youtubeState.playing);
      setYoutubeState((state) => ({ ...state, position: target }));
      return;
    }
    const start = track.startSeconds ?? 0;
    const duration = track.provider === 'soundcloud'
      ? Math.max(0, Number(player.duration ?? 0) - start)
      : track.clipDurationSeconds ?? Math.max(0, Number(player.duration ?? 0) - start);
    if (!Number.isFinite(start) || !Number.isFinite(duration) || duration <= 0) return;
    const target = start + Math.min(1, Math.max(0, nextProgress)) * duration;
    if (!Number.isFinite(target)) return;
    await player.seekTo(target);
  }, [player, soundcloudWebState.duration, uploadedWebState.duration, youtubeState.duration, youtubeState.playing]);

  const shuffledQueueState = isShuffleEnabled && activeTrack?.queue?.length
    ? ensureShuffleQueueState(shuffleQueueRef.current, activeTrack.queue.map((item) => item.id), activeTrack.id)
    : null;
  const hasShuffledPrevious = Boolean(shuffledQueueState && shuffledQueueState.position > 0);
  const hasShuffledNext = Boolean(shuffledQueueState && (
    shuffledQueueState.position < shuffledQueueState.history.length - 1
    || shuffledQueueState.remaining.length > 0
    || (isRepeatEnabled && activeTrack?.queue && activeTrack.queue.length > 1)
  ));
  const currentActiveQueueIndex = activeQueueIndex(activeTrack);
  const hasPreviousTrack = isShuffleEnabled
    ? hasShuffledPrevious
    : usesSoundcloud
      ? (soundcloudState.trackCount > 1 && soundcloudState.trackIndex > 0) || Boolean(activeTrack?.queue && (currentActiveQueueIndex > 0 || isRepeatEnabled)) || isRepeatEnabled
      : Boolean(activeTrack?.queue && (currentActiveQueueIndex > 0 || isRepeatEnabled)) || Boolean(activeTrack && isRepeatEnabled);
  const hasNextTrack = isShuffleEnabled
    ? hasShuffledNext
    : usesSoundcloud
      ? (soundcloudState.trackCount > 1 && soundcloudState.trackIndex < soundcloudState.trackCount - 1) || Boolean(activeTrack?.queue && (currentActiveQueueIndex >= 0 && (currentActiveQueueIndex < activeTrack.queue.length - 1 || isRepeatEnabled))) || isRepeatEnabled
      : Boolean(activeTrack?.queue && (currentActiveQueueIndex >= 0 && (currentActiveQueueIndex < activeTrack.queue.length - 1 || isRepeatEnabled))) || Boolean(activeTrack && isRepeatEnabled);

  const adjacentCollectionIndexes = useMemo(
    () => adjacentCollectionIndexesForTrack(activeTrack),
    [activeTrack?.id, activeTrack?.previewUrl, activeTrack?.queue, activeTrack?.queueIndex],
  );
  const hasPreviousCollection = adjacentCollectionIndexes.previous >= 0;
  const hasNextCollection = adjacentCollectionIndexes.next >= 0;
  const previousCollectionTrack = hasPreviousCollection ? activeTrack?.queue?.[adjacentCollectionIndexes.previous] ?? null : null;
  const nextCollectionTrack = hasNextCollection ? activeTrack?.queue?.[adjacentCollectionIndexes.next] ?? null : null;
  const previousCollectionArtworkUrl = previousCollectionTrack?.artworkUrl ?? null;
  const nextCollectionArtworkUrl = nextCollectionTrack?.artworkUrl ?? null;

  const playPrevious = useCallback(async () => {
    const track = activeTrackRef.current;
    if (!track) return;
    const queue = track.queue;
    const currentIndex = activeQueueIndex(track);
    // A screen-owned queue is authoritative. The SoundCloud widget can retain
    // stale playlist length/index data after widget.load(), so consulting its
    // internal queue here may repeat the current track instead of moving to the
    // adjacent item in the profile/community queue.
    if (track.provider === 'soundcloud' && !shuffleEnabledRef.current && !queue?.length) {
      if (soundcloudState.trackIndex > 0) {
        soundcloudWidgetRef.current?.prev?.();
        setTimeout(() => soundcloudWidgetRef.current?.play?.(), 80);
        return;
      }
    }
    if (!queue?.length) {
      if (repeatEnabledRef.current) await play(track, track.startSeconds ?? 0);
      return;
    }
    let index: number;
    if (shuffleEnabledRef.current && queue.length > 1) {
      const result = takePreviousShuffledTrack(
        shuffleQueueRef.current ?? createShuffleQueueState(queue.map((item) => item.id), track.id),
        queue.map((item) => item.id),
        track.id,
      );
      shuffleQueueRef.current = result.state;
      index = result.id ? queue.findIndex((item) => item.id === result.id) : -1;
    } else {
      index = currentIndex > 0 ? currentIndex - 1 : repeatEnabledRef.current ? queue.length - 1 : -1;
    }
    const previous = queue?.[index];
    if (previous) {
      const currentCollectionId = track.collectionId?.trim()
        || (track.provider === 'soundcloud' && track.externalUrl?.includes('/sets/') ? track.externalUrl.trim() : '');
      const previousCollectionId = previous.collectionId?.trim()
        || (previous.provider === 'soundcloud' && previous.externalUrl?.includes('/sets/') ? previous.externalUrl.trim() : '');
      // Restore the last played item only when crossing back into another
      // collection. Inside the same playlist, the adjacent queue item must win.
      const remembered = previousCollectionId && previousCollectionId !== currentCollectionId
        ? lastPlayedCollectionTrackRef.current.get(previousCollectionId)
        : undefined;
      const rememberedQueue = remembered?.queue;
      // Moving backwards across a collection boundary must enter that
      // collection from its end. A profile-level queue can contain only the
      // playlist placeholder at this point, while the remembered expanded
      // queue contains its actual tracks.
      const lastTrackInPreviousCollection = previousCollectionId && previousCollectionId !== currentCollectionId
        ? rememberedQueue?.findLast((item) => item.collectionId?.trim() === previousCollectionId)
        : undefined;
      const previousTrack = lastTrackInPreviousCollection ?? remembered?.track ?? previous;
      const staysInsideCollection = trackCollectionKey(previousTrack) === trackCollectionKey(track);
      const resolvedQueue = rememberedQueue
        ?? (staysInsideCollection ? queue : track.queueWindowResolver?.(previousTrack) ?? queue);
      const resolvedTarget = await resolveSoundcloudQueueTarget(previousTrack, resolvedQueue, 'previous');
      await play({
        ...resolvedTarget.track,
        queue: resolvedTarget.queue,
        queueIndex: resolvedTarget.queueIndex >= 0 ? resolvedTarget.queueIndex : index,
        queueWindowResolver: track.queueWindowResolver,
      }, resolvedTarget.track.startSeconds ?? 0);
    }
  }, [play, resolveSoundcloudQueueTarget, soundcloudState.trackIndex]);

  const playNext = useCallback(async () => {
    const track = activeTrackRef.current;
    if (!track) return;
    const queue = track.queue;
    const currentIndex = activeQueueIndex(track);
    if (track.provider === 'soundcloud' && !shuffleEnabledRef.current && !queue?.length) {
      if (soundcloudState.trackIndex < soundcloudState.trackCount - 1) {
        soundcloudWidgetRef.current?.next?.();
        setTimeout(() => soundcloudWidgetRef.current?.play?.(), 80);
        return;
      }
    }
    if (!queue?.length) {
      if (repeatEnabledRef.current) await play(track, track.startSeconds ?? 0);
      return;
    }
    let index: number;
    if (shuffleEnabledRef.current && queue.length > 1) {
      const result = takeNextShuffledTrack(
        shuffleQueueRef.current ?? createShuffleQueueState(queue.map((item) => item.id), track.id),
        queue.map((item) => item.id),
        track.id,
        repeatEnabledRef.current,
      );
      shuffleQueueRef.current = result.state;
      index = result.id ? queue.findIndex((item) => item.id === result.id) : -1;
    } else {
      index = currentIndex < queue.length - 1 ? currentIndex + 1 : repeatEnabledRef.current ? 0 : -1;
    }
    const next = queue?.[index];
    if (next) {
      const staysInsideCollection = trackCollectionKey(next) === trackCollectionKey(track);
      const resolvedQueue = staysInsideCollection ? queue : track.queueWindowResolver?.(next) ?? queue;
      const resolvedTarget = await resolveSoundcloudQueueTarget(next, resolvedQueue, 'next');
      await play({
        ...resolvedTarget.track,
        queue: resolvedTarget.queue,
        queueIndex: resolvedTarget.queueIndex >= 0 ? resolvedTarget.queueIndex : index,
        queueWindowResolver: track.queueWindowResolver,
      }, resolvedTarget.track.startSeconds ?? 0);
    }
  }, [play, resolveSoundcloudQueueTarget, soundcloudState.trackCount, soundcloudState.trackIndex]);
  playNextRef.current = playNext;

  const playPreviousCollection = useCallback(async () => {
    const track = activeTrackRef.current;
    const queue = track?.queue;
    const index = adjacentCollectionIndexes.previous;
    const previous = index >= 0 ? queue?.[index] : null;
    if (previous && queue) {
      const resolvedQueue = track?.queueWindowResolver?.(previous) ?? queue;
      const resolvedTarget = await resolveSoundcloudQueueTarget(previous, resolvedQueue, 'previous');
      await play({
        ...resolvedTarget.track,
        queue: resolvedTarget.queue,
        queueIndex: resolvedTarget.queueIndex >= 0 ? resolvedTarget.queueIndex : index,
        queueWindowResolver: track?.queueWindowResolver,
      }, resolvedTarget.track.startSeconds ?? 0);
    }
  }, [adjacentCollectionIndexes.previous, play, resolveSoundcloudQueueTarget]);

  const playNextCollection = useCallback(async () => {
    const track = activeTrackRef.current;
    const queue = track?.queue;
    const index = adjacentCollectionIndexes.next;
    const next = index >= 0 ? queue?.[index] : null;
    if (next && queue) {
      const resolvedQueue = track?.queueWindowResolver?.(next) ?? queue;
      const resolvedTarget = await resolveSoundcloudQueueTarget(next, resolvedQueue, 'next');
      await play({
        ...resolvedTarget.track,
        queue: resolvedTarget.queue,
        queueIndex: resolvedTarget.queueIndex >= 0 ? resolvedTarget.queueIndex : index,
        queueWindowResolver: track?.queueWindowResolver,
      }, resolvedTarget.track.startSeconds ?? 0);
    }
  }, [adjacentCollectionIndexes.next, play, resolveSoundcloudQueueTarget]);

  const setActiveQueue = useCallback((queue: GlobalTrackQueueItem[], queueWindowResolver?: GlobalTrack['queueWindowResolver']) => {
    const track = activeTrackRef.current;
    if (!track) return;
    const queueIndex = queue.findIndex((item) => item.id === track.id);
    if (queueIndex < 0) return;
    const currentIds = track.queue?.map((item) => item.id).join('\n') ?? '';
    const nextIds = queue.map((item) => item.id).join('\n');
    const nextResolver = queueWindowResolver ?? track.queueWindowResolver;
    if (currentIds === nextIds && track.queueIndex === queueIndex && track.queueWindowResolver === nextResolver) return;
    const updated = { ...track, queue, queueIndex, queueWindowResolver: nextResolver };
    activeTrackRef.current = updated;
    setActiveTrack(updated);
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const session = navigator.mediaSession;
    if (!activeTrack) {
      session.metadata = null;
      return;
    }
    const providerName = activeTrack.provider === 'bandcamp'
      ? 'Bandcamp'
      : activeTrack.provider === 'soundcloud'
        ? 'SoundCloud'
        : activeTrack.provider === 'apple'
          ? 'Apple Music'
          : activeTrack.provider === 'yandex'
            ? 'Яндекс Музыка'
            : 'VOLNA';
    if (typeof MediaMetadata !== 'undefined') {
      session.metadata = new MediaMetadata({
        title: activeTrack.title,
        artist: activeTrack.artist || 'Неизвестный исполнитель',
        album: providerName,
        artwork: activeTrack.artworkUrl ? [{ src: activeTrack.artworkUrl }] : [],
      });
    }
  }, [activeTrack]);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const session = navigator.mediaSession;
    const setHandler = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      try { session.setActionHandler(action, handler); } catch { /* Safari supports only part of the action catalog. */ }
    };
    setHandler('play', () => {
      const current = activeTrackRef.current;
      if (current) void playRef.current(current).catch(() => undefined);
    });
    setHandler('pause', pause);
    setHandler('seekbackward', activeTrack?.isLiveStream ? null : (details) => {
      const duration = mediaDurationRef.current;
      if (duration <= 0) return;
      void seek(Math.max(0, mediaPositionRef.current - (details.seekOffset ?? 10)) / duration);
    });
    setHandler('seekforward', activeTrack?.isLiveStream ? null : (details) => {
      const duration = mediaDurationRef.current;
      if (duration <= 0) return;
      void seek(Math.min(duration, mediaPositionRef.current + (details.seekOffset ?? 10)) / duration);
    });
    setHandler('seekto', activeTrack?.isLiveStream ? null : (details) => {
      const duration = mediaDurationRef.current;
      if (duration <= 0 || details.seekTime === undefined) return;
      void seek(Math.min(duration, Math.max(0, details.seekTime)) / duration);
    });
    setHandler('previoustrack', hasPreviousTrack ? () => { void playPrevious(); } : null);
    setHandler('nexttrack', hasNextTrack ? () => { void playNext(); } : null);
    return () => {
      (['play', 'pause', 'seekbackward', 'seekforward', 'seekto', 'previoustrack', 'nexttrack'] as MediaSessionAction[])
        .forEach((action) => setHandler(action, null));
    };
  }, [activeTrack, hasNextTrack, hasPreviousTrack, pause, playNext, playPrevious, seek]);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const session = navigator.mediaSession;
    session.playbackState = activeTrack ? (isPlaying ? 'playing' : 'paused') : 'none';
    if (!activeTrack || activeTrack.isLiveStream || trackDuration <= 0 || typeof session.setPositionState !== 'function') return;
    try {
      session.setPositionState({
        duration: trackDuration,
        playbackRate: 1,
        position: Math.min(trackDuration, Math.max(0, positionSeconds)),
      });
    } catch { /* Metadata and controls still work when Safari rejects a transient position. */ }
  }, [activeTrack, isPlaying, positionSeconds, trackDuration]);

  useEffect(() => {
    const requestId = ++savedStatusRequestRef.current;
    if (!activeTrack) {
      setIsSavedToMyMusic(false);
      return;
    }
    const activeDescriptor = savableTrackDescriptor(activeTrack);
    if (activeDescriptor && savedStatusCacheRef.current.has(activeDescriptor.key)) {
      setIsSavedToMyMusic(savedStatusCacheRef.current.get(activeDescriptor.key) ?? false);
    }
    const queue = activeTrack.queue ?? [activeTrack];
    const index = Math.max(0, Math.min(queue.length - 1, activeTrack.queueIndex ?? queue.findIndex((track) => track.id === activeTrack.id)));
    const window = queue.slice(Math.max(0, index - 2), Math.min(queue.length, index + 3));
    void loadSavedStatuses(window.length ? window : [activeTrack])
      .then(() => {
        if (savedStatusRequestRef.current !== requestId) return;
        const currentDescriptor = savableTrackDescriptor(activeTrackRef.current);
        setIsSavedToMyMusic(currentDescriptor ? savedStatusCacheRef.current.get(currentDescriptor.key) ?? false : false);
      })
      .catch(() => undefined);
  }, [activeTrack, loadSavedStatuses]);

  useEffect(() => {
    setIsSavedRadio(Boolean(activeTrack?.isLiveStream && activeTrack.isRadioFavorite));
  }, [activeTrack?.id, activeTrack?.isLiveStream, activeTrack?.isRadioFavorite]);

  const toggleMyMusic = useCallback(async () => {
    if (!saveProvider || !saveTrackUrl || !saveTrackKey || isSavingToMyMusic) return;
    const wasSaved = isSavedToMyMusic;
    const nextSaved = !wasSaved;
    savedStatusMutationVersionRef.current.set(saveTrackKey, (savedStatusMutationVersionRef.current.get(saveTrackKey) ?? 0) + 1);
    savedStatusRequestRef.current += 1;
    savedStatusCacheRef.current.set(saveTrackKey, nextSaved);
    setIsSavedToMyMusic(nextSaved);
    setIsSavingToMyMusic(true);
    try {
      const response = wasSaved
        ? await apiFetch(`${apiUrl}/my-music/external-track?provider=${encodeURIComponent(saveProvider)}&externalUrl=${encodeURIComponent(saveTrackUrl)}`, { method: 'DELETE' })
        : await apiFetch(`${apiUrl}/my-music/external-track`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            provider: saveProvider,
            externalUrl: saveTrackUrl,
            releaseId: activeTrackRef.current?.releaseId,
            sourceTrackId: savableSourceTrackId(activeTrackRef.current),
          }),
      });
      if (!response.ok) throw new Error(await readApiError(response, wasSaved ? 'Не удалось удалить трек' : 'Не удалось добавить трек'));
      const result = await response.json() as { track?: ProfileMusicTrack };
      onNotify(wasSaved ? 'Трек удалён из коллекции' : 'Трек добавлен в коллекцию', 'success');
      emitMusicLibraryChanged(result.track
        ? { type: wasSaved ? 'collection-track-removed' : 'collection-track-added', track: result.track }
        : { type: 'refresh' });
    } catch (error) {
      savedStatusCacheRef.current.set(saveTrackKey, wasSaved);
      if (savableTrackDescriptor(activeTrackRef.current)?.key === saveTrackKey) setIsSavedToMyMusic(wasSaved);
      onNotify(error instanceof Error ? error.message : 'Не удалось изменить трек', 'error');
    } finally {
      setIsSavingToMyMusic(false);
    }
  }, [isSavedToMyMusic, isSavingToMyMusic, onNotify, saveProvider, saveTrackKey, saveTrackUrl]);

  const toggleFavoriteRadio = useCallback(async () => {
    const track = activeTrackRef.current;
    const username = track?.radioPageUsername?.trim();
    if (!track?.isLiveStream || !username || isSavingRadio) return;
    const wasSaved = isSavedRadio;
    const nextSaved = !wasSaved;
    setIsSavedRadio(nextSaved);
    setIsSavingRadio(true);
    const updatedTrack = { ...track, isRadioFavorite: nextSaved };
    activeTrackRef.current = updatedTrack;
    sessionTrackRef.current = updatedTrack;
    setActiveTrack(updatedTrack);
    try {
      const response = await apiFetch(`${apiUrl}/public-pages/${encodeURIComponent(username)}/favorite`, { method: wasSaved ? 'DELETE' : 'POST' });
      if (!response.ok) throw new Error(await readApiError(response, wasSaved ? 'Не удалось удалить радиостанцию' : 'Не удалось добавить радиостанцию'));
      emitMusicLibraryChanged();
      onNotify(wasSaved ? 'Радиостанция удалена из избранного' : 'Радиостанция добавлена в избранное');
    } catch (error) {
      setIsSavedRadio(wasSaved);
      const current = activeTrackRef.current;
      if (current?.id === track.id) {
        const restoredTrack = { ...current, isRadioFavorite: wasSaved };
        activeTrackRef.current = restoredTrack;
        sessionTrackRef.current = restoredTrack;
        setActiveTrack(restoredTrack);
      }
      onNotify(error instanceof Error ? error.message : 'Не удалось изменить избранные радиостанции', 'error');
    } finally {
      setIsSavingRadio(false);
    }
  }, [isSavedRadio, isSavingRadio, onNotify]);

  const selectOutputDevice = useCallback(async () => {
    if (Platform.OS !== 'web' || typeof navigator === 'undefined') {
      Alert.alert('Устройство воспроизведения', 'Выберите устройство вывода в системных настройках звука.');
      return;
    }
    const media = usesUploadedWebAudio
      ? uploadedWebAudioRef.current
      : activeTrackRef.current?.provider === 'soundcloud'
        ? soundcloudWebAudioRef.current
        : (player as unknown as { media?: HTMLAudioElement }).media;
    try {
      const airplayMedia = media as (HTMLAudioElement & { webkitShowPlaybackTargetPicker?: () => void }) | null | undefined;
      if (airplayMedia?.webkitShowPlaybackTargetPicker) {
        // Safari exposes AirPlay only for the media element that owns playback.
        // expo-audio creates it detached from the DOM, so opt it in explicitly.
        airplayMedia.setAttribute('x-webkit-airplay', 'allow');
        airplayMedia.setAttribute('playsinline', '');
        if (!airplayMedia.isConnected) {
          airplayMedia.dataset.volnaPlaybackTarget = 'true';
          airplayMedia.style.cssText = 'position:fixed;width:1px;height:1px;left:-10000px;bottom:0;opacity:0;pointer-events:none';
          document.body.appendChild(airplayMedia);
        }
        airplayMedia.webkitShowPlaybackTargetPicker();
        return;
      }
      const mediaDevices = navigator.mediaDevices as MediaDevices & { selectAudioOutput?: () => Promise<MediaDeviceInfo> };
      if (mediaDevices?.selectAudioOutput) {
        const device = await mediaDevices.selectAudioOutput();
        const sinkMedia = media as (HTMLAudioElement & { setSinkId?: (sinkId: string) => Promise<void> }) | null | undefined;
        if (device.deviceId && sinkMedia?.setSinkId) await sinkMedia.setSinkId(device.deviceId);
        return;
      }
      Alert.alert(
        'Устройство воспроизведения',
        activeTrackRef.current?.provider === 'soundcloud'
          ? 'SoundCloud воспроизводится во встроенном защищённом плеере. Для него выберите AirPlay через Пункт управления iPhone.'
          : 'Этот браузер не предоставляет приложению выбор устройства. Используйте системное меню AirPlay или настройки звука.',
      );
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      Alert.alert('Устройство воспроизведения', 'Не удалось открыть список устройств. Проверьте доступ к локальной сети и повторите попытку.');
    }
  }, [player, usesUploadedWebAudio]);

  const toggleShuffle = useCallback(() => {
    const nextValue = !shuffleEnabledRef.current;
    shuffleEnabledRef.current = nextValue;
    const track = activeTrackRef.current;
    shuffleQueueRef.current = nextValue && track?.queue?.length
      ? createShuffleQueueState(track.queue.map((item) => item.id), track.id)
      : null;
    setIsShuffleEnabled(nextValue);
  }, []);
  const toggleRepeat = useCallback(() => setIsRepeatEnabled((value) => !value), []);
  const openReleaseShare = useCallback(() => {
    if (!activeTrackRef.current) return;
    setIsReleaseShareVisible(true);
  }, []);

  const controlsValue = useMemo<GlobalAudioControlsContextValue>(() => ({
    activeTrack,
    isExpanded,
    setExpanded,
    isPlaying,
    isAudioLoading,
    soundcloudDiagnostic,
    play,
    pause,
    close,
    seek,
    hasPreviousTrack,
    hasNextTrack,
    playPrevious,
    playNext,
    hasPreviousCollection,
    hasNextCollection,
    previousCollectionTrack,
    nextCollectionTrack,
    previousCollectionArtworkUrl,
    nextCollectionArtworkUrl,
    playPreviousCollection,
    playNextCollection,
    isShuffleEnabled,
    isRepeatEnabled,
    toggleShuffle,
    toggleRepeat,
    setActiveQueue,
    primeTrack,
    canSaveToMyMusic,
    isSavedToMyMusic,
    isSavingToMyMusic,
    toggleMyMusic,
    canSaveRadio,
    isSavedRadio,
    isSavingRadio,
    toggleFavoriteRadio,
    selectOutputDevice,
    openReleaseShare,
    notify: onNotify,
    isTrackPlaying: (id) => activeTrack?.id === id && isPlaying,
  }), [activeTrack, canSaveRadio, canSaveToMyMusic, close, hasNextCollection, hasNextTrack, hasPreviousCollection, hasPreviousTrack, isAudioLoading, isExpanded, isPlaying, isRepeatEnabled, isSavedRadio, isSavedToMyMusic, isSavingRadio, isSavingToMyMusic, isShuffleEnabled, nextCollectionArtworkUrl, nextCollectionTrack, onNotify, openReleaseShare, pause, play, playNext, playNextCollection, playPrevious, playPreviousCollection, previousCollectionArtworkUrl, previousCollectionTrack, primeTrack, seek, selectOutputDevice, setActiveQueue, soundcloudDiagnostic, toggleFavoriteRadio, toggleMyMusic, toggleRepeat, toggleShuffle]);
  const progressValue = useMemo<GlobalAudioProgressContextValue>(() => ({
    progress,
    positionSeconds,
    durationSeconds: trackDuration,
  }), [positionSeconds, progress, trackDuration]);

  const soundcloudPlayerUrl = soundcloudFrameSeedUrl
    ? `https://w.soundcloud.com/player/?url=${encodeURIComponent(soundcloudFrameSeedUrl)}&auto_play=false&hide_related=true&show_comments=false&show_user=false&show_reposts=false&visual=false`
    : null;
  return <GlobalAudioControlsContext.Provider value={controlsValue}>
    <GlobalAudioProgressContext.Provider value={progressValue}>
      {children}
      <ReleaseShareModal
        isVisible={isReleaseShareVisible}
        onAddToPost={(track) => {
          setIsReleaseShareVisible(false);
          setExpanded(false);
          onAddTrackToPost(track);
        }}
        onClose={() => setIsReleaseShareVisible(false)}
        onNotify={onNotify}
        track={activeTrack}
      />
      <YouTubeAudioEngine
        ref={youtubeEngineRef}
        onEnded={() => {
          if (activeTrackRef.current?.provider !== 'youtube') return;
          if (repeatEnabledRef.current) {
            const current = activeTrackRef.current;
            const videoId = youtubeVideoId(current);
            if (videoId) youtubeEngineRef.current?.load(videoId, current.startSeconds ?? 0, true);
            return;
          }
          const current = activeTrackRef.current;
          const hasFollowingTrack = Boolean(current?.queue && (current.queueIndex ?? 0) < current.queue.length - 1);
          if (hasFollowingTrack || shuffleEnabledRef.current) void playNextRef.current();
          else setPlaybackIntent(false);
        }}
        onError={(message: string) => {
          if (activeTrackRef.current?.provider !== 'youtube') return;
          setPlaybackIntent(false);
          setIsSoundcloudLoading(false);
          Alert.alert('YouTube', message);
        }}
        onStateChange={(snapshot: YouTubeAudioSnapshot) => {
          if (activeTrackRef.current?.provider !== 'youtube') return;
          setYoutubeState(snapshot);
          setPlaybackIntent(snapshot.playing || snapshot.loading);
          setIsSoundcloudLoading(snapshot.loading);
        }}
      />
      {Platform.OS === 'web' ? createElement('audio', { ref: soundcloudWebAudioRef, preload: 'metadata', playsInline: true, 'x-webkit-airplay': 'allow', style: { position: 'fixed', width: 1, height: 1, left: -10000, bottom: 0, opacity: 0, pointerEvents: 'none' } }) : null}
      {Platform.OS === 'web' ? createElement('audio', { ref: uploadedWebAudioRef, preload: 'metadata', playsInline: true, 'x-webkit-airplay': 'allow', style: { position: 'fixed', width: 1, height: 1, left: -10000, bottom: 0, opacity: 0, pointerEvents: 'none' } }) : null}
      {Platform.OS === 'web' ? createElement('audio', { ref: preloadedWebAudioRef, preload: 'auto', playsInline: true, style: { display: 'none' } }) : null}
      {Platform.OS === 'web' && soundcloudPlayerUrl ? createElement('iframe', { ref: soundcloudFrameRef, src: soundcloudPlayerUrl, title: 'SoundCloud audio engine', allow: 'autoplay', style: { position: 'fixed', width: 1, height: 1, left: -10000, bottom: 0, border: 0, opacity: 0, pointerEvents: 'none' } }) : null}
    </GlobalAudioProgressContext.Provider>
  </GlobalAudioControlsContext.Provider>;
}

export function useGlobalAudioControls() {
  const value = useContext(GlobalAudioControlsContext);
  if (!value) throw new Error('useGlobalAudioControls must be used inside GlobalAudioProvider');
  return value;
}

export function useGlobalAudioProgress() {
  const value = useContext(GlobalAudioProgressContext);
  if (!value) throw new Error('useGlobalAudioProgress must be used inside GlobalAudioProvider');
  return value;
}

export function useGlobalAudioPlayer(): GlobalAudioContextValue {
  const controls = useGlobalAudioControls();
  const progressState = useGlobalAudioProgress();
  return useMemo(() => ({ ...controls, ...progressState }), [controls, progressState]);
}

function PlayerAnimatedButton({ accessibilityLabel, children, disabled = false, onPress, style }: { accessibilityLabel: string; children: ReactNode; disabled?: boolean; onPress: () => void; style?: StyleProp<ViewStyle> }) {
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const reduceMotion = useRef(false);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => { reduceMotion.current = value; }).catch(() => undefined);
  }, []);

  const animate = (pressed: boolean) => {
    Animated.parallel([
      Animated.timing(opacity, { duration: pressed ? 70 : 120, toValue: pressed ? 0.68 : 1, useNativeDriver: true }),
      Animated.spring(scale, { damping: 16, stiffness: 360, mass: 0.45, toValue: pressed && !reduceMotion.current ? 0.92 : 1, useNativeDriver: true }),
    ]).start();
  };

  return <Pressable accessibilityLabel={accessibilityLabel} accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} hitSlop={8} onPress={onPress} onPressIn={() => animate(true)} onPressOut={() => animate(false)} style={style}><Animated.View style={[localStyles.playerAnimatedButtonContent, { opacity, transform: [{ scale }] }]}>{children}</Animated.View></Pressable>;
}

function AnimatedStateIcon({ active, activeIcon, inactiveIcon, size }: { active: boolean; activeIcon: ReactNode; inactiveIcon: ReactNode; size: number }) {
  const progress = useRef(new Animated.Value(active ? 1 : 0)).current;
  const reduceMotion = useRef(false);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => { reduceMotion.current = value; }).catch(() => undefined);
  }, []);

  useEffect(() => {
    Animated.timing(progress, {
      duration: reduceMotion.current ? 0 : 190,
      easing: Easing.out(Easing.cubic),
      toValue: active ? 1 : 0,
      useNativeDriver: true,
    }).start();
  }, [active, progress]);

  const inactiveOpacity = progress.interpolate({ inputRange: [0, 0.62, 1], outputRange: [1, 0, 0] });
  const activeOpacity = progress.interpolate({ inputRange: [0, 0.38, 1], outputRange: [0, 0, 1] });
  const inactiveScale = progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0.72] });
  const activeScale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.72, 1] });
  const inactiveRotate = progress.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-35deg'] });
  const activeRotate = progress.interpolate({ inputRange: [0, 1], outputRange: ['35deg', '0deg'] });

  return <View pointerEvents="none" style={{ width: size, height: size }}>
    <Animated.View style={[localStyles.playerStateIconLayer, { opacity: inactiveOpacity, transform: [{ rotate: inactiveRotate }, { scale: inactiveScale }] }]}>{inactiveIcon}</Animated.View>
    <Animated.View style={[localStyles.playerStateIconLayer, { opacity: activeOpacity, transform: [{ rotate: activeRotate }, { scale: activeScale }] }]}>{activeIcon}</Animated.View>
  </View>;
}

function useOverflowMarquee(contentKey: string) {
  const [containerWidth, setContainerWidth] = useState(0);
  const [contentWidth, setContentWidth] = useState(0);
  const [fadeEdges, setFadeEdges] = useState<'both' | 'left' | 'right'>('right');
  const [reduceMotion, setReduceMotion] = useState(false);
  const translateX = useRef(new Animated.Value(0)).current;
  const fadeEdgesRef = useRef<'both' | 'left' | 'right'>('right');
  const gradientId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const overflow = Math.max(0, contentWidth - containerWidth);
  const shouldScroll = overflow > 3 && !reduceMotion;
  const fadeOverflow = Math.max(1, overflow);
  const fadeTravel = Math.min(12, fadeOverflow);
  const leftFadeOpacity = translateX.interpolate({
    inputRange: [-fadeTravel, 0],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });
  const rightFadeOpacity = translateX.interpolate({
    inputRange: [-fadeOverflow, -Math.max(0, fadeOverflow - fadeTravel)],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (Platform.OS !== 'web' || overflow <= 3) return;
    const listenerId = translateX.addListener(({ value }) => {
      const nextFadeEdges = value >= -1 ? 'right' : value <= -overflow + 1 ? 'left' : 'both';
      if (nextFadeEdges === fadeEdgesRef.current) return;
      fadeEdgesRef.current = nextFadeEdges;
      setFadeEdges(nextFadeEdges);
    });
    return () => translateX.removeListener(listenerId);
  }, [overflow, translateX]);
  useEffect(() => {
    translateX.stopAnimation();
    translateX.setValue(0);
    fadeEdgesRef.current = 'right';
    setFadeEdges('right');
    if (!shouldScroll) return;
    const travelDuration = Math.max(2100, Math.min(7500, 1300 + overflow * 21));
    const animation = Animated.loop(Animated.sequence([
      Animated.delay(1300),
      Animated.timing(translateX, { duration: travelDuration, easing: Easing.linear, toValue: -overflow, useNativeDriver: true }),
      Animated.delay(1100),
      Animated.timing(translateX, { duration: travelDuration, easing: Easing.linear, toValue: 0, useNativeDriver: true }),
      Animated.delay(900),
    ]));
    animation.start();
    return () => animation.stop();
  }, [contentKey, overflow, shouldScroll, translateX]);

  return {
    fadeEdges,
    gradientId,
    hasOverflow: overflow > 3,
    leftFadeOpacity,
    onContainerLayout: (event: any) => setContainerWidth(Math.ceil(event.nativeEvent.layout.width)),
    onContentLayout: (event: any) => setContentWidth(Math.ceil(event.nativeEvent.layout.width)),
    rightFadeOpacity,
    shouldScroll,
    translateX,
  };
}

export function MarqueeTrackTitle({ compact = false, connect = false, emphasisPrefix = '', emphasisSuffix = '', emphasizeTitle = false, header = false, plainSuffix = '', profile = false, title }: { compact?: boolean; connect?: boolean; emphasisPrefix?: string; emphasisSuffix?: string; emphasizeTitle?: boolean; header?: boolean; plainSuffix?: string; profile?: boolean; title: string }) {
  const contentKey = `${emphasisPrefix}${title}${plainSuffix}${emphasisSuffix}`;
  const { fadeEdges, gradientId, hasOverflow, leftFadeOpacity, onContainerLayout, onContentLayout, rightFadeOpacity, shouldScroll, translateX } = useOverflowMarquee(contentKey);
  const fadeColor = compact || profile ? '#fff' : '#f3f5f7';
  const transparentWebMask = Platform.OS === 'web' && compact && hasOverflow
    ? ({
        maskImage: fadeEdges === 'right'
          ? 'linear-gradient(to right, #000 0, #000 calc(100% - 12px), transparent 100%)'
          : fadeEdges === 'left'
            ? 'linear-gradient(to right, transparent 0, #000 12px, #000 100%)'
            : 'linear-gradient(to right, transparent 0, #000 12px, #000 calc(100% - 12px), transparent 100%)',
        WebkitMaskImage: fadeEdges === 'right'
          ? 'linear-gradient(to right, #000 0, #000 calc(100% - 12px), transparent 100%)'
          : fadeEdges === 'left'
            ? 'linear-gradient(to right, transparent 0, #000 12px, #000 100%)'
            : 'linear-gradient(to right, transparent 0, #000 12px, #000 calc(100% - 12px), transparent 100%)',
      } as any)
    : null;
  const content = <>{emphasisPrefix ? <Text style={localStyles.marqueeEmphasisPrefix}>{emphasisPrefix}</Text> : null}{emphasizeTitle ? <Text style={localStyles.marqueeEmphasisSuffix}>{title}</Text> : title}{plainSuffix}{emphasisSuffix ? <Text style={localStyles.marqueeEmphasisSuffix}>{emphasisSuffix}</Text> : null}</>;

  return <View onLayout={onContainerLayout} style={[localStyles.marqueeTitleViewport, compact || profile ? localStyles.miniMarqueeTitleViewport : null, connect ? localStyles.connectMarqueeTitleViewport : null, header ? localStyles.headerMarqueeTitleViewport : null, transparentWebMask]}>
    <Text
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      onLayout={onContentLayout}
      style={[
        connect ? localStyles.connectMarqueeTitle : profile ? localStyles.profileMarqueeTitle : header ? localStyles.expandedHeaderCollection : compact ? localStyles.title : localStyles.expandedTitle,
        localStyles.marqueeMeasureText,
        Platform.OS === 'web' ? localStyles.marqueeTitleTextWeb : null,
      ]}
    >{content}</Text>
    <Animated.Text
      numberOfLines={Platform.OS === 'web' ? undefined : 1}
      style={[
        connect ? localStyles.connectMarqueeTitle : profile ? localStyles.profileMarqueeTitle : header ? localStyles.expandedHeaderCollection : compact ? localStyles.title : localStyles.expandedTitle,
        localStyles.marqueeTitleText,
        Platform.OS === 'web' ? localStyles.marqueeTitleTextWeb : null,
        header && !shouldScroll ? localStyles.headerMarqueeTitleCentered : null,
        { transform: [{ translateX }] },
      ]}
    >{content}</Animated.Text>
    {hasOverflow && !connect && !(Platform.OS === 'web' && compact) ? <Animated.View pointerEvents="none" style={[localStyles.marqueeFadeLeft, compact || header || profile ? localStyles.miniMarqueeFade : null, { opacity: leftFadeOpacity }]}><Svg height="100%" width="100%"><Defs><LinearGradient id={`${gradientId}-left`} x1="0" y1="0" x2="1" y2="0"><Stop offset="0" stopColor={fadeColor} stopOpacity="1" /><Stop offset="1" stopColor={fadeColor} stopOpacity="0" /></LinearGradient></Defs><Rect width="100%" height="100%" fill={`url(#${gradientId}-left)`} /></Svg></Animated.View> : null}
    {hasOverflow && !connect && !(Platform.OS === 'web' && compact) ? <Animated.View pointerEvents="none" style={[localStyles.marqueeFadeRight, compact || header || profile ? localStyles.miniMarqueeFade : null, { opacity: rightFadeOpacity }]}><Svg height="100%" width="100%"><Defs><LinearGradient id={`${gradientId}-right`} x1="0" y1="0" x2="1" y2="0"><Stop offset="0" stopColor={fadeColor} stopOpacity="0" /><Stop offset="1" stopColor={fadeColor} stopOpacity="1" /></LinearGradient></Defs><Rect width="100%" height="100%" fill={`url(#${gradientId}-right)`} /></Svg></Animated.View> : null}
  </View>;
}

function BandcampLogo() {
  return <Svg accessibilityLabel="Bandcamp" height={15} viewBox="10 10 1975 310" width={95}>
    <Path d="M293.337 254.062H10L142.314 10h283.34z" fill="#6399a8" />
    <G fill="#201d1c"><Path d="M509.908 103.51c-31.802 0-48.05 25.012-48.05 62.691 0 35.618 17.57 62.35 48.05 62.35 34.469 0 47.39-31.52 47.39-62.35-.023-32.194-16.264-62.691-47.401-62.691M425.408 10h37.775v90.426h.669c10.272-17.122 31.81-27.745 51.032-27.745 54.006 0 80.194 42.49 80.194 94.217 0 47.6-23.193 92.475-73.902 92.475-23.198 0-48.051-5.81-59.321-29.11h-.656v24.33h-35.794V10.006l.003-.005M798.117 228.313c-21.546.244-23.77.244-25.414.244-6.956 0-8.95-3.769-8.95-13.362v-91.13c0-37.327-35.122-51.384-68.603-51.384-37.778 0-75.217 13.355-77.86 58.928h37.77c1.662-19.186 16.565-28.099 37.776-28.099 15.241 0 35.458 3.78 35.458 23.986 0 22.95-24.191 19.864-51.365 25.012-31.812 3.756-65.941 10.97-65.941 55.138 0 34.61 27.83 51.727 58.646 51.727 20.218 0 44.405-6.51 59.326-21.555 2.97 16.088 13.918 21.555 29.158 21.555l41.64-2.576zm-72.07-33.328c0 24.66-25.85 33.576-42.418 33.576-13.26 0-34.806-5.156-34.806-22.616 0-20.56 14.588-26.73 30.832-29.472 16.562-3.08 34.79-2.729 46.392-10.607z" /><Path d="M887.707 72.68c-22.534 0-42.088 11.988-53.358 31.526l-.66-.696V77.482h-35.79l-.178 150.831 1.641 28.484 36.311-2.218V150.114c0-26.043 16.242-46.599 41.422-46.599 22.202 0 32.815 11.996 33.47 39.737v111.332h37.793V132.981c.073-39.731-23.466-60.295-60.59-60.295M1058.393 228.557c33.797 0 48.054-31.863 48.054-62.7 0-39.037-18.223-62.347-47.392-62.347-35.46 0-48.055 32.547-48.055 64.399 0 30.49 14.575 60.641 47.4 60.641m84.494 26.034H1107.1v-23.977h-.654c-9.939 20.212-31.493 28.766-53.028 28.766-54.006 0-80.193-41.452-80.193-94.539 0-64.057 36.789-92.148 74.24-92.148 21.53 0 45.384 8.227 56.986 27.74h.673V10.008h37.773V254.59v-.006M1293.02 136.749c-2.986-21.582-18.226-33.236-39.1-33.236-19.563 0-47.06 10.625-47.06 64.408 0 29.463 12.587 60.64 45.4 60.64 21.868 0 37.106-15.09 40.76-40.442h37.774c-6.96 45.903-34.458 71.254-78.534 71.254-53.687 0-83.178-39.384-83.178-91.452 0-53.436 28.168-95.23 84.503-95.23 39.764 0 73.575 20.552 77.21 64.06h-37.713l-.061-.002M1532.798 228.313c-21.545.244-23.77.244-25.413.244-6.956 0-8.95-3.769-8.95-13.362v-91.13c0-37.327-35.123-51.384-68.604-51.384-37.778 0-75.217 13.355-77.859 58.928h37.769c1.663-19.186 16.565-28.099 37.776-28.099 15.242 0 35.459 3.78 35.459 23.986 0 22.95-24.192 19.864-51.366 25.012-31.812 3.756-65.941 10.97-65.941 55.138 0 34.61 27.831 51.727 58.646 51.727 20.219 0 44.406-6.51 59.326-21.555 2.97 16.088 13.919 21.555 29.159 21.555l41.64-2.576zm-72.07-33.328c0 24.66-25.85 33.576-42.417 33.576-13.261 0-34.807-5.156-34.807-22.616 0-20.56 14.588-26.73 30.832-29.472 16.562-3.08 34.791-2.729 46.393-10.607z" /><Path d="M1723.865 72.68c-24.86 0-41.091 11.311-53.681 29.463-7.629-20.201-27.18-29.462-48.066-29.462-27.167 0-41.424 11.987-52.68 29.462h-1.001v-24.66h-35.81v150.83l1.728 28.484 36.055-2.218V149.424c0-29.458 17.898-45.909 37.45-45.909 22.86 0 30.155 13.01 30.155 37.35v113.72h37.77v-103.79c0-29.81 10.936-47.277 36.463-47.277 29.487 0 31.141 19.524 31.141 47.625v103.44h37.784V132.3c.013-43.171-21.18-59.613-57.282-59.613M1899.831 103.51c-31.808 0-48.053 25.012-48.053 62.691 0 35.618 17.565 62.35 48.053 62.35 34.462 0 47.4-31.52 47.4-62.35 0-32.194-16.272-62.691-47.4-62.691m-84.502-26.028h35.796v23.978h.667c10.602-20.203 31.141-28.78 53.014-28.78 54.014 0 80.194 42.491 80.194 94.218 0 47.6-23.193 92.475-73.886 92.475-21.873 0-45.412-8.217-57.335-27.73h-.667V320h-37.783V77.497z" /></G>
  </Svg>;
}

function SoundcloudLogo() {
  const asset = require('../../assets/soundcloud-logo.svg');
  const webUri = typeof asset === 'string' ? asset : asset?.default ?? asset?.uri;
  const uri = Platform.OS === 'web' ? webUri : Image.resolveAssetSource(asset)?.uri;
  if (typeof uri !== 'string' || !uri) return null;
  return <SvgUri accessibilityLabel="SoundCloud" height={15} uri={uri} width={110} />;
}

export function GlobalMiniPlayer({ bottomNavigationHeight = 0, hasBottomNavigation = true, onOpenProfile, onOpenPublicPage }: {
  bottomNavigationHeight?: number;
  hasBottomNavigation?: boolean;
  onOpenProfile?: (username: string) => Promise<void> | void;
  onOpenPublicPage?: (username: string) => Promise<void> | void;
}) {
  const audio = useGlobalAudioControls();
  const { progress } = useGlobalAudioProgress();
  const insets = useSafeAreaInsets();
  const { activeTrack, close, isPlaying, pause, play } = audio;
  const { isExpanded: expanded, setExpanded } = audio;
  const closeExpanded = useCallback(() => setExpanded(false), []);
  const [renderedTrack, setRenderedTrack] = useState<GlobalTrack | null>(activeTrack);
  const visibility = useRef(new Animated.Value(activeTrack ? 1 : 0)).current;
  const wasVisible = useRef(Boolean(activeTrack));

  useEffect(() => {
    if (activeTrack) {
      setRenderedTrack(activeTrack);
      if (!wasVisible.current) {
        visibility.setValue(0);
        requestAnimationFrame(() => {
          Animated.timing(visibility, { duration: MINI_PLAYER_ENTER_DURATION_MS, easing: MINI_PLAYER_ENTER_EASING, toValue: 1, useNativeDriver: true }).start();
        });
      }
      wasVisible.current = true;
      return;
    }
    if (!wasVisible.current) return;
    wasVisible.current = false;
    setExpanded(false);
    Animated.timing(visibility, { duration: MINI_PLAYER_EXIT_DURATION_MS, easing: MINI_PLAYER_EXIT_EASING, toValue: 0, useNativeDriver: true }).start(({ finished }) => {
      if (finished && !wasVisible.current) setRenderedTrack(null);
    });
  }, [activeTrack, visibility]);

  const track = activeTrack ?? renderedTrack;
  if (!track) return null;
  const miniPlayerOffset = hasBottomNavigation ? 80 : 10;
  const measuredNavigationOffset = hasBottomNavigation && bottomNavigationHeight > 0 ? bottomNavigationHeight + 8 : null;
  // React Native Web reports the CSS layout height without resolving iOS PWA's
  // env(safe-area-inset-bottom). Keep that inset in the final CSS expression
  // even after BottomNavigation has been measured, otherwise the player drops
  // underneath the navigation by roughly the home-indicator height.
  const miniPlayerBottom = Platform.OS === 'web'
    ? `calc(${measuredNavigationOffset ?? miniPlayerOffset}px + env(safe-area-inset-bottom, 0px))`
    : measuredNavigationOffset ?? miniPlayerOffset + insets.bottom;
  const animatedStyle = {
    opacity: visibility,
    transform: [{ translateY: visibility.interpolate({ inputRange: [0, 1], outputRange: [68, 0] }) }],
  };
  return <>
  <Animated.View pointerEvents={activeTrack ? 'auto' : 'none'} style={[localStyles.shell, { bottom: miniPlayerBottom } as unknown as ViewStyle, animatedStyle]}>
    <Pressable accessibilityLabel="Открыть плеер" accessibilityRole="button" onPress={() => setExpanded(true)}>{track.artworkUrl ? <Image source={{ uri: musicArtworkThumbnail(track.artworkUrl, track.provider) ?? track.artworkUrl }} style={localStyles.artwork} /> : <View style={localStyles.artworkFallback}><Text style={localStyles.artworkFallbackText}>♪</Text></View>}</Pressable>
    <Pressable accessibilityLabel="Открыть плеер" accessibilityRole="button" onPress={() => setExpanded(true)} style={localStyles.copy}><MarqueeTrackTitle compact title={track.title} />{track.artist ? <Text numberOfLines={1} style={localStyles.artist}>{track.artist}</Text> : null}</Pressable>
    {audio.canSaveRadio ? <PlayerAnimatedButton accessibilityLabel={audio.isSavedRadio ? 'Удалить радиостанцию из избранного' : 'Добавить радиостанцию в избранное'} disabled={audio.isSavingRadio} onPress={() => void audio.toggleFavoriteRadio()} style={[localStyles.control, localStyles.miniSaveControl]}>{audio.isSavingRadio ? <ActivityIndicator color="#111" size="small" /> : <AnimatedStateIcon active={audio.isSavedRadio} activeIcon={<Check color="#111" size={20} strokeWidth={2.2} />} inactiveIcon={<Plus color="#111" size={20} strokeWidth={2.1} />} size={20} />}</PlayerAnimatedButton> : audio.canSaveToMyMusic ? <PlayerAnimatedButton accessibilityLabel={audio.isSavedToMyMusic ? 'Удалить трек из моей музыки' : 'Добавить трек в мою музыку'} disabled={audio.isSavingToMyMusic} onPress={() => void audio.toggleMyMusic()} style={[localStyles.control, localStyles.miniSaveControl]}><AnimatedStateIcon active={audio.isSavedToMyMusic} activeIcon={<Check color="#111" size={20} strokeWidth={2.2} />} inactiveIcon={<Plus color="#111" size={20} strokeWidth={2.1} />} size={20} /></PlayerAnimatedButton> : null}
    <PlayerAnimatedButton accessibilityLabel={audio.isAudioLoading ? 'Аудио загружается' : isPlaying ? 'Пауза' : 'Продолжить воспроизведение'} disabled={audio.isAudioLoading} onPress={() => isPlaying ? pause() : void play(track)} style={localStyles.control}>{audio.isAudioLoading ? <ActivityIndicator color="#111" size="small" /> : <AnimatedStateIcon active={isPlaying} activeIcon={<Pause color="#111" size={19} fill="#111" />} inactiveIcon={<Play color="#111" size={19} fill="#111" />} size={19} />}</PlayerAnimatedButton>
    <PlayerAnimatedButton accessibilityLabel="Следующий трек" disabled={!audio.hasNextTrack} onPress={() => void audio.playNext()} style={[localStyles.control, !audio.hasNextTrack && localStyles.miniControlDisabled]}><SkipForward color="#111" fill="#111" size={20} /></PlayerAnimatedButton>
    <Pressable accessibilityLabel="Закрыть плеер" accessibilityRole="button" hitSlop={8} onPress={close} style={localStyles.control}><X color="#53606c" size={20} /></Pressable>
    <View pointerEvents="none" style={localStyles.progressTrack}><View style={[localStyles.progressFill, { width: `${progress * 100}%` }]} /></View>
  </Animated.View>
  <ExpandedPlayer audio={audio} isVisible={expanded} onClose={closeExpanded} onOpenProfile={onOpenProfile} onOpenPublicPage={onOpenPublicPage} track={track} />
  </>;
}

const ExpandedPlayer = memo(function ExpandedPlayer({ audio, isVisible, onClose, onOpenProfile, onOpenPublicPage, track: committedTrack }: {
  audio: GlobalAudioControlsContextValue;
  isVisible: boolean;
  onClose: () => void;
  onOpenProfile?: (username: string) => Promise<void> | void;
  onOpenPublicPage?: (username: string) => Promise<void> | void;
  track: GlobalTrack;
}) {
  const viewport = useWindowDimensions();
  const [optimisticTrack, setOptimisticTrack] = useState<GlobalTrack | null>(null);
  const track = optimisticTrack ?? committedTrack;
  const explicitReleaseParticipants = (track.participants ?? [])
    .map((participant, index) => participant.entityType === 'text'
      ? { entityType: 'text' as const, key: `text-${index}-${participant.name}`, label: participant.name.trim(), username: null }
      : { entityType: participant.entityType, key: `${participant.entityType}-${participant.id}`, label: `@${participant.username.trim()}`, username: participant.username.trim() })
    .filter((participant) => Boolean(participant.label));
  const fallbackParticipantName = track.artist?.trim() || 'Неизвестный';
  const releaseParticipants = explicitReleaseParticipants.length
    ? explicitReleaseParticipants
    : track.isLiveStream
      ? []
      : [{ entityType: 'text' as const, key: `fallback-artist-${fallbackParticipantName}`, label: fallbackParticipantName, username: null }];
  const hasReleaseLabel = Boolean(track.labelName?.trim());
  const releaseTrackPosition = activeReleaseTrackPosition(track);
  const openLinkedEntity = (entityType: 'account' | 'community', username: string) => {
    const open = entityType === 'account' ? onOpenProfile : onOpenPublicPage;
    if (!open) return;
    onClose();
    void Promise.resolve(open(username)).catch(() => undefined);
  };
  const previousCommittedTrackRef = useRef<GlobalTrack>(committedTrack);
  const swipeCommitTargetIdRef = useRef<string | null>(null);
  const dismissTranslateY = useRef(new Animated.Value(0)).current;
  const isDismissing = useRef(false);
  const isDismissDragging = useRef(false);
  const modalHeight = useRef(viewport.height);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const artworkTranslateX = useRef(new Animated.Value(0)).current;
  const isArtworkSettling = useRef(false);
  const shouldResetArtworkRailAfterRenderRef = useRef(false);
  const artworkNavigationRef = useRef<{
    hasNext: boolean;
    hasPrevious: boolean;
    nextTrack: GlobalTrackQueueItem | null;
    previousTrack: GlobalTrackQueueItem | null;
    next: () => Promise<void>;
    previous: () => Promise<void>;
    step: number;
  }>({
    hasNext: false,
    hasPrevious: false,
    nextTrack: null,
    previousTrack: null,
    next: async () => {},
    previous: async () => {},
    step: 1,
  });
  const artworkGestureNavigationRef = useRef<typeof artworkNavigationRef.current | null>(null);
  const artworkGestureDirectionRef = useRef<-1 | 0 | 1>(0);
  const [isPlaylistPickerVisible, setIsPlaylistPickerVisible] = useState(false);
  const [isLoadingPlaylists, setIsLoadingPlaylists] = useState(false);
  const [savingPlaylistId, setSavingPlaylistId] = useState<string | null>(null);
  const [isSavingListenLater, setIsSavingListenLater] = useState(false);
  const [playlists, setPlaylists] = useState<PlayerMusicPlaylist[]>([]);
  const [playlistProfileTracks, setPlaylistProfileTracks] = useState<PlayerProfileTrack[]>([]);
  const [listenLaterItems, setListenLaterItems] = useState<Array<Record<string, unknown>>>([]);
  const loadLibraryMembership = useCallback(async () => {
    const [libraryResponse, listenLaterResponse] = await Promise.all([
      apiFetch(`${apiUrl}/my-music`),
      apiFetch(`${apiUrl}/my-music/listen-later`),
    ]);
    if (!libraryResponse.ok) throw new Error(await readApiError(libraryResponse, 'Не удалось проверить плейлисты'));
    if (!listenLaterResponse.ok) throw new Error(await readApiError(listenLaterResponse, 'Не удалось проверить отложенные релизы'));
    const library = await libraryResponse.json() as { playlists?: PlayerMusicPlaylist[]; profileTracks?: PlayerProfileTrack[] };
    const listenLater = await listenLaterResponse.json() as { items?: Array<Record<string, unknown>> };
    setPlaylists(Array.isArray(library.playlists) ? library.playlists : []);
    setPlaylistProfileTracks(Array.isArray(library.profileTracks) ? library.profileTracks : []);
    setListenLaterItems(Array.isArray(listenLater.items) ? listenLater.items : []);
  }, []);
  useEffect(() => {
    if (!isVisible || track.isLiveStream) return;
    // Opening the full player is a latency-sensitive transition. The playlist
    // membership reads are not needed for its first frame, so keep their JSON
    // parsing and React state updates out of the entrance animation.
    const task = InteractionManager.runAfterInteractions(() => {
      void loadLibraryMembership().catch(() => undefined);
    });
    return () => task.cancel();
  }, [isVisible, loadLibraryMembership, track.id, track.isLiveStream]);
  const playlistTrackKey = useMemo(() => {
    if (track.provider === 'volna') {
      const uploadId = uploadedTrackIdFromPlayerId(track.id);
      return uploadId ? uploadedTrackPlaylistKey(uploadId) : null;
    }
    const descriptor = savableTrackDescriptor(track);
    if (!descriptor) return null;
    const existing = playlistProfileTracks.find((item) => item.provider === descriptor.provider
      && normalizedSavableTrackUrl(item.provider, item.externalUrl) === normalizedSavableTrackUrl(descriptor.provider, descriptor.externalUrl));
    return existing ? `profile:${descriptor.provider}:${existing.id}` : null;
  }, [playlistProfileTracks, track]);
  const isTrackInPlaylist = Boolean(playlistTrackKey && playlists.some((playlist) => playlist.tracks.includes(playlistTrackKey)));
  const listenLaterDraft = useMemo(() => listenLaterItemFromTrack(track), [track]);
  const listenLaterMatch = listenLaterItems.find((item) => {
    if (listenLaterDraft.releaseId) return item.releaseId === listenLaterDraft.releaseId;
    if (listenLaterDraft.collectionId) return item.provider === listenLaterDraft.provider && item.collectionId === listenLaterDraft.collectionId;
    const itemTracks = Array.isArray(item.tracks) ? item.tracks : [];
    return itemTracks.some((itemTrack) => {
      if (!itemTrack || typeof itemTrack !== 'object' || Array.isArray(itemTrack)) return false;
      const saved = itemTrack as Record<string, unknown>;
      return saved.id === track.id || (track.externalUrl && saved.externalUrl === track.externalUrl);
    });
  });
  const isTrackInListenLater = Boolean(listenLaterMatch);
  const openPlaylistPicker = useCallback(async () => {
    setIsPlaylistPickerVisible(true);
    setIsLoadingPlaylists(true);
    try {
      const response = await apiFetch(`${apiUrl}/my-music`);
      if (!response.ok) throw new Error(await readApiError(response, 'Не удалось загрузить плейлисты'));
      const result = await response.json() as { playlists?: PlayerMusicPlaylist[]; profileTracks?: PlayerProfileTrack[] };
      setPlaylists(Array.isArray(result.playlists) ? result.playlists : []);
      setPlaylistProfileTracks(Array.isArray(result.profileTracks) ? result.profileTracks : []);
    } catch (error) {
      setIsPlaylistPickerVisible(false);
      audio.notify(error instanceof Error ? error.message : 'Не удалось загрузить плейлисты', 'error');
    } finally {
      setIsLoadingPlaylists(false);
    }
  }, [audio]);
  const addTrackToPlaylist = useCallback(async (playlist: PlayerMusicPlaylist) => {
    if (savingPlaylistId) return;
    setSavingPlaylistId(playlist.id);
    try {
      let trackKey: string;
      if (track.provider === 'volna') {
        const uploadId = uploadedTrackIdFromPlayerId(track.id);
        if (!uploadId) throw new Error('Этот загруженный трек нельзя добавить в плейлист');
        trackKey = uploadedTrackPlaylistKey(uploadId);
      } else {
        const descriptor = savableTrackDescriptor(track);
        if (!descriptor) throw new Error('Этот трек нельзя добавить в плейлист');
        const existing = playlistProfileTracks.find((item) => item.provider === descriptor.provider && normalizedSavableTrackUrl(item.provider, item.externalUrl) === normalizedSavableTrackUrl(descriptor.provider, descriptor.externalUrl));
        if (existing) {
          trackKey = `profile:${descriptor.provider}:${existing.id}`;
        } else {
          const saveResponse = await apiFetch(`${apiUrl}/my-music/external-track`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider: descriptor.provider, externalUrl: descriptor.externalUrl }),
          });
          if (!saveResponse.ok) throw new Error(await readApiError(saveResponse, 'Не удалось добавить трек в «Мою музыку»'));
          const saved = await saveResponse.json() as { track?: PlayerProfileTrack };
          if (!saved.track?.id || saved.track.provider !== descriptor.provider) throw new Error('Не удалось определить сохранённый трек');
          setPlaylistProfileTracks((current) => [...current, saved.track!]);
          trackKey = `profile:${descriptor.provider}:${saved.track.id}`;
        }
      }
      const response = await apiFetch(`${apiUrl}/my-music/playlists/${encodeURIComponent(playlist.id)}/tracks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackKey }),
      });
      if (!response.ok) throw new Error(await readApiError(response, 'Не удалось добавить трек в плейлист'));
      const result = await response.json() as { added?: boolean; playlists?: PlayerMusicPlaylist[] };
      if (Array.isArray(result.playlists)) setPlaylists(result.playlists);
      setIsPlaylistPickerVisible(false);
      audio.notify(result.added === false ? 'Этот трек уже есть в плейлисте' : 'Трек добавлен в плейлист');
    } catch (error) {
      audio.notify(error instanceof Error ? error.message : 'Не удалось добавить трек в плейлист', 'error');
    } finally {
      setSavingPlaylistId(null);
    }
  }, [audio, playlistProfileTracks, savingPlaylistId, track]);
  const removeTrackFromPlaylists = useCallback(async () => {
    if (!playlistTrackKey || savingPlaylistId) return;
    setSavingPlaylistId('__remove__');
    try {
      const response = await apiFetch(`${apiUrl}/my-music/playlists/tracks`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackKey: playlistTrackKey }),
      });
      if (!response.ok) throw new Error(await readApiError(response, 'Не удалось удалить трек из плейлиста'));
      const result = await response.json() as { removed?: boolean; playlists?: PlayerMusicPlaylist[] };
      if (Array.isArray(result.playlists)) setPlaylists(result.playlists);
      emitMusicLibraryChanged();
      audio.notify(result.removed === false ? 'Трек уже отсутствует в плейлистах' : 'Трек удалён из плейлиста');
    } catch (error) {
      audio.notify(error instanceof Error ? error.message : 'Не удалось удалить трек из плейлиста', 'error');
    } finally {
      setSavingPlaylistId(null);
    }
  }, [audio, playlistTrackKey, savingPlaylistId]);
  const toggleListenLater = useCallback(async () => {
    if (isSavingListenLater) return;
    setIsSavingListenLater(true);
    try {
      const savedItemId = typeof listenLaterMatch?.id === 'string' ? listenLaterMatch.id : null;
      if (savedItemId) {
        const response = await apiFetch(`${apiUrl}/my-music/listen-later/${encodeURIComponent(savedItemId)}`, { method: 'DELETE' });
        if (!response.ok) throw new Error(await readApiError(response, 'Не удалось удалить релиз из отложенных'));
        const result = await response.json() as { removed?: boolean };
        setListenLaterItems((current) => current.filter((item) => item.id !== savedItemId));
        emitMusicLibraryChanged();
        audio.notify(result.removed === false ? 'Релиз уже отсутствует в отложенных' : 'Релиз удалён из отложенных');
        return;
      }
      const response = await apiFetch(`${apiUrl}/my-music/listen-later`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemJson: JSON.stringify(listenLaterItemFromTrack(track)) }),
      });
      if (!response.ok) throw new Error(await readApiError(response, 'Не удалось добавить релиз'));
      const result = await response.json() as { added?: boolean; item?: Record<string, unknown> };
      if (result.item) {
        setListenLaterItems((current) => current.some((item) => item.id === result.item?.id) ? current : [...current, result.item!]);
      }
      emitMusicLibraryChanged();
      audio.notify(result.added === false ? 'Релиз уже находится в отложенных' : 'Релиз добавлен в отложенные');
    } catch (error) {
      audio.notify(error instanceof Error ? error.message : 'Не удалось добавить релиз', 'error');
    } finally {
      setIsSavingListenLater(false);
    }
  }, [audio, isSavingListenLater, listenLaterMatch, track]);
  useLayoutEffect(() => {
    if (!isVisible) return;
    isDismissing.current = false;
    isDismissDragging.current = false;
    modalHeight.current = viewport.height;
    dismissTranslateY.setValue(modalHeight.current + 40);
    requestAnimationFrame(() => {
      Animated.timing(dismissTranslateY, {
        duration: 280,
        easing: Easing.bezier(0.22, 1, 0.36, 1),
        toValue: 0,
        useNativeDriver: true,
      }).start();
    });
  }, [dismissTranslateY, isVisible]);
  useLayoutEffect(() => {
    if (!isVisible) return;
    setWebSurfaceColor(PLAYER_WEB_SURFACE_COLOR);
    return () => setWebSurfaceColor(APP_WEB_SURFACE_COLOR);
  }, [isVisible]);
  const isCatalogFragment = track.provider === 'apple' || track.provider === 'yandex';
  const previewLabel = isCatalogFragment
    ? `Фрагмент · ${Math.max(1, Math.round(track.clipDurationSeconds ?? 30))} сек.`
    : null;
  const dismissPlayer = useCallback((currentOffset = 0, velocityY = 0) => {
    if (isDismissing.current) return;
    isDismissing.current = true;
    isDismissDragging.current = false;
    const target = modalHeight.current + 40;
    const offset = Number.isFinite(currentOffset) ? Math.min(target, Math.max(0, currentOffset)) : 0;
    const remaining = Math.max(1, target - offset);
    const defaultVelocity = target / 240;
    const continuedVelocity = Math.max(defaultVelocity, Number.isFinite(velocityY) ? Math.max(0, velocityY) : 0);
    const duration = Math.max(90, Math.min(240, Math.round(remaining / continuedVelocity)));
    Animated.timing(dismissTranslateY, {
      duration,
      easing: Easing.bezier(0.4, 0, 0.2, 1),
      toValue: target,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) {
        isDismissing.current = false;
        return;
      }
      onCloseRef.current();
      dismissTranslateY.setValue(0);
    });
  }, [dismissTranslateY]);
  const restoreDismissPosition = useCallback(() => {
    Animated.timing(dismissTranslateY, { duration: 220, easing: Easing.bezier(0.22, 1, 0.36, 1), toValue: 0, useNativeDriver: true }).start(({ finished }) => {
      if (finished) setWebSurfaceColor(PLAYER_WEB_SURFACE_COLOR);
    });
  }, [dismissTranslateY]);
  const dismissResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => gesture.dy > 8 && gesture.dy > Math.abs(gesture.dx),
    onPanResponderGrant: () => {
      isDismissDragging.current = true;
      dismissTranslateY.stopAnimation();
      setWebSurfaceColor(APP_WEB_SURFACE_COLOR);
    },
    onPanResponderMove: (_, gesture) => dismissTranslateY.setValue(Math.max(0, gesture.dy)),
    onPanResponderRelease: (_, gesture) => {
      isDismissDragging.current = false;
      if (gesture.dy > 110 || gesture.vy > 0.75) {
        dismissPlayer(gesture.dy, gesture.vy);
        return;
      }
      restoreDismissPosition();
    },
    onPanResponderTerminate: () => {
      isDismissDragging.current = false;
      if (isDismissing.current) return;
      restoreDismissPosition();
    },
  }), [dismissPlayer, dismissTranslateY, restoreDismissPosition]);
  // The player body is vertically centered between the fixed header and
  // provider link. On short screens a width-only square can make that body
  // taller than its slot and push the artwork underneath the header. Reserve
  // the real lower-player stack first, then fit the square into what remains.
  const verticalCardPadding = Platform.OS === 'ios' ? 180 : 160;
  const identityHeightBudget = track.releaseId ? 72 : previewLabel ? 62 : 56;
  const libraryActionsHeightBudget = track.isLiveStream ? 0 : 34;
  const bottomControlsHeightBudget = 95;
  const mainSectionGapBudget = (track.isLiveStream ? 2 : 3) * 14;
  const availableArtworkHeight = viewport.height
    - verticalCardPadding
    - identityHeightBudget
    - libraryActionsHeightBudget
    - bottomControlsHeightBudget
    - mainSectionGapBudget;
  const artworkSize = Math.max(120, Math.min(viewport.width - 90, availableArtworkHeight, 520));
  const sideArtworkScale = 0.84;
  const artworkGap = 14;
  const artworkStep = artworkSize * (1 + sideArtworkScale) / 2 + artworkGap;
  useLayoutEffect(() => {
    if (!shouldResetArtworkRailAfterRenderRef.current) return;
    shouldResetArtworkRailAfterRenderRef.current = false;
    artworkTranslateX.setValue(0);
    isArtworkSettling.current = false;
  }, [artworkTranslateX, optimisticTrack]);
  useLayoutEffect(() => {
    const previousTrack = previousCommittedTrackRef.current;
    previousCommittedTrackRef.current = committedTrack;
    if (previousTrack.id === committedTrack.id) return;

    if (swipeCommitTargetIdRef.current === committedTrack.id) {
      swipeCommitTargetIdRef.current = null;
      if (optimisticTrack?.id === committedTrack.id) setOptimisticTrack(null);
      return;
    }

    const previousQueue = previousTrack.queue;
    const previousIndex = activeQueueIndex(previousTrack);
    const nextIndexInPreviousQueue = previousQueue?.findIndex((item) => item.id === committedTrack.id) ?? -1;
    const previousCollectionKey = previousTrack.collectionId?.trim() || previousTrack.collectionTitle?.trim() || previousTrack.id;
    const nextCollectionKey = committedTrack.collectionId?.trim() || committedTrack.collectionTitle?.trim() || committedTrack.id;
    const queueDelta = previousIndex >= 0 && nextIndexInPreviousQueue >= 0
      ? nextIndexInPreviousQueue - previousIndex
      : 0;
    const shouldAnimateCollectionChange = isVisible
      && !isArtworkSettling.current
      && previousCollectionKey !== nextCollectionKey
      && Math.abs(queueDelta) === 1;

    if (!shouldAnimateCollectionChange) {
      setOptimisticTrack(null);
      artworkTranslateX.setValue(0);
      return;
    }

    const direction: -1 | 1 = queueDelta > 0 ? -1 : 1;
    setOptimisticTrack(previousTrack);
    artworkTranslateX.setValue(0);
    isArtworkSettling.current = true;
    requestAnimationFrame(() => {
      Animated.timing(artworkTranslateX, {
        duration: 230,
        easing: Easing.out(Easing.cubic),
        toValue: direction * artworkStep,
        useNativeDriver: true,
      }).start(() => {
        shouldResetArtworkRailAfterRenderRef.current = true;
        setOptimisticTrack(null);
      });
    });
  }, [artworkStep, artworkTranslateX, committedTrack, isVisible, optimisticTrack?.id]);
  artworkNavigationRef.current = {
    hasNext: audio.hasNextCollection,
    hasPrevious: audio.hasPreviousCollection,
    nextTrack: audio.nextCollectionTrack,
    previousTrack: audio.previousCollectionTrack,
    next: audio.playNextCollection,
    previous: audio.playPreviousCollection,
    step: artworkStep,
  };
  const settleArtwork = useCallback((target: number, switchCollection?: () => Promise<void>, targetTrack?: GlobalTrackQueueItem | null) => {
    if (isArtworkSettling.current) return;
    isArtworkSettling.current = true;
    Animated.timing(artworkTranslateX, {
      duration: switchCollection ? 230 : 190,
      easing: switchCollection ? Easing.out(Easing.cubic) : Easing.out(Easing.quad),
      toValue: target,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) {
        isArtworkSettling.current = false;
        return;
      }
      if (!switchCollection) {
        isArtworkSettling.current = false;
        return;
      }
      // Provider availability is checked before the shared player commits its
      // next active track. Render the swiped collection optimistically during
      // that bounded check so resetting the rail never flashes the old card.
      if (targetTrack) {
        swipeCommitTargetIdRef.current = targetTrack.id;
        // Set the layout-reset intent before scheduling React state. Animated
        // callbacks may flush updates synchronously on web; setting this after
        // setOptimisticTrack could make the layout effect miss the reset and
        // keep subsequent track navigation locked until playback started.
        shouldResetArtworkRailAfterRenderRef.current = true;
        const queue = committedTrack.queue;
        const queueIndex = queue?.findIndex((item) => (
          item.id === targetTrack.id
          && item.previewUrl === targetTrack.previewUrl
        )) ?? -1;
        setOptimisticTrack({
          ...targetTrack,
          queue,
          queueIndex: queueIndex >= 0 ? queueIndex : undefined,
          queueWindowResolver: committedTrack.queueWindowResolver,
        });
      }
      const switching = switchCollection();
      if (!targetTrack) {
        artworkTranslateX.setValue(0);
        isArtworkSettling.current = false;
      }
      void switching.catch(() => {
        swipeCommitTargetIdRef.current = null;
        setOptimisticTrack(null);
      });
    });
  }, [artworkTranslateX, committedTrack]);
  const trackSwipeResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => !isArtworkSettling.current && Math.abs(gesture.dx) > 12 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.2,
    onMoveShouldSetPanResponderCapture: (_, gesture) => !isArtworkSettling.current && Math.abs(gesture.dx) > 12 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.2,
    onPanResponderGrant: () => {
      artworkTranslateX.stopAnimation();
      artworkGestureNavigationRef.current = { ...artworkNavigationRef.current };
      artworkGestureDirectionRef.current = 0;
    },
    onPanResponderMove: (_, gesture) => {
      const navigation = artworkGestureNavigationRef.current ?? artworkNavigationRef.current;
      if (artworkGestureDirectionRef.current === 0 && Math.abs(gesture.dx) > 12) artworkGestureDirectionRef.current = gesture.dx < 0 ? -1 : 1;
      const direction = artworkGestureDirectionRef.current;
      const lockedDx = direction === 0 ? gesture.dx : direction * Math.max(0, direction * gesture.dx);
      const canMove = direction < 0 ? navigation.hasNext : navigation.hasPrevious;
      const resistance = canMove ? 1 : 0.18;
      artworkTranslateX.setValue(Math.max(-navigation.step, Math.min(navigation.step, lockedDx * resistance)));
    },
    onPanResponderRelease: (_, gesture) => {
      const navigation = artworkGestureNavigationRef.current ?? artworkNavigationRef.current;
      const direction = artworkGestureDirectionRef.current || (gesture.dx < 0 ? -1 : 1);
      const distance = Math.max(0, direction * gesture.dx);
      const velocity = Math.max(0, direction * gesture.vx);
      const shouldSwitch = distance > Math.min(82, navigation.step * 0.24) || velocity > 0.62;
      artworkGestureNavigationRef.current = null;
      artworkGestureDirectionRef.current = 0;
      if (direction < 0 && shouldSwitch && navigation.hasNext) {
        settleArtwork(-navigation.step, navigation.next, navigation.nextTrack);
        return;
      }
      if (direction > 0 && shouldSwitch && navigation.hasPrevious) {
        settleArtwork(navigation.step, navigation.previous, navigation.previousTrack);
        return;
      }
      settleArtwork(0);
    },
    onPanResponderTerminate: () => {
      artworkGestureNavigationRef.current = null;
      artworkGestureDirectionRef.current = 0;
      settleArtwork(0);
    },
    onPanResponderTerminationRequest: () => false,
  }), [artworkTranslateX, settleArtwork]);
  const previousArtworkScale = artworkTranslateX.interpolate({ inputRange: [0, artworkStep], outputRange: [sideArtworkScale, 1], extrapolate: 'clamp' });
  const previousArtworkOpacity = artworkTranslateX.interpolate({ inputRange: [0, artworkStep], outputRange: [0.42, 1], extrapolate: 'clamp' });
  const currentArtworkScale = artworkTranslateX.interpolate({ inputRange: [-artworkStep, 0, artworkStep], outputRange: [sideArtworkScale, 1, sideArtworkScale], extrapolate: 'clamp' });
  const currentArtworkOpacity = artworkTranslateX.interpolate({ inputRange: [-artworkStep, 0, artworkStep], outputRange: [0.42, 1, 0.42], extrapolate: 'clamp' });
  const nextArtworkScale = artworkTranslateX.interpolate({ inputRange: [-artworkStep, 0], outputRange: [1, sideArtworkScale], extrapolate: 'clamp' });
  const nextArtworkOpacity = artworkTranslateX.interpolate({ inputRange: [-artworkStep, 0], outputRange: [1, 0.42], extrapolate: 'clamp' });
  const displayedAdjacentCollectionIndexes = adjacentCollectionIndexesForTrack(track);
  const displayedCurrentIndex = activeQueueIndex(track);
  const currentArtworkTrack = displayedCurrentIndex >= 0
    ? track.queue?.[displayedCurrentIndex] ?? track
    : track;
  const previousArtworkTrack = displayedAdjacentCollectionIndexes.previous >= 0
    ? track.queue?.[displayedAdjacentCollectionIndexes.previous] ?? null
    : null;
  const nextArtworkTrack = displayedAdjacentCollectionIndexes.next >= 0
    ? track.queue?.[displayedAdjacentCollectionIndexes.next] ?? null
    : null;
  const previousArtworkUrl = displayedAdjacentCollectionIndexes.previous >= 0
    ? expandedPlayerArtwork(
        previousArtworkTrack?.artworkUrl,
        previousArtworkTrack?.provider ?? track.provider,
      )
    : null;
  const nextArtworkUrl = displayedAdjacentCollectionIndexes.next >= 0
    ? expandedPlayerArtwork(
        nextArtworkTrack?.artworkUrl,
        nextArtworkTrack?.provider ?? track.provider,
      )
    : null;
  const currentArtworkUrl = expandedPlayerArtwork(track.artworkUrl, track.provider);
  if (!isVisible) return null;

  const expandedContent = <View style={localStyles.modalBackdrop}>
      <Animated.View
        {...dismissResponder.panHandlers}
        style={[
          localStyles.expandedCard,
          Platform.OS === 'web' ? localStyles.expandedCardWebSafeArea : null,
          { transform: [{ translateY: dismissTranslateY }] },
        ]}
      >
        <View style={[localStyles.expandedHeader, Platform.OS === 'web' ? localStyles.expandedHeaderWebSafeArea : null]}>
          <View style={localStyles.expandedHeaderSide}><Pressable accessibilityLabel="Свернуть плеер" hitSlop={10} onPress={() => dismissPlayer()} style={localStyles.expandedHeaderButton}><ChevronDown color="#111" size={28} strokeWidth={2} /></Pressable></View>
          <View pointerEvents="none" style={localStyles.expandedHeaderTitle}>
            <MarqueeTrackTitle header title={track.collectionTitle?.trim() || providerName(track.provider)} />
            {releaseTrackPosition ? (
              <View accessibilityLabel={`Трек ${releaseTrackPosition.position} из ${releaseTrackPosition.total}`} accessible style={localStyles.expandedHeaderTrackPosition}>
                <ListMusic color="#6f7b86" size={13} strokeWidth={1.9} />
                <Text numberOfLines={1} style={localStyles.expandedHeaderTrackPositionText}>Трек: {releaseTrackPosition.position}/{releaseTrackPosition.total}</Text>
              </View>
            ) : null}
          </View>
          <View style={localStyles.expandedHeaderActions}>
            <Pressable accessibilityLabel="Выбрать устройство воспроизведения" hitSlop={8} onPress={() => void audio.selectOutputDevice()} style={localStyles.expandedHeaderButton}><Airplay color="#111" size={22} strokeWidth={1.8} /></Pressable>
          <Pressable accessibilityLabel="Поделиться треком" accessibilityRole="button" hitSlop={8} onPress={audio.openReleaseShare} style={localStyles.expandedHeaderButton}><Share color="#111" size={22} strokeWidth={1.8} /></Pressable>
          </View>
        </View>
        <View style={localStyles.expandedMainSection}>
          <View {...trackSwipeResponder.panHandlers} style={localStyles.expandedTopSection}>
            <View style={[localStyles.expandedArtworkCarousel, { height: artworkSize, width: artworkSize }]}>
              {previousArtworkUrl && previousArtworkTrack ? <AppAnimatedImage {...({ pointerEvents: 'none' } as any)} key={artworkCarouselKey(previousArtworkTrack)} source={{ uri: previousArtworkUrl }} style={[localStyles.expandedSideArtwork, { height: artworkSize, width: artworkSize, opacity: previousArtworkOpacity, transform: [{ translateX: Animated.add(artworkTranslateX, -artworkStep) }, { scale: previousArtworkScale }] }]} /> : null}
              {currentArtworkUrl ? <AppAnimatedImage {...({ pointerEvents: 'none' } as any)} key={artworkCarouselKey(currentArtworkTrack)} source={{ uri: currentArtworkUrl }} style={[localStyles.expandedArtwork, { height: artworkSize, width: artworkSize, opacity: currentArtworkOpacity, transform: [{ translateX: artworkTranslateX }, { scale: currentArtworkScale }] }]} /> : <Animated.View key={artworkCarouselKey(currentArtworkTrack)} pointerEvents="none" style={[localStyles.expandedArtwork, localStyles.expandedArtworkFallback, { height: artworkSize, width: artworkSize, opacity: currentArtworkOpacity, transform: [{ translateX: artworkTranslateX }, { scale: currentArtworkScale }] }]}><Text style={localStyles.expandedArtworkFallbackText}>♪</Text></Animated.View>}
              {nextArtworkUrl && nextArtworkTrack ? <AppAnimatedImage {...({ pointerEvents: 'none' } as any)} key={artworkCarouselKey(nextArtworkTrack)} source={{ uri: nextArtworkUrl }} style={[localStyles.expandedSideArtwork, { height: artworkSize, width: artworkSize, opacity: nextArtworkOpacity, transform: [{ translateX: Animated.add(artworkTranslateX, artworkStep) }, { scale: nextArtworkScale }] }]} /> : null}
            </View>
          </View>
          <View {...trackSwipeResponder.panHandlers} style={localStyles.expandedIdentitySection}>
            <View style={localStyles.expandedIdentityRow}>
            <View style={localStyles.expandedIdentityCopy}>
              <MarqueeTrackTitle title={track.title} />
              {track.artist ? track.isLiveStream && track.radioPageUsername?.trim() ? (
                <View style={localStyles.expandedRadioMetaRow}>
                  <Text numberOfLines={1} style={localStyles.expandedRadioArtist}>{track.artist}</Text>
                  <Pressable
                    accessibilityLabel={`Открыть радиостанцию @${track.radioPageUsername.trim()}`}
                    accessibilityRole="link"
                    hitSlop={6}
                    onPress={() => {
                      openLinkedEntity('community', track.radioPageUsername!.trim());
                    }}
                    style={localStyles.expandedRadioUsernameHitbox}
                  >
                    <Text numberOfLines={1} style={localStyles.expandedRadioUsername}>@{track.radioPageUsername.trim()}</Text>
                  </Pressable>
                </View>
              ) : <Text numberOfLines={1} style={localStyles.expandedArtist}>{track.artist}</Text> : null}
              {track.releaseId || releaseParticipants.length ? (
                <View style={localStyles.expandedLabelRow}>
                  {track.releaseId ? <>
                    <Disc3 color="#6f7b86" size={14} strokeWidth={1.9} style={localStyles.expandedLabelIcon} />
                    {track.labelUsername && hasReleaseLabel ? (
                      <Pressable
                        accessibilityLabel={`Открыть лейбл ${track.labelName!.trim()}`}
                        accessibilityRole="link"
                        hitSlop={6}
                        onPress={() => {
                          openLinkedEntity('community', track.labelUsername!);
                        }}
                        style={localStyles.expandedLabelLinkHitbox}
                      >
                        <Text numberOfLines={1} style={localStyles.expandedLabelLink}>{track.labelName!.trim()}</Text>
                      </Pressable>
                    ) : <Text numberOfLines={1} style={localStyles.expandedLabelFallback}>{track.labelName?.trim() || 'отсутствует или неизвестен'}</Text>}
                  </> : null}
                  {releaseParticipants.length ? <>
                    {track.releaseId && hasReleaseLabel ? <Text accessibilityElementsHidden importantForAccessibility="no" style={localStyles.expandedMetadataSeparator}>·</Text> : null}
                    <View style={[localStyles.expandedParticipantsGroup, track.releaseId && !hasReleaseLabel && localStyles.expandedParticipantsGroupWithoutLabel]}>
                      <UsersRound color="#6f7b86" size={14} strokeWidth={1.9} style={localStyles.expandedParticipantsIcon} />
                      <Text numberOfLines={1} style={localStyles.expandedParticipantsText}>
                        {releaseParticipants.map((participant, index) => (
                          <Text
                            accessibilityRole={participant.username ? 'link' : undefined}
                            key={participant.key}
                            onPress={participant.username && (participant.entityType === 'account' ? onOpenProfile : onOpenPublicPage) ? () => {
                              openLinkedEntity(participant.entityType, participant.username!);
                            } : undefined}
                            style={participant.username ? localStyles.expandedParticipantLink : localStyles.expandedParticipantFallback}
                          >
                            {index ? ', ' : ''}{participant.label}
                          </Text>
                        ))}
                      </Text>
                    </View>
                  </> : null}
                </View>
              ) : null}
              {previewLabel ? <Text style={localStyles.expandedPreviewLabel}>{previewLabel}</Text> : null}
            </View>
            {audio.canSaveRadio ? <PlayerAnimatedButton accessibilityLabel={audio.isSavedRadio ? 'Удалить радиостанцию из избранного' : 'Добавить радиостанцию в избранное'} disabled={audio.isSavingRadio} onPress={() => void audio.toggleFavoriteRadio()} style={localStyles.addToMusicButton}>{audio.isSavingRadio ? <ActivityIndicator color="#111" size="small" /> : <AnimatedStateIcon active={audio.isSavedRadio} activeIcon={<Check color="#111" size={25} strokeWidth={2.2} />} inactiveIcon={<Plus color="#111" size={25} strokeWidth={2.1} />} size={25} />}</PlayerAnimatedButton> : audio.canSaveToMyMusic ? <PlayerAnimatedButton accessibilityLabel={audio.isSavedToMyMusic ? 'Удалить трек из моей музыки' : 'Добавить трек в мою музыку'} disabled={audio.isSavingToMyMusic} onPress={() => void audio.toggleMyMusic()} style={localStyles.addToMusicButton}><AnimatedStateIcon active={audio.isSavedToMyMusic} activeIcon={<Check color="#111" size={25} strokeWidth={2.2} />} inactiveIcon={<Plus color="#111" size={25} strokeWidth={2.1} />} size={25} /></PlayerAnimatedButton> : null}
            </View>
            {track.provider === 'soundcloud' && audio.soundcloudDiagnostic ? <Pressable accessibilityRole="button" onPress={() => void Clipboard.setStringAsync(audio.soundcloudDiagnostic!)} style={localStyles.soundcloudDiagnostic}><Text selectable style={localStyles.soundcloudDiagnosticTitle}>SoundCloud не начал воспроизведение</Text><Text selectable style={localStyles.soundcloudDiagnosticText}>{audio.soundcloudDiagnostic}</Text><Text style={localStyles.soundcloudDiagnosticAction}>Нажмите, чтобы скопировать диагностику</Text></Pressable> : null}
          </View>
          {!track.isLiveStream ? <View style={localStyles.expandedLibraryActions}>
            {isCatalogFragment ? (
              <Pressable
                accessibilityLabel={audio.isSavedToMyMusic ? 'Удалить сохранённый фрагмент' : 'Сохранить фрагмент'}
                accessibilityRole="button"
                disabled={!audio.canSaveToMyMusic || audio.isSavingToMyMusic}
                onPress={() => void audio.toggleMyMusic()}
                style={[localStyles.expandedLibraryButton, (!audio.canSaveToMyMusic || audio.isSavingToMyMusic) && localStyles.expandedLibraryButtonDisabled]}
              >
                <Text style={localStyles.expandedLibraryButtonText}>Сохранить фрагмент</Text>
                {audio.isSavingToMyMusic ? <ActivityIndicator color="#53606c" size="small" /> : audio.isSavedToMyMusic ? <Check color="#53606c" size={17} strokeWidth={2.1} /> : <Plus color="#53606c" size={17} strokeWidth={1.9} />}
              </Pressable>
            ) : <>
              <Pressable accessibilityLabel={isTrackInPlaylist ? 'Удалить трек из плейлиста' : 'Добавить в плейлист'} accessibilityRole="button" disabled={Boolean(savingPlaylistId)} onPress={() => isTrackInPlaylist ? void removeTrackFromPlaylists() : void openPlaylistPicker()} style={[localStyles.expandedLibraryButton, savingPlaylistId && localStyles.expandedLibraryButtonDisabled]}><Text style={localStyles.expandedLibraryButtonText}>В плейлист</Text>{savingPlaylistId === '__remove__' ? <ActivityIndicator color="#53606c" size="small" /> : isTrackInPlaylist ? <Check color="#53606c" size={17} strokeWidth={2.1} /> : <ListPlus color="#53606c" size={17} strokeWidth={1.9} />}</Pressable>
              <Pressable accessibilityLabel={isTrackInListenLater ? 'Удалить релиз из отложенных' : 'Добавить релиз в отложенные'} accessibilityRole="button" disabled={isSavingListenLater} onPress={() => void toggleListenLater()} style={[localStyles.expandedLibraryButton, isSavingListenLater && localStyles.expandedLibraryButtonDisabled]}><Text style={localStyles.expandedLibraryButtonText}>Слушать позже</Text>{isSavingListenLater ? <ActivityIndicator color="#53606c" size="small" /> : isTrackInListenLater ? <Check color="#53606c" size={17} strokeWidth={2.1} /> : <ListTodo color="#53606c" size={17} strokeWidth={1.9} />}</Pressable>
            </>}
          </View> : null}
          <ExpandedBottomControls audio={audio} track={track} />
        </View>
        <ExpandedProviderLink track={track} />
        <AppSheetModal contentContainerStyle={localStyles.playlistPickerContent} isVisible={isPlaylistPickerVisible} onClose={() => !savingPlaylistId && setIsPlaylistPickerVisible(false)} scroll={playlists.length > 5} title="Добавить в плейлист">
          {isLoadingPlaylists ? <View style={localStyles.playlistPickerLoading}><ActivityIndicator color="#111" /></View> : playlists.length ? playlists.map((playlist) => <Pressable accessibilityLabel={`Добавить в плейлист ${playlist.name}`} accessibilityRole="button" disabled={Boolean(savingPlaylistId)} key={playlist.id} onPress={() => void addTrackToPlaylist(playlist)} style={localStyles.playlistPickerRow}>{playlist.artworkThumbnailUrl || playlist.artworkUrl ? <Image source={{ uri: playlist.artworkThumbnailUrl ?? playlist.artworkUrl! }} style={localStyles.playlistPickerArtwork} /> : <View style={localStyles.playlistPickerArtworkFallback}><ListPlus color="#53606c" size={19} /></View>}<View style={localStyles.playlistPickerCopy}><Text numberOfLines={1} style={localStyles.playlistPickerTitle}>{playlist.name}</Text><Text style={localStyles.playlistPickerMeta}>{playlist.tracks.length} тр.</Text></View>{savingPlaylistId === playlist.id ? <ActivityIndicator color="#111" size="small" /> : <Plus color="#53606c" size={21} />}</Pressable>) : <Text style={localStyles.playlistPickerEmpty}>У вас пока нет плейлистов. Создать их можно в разделе «Мои треки».</Text>}
        </AppSheetModal>
      </Animated.View>
    </View>;

  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    return createPortal(createElement('div', {
      style: {
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        overflow: 'hidden',
        display: 'flex',
      },
    }, expandedContent), document.body);
  }

  return <Modal animationType="none" onRequestClose={() => dismissPlayer()} presentationStyle="overFullScreen" statusBarTranslucent transparent visible={isVisible}>
    {expandedContent}
  </Modal>;
});

const LiveStreamWaveBar = memo(function LiveStreamWaveBar({
  active,
  barHeight,
  barWidth,
  left,
  reduceMotion,
}: {
  active: boolean;
  barHeight: number;
  barWidth: number;
  left: number;
  reduceMotion: boolean;
}) {
  const scaleY = useRef(new Animated.Value(0.28 + Math.random() * 0.64)).current;

  useEffect(() => {
    let disposed = false;
    let animation: Animated.CompositeAnimation | null = null;

    const animateNext = () => {
      if (disposed || !active || reduceMotion) return;
      animation = Animated.timing(scaleY, {
        toValue: 0.18 + Math.random() * 0.82,
        duration: 90 + Math.round(Math.random() * 190),
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: Platform.OS !== 'web',
      });
      animation.start(({ finished }) => {
        if (finished && !disposed) animateNext();
      });
    };

    if (!active || reduceMotion) {
      scaleY.stopAnimation();
      scaleY.setValue(0.32);
      return () => {
        disposed = true;
      };
    }

    animateNext();
    return () => {
      disposed = true;
      animation?.stop();
      scaleY.stopAnimation();
    };
  }, [active, reduceMotion, scaleY]);

  return (
    <Animated.View
      style={[
        localStyles.liveStreamWaveBar,
        {
          left,
          top: (30 - barHeight) / 2,
          width: barWidth,
          height: barHeight,
          borderRadius: barWidth / 2,
          transform: [{ scaleY }],
        },
      ]}
    />
  );
});

const LiveStreamWave = memo(function LiveStreamWave({ active }: { active: boolean }) {
  const [width, setWidth] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => subscription.remove();
  }, []);

  const barCount = Math.max(14, Math.min(28, Math.round(width / 16)));
  const barWidth = Math.max(2, Math.min(4, width / 140));
  const barHeight = Math.max(14, Math.min(22, width / 16));
  const availableWidth = Math.max(0, width - barWidth);

  return (
    <View
      accessibilityLabel={active ? 'Анимация прямого эфира' : 'Прямой эфир приостановлен'}
      onLayout={(event) => setWidth(Math.max(1, event.nativeEvent.layout.width))}
      pointerEvents="none"
      style={localStyles.liveStreamWave}
    >
      {width > 0 && Array.from({ length: barCount }, (_, index) => {
        const left = barCount > 1 ? index * (availableWidth / (barCount - 1)) : availableWidth / 2;
        return (
          <LiveStreamWaveBar
            active={active}
            barHeight={barHeight}
            barWidth={barWidth}
            key={index}
            left={left}
            reduceMotion={reduceMotion}
          />
        );
      })}
    </View>
  );
});

const ExpandedBottomControls = memo(function ExpandedBottomControls({ audio, track }: { audio: GlobalAudioControlsContextValue; track: GlobalTrack }) {
  const { durationSeconds, progress } = useGlobalAudioProgress();
  const progressWidth = useRef(1);
  const scrubStartX = useRef(0);
  const webScrubProgress = useRef<number | null>(null);
  const webScrubPointerId = useRef<number | null>(null);
  const isScrubbing = useRef(false);
  const settleTarget = useRef<number | null>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [scrubProgress, setScrubProgress] = useState<number | null>(null);

  useEffect(() => {
    const target = settleTarget.current;
    if (isScrubbing.current || target === null || Math.abs(progress - target) > 0.015) return;
    settleTarget.current = null;
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = null;
    setScrubProgress(null);
  }, [progress]);
  useEffect(() => () => { if (settleTimer.current) clearTimeout(settleTimer.current); }, []);

  const updateScrub = useCallback((localX: number, commit = false) => {
    if (!Number.isFinite(localX) || progressWidth.current <= 0) return;
    const next = Math.min(1, Math.max(0, localX / progressWidth.current));
    setScrubProgress(next);
    if (!commit) return;
    settleTarget.current = next;
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      settleTarget.current = null;
      settleTimer.current = null;
      setScrubProgress(null);
    }, 900);
    void audio.seek(next).catch(() => {
      settleTarget.current = null;
      if (settleTimer.current) clearTimeout(settleTimer.current);
      settleTimer.current = null;
      setScrubProgress(null);
    });
  }, [audio.seek]);
  const scrubResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 2 && Math.abs(gesture.dx) >= Math.abs(gesture.dy),
    onPanResponderGrant: (event) => {
      isScrubbing.current = true;
      settleTarget.current = null;
      if (settleTimer.current) clearTimeout(settleTimer.current);
      scrubStartX.current = Number(event.nativeEvent.locationX);
      updateScrub(scrubStartX.current);
    },
    onPanResponderMove: (_event, gesture) => updateScrub(scrubStartX.current + gesture.dx),
    onPanResponderReject: () => {
      isScrubbing.current = false;
      settleTarget.current = null;
      setScrubProgress(null);
    },
    onPanResponderRelease: (_event, gesture) => {
      isScrubbing.current = false;
      updateScrub(scrubStartX.current + gesture.dx, true);
    },
    onPanResponderTerminate: () => {
      isScrubbing.current = false;
      settleTarget.current = null;
      setScrubProgress(null);
    },
    onPanResponderTerminationRequest: () => false,
  }), [updateScrub]);
  const updateWebScrub = useCallback((element: HTMLElement, clientX: number, commit = false) => {
    const rect = element.getBoundingClientRect();
    if (!Number.isFinite(clientX) || rect.width <= 0) return;
    const next = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    webScrubProgress.current = next;
    updateScrub(next * progressWidth.current, commit);
  }, [updateScrub]);
  const displayedProgress = scrubProgress ?? progress;
  const displayedPosition = displayedProgress * durationSeconds;
  if (track.isLiveStream) {
    return <View style={localStyles.expandedBottomSection}>
      <LiveStreamWave active={audio.isPlaying && !audio.isAudioLoading} />
      <View style={localStyles.timerRow}><Text style={localStyles.liveTimerText}>ПРЯМОЙ ЭФИР</Text></View>
      <View style={localStyles.expandedControls}>
        <View style={localStyles.expandedModeButton} />
        <View style={localStyles.expandedSkip} />
        <PlayerAnimatedButton accessibilityLabel={audio.isAudioLoading ? 'Аудиопоток загружается' : audio.isPlaying ? 'Пауза' : 'Продолжить воспроизведение'} disabled={audio.isAudioLoading} onPress={() => audio.isPlaying ? audio.pause() : void audio.play(track)} style={localStyles.expandedPlay}>{audio.isAudioLoading ? <ActivityIndicator color="#fff" size="small" /> : <AnimatedStateIcon active={audio.isPlaying} activeIcon={<Pause color="#fff" fill="#fff" size={27} />} inactiveIcon={<Play color="#fff" fill="#fff" size={27} />} size={27} />}</PlayerAnimatedButton>
        <View style={localStyles.expandedSkip} />
        <View style={localStyles.expandedModeButton} />
      </View>
    </View>;
  }
  return <View style={localStyles.expandedBottomSection}>
    <View {...(Platform.OS === 'web' ? {} : scrubResponder.panHandlers)} accessibilityLabel="Перемотать трек" accessibilityRole="adjustable" onLayout={(event) => { progressWidth.current = Math.max(1, event.nativeEvent.layout.width); }} style={localStyles.expandedProgressHitbox}>
      <View pointerEvents="none" style={localStyles.expandedProgressTrack}><View style={[localStyles.expandedProgressFill, { width: `${displayedProgress * 100}%` }]} /></View>
      <View pointerEvents="none" style={[localStyles.expandedProgressThumb, { left: `${displayedProgress * 100}%` }]} />
      {Platform.OS === 'web' ? createElement('div', {
        'aria-label': 'Перемотать трек', 'aria-valuemax': durationSeconds, 'aria-valuemin': 0, 'aria-valuenow': displayedPosition,
        onKeyDown: (event: KeyboardEvent & { currentTarget: HTMLElement }) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          event.preventDefault();
          const next = Math.min(1, Math.max(0, displayedProgress + (event.key === 'ArrowRight' ? 0.01 : -0.01)));
          updateScrub(next * progressWidth.current, true);
        },
        onLostPointerCapture: (event: PointerEvent & { currentTarget: HTMLElement }) => {
          if (webScrubPointerId.current !== event.pointerId) return;
          const finalProgress = webScrubProgress.current;
          webScrubPointerId.current = null;
          isScrubbing.current = false;
          webScrubProgress.current = null;
          if (finalProgress === null) setScrubProgress(null);
          else updateScrub(finalProgress * progressWidth.current, true);
        },
        onPointerCancel: (event: PointerEvent & { currentTarget: HTMLElement }) => {
          if (webScrubPointerId.current !== event.pointerId) return;
          webScrubPointerId.current = null;
          isScrubbing.current = false;
          webScrubProgress.current = null;
          settleTarget.current = null;
          setScrubProgress(null);
        },
        onPointerDown: (event: PointerEvent & { currentTarget: HTMLElement }) => {
          if (webScrubPointerId.current !== null) return;
          event.preventDefault();
          webScrubPointerId.current = event.pointerId;
          isScrubbing.current = true;
          settleTarget.current = null;
          if (settleTimer.current) clearTimeout(settleTimer.current);
          event.currentTarget.setPointerCapture?.(event.pointerId);
          updateWebScrub(event.currentTarget, event.clientX);
        },
        onPointerMove: (event: PointerEvent & { currentTarget: HTMLElement }) => {
          if (webScrubPointerId.current !== event.pointerId || !isScrubbing.current) return;
          event.preventDefault();
          updateWebScrub(event.currentTarget, event.clientX);
        },
        onPointerUp: (event: PointerEvent & { currentTarget: HTMLElement }) => {
          if (webScrubPointerId.current !== event.pointerId) return;
          event.preventDefault();
          updateWebScrub(event.currentTarget, event.clientX, true);
          webScrubPointerId.current = null;
          isScrubbing.current = false;
          webScrubProgress.current = null;
          if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture?.(event.pointerId);
        },
        role: 'slider', tabIndex: 0,
        style: { cursor: 'pointer', height: '100%', inset: 0, position: 'absolute', touchAction: 'none', userSelect: 'none', width: '100%', zIndex: 2 },
      }) : null}
    </View>
    <View style={localStyles.timerRow}><Text style={localStyles.timerText}>{formatPlayerTime(displayedPosition)}</Text><Text style={localStyles.timerText}>{formatPlayerTime(durationSeconds)}</Text></View>
    <View style={localStyles.expandedControls}>
      <PlayerAnimatedButton accessibilityLabel={audio.isShuffleEnabled ? 'Выключить случайный порядок' : 'Включить случайный порядок'} onPress={audio.toggleShuffle} style={localStyles.expandedModeButton}><AnimatedStateIcon active={audio.isShuffleEnabled} activeIcon={<Shuffle color="#111" size={22} strokeWidth={2.3} />} inactiveIcon={<Shuffle color="#6f7b86" size={22} strokeWidth={1.9} />} size={22} /></PlayerAnimatedButton>
      <PlayerAnimatedButton accessibilityLabel="Предыдущий трек" disabled={!audio.hasPreviousTrack} onPress={() => void audio.playPrevious()} style={[localStyles.expandedSkip, !audio.hasPreviousTrack && localStyles.expandedSkipDisabled]}><SkipBack color="#111" fill="#111" size={25} /></PlayerAnimatedButton>
      <PlayerAnimatedButton accessibilityLabel={audio.isAudioLoading ? 'Аудио загружается' : audio.isPlaying ? 'Пауза' : 'Продолжить воспроизведение'} disabled={audio.isAudioLoading} onPress={() => audio.isPlaying ? audio.pause() : void audio.play(track)} style={localStyles.expandedPlay}>{audio.isAudioLoading ? <ActivityIndicator color="#fff" size="small" /> : <AnimatedStateIcon active={audio.isPlaying} activeIcon={<Pause color="#fff" fill="#fff" size={27} />} inactiveIcon={<Play color="#fff" fill="#fff" size={27} />} size={27} />}</PlayerAnimatedButton>
      <PlayerAnimatedButton accessibilityLabel="Следующий трек" disabled={!audio.hasNextTrack} onPress={() => void audio.playNext()} style={[localStyles.expandedSkip, !audio.hasNextTrack && localStyles.expandedSkipDisabled]}><SkipForward color="#111" fill="#111" size={25} /></PlayerAnimatedButton>
      <PlayerAnimatedButton accessibilityLabel={audio.isRepeatEnabled ? 'Выключить повтор трека' : 'Повторять текущий трек'} onPress={audio.toggleRepeat} style={localStyles.expandedModeButton}><AnimatedStateIcon active={audio.isRepeatEnabled} activeIcon={<Repeat1 color="#111" size={24} strokeWidth={2.3} />} inactiveIcon={<Repeat2 color="#6f7b86" size={24} strokeWidth={1.9} />} size={24} /></PlayerAnimatedButton>
    </View>
  </View>;
});

const ExpandedProviderLink = memo(function ExpandedProviderLink({ track }: { track: GlobalTrack }) {
  const link = providerLink(track.provider, track.externalUrl);
  const safeUrl = normalizeExternalHttpsUrl(link?.url);
  return <View style={[localStyles.externalLinkSlot, Platform.OS === 'web' ? localStyles.externalLinkSlotWebSafeArea : null]}>{link && safeUrl ? <Pressable accessibilityLabel={link.label} accessibilityRole="link" hitSlop={8} onPress={() => void openExternalHttpsUrl(safeUrl)} style={[localStyles.externalLink, track.provider === 'bandcamp' && localStyles.bandcampExternalLink, track.provider === 'soundcloud' && localStyles.soundcloudExternalLink]}>{track.provider === 'bandcamp' ? <BandcampLogo /> : track.provider === 'soundcloud' ? <SoundcloudLogo /> : <Text style={localStyles.externalLinkText}>{link.label}</Text>}</Pressable> : null}</View>;
});

function formatPlayerTime(seconds: number) {
  const value = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}

const playerMediaOutline = Platform.OS === 'web'
  ? ({ boxShadow: 'inset 0 0 0 1px rgb(226, 231, 236)' } as const)
  : ({ borderWidth: 1, borderColor: 'rgb(226, 231, 236)' } as const);

const localStyles = StyleSheet.create({
  shell: { position: 'absolute', zIndex: 30, left: 10, right: 10, height: 58, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.72)', borderRadius: 29, backgroundColor: 'rgba(255,255,255,0.88)', overflow: 'hidden', ...(Platform.OS === 'web' ? { backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)', boxShadow: 'rgba(0, 0, 0, 0.1) 0px 5px 18px' } : { shadowColor: '#000', shadowOpacity: 0.14, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 8 }) },
  artwork: { ...playerMediaOutline, width: 44, height: 44, borderRadius: 22, backgroundColor: '#d7dee5' },
  artworkFallback: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: '#d7dee5' },
  artworkFallbackText: { color: '#53606c', fontSize: 19 },
  copy: { flex: 1, minWidth: 0 },
  title: { color: '#111', fontSize: 14, lineHeight: 18, fontWeight: '600' },
  artist: { marginTop: 1, color: '#606c78', fontSize: 12, lineHeight: 16 },
  control: { width: 32, height: 42, alignItems: 'center', justifyContent: 'center' },
  miniSaveControl: { width: 34, height: 34 },
  miniControlDisabled: { opacity: 0.25 },
  playerAnimatedButtonContent: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  playerStateIconLayer: { position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' },
  progressTrack: { position: 'absolute', left: 18, right: 18, bottom: 2, height: 2, borderRadius: 1, overflow: 'hidden', backgroundColor: 'rgba(0,0,0,0.12)' },
  progressFill: { height: 2, backgroundColor: '#111' },
  modalBackdrop: { flex: 1, backgroundColor: 'transparent' },
  expandedCard: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    paddingHorizontal: 45,
    // Keep the center stage geometrically centered between equally sized
    // header/provider slots. The provider itself stays pinned to the bottom.
    paddingBottom: Platform.OS === 'ios' ? 90 : 78,
    paddingTop: Platform.OS === 'ios' ? 90 : 78,
    backgroundColor: '#f3f5f7',
    backfaceVisibility: 'hidden',
    ...(Platform.OS === 'web' ? { willChange: 'transform' as const } : null),
  },
  expandedCardWebSafeArea: { paddingTop: 'calc(78px + env(safe-area-inset-top, 0px))' as unknown as number, paddingBottom: 'calc(78px + env(safe-area-inset-bottom, 0px))' as unknown as number },
  expandedHeader: { position: 'absolute', left: 12, right: 12, top: Platform.OS === 'ios' ? 22 : 10, height: 60, zIndex: 2, flexDirection: 'row', alignItems: 'center' },
  expandedHeaderWebSafeArea: { top: 'calc(10px + env(safe-area-inset-top, 0px))' as unknown as number },
  expandedHeaderButton: { width: 40, height: 60, alignItems: 'center', justifyContent: 'center' },
  expandedHeaderSide: { width: 80, height: 60, flexDirection: 'row', alignItems: 'center' },
  expandedHeaderTitle: { flex: 1, minWidth: 0, height: 60, alignItems: 'center', justifyContent: 'center' },
  expandedHeaderTrackPosition: { marginTop: 2, flexDirection: 'row', alignItems: 'center', gap: 4 },
  expandedHeaderTrackPositionText: { color: '#6f7b86', fontSize: 11, lineHeight: 14, fontWeight: '400' },
  expandedHeaderCollection: { color: '#111', fontSize: 14, lineHeight: 18, fontWeight: '600', textAlign: 'center' },
  expandedHeaderActions: { width: 80, height: 60, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' },
  expandedMainSection: { flex: 1, width: '100%', justifyContent: 'center', gap: 14 },
  expandedTopSection: { width: '100%', alignItems: 'center', flexShrink: 0 },
  expandedArtworkCarousel: { position: 'relative' },
  expandedArtwork: { ...playerMediaOutline, maxWidth: '100%', borderRadius: 18, backgroundColor: '#d7dee5' },
  expandedSideArtwork: { ...playerMediaOutline, position: 'absolute', top: 0, borderRadius: 18, backgroundColor: '#d7dee5', opacity: 0.72 },
  expandedPreviousArtwork: { right: '100%' },
  expandedNextArtwork: { left: '100%' },
  expandedArtworkFallback: { alignItems: 'center', justifyContent: 'center' },
  expandedArtworkFallbackText: { color: '#606c78', fontSize: 48 },
  expandedIdentitySection: { width: '100%', minHeight: 56, justifyContent: 'center' },
  expandedIdentityRow: { width: '100%', flexDirection: 'row', alignItems: 'center', gap: 12 },
  expandedIdentityCopy: { flex: 1, minWidth: 0 },
  expandedTitle: { color: '#111', fontSize: 16, lineHeight: 20, fontWeight: '600' },
  profileMarqueeTitle: { color: '#111', fontSize: 13, lineHeight: 18, fontWeight: '400' },
  connectMarqueeTitle: { color: '#fff', fontSize: 12, lineHeight: 16, fontWeight: '600' },
  marqueeEmphasisPrefix: { fontWeight: '600' },
  marqueeEmphasisSuffix: { fontWeight: '500' },
  marqueeTitleViewport: { position: 'relative', width: '100%', height: 22, overflow: 'hidden', justifyContent: 'center' },
  miniMarqueeTitleViewport: { height: 18 },
  connectMarqueeTitleViewport: { height: 16 },
  headerMarqueeTitleViewport: { height: 18 },
  marqueeTitleText: { alignSelf: 'flex-start', flexShrink: 0 },
  marqueeMeasureText: { position: 'absolute', left: 0, top: 0, alignSelf: 'flex-start', flexShrink: 0, opacity: 0 },
  marqueeTitleTextWeb: { whiteSpace: 'nowrap', width: 'max-content' } as any,
  headerMarqueeTitleCentered: { alignSelf: 'center' },
  marqueeFadeLeft: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 18, zIndex: 2 },
  marqueeFadeRight: { position: 'absolute', right: 0, top: 0, bottom: 0, width: 18, zIndex: 2 },
  miniMarqueeFade: { width: 12 },
  expandedArtist: { marginTop: 3, color: '#606c78', fontSize: 14, lineHeight: 18, fontWeight: '600' },
  expandedRadioMetaRow: { marginTop: 3, alignItems: 'flex-start', minWidth: 0 },
  expandedRadioArtist: { maxWidth: '100%', color: '#606c78', fontSize: 16, lineHeight: 20, fontWeight: '600' },
  expandedRadioUsernameHitbox: { minWidth: 0, maxWidth: '100%', marginTop: 1 },
  expandedRadioUsername: { color: '#111', fontSize: 14, lineHeight: 20, fontWeight: '600', textDecorationLine: 'none' },
  expandedLabelRow: { marginTop: 8, flexDirection: 'row', alignItems: 'center', minWidth: 0 },
  expandedLabelIcon: { marginRight: 5, flexShrink: 0 },
  expandedLabelFallback: { minWidth: 0, flexShrink: 1, color: '#6f7b86', fontSize: 13, lineHeight: 17, fontWeight: '400' },
  expandedLabelLinkHitbox: { minWidth: 0, flexShrink: 1 },
  expandedLabelLink: { color: '#111', fontSize: 13, lineHeight: 17, fontWeight: '600', textDecorationLine: 'none' },
  expandedMetadataSeparator: { marginHorizontal: 7, flexShrink: 0, color: '#98a3ae', fontSize: 13, lineHeight: 17 },
  expandedParticipantsGroup: { minWidth: 0, flex: 1, flexDirection: 'row', alignItems: 'center' },
  expandedParticipantsGroupWithoutLabel: { marginLeft: 8 },
  expandedParticipantsIcon: { marginRight: 5, flexShrink: 0 },
  expandedParticipantsText: { minWidth: 0, flex: 1, color: '#323a43', fontSize: 13, lineHeight: 17, fontWeight: '400' },
  expandedParticipantFallback: { fontWeight: '400' },
  expandedParticipantLink: { color: '#111', fontWeight: '600', textDecorationLine: 'none' },
  expandedPreviewLabel: { marginTop: 3, color: '#7d8894', fontSize: 12, lineHeight: 16, fontWeight: '400' },
  expandedGenreMarqueeViewport: { position: 'relative', width: '100%', height: 28, overflow: 'hidden' },
  expandedGenreMarqueeContent: { alignSelf: 'flex-start', flexDirection: 'row', flexShrink: 0, gap: 6 },
  expandedGenreMarqueeMeasure: { position: 'absolute', left: 0, top: 0, opacity: 0 },
  expandedGenreMarqueeContentWeb: { width: 'max-content' } as any,
  expandedGenreTag: { minHeight: 28, borderRadius: 14, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#e8edf2' },
  expandedGenreTagText: { color: '#606c78', fontSize: 11, lineHeight: 15, fontWeight: '400' },
  expandedGenreName: { color: '#323a43', fontWeight: '600' },
  soundcloudDiagnostic: { marginTop: 12, borderRadius: 14, backgroundColor: '#fff0ed', paddingHorizontal: 14, paddingVertical: 12 },
  soundcloudDiagnosticTitle: { color: '#9f2418', fontSize: 13, fontWeight: '700', lineHeight: 18 },
  soundcloudDiagnosticText: { marginTop: 5, color: '#5c2520', fontSize: 10, lineHeight: 14 },
  soundcloudDiagnosticAction: { marginTop: 7, color: '#9f2418', fontSize: 11, fontWeight: '600', lineHeight: 15 },
  addToMusicButton: { width: 42, height: 42, flexShrink: 0, alignItems: 'center', justifyContent: 'center' },
  expandedBottomSection: { width: '100%', flexShrink: 0 },
  expandedLibraryActions: { width: '100%', flexDirection: 'row', gap: 8 },
  expandedLibraryButton: { minHeight: 34, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: '#d7dee5', backgroundColor: 'transparent' },
  expandedLibraryButtonDisabled: { opacity: 0.55 },
  expandedLibraryButtonText: { color: '#46515c', fontSize: 12, lineHeight: 16, fontWeight: '500' },
  playlistPickerLoading: { minHeight: 110, alignItems: 'center', justifyContent: 'center' },
  playlistPickerContent: { gap: 8 },
  playlistPickerRow: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 10, borderRadius: 10, backgroundColor: '#f3f5f7' },
  playlistPickerArtwork: { ...playerMediaOutline, width: 44, height: 44, borderRadius: 8, backgroundColor: '#d7dee5' },
  playlistPickerArtworkFallback: { width: 44, height: 44, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#d7dee5' },
  playlistPickerCopy: { flex: 1, minWidth: 0 },
  playlistPickerTitle: { color: '#111', fontSize: 14, lineHeight: 18, fontWeight: '600' },
  playlistPickerMeta: { marginTop: 2, color: '#6f7b86', fontSize: 12, lineHeight: 16 },
  playlistPickerEmpty: { paddingVertical: 24, color: '#6f7b86', fontSize: 14, lineHeight: 20, textAlign: 'center' },
  expandedProgressHitbox: { width: '100%', height: 30, justifyContent: 'center' },
  expandedProgressTrack: { height: 4, borderRadius: 2, overflow: 'hidden', backgroundColor: 'rgba(0,0,0,0.14)' },
  expandedProgressFill: { height: 4, borderRadius: 2, backgroundColor: '#111' },
  liveStreamWave: { position: 'relative', width: '100%', height: 30, overflow: 'hidden' },
  liveStreamWaveBar: { position: 'absolute', left: 0, backgroundColor: '#111' },
  expandedProgressThumb: { position: 'absolute', top: 8, width: 14, height: 14, marginLeft: -7, borderRadius: 7, backgroundColor: '#111' },
  timerRow: { width: '100%', flexDirection: 'row', justifyContent: 'space-between', marginTop: -3 },
  timerText: { color: '#6f7b86', fontSize: 11, lineHeight: 15 },
  liveTimerText: { color: '#6f7b86', fontSize: 11, fontWeight: '600', letterSpacing: 0.4, lineHeight: 15 },
  expandedControls: { minHeight: 50, marginTop: 0, width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  expandedModeButton: { width: 38, height: 48, alignItems: 'center', justifyContent: 'center' },
  expandedPlay: { width: 50, height: 50, alignItems: 'center', justifyContent: 'center', borderRadius: 25, backgroundColor: '#111' },
  expandedSkip: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  expandedSkipDisabled: { opacity: 0.25 },
  externalLinkSlot: { position: 'absolute', left: 0, right: 0, bottom: Platform.OS === 'ios' ? 14 : 10, height: 30, alignItems: 'center', justifyContent: 'center' },
  externalLinkSlotWebSafeArea: { bottom: 'calc(10px + env(safe-area-inset-bottom, 0px))' as unknown as number },
  externalLink: { paddingHorizontal: 8, paddingVertical: 3 },
  bandcampExternalLink: { width: 95, height: 15, paddingHorizontal: 0, paddingVertical: 0 },
  soundcloudExternalLink: { width: 110, height: 15, paddingHorizontal: 0, paddingVertical: 0 },
  externalLinkText: { color: '#7d8894', fontSize: 12, lineHeight: 16, fontWeight: '400', textDecorationLine: 'none' },
});
