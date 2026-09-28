import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { apiFetch, apiUrl, readApiError, remoteSearchDebounceMs } from '../api/client';
import { AppRefreshControl } from '../components/AppRefreshControl';
import { useCatalogSnapshot } from '../components/CatalogSnapshot';
import { boundedPlaybackQueue, uploadedTrackPlayerId } from '../components/audioPlayerCore';
import { useGlobalAudioControls, type GlobalTrackQueueItem } from '../components/GlobalAudioPlayer';
import { musicSearchRows, personalMusicMatches, type MusicCatalogItem, type MusicSearchRow } from '../music/musicCatalogSearch';
import { CatalogPaginationFooter, catalogPaginationStyles } from '../components/CatalogPaginationFooter';
import { useCatalogPagination } from '../components/useCatalogPagination';
import { buildFavoriteMusicQueue, MusicGenreSelector, ProfileMusicPlayerItem, UploadedMusicPlayerCard } from './ProfileScreens';

type CatalogPage = { items: MusicCatalogItem[]; nextCursor: string | null };

export function MusicDiscovery({ query, personalItems, genres, onChangeGenres }: {
  query: string; personalItems: MusicCatalogItem[]; genres: string[]; onChangeGenres: (genres: string[]) => void;
}) {
  const { activeTrack } = useGlobalAudioControls();
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const request = useRef<AbortController | null>(null);
  const busy = useRef(true);
  const generation = useRef(0);
  const list = useRef<FlatList<MusicSearchRow>>(null);
  const genreKey = [...genres].sort().join(',');
  const normalizedQuery = query.trim();
  const filterKey = JSON.stringify([normalizedQuery, genreKey]);
  const catalogSnapshot = useCatalogSnapshot<{ items: MusicCatalogItem[]; nextCursor: string | null }>(`music:${filterKey}`);
  const [items, setItems] = useState<MusicCatalogItem[]>(() => catalogSnapshot.read()?.items ?? []);
  const [resultFilter, setResultFilter] = useState<string | null>(() => catalogSnapshot.read() ? filterKey : null);
  const [nextCursor, setNextCursor] = useState<string | null>(() => catalogSnapshot.read()?.nextCursor ?? null);
  const [loading, setLoading] = useState(() => !catalogSnapshot.read());
  const personalMatches = useMemo(() => personalMusicMatches(personalItems, normalizedQuery, genres), [personalItems, normalizedQuery, genreKey]);
  const rows = useMemo(() => musicSearchRows(personalMatches, resultFilter === filterKey ? items : [], Boolean(normalizedQuery)),
    [personalMatches, items, resultFilter, filterKey, normalizedQuery]);
  const queue = useMemo(() => rows.flatMap((item): GlobalTrackQueueItem[] => item.kind === 'external'
    ? buildFavoriteMusicQueue([item.track])
    : [{ id: uploadedTrackPlayerId(item.track.id), title: item.track.title, artist: item.track.artist || '',
      artworkUrl: item.track.artworkUrl, previewUrl: `${apiUrl}/my-music/stream/${encodeURIComponent(item.track.id)}`,
      provider: 'volna', startSeconds: 0, clipDurationSeconds: item.track.durationSeconds,
      releaseDate: item.track.releaseDate, genres: item.track.genres, participants: item.track.participants }]), [rows]);
  const resolveQueue = useCallback((target: GlobalTrackQueueItem) => boundedPlaybackQueue(queue, target), [queue]);

  const load = useCallback(async (cursor: string | null, version: number) => {
    const controller = new AbortController();
    request.current?.abort();
    request.current = controller;
    busy.current = true;
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ q: normalizedQuery, genres: genreKey });
      if (cursor) params.set('cursor', cursor);
      const response = await apiFetch(`${apiUrl}/my-music/catalog?${params}`, { signal: controller.signal });
      if (!response.ok) throw new Error(await readApiError(response, 'Не удалось загрузить музыку'));
      const page = await response.json() as CatalogPage;
      if (controller.signal.aborted || generation.current !== version) return;
      if (!cursor) catalogSnapshot.write({ items: page.items, nextCursor: page.nextCursor });
      setItems((previous) => cursor ? [...new Map([...previous, ...page.items].map((item) => [item.key, item])).values()] : page.items);
      setResultFilter(filterKey);
      setNextCursor(page.nextCursor);
    } catch (reason) {
      if (!controller.signal.aborted && generation.current === version) setError(reason instanceof Error ? reason.message : 'Не удалось загрузить музыку');
    } finally {
      if (!controller.signal.aborted && generation.current === version) { busy.current = false; setLoading(false); setRefreshing(false); }
    }
  }, [catalogSnapshot, genreKey, normalizedQuery, filterKey]);

  useEffect(() => {
    const version = ++generation.current;
    busy.current = true;
    setLoading(true);
    setError('');
    const remembered = catalogSnapshot.read();
    setItems(remembered?.items ?? []);
    setResultFilter(remembered ? filterKey : null);
    setNextCursor(remembered?.nextCursor ?? null);
    list.current?.scrollToOffset({ offset: 0, animated: false });
    const timer = setTimeout(() => void load(null, version), normalizedQuery || genreKey ? remoteSearchDebounceMs : 0);
    return () => { clearTimeout(timer); request.current?.abort(); generation.current++; };
  }, [catalogSnapshot, filterKey, load, refresh]);

  const pagination = useCatalogPagination({
    cursor: nextCursor, loading, enabled: resultFilter === filterKey, error: Boolean(error), rowCount: rows.length,
    resetKey: `${filterKey}:${refresh}`, onLoadMore: () => {
      if (busy.current) return false;
      void load(nextCursor, generation.current);
      return true;
    },
  });
  return <View style={local.screen}>
    <View style={local.toolbar}>
      <MusicGenreSelector filterButton title="Жанры" selected={genres} onChange={onChangeGenres} />
    </View>
    <FlatList ref={list} data={rows} keyExtractor={(item) => item.key}
      contentContainerStyle={[local.content, activeTrack && catalogPaginationStyles.contentWithPlayer]} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
      initialNumToRender={10} maxToRenderPerBatch={10} windowSize={7} showsVerticalScrollIndicator={false}
      onLayout={pagination.onLayout} onContentSizeChange={pagination.onContentSizeChange} onScroll={pagination.onScroll}
      onEndReached={pagination.onEndReached} onEndReachedThreshold={0.35} scrollEventThrottle={32}
      refreshControl={<AppRefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); setRefresh((value) => value + 1); }} />}
      ListHeaderComponent={!normalizedQuery ? <Text style={local.heading}>{genres.length ? 'Результаты поиска' : 'Последние релизы'}</Text> : null}
      renderItem={({ item, index }) => <View>
        {item.sectionTitle ? <Text accessibilityRole="header" style={[local.heading, index > 0 && local.sectionHeading]}>{item.sectionTitle}</Text> : null}
        {item.kind === 'upload'
        ? <UploadedMusicPlayerCard ownerName={item.track.artist || ''} queue={queue} queueWindowResolver={resolveQueue} track={item.track} />
        : <ProfileMusicPlayerItem preferSnapshot profileQueue={queue} queueWindowResolver={resolveQueue} track={item.track} />}
      </View>}
      ListEmptyComponent={!loading && !error && !nextCursor ? <Text style={catalogPaginationStyles.hint}>{normalizedQuery || genres.length ? 'Ничего не найдено' : 'Пока нет добавленной музыки'}</Text> : null}
      ListFooterComponent={<CatalogPaginationFooter loading={loading} refreshing={refreshing} error={error} hasMore={Boolean(nextCursor)} onContinue={pagination.continue} />} />
  </View>;
}

const local = StyleSheet.create({
  screen: { flex: 1 },
  toolbar: { paddingHorizontal: 18, paddingTop: 16, paddingBottom: 16, gap: 12 },
  content: { paddingHorizontal: 18, paddingBottom: 36 },
  heading: { color: '#111', fontSize: 16, fontWeight: '500', lineHeight: 23, marginBottom: 12 },
  sectionHeading: { marginTop: 20 },
});
