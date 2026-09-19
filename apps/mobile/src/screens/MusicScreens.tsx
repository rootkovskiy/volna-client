import { isMusicLibraryProvider } from '@volna/music-taxonomy/library-policy';
import { LoadingIndicator } from '@volna/messaging-client/loading';
import { SearchField, searchFieldStyles } from '@volna/messaging-client/search-field';
import { MotionSurface } from '@volna/messaging-client/ui-motion';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { CalendarDays, Check, ChevronLeft, Download, FileAudio, Info, ListMusic, Pause, Pencil, Play, Plus, Radio, Trash2, X } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppImage as Image } from '../components/AppImage';
import { apiFetch as fetch, apiUrl, readApiError } from '../api/client';
import { audioReleaseGenreLimit, discardMusicArtworkAsset, discardMusicAsset, finalizeMusicAsset, isMusicSubgenreValue, musicArtworkThumbnail, prepareMusicAsset, releasePrimaryGenreLimit, uploadMusicArtworkAsset } from '../domain';
import type { AvatarCropAsset, MusicCatalogDestination, Profile, ProfileMusicTrack, ProfileUpdate, PublicUploadedMusicTrack, ToastMessage, UploadedMusicTrack } from '../types';
import { AvatarCropModal, buildFavoriteMusicQueue, MusicGenreSelector, ProfileMusicPlayerItem, TrackPlayerPill, UploadedMusicPlayerCard } from './ProfileScreens';
import { AppSheetModal } from '../components/AppSheetModal';
import { AppRefreshControl } from '../components/AppRefreshControl';
import { AnimatedSegmentedControl } from '../components/AnimatedSegmentedControl';
import { ExpandableReleaseTrackList } from '../components/ExpandableReleaseTrackList';
import { ExternalReleaseEditorField, type ExternalReleasePreview } from '../components/ExternalReleaseEditorField';
import { type GlobalTrackQueueItem, useGlobalAudioControls } from '../components/GlobalAudioPlayer';
import { emitMusicLibraryChanged, subscribeMusicLibraryChanged } from '../components/musicLibraryEvents';
import { AnimatedMusicLibraryRow } from '../components/AnimatedMusicLibraryRow';
import { ScreenTopBar } from '../components/navigation';
import { getBandcampRelease } from '../music/musicRuntime';
import { emptyReleaseDateDraft, releaseDateDraftReducer } from '../music/releaseDateAutofill';
import { styles } from '../styles';
import { CalendarPickerModal } from '../components/CalendarPickerModal';
import { boundedPlaybackQueue, listenLaterDisplayGroups, listenLaterPlaybackQueue, unreviewedQueue, uploadedTrackPlayerId } from '../components/audioPlayerCore';
import { CatalogInnerHeader } from '../components/CatalogInnerHeader';
import { CatalogBackArea } from '../components/CatalogBackArea';
import { PlaylistGrid } from '../components/PlaylistGrid';
import { PlaylistEditorSurface } from '../components/PlaylistEditorSurface';
import { MusicCategoryTile, musicCategoryStyles } from '../components/MusicCategoryTile';
import { playlistCategoryArtwork, resolvePlaylistArtwork } from '../music/playlistArtwork';
import { DownloadedMusic } from './DownloadedMusic';
import { supportsDeviceDownloads } from '../music/downloadDevice';
import { useDeviceDownloads } from '../music/deviceDownloads';
import { CatalogTabs } from '../components/CatalogTabs';
import { MusicDiscovery } from './MusicDiscovery';
import type { MusicCatalogItem } from '../music/musicCatalogSearch';

type MusicPlaylist = {
  id: string;
  name: string;
  tracks: string[];
  artworkKey?: string | null;
  artworkUrl?: string | null;
  artworkThumbnailKey?: string | null;
  artworkThumbnailUrl?: string | null;
  artworkUploadKey?: string;
  artworkLocalUri?: string;
  removeArtwork?: boolean;
};

type MusicLibraryResponse = {
  quota: { limitSeconds: number; usedSeconds: number; remainingSeconds: number };
  tracks: UploadedMusicTrack[];
  playlists: MusicPlaylist[];
};
type UploadProgress = {
  filename: string;
  stage: 'preparing' | 'uploading' | 'processing' | 'saving' | 'complete' | 'error';
  percent: number;
  error?: string;
};
type UploadDraft = {
  asset: { uri: string; name: string; mimeType: string; size?: number };
  uploadKey: string;
  title: string;
  artist: string;
  artworkUri: string | null;
  customArtwork: { uri: string; name: string; mimeType: string } | null;
  genres: string[];
  includeSelfAsParticipant: boolean;
  releaseDate: string;
};
type UploadEditDraft = {
  id: string;
  title: string;
  artist: string;
  artworkUrl: string | null;
  artworkUri: string | null;
  customArtwork: { uri: string; name: string; mimeType: string } | null;
  genres: string[];
  includeSelfAsParticipant: boolean;
  releaseDate: string;
};
type ListenLaterItem = {
  id: string;
  title: string;
  artist: string;
  artworkUrl: string | null;
  provider: NonNullable<GlobalTrackQueueItem['provider']>;
  collectionId: string | null;
  releaseId: string | null;
  tracks: Array<GlobalTrackQueueItem>;
  addedAt: string;
};
type FavoriteRadioStation = {
  id: string;
  username: string;
  name: string;
  avatarUrl: string | null;
  radioStreamUrl: string;
  isVerified: boolean;
  isFavorite: true;
};

function absolutePlaybackUrl(value: string) {
  return value.startsWith('/') ? `${apiUrl}${value}` : value;
}

function listenLaterQueueItem(item: ListenLaterItem, track: GlobalTrackQueueItem): GlobalTrackQueueItem {
  return {
    ...track,
    id: `listen:${item.id}:${track.id}`,
    listenLaterItemId: item.id,
    listenLaterTrackId: track.id,
    artworkUrl: track.artworkUrl ?? item.artworkUrl,
    previewUrl: absolutePlaybackUrl(track.previewUrl),
    collectionTitle: track.collectionTitle ?? item.title,
    collectionId: track.collectionId ?? item.collectionId ?? undefined,
    releaseId: track.releaseId ?? item.releaseId ?? undefined,
  };
}

function playlistTrackArtworkLookup(tracks: readonly ProfileMusicTrack[], uploads: readonly (UploadedMusicTrack | PublicUploadedMusicTrack)[]) {
  return new Map<string, string | null | undefined>([
    ...tracks.map((track) => [`profile:${track.provider}:${track.id}`, track.artworkUrl ? musicArtworkThumbnail(track.artworkUrl, track.provider, 300) ?? track.artworkUrl : null] as const),
    ...uploads.filter((track) => !('status' in track) || track.status === 'READY').map((track) => [`upload:${track.id}`, track.artworkUrl ? musicArtworkThumbnail(track.artworkUrl, 'volna', 300) ?? track.artworkUrl : null] as const),
  ]);
}

function initialTracks(profile: Profile): ProfileMusicTrack[] {
  return (profile.musicTracks ?? []).filter((track) => isMusicLibraryProvider(track.provider));
}

function minutes(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;
}

function externalReleaseProvider(value: string): 'soundcloud' | 'bandcamp' | null {
  try {
    const hostname = new URL(value.trim()).hostname.replace(/^www\./, '').toLowerCase();
    if (hostname === 'soundcloud.com' || hostname === 'on.soundcloud.com') return 'soundcloud';
    if (hostname === 'bandcamp.com' || hostname.endsWith('.bandcamp.com')) return 'bandcamp';
  } catch {
    return null;
  }
  return null;
}

function formatReleaseDateInput(value: Date) {
  return `${String(value.getDate()).padStart(2, '0')}.${String(value.getMonth() + 1).padStart(2, '0')}.${value.getFullYear()}`;
}

function releaseDateInputToIso(value: string) {
  const [day, month, year] = value.split('.');
  return day && month && year ? `${year}-${month}-${day}` : undefined;
}

function buildPlaylistQueue(trackKeys: readonly string[], favoriteTracks: readonly ProfileMusicTrack[], readyUploadedTracks: readonly (UploadedMusicTrack | PublicUploadedMusicTrack)[], ownerName: string): GlobalTrackQueueItem[] {
  return trackKeys.flatMap((trackKey): GlobalTrackQueueItem[] => {
      const profileMatch = /^profile:(apple|yandex|soundcloud|bandcamp|youtube):(.+)$/.exec(trackKey);
      if (profileMatch) {
        const track = favoriteTracks.find((item) => item.provider === profileMatch[1] && item.id === profileMatch[2]);
        return track ? buildFavoriteMusicQueue([track]) : [];
      }
      if (trackKey.startsWith('upload:')) {
        const track = readyUploadedTracks.find((item) => item.id === trackKey.slice('upload:'.length));
        return track?.publicUrl ? [{
          id: uploadedTrackPlayerId(track.id),
          title: track.title,
          artist: track.artist?.trim() || ownerName,
          artworkUrl: track.artworkUrl,
          previewUrl: `${apiUrl}/my-music/stream/${encodeURIComponent(track.id)}`,
          externalUrl: null,
          provider: 'volna',
          startSeconds: 0,
          clipDurationSeconds: track.durationSeconds,
          genres: track.genres,
          releaseDate: track.releaseDate,
        }] : [];
      }
      return [];
    });
}

function playlistTrackPlayer(trackKey: string, playlistQueue: GlobalTrackQueueItem[], favoriteTracks: readonly ProfileMusicTrack[], readyUploadedTracks: readonly (UploadedMusicTrack | PublicUploadedMusicTrack)[], ownerName: string) {
    if (trackKey.startsWith('profile:')) {
      const match = /^profile:(apple|yandex|soundcloud|bandcamp|youtube):(.+)$/.exec(trackKey);
      const track = match ? favoriteTracks.find((item) => item.provider === match[1] && item.id === match[2]) : null;
      return track ? <ProfileMusicPlayerItem key={trackKey} profileQueue={playlistQueue} showGenres={false} track={track} /> : (
        <Text key={trackKey} style={localStyles.playlistUnavailableTrack}>Трек больше недоступен</Text>
      );
    }
    if (trackKey.startsWith('upload:')) {
      const track = readyUploadedTracks.find((item) => item.id === trackKey.slice('upload:'.length));
      return track?.publicUrl ? (
        <TrackPlayerPill
          artist={track.artist?.trim() || ownerName}
          artworkUrl={track.artworkUrl}
          clipDurationSeconds={track.durationSeconds}
          externalUrl={null}
          key={trackKey}
          previewUrl={`${apiUrl}/my-music/stream/${encodeURIComponent(track.id)}`}
          provider="volna"
          queue={playlistQueue.length > 1 ? playlistQueue : undefined}
          queueIndex={playlistQueue.findIndex((item) => item.id === uploadedTrackPlayerId(track.id))}
          startSeconds={0}
          title={track.title}
          variant="card"
        />
      ) : <Text key={trackKey} style={localStyles.playlistUnavailableTrack}>Трек больше недоступен</Text>;
    }
    return <Text key={trackKey} style={localStyles.playlistUnavailableTrack}>Трек больше недоступен</Text>;
  }

export function MusicCatalogScreen({
  destination,
  onOpenDestination,
  onBack,
  onOpenMenu,
  onOpenMessages,
  onOpenMyMusic,
  onOpenNotifications,
  onOpenPublicPage,
  onEditPlaylist,
  onNotify,
  onRefreshProfile,
  profile,
}: {
  destination: MusicCatalogDestination | null;
  onOpenDestination: (destination: MusicCatalogDestination) => void;
  onBack: () => void;
  onOpenMenu: () => void;
  onOpenMessages: () => void;
  onOpenMyMusic: () => void;
  onOpenNotifications: () => void;
  onOpenPublicPage: (username: string) => Promise<void>;
  onEditPlaylist: (playlistId: string) => void;
  onNotify: (message: string, type?: ToastMessage['type']) => void;
  onRefreshProfile: () => void | Promise<void>;
  profile: Profile;
}) {
  const selectedCategory = destination?.category ?? null;
  const selectedPlaylistId = destination?.category === 'playlists' ? destination.playlistId : undefined;
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'mine' | 'browse'>('mine');
  const [searchGenres, setSearchGenres] = useState<string[]>([]);
  const [listenLaterItems, setListenLaterItems] = useState<ListenLaterItem[]>([]);
  const listenLaterLoadRef = useRef(0);
  const [isListenLaterLoading, setIsListenLaterLoading] = useState(false);
  const [isListenLaterInfoVisible, setIsListenLaterInfoVisible] = useState(false);
  const [catalogPlaylists, setCatalogPlaylists] = useState<MusicPlaylist[]>([]);
  const [catalogUploadedTracks, setCatalogUploadedTracks] = useState<Array<UploadedMusicTrack | PublicUploadedMusicTrack>>(
    () => profile.uploadedMusicTracks ?? [],
  );
  const [catalogFavoriteTracks, setCatalogFavoriteTracks] = useState<ProfileMusicTrack[]>(
    () => initialTracks(profile),
  );
  const [enteringFavoriteTrackIds, setEnteringFavoriteTrackIds] = useState<string[]>([]);
  const [leavingFavoriteTrackIds, setLeavingFavoriteTrackIds] = useState<string[]>([]);
  const entranceTimers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const selectedPlaylist = catalogPlaylists.find((playlist) => playlist.id === selectedPlaylistId);
  const [playlistsError, setPlaylistsError] = useState<string | null>(null);
  const [isPlaylistsLoading, setIsPlaylistsLoading] = useState(false);
  const [hasLoadedPlaylists, setHasLoadedPlaylists] = useState(false);
  const [isPlaylistCreateVisible, setIsPlaylistCreateVisible] = useState(false);
  const [isPlaylistCreating, setIsPlaylistCreating] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [favoriteRadios, setFavoriteRadios] = useState<FavoriteRadioStation[]>([]);
  const [isRadiosLoading, setIsRadiosLoading] = useState(false);
  const [radiosError, setRadiosError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const downloads = useDeviceDownloads();
  useEffect(() => { if (selectedCategory === 'downloads' && !supportsDeviceDownloads()) onBack(); }, [selectedCategory, onBack]);
  const globalAudio = useGlobalAudioControls();
  const favoriteTracks = useMemo(() => catalogFavoriteTracks.filter((track) => isMusicLibraryProvider(track.provider)), [catalogFavoriteTracks]);
  const readyUploadedTracks = useMemo(
    () => catalogUploadedTracks.filter((track) => {
      const status = 'status' in track ? (track as UploadedMusicTrack).status : 'READY';
      return status === 'READY' && Boolean(track.publicUrl);
    }),
    [catalogUploadedTracks],
  );
  const visibleMusicEntries = useMemo(() => {
    const entries = [
      ...readyUploadedTracks.map((track, index) => ({
        kind: 'upload' as const,
        track,
        timestamp: Date.parse(track.createdAt),
        stableIndex: index,
      })),
      ...favoriteTracks.map((track, index) => ({
        kind: 'saved' as const,
        track,
        timestamp: track.addedAt ? Date.parse(track.addedAt) : Number.NaN,
        stableIndex: readyUploadedTracks.length + index,
      })),
    ];
    return entries.sort((left, right) => {
      const leftTime = Number.isFinite(left.timestamp) ? left.timestamp : Number.NEGATIVE_INFINITY;
      const rightTime = Number.isFinite(right.timestamp) ? right.timestamp : Number.NEGATIVE_INFINITY;
      return rightTime - leftTime || left.stableIndex - right.stableIndex;
    });
  }, [readyUploadedTracks, favoriteTracks]);
  const personalSearchItems = useMemo(() => visibleMusicEntries.map((entry): MusicCatalogItem => entry.kind === 'upload'
    ? { kind: 'upload', key: `mine:upload:${entry.track.id}`, track: { ...entry.track, artist: entry.track.artist?.trim() || profile.name } }
    : { kind: 'external', key: `mine:${entry.track.provider}:${entry.track.id}`, track: entry.track }), [profile.name, visibleMusicEntries]);
  const favoriteQueue = useMemo(() => {
    return visibleMusicEntries.flatMap((entry): GlobalTrackQueueItem[] => entry.kind === 'upload' ? [{
        id: uploadedTrackPlayerId(entry.track.id),
        title: entry.track.title,
        artist: entry.track.artist?.trim() || profile.name,
        artworkUrl: entry.track.artworkUrl,
        previewUrl: `${apiUrl}/my-music/stream/${encodeURIComponent(entry.track.id)}`,
        externalUrl: null,
        provider: 'volna',
        startSeconds: 0,
        clipDurationSeconds: entry.track.durationSeconds,
        genres: entry.track.genres,
        releaseDate: entry.track.releaseDate,
      }] : buildFavoriteMusicQueue([entry.track]));
  }, [profile.name, visibleMusicEntries]);
  const resolveFavoriteQueue = useCallback(
    (target: GlobalTrackQueueItem) => boundedPlaybackQueue(favoriteQueue, target),
    [favoriteQueue],
  );
  const listenLaterGroups = useMemo(() => listenLaterDisplayGroups(listenLaterItems), [listenLaterItems]);
  const listenLaterQueue = useMemo(
    () => listenLaterItems.flatMap((item) => unreviewedQueue(item.tracks).map((track) => listenLaterQueueItem(item, track))),
    [listenLaterItems],
  );
  const resolveListenLaterQueue = useCallback(
    (target: GlobalTrackQueueItem) => listenLaterPlaybackQueue(listenLaterQueue, target),
    [listenLaterQueue],
  );
  const playlistQueuesById = useMemo(() => new Map(catalogPlaylists.map((playlist) => [playlist.id, buildPlaylistQueue(playlist.tracks, favoriteTracks, readyUploadedTracks, profile.name)])), [catalogPlaylists, favoriteTracks, profile.name, readyUploadedTracks]);
  const playlistTiles = useMemo(() => {
    const artwork = playlistTrackArtworkLookup(favoriteTracks, catalogUploadedTracks);
    return catalogPlaylists.map((playlist) => ({ id: playlist.id, name: playlist.name, artworkUrl: resolvePlaylistArtwork(playlist, artwork) }));
  }, [catalogPlaylists, catalogUploadedTracks, favoriteTracks]);
  const playlistTileArtwork = playlistCategoryArtwork(playlistTiles);
  const listenLaterTileArtwork = useMemo(() => {
    const latest = listenLaterItems[0];
    if (latest?.artworkUrl) return musicArtworkThumbnail(latest.artworkUrl, latest.provider, 300) ?? latest.artworkUrl;
    const track = latest?.tracks.find((item) => Boolean(item.artworkUrl));
    return track?.artworkUrl ? musicArtworkThumbnail(track.artworkUrl, track.provider, 300) ?? track.artworkUrl : null;
  }, [listenLaterItems]);
  const radioTileArtwork = favoriteRadios[0]?.avatarUrl ?? null;
  useEffect(() => {
    const activeTrack = globalAudio.activeTrack;
    if (selectedCategory || activeTab !== 'mine' || searchQuery.trim()) return;
    if (!activeTrack || activeTrack.queueSource === 'device-downloads' || !favoriteQueue.some((track) => track.id === activeTrack.id)) return;
    const nextQueue = resolveFavoriteQueue(activeTrack);
    if (nextQueue.length) globalAudio.setActiveQueue(nextQueue, resolveFavoriteQueue);
  }, [favoriteQueue, globalAudio.activeTrack?.id, globalAudio.setActiveQueue, resolveFavoriteQueue, selectedCategory, activeTab, searchQuery]);
  const loadListenLater = useCallback(async () => {
    const request = ++listenLaterLoadRef.current;
    setIsListenLaterLoading(true);
    try {
      const response = await fetch(`${apiUrl}/my-music/listen-later`);
      if (!response.ok) throw new Error(await readApiError(response, 'Не удалось загрузить отложенные релизы'));
      const result = await response.json() as { items?: ListenLaterItem[] };
      if (request === listenLaterLoadRef.current) setListenLaterItems(Array.isArray(result.items) ? result.items : []);
    } catch (error) {
      if (request !== listenLaterLoadRef.current) return;
      const message = error instanceof Error ? error.message : 'Не удалось загрузить отложенные релизы';
      onNotify(message, 'error');
    } finally {
      if (request === listenLaterLoadRef.current) setIsListenLaterLoading(false);
    }
  }, [onNotify]);
  const loadPlaylists = useCallback(async () => {
    setIsPlaylistsLoading(true);
    setPlaylistsError(null);
    try {
      const response = await fetch(`${apiUrl}/my-music`);
      if (!response.ok) throw new Error(await readApiError(response, 'Не удалось загрузить плейлисты'));
      const result = await response.json() as { playlists?: MusicPlaylist[]; tracks?: UploadedMusicTrack[] };
      setCatalogPlaylists(Array.isArray(result.playlists) ? result.playlists : []);
      setCatalogUploadedTracks(Array.isArray(result.tracks) ? result.tracks : []);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не удалось загрузить плейлисты';
      setPlaylistsError(message);
      onNotify(message, 'error');
    } finally {
      setIsPlaylistsLoading(false);
      setHasLoadedPlaylists(true);
    }
  }, [onNotify]);
  const loadFavoriteRadios = useCallback(async () => {
    setIsRadiosLoading(true);
    setRadiosError(null);
    try {
      const response = await fetch(`${apiUrl}/public-pages/favorites/radio-stations`);
      if (!response.ok) throw new Error(await readApiError(response, 'Не удалось загрузить радиостанции'));
      const result = await response.json() as { items?: FavoriteRadioStation[] };
      setFavoriteRadios(Array.isArray(result.items) ? result.items : []);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не удалось загрузить радиостанции';
      setRadiosError(message);
      onNotify(message, 'error');
    } finally {
      setIsRadiosLoading(false);
    }
  }, [onNotify]);
  const openPlaylistCreate = () => {
    setNewPlaylistName('');
    setIsPlaylistCreateVisible(true);
  };
  const closePlaylistCreate = () => {
    if (isPlaylistCreating) return;
    setIsPlaylistCreateVisible(false);
    setNewPlaylistName('');
  };
  const createPlaylist = async () => {
    const name = newPlaylistName.trim();
    if (!name || isPlaylistCreating) return;
    if (catalogPlaylists.length >= 20) {
      onNotify('Можно создать не более 20 плейлистов', 'error');
      return;
    }
    setIsPlaylistCreating(true);
    try {
      const next = [...catalogPlaylists, { id: `playlist_${Date.now().toString(36)}`, name, tracks: [] }];
      const response = await fetch(`${apiUrl}/my-music/playlists`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playlists: next }),
      });
      if (!response.ok) throw new Error(await readApiError(response, 'Не удалось создать плейлист'));
      const result = await response.json() as { playlists?: MusicPlaylist[] };
      setCatalogPlaylists(Array.isArray(result.playlists) ? result.playlists : next);
      setIsPlaylistCreateVisible(false);
      setNewPlaylistName('');
      emitMusicLibraryChanged();
      onNotify('Плейлист создан');
    } catch (error) {
      onNotify(error instanceof Error ? error.message : 'Не удалось создать плейлист', 'error');
    } finally {
      setIsPlaylistCreating(false);
    }
  };

  useEffect(() => {
    void Promise.all([loadListenLater(), loadPlaylists(), loadFavoriteRadios()]);
  }, [loadFavoriteRadios, loadListenLater, loadPlaylists]);
  useEffect(() => {
    if (!hasLoadedPlaylists) setCatalogUploadedTracks(profile.uploadedMusicTracks ?? []);
  }, [hasLoadedPlaylists, profile.uploadedMusicTracks]);
  useEffect(() => {
    setCatalogFavoriteTracks(initialTracks(profile));
  }, [profile.musicTracks]);
  useEffect(() => () => {
    entranceTimers.current.forEach(clearTimeout);
    entranceTimers.current.clear();
  }, []);
  useEffect(() => subscribeMusicLibraryChanged((change) => {
    if (change.type === 'listen-later-reviewed') {
      setListenLaterItems((items) => items.map((item) => item.id === change.itemId
        ? { ...item, tracks: item.tracks.map((track) => track.id === change.trackId ? { ...track, reviewed: true } : track) }
        : item));
      // Invalidate any pre-acknowledgement read before it can erase the check.
      void loadListenLater();
      return;
    }
    if (change.type === 'collection-track-added') {
      setCatalogFavoriteTracks((current) => {
        const duplicateIndex = current.findIndex((track) => track.id === change.track.id);
        if (duplicateIndex < 0) return [change.track, ...current];
        const next = [...current];
        next[duplicateIndex] = change.track;
        return next;
      });
      setEnteringFavoriteTrackIds((current) => current.includes(change.track.id) ? current : [...current, change.track.id]);
      const timer = setTimeout(() => {
        entranceTimers.current.delete(timer);
        setEnteringFavoriteTrackIds((current) => current.filter((id) => id !== change.track.id));
      }, 180);
      entranceTimers.current.add(timer);
      void Promise.resolve(onRefreshProfile());
    } else if (change.type === 'collection-track-removed') {
      setLeavingFavoriteTrackIds((current) => current.includes(change.track.id) ? current : [...current, change.track.id]);
    }
    void Promise.all([loadListenLater(), loadPlaylists(), loadFavoriteRadios()]);
  }), [loadFavoriteRadios, loadListenLater, loadPlaylists, onRefreshProfile]);
  const finishFavoriteTrackRemoval = useCallback((trackId: string) => {
    setCatalogFavoriteTracks((current) => current.filter((track) => track.id !== trackId));
    setLeavingFavoriteTrackIds((current) => current.filter((id) => id !== trackId));
    void Promise.resolve(onRefreshProfile());
  }, [onRefreshProfile]);

  useEffect(() => {
    // A successful fresh read may show that the playlist was deleted in its editor.
    if (selectedPlaylistId && hasLoadedPlaylists && !isPlaylistsLoading && !playlistsError && !selectedPlaylist) onBack();
  }, [selectedPlaylistId, selectedPlaylist, hasLoadedPlaylists, isPlaylistsLoading, playlistsError, onBack]);
  const renderPlaylistTrack = (trackKey: string, playlistQueue: GlobalTrackQueueItem[]) => playlistTrackPlayer(trackKey, playlistQueue, favoriteTracks, readyUploadedTracks, profile.name);

  const refreshCatalog = useCallback(async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      await Promise.all([
        Promise.resolve(onRefreshProfile()),
        loadListenLater(),
        loadPlaylists(),
        loadFavoriteRadios(),
      ]);
    } finally {
      setIsRefreshing(false);
    }
  }, [isRefreshing, loadFavoriteRadios, loadListenLater, loadPlaylists, onRefreshProfile]);
  const refreshControl = <AppRefreshControl refreshing={isRefreshing} tintColor="#111" onRefresh={() => void refreshCatalog()} />;

  const renderListenLaterItem = ({ item, tracks, reviewed }: (typeof listenLaterGroups)[number]) => {
    const itemQueue = tracks.map((track) => listenLaterQueueItem(item, track));
    const first = itemQueue[0];
    if (!first) return null;
    const activeTrack = globalAudio.activeTrack;
    const isReleaseActive = Boolean(activeTrack && itemQueue.some((track) => (
      track.id === activeTrack.id
      || Boolean(track.collectionId && track.collectionId === activeTrack.collectionId)
      || Boolean(track.releaseId && track.releaseId === activeTrack.releaseId)
    )));
    return (
      <View key={`${item.id}:${reviewed ? 'reviewed' : 'fresh'}`} style={localStyles.listenLaterCard}>
        <TrackPlayerPill
          playerTrackId={first.id}
          listenLaterItemId={item.id}
          listenLaterTrackId={first.listenLaterTrackId}
          reviewed={first.reviewed}
          artist={first.artist || item.artist}
          artworkUrl={first.artworkUrl}
          clipDurationSeconds={first.clipDurationSeconds}
          collectionId={first.collectionId}
          collectionTitle={item.title}
          externalUrl={first.externalUrl ?? null}
          previewUrl={first.previewUrl}
          provider={first.provider}
          queue={listenLaterQueue.length > 1 ? listenLaterQueue : undefined}
          queueIndex={listenLaterQueue.findIndex((track) => track.id === first.id)}
          queueWindowResolver={resolveListenLaterQueue}
          releaseId={first.releaseId}
          startSeconds={first.startSeconds}
          title={first.title}
          variant="card"
        />
        {itemQueue.length > 1 ? (
          <ExpandableReleaseTrackList expanded={isReleaseActive} itemCount={itemQueue.length - 1}>
            {itemQueue.slice(1).map((track) => (
              <TrackPlayerPill
                playerTrackId={track.id}
                listenLaterItemId={item.id}
                listenLaterTrackId={track.listenLaterTrackId}
                reviewed={track.reviewed}
                artist={track.artist}
                artworkUrl={track.artworkUrl}
                clipDurationSeconds={track.clipDurationSeconds}
                collectionId={track.collectionId}
                collectionTitle={item.title}
                externalUrl={track.externalUrl ?? null}
                key={track.id}
                leadingLabel={`${item.tracks.findIndex((source) => source.id === track.listenLaterTrackId) + 1}`}
                previewUrl={track.previewUrl}
                provider={track.provider}
                queue={listenLaterQueue}
                queueIndex={listenLaterQueue.findIndex((item) => item.id === track.id)}
                queueWindowResolver={resolveListenLaterQueue}
                releaseId={track.releaseId}
                startSeconds={track.startSeconds}
                title={track.title}
                variant="playlist"
              />
            ))}
          </ExpandableReleaseTrackList>
        ) : null}
      </View>
    );
  };

  return (
    <View style={localStyles.catalogScreen}>
      <ScreenTopBar title="Музыка" onOpenMenu={onOpenMenu} onOpenMessages={onOpenMessages} onOpenNotifications={onOpenNotifications} />
      {!selectedCategory ? <>
        <View style={searchFieldStyles.toolbar}>
          <SearchField placeholder="Поиск музыки" value={searchQuery} onChangeText={setSearchQuery} onClear={() => setSearchQuery('')} maxLength={100} returnKeyType="search" />
        </View>
        <CatalogTabs tabs={[{ value: 'mine', label: 'Моя музыка' }, { value: 'browse', label: 'Обзор' }]} value={activeTab} onChange={setActiveTab} />
      </> : null}
      {!selectedCategory && (activeTab === 'browse' || searchQuery.trim()) ? <MusicDiscovery query={searchQuery} personalItems={personalSearchItems} genres={searchGenres} onChangeGenres={setSearchGenres} /> : selectedCategory ? (
        <CatalogBackArea routeKey={`${selectedCategory}:${selectedPlaylistId ?? ''}`} enabled={!isListenLaterInfoVisible && !isPlaylistCreateVisible} onBack={onBack}>
          {selectedCategory !== 'downloads' ? <CatalogInnerHeader
            backLabel={selectedPlaylistId ? 'Назад к плейлистам' : 'Назад к категориям музыки'}
            onBack={onBack}
            title={selectedPlaylistId ? selectedPlaylist?.name ?? 'Плейлист' : selectedCategory === 'playlists' ? 'Мои плейлисты' : selectedCategory === 'radios' ? 'Мои радиостанции' : 'Отложенные релизы'}
            subtitle={selectedPlaylist ? `${selectedPlaylist.tracks.length} тр.` : undefined}
            trailingAction={selectedPlaylist ? (
              <Pressable accessibilityLabel={`Редактировать плейлист ${selectedPlaylist.name}`} accessibilityRole="button" onPress={() => onEditPlaylist(selectedPlaylist.id)} style={localStyles.catalogHeaderAction}>
                <Pencil color="#111" size={21} strokeWidth={1.8} />
              </Pressable>
            ) : selectedCategory === 'playlists' && !selectedPlaylistId ? (
              <Pressable accessibilityLabel="Создать плейлист" accessibilityRole="button" disabled={catalogPlaylists.length >= 20} onPress={openPlaylistCreate} style={[localStyles.catalogHeaderAction, catalogPlaylists.length >= 20 && localStyles.disabled]}>
                <Plus color="#111" size={23} strokeWidth={1.9} />
              </Pressable>
            ) : selectedCategory === 'listen' ? (
              <Pressable accessibilityLabel="Как работают отложенные релизы" accessibilityRole="button" onPress={() => setIsListenLaterInfoVisible(true)} style={localStyles.catalogHeaderAction}>
                <Info color="#6f7b86" size={21} strokeWidth={1.8} />
              </Pressable>
            ) : undefined}
          /> : null}
          {selectedCategory === 'downloads' ? <DownloadedMusic onBack={onBack} /> : selectedCategory === 'listen' ? (
            <ScrollView alwaysBounceVertical contentContainerStyle={localStyles.listenLaterContent} refreshControl={refreshControl} showsVerticalScrollIndicator={false}>
              {isListenLaterLoading && !listenLaterItems.length ? <LoadingIndicator /> : null}
              {listenLaterGroups.map(renderListenLaterItem)}
              {!isListenLaterLoading && !listenLaterItems.length ? <Text style={localStyles.catalogEmptyTitle}>Здесь пока ничего нет</Text> : null}
            </ScrollView>
          ) : selectedCategory === 'playlists' ? (
            <ScrollView key={selectedPlaylistId ?? 'playlists'} alwaysBounceVertical contentContainerStyle={localStyles.catalogPlaylistContent} refreshControl={refreshControl} showsVerticalScrollIndicator={false}>
              {isPlaylistsLoading && !catalogPlaylists.length ? <LoadingIndicator /> : null}
              {playlistsError ? <View><Text style={localStyles.catalogEmptyTitle}>{playlistsError}</Text><Pressable accessibilityRole="button" onPress={() => void loadPlaylists()} style={localStyles.catalogRetryButton}><Text style={localStyles.catalogPlaylistTitle}>Попробовать снова</Text></Pressable></View> : null}
              {selectedPlaylist ? <>
                {selectedPlaylist.tracks.map((trackKey) => renderPlaylistTrack(trackKey, playlistQueuesById.get(selectedPlaylist.id) ?? []))}
                {!selectedPlaylist.tracks.length ? <Text style={localStyles.catalogEmptyTitle}>В плейлисте пока нет треков</Text> : null}
              </> : !selectedPlaylistId ? <PlaylistGrid playlists={playlistTiles} onOpen={(playlistId) => onOpenDestination({ category: 'playlists', playlistId })} /> : null}
              {!isPlaylistsLoading && !playlistsError && !selectedPlaylistId && !catalogPlaylists.length ? <Text style={localStyles.catalogEmptyTitle}>Здесь пока ничего нет</Text> : null}
            </ScrollView>
          ) : selectedCategory === 'radios' ? (
            <ScrollView alwaysBounceVertical contentContainerStyle={localStyles.favoriteRadiosContent} refreshControl={refreshControl} showsVerticalScrollIndicator={false}>
              {isRadiosLoading && !favoriteRadios.length ? <LoadingIndicator /> : null}
              {favoriteRadios.map((station) => (
                <TrackPlayerPill
                  artist="Радиостанция · Прямой эфир"
                  artworkFallback={<Radio color="#6f7b86" size={20} strokeWidth={1.8} />}
                  artworkUrl={station.avatarUrl}
                  collectionTitle="Прямой эфир"
                  externalUrl={null}
                  isLiveStream
                  isRadioFavorite
                  key={station.id}
                  onDetailsPress={() => { void onOpenPublicPage(station.username); }}
                  onPlaybackError={(error) => {
                    globalAudio.setExpanded(false);
                    onNotify(error instanceof Error ? error.message : 'Не удалось запустить радиостанцию', 'error');
                  }}
                  playerTrackId={`radio:${station.id}`}
                  previewUrl={station.radioStreamUrl}
                  provider="volna"
                  radioPageUsername={station.username}
                  radioStationName={station.name}
                  title={station.name}
                  variant="card"
                />
              ))}
              {!isRadiosLoading && !favoriteRadios.length ? <Text style={localStyles.catalogEmptyTitle}>{radiosError ?? 'Здесь пока ничего нет'}</Text> : null}
            </ScrollView>
          ) : null}
        </CatalogBackArea>
      ) : (
        <ScrollView alwaysBounceVertical contentContainerStyle={localStyles.catalogContent} refreshControl={refreshControl} showsVerticalScrollIndicator={false}>
          <View accessibilityLabel="Разделы моей музыки" style={musicCategoryStyles.row}>
            <View style={musicCategoryStyles.slot}>
              <MusicCategoryTile artworkUrl={playlistTileArtwork} label="Мои плейлисты" onPress={() => onOpenDestination({ category: 'playlists' })} />
            </View>
            <View style={musicCategoryStyles.slot}>
              <MusicCategoryTile artworkUrl={listenLaterTileArtwork} label="Отложенные релизы" onPress={() => onOpenDestination({ category: 'listen' })} />
            </View>
            <View style={musicCategoryStyles.slot}>
              <MusicCategoryTile artworkUrl={radioTileArtwork} label="Мои радиостанции" onPress={() => onOpenDestination({ category: 'radios' })} />
            </View>
          </View>

          <Pressable accessibilityRole="button" onPress={onOpenMyMusic} style={localStyles.uploadButton}>
            <Plus color="#111" size={20} />
            <Text style={localStyles.uploadButtonText}>Загрузить релиз</Text>
          </Pressable>
          {supportsDeviceDownloads() && downloads.items.length > 0 ? <Pressable accessibilityRole="button" accessibilityLabel="Скачанное на это устройство" onPress={() => onOpenDestination({ category: 'downloads' })} style={[localStyles.catalogPlaylistRow, localStyles.downloadsEntry]}>
            <View style={localStyles.catalogPlaylistArtworkFallback}><Download color="#111" size={22} /></View>
            <View style={localStyles.catalogPlaylistCopy}><Text style={localStyles.catalogPlaylistTitle}>Скачанное</Text><Text style={localStyles.catalogPlaylistMeta}>На этом устройстве</Text></View>
            <ChevronLeft color="#6f7b86" size={20} style={{ transform: [{ rotate: '180deg' }] }} />
          </Pressable> : null}
          <View style={localStyles.favoriteTrackList}>
            {visibleMusicEntries.map((entry) => entry.kind === 'upload'
              ? <UploadedMusicPlayerCard key={`upload:${entry.track.id}`} ownerName={profile.name} queue={favoriteQueue} queueWindowResolver={resolveFavoriteQueue} track={entry.track} />
              : (
                <AnimatedMusicLibraryRow
                  entering={enteringFavoriteTrackIds.includes(entry.track.id)}
                  key={`${entry.track.provider}:${entry.track.id}`}
                  leaving={leavingFavoriteTrackIds.includes(entry.track.id)}
                  onLeaveComplete={() => finishFavoriteTrackRemoval(entry.track.id)}
                >
                  <ProfileMusicPlayerItem profileQueue={favoriteQueue} queueWindowResolver={resolveFavoriteQueue} showGenres={false} track={entry.track} />
                </AnimatedMusicLibraryRow>
              ))}
            {!favoriteTracks.length && !readyUploadedTracks.length ? <Text style={localStyles.favoriteTracksEmpty}>Сохранённых треков пока нет</Text> : null}
          </View>
        </ScrollView>
      )}
      <AppSheetModal
        isVisible={isListenLaterInfoVisible}
        onClose={() => setIsListenLaterInfoVisible(false)}
        title="Отложенные релизы"
        scroll
        contentContainerStyle={localStyles.listenLaterInfoContent}
        footer={<Pressable accessibilityRole="button" onPress={() => setIsListenLaterInfoVisible(false)} style={localStyles.playlistCreateButton}><Text style={localStyles.playlistCreateButtonText}>Понятно</Text></Pressable>}
      >
        <Text style={localStyles.listenLaterInfoText}>Сохраняйте сюда релизы, которые хотите послушать позже — например, новинки лейблов и артистов, на которых вы подписаны. Для этого нажмите «Слушать позже» в плеере.</Text>
        <Text style={localStyles.listenLaterInfoText}>Когда появится время, включите любой непрослушанный трек. Дальше по очереди будут играть остальные отложенные треки.</Text>
        <Text style={localStyles.listenLaterInfoText}>Понравилось — добавьте трек или весь релиз в «Мою музыку». Добавленное исчезнет из отложенных. Если не понравилось, просто слушайте дальше.</Text>
        <Text style={localStyles.listenLaterInfoText}>После окончания трека или перехода к другому он отмечается как прослушанный. Такие треки остаются в списке с галочкой, но больше не попадают в очередь. Их можно включить отдельно. Пауза не меняет статус.</Text>
      </AppSheetModal>
      <AppSheetModal isVisible={isPlaylistCreateVisible} onClose={closePlaylistCreate} title="Новый плейлист">
        <TextInput
          accessibilityLabel="Название нового плейлиста"
          autoFocus
          maxLength={60}
          onChangeText={setNewPlaylistName}
          onSubmitEditing={() => void createPlaylist()}
          placeholder="Название плейлиста"
          placeholderTextColor="#8e99a4"
          returnKeyType="done"
          style={localStyles.playlistCreateInput}
          value={newPlaylistName}
        />
        <Pressable accessibilityRole="button" disabled={isPlaylistCreating || !newPlaylistName.trim()} onPress={() => void createPlaylist()} style={[localStyles.playlistCreateButton, (isPlaylistCreating || !newPlaylistName.trim()) && localStyles.disabled]}>
          {isPlaylistCreating ? <LoadingIndicator tone="inverse" size="small" /> : <Text style={localStyles.playlistCreateButtonText}>Создать</Text>}
        </Pressable>
      </AppSheetModal>
    </View>
  );
}

export function MyMusicScreen({
  onPlaylistEditorVisibilityChange,
  playlistPlayer,
  authToken,
  initialPlaylistId,
  onBack,
  onInitialPlaylistOpened,
  onNotify,
  onRefreshProfile,
  onSave,
  profile,
}: {
  authToken: string;
  onPlaylistEditorVisibilityChange?: (visible: boolean) => void;
  playlistPlayer?: ReactNode;
  initialPlaylistId?: string | null;
  onBack: () => void;
  onInitialPlaylistOpened?: () => void;
  onNotify: (message: string, type?: ToastMessage['type']) => void;
  onRefreshProfile: () => void | Promise<void>;
  onSave: (data: ProfileUpdate) => Promise<void>;
  profile: Profile;
}) {
  const safeAreaInsets = useSafeAreaInsets();
  const [tracks, setTracks] = useState<ProfileMusicTrack[]>(() => initialTracks(profile));
  const [library, setLibrary] = useState<MusicLibraryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [quality, setQuality] = useState<'AAC_128' | 'AAC_256'>('AAC_128');
  const [uploadEditDraft, setUploadEditDraft] = useState<UploadEditDraft | null>(null);
  const [isUploadEditSaving, setIsUploadEditSaving] = useState(false);
  const [playlists, setPlaylists] = useState<MusicPlaylist[]>([]);
  const [playlistDraft, setPlaylistDraft] = useState<MusicPlaylist | null>(null);
  const [playlistEditorError, setPlaylistEditorError] = useState<string | null>(null);
  const [isPlaylistDeleteVisible, setIsPlaylistDeleteVisible] = useState(false);
  const playlistSaveInFlight = useRef(false);
  const playlistEditorVisible = Boolean(playlistDraft);
  useEffect(() => {
    onPlaylistEditorVisibilityChange?.(playlistEditorVisible);
    return () => onPlaylistEditorVisibilityChange?.(false);
  }, [playlistEditorVisible, onPlaylistEditorVisibilityChange]);
  useEffect(() => { setPlaylistEditorError(null); setIsPlaylistDeleteVisible(false); }, [playlistDraft?.id]);
  const [returnToCatalogAfterPlaylistEditor, setReturnToCatalogAfterPlaylistEditor] = useState(false);
  const [playlistArtworkCropAsset, setPlaylistArtworkCropAsset] = useState<AvatarCropAsset | null>(null);
  const [arePlaylistsSaving, setArePlaylistsSaving] = useState(false);
  const [uploadDraft, setUploadDraft] = useState<UploadDraft | null>(null);
  const [externalReleaseUrl, setExternalReleaseUrl] = useState('');
  const [externalReleaseGenres, setExternalReleaseGenres] = useState<string[]>([]);
  const [externalReleaseSelf, setExternalReleaseSelf] = useState(false);
  const [externalDateDraft, dispatchExternalDate] = useReducer(releaseDateDraftReducer, emptyReleaseDateDraft);
  const externalReleaseDate = externalDateDraft.value;
  const setExternalReleaseDate = (value: string) => dispatchExternalDate({ type: 'manual', value });
  const changeExternalReleaseUrl = (url: string) => {
    dispatchExternalDate({ type: 'url', url });
    setExternalReleaseUrl(url);
    setExternalReleasePreview(null);
  };
  const [isExternalReleaseSaving, setIsExternalReleaseSaving] = useState(false);
  const [externalReleasePreview, setExternalReleasePreview] = useState<ExternalReleasePreview | null>(null);
  const [externalReleaseResolveError, setExternalReleaseResolveError] = useState<string | null>(null);
  const [isExternalReleaseResolving, setIsExternalReleaseResolving] = useState(false);
  const [externalReleaseResolveRevision, setExternalReleaseResolveRevision] = useState(0);
  const [releaseDateTarget, setReleaseDateTarget] = useState<'external' | 'upload' | 'upload-edit' | null>(null);
  const globalAudio = useGlobalAudioControls();
  const uploadedQueue = useMemo<GlobalTrackQueueItem[]>(() => (library?.tracks ?? []).flatMap((track) => track.publicUrl ? [{
    id: uploadedTrackPlayerId(track.id),
    title: track.title,
    artist: track.artist?.trim() || profile.name,
    artworkUrl: track.artworkUrl,
    previewUrl: `${apiUrl}/my-music/stream/${encodeURIComponent(track.id)}`,
    provider: 'volna' as const,
    startSeconds: 0,
    clipDurationSeconds: track.durationSeconds,
    genres: track.genres,
    releaseDate: track.releaseDate,
  }] : []), [library?.tracks, profile.name]);
  const loadLibrary = useCallback(async () => {
    try {
      const response = await fetch(`${apiUrl}/my-music`, { headers: { Authorization: `Bearer ${authToken}` } });
      if (!response.ok) throw new Error(await readApiError(response, 'Не удалось загрузить вашу музыку'));
      const result = await response.json() as MusicLibraryResponse;
      setLibrary(result);
      setPlaylists(result.playlists ?? []);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : 'Не удалось загрузить вашу музыку', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [authToken, onNotify]);

  useEffect(() => { void loadLibrary(); }, [loadLibrary]);
  useEffect(() => {
    setIsExternalReleaseResolving(false);
    setExternalReleaseResolveError(null);
    const releaseUrl = externalReleaseUrl.trim();
    if (!releaseUrl) {
      setExternalReleasePreview(null);
      return;
    }
    const provider = externalReleaseProvider(releaseUrl);
    if (!provider) {
      setExternalReleasePreview(null);
      return;
    }

    const controller = new AbortController();
    let isCurrent = true;
    setExternalReleasePreview(null);
    const timer = setTimeout(() => {
      setIsExternalReleaseResolving(true);
      const request = provider === 'bandcamp'
        ? getBandcampRelease(releaseUrl).then((metadata) => ({ provider, metadata }))
        : fetch(`${apiUrl}/music/soundcloud/release?url=${encodeURIComponent(releaseUrl)}`, { signal: controller.signal })
          .then(async (response) => {
            if (!response.ok) throw new Error(await readApiError(response, 'Не удалось определить релиз SoundCloud'));
            const metadata = await response.json() as ExternalReleasePreview['metadata'];
            return { provider, metadata };
          });

      void request
        .then((preview) => {
          if (!isCurrent) return;
          setExternalReleasePreview(preview);
          dispatchExternalDate({ type: 'resolved', url: releaseUrl, releaseDate: preview.metadata.releaseDate });
          setExternalReleaseResolveError(null);
        })
        .catch((error: unknown) => {
          if (!isCurrent || (error as { name?: string }).name === 'AbortError') return;
          setExternalReleasePreview(null);
          setExternalReleaseResolveError(error instanceof Error ? error.message : 'Не удалось определить релиз');
        })
        .finally(() => {
          if (isCurrent) setIsExternalReleaseResolving(false);
        });
    }, 500);

    return () => {
      isCurrent = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [externalReleaseResolveRevision, externalReleaseUrl]);
  useEffect(() => {
    if (!initialPlaylistId || !library) return;
    const initialPlaylist = playlists.find((playlist) => playlist.id === initialPlaylistId);
    if (initialPlaylist) {
      setReturnToCatalogAfterPlaylistEditor(true);
      setPlaylistDraft({ ...initialPlaylist, tracks: [...initialPlaylist.tracks] });
    }
    onInitialPlaylistOpened?.();
  }, [initialPlaylistId, library, onInitialPlaylistOpened, playlists]);

  const normalizedTracks = tracks;
  const playlistArtworkLookup = useMemo(() => playlistTrackArtworkLookup(normalizedTracks, library?.tracks ?? []), [normalizedTracks, library?.tracks]);
  const playlistDraftArtwork = playlistDraft ? resolvePlaylistArtwork(playlistDraft, playlistArtworkLookup) : null;
  const hasCustomPlaylistArtwork = Boolean(playlistDraft && !playlistDraft.removeArtwork && (playlistDraft.artworkLocalUri || playlistDraft.artworkThumbnailUrl || playlistDraft.artworkUrl));
  const playlistTrackOptions = useMemo(() => [
    ...normalizedTracks.map((track) => ({ key: `profile:${track.provider}:${track.id}`, title: track.title, meta: track.artist || (track.provider === 'bandcamp' ? 'Bandcamp' : track.provider === 'soundcloud' ? 'SoundCloud' : '') })),
    ...(library?.tracks ?? []).filter((track) => track.status === 'READY').map((track) => ({ key: `upload:${track.id}`, title: track.title, meta: `${track.artist?.trim() || profile.name} · ${minutes(track.durationSeconds)}` })),
  ], [library?.tracks, normalizedTracks, profile.name]);
  const playlistDraftTracks = useMemo(() => {
    if (!playlistDraft) return [];
    const optionsByKey = new Map(playlistTrackOptions.map((track) => [track.key, track]));
    const readyUploads = (library?.tracks ?? []).filter(track => track.status === 'READY');
    const queue = buildPlaylistQueue(playlistDraft.tracks, normalizedTracks, readyUploads, profile.name);
    return playlistDraft.tracks.map(key => ({ key, title: optionsByKey.get(key)?.title ?? 'Недоступный трек', player: playlistTrackPlayer(key, queue, normalizedTracks, readyUploads, profile.name) }));
  }, [playlistDraft, playlistTrackOptions, normalizedTracks, library?.tracks, profile.name]);

  const savePlaylists = async (next: MusicPlaylist[]) => {
    if (playlistSaveInFlight.current) return;
    playlistSaveInFlight.current = true;
    setPlaylistEditorError(null);
    const shouldReturnToCatalog = returnToCatalogAfterPlaylistEditor;
    setArePlaylistsSaving(true);
    try {
      const response = await fetch(`${apiUrl}/my-music/playlists`, { method: 'PATCH', headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ playlists: next }) });
      if (!response.ok) throw new Error(await readApiError(response, 'Не удалось сохранить плейлисты'));
      const result = await response.json() as { playlists: MusicPlaylist[] };
      setPlaylists(result.playlists);
      setLibrary((current) => current ? { ...current, playlists: result.playlists } : current);
      setPlaylistDraft(null);
      setReturnToCatalogAfterPlaylistEditor(false);
      emitMusicLibraryChanged();
      onNotify('Плейлисты сохранены');
      if (shouldReturnToCatalog) onBack();
    } catch (error) {
      setPlaylistEditorError(error instanceof Error ? error.message : 'Не удалось сохранить плейлисты');
    } finally {
      playlistSaveInFlight.current = false;
      setArePlaylistsSaving(false);
    }
  };

  const saveProfileTracks = async () => {
    setIsSaving(true);
    try {
      await onSave({
        musicTracks: normalizedTracks,
        soundcloudMusicUrl: '',
        bandcampMusicUrl: '',
      });
      onNotify('Музыка сохранена');
    } catch (error) {
      onNotify(error instanceof Error ? error.message : 'Не удалось сохранить музыку', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const pickAndUpload = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: [
        'audio/mpeg',
        'audio/wav',
        'audio/x-wav',
        'audio/flac',
        'audio/x-flac',
        'audio/aac',
        'audio/x-aac',
        'audio/aacp',
        'audio/vnd.dlna.adts',
        'audio/mp4',
        'audio/x-m4a',
        'application/octet-stream',
      ],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    const fallbackTitle = asset.name.replace(/\.[^.]+$/, '').trim().slice(0, 120);
    setIsUploading(true);
    setUploadProgress({ filename: asset.name, stage: 'preparing', percent: 2 });
    try {
      const prepared = await prepareMusicAsset({
        uri: asset.uri,
        name: asset.name,
        mimeType: asset.mimeType || 'application/octet-stream',
        size: asset.size,
      }, authToken, (progress) => {
        setUploadProgress((current) => ({ filename: current?.filename || asset.name, ...progress }));
      });
      setUploadProgress(null);
      setUploadDraft({
        asset: { uri: asset.uri, name: asset.name, mimeType: asset.mimeType || 'application/octet-stream', size: asset.size },
        uploadKey: prepared.uploadKey,
        title: prepared.title || fallbackTitle || 'Без названия',
        artist: prepared.artist || '',
        artworkUri: prepared.artworkDataUrl,
        customArtwork: null,
        genres: [],
        includeSelfAsParticipant: false,
        releaseDate: '',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не удалось загрузить трек';
      setUploadProgress({ filename: asset.name, stage: 'error', percent: 100, error: message });
      onNotify(message, 'error');
    } finally {
      setIsUploading(false);
    }
  };

  const choosePlaylistArtwork = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: false, quality: 1 });
    if (result.canceled) return;
    const asset = result.assets[0];
    setPlaylistArtworkCropAsset({ uri: asset.uri, width: asset.width || 1200, height: asset.height || 1200, mimeType: asset.mimeType || 'image/jpeg' });
  };

  const applyPlaylistArtwork = async (uri: string) => {
    setArePlaylistsSaving(true);
    try {
      const previousUploadKey = playlistDraft?.artworkUploadKey;
      const artworkUploadKey = await uploadMusicArtworkAsset({ uri, name: 'playlist-cover.jpg', mimeType: 'image/jpeg' }, authToken);
      setPlaylistDraft((current) => current ? { ...current, artworkLocalUri: uri, artworkUploadKey, removeArtwork: false } : current);
      if (previousUploadKey) await discardMusicArtworkAsset(previousUploadKey, authToken).catch(() => undefined);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : 'Не удалось загрузить обложку', 'error');
    } finally {
      setArePlaylistsSaving(false);
    }
  };

  const closePlaylistEditor = () => {
    if (arePlaylistsSaving) return;
    const pendingArtworkKey = playlistDraft?.artworkUploadKey;
    const shouldReturnToCatalog = returnToCatalogAfterPlaylistEditor;
    setPlaylistDraft(null);
    setReturnToCatalogAfterPlaylistEditor(false);
    if (pendingArtworkKey) void discardMusicArtworkAsset(pendingArtworkKey, authToken).catch(() => undefined);
    if (shouldReturnToCatalog) onBack();
  };

  const removePlaylistArtwork = () => {
    const pendingArtworkKey = playlistDraft?.artworkUploadKey;
    setPlaylistDraft((current) => current ? { ...current, artworkLocalUri: undefined, artworkUploadKey: undefined, removeArtwork: true } : current);
    if (pendingArtworkKey) void discardMusicArtworkAsset(pendingArtworkKey, authToken).catch(() => undefined);
  };

  const confirmDeletePlaylist = () => { setPlaylistEditorError(null); setIsPlaylistDeleteVisible(true); };

  const closeUploadModal = async () => {
    const draft = uploadDraft;
    setUploadDraft(null);
    if (draft) await discardMusicAsset(draft.uploadKey, authToken);
  };

  const chooseArtwork = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.9 });
    if (result.canceled) return;
    const asset = result.assets[0];
    setUploadDraft((current) => current ? { ...current, artworkUri: asset.uri, customArtwork: { uri: asset.uri, name: asset.fileName || 'track-cover.jpg', mimeType: asset.mimeType || 'image/jpeg' } } : current);
  };

  const confirmUpload = async () => {
    const draft = uploadDraft;
    if (!draft?.title.trim() || !draft.genres.length || !draft.genres.every(isMusicSubgenreValue)) return;
    setIsUploading(true);
    setUploadDraft(null);
    setUploadProgress({ filename: draft.asset.name, stage: 'processing', percent: 68 });
    let timer: ReturnType<typeof setInterval> | null = setInterval(() => setUploadProgress((current) => current?.stage === 'processing' && current.percent < 92 ? { ...current, percent: current.percent + 1 } : current), 450);
    try {
      const artworkUploadKey = draft.customArtwork ? await uploadMusicArtworkAsset(draft.customArtwork, authToken) : undefined;
      await finalizeMusicAsset({
        uploadKey: draft.uploadKey,
        filename: draft.asset.name,
        mimeType: draft.asset.mimeType,
        title: draft.title.trim(),
        artist: draft.artist.trim(),
        quality,
        artworkUploadKey,
        genres: draft.genres,
        includeSelfAsParticipant: draft.includeSelfAsParticipant,
        releaseDate: releaseDateInputToIso(draft.releaseDate),
      }, authToken);
      if (timer) clearInterval(timer);
      timer = null;
      setUploadProgress({ filename: draft.asset.name, stage: 'complete', percent: 100 });
      await Promise.all([loadLibrary(), Promise.resolve(onRefreshProfile())]);
      onNotify('Трек загружен и обработан');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не удалось загрузить трек';
      setUploadProgress({ filename: draft.asset.name, stage: 'error', percent: 100, error: message });
      onNotify(message, 'error');
    } finally {
      if (timer) clearInterval(timer);
      setIsUploading(false);
    }
  };

  const saveExternalRelease = async () => {
    const provider = externalReleaseProvider(externalReleaseUrl);
    if (!provider) {
      onNotify('Вставьте ссылку на релиз Bandcamp или SoundCloud', 'error');
      return;
    }
    if (!externalReleasePreview) {
      onNotify('Сначала дождитесь предпросмотра релиза', 'error');
      return;
    }
    if (!externalReleaseGenres.length || !externalReleaseGenres.every(isMusicSubgenreValue)) {
      onNotify(`Выберите от 1 до ${audioReleaseGenreLimit} жанров музыки`, 'error');
      return;
    }
    setIsExternalReleaseSaving(true);
    try {
      const response = await fetch(`${apiUrl}/my-music/external-track`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          externalUrl: externalReleaseUrl.trim(),
          genres: externalReleaseGenres,
          includeSelfAsParticipant: externalReleaseSelf,
          releaseDate: releaseDateInputToIso(externalReleaseDate) ?? (externalDateDraft.edited ? null : undefined),
        }),
      });
      if (!response.ok) throw new Error(await readApiError(response, 'Не удалось добавить релиз'));
      const result = await response.json() as { added: boolean; updated?: boolean; track: ProfileMusicTrack };
      setTracks((current) => {
        const duplicateIndex = current.findIndex((track) => track.id === result.track.id
          || (track.provider === result.track.provider && track.externalUrl === result.track.externalUrl));
        if (duplicateIndex < 0) return [result.track, ...current];
        const next = [...current];
        next[duplicateIndex] = result.track;
        return next;
      });
      changeExternalReleaseUrl('');
      setExternalReleaseGenres([]);
      setExternalReleaseSelf(false);
      setExternalReleasePreview(null);
      setExternalReleaseResolveError(null);
      emitMusicLibraryChanged();
      await Promise.resolve(onRefreshProfile());
      onNotify(result.added ? 'Релиз добавлен' : result.updated ? (externalReleaseSelf ? 'Профиль указан участником релиза' : 'Релиз обновлён') : 'Релиз уже добавлен');
    } catch (error) {
      onNotify(error instanceof Error ? error.message : 'Не удалось добавить релиз', 'error');
    } finally {
      setIsExternalReleaseSaving(false);
    }
  };

  const openUploadEditor = (track: UploadedMusicTrack) => {
    const isSelfParticipant = track.participants.some((participant) => participant.entityType === 'account' && participant.id === profile.id);
    setUploadEditDraft({
      id: track.id,
      title: track.title,
      artist: track.artist ?? '',
      artworkUrl: track.artworkUrl,
      artworkUri: null,
      customArtwork: null,
      genres: [...track.genres],
      includeSelfAsParticipant: isSelfParticipant,
      releaseDate: track.releaseDate ? formatReleaseDateInput(new Date(track.releaseDate)) : '',
    });
  };

  const closeUploadEditor = () => {
    setUploadEditDraft(null);
  };

  const chooseEditArtwork = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.9 });
    if (result.canceled) return;
    const asset = result.assets[0];
    setUploadEditDraft((current) => current ? {
      ...current,
      artworkUri: asset.uri,
      customArtwork: { uri: asset.uri, name: asset.fileName || 'track-cover.jpg', mimeType: asset.mimeType || 'image/jpeg' },
    } : current);
  };

  const saveUploadedTrack = async () => {
    const draft = uploadEditDraft;
    if (!draft?.title.trim() || !draft.genres.length || !draft.genres.every(isMusicSubgenreValue)) return;
    setIsUploadEditSaving(true);
    let artworkUploadKey: string | undefined;
    try {
      artworkUploadKey = draft.customArtwork ? await uploadMusicArtworkAsset(draft.customArtwork, authToken) : undefined;
      const response = await fetch(`${apiUrl}/my-music/${draft.id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: draft.title.trim(),
          artist: draft.artist.trim(),
          artworkUploadKey,
          genres: draft.genres,
          includeSelfAsParticipant: draft.includeSelfAsParticipant,
          releaseDate: releaseDateInputToIso(draft.releaseDate),
        }),
      });
      if (!response.ok) throw new Error(await readApiError(response, 'Не удалось сохранить трек'));
      setUploadEditDraft(null);
      await loadLibrary();
      await Promise.resolve(onRefreshProfile());
      emitMusicLibraryChanged();
      onNotify('Трек сохранён');
    } catch (error) {
      if (artworkUploadKey) await discardMusicArtworkAsset(artworkUploadKey, authToken).catch(() => undefined);
      onNotify(error instanceof Error ? error.message : 'Не удалось сохранить трек', 'error');
    } finally {
      setIsUploadEditSaving(false);
    }
  };

  const deleteTrack = async (id: string) => {
    const response = await fetch(`${apiUrl}/my-music/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (!response.ok) {
      onNotify(await readApiError(response, 'Не удалось удалить трек'), 'error');
      return;
    }
    await loadLibrary();
    onNotify('Трек удалён');
  };

  const usedPercent = library ? Math.min(100, library.quota.usedSeconds / library.quota.limitSeconds * 100) : 0;

  return (
    <View style={localStyles.shell}>
      <ScreenTopBar onBack={onBack} title="Мои треки" />
      <ScrollView contentContainerStyle={localStyles.content} showsVerticalScrollIndicator={false}>
        <View style={localStyles.card}>
          <View style={localStyles.sectionHeader}>
            <View>
              <Text style={localStyles.cardTitle}>Мои загрузки</Text>
              <Text style={localStyles.hint}>WAV, MP3, FLAC, AAC или M4A</Text>
            </View>
            <Text style={localStyles.quotaText}>{library ? `${minutes(library.quota.usedSeconds)} / 120:00` : '—'}</Text>
          </View>
          <View style={localStyles.quotaTrack}><View style={[localStyles.quotaFill, { width: `${usedPercent}%` }]} /></View>
          <Text style={localStyles.qualityLabel}>Качество хранения</Text>
          <AnimatedSegmentedControl accessibilityLabel="Качество хранения" containerStyle={localStyles.segment} onChange={setQuality} options={[{ value: 'AAC_128', label: 'AAC · 128 кбит/с' }, { value: 'AAC_256', label: 'AAC · 256 кбит/с' }]} value={quality} />
          <Text style={localStyles.hint}>Файл не перекодируется повторно, если он уже в выбранном кодеке и его битрейт такой же или ниже.</Text>
          <Pressable disabled={isUploading} onPress={() => void pickAndUpload()} style={localStyles.uploadButton}>
            {isUploading ? <LoadingIndicator /> : <><Plus color="#111" size={20} /><Text style={localStyles.uploadButtonText}>Загрузить трек</Text></>}
          </Pressable>

          {uploadProgress ? (
            <View style={localStyles.progressCard}>
              <View style={localStyles.progressHeader}>
                <View style={localStyles.progressCopy}>
                  <Text numberOfLines={1} style={localStyles.progressFilename}>{uploadProgress.filename}</Text>
                  <Text style={[localStyles.progressStage, uploadProgress.stage === 'error' && localStyles.progressError]}>
                    {uploadProgress.stage === 'preparing' ? 'Подготовка файла'
                      : uploadProgress.stage === 'uploading' ? 'Загрузка в хранилище'
                      : uploadProgress.stage === 'processing' ? 'Проверка и конвертация'
                      : uploadProgress.stage === 'saving' ? 'Сохранение результата'
                      : uploadProgress.stage === 'complete' ? 'Готово'
                      : uploadProgress.error || 'Ошибка загрузки'}
                  </Text>
                </View>
                <Text style={[localStyles.progressPercent, uploadProgress.stage === 'error' && localStyles.progressError]}>
                  {uploadProgress.stage === 'error' ? '!' : `${uploadProgress.percent}%`}
                </Text>
              </View>
              <View style={localStyles.processTrack}>
                <View style={[
                  localStyles.processFill,
                  uploadProgress.stage === 'complete' && localStyles.processFillComplete,
                  uploadProgress.stage === 'error' && localStyles.processFillError,
                  { width: `${uploadProgress.percent}%` },
                ]} />
              </View>
              <View style={localStyles.stepsRow}>
                {['Загрузка', 'Конвертация', 'Сохранение'].map((label, index) => {
                  const threshold = [5, 68, 96][index];
                  const active = uploadProgress.percent >= threshold && uploadProgress.stage !== 'error';
                  return <Text key={label} style={[localStyles.stepText, active && localStyles.stepTextActive]}>{label}</Text>;
                })}
              </View>
            </View>
          ) : null}

          {isLoading ? <LoadingIndicator style={{ marginTop: 18 }} /> : null}
          {library?.tracks.map((track) => {
            const playerTrackId = uploadedTrackPlayerId(track.id);
            const queueIndex = uploadedQueue.findIndex((item) => item.id === playerTrackId);
            const isPlaying = globalAudio.isTrackPlaying(playerTrackId);
            const togglePlayback = () => {
              if (!track.publicUrl) return;
              if (isPlaying) {
                globalAudio.pause();
                return;
              }
              void globalAudio.play({
                id: playerTrackId,
                title: track.title,
                artist: track.artist?.trim() || profile.name,
                artworkUrl: track.artworkUrl,
                previewUrl: `${apiUrl}/my-music/stream/${encodeURIComponent(track.id)}`,
                provider: 'volna',
                startSeconds: 0,
                clipDurationSeconds: track.durationSeconds,
                genres: track.genres,
                releaseDate: track.releaseDate,
                queue: uploadedQueue.length > 1 ? uploadedQueue : undefined,
                queueIndex: queueIndex >= 0 ? queueIndex : undefined,
              });
            };
            return (
            <View key={track.id} style={localStyles.trackRow}>
              <Pressable accessibilityLabel={`${isPlaying ? 'Поставить на паузу' : 'Воспроизвести'} ${track.title}`} disabled={!track.publicUrl} onPress={togglePlayback}>
                {track.artworkUrl ? <Image source={{ uri: track.artworkUrl }} style={localStyles.trackArtwork} /> : <View style={localStyles.trackIcon}><FileAudio color="#111" size={21} /></View>}
              </Pressable>
              <View style={localStyles.trackCopy}>
                <Pressable disabled={!track.publicUrl} onPress={togglePlayback}>
                  <Text numberOfLines={1} style={localStyles.trackTitle}>{track.title}</Text>
                </Pressable>
                <Text numberOfLines={1} style={localStyles.trackMeta}>
                  {track.artist?.trim() || profile.name} · {track.outputCodec?.toUpperCase() || track.sourceCodec?.toUpperCase() || 'AUDIO'}
                  {track.outputBitrateKbps ? ` · ${track.outputBitrateKbps} кбит/с` : ''}
                </Text>
              </View>
              <Pressable accessibilityLabel={`${isPlaying ? 'Поставить на паузу' : 'Воспроизвести'} ${track.title}`} disabled={!track.publicUrl} onPress={togglePlayback} style={localStyles.smallButton}>
                {isPlaying ? <Pause color="#111" fill="#111" size={18} /> : <Play color="#111" fill="#111" size={18} />}
              </Pressable>
              <Pressable accessibilityLabel={`Редактировать ${track.title}`} onPress={() => openUploadEditor(track)} style={localStyles.smallButton}>
                <Pencil color="#111" size={18} />
              </Pressable>
              <Pressable onPress={() => void deleteTrack(track.id)} style={localStyles.smallButton}>
                <Trash2 color="#e53935" size={19} />
              </Pressable>
            </View>
            );
          })}
          {!isLoading && !library?.tracks.length ? <Text style={localStyles.empty}>Вы ещё не загружали собственные треки</Text> : null}
        </View>
        <View style={localStyles.card}>
          <Text style={localStyles.cardTitle}>Добавить релиз</Text>
          <Text style={localStyles.hint}>Релиз из Bandcamp или SoundCloud появится в вашей музыке.</Text>
          <View style={localStyles.releaseFields}>
            <ExternalReleaseEditorField
              error={externalReleaseResolveError}
              hint="Поддерживаются ссылки SoundCloud и Bandcamp."
              isResolving={isExternalReleaseResolving}
              onChangeText={changeExternalReleaseUrl}
              onResolve={() => setExternalReleaseResolveRevision((current) => current + 1)}
              preview={externalReleasePreview}
              surface="outlined"
              value={externalReleaseUrl}
            />
            <View style={[localStyles.releaseDateRow, localStyles.releaseField]}>
              <Pressable
                accessibilityLabel="Выбрать дату релиза"
                accessibilityRole="button"
                onPress={() => setReleaseDateTarget('external')}
                style={localStyles.releaseDateButton}
              >
                <CalendarDays color="#6f7b86" size={20} strokeWidth={1.8} />
                <View style={localStyles.releaseDateCopy}>
                  <Text style={localStyles.releaseDateLabel}>Дата релиза</Text>
                  <Text style={[localStyles.releaseDateValue, !externalReleaseDate && localStyles.releaseDatePlaceholder]}>{externalReleaseDate || 'Не указана'}</Text>
                </View>
              </Pressable>
              {externalReleaseDate ? <Pressable accessibilityLabel="Убрать дату релиза" onPress={() => setExternalReleaseDate('')} style={localStyles.releaseDateClear}><X color="#6f7b86" size={18} /></Pressable> : null}
            </View>
            <View style={[localStyles.releaseGenreSection, localStyles.releaseField]}>
              <MusicGenreSelector
                editorCard
                maxSelected={audioReleaseGenreLimit}
                onChange={setExternalReleaseGenres}
                primarySelectionCount={releasePrimaryGenreLimit}
                selected={externalReleaseGenres}
                subgenresOnly
                title="Жанры релиза"
              />
            </View>
          </View>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: externalReleaseSelf }}
            onPress={() => setExternalReleaseSelf((current) => !current)}
            style={localStyles.releaseCheckboxRow}
          >
            <View style={[localStyles.releaseCheckbox, externalReleaseSelf && localStyles.releaseCheckboxActive]}>
              {externalReleaseSelf ? <Check color="#fff" size={15} strokeWidth={2.5} /> : null}
            </View>
            <Text style={localStyles.releaseCheckboxText}>Указать себя в качестве артиста в релизе</Text>
          </Pressable>
          <Pressable
            disabled={isExternalReleaseSaving || !externalReleasePreview || !externalReleaseGenres.length || !externalReleaseGenres.every(isMusicSubgenreValue)}
            onPress={() => void saveExternalRelease()}
            style={[
              localStyles.releaseAddButton,
              (isExternalReleaseSaving || !externalReleasePreview || !externalReleaseGenres.length || !externalReleaseGenres.every(isMusicSubgenreValue)) && localStyles.disabled,
            ]}
          >
            {isExternalReleaseSaving ? <LoadingIndicator tone="inverse" size="small" /> : <Text style={localStyles.releaseAddButtonText}>Добавить релиз</Text>}
          </Pressable>
        </View>
      </ScrollView>
      <AppSheetModal isVisible={Boolean(uploadDraft)} onClose={() => { void closeUploadModal(); }} title="Новый трек">
        {uploadDraft ? (
          <>
            <View style={localStyles.uploadIdentityRow}>
              <Pressable
                accessibilityLabel={uploadDraft.artworkUri ? 'Изменить обложку трека' : 'Добавить обложку трека'}
                accessibilityRole="button"
                onPress={() => void chooseArtwork()}
                style={localStyles.uploadArtworkButton}
              >
                {uploadDraft.artworkUri
                  ? <Image source={{ uri: uploadDraft.artworkUri }} style={localStyles.uploadPreviewArtwork} />
                  : <View style={localStyles.uploadPreviewPlaceholder}><FileAudio color="#6f7b86" size={34} /></View>}
              </Pressable>
              <View style={localStyles.uploadIdentityFields}>
                <TextInput maxLength={180} onChangeText={(artist) => setUploadDraft((current) => current ? { ...current, artist } : current)} placeholder="Имя артиста" placeholderTextColor="#8e99a4" style={localStyles.uploadIdentityInput} value={uploadDraft.artist} />
                <TextInput maxLength={120} onChangeText={(title) => setUploadDraft((current) => current ? { ...current, title } : current)} placeholder="Название трека" placeholderTextColor="#8e99a4" style={localStyles.uploadIdentityInput} value={uploadDraft.title} />
              </View>
            </View>
            <View style={localStyles.releaseDateRow}>
              <Pressable
                accessibilityLabel="Выбрать дату релиза"
                accessibilityRole="button"
                onPress={() => setReleaseDateTarget('upload')}
                style={localStyles.releaseDateButton}
              >
                <CalendarDays color="#6f7b86" size={20} strokeWidth={1.8} />
                <View style={localStyles.releaseDateCopy}>
                  <Text style={localStyles.releaseDateLabel}>Дата релиза</Text>
                  <Text style={[localStyles.releaseDateValue, !uploadDraft.releaseDate && localStyles.releaseDatePlaceholder]}>{uploadDraft.releaseDate || 'Не указана'}</Text>
                </View>
              </Pressable>
              {uploadDraft.releaseDate ? <Pressable accessibilityLabel="Убрать дату релиза" onPress={() => setUploadDraft((current) => current ? { ...current, releaseDate: '' } : current)} style={localStyles.releaseDateClear}><X color="#6f7b86" size={18} /></Pressable> : null}
            </View>
            <View style={localStyles.uploadGenreSection}>
              <MusicGenreSelector
                editorCard
                maxSelected={audioReleaseGenreLimit}
                onChange={(genres) => setUploadDraft((current) => current ? { ...current, genres } : current)}
                primarySelectionCount={releasePrimaryGenreLimit}
                selected={uploadDraft.genres}
                subgenresOnly
                title="Жанры трека"
              />
            </View>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: uploadDraft.includeSelfAsParticipant }}
              onPress={() => setUploadDraft((current) => current ? { ...current, includeSelfAsParticipant: !current.includeSelfAsParticipant } : current)}
              style={localStyles.releaseCheckboxRow}
            >
              <View style={[localStyles.releaseCheckbox, uploadDraft.includeSelfAsParticipant && localStyles.releaseCheckboxActive]}>
                {uploadDraft.includeSelfAsParticipant ? <Check color="#fff" size={15} strokeWidth={2.5} /> : null}
              </View>
              <Text style={localStyles.releaseCheckboxText}>Указать себя в качестве артиста в релизе</Text>
            </Pressable>
            <Pressable
              disabled={!uploadDraft.title.trim() || !uploadDraft.genres.length || !uploadDraft.genres.every(isMusicSubgenreValue)}
              onPress={() => void confirmUpload()}
              style={[localStyles.primaryButton, (!uploadDraft.title.trim() || !uploadDraft.genres.length || !uploadDraft.genres.every(isMusicSubgenreValue)) && localStyles.disabled]}
            >
              <Text style={localStyles.primaryButtonText}>Загрузить трек</Text>
            </Pressable>
          </>
        ) : null}
      </AppSheetModal>
      <AppSheetModal
        footer={uploadEditDraft ? (
          <Pressable
            accessibilityRole="button"
            disabled={isUploadEditSaving || !uploadEditDraft.title.trim() || !uploadEditDraft.genres.length || !uploadEditDraft.genres.every(isMusicSubgenreValue)}
            onPress={() => void saveUploadedTrack()}
            style={[localStyles.primaryButton, localStyles.editUploadSaveButton, (isUploadEditSaving || !uploadEditDraft.title.trim() || !uploadEditDraft.genres.length || !uploadEditDraft.genres.every(isMusicSubgenreValue)) && localStyles.disabled]}
          >
            {isUploadEditSaving ? <LoadingIndicator tone="inverse" size="small" /> : <Text style={localStyles.primaryButtonText}>Сохранить</Text>}
          </Pressable>
        ) : undefined}
        isVisible={Boolean(uploadEditDraft)}
        onClose={closeUploadEditor}
        scroll
        title="Редактировать трек"
      >
        {uploadEditDraft ? (
          <>
            <View style={localStyles.uploadIdentityRow}>
              <Pressable
                accessibilityLabel={uploadEditDraft.artworkUri || uploadEditDraft.artworkUrl ? 'Изменить обложку трека' : 'Добавить обложку трека'}
                accessibilityRole="button"
                disabled={isUploadEditSaving}
                onPress={() => void chooseEditArtwork()}
                style={[localStyles.uploadArtworkButton, isUploadEditSaving && localStyles.disabled]}
              >
                {uploadEditDraft.artworkUri || uploadEditDraft.artworkUrl
                  ? <Image source={{ uri: uploadEditDraft.artworkUri || uploadEditDraft.artworkUrl! }} style={localStyles.uploadPreviewArtwork} />
                  : <View style={localStyles.uploadPreviewPlaceholder}><Text style={localStyles.uploadFallbackNote}>♪</Text></View>}
              </Pressable>
              <View style={localStyles.uploadIdentityFields}>
                <TextInput editable={!isUploadEditSaving} maxLength={180} onChangeText={(artist) => setUploadEditDraft((current) => current ? { ...current, artist } : current)} placeholder="Имя артиста" placeholderTextColor="#8e99a4" style={localStyles.uploadIdentityInput} value={uploadEditDraft.artist} />
                <TextInput editable={!isUploadEditSaving} maxLength={120} onChangeText={(title) => setUploadEditDraft((current) => current ? { ...current, title } : current)} placeholder="Название трека" placeholderTextColor="#8e99a4" style={localStyles.uploadIdentityInput} value={uploadEditDraft.title} />
              </View>
            </View>
            <View style={localStyles.releaseDateRow}>
              <Pressable accessibilityLabel="Выбрать дату релиза" accessibilityRole="button" onPress={() => setReleaseDateTarget('upload-edit')} style={localStyles.releaseDateButton}>
                <CalendarDays color="#6f7b86" size={20} strokeWidth={1.8} />
                <View style={localStyles.releaseDateCopy}>
                  <Text style={localStyles.releaseDateLabel}>Дата релиза</Text>
                  <Text style={[localStyles.releaseDateValue, !uploadEditDraft.releaseDate && localStyles.releaseDatePlaceholder]}>{uploadEditDraft.releaseDate || 'Не указана'}</Text>
                </View>
              </Pressable>
              {uploadEditDraft.releaseDate ? <Pressable accessibilityLabel="Убрать дату релиза" onPress={() => setUploadEditDraft((current) => current ? { ...current, releaseDate: '' } : current)} style={localStyles.releaseDateClear}><X color="#6f7b86" size={18} /></Pressable> : null}
            </View>
            <View style={localStyles.uploadGenreSection}>
              <MusicGenreSelector
                editorCard
                maxSelected={audioReleaseGenreLimit}
                onChange={(genres) => setUploadEditDraft((current) => current ? { ...current, genres } : current)}
                primarySelectionCount={releasePrimaryGenreLimit}
                selected={uploadEditDraft.genres}
                subgenresOnly
                title="Жанры трека"
              />
            </View>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: uploadEditDraft.includeSelfAsParticipant }}
              onPress={() => setUploadEditDraft((current) => current ? { ...current, includeSelfAsParticipant: !current.includeSelfAsParticipant } : current)}
              style={localStyles.releaseCheckboxRow}
            >
              <View style={[localStyles.releaseCheckbox, uploadEditDraft.includeSelfAsParticipant && localStyles.releaseCheckboxActive]}>
                {uploadEditDraft.includeSelfAsParticipant ? <Check color="#fff" size={15} strokeWidth={2.5} /> : null}
              </View>
              <Text style={localStyles.releaseCheckboxText}>Указать себя в качестве артиста в релизе</Text>
            </Pressable>
          </>
        ) : null}
      </AppSheetModal>
      <CalendarPickerModal
        isVisible={releaseDateTarget !== null}
        minDate={new Date(1900, 0, 1)}
        onClose={() => setReleaseDateTarget(null)}
        onSelect={(value) => {
          if (releaseDateTarget === 'external') setExternalReleaseDate(value);
          if (releaseDateTarget === 'upload') setUploadDraft((current) => current ? { ...current, releaseDate: value } : current);
          if (releaseDateTarget === 'upload-edit') setUploadEditDraft((current) => current ? { ...current, releaseDate: value } : current);
          setReleaseDateTarget(null);
        }}
        selectedValue={releaseDateTarget === 'external'
          ? externalReleaseDate || formatReleaseDateInput(new Date())
          : releaseDateTarget === 'upload'
            ? uploadDraft?.releaseDate || formatReleaseDateInput(new Date())
            : uploadEditDraft?.releaseDate || formatReleaseDateInput(new Date())}
        title="Дата релиза"
      />
      <Modal animationType="slide" onRequestClose={closePlaylistEditor} presentationStyle="fullScreen" visible={Boolean(playlistDraft)}>
        <View style={{ flex: 1, paddingTop: safeAreaInsets.top, backgroundColor: '#fff' }}>
          {playlistDraft ? <PlaylistEditorSurface
            name={playlistDraft.name} artworkUrl={playlistDraftArtwork} hasCustomArtwork={hasCustomPlaylistArtwork}
            tracks={playlistDraftTracks} saving={arePlaylistsSaving} error={playlistEditorError}
            bottomInset={safeAreaInsets.bottom} footer={globalAudio.activeTrack ? playlistPlayer : undefined}
            onCancel={closePlaylistEditor}
            onSave={() => void savePlaylists(playlists.map(playlist => playlist.id === playlistDraft.id ? { ...playlistDraft, name: playlistDraft.name.trim() } : playlist))}
            onChangeName={name => setPlaylistDraft(current => current ? { ...current, name } : current)}
            onChooseArtwork={() => void choosePlaylistArtwork()} onRemoveArtwork={removePlaylistArtwork}
            onRemoveTrack={key => setPlaylistDraft(current => current ? { ...current, tracks: current.tracks.filter(value => value !== key) } : current)}
            onDelete={playlists.some(playlist => playlist.id === playlistDraft.id) ? confirmDeletePlaylist : undefined}
          /> : null}
          <AppSheetModal isVisible={isPlaylistDeleteVisible && Boolean(playlistDraft)} onClose={() => { if (!arePlaylistsSaving) setIsPlaylistDeleteVisible(false); }} title="Удалить плейлист?" subtitle="Плейлист и его обложка будут удалены. Треки останутся в медиатеке."
            footer={<View style={styles.eventFilterActions}>
              <Pressable accessibilityRole="button" disabled={arePlaylistsSaving} onPress={() => setIsPlaylistDeleteVisible(false)} style={styles.eventFilterReset}><Text style={styles.eventFilterResetText}>Отмена</Text></Pressable>
              <Pressable accessibilityRole="button" disabled={arePlaylistsSaving} onPress={() => playlistDraft && void savePlaylists(playlists.filter(playlist => playlist.id !== playlistDraft.id))} style={[styles.eventFilterApply, arePlaylistsSaving && styles.disabledButton]}>{arePlaylistsSaving ? <LoadingIndicator tone="inverse" /> : <Text style={styles.eventFilterApplyText}>Удалить</Text>}</Pressable>
            </View>}>
            {playlistEditorError ? <Text accessibilityRole="alert" style={styles.settingsError}>{playlistEditorError}</Text> : null}
          </AppSheetModal>
        </View>
      </Modal>
      <AvatarCropModal asset={playlistArtworkCropAsset} cropShape="square" label="обложку плейлиста" onApply={(uri) => { void applyPlaylistArtwork(uri); }} onClose={() => setPlaylistArtworkCropAsset(null)} />
    </View>
  );
}

const localStyles = StyleSheet.create({
  listenLaterInfoContent: { gap: 14 },
  listenLaterInfoText: { color: '#323a43', fontSize: 15, lineHeight: 22 },
  catalogScreen: { flex: 1, backgroundColor: '#fff' },
  catalogContent: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 36 },
  catalogHeaderAction: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  downloadsEntry: { marginTop: 16 },
  favoriteTrackList: { marginTop: 12, gap: 4 },
  favoriteTracksEmpty: { minHeight: 80, color: '#6f7b86', fontSize: 14, lineHeight: 20, textAlign: 'center', textAlignVertical: 'center' },
  catalogEmptyTitle: { color: '#6f7b86', fontSize: 14, lineHeight: 20, textAlign: 'center' },
  listenLaterContent: { minHeight: 176, paddingHorizontal: 18, paddingTop: 8, paddingBottom: 36, gap: 4 },
  listenLaterCard: {},
  catalogPlaylistContent: { minHeight: 176, paddingHorizontal: 18, paddingTop: 16, paddingBottom: 36, gap: 8 },
  catalogRetryButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  catalogPlaylistRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 5 },
  catalogPlaylistArtworkFallback: { width: 46, height: 46, borderRadius: 4, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f3f5f7' },
  catalogPlaylistCopy: { flex: 1, minWidth: 0 },
  catalogPlaylistTitle: { color: '#111', fontSize: 14, lineHeight: 19, fontWeight: '600' },
  catalogPlaylistMeta: { marginTop: 1, color: '#6f7b86', fontSize: 12, lineHeight: 17 },
  playlistUnavailableTrack: { paddingVertical: 10, color: '#7d8894', fontSize: 13, lineHeight: 18 },
  favoriteRadiosContent: { minHeight: 176, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 36, gap: 4 },
  playlistCreateInput: { minHeight: 50, borderWidth: 1, borderColor: '#d7dee5', borderRadius: 8, paddingHorizontal: 14, color: '#111', fontSize: 16, backgroundColor: '#fff' },
  playlistCreateButton: { minHeight: 48, marginTop: 16, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: '#111' },
  playlistCreateButtonText: { color: '#fff', fontSize: 14, lineHeight: 20, fontWeight: '600' },
  shell: { flex: 1, backgroundColor: '#f3f5f7' },
  iconButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 16, gap: 14, paddingBottom: 36 },
  card: { backgroundColor: '#fff', borderRadius: 8, padding: 16 },
  playlistHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  playlistHeaderCopy: { flex: 1, minWidth: 0 },
  playlistAddButton: { width: 42, height: 42, borderRadius: 21, flexShrink: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f3f5f7' },
  playlistRow: { minHeight: 62, marginTop: 10, paddingHorizontal: 10, borderRadius: 8, backgroundColor: '#f3f5f7', flexDirection: 'row', alignItems: 'center' },
  playlistIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  playlistArtwork: { width: 42, height: 42, borderRadius: 7, backgroundColor: '#d7dee5' },
  removeArtworkText: { color: '#e53935', fontSize: 13, fontWeight: '400' },
  playlistNameInput: { minHeight: 44, borderWidth: 1, borderColor: '#d7dee5', borderRadius: 8, paddingHorizontal: 18, backgroundColor: '#fff', color: '#111', fontSize: 16 },
  playlistTrackOption: { minHeight: 58, paddingHorizontal: 16, borderRadius: 8, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fff' },
  playlistTrackOptionSelected: { backgroundColor: '#111' },
  playlistTrackTextSelected: { color: '#fff' },
  playlistTrackMetaSelected: { color: '#c8d1da' },
  disabled: { opacity: 0.35 },
  cardTitle: { fontSize: 18, fontWeight: '600', color: '#111' },
  hint: { marginTop: 5, color: '#6f7b86', fontSize: 13, lineHeight: 18 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  quotaText: { fontSize: 13, color: '#6f7b86', fontWeight: '600' },
  quotaTrack: { height: 7, marginTop: 16, borderRadius: 100, backgroundColor: '#d7dee5', overflow: 'hidden' },
  quotaFill: { height: '100%', borderRadius: 100, backgroundColor: '#111' },
  qualityLabel: { marginTop: 18, marginBottom: 8, fontSize: 14, fontWeight: '600', color: '#111' },
  segment: { flexDirection: 'row', padding: 4, borderRadius: 100, backgroundColor: '#f3f5f7' },
  segmentItem: { flex: 1, minHeight: 42, borderRadius: 100, alignItems: 'center', justifyContent: 'center' },
  segmentItemActive: { backgroundColor: '#111' },
  uploadButton: { marginTop: 16, height: 44, borderRadius: 22, backgroundColor: '#f3f5f7', flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' },
  uploadButtonText: { color: '#111', fontSize: 15, fontWeight: '600' },
  releaseFields: { marginTop: 16, gap: 8 },
  releaseField: { marginTop: 0 },
  releaseDateRow: { minHeight: 54, marginTop: 10, paddingLeft: 14, borderRadius: 8, flexDirection: 'row', alignItems: 'center', backgroundColor: '#f3f5f7' },
  releaseDateButton: { flex: 1, minWidth: 0, minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 11 },
  releaseDateCopy: { flex: 1, minWidth: 0 },
  releaseDateLabel: { color: '#6f7b86', fontSize: 12, lineHeight: 16 },
  releaseDateValue: { color: '#111', fontSize: 14, lineHeight: 19, fontWeight: '500' },
  releaseDatePlaceholder: { color: '#7d8894', fontWeight: '400' },
  releaseDateClear: { width: 46, height: 54, alignItems: 'center', justifyContent: 'center' },
  releaseGenreSection: { marginTop: 12 },
  uploadGenreSection: { marginTop: 10 },
  releaseCheckboxRow: { minHeight: 48, marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 12 },
  releaseCheckbox: { width: 22, height: 22, borderRadius: 5, borderWidth: 1, borderColor: '#aab4be', alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  releaseCheckboxActive: { borderColor: '#111', backgroundColor: '#111' },
  releaseCheckboxText: { flex: 1, color: '#111', fontSize: 14, lineHeight: 19 },
  releaseAddButton: { alignSelf: 'flex-start', minWidth: 156, height: 44, marginTop: 12, paddingHorizontal: 22, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: '#111' },
  releaseAddButtonText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  primaryButton: { height: 44, marginTop: 14, borderRadius: 22, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  primaryButtonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  trackRow: { minHeight: 64, marginTop: 10, borderRadius: 8, backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center' },
  trackIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  trackArtwork: { width: 42, height: 42, borderRadius: 6, backgroundColor: '#d7dee5' },
  trackCopy: { flex: 1, paddingHorizontal: 10 },
  trackTitle: { color: '#111', fontSize: 15, fontWeight: '600' },
  trackMeta: { marginTop: 3, color: '#6f7b86', fontSize: 12 },
  renameFields: { flex: 1, gap: 6 },
  renameInput: { height: 36, paddingHorizontal: 10, borderWidth: 0, borderRadius: 8, backgroundColor: '#f3f5f7', fontSize: 14, color: '#111' },
  smallButton: { width: 34, height: 40, alignItems: 'center', justifyContent: 'center' },
  empty: { paddingVertical: 22, textAlign: 'center', color: '#7d8894', fontSize: 13 },
  progressCard: { marginTop: 12, padding: 14, borderRadius: 8, backgroundColor: '#f3f5f7' },
  progressHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  progressCopy: { flex: 1 },
  progressFilename: { color: '#111', fontSize: 14, fontWeight: '600' },
  progressStage: { marginTop: 3, color: '#6f7b86', fontSize: 12 },
  progressPercent: { color: '#111', fontSize: 13, fontWeight: '700' },
  processTrack: { height: 7, marginTop: 12, borderRadius: 100, backgroundColor: '#d7dee5', overflow: 'hidden' },
  processFill: { height: '100%', borderRadius: 100, backgroundColor: '#111' },
  processFillComplete: { backgroundColor: '#2fbd63' },
  processFillError: { backgroundColor: '#e53935' },
  progressError: { color: '#e53935' },
  stepsRow: { marginTop: 8, flexDirection: 'row', justifyContent: 'space-between' },
  stepText: { color: '#98a3ae', fontSize: 10 },
  stepTextActive: { color: '#111', fontWeight: '600' },
  loadErrorCard: { marginTop: 12, alignItems: 'center', gap: 10 },
  retryButton: { height: 38, paddingHorizontal: 20, borderRadius: 100, backgroundColor: '#111', justifyContent: 'center' },
  retryButtonText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  uploadIdentityRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  uploadArtworkButton: { width: 112, height: 112, borderWidth: 1, borderColor: '#d7dee5', borderRadius: 8, backgroundColor: '#f3f5f7', overflow: 'hidden' },
  uploadPreviewArtwork: { width: '100%', height: '100%', backgroundColor: '#d7dee5' },
  uploadPreviewPlaceholder: { width: '100%', height: '100%', backgroundColor: '#f3f5f7', alignItems: 'center', justifyContent: 'center' },
  uploadFallbackNote: { color: '#53606c', fontSize: 32, lineHeight: 38, fontWeight: '400' },
  uploadIdentityFields: { flex: 1, gap: 8 },
  uploadIdentityInput: { height: 52, paddingHorizontal: 14, borderWidth: 0, borderRadius: 8, backgroundColor: '#f3f5f7', color: '#111', fontSize: 16 },
  editUploadSaveButton: { marginTop: 0 },
});
