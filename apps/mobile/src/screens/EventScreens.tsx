import { Bell, BellOff, CalendarClock, CalendarDays, CalendarPlus, Check, ChevronRight, Clock3, EllipsisVertical, Flag, Handshake, List, MapPin, PanelsTopLeft, Pencil, Plus, Search, Share2, SlidersHorizontal, X } from 'lucide-react-native';
import * as Calendar from 'expo-calendar';
import * as Location from 'expo-location';
import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { UIEvent as ReactUIEvent } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, SafeAreaView, ScrollView, Text, TextInput, useWindowDimensions, View } from 'react-native';
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { AppImage as Image } from '../components/AppImage';
import { FlashList } from '@shopify/flash-list';
import { ScreenTopBar } from '../components/navigation';
import { PostFeed } from '../components/PostFeed';
import { LocationPickerModal } from '../components/LocationPickerModal';
import { EntityShareModal } from '../components/EntityShareModal';
import { AppRefreshControl } from '../components/AppRefreshControl';
import { AppSheetModal } from '../components/AppSheetModal';
import { SelectionPickerModal } from '../components/SelectionPickerModal';
import { apiFetch as fetch, apiUrl, readApiError, remoteSearchDebounceMs } from '../api/client';
import { getAvatarInitial, parseDateInput, parseDateTimeInput, russianPlural, uploadEventPosterAsset } from '../domain';
import { useAccountSearchSuggestions } from '../hooks/useAccountSearchSuggestions';
import { styles } from '../styles';
import type { CreateEventInput, CursorPage, EventParticipationStatus, EventSummary, EventTypeOption, ProfileEvent, PublicPage, PublicPageDetail, ToastMessage } from '../types';
import { AvatarCropModal } from './ProfileScreens';
import { CalendarPickerModal, CreateEventScreen, TimePickerModal } from './CreateEventScreen';
import { CatalogCategoryTile, eventCategoryOptions, useCategoryCovers } from '../components/CatalogCategoryTile';
import { CatalogInnerHeader } from '../components/CatalogInnerHeader';
import { resolveForegroundLocation } from '../location/foregroundLocation';
import { normalizeExternalHttpsUrl } from '../security/externalUrls.mjs';
import { openExternalHttpsUrl } from '../security/openExternalUrl';

type EventFilters = {
  cityId: string;
  cityName: string;
  countryCode: string;
  countryName: string;
  dateFrom: string;
  dateTo: string;
  types: string[];
  venue: PublicPage | null;
};

type EventListTab = 'all' | 'planned';
type EventCategory = typeof eventCategoryOptions[number]['value'];
type EventCatalogListItem =
  | { kind: 'event'; event: EventSummary; period: 'upcoming' | 'past' }
  | { kind: 'upcoming-empty' }
  | { kind: 'archive-control' }
  | { kind: 'archive-heading' }
  | { kind: 'archive-empty' };

const emptyEventFilters: EventFilters = { cityId: '', cityName: '', countryCode: '', countryName: '', dateFrom: '', dateTo: '', types: [], venue: null };
const nearbyCityRadiusKilometers = 120;

type SelectableCityLocation = {
  id: string;
  name: string;
  countryCode: string;
  latitude: number | null;
  longitude: number | null;
  country: { name: string };
};

function distanceKilometers(latitude: number, longitude: number, cityLatitude: number, cityLongitude: number) {
  const toRadians = (value: number) => value * Math.PI / 180;
  const latitudeDelta = toRadians(cityLatitude - latitude);
  const longitudeDelta = toRadians(cityLongitude - longitude);
  const startLatitude = toRadians(latitude);
  const endLatitude = toRadians(cityLatitude);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(startLatitude) * Math.cos(endLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

export function EventsScreen({
  accountRole,
  adminMode,
  authToken,
  defaultLocation,
  initialEventId,
  onBackFromInitialEvent,
  onOpenMenu,
  onOpenMessages,
  onOpenNotifications,
  onNotify,
  onOpenProfile,
  onOpenPublicPage,
  onToggleEventParticipation,
  ownAccountId,
}: {
  accountRole: 'USER' | 'MODERATOR' | 'ADMIN';
  adminMode: boolean;
  authToken: string;
  defaultLocation: { cityId: string | null; cityName: string; countryCode?: string; countryName: string };
  initialEventId?: string | null;
  onBackFromInitialEvent?: () => void;
  onOpenMenu: () => void;
  onOpenMessages: () => void;
  onOpenNotifications: () => void;
  onNotify: (message: string, type?: ToastMessage['type']) => void;
  onOpenProfile: (username: string) => Promise<void>;
  onOpenPublicPage: (username: string) => Promise<void>;
  onToggleEventParticipation: (eventId: string, status: EventParticipationStatus | null) => Promise<EventSummary>;
  ownAccountId: string;
}) {
  const { covers: categoryCovers, reload: reloadCategoryCovers } = useCategoryCovers();
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [pastEvents, setPastEvents] = useState<EventSummary[]>([]);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isPastInitialLoading, setIsPastInitialLoading] = useState(false);
  const [isPastLoadingMore, setIsPastLoadingMore] = useState(false);
  const [hasLoadedPastEvents, setHasLoadedPastEvents] = useState(false);
  const [showPastEvents, setShowPastEvents] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [pastNextCursor, setPastNextCursor] = useState<string | null>(null);
  const [filters, setFilters] = useState<EventFilters>(() => ({
    ...emptyEventFilters,
    cityId: defaultLocation.cityId ?? '',
    cityName: defaultLocation.cityName,
    countryCode: defaultLocation.countryCode ?? '',
    countryName: defaultLocation.countryName,
  }));
  const [activeListTab, setActiveListTab] = useState<EventListTab>('all');
  const [selectedCategory, setSelectedCategory] = useState<EventCategory | null>(null);
  const [categoryCounts, setCategoryCounts] = useState<Record<EventCategory, number> | null>(null);
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  const [isCatalogLocationPickerOpen, setIsCatalogLocationPickerOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<EventSummary | null>(null);
  const locationWasManuallyChangedRef = useRef(false);
  const pastLoadInFlightRef = useRef(false);

  useEffect(() => {
    let isCancelled = false;
    const detectNearbyCity = async () => {
      try {
        const [position, cityResponse] = await Promise.all([
          resolveForegroundLocation(),
          fetch(`${apiUrl}/locations/cities`),
        ]);
        if (!position || !cityResponse.ok || isCancelled) return;
        const cities = await cityResponse.json() as SelectableCityLocation[];
        const nearest = cities
          .filter((city) => Number.isFinite(city.latitude) && Number.isFinite(city.longitude))
          .map((city) => ({
            city,
            distance: distanceKilometers(position.latitude, position.longitude, city.latitude!, city.longitude!),
          }))
          .sort((left, right) => left.distance - right.distance)[0];
        if (!nearest || nearest.distance > nearbyCityRadiusKilometers || isCancelled || locationWasManuallyChangedRef.current) return;
        setFilters((current) => current.cityId === nearest.city.id ? current : ({
          ...current,
          cityId: nearest.city.id,
          cityName: nearest.city.name,
          countryCode: nearest.city.countryCode,
          countryName: nearest.city.country.name,
          venue: null,
        }));
      } catch {
        // Permission denial, unavailable browser location, and transient GPS
        // failures intentionally retain the profile-based location fallback.
      }
    };
    void detectNearbyCity();
    return () => { isCancelled = true; };
  }, []);

  const loadEvents = useCallback(async (reset = true, source: 'initial' | 'refresh' = 'initial') => {
    if (activeListTab === 'all' && !selectedCategory) {
      setEvents([]);
      setNextCursor(null);
      setIsInitialLoading(false);
      setIsRefreshing(false);
      setIsLoadingMore(false);
      return;
    }
    if (!reset && !nextCursor) return;
    if (reset) source === 'refresh' ? setIsRefreshing(true) : setIsInitialLoading(true);
    else setIsLoadingMore(true);

    try {
      const cursorQuery = !reset && nextCursor ? `&cursor=${encodeURIComponent(nextCursor)}` : '';
      const filterQuery = activeListTab === 'all' ? buildEventFilterQuery(filters) : '';
      const plannedQuery = activeListTab === 'planned' ? '&planned=true' : '';
      const categoryQuery = activeListTab === 'all' && selectedCategory ? `&category=${selectedCategory}` : '';
      const response = await fetch(`${apiUrl}/events?pageSize=7${filterQuery}${plannedQuery}${categoryQuery}${cursorQuery}`, {
        cache: source === 'refresh' ? 'no-store' : undefined,
        headers: { Authorization: `Bearer ${authToken}` },
      });

      if (!response.ok) {
        throw new Error(await readApiError(response, 'Не удалось загрузить события'));
      }

      const page = await response.json() as CursorPage<EventSummary>;
      setEvents((current) => reset ? page.items : [...current, ...page.items.filter((item) => !current.some((existing) => existing.id === item.id))]);
      setNextCursor(page.nextCursor);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : 'Не удалось загрузить события', 'error');
    } finally {
      setIsInitialLoading(false);
      setIsRefreshing(false);
      setIsLoadingMore(false);
    }
  }, [activeListTab, authToken, filters, nextCursor, onNotify, selectedCategory]);

  const loadPastEvents = useCallback(async (reset = true, source: 'initial' | 'refresh' = 'initial') => {
    if (activeListTab !== 'all' || !selectedCategory || pastLoadInFlightRef.current) return;
    if (!reset && !pastNextCursor) return;
    pastLoadInFlightRef.current = true;
    if (reset && source === 'initial') setIsPastInitialLoading(true);
    if (!reset) setIsPastLoadingMore(true);

    try {
      const cursorQuery = !reset && pastNextCursor ? `&cursor=${encodeURIComponent(pastNextCursor)}` : '';
      const filterQuery = buildEventFilterQuery(filters);
      const response = await fetch(`${apiUrl}/events?pageSize=7&period=past&category=${selectedCategory}${filterQuery}${cursorQuery}`, {
        cache: source === 'refresh' ? 'no-store' : undefined,
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!response.ok) throw new Error(await readApiError(response, 'Не удалось загрузить прошедшие события'));

      const page = await response.json() as CursorPage<EventSummary>;
      setPastEvents((current) => reset ? page.items : [...current, ...page.items.filter((item) => !current.some((existing) => existing.id === item.id))]);
      setPastNextCursor(page.nextCursor);
      setHasLoadedPastEvents(true);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : 'Не удалось загрузить прошедшие события', 'error');
    } finally {
      pastLoadInFlightRef.current = false;
      setIsPastInitialLoading(false);
      setIsPastLoadingMore(false);
    }
  }, [activeListTab, authToken, filters, onNotify, pastNextCursor, selectedCategory]);

  const loadCategoryCounts = useCallback(async () => {
    if (activeListTab !== 'all') return;
    try {
      const filterQuery = buildEventFilterQuery(filters);
      const response = await fetch(`${apiUrl}/events/category-counts${filterQuery ? `?${filterQuery.slice(1)}` : ''}`, { headers: { Authorization: `Bearer ${authToken}` } });
      if (!response.ok) throw new Error(await readApiError(response, 'Не удалось загрузить категории событий'));
      setCategoryCounts(await response.json() as Record<EventCategory, number>);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : 'Не удалось загрузить категории событий', 'error');
    }
  }, [activeListTab, authToken, filters, onNotify]);

  useEffect(() => {
    setEvents([]);
    setNextCursor(null);
    setPastEvents([]);
    setPastNextCursor(null);
    setHasLoadedPastEvents(false);
    setShowPastEvents(false);
    void loadEvents(true);
    // Cursor is intentionally excluded: loading another page must not reset the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeListTab, authToken, filters, selectedCategory]);

  useEffect(() => { void loadCategoryCounts(); }, [loadCategoryCounts]);

  useEffect(() => {
    const eventId = initialEventId || (Platform.OS === 'web' && typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('event')
      : null);
    if (!eventId) return;
    void fetch(`${apiUrl}/events/${encodeURIComponent(eventId)}`, { headers: { Authorization: `Bearer ${authToken}` } })
      .then(async (response) => response.ok ? response.json() as Promise<EventSummary> : null)
      .then((result) => { if (result) setSelectedEvent(result); })
      .catch(() => undefined);
  }, [authToken, initialEventId]);

  const updateParticipation = async (event: EventSummary, status: EventParticipationStatus) => {
    const nextStatus = event.myParticipationStatus === status ? null : status;
    const updatedEvent = await onToggleEventParticipation(event.id, nextStatus);
    setEvents((currentEvents) => currentEvents.map((currentEvent) => (currentEvent.id === updatedEvent.id ? updatedEvent : currentEvent)));
    setPastEvents((currentEvents) => currentEvents.map((currentEvent) => (currentEvent.id === updatedEvent.id ? updatedEvent : currentEvent)));
  };

  const eventListItems = useMemo<EventCatalogListItem[]>(() => {
    if (activeListTab === 'all' && !selectedCategory) return [];
    const items: EventCatalogListItem[] = events.map((event) => ({ kind: 'event', event, period: 'upcoming' }));
    const archiveBoundaryReached = activeListTab === 'all' && Boolean(selectedCategory) && !isInitialLoading && !nextCursor;
    if (!archiveBoundaryReached) return items;

    if (!events.length) items.push({ kind: 'upcoming-empty' });
    items.push({ kind: 'archive-control' });
    if (!showPastEvents) return items;

    items.push({ kind: 'archive-heading' });
    items.push(...pastEvents.map((event) => ({ kind: 'event' as const, event, period: 'past' as const })));
    if (hasLoadedPastEvents && !pastEvents.length && !isPastInitialLoading) items.push({ kind: 'archive-empty' });
    return items;
  }, [activeListTab, events, hasLoadedPastEvents, isInitialLoading, isPastInitialLoading, nextCursor, pastEvents, selectedCategory, showPastEvents]);

  const togglePastEvents = () => {
    if (showPastEvents) {
      setShowPastEvents(false);
      return;
    }
    setShowPastEvents(true);
    if (!hasLoadedPastEvents) void loadPastEvents(true);
  };

  const openCatalogEvent = (event: EventSummary) => {
    setSelectedEvent(event);
    if (Platform.OS === 'web') window.history.replaceState({ tab: 'events', eventId: event.id }, '', `/events?event=${encodeURIComponent(event.id)}`);
  };

  const closeSelectedEvent = () => {
    setSelectedEvent(null);
    if (initialEventId && onBackFromInitialEvent) {
      onBackFromInitialEvent();
      return;
    }
    if (Platform.OS === 'web') window.history.replaceState({ tab: 'events' }, '', '/events');
  };

  if (selectedEvent) return <EventDetailScreen adminMode={adminMode} authToken={authToken} event={selectedEvent} isGlobalAdmin={accountRole === 'ADMIN'} onBack={closeSelectedEvent} onDeleted={(eventId) => { setEvents((current) => current.filter((item) => item.id !== eventId)); setPastEvents((current) => current.filter((item) => item.id !== eventId)); closeSelectedEvent(); }} onNotify={onNotify} onOpenMenu={onOpenMenu} onOpenMessages={onOpenMessages} onOpenNotifications={onOpenNotifications} onOpenProfile={onOpenProfile} onOpenPublicPage={onOpenPublicPage} onUpdate={(updatedEvent) => { setSelectedEvent(updatedEvent); setEvents((current) => current.map((item) => item.id === updatedEvent.id ? updatedEvent : item)); setPastEvents((current) => current.map((item) => item.id === updatedEvent.id ? updatedEvent : item)); }} onToggleParticipation={onToggleEventParticipation} ownAccountId={ownAccountId} />;

  return (
    <>
      <ScreenTopBar onOpenMenu={onOpenMenu} onOpenMessages={onOpenMessages} onOpenNotifications={onOpenNotifications} title="События" />
      <FlashList
        alwaysBounceVertical
        data={eventListItems}
        keyExtractor={(item) => item.kind === 'event' ? `${item.period}:${item.event.id}` : item.kind}
        contentContainerStyle={styles.eventsScreenContent}
        refreshControl={<AppRefreshControl refreshing={isRefreshing} tintColor="#111" onRefresh={() => void Promise.all([
          loadEvents(true, 'refresh'),
          ...(showPastEvents && selectedCategory ? [loadPastEvents(true, 'refresh')] : []),
          loadCategoryCounts(),
          reloadCategoryCovers(),
        ])} />}
        showsVerticalScrollIndicator={false}
        onEndReached={() => {
          if (nextCursor) void loadEvents(false);
          else if (showPastEvents && pastNextCursor) void loadPastEvents(false);
        }}
        onEndReachedThreshold={0.4}
        ListHeaderComponent={<>
          {activeListTab === 'all' && selectedCategory ? null : <View accessibilityRole="tablist" style={styles.eventCatalogTabs}>
            {([{ value: 'all', label: 'Категории' }, { value: 'planned', label: 'Планирую посетить' }] as const).map((tab) => {
              const isActive = activeListTab === tab.value;
              return <Pressable accessibilityRole="tab" accessibilityState={{ selected: isActive }} key={tab.value} onPress={() => setActiveListTab(tab.value)} style={styles.eventCatalogTab}><Text style={[styles.eventCatalogTabText, isActive && styles.eventCatalogTabTextActive]}>{tab.label}</Text>{isActive ? <View pointerEvents="none" style={styles.activeTabIndicator} /> : null}</Pressable>;
            })}
          </View>}
          {activeListTab === 'all' ? <>
            {selectedCategory ? <CatalogInnerHeader
              backLabel="Назад к категориям событий"
              onBack={() => { setFilters((current) => ({ ...current, types: [] })); setSelectedCategory(null); }}
              title={eventCategoryOptions.find((category) => category.value === selectedCategory)?.label ?? ''}
            /> : null}
            {selectedCategory ? <View style={styles.eventFilterHeader}><View style={styles.eventCatalogControls}>
              <Pressable accessibilityLabel={filters.cityName ? `Местоположение: ${filters.cityName}` : filters.countryName ? `Местоположение: ${filters.countryName}` : 'Выбрать местоположение'} accessibilityRole="button" onPress={() => setIsCatalogLocationPickerOpen(true)} style={[styles.connectFilterButton, styles.eventCatalogControlButton, Boolean(filters.cityId || filters.countryCode) && styles.eventFilterButtonActive]}><MapPin color="#111" size={18} strokeWidth={1.8} /><Text numberOfLines={1} style={[styles.connectFilterButtonText, styles.eventCatalogLocationText]}>{filters.cityName || filters.countryName || 'Местоположение'}</Text></Pressable>
              <Pressable accessibilityLabel={activeEventFilterCount(filters) ? `Фильтры, активно: ${activeEventFilterCount(filters)}` : 'Фильтры'} accessibilityRole="button" onPress={() => setIsFiltersOpen(true)} style={[styles.connectFilterButton, styles.eventCatalogControlButton, activeEventFilterCount(filters) > 0 && styles.eventFilterButtonActive]}><SlidersHorizontal color="#111" size={18} strokeWidth={1.8} /><Text style={styles.connectFilterButtonText}>Фильтры</Text>{activeEventFilterCount(filters) ? <View style={styles.eventFilterCountBadge}><Text style={styles.eventFilterCountBadgeText}>{activeEventFilterCount(filters)}</Text></View> : null}</Pressable>
            </View></View> : null}
            {!selectedCategory ? <View style={styles.eventFilterHeader}><View style={styles.eventCatalogControls}>
              <Pressable accessibilityLabel={filters.cityName ? `Местоположение: ${filters.cityName}` : filters.countryName ? `Местоположение: ${filters.countryName}` : 'Выбрать местоположение'} accessibilityRole="button" onPress={() => setIsCatalogLocationPickerOpen(true)} style={[styles.connectFilterButton, styles.eventCatalogControlButton, Boolean(filters.cityId || filters.countryCode) && styles.eventFilterButtonActive]}><MapPin color="#111" size={18} strokeWidth={1.8} /><Text numberOfLines={1} style={[styles.connectFilterButtonText, styles.eventCatalogLocationText]}>{filters.cityName || filters.countryName || 'Местоположение'}</Text></Pressable>
            </View></View> : null}
            {!selectedCategory ? <View accessibilityLabel="Категории событий" style={styles.eventCategoryGrid}>{eventCategoryOptions.map((category) => {
              const count = categoryCounts?.[category.value];
              const countLabel = count === undefined ? '—' : `${count} ${russianPlural(count, 'событие', 'события', 'событий')}`;
              return <CatalogCategoryTile accessibilityLabel={`${category.label}, ${count === undefined ? 'счётчик загружается' : countLabel}`} category={category.label} countLabel={countLabel} coverUrl={categoryCovers[`events:${category.value}`]} key={category.value} onPress={() => { setFilters((current) => ({ ...current, types: [] })); setSelectedCategory(category.value); }} />;
            })}</View> : null}
          </> : null}
        </>}
        renderItem={({ item }) => {
          if (item.kind === 'upcoming-empty') {
            return <View style={styles.emptyProfileTab}>
              <CalendarDays color="#111" size={28} strokeWidth={1.8} />
              <Text style={styles.emptyProfileTabTitle}>Предстоящие события не найдены</Text>
              <Text style={styles.emptyProfileTabText}>Попробуйте изменить категорию или параметры фильтра.</Text>
            </View>;
          }
          if (item.kind === 'archive-control') {
            return <View style={styles.profileEventsArchiveAction}>
              <Pressable accessibilityRole="link" accessibilityState={{ disabled: isPastInitialLoading }} disabled={isPastInitialLoading} onPress={togglePastEvents} style={styles.profileEventsArchiveLink}>
                {isPastInitialLoading ? <ActivityIndicator color="#111" size="small" /> : null}
                <Text style={styles.profileEventsArchiveLinkText}>{showPastEvents ? 'Скрыть прошедшие события' : 'Показать прошедшие события'}</Text>
              </Pressable>
            </View>;
          }
          if (item.kind === 'archive-heading') {
            return <View style={styles.eventCatalogArchiveHeading}>
              <Text style={styles.sectionTitle}><Text style={styles.sectionSlash}>/ </Text>Прошедшие события</Text>
            </View>;
          }
          if (item.kind === 'archive-empty') {
            return <View style={styles.eventCatalogArchiveEmpty}>
              <Text style={styles.eventCatalogArchiveEmptyText}>Прошедших событий с выбранными параметрами нет.</Text>
            </View>;
          }

          const event = item.event;
          return <EventCard
            event={event}
            showActions={false}
            onOpen={() => openCatalogEvent(event)}
            onOpenPublicPage={onOpenPublicPage}
            onSetParticipation={(status) => {
              void updateParticipation(event, status).catch((error) => {
                onNotify(error instanceof Error ? error.message : 'Не удалось обновить событие', 'error');
              });
            }}
          />;
        }}
        ListEmptyComponent={activeListTab === 'all' && !selectedCategory ? null : isInitialLoading ? <View style={styles.loadingRow}><ActivityIndicator color="#111" /></View> : (
          <View style={styles.emptyProfileTab}>
            <CalendarDays color="#111" size={28} strokeWidth={1.8} />
            <Text style={styles.emptyProfileTabTitle}>{activeListTab === 'planned' ? 'Нет запланированных событий' : activeEventFilterCount(filters) || selectedCategory ? 'События не найдены' : 'События появятся здесь'}</Text>
            <Text style={styles.emptyProfileTabText}>{activeListTab === 'planned' ? 'Отметьте «Иду» или включите отслеживание внутри события.' : activeEventFilterCount(filters) || selectedCategory ? 'Попробуйте изменить категорию или параметры фильтра.' : 'Когда сообщества создадут события, они будут отображаться в этой вкладке.'}</Text>
          </View>
        )}
        ListFooterComponent={isLoadingMore || isPastLoadingMore ? <ActivityIndicator color="#111" style={{ marginVertical: 16 }} /> : null}
      />
      {selectedCategory ? <EventFiltersModal authToken={authToken} category={selectedCategory} initialValue={filters} isVisible={isFiltersOpen} onApply={(value) => { if (value.cityId !== filters.cityId || value.countryCode !== filters.countryCode) locationWasManuallyChangedRef.current = true; setFilters(value); setIsFiltersOpen(false); }} onClose={() => setIsFiltersOpen(false)} onNotify={onNotify} /> : null}
      {activeListTab === 'all' ? <LocationPickerModal
        initialCountryName={filters.countryName || undefined}
        isVisible={isCatalogLocationPickerOpen}
        onClose={() => setIsCatalogLocationPickerOpen(false)}
        onSelect={(location) => {
          locationWasManuallyChangedRef.current = true;
          setFilters((current) => ({
            ...current,
            cityId: location.cityId,
            cityName: location.cityName,
            countryCode: location.countryCode,
            countryName: location.countryName,
            venue: current.venue?.cityId === location.cityId ? current.venue : null,
          }));
        }}
      /> : null}
    </>
  );
}

function buildEventFilterQuery(filters: EventFilters) {
  const query = new URLSearchParams();
  if (filters.cityId) query.set('cityId', filters.cityId);
  else if (filters.countryCode) query.set('countryCode', filters.countryCode);
  if (filters.dateFrom) query.set('dateFrom', filterDateToIso(filters.dateFrom));
  if (filters.dateTo) query.set('dateTo', filterDateToIso(filters.dateTo));
  if (filters.types.length) query.set('types', filters.types.join(','));
  if (filters.venue?.id) query.set('venuePageId', filters.venue.id);
  const value = query.toString();
  return value ? `&${value}` : '';
}

function filterDateToIso(value: string) {
  const [day, month, year] = value.split('.');
  return `${year}-${month}-${day}`;
}

function filterDateValue(value: string) {
  if (!value) return null;
  const [day, month, year] = value.split('.').map(Number);
  return new Date(year, month - 1, day);
}

function activeEventFilterCount(filters: EventFilters) {
  return Number(Boolean(filters.dateFrom || filters.dateTo)) + Number(Boolean(filters.types.length)) + Number(Boolean(filters.venue));
}

function EventFiltersModal({ authToken, category, initialValue, isVisible, onApply, onClose, onNotify }: {
  authToken: string;
  category: EventCategory;
  initialValue: EventFilters;
  isVisible: boolean;
  onApply: (value: EventFilters) => void;
  onClose: () => void;
  onNotify: (message: string, type?: ToastMessage['type']) => void;
}) {
  const [draft, setDraft] = useState<EventFilters>(initialValue);
  const [eventTypes, setEventTypes] = useState<EventTypeOption[]>([]);
  const [dateTarget, setDateTarget] = useState<'from' | 'to' | null>(null);
  const [venueQuery, setVenueQuery] = useState('');
  const [venueOptions, setVenueOptions] = useState<PublicPage[]>([]);
  const [isVenueFocused, setIsVenueFocused] = useState(false);
  const [isVenueLoading, setIsVenueLoading] = useState(false);

  useEffect(() => {
    if (!isVisible) return;
    setDraft(initialValue);
    setVenueQuery(initialValue.venue?.name ?? '');
    setVenueOptions([]);
    void fetch(`${apiUrl}/events/types?category=${encodeURIComponent(category)}`, { headers: { Authorization: `Bearer ${authToken}` } })
      .then(async (response) => response.ok ? response.json() as Promise<EventTypeOption[]> : [])
      .then((types) => {
        setEventTypes(types);
        const allowedTypes = new Set(types.map((type) => type.value));
        setDraft((current) => ({ ...current, types: current.types.filter((value) => allowedTypes.has(value)) }));
      })
      .catch(() => setEventTypes([]));
  }, [authToken, category, initialValue, isVisible]);

  useEffect(() => {
    if (!isVisible || !isVenueFocused || draft.venue) return;
    const query = venueQuery.trim();
    if (query.length < 3) {
      setVenueOptions([]);
      setIsVenueLoading(false);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setIsVenueLoading(true);
      try {
        const response = await fetch(`${apiUrl}/public-pages?pageSize=12&locationOnly=true${draft.cityId ? `&cityId=${encodeURIComponent(draft.cityId)}` : ''}${query ? `&q=${encodeURIComponent(query)}` : ''}`, { signal: controller.signal });
        if (!response.ok) throw new Error('Не удалось найти локации');
        const result = await response.json() as CursorPage<PublicPage>;
        setVenueOptions(result.items);
      } catch (error) {
        if (!(error instanceof Error && error.name === 'AbortError')) setVenueOptions([]);
      } finally {
        if (!controller.signal.aborted) setIsVenueLoading(false);
      }
    }, query ? remoteSearchDebounceMs : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [draft.cityId, draft.venue, isVenueFocused, isVisible, venueQuery]);

  const selectedFrom = filterDateValue(draft.dateFrom);
  const apply = () => {
    const from = filterDateValue(draft.dateFrom);
    const to = filterDateValue(draft.dateTo);
    if (from && to && from > to) { onNotify('Дата «от» не может быть позже даты «до»', 'error'); return; }
    const allowedTypes = new Set(eventTypes.map((type) => type.value));
    onApply({ ...draft, types: draft.types.filter((value) => allowedTypes.has(value)) });
  };

  return <>
    <AppSheetModal
      footer={<View style={styles.eventFilterActions}><Pressable onPress={() => { setDraft((current) => ({ ...emptyEventFilters, cityId: current.cityId, cityName: current.cityName, countryCode: current.countryCode, countryName: current.countryName })); setVenueQuery(''); }} style={styles.eventFilterReset}><Text style={styles.eventFilterResetText}>Сбросить</Text></Pressable><Pressable onPress={apply} style={styles.eventFilterApply}><Text style={styles.eventFilterApplyText}>Показать</Text></Pressable></View>}
      footerContainerStyle={styles.eventFilterFooter}
      isVisible={isVisible}
      onClose={onClose}
      scroll
      title="Фильтры событий"
    >
            <Text style={[styles.connectFilterTitle, styles.eventFilterFirstTitle]}>Даты</Text>
            <View style={styles.eventFilterDates}><Pressable onPress={() => setDateTarget('from')} style={styles.eventFilterDateButton}><CalendarDays color="#6f7b86" size={18} /><Text style={[styles.eventFilterDateText, !draft.dateFrom && styles.editSelectPlaceholder]}>{draft.dateFrom || 'От'}</Text></Pressable><Pressable onPress={() => setDateTarget('to')} style={styles.eventFilterDateButton}><CalendarDays color="#6f7b86" size={18} /><Text style={[styles.eventFilterDateText, !draft.dateTo && styles.editSelectPlaceholder]}>{draft.dateTo || 'До'}</Text></Pressable></View>

            <Text style={styles.connectFilterTitle}>Типы событий</Text>
            <View style={styles.eventFilterChips}>{eventTypes.map((type) => { const selected = draft.types.includes(type.value); return <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: selected }} key={type.value} onPress={() => setDraft((current) => ({ ...current, types: selected ? current.types.filter((value) => value !== type.value) : [...current.types, type.value] }))} style={[styles.eventFilterChip, selected && styles.eventFilterChipActive]}><Text style={[styles.eventFilterChipText, selected && styles.eventFilterChipTextActive]}>{type.label}</Text></Pressable>; })}</View>

            <Text style={styles.connectFilterTitle}>Локация</Text>
            <View style={styles.eventFilterVenueInput}><Search color="#6f7b86" size={19} /><TextInput autoCorrect={false} onChangeText={(value) => { setVenueQuery(value); setDraft((current) => ({ ...current, venue: null })); }} onFocus={() => setIsVenueFocused(true)} placeholder={draft.cityName ? `Найти локацию в городе ${draft.cityName}` : 'Найти локацию'} placeholderTextColor="#8e99a4" style={styles.eventFilterVenueText} value={venueQuery} />{venueQuery ? <Pressable accessibilityLabel="Очистить локацию" hitSlop={8} onPress={() => { setVenueQuery(''); setDraft((current) => ({ ...current, venue: null })); }}><X color="#6f7b86" size={20} /></Pressable> : null}</View>
            {isVenueLoading ? <ActivityIndicator color="#111" style={{ marginVertical: 12 }} /> : null}
            {isVenueFocused && venueQuery.trim().length >= 3 && !draft.venue && venueOptions.length ? <View style={styles.eventFilterVenueOptions}>{venueOptions.map((venue) => <Pressable key={venue.id} onPress={() => { setDraft((current) => ({ ...current, venue, cityId: venue.cityId ?? '', cityName: venue.cityName, countryName: venue.countryName })); setVenueQuery(venue.name); setIsVenueFocused(false); }} style={styles.eventFilterVenueOption}><Text style={styles.eventFilterVenueName}>{venue.name}</Text><Text style={styles.eventFilterVenueMeta}>{[venue.cityName, venue.address].filter(Boolean).join(' · ')}</Text></Pressable>)}</View> : null}
    </AppSheetModal>
    <CalendarPickerModal isVisible={dateTarget !== null} minDate={dateTarget === 'to' && selectedFrom ? selectedFrom : new Date(1970, 0, 1)} onClose={() => setDateTarget(null)} onSelect={(value) => { setDraft((current) => ({ ...current, [dateTarget === 'to' ? 'dateTo' : 'dateFrom']: value })); setDateTarget(null); }} selectedValue={dateTarget === 'to' ? draft.dateTo : draft.dateFrom} title={dateTarget === 'to' ? 'Дата до' : 'Дата от'} />
  </>;
}

export function EventCard({
  compactList = false,
  event,
  flushHorizontal = false,
  onOpen,
  onOpenPublicPage,
  onSetParticipation,
  showActions = true,
}: {
  compactList?: boolean;
  event: ProfileEvent;
  flushHorizontal?: boolean;
  onOpen?: () => void;
  onOpenPublicPage?: (username: string) => Promise<void>;
  onSetParticipation: (status: EventParticipationStatus) => void;
  showActions?: boolean;
}) {
  const isGoing = event.myParticipationStatus === 'GOING';
  const isWatching = event.myParticipationStatus === 'WATCHING';
  const isPast = new Date(event.endsAt).getTime() < Date.now();

  return (
    <View style={[styles.eventCard, flushHorizontal && styles.eventCardFlushHorizontal, compactList && styles.eventCardCompactList]}>
      <Pressable accessibilityRole="button" onPress={onOpen} style={styles.eventCardMain}>
        <EventPoster posterUrl={event.posterUrl} style={styles.eventCardPoster} />
        <View style={styles.eventCardCopy}>
          <Text style={styles.eventDate}>{formatEventDateRangeLabel(event.startsAt, event.endsAt)}</Text>
          <Text
            accessibilityLabel={`Открыть событие ${event.title}`}
            accessibilityRole="link"
            onPress={onOpen}
            style={styles.eventTitle}
          >
            {event.title}
          </Text>
          <Text style={styles.eventDetailType}>{event.typeLabel}</Text>
          <View style={styles.eventDetailLocationRow}>
            <Text ellipsizeMode="clip" numberOfLines={1} style={styles.eventDetailLocationText}>{[event.countryName, event.cityName].filter(Boolean).join(', ')}</Text>
          </View>
          {event.venuePageId && event.venueName ? <View style={styles.eventDetailAddressRow}>
            <Pressable
              accessibilityLabel={`Открыть локацию ${event.venueName}`}
              accessibilityRole="link"
              disabled={!event.venueUsername || !onOpenPublicPage}
              onPress={(pressEvent) => {
                pressEvent.stopPropagation();
                if (event.venueUsername) void onOpenPublicPage?.(event.venueUsername);
              }}
            ><Text ellipsizeMode="clip" numberOfLines={1} style={styles.eventDetailLocationLink}>{event.venueName}</Text></Pressable>
          </View> : null}
          {!event.venuePageId && formatEventVenueAddress(event.venueAddress, event.countryName, event.cityName) ? <View style={styles.eventDetailAddressRow}>
            <Text ellipsizeMode="clip" numberOfLines={1} style={styles.eventDetailAddressText}>{formatEventVenueAddress(event.venueAddress, event.countryName, event.cityName)}</Text>
            {event.venueUsername ? <Pressable
              disabled={!onOpenPublicPage}
              onPress={(pressEvent) => {
                pressEvent.stopPropagation();
                void onOpenPublicPage?.(event.venueUsername!);
              }}
            ><Text style={styles.eventDetailLocationLink}>(@{event.venueUsername})</Text></Pressable> : null}
          </View> : null}
          <EventCounters goingCount={event.goingCount} watchingCount={event.watchingCount} />
          {showActions ? <View style={styles.eventActionsRow}>
            <Pressable accessibilityState={{ disabled: isPast, selected: isGoing }} disabled={isPast} onPress={(pressEvent) => { pressEvent.stopPropagation(); onSetParticipation('GOING'); }} style={[styles.eventGoingButton, isGoing && styles.eventActionButtonActive, isPast && styles.eventParticipationDisabled]}>
              <Text style={[styles.eventGoingText, isGoing && styles.eventActionTextActive, isPast && styles.eventParticipationDisabledText]}>{isGoing ? 'Иду' : 'Пойду!'}</Text>
            </Pressable>
            <Pressable accessibilityLabel={isWatching ? 'Не отслеживать событие' : 'Отслеживать событие'} accessibilityRole="button" accessibilityState={{ disabled: isPast, selected: isWatching }} disabled={isPast} onPress={(pressEvent) => { pressEvent.stopPropagation(); onSetParticipation('WATCHING'); }} style={[styles.eventWatchIconButton, isWatching && styles.eventWatchIconButtonActive, isPast && styles.eventParticipationDisabled]}>
              {isWatching ? <BellOff color="#111" size={20} strokeWidth={1.9} /> : <Bell color={isPast ? '#111' : '#fff'} size={20} strokeWidth={1.9} />}
            </Pressable>
          </View> : null}
        </View>
      </Pressable>
    </View>
  );
}

type EventContentTab = 'feed' | 'schedule' | 'partners';

export function EventDetailScreen({ adminMode = false, authToken, canManageOverride, event, isGlobalAdmin = false, onBack, onDeleted, onNotify, onOpenMenu, onOpenMessages, onOpenNotifications, onOpenProfile, onOpenPublicPage, onToggleParticipation, onUpdate, ownAccountId }: {
  adminMode?: boolean;
  authToken: string;
  canManageOverride?: boolean;
  event: EventSummary;
  isGlobalAdmin?: boolean;
  onBack: () => void;
  onDeleted?: (eventId: string) => void;
  onNotify: (message: string, type?: ToastMessage['type']) => void;
  onOpenMenu: () => void;
  onOpenMessages: () => void;
  onOpenNotifications: () => void;
  onOpenProfile: (username: string) => Promise<void>;
  onOpenPublicPage: (username: string) => Promise<void>;
  onToggleParticipation: (eventId: string, status: EventParticipationStatus | null) => Promise<EventSummary>;
  onUpdate: (event: EventSummary) => void;
  ownAccountId?: string;
}) {
  const [activeTab, setActiveTab] = useState<EventContentTab>('feed');
  const [selectedScheduleDayKey, setSelectedScheduleDayKey] = useState<string | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [partnerValue, setPartnerValue] = useState('');
  const [isScheduleEditorOpen, setIsScheduleEditorOpen] = useState(false);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [horizontalScheduleScrollRequest, setHorizontalScheduleScrollRequest] = useState<{ key: string; x: number } | null>(null);
  const eventDetailScrollRef = useRef<ScrollView>(null);
  const scheduleDayTabsRef = useRef<ScrollView>(null);
  const scheduleTableTopRef = useRef(0);
  const scheduleDayNavigationHeightRef = useRef(52);
  const pendingScheduleDaySelectionRef = useRef<{ expiresAt: number; key: string } | null>(null);
  const managementHeaders = { Authorization: `Bearer ${authToken}`, ...(isGlobalAdmin && adminMode ? { 'x-volna-admin-mode': '1' } : {}) };
  const isPast = new Date(event.endsAt).getTime() < Date.now();
  const safeTicketUrl = normalizeExternalHttpsUrl(event.ticketUrl);
  const scheduleGroups = useMemo(() => groupEventLineupByDay(event.lineup), [event.lineup]);
  const scheduleTimeline = useMemo(() => buildScheduleTimeline(event.lineup, event.scheduleStages), [event.lineup, event.scheduleStages]);
  const scheduleNavigationDays = useMemo(() => buildScheduleDayNavigation(scheduleGroups, scheduleTimeline), [scheduleGroups, scheduleTimeline]);
  const usesHorizontalTimeAxis = scheduleTimeline.stages.length > 2;
  const scheduleVerticalHeaderHeight = scheduleTimeline.hasTimes || scheduleTimeline.hasStageLabels ? scheduleHeaderHeight : 0;
  const tabs = useMemo<Array<{ value: EventContentTab; label: string; Icon: typeof List }>>(() => [
    ...(canManage || event.postsCount > 0 ? [{ value: 'feed' as const, label: 'Публикации', Icon: List }] : []),
    ...(canManage || event.lineup.length > 0 ? [{ value: 'schedule' as const, label: 'Таймтейбл', Icon: CalendarClock }] : []),
    ...(canManage || event.partners.length > 0 ? [{ value: 'partners' as const, label: 'Партнёры', Icon: Handshake }] : []),
  ], [canManage, event.lineup.length, event.partners.length, event.postsCount]);
  const visibleActiveTab = tabs.some((tab) => tab.value === activeTab)
    ? activeTab
    : tabs[0]?.value ?? null;
  const activeScheduleDayKey = scheduleNavigationDays.some((day) => day.key === selectedScheduleDayKey)
    ? selectedScheduleDayKey
    : scheduleNavigationDays[0]?.key ?? null;

  useEffect(() => {
    setSelectedScheduleDayKey(null);
    setHorizontalScheduleScrollRequest(null);
    pendingScheduleDaySelectionRef.current = null;
  }, [event.id]);

  useEffect(() => {
    if (visibleActiveTab && visibleActiveTab !== activeTab) setActiveTab(visibleActiveTab);
  }, [activeTab, visibleActiveTab]);

  useEffect(() => {
    const activeIndex = scheduleNavigationDays.findIndex((day) => day.key === activeScheduleDayKey);
    if (activeIndex < 0) return;
    scheduleDayTabsRef.current?.scrollTo({ animated: true, x: Math.max(0, activeIndex * 104 - 20) });
  }, [activeScheduleDayKey, scheduleNavigationDays]);

  const scrollToScheduleDay = useCallback((day: ReturnType<typeof buildScheduleDayNavigation>[number]) => {
    pendingScheduleDaySelectionRef.current = {
      expiresAt: Date.now() + scheduleProgrammaticNavigationLockMs,
      key: day.key,
    };
    setSelectedScheduleDayKey(day.key);
    if (usesHorizontalTimeAxis) {
      setHorizontalScheduleScrollRequest({ key: day.key, x: Math.max(0, day.left - scheduleHorizontalDayScrollClearance) });
      eventDetailScrollRef.current?.scrollTo({
        animated: true,
        y: Math.max(0, scheduleTableTopRef.current - scheduleDayNavigationHeightRef.current),
      });
      return;
    }
    const targetY = Math.max(
      0,
      scheduleTableTopRef.current
        + scheduleVerticalHeaderHeight
        + day.top
        - scheduleDayNavigationHeightRef.current
        - scheduleDayScrollClearance,
    );
    eventDetailScrollRef.current?.scrollTo({ animated: true, y: targetY });
  }, [scheduleVerticalHeaderHeight, usesHorizontalTimeAxis]);

  const applyScheduleDayFromScroll = useCallback((dayKey: string) => {
    const pendingSelection = pendingScheduleDaySelectionRef.current;
    if (pendingSelection) {
      if (pendingSelection.key !== dayKey && pendingSelection.expiresAt > Date.now()) return;
      pendingScheduleDaySelectionRef.current = null;
    }
    setSelectedScheduleDayKey((current) => current === dayKey ? current : dayKey);
  }, []);

  const releaseProgrammaticScheduleNavigation = useCallback(() => {
    pendingScheduleDaySelectionRef.current = null;
  }, []);

  const handleEventDetailScroll = useCallback((scrollEvent: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (visibleActiveTab !== 'schedule' || usesHorizontalTimeAxis || !scheduleNavigationDays.length) return;
    const { contentOffset, contentSize, layoutMeasurement } = scrollEvent.nativeEvent;
    const maxOffsetY = Math.max(0, contentSize.height - layoutMeasurement.height);
    const isAtEnd = maxOffsetY > scheduleScrollEndTolerance
      && contentOffset.y >= maxOffsetY - scheduleScrollEndTolerance;
    const timelinePosition = contentOffset.y
      + scheduleDayNavigationHeightRef.current
      - scheduleTableTopRef.current
      - scheduleVerticalHeaderHeight
      + 1;
    const currentDay = isAtEnd
      ? scheduleNavigationDays[scheduleNavigationDays.length - 1]
      : resolveScheduleDayAtOffset(scheduleNavigationDays, timelinePosition, 'top', scheduleDayScrollClearance);
    applyScheduleDayFromScroll(currentDay.key);
  }, [applyScheduleDayFromScroll, scheduleNavigationDays, scheduleVerticalHeaderHeight, usesHorizontalTimeAxis, visibleActiveTab]);

  const handleHorizontalScheduleScroll = useCallback(({ maxOffsetX, offsetX }: { maxOffsetX: number; offsetX: number }) => {
    if (!usesHorizontalTimeAxis || !scheduleNavigationDays.length) return;
    const isAtEnd = maxOffsetX > scheduleScrollEndTolerance
      && offsetX >= maxOffsetX - scheduleScrollEndTolerance;
    const currentDay = isAtEnd
      ? scheduleNavigationDays[scheduleNavigationDays.length - 1]
      : resolveScheduleDayAtOffset(scheduleNavigationDays, offsetX, 'left', scheduleHorizontalDaySelectionClearance);
    applyScheduleDayFromScroll(currentDay.key);
  }, [applyScheduleDayFromScroll, scheduleNavigationDays, usesHorizontalTimeAxis]);

  const refresh = useCallback(async () => {
    const response = await fetch(`${apiUrl}/events/${event.id}`, { cache: 'no-store', headers: { Authorization: `Bearer ${authToken}` } });
    if (!response.ok) throw new Error(await readApiError(response, 'Не удалось обновить событие'));
    onUpdate(await response.json() as EventSummary);
  }, [authToken, event.id, onUpdate]);

  useEffect(() => {
    if (canManageOverride !== undefined) {
      setCanManage(canManageOverride);
      return;
    }
    void fetch(`${apiUrl}/public-pages/${event.organizerPage.username}`, { headers: { Authorization: `Bearer ${authToken}` } })
      .then(async (response) => response.ok ? response.json() as Promise<PublicPageDetail> : null)
      .then((page) => setCanManage(Boolean(page && (
        page.ownerId === ownAccountId
        || (!isGlobalAdmin && page.myPermissions.includes('EVENTS_MANAGE'))
        || (isGlobalAdmin && adminMode)
      ))))
      .catch(() => setCanManage(false));
  }, [adminMode, authToken, canManageOverride, event.organizerPage.username, isGlobalAdmin, ownAccountId]);

  const setParticipation = async (status: EventParticipationStatus) => {
    const updated = await onToggleParticipation(event.id, event.myParticipationStatus === status ? null : status);
    onUpdate(updated);
  };

  const addPartner = async () => {
    const value = partnerValue.trim();
    if (!value) return onNotify('Укажите название партнёра', 'error');
    const response = await fetch(`${apiUrl}/events/${event.id}/partners`, { method: 'POST', headers: { ...managementHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ value }) });
    if (!response.ok) throw new Error(await readApiError(response, 'Не удалось добавить партнёра'));
    setPartnerValue('');
    await refresh();
  };

  const removePartner = async (partnerId: string) => {
    const response = await fetch(`${apiUrl}/events/${event.id}/partners/${encodeURIComponent(partnerId)}`, { method: 'DELETE', headers: managementHeaders });
    if (!response.ok) throw new Error(await readApiError(response, 'Не удалось убрать партнёра'));
    await refresh();
  };

  const updateEvent = async (input: CreateEventInput) => {
    const { posterLocalUri, posterThumbnailLocalUri, organizerPageId: _organizerPageId, hasTimetable, scheduleStages, lineup, ...details } = input;
    const response = await fetch(`${apiUrl}/events/${event.id}`, {
      method: 'PATCH',
      headers: { ...managementHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify(details),
    });
    if (!response.ok) throw new Error(await readApiError(response, 'Не удалось сохранить событие'));

    const lineupResponse = await fetch(`${apiUrl}/events/${event.id}/lineup`, {
      method: 'PATCH',
      headers: { ...managementHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ hasTimetable, scheduleStages, lineup }),
    });
    if (!lineupResponse.ok) throw new Error(await readApiError(lineupResponse, 'Не удалось сохранить участников'));

    if (posterLocalUri && posterLocalUri !== event.posterUrl && posterLocalUri !== event.posterOriginalUrl) {
      await uploadEventPosterAsset(posterLocalUri, authToken, event.id, posterThumbnailLocalUri);
    }
    await refresh();
    setIsEditing(false);
    onNotify('Событие сохранено');
  };

  const deleteEvent = async () => {
    const response = await fetch(`${apiUrl}/events/${event.id}`, {
      method: 'DELETE',
      headers: managementHeaders,
    });
    if (!response.ok) throw new Error(await readApiError(response, 'Не удалось удалить событие'));
    setIsEditing(false);
    onNotify('Событие удалено');
    if (onDeleted) onDeleted(event.id);
    else onBack();
  };

  if (isEditing) return <CreateEventScreen adminMode={isGlobalAdmin && adminMode} authToken={authToken} initialEvent={event} onBack={() => setIsEditing(false)} onCreate={updateEvent} onDelete={deleteEvent} onNotify={onNotify} ownAccountId="" />;

  return <View style={styles.eventDetailShell}>
    <ScreenTopBar canGoBack onBack={onBack} onOpenMenu={onOpenMenu} onOpenMessages={onOpenMessages} onOpenNotifications={onOpenNotifications} title="Событие" />
    <ScrollView
      contentContainerStyle={styles.eventDetailContent}
      onScroll={handleEventDetailScroll}
      onScrollBeginDrag={releaseProgrammaticScheduleNavigation}
      ref={eventDetailScrollRef}
      scrollEventThrottle={32}
      showsVerticalScrollIndicator={false}
      stickyHeaderIndices={visibleActiveTab === 'schedule' && scheduleNavigationDays.length ? [3] : undefined}
    >
      <View>
        <View style={styles.eventDetailHero}>
          <Pressable accessibilityLabel="Увеличить афишу" accessibilityRole="imagebutton" disabled={!event.posterUrl} onPress={() => setPreviewImageUrl(event.posterOriginalUrl ?? event.posterUrl)}>
            <EventPoster posterUrl={event.posterUrl} style={styles.eventDetailPoster} />
          </Pressable>
          <View style={styles.eventDetailHeroCopy}>
            <Text style={styles.eventDate}>{formatEventDateRangeLabel(event.startsAt, event.endsAt)}</Text>
            <Text style={styles.eventDetailTitle}>{event.title}</Text>
            <Pressable onPress={() => void onOpenPublicPage(event.organizerPage.username)}><Text style={styles.eventDetailOrganizer}>{event.organizerPage.name} · @{event.organizerPage.username}</Text></Pressable>
            <Text style={styles.eventDetailType}>{event.typeLabel}</Text>
            <View style={styles.eventDetailLocationRow}>
              <Text ellipsizeMode="clip" numberOfLines={1} style={styles.eventDetailLocationText}>{[event.countryName, event.cityName].filter(Boolean).join(', ')}</Text>
            </View>
            {event.venuePageId && event.venueName ? <View style={styles.eventDetailAddressRow}>
              <Pressable
                accessibilityLabel={`Открыть локацию ${event.venueName}`}
                accessibilityRole="link"
                disabled={!event.venueUsername}
                onPress={() => event.venueUsername ? void onOpenPublicPage(event.venueUsername) : undefined}
              ><Text ellipsizeMode="clip" numberOfLines={1} style={styles.eventDetailLocationLink}>{event.venueName}</Text></Pressable>
            </View> : null}
            {!event.venuePageId && formatEventVenueAddress(event.venueAddress, event.countryName, event.cityName) ? <View style={styles.eventDetailAddressRow}>
              <Text ellipsizeMode="clip" numberOfLines={1} style={styles.eventDetailAddressText}>{formatEventVenueAddress(event.venueAddress, event.countryName, event.cityName)}</Text>
              {event.venueUsername ? <Pressable onPress={() => void onOpenPublicPage(event.venueUsername!)}><Text style={styles.eventDetailLocationLink}>(@{event.venueUsername})</Text></Pressable> : null}
            </View> : null}
            <EventCounters goingCount={event.goingCount} watchingCount={event.watchingCount} />
          </View>
        </View>
        {event.about ? <Text style={styles.eventDetailAbout}>{event.about}</Text> : null}
        {safeTicketUrl ? (
          <View style={styles.eventTicketDetails}>
            <Pressable
              accessibilityLabel={event.admissionPrice?.trim() ? `Купить билет от ${event.admissionPrice.trim()}` : 'Купить билет'}
              accessibilityRole="link"
              onPress={() => void openExternalHttpsUrl(safeTicketUrl).catch(() => onNotify('Не удалось открыть ссылку на билеты', 'error'))}
              style={styles.eventTicketLink}
            >
              <Text numberOfLines={1} style={styles.eventTicketLinkText}>{event.admissionPrice?.trim() ? `Купить билет от ${event.admissionPrice.trim()}` : 'Купить билет'}</Text>
            </Pressable>
          </View>
        ) : null}
        <View style={[styles.eventActionsRow, styles.eventDetailActionsRow]}>
          <Pressable accessibilityState={{ disabled: isPast, selected: event.myParticipationStatus === 'GOING' }} disabled={isPast} onPress={() => void setParticipation('GOING').catch((error) => onNotify(error.message, 'error'))} style={[styles.eventGoingButton, styles.eventDetailPrimaryAction, event.myParticipationStatus === 'GOING' && styles.eventActionButtonActive, isPast && styles.eventParticipationDisabled]}><Text style={[styles.eventGoingText, event.myParticipationStatus === 'GOING' && styles.eventActionTextActive, isPast && styles.eventParticipationDisabledText]}>{event.myParticipationStatus === 'GOING' ? 'Иду' : 'Пойду!'}</Text></Pressable>
          <Pressable accessibilityLabel={event.myParticipationStatus === 'WATCHING' ? 'Не отслеживать событие' : 'Отслеживать событие'} accessibilityRole="button" accessibilityState={{ disabled: isPast, selected: event.myParticipationStatus === 'WATCHING' }} disabled={isPast} onPress={() => void setParticipation('WATCHING').catch((error) => onNotify(error.message, 'error'))} style={[styles.eventWatchIconButton, event.myParticipationStatus === 'WATCHING' && styles.eventWatchIconButtonActive, isPast && styles.eventParticipationDisabled]}>{event.myParticipationStatus === 'WATCHING' ? <BellOff color="#111" size={20} strokeWidth={1.9} /> : <Bell color={isPast ? '#111' : '#fff'} size={20} strokeWidth={1.9} />}</Pressable>
          <Pressable accessibilityLabel="Поделиться событием" accessibilityRole="button" onPress={() => setIsShareOpen(true)} style={styles.eventDetailRoundAction}><Share2 color="#111" size={21} strokeWidth={1.8} /></Pressable>
          <Pressable accessibilityLabel="Ещё" accessibilityRole="button" onPress={() => setIsMoreOpen(true)} style={styles.eventDetailRoundAction}><EllipsisVertical color="#111" size={22} strokeWidth={1.9} /></Pressable>
        </View>
        {canManage ? <Pressable accessibilityRole="button" onPress={() => setIsEditing(true)} style={styles.eventEditButton}><Pencil color="#111" size={19} strokeWidth={1.8} /><Text style={styles.eventEditButtonText}>Редактировать</Text></Pressable> : null}
        {tabs.length ? <View style={styles.eventTabs}>{tabs.map(({ value, label, Icon }) => <Pressable key={value} accessibilityLabel={label} accessibilityRole="tab" accessibilityState={{ selected: visibleActiveTab === value }} onPress={() => setActiveTab(value)} style={[styles.eventTab, visibleActiveTab === value && styles.eventTabActive]}><Icon color={visibleActiveTab === value ? '#111' : '#7d8894'} size={23} strokeWidth={1.8} /></Pressable>)}</View> : null}
      </View>
      {visibleActiveTab === 'feed' ? <PostFeed authToken={authToken} authorType="community" canCreate={canManage} composerAuthor={{ avatarUrl: event.posterUrl, name: event.organizerPage.name, username: event.organizerPage.username }} CropModal={AvatarCropModal} eventId={event.id} onNotify={onNotify} onOpenProfile={onOpenProfile} onOpenPublicPage={onOpenPublicPage} username={event.organizerPage.username} /> : null}
      {visibleActiveTab === 'schedule' ? <View style={styles.eventScheduleHeadingSection}>
        <View style={styles.eventTabHeadingRow}><Text style={[styles.eventTabHeading, styles.eventTabHeadingInRow]}>Таймтейбл</Text>{canManage ? <Pressable onPress={() => setIsScheduleEditorOpen(true)}><Text style={styles.eventManageLink}>Редактировать</Text></Pressable> : null}</View>
      </View> : null}
      {visibleActiveTab === 'schedule' ? <View
        onLayout={(layoutEvent: LayoutChangeEvent) => {
          scheduleDayNavigationHeightRef.current = layoutEvent.nativeEvent.layout.height;
        }}
        style={[styles.eventScheduleStickyDayNavigation, !scheduleNavigationDays.length && styles.eventScheduleDayNavigationHidden]}
        testID="event-schedule-day-navigation"
      >
        <ScrollView bounces={false} contentContainerStyle={styles.eventScheduleDayTabs} horizontal ref={scheduleDayTabsRef} showsHorizontalScrollIndicator={false}>
          {scheduleNavigationDays.map((day) => {
            const selected = activeScheduleDayKey === day.key;
            return <Pressable
              accessibilityLabel={`Перейти к расписанию: ${day.label}`}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              key={day.key}
              onPress={() => scrollToScheduleDay(day)}
              style={[styles.eventScheduleDayTab, selected && styles.eventScheduleDayTabActive]}
            >
              <Text style={[styles.eventScheduleDayTabText, selected && styles.eventScheduleDayTabTextActive]}>{day.shortLabel}</Text>
            </Pressable>;
          })}
        </ScrollView>
      </View> : null}
      {visibleActiveTab === 'schedule' ? <View
        onLayout={(layoutEvent: LayoutChangeEvent) => {
          scheduleTableTopRef.current = layoutEvent.nativeEvent.layout.y;
        }}
        style={styles.eventScheduleTableSection}
        testID="event-schedule-table-section"
      >
        {scheduleTimeline.stages.length ? <EventScheduleTable
          horizontalScrollRequest={horizontalScheduleScrollRequest}
          onHorizontalInteractionStart={releaseProgrammaticScheduleNavigation}
          onHorizontalOffsetChange={handleHorizontalScheduleScroll}
          onOpenProfile={onOpenProfile}
          timeline={scheduleTimeline}
        /> : <Text style={styles.eventEmptyText}>Участники и расписание пока не указаны</Text>}
      </View> : null}
      {visibleActiveTab === 'partners' ? <View style={styles.eventTabContent}><Text style={styles.eventTabHeading}>Партнёры</Text>{canManage ? <View style={styles.eventPartnerEditor}><TextInput autoCapitalize="words" autoCorrect={false} maxLength={80} onChangeText={setPartnerValue} placeholder="@username или название партнёра" placeholderTextColor="#8e99a4" style={styles.eventPartnerInput} value={partnerValue} /><Pressable accessibilityLabel="Добавить партнёра" onPress={() => void addPartner().catch((error) => onNotify(error.message, 'error'))} style={styles.eventPartnerAdd}><Plus color="#fff" size={20} /></Pressable></View> : null}{event.partners.map((partner) => <View key={partner.id} style={styles.eventPartnerRow}><Pressable disabled={!partner.username} onPress={() => partner.username ? void onOpenPublicPage(partner.username) : undefined} style={styles.eventPartnerMain}>{partner.avatarUrl ? <Image source={{ uri: partner.avatarUrl }} style={styles.eventPartnerAvatar} /> : <View style={styles.eventPartnerAvatar}><Text>{partner.name.slice(0, 1)}</Text></View>}<View><Text style={styles.eventScheduleName}>{partner.name}</Text>{partner.username ? <Text style={styles.eventScheduleUsername}>@{partner.username}</Text> : null}{partner.typeLabel || partner.cityName ? <Text style={styles.eventScheduleInfo}>{[partner.typeLabel, partner.cityName].filter(Boolean).join(' · ')}</Text> : null}</View></Pressable>{canManage ? <Pressable accessibilityLabel="Убрать партнёра" onPress={() => void removePartner(partner.id).catch((error) => onNotify(error.message, 'error'))} style={styles.eventPartnerRemove}><X color="#6f7b86" size={20} /></Pressable> : null}</View>)}{!event.partners.length ? <Text style={styles.eventEmptyText}>Партнёры пока не добавлены</Text> : null}</View> : null}
    </ScrollView>
    <EntityShareModal authToken={authToken} chatEventId={event.id} chatSnapshot={{ organizerName: event.organizerPage.name, posterUrl: event.posterUrl, startsAt: event.startsAt, title: event.title }} isVisible={isShareOpen} onClose={() => setIsShareOpen(false)} onNotify={onNotify} repost={{ previewTitle: event.title, previewMeta: `${event.typeLabel} · ${[event.cityName, event.venueName].filter(Boolean).join(', ')}` }} shareText={`${event.title} — ${event.typeLabel}. ${[event.cityName, event.venueName].filter(Boolean).join(', ')}\n${formatEventPublicUrl(event.id)}`} shareTitle={event.title} shareUrl={formatEventPublicUrl(event.id)} subjectLabel="Событие" />
    <EventMoreModal authToken={authToken} event={event} isVisible={isMoreOpen} onClose={() => setIsMoreOpen(false)} onNotify={onNotify} />
    <EventScheduleEditor adminMode={isGlobalAdmin && adminMode} authToken={authToken} event={event} isVisible={isScheduleEditorOpen} onClose={() => setIsScheduleEditorOpen(false)} onNotify={onNotify} onSaved={refresh} />
    <EventImagePreviewModal imageUrl={previewImageUrl} onClose={() => setPreviewImageUrl(null)} />
  </View>;
}

const scheduleTimeColumnWidth = 56;
const scheduleHeaderHeight = 52;
const schedulePixelsPerMinute = 1.4;
const scheduleFallbackDurationMinutes = 60;
const scheduleTimelineTopInset = 12;
const scheduleTimelineBottomInset = 8;
const scheduleDayScrollClearance = 12;
const scheduleHorizontalStageColumnWidth = 88;
const scheduleHorizontalStageRowHeight = 68;
const scheduleHorizontalPixelsPerMinute = 2.2;
const scheduleHorizontalTimeInset = 28;
const scheduleHorizontalUnscheduledSlotWidth = 104;
const scheduleHorizontalDayScrollClearance = 30;
// Date links leave a small preview of the preceding timeline before 00:00.
// Include that complete preview in the next day's activation range.
const scheduleHorizontalDaySelectionClearance = scheduleHorizontalDayScrollClearance + 4;
const scheduleProgrammaticNavigationLockMs = 1_200;
const scheduleScrollEndTolerance = 2;

function EventScheduleTable({ horizontalScrollRequest, onHorizontalInteractionStart, onHorizontalOffsetChange, onOpenProfile, timeline }: {
  horizontalScrollRequest: { key: string; x: number } | null;
  onHorizontalInteractionStart: () => void;
  onHorizontalOffsetChange: (position: { maxOffsetX: number; offsetX: number }) => void;
  onOpenProfile: (username: string) => Promise<void>;
  timeline: ReturnType<typeof buildScheduleTimeline>;
}) {
  const { width: windowWidth } = useWindowDimensions();
  const [measuredFrameWidth, setMeasuredFrameWidth] = useState(0);
  const nativeHorizontalScrollRef = useRef<ScrollView>(null);
  const webHorizontalScrollRef = useRef<HTMLDivElement | null>(null);
  const usesHorizontalTimeAxis = timeline.stages.length > 2;
  const horizontalMetrics = buildHorizontalScheduleMetrics(timeline);
  const compactFrameWidth = measuredFrameWidth || Math.max(280, windowWidth - 40);
  const compactTimeColumnWidth = timeline.hasTimes ? scheduleTimeColumnWidth : 0;
  const compactStageWidth = Math.max(1, (compactFrameWidth - compactTimeColumnWidth - 2) / Math.max(timeline.stages.length, 1));

  useEffect(() => {
    if (!usesHorizontalTimeAxis || !horizontalScrollRequest) return;
    if (Platform.OS === 'web') {
      webHorizontalScrollRef.current?.scrollTo({ behavior: 'smooth', left: horizontalScrollRequest.x });
      return;
    }
    nativeHorizontalScrollRef.current?.scrollTo({ animated: true, x: horizontalScrollRequest.x });
  }, [horizontalScrollRequest, usesHorizontalTimeAxis]);

  if (!timeline.stages.length) return null;

  if (Platform.OS === 'web') {
    return usesHorizontalTimeAxis
      ? renderWebHorizontalScheduleTable(timeline, horizontalMetrics, onOpenProfile, onHorizontalInteractionStart, onHorizontalOffsetChange, webHorizontalScrollRef)
      : renderWebVerticalScheduleTable(timeline, onOpenProfile);
  }

  if (usesHorizontalTimeAxis) {
    return <View style={styles.eventScheduleTableFrame}>
      <View style={styles.eventScheduleHorizontalLayout}>
        <View style={styles.eventScheduleHorizontalStageAxis}>
          {timeline.hasTimes ? <View style={[styles.eventScheduleHorizontalCorner, { height: scheduleHeaderHeight }]}>
            <Text style={styles.eventScheduleTimelineCornerText}>Сцена</Text>
          </View> : null}
          {timeline.stages.map((stage) => <View key={stage} style={[styles.eventScheduleHorizontalStageLabel, { height: scheduleHorizontalStageRowHeight }]}>
            <Text numberOfLines={2} style={styles.eventScheduleHorizontalStageLabelText}>{stage}</Text>
          </View>)}
        </View>
        <ScrollView
          bounces={false}
          horizontal
          nestedScrollEnabled
          onScroll={(scrollEvent) => {
            const { contentOffset, contentSize, layoutMeasurement } = scrollEvent.nativeEvent;
            onHorizontalOffsetChange({
              maxOffsetX: Math.max(0, contentSize.width - layoutMeasurement.width),
              offsetX: contentOffset.x,
            });
          }}
          onScrollBeginDrag={onHorizontalInteractionStart}
          ref={nativeHorizontalScrollRef}
          scrollEventThrottle={32}
          showsHorizontalScrollIndicator={false}
          style={styles.eventScheduleHorizontalViewport}
        >
          <View style={{ width: horizontalMetrics.width }}>
            {timeline.hasTimes ? <View style={[styles.eventScheduleHorizontalTimeHeader, { height: scheduleHeaderHeight }]}>
              {timeline.ticks.map((tick) => <Text key={tick.key} style={[styles.eventScheduleHorizontalTimeTick, { left: scheduleHorizontalTimeInset + tick.minuteOffset * scheduleHorizontalPixelsPerMinute }]}>{tick.label}</Text>)}
            </View> : null}
            <View style={[styles.eventScheduleHorizontalRows, { height: timeline.stages.length * scheduleHorizontalStageRowHeight }]}>
              {timeline.dayBreaks.map((dayBreak) => <View
                key={dayBreak.key}
                pointerEvents="none"
                style={[styles.eventScheduleHorizontalDayDivider, { left: scheduleHorizontalTimeInset + dayBreak.minuteOffset * scheduleHorizontalPixelsPerMinute }]}
              />)}
              {timeline.stages.map((stage) => <View key={stage} style={[styles.eventScheduleHorizontalStageRow, { height: scheduleHorizontalStageRowHeight }]}>
                {timeline.hasTimes ? timeline.ticks.map((tick) => <View
                  key={tick.key}
                  pointerEvents="none"
                  style={[styles.eventScheduleHorizontalHourDivider, { left: scheduleHorizontalTimeInset + tick.minuteOffset * scheduleHorizontalPixelsPerMinute }]}
                />) : null}
                {(timeline.byStage.get(stage) ?? []).map((entry) => {
                  const itemLayout = buildHorizontalScheduleItemLayout(entry, horizontalMetrics.scheduledWidth);
                  return <Pressable
                    accessibilityLabel={formatScheduleArtistAccessibilityLabel(entry.item, stage)}
                    accessibilityRole={entry.item.accountUsername ? 'link' : undefined}
                    disabled={!entry.item.accountUsername}
                    key={entry.item.id}
                    onPress={() => entry.item.accountUsername ? void onOpenProfile(entry.item.accountUsername) : undefined}
                    style={[styles.eventScheduleHorizontalArtist, itemLayout]}
                  >
                    <Text numberOfLines={2} style={styles.eventScheduleHorizontalArtistName}>{entry.item.displayName}</Text>
                    {entry.item.accountUsername ? <Text numberOfLines={1} style={styles.eventScheduleHorizontalArtistUsername}>@{entry.item.accountUsername}</Text> : null}
                  </Pressable>;
                })}
              </View>)}
            </View>
          </View>
        </ScrollView>
      </View>
    </View>;
  }

  return <View
    onLayout={(layoutEvent) => {
      const nextWidth = layoutEvent.nativeEvent.layout.width;
      setMeasuredFrameWidth((current) => Math.abs(current - nextWidth) >= 1 ? nextWidth : current);
    }}
    style={styles.eventScheduleTableFrame}
  >
    <View style={styles.eventScheduleTimeline}>
      {timeline.hasTimes ? <View style={styles.eventScheduleTimelineTimeColumn}>
        <View style={[styles.eventScheduleTimelineCorner, { height: scheduleHeaderHeight }]}><Text style={styles.eventScheduleTimelineCornerText}>Время</Text></View>
        <View style={[styles.eventScheduleTimelineRail, { height: timeline.height }]}>
          {timeline.ticks.map((tick) => <Text key={tick.key} style={[styles.eventScheduleTimelineTick, { top: tick.top }]}>{tick.label}</Text>)}
        </View>
      </View> : null}
      <View style={{ width: compactStageWidth * timeline.stages.length }}>
        {timeline.hasStageLabels ? <View style={[styles.eventScheduleStageHeaderRow, { height: scheduleHeaderHeight }]}>
          {timeline.stages.map((stage) => <View key={stage} style={[styles.eventScheduleStageHeader, { width: compactStageWidth }]}><Text numberOfLines={2} style={styles.eventScheduleStageHeaderText}>{stage}</Text></View>)}
        </View> : timeline.hasTimes ? <View style={{ height: scheduleHeaderHeight }} /> : null}
        <View style={[styles.eventScheduleStageColumns, { height: timeline.height }]}>
          {timeline.dayBreaks.map((dayBreak) => <View key={dayBreak.key} pointerEvents="none" style={[styles.eventScheduleDayDivider, { top: dayBreak.top }]} />)}
          {timeline.stages.map((stage) => <View key={stage} style={[styles.eventScheduleStageColumn, { height: timeline.height, width: compactStageWidth }]}>
            {(timeline.byStage.get(stage) ?? []).map(({ height, item, top }) => <Pressable accessibilityLabel={formatScheduleArtistAccessibilityLabel(item, timeline.hasStageLabels ? stage : '')} accessibilityRole={item.accountUsername ? 'link' : undefined} disabled={!item.accountUsername} key={item.id} onPress={() => item.accountUsername ? void onOpenProfile(item.accountUsername) : undefined} style={[styles.eventScheduleGridEvent, { height, top }]}>
              <Text numberOfLines={1} style={styles.eventScheduleGridEventName}>{item.displayName}</Text>
              {item.accountUsername ? <Text numberOfLines={1} style={styles.eventScheduleGridEventUsername}>@{item.accountUsername}</Text> : null}
            </Pressable>)}
          </View>)}
        </View>
      </View>
    </View>
  </View>;
}

function renderWebVerticalScheduleTable(timeline: ReturnType<typeof buildScheduleTimeline>, onOpenProfile: (username: string) => Promise<void>) {
  const headerCells = [
    ...(timeline.hasTimes ? [createElement('th', { key: 'time', scope: 'col', style: webScheduleStyles.timeHeader }, 'Время')] : []),
    ...(timeline.hasStageLabels
      ? timeline.stages.map((stage) => createElement('th', { key: stage, scope: 'col', style: webScheduleStyles.stageHeader }, stage))
      : timeline.hasTimes ? [createElement('th', { 'aria-label': 'Участники', key: 'artists', scope: 'col', style: webScheduleStyles.stageHeader })] : []),
  ];
  const stageCells = timeline.stages.map((stage) => createElement('td', { key: stage, style: { ...webScheduleStyles.stageCell, height: timeline.height } },
    ...timeline.dayBreaks.map((dayBreak) => createElement('span', { key: dayBreak.key, style: { ...webScheduleStyles.dayDivider, top: dayBreak.top } })),
    ...(timeline.byStage.get(stage) ?? []).map(({ height, item, top }) => createElement(
        item.accountUsername ? 'button' : 'div',
        {
          'aria-label': formatScheduleArtistAccessibilityLabel(item, timeline.hasStageLabels ? stage : ''),
          key: item.id,
          onClick: item.accountUsername ? () => void onOpenProfile(item.accountUsername!) : undefined,
          style: { ...webScheduleStyles.artist, cursor: item.accountUsername ? 'pointer' : 'default', height, top },
          type: item.accountUsername ? 'button' : undefined,
        },
        createElement('span', { style: webScheduleStyles.artistCopy },
          createElement('span', { style: webScheduleStyles.artistName }, item.displayName),
          item.accountUsername ? createElement('span', { style: webScheduleStyles.artistUsername }, `@${item.accountUsername}`) : null,
        ),
      )),
  ));
  const timeCell = createElement('th', { scope: 'row', style: { ...webScheduleStyles.timeCell, height: timeline.height } },
    ...timeline.ticks.map((tick) => createElement('span', { key: tick.key, style: { ...webScheduleStyles.timeTick, top: tick.top } }, tick.label)),
  );

  return createElement('div', { style: { ...webScheduleStyles.frame, width: '100%' } },
    createElement('div', { className: 'event-schedule-scroll', style: { ...webScheduleStyles.scroll, overflowX: 'hidden' } },
      createElement('table', { style: { ...webScheduleStyles.table, width: '100%' } },
        createElement('colgroup', null,
          timeline.hasTimes ? createElement('col', { style: { width: scheduleTimeColumnWidth } }) : null,
          ...timeline.stages.map((stage) => createElement('col', { key: stage })),
        ),
        headerCells.length ? createElement('thead', null, createElement('tr', { style: webScheduleStyles.headerRow }, ...headerCells)) : null,
        createElement('tbody', null, createElement('tr', null, timeline.hasTimes ? timeCell : null, ...stageCells)),
      ),
    ),
  );
}

function renderWebHorizontalScheduleTable(
  timeline: ReturnType<typeof buildScheduleTimeline>,
  horizontalMetrics: ReturnType<typeof buildHorizontalScheduleMetrics>,
  onOpenProfile: (username: string) => Promise<void>,
  onHorizontalInteractionStart: () => void,
  onHorizontalOffsetChange: (position: { maxOffsetX: number; offsetX: number }) => void,
  scrollRef: { current: HTMLDivElement | null },
) {
  const bodyRows = timeline.stages.map((stage) => createElement('tr', { key: stage },
    createElement('th', { scope: 'row', style: webScheduleStyles.horizontalStageHeader }, stage),
    createElement('td', { style: { ...webScheduleStyles.horizontalStageCell, height: scheduleHorizontalStageRowHeight } },
      ...(timeline.hasTimes ? timeline.ticks.map((tick) => createElement('span', {
        key: `hour-${tick.key}`,
        style: {
          ...webScheduleStyles.horizontalHourDivider,
          left: scheduleHorizontalTimeInset + tick.minuteOffset * scheduleHorizontalPixelsPerMinute,
        },
      })) : []),
      ...timeline.dayBreaks.map((dayBreak) => createElement('span', {
        key: dayBreak.key,
        style: {
          ...webScheduleStyles.horizontalDayDivider,
          left: scheduleHorizontalTimeInset + dayBreak.minuteOffset * scheduleHorizontalPixelsPerMinute,
        },
      })),
      ...(timeline.byStage.get(stage) ?? []).map((entry) => {
        const itemLayout = buildHorizontalScheduleItemLayout(entry, horizontalMetrics.scheduledWidth);
        return createElement(
          entry.item.accountUsername ? 'button' : 'div',
          {
            'aria-label': formatScheduleArtistAccessibilityLabel(entry.item, stage),
            key: entry.item.id,
            onClick: entry.item.accountUsername ? () => void onOpenProfile(entry.item.accountUsername!) : undefined,
            style: {
              ...webScheduleStyles.horizontalArtist,
              cursor: entry.item.accountUsername ? 'pointer' : 'default',
              left: itemLayout.left,
              width: itemLayout.width,
            },
            type: entry.item.accountUsername ? 'button' : undefined,
          },
          createElement('span', { style: webScheduleStyles.horizontalArtistName }, entry.item.displayName),
          entry.item.accountUsername ? createElement('span', { style: webScheduleStyles.horizontalArtistUsername }, `@${entry.item.accountUsername}`) : null,
        );
      }),
    ),
  ));

  const timeAxis = createElement('div', { style: { ...webScheduleStyles.horizontalTimeAxis, width: horizontalMetrics.width } },
    ...timeline.ticks.map((tick) => createElement('span', {
      key: tick.key,
      style: {
        ...webScheduleStyles.horizontalTimeTick,
        left: scheduleHorizontalTimeInset + tick.minuteOffset * scheduleHorizontalPixelsPerMinute,
      },
    }, tick.label)),
  );

  return createElement('div', { style: { ...webScheduleStyles.frame, width: '100%' } },
    createElement('div', {
      className: 'event-schedule-scroll',
      onPointerDown: onHorizontalInteractionStart,
      onScroll: (scrollEvent: ReactUIEvent<HTMLDivElement>) => onHorizontalOffsetChange({
        maxOffsetX: Math.max(0, scrollEvent.currentTarget.scrollWidth - scrollEvent.currentTarget.clientWidth),
        offsetX: scrollEvent.currentTarget.scrollLeft,
      }),
      onTouchStart: onHorizontalInteractionStart,
      onWheel: onHorizontalInteractionStart,
      ref: scrollRef,
      style: webScheduleStyles.scroll,
    },
    createElement('table', { style: { ...webScheduleStyles.table, width: scheduleHorizontalStageColumnWidth + horizontalMetrics.width } },
      createElement('colgroup', null,
        createElement('col', { style: { width: scheduleHorizontalStageColumnWidth } }),
        createElement('col', { style: { width: horizontalMetrics.width } }),
      ),
      timeline.hasTimes ? createElement('thead', null, createElement('tr', { style: webScheduleStyles.headerRow },
        createElement('th', { scope: 'col', style: webScheduleStyles.horizontalCorner }, 'Сцена'),
        createElement('th', { scope: 'col', style: webScheduleStyles.horizontalTimeHeader }, timeAxis),
      )) : null,
      createElement('tbody', null, ...bodyRows),
    )),
  );
}

function buildHorizontalScheduleMetrics(timeline: ReturnType<typeof buildScheduleTimeline>) {
  const scheduledWidth = timeline.hasTimes
    ? scheduleHorizontalTimeInset
      + timeline.scheduledMinutes * scheduleHorizontalPixelsPerMinute
      + scheduleTimelineBottomInset
    : 0;
  const unscheduledWidth = timeline.largestUnscheduledStage
    ? 16 + timeline.largestUnscheduledStage * scheduleHorizontalUnscheduledSlotWidth
    : 0;
  return {
    scheduledWidth,
    width: Math.max(320, scheduledWidth + unscheduledWidth),
  };
}

function buildHorizontalScheduleItemLayout(
  entry: { durationMinutes: number | null; startMinute: number | null; unscheduledIndex: number },
  scheduledWidth: number,
) {
  if (entry.startMinute === null || entry.durationMinutes === null) {
    return {
      left: scheduledWidth + 16 + entry.unscheduledIndex * scheduleHorizontalUnscheduledSlotWidth,
      width: scheduleHorizontalUnscheduledSlotWidth - 6,
    };
  }
  return {
    left: scheduleHorizontalTimeInset + entry.startMinute * scheduleHorizontalPixelsPerMinute + 2,
    width: Math.max(22, entry.durationMinutes * scheduleHorizontalPixelsPerMinute - 4),
  };
}

const webScheduleStyles = {
  frame: { width: 'fit-content', maxWidth: '100%', overflow: 'hidden', border: '1px solid #d7dee5', borderRadius: 8, background: '#f3f5f7' },
  scroll: { width: '100%', overflowX: 'scroll', WebkitOverflowScrolling: 'touch', scrollbarGutter: 'stable' },
  table: { borderCollapse: 'separate', borderSpacing: 0, tableLayout: 'fixed', background: '#f3f5f7', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif' },
  headerRow: { height: scheduleHeaderHeight },
  timeHeader: { boxSizing: 'border-box', position: 'sticky', left: 0, zIndex: 3, width: scheduleTimeColumnWidth, minWidth: scheduleTimeColumnWidth, maxWidth: scheduleTimeColumnWidth, padding: '0 8px', borderRight: '1px solid #c8d1da', borderBottom: '1px solid #c8d1da', background: '#e8edf2', color: '#53606c', fontSize: 12, fontWeight: 600, textAlign: 'left', verticalAlign: 'middle', whiteSpace: 'nowrap' },
  stageHeader: { padding: '0 12px', borderRight: '1px solid #d7dee5', borderBottom: '1px solid #c8d1da', background: '#e8edf2', color: '#111', fontSize: 13, lineHeight: '18px', fontWeight: 600, textAlign: 'center', verticalAlign: 'middle' },
  timeCell: { boxSizing: 'border-box', position: 'sticky', left: 0, zIndex: 2, width: scheduleTimeColumnWidth, minWidth: scheduleTimeColumnWidth, maxWidth: scheduleTimeColumnWidth, padding: 0, borderRight: '1px solid #c8d1da', background: '#eef2f5', verticalAlign: 'top' },
  timeTick: { position: 'absolute', left: 8, color: '#111', fontSize: 12, lineHeight: '16px', fontWeight: 400, whiteSpace: 'nowrap', transform: 'translateY(-8px)' },
  stageCell: { position: 'relative', padding: 0, borderRight: '1px solid #e2e7ec', verticalAlign: 'top' },
  dayDivider: { position: 'absolute', left: 0, right: 0, height: 1, zIndex: 0, background: '#c8d1da' },
  artist: { boxSizing: 'border-box', position: 'absolute', left: 6, right: 6, margin: 0, padding: '7px 9px', border: 0, borderRadius: 8, background: '#fff', color: '#111', fontFamily: 'inherit', textAlign: 'left', display: 'flex', flexDirection: 'column', justifyContent: 'center', overflow: 'hidden' },
  artistCopy: { minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column' },
  artistName: { display: 'block', fontSize: 13, lineHeight: '18px', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  artistUsername: { display: 'block', marginTop: 2, color: '#7d8894', fontSize: 11, lineHeight: '15px', fontWeight: 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  horizontalCorner: { boxSizing: 'border-box', position: 'sticky', left: 0, zIndex: 4, width: scheduleHorizontalStageColumnWidth, minWidth: scheduleHorizontalStageColumnWidth, maxWidth: scheduleHorizontalStageColumnWidth, padding: '0 8px', borderRight: '1px solid #c8d1da', borderBottom: '1px solid #c8d1da', background: '#e8edf2', color: '#53606c', fontSize: 12, fontWeight: 600, textAlign: 'center', verticalAlign: 'middle', whiteSpace: 'nowrap' },
  horizontalTimeHeader: { boxSizing: 'border-box', height: scheduleHeaderHeight, padding: 0, borderBottom: '1px solid #c8d1da', background: '#e8edf2', verticalAlign: 'top' },
  horizontalTimeAxis: { position: 'relative', height: scheduleHeaderHeight },
  horizontalTimeTick: { position: 'absolute', top: 18, color: '#111', fontSize: 12, lineHeight: '16px', fontWeight: 400, whiteSpace: 'nowrap', transform: 'translateX(-50%)' },
  horizontalStageHeader: { boxSizing: 'border-box', position: 'sticky', left: 0, zIndex: 2, width: scheduleHorizontalStageColumnWidth, minWidth: scheduleHorizontalStageColumnWidth, maxWidth: scheduleHorizontalStageColumnWidth, height: scheduleHorizontalStageRowHeight, padding: '0 8px', borderRight: '1px solid #c8d1da', borderBottom: '1px solid #d7dee5', background: '#e8edf2', color: '#111', fontSize: 12, lineHeight: '16px', fontWeight: 600, textAlign: 'center', verticalAlign: 'middle', overflow: 'hidden' },
  horizontalStageCell: { position: 'relative', boxSizing: 'border-box', padding: 0, borderBottom: '1px solid #d7dee5', verticalAlign: 'top' },
  horizontalHourDivider: { position: 'absolute', top: 0, bottom: 0, zIndex: 0, width: 1, pointerEvents: 'none', background: '#e2e7ec' },
  horizontalDayDivider: { position: 'absolute', top: 0, bottom: 0, zIndex: 0, width: 1, background: '#c8d1da' },
  horizontalArtist: { boxSizing: 'border-box', position: 'absolute', top: 6, height: scheduleHorizontalStageRowHeight - 12, zIndex: 1, margin: 0, padding: '2px 9px', border: 0, borderRadius: 8, background: '#fff', color: '#111', fontFamily: 'inherit', textAlign: 'left', display: 'flex', flexDirection: 'column', justifyContent: 'center', overflow: 'hidden' },
  horizontalArtistName: { display: '-webkit-box', fontSize: 13, lineHeight: '17px', fontWeight: 600, whiteSpace: 'normal', overflow: 'hidden', textOverflow: 'ellipsis', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2 },
  horizontalArtistUsername: { display: 'block', marginTop: 1, color: '#7d8894', fontSize: 11, lineHeight: '14px', fontWeight: 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
} as const;

function buildScheduleTimeline(items: EventSummary['lineup'], stageOrder: string[]) {
  const normalizedStageOrder = stageOrder.map((stage) => stage.trim()).filter(Boolean);
  const hasStageLabels = normalizedStageOrder.length > 0 || items.some((item) => Boolean(item.stageName?.trim()));
  const stagesInDay = new Set(items.map((item) => item.stageName?.trim() || 'Без сцены'));
  const stages = [
    ...normalizedStageOrder.filter((stage) => stagesInDay.has(stage)),
    ...[...stagesInDay].filter((stage) => !normalizedStageOrder.includes(stage)),
  ];
  const validStarts = items
    .map((item) => item.startsAt ? new Date(item.startsAt).getTime() : Number.NaN)
    .filter(Number.isFinite);
  if (!validStarts.length) {
    const largestUnscheduledStage = Math.max(...stages.map((stage) => items.filter((item) => (item.stageName?.trim() || 'Без сцены') === stage).length), 1);
    const height = Math.max(72, largestUnscheduledStage * 64 + 6);
    const byStage = new Map(stages.map((stage) => [stage, items
      .filter((item) => (item.stageName?.trim() || 'Без сцены') === stage)
      .map((item, index) => ({
        durationMinutes: null,
        height: 58,
        item,
        startMinute: null,
        top: 6 + index * 64,
        unscheduledIndex: index,
      }))]));
    return {
      stages,
      byStage,
      dayBreaks: [],
      hasStageLabels,
      hasTimes: false,
      height,
      largestUnscheduledStage,
      scheduledMinutes: 0,
      ticks: [{ key: 'without-time', label: '—', minuteOffset: 0, top: 8 }],
      timelineEnd: null,
      timelineStart: null,
      unscheduledTop: 0,
    };
  }

  const fallbackDurationMs = scheduleFallbackDurationMinutes * 60_000;
  const hourMs = 60 * 60_000;
  const timelineStart = Math.floor(Math.min(...validStarts) / hourMs) * hourMs;
  const timelineEnd = Math.ceil(Math.max(...items.filter((item) => item.startsAt).map((item) => {
    const start = new Date(item.startsAt!).getTime();
    const rawEnd = item.endsAt ? new Date(item.endsAt).getTime() : start + fallbackDurationMs;
    return Number.isFinite(rawEnd) && rawEnd > start ? rawEnd : start + fallbackDurationMs;
  })) / hourMs) * hourMs;
  const scheduledMinutes = (timelineEnd - timelineStart) / 60_000;
  const scheduledHeight = Math.max(
    84,
    scheduleTimelineTopInset
      + scheduledMinutes * schedulePixelsPerMinute
      + scheduleTimelineBottomInset,
  );
  const unscheduledItems = items.filter((item) => !item.startsAt || !Number.isFinite(new Date(item.startsAt).getTime()));
  const unscheduledTop = scheduledHeight + (unscheduledItems.length ? 16 : 0);
  const largestUnscheduledStage = Math.max(
    ...stages.map((stage) => unscheduledItems.filter((item) => (item.stageName?.trim() || 'Без сцены') === stage).length),
    0,
  );
  const height = Math.max(scheduledHeight, unscheduledTop + largestUnscheduledStage * 64);
  const ticks = Array.from({ length: Math.floor((timelineEnd - timelineStart) / hourMs) + 1 }, (_, index) => {
    const timestamp = timelineStart + index * hourMs;
    return {
      key: String(timestamp),
      label: formatScheduleTime(new Date(timestamp).toISOString()),
      minuteOffset: (timestamp - timelineStart) / 60_000,
      top: scheduleTimelineTopInset + (timestamp - timelineStart) / 60_000 * schedulePixelsPerMinute,
    };
  });
  const dayBreaks = ticks.filter((tick, index) => {
    const date = new Date(Number(tick.key));
    return index > 0 && index < ticks.length - 1 && date.getHours() === 0 && date.getMinutes() === 0;
  });
  const byStage = new Map(stages.map((stage) => {
    let unscheduledIndex = 0;
    const orderedItems = items
      .filter((item) => (item.stageName?.trim() || 'Без сцены') === stage)
      .sort((left, right) => {
        const leftStart = left.startsAt ? new Date(left.startsAt).getTime() : Number.POSITIVE_INFINITY;
        const rightStart = right.startsAt ? new Date(right.startsAt).getTime() : Number.POSITIVE_INFINITY;
        return leftStart - rightStart || left.displayName.localeCompare(right.displayName, 'ru');
      });
    const stageItems = orderedItems.map((item, itemIndex) => {
      const start = item.startsAt ? new Date(item.startsAt).getTime() : Number.NaN;
      if (!Number.isFinite(start)) {
        const top = unscheduledTop + unscheduledIndex * 64;
        const currentUnscheduledIndex = unscheduledIndex;
        unscheduledIndex += 1;
        return {
          durationMinutes: null,
          height: 58,
          item,
          startMinute: null,
          top,
          unscheduledIndex: currentUnscheduledIndex,
        };
      }
      const nextStart = orderedItems
        .slice(itemIndex + 1)
        .map((nextItem) => nextItem.startsAt ? new Date(nextItem.startsAt).getTime() : Number.NaN)
        .find((candidate) => Number.isFinite(candidate) && candidate > start);
      const rawEnd = item.endsAt
        ? new Date(item.endsAt).getTime()
        : nextStart ?? start + fallbackDurationMs;
      const end = Number.isFinite(rawEnd) && rawEnd > start ? rawEnd : start + fallbackDurationMs;
      const durationMinutes = (end - start) / 60_000;
      return {
        durationMinutes,
        height: Math.max(22, durationMinutes * schedulePixelsPerMinute - 4),
        item,
        startMinute: (start - timelineStart) / 60_000,
        top: scheduleTimelineTopInset + Math.max(2, (start - timelineStart) / 60_000 * schedulePixelsPerMinute + 2),
        unscheduledIndex: -1,
      };
    });
    return [stage, stageItems] as const;
  }));
  return {
    stages,
    byStage,
    dayBreaks,
    hasStageLabels,
    hasTimes: true,
    height,
    largestUnscheduledStage,
    scheduledMinutes,
    ticks,
    timelineEnd,
    timelineStart,
    unscheduledTop,
  };
}

function buildScheduleDayNavigation(
  groups: ReturnType<typeof groupEventLineupByDay>,
  timeline: ReturnType<typeof buildScheduleTimeline>,
) {
  const horizontalMetrics = buildHorizontalScheduleMetrics(timeline);
  return groups.map((group) => {
    const rawTop = group.dayStart === null || timeline.timelineStart === null
      ? timeline.unscheduledTop
      : scheduleTimelineTopInset + (group.dayStart - timeline.timelineStart) / 60_000 * schedulePixelsPerMinute;
    const rawLeft = group.dayStart === null || timeline.timelineStart === null
      ? horizontalMetrics.scheduledWidth
      : scheduleHorizontalTimeInset + (group.dayStart - timeline.timelineStart) / 60_000 * scheduleHorizontalPixelsPerMinute;
    return {
      key: group.key,
      label: group.label,
      left: Math.max(0, Math.min(rawLeft, horizontalMetrics.width)),
      shortLabel: group.shortLabel,
      top: Math.max(0, Math.min(rawTop, timeline.height)),
    };
  });
}

function resolveScheduleDayAtOffset(
  days: ReturnType<typeof buildScheduleDayNavigation>,
  offset: number,
  axis: 'left' | 'top',
  clearance: number,
) {
  let currentDay = days[0];
  for (const day of days) {
    if (day[axis] - clearance > offset) break;
    currentDay = day;
  }
  return currentDay;
}

function formatScheduleArtistMeta(item: EventSummary['lineup'][number]) {
  const timeRange = item.startsAt
    ? `${formatScheduleTime(item.startsAt)}${item.endsAt ? `–${formatScheduleTime(item.endsAt)}` : ''}`
    : 'Время не указано';
  return [timeRange, item.accountUsername ? `@${item.accountUsername}` : ''].filter(Boolean).join(' · ');
}

function formatScheduleArtistAccessibilityLabel(item: EventSummary['lineup'][number], stage: string) {
  return [item.displayName, formatScheduleArtistMeta(item), stage].filter(Boolean).join(', ');
}

function EventImagePreviewModal({ imageUrl, onClose }: { imageUrl: string | null; onClose: () => void }) {
  return <Modal animationType="fade" onRequestClose={onClose} transparent visible={Boolean(imageUrl)}>
    <View style={styles.avatarPreviewLayer}>
      <Pressable accessibilityLabel="Закрыть просмотр изображения" onPress={onClose} style={styles.avatarPreviewBackdrop} />
      <SafeAreaView pointerEvents="box-none" style={styles.eventImagePreviewSafeArea}>
        <View pointerEvents="box-none" style={styles.avatarPreviewHeader}>
          <Pressable accessibilityLabel="Закрыть" accessibilityRole="button" onPress={onClose} style={styles.avatarPreviewClose}>
            <X color="#fff" size={26} strokeWidth={2.2} />
          </Pressable>
        </View>
        {imageUrl ? <Image source={{ uri: imageUrl }} resizeMode="contain" style={styles.eventImagePreviewImage} /> : null}
      </SafeAreaView>
    </View>
  </Modal>;
}

function EventMoreModal({ authToken, event, isVisible, onClose, onNotify }: { authToken: string; event: EventSummary; isVisible: boolean; onClose: () => void; onNotify: (message: string, type?: ToastMessage['type']) => void }) {
  const [showReasons, setShowReasons] = useState(false);
  useEffect(() => { if (!isVisible) setShowReasons(false); }, [isVisible]);
  const reasons = [{ label: 'Спам', value: 'SPAM' }, { label: 'Оскорбления или преследование', value: 'HARASSMENT' }, { label: 'Выдаёт себя за другого', value: 'IMPERSONATION' }, { label: 'Незаконный контент', value: 'ILLEGAL_CONTENT' }, { label: 'Другое', value: 'OTHER' }] as const;
  const report = async (reason: typeof reasons[number]['value']) => {
    try {
      const response = await fetch(`${apiUrl}/safety/reports`, { method: 'POST', headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ targetType: 'EVENT', targetId: event.id, reason }) });
      if (!response.ok) throw new Error(await readApiError(response, 'Не удалось отправить жалобу'));
      const payload = await response.json() as { alreadyReported?: boolean };
      onClose(); onNotify(payload.alreadyReported ? 'Вы уже отправили жалобу' : 'Жалоба отправлена');
    } catch (error) { onNotify(error instanceof Error ? error.message : 'Не удалось отправить жалобу', 'error'); }
  };
  const addToCalendar = async () => {
    try {
      await addEventToCalendar(event);
      onClose();
      onNotify('Событие добавлено в календарь с напоминанием', 'success');
    } catch (error) {
      onNotify(error instanceof Error ? error.message : 'Не удалось добавить событие в календарь', 'error');
    }
  };
  return <AppSheetModal isVisible={isVisible} onClose={onClose} title={showReasons ? 'Причина жалобы' : 'Действия с событием'}>{showReasons ? reasons.map((reason) => <Pressable key={reason.value} onPress={() => void report(reason.value)} style={styles.safetyAction}><Text style={styles.safetyActionText}>{reason.label}</Text></Pressable>) : <><Pressable onPress={() => void addToCalendar()} style={styles.safetyAction}><CalendarPlus color="#111" size={20} /><Text style={styles.safetyActionText}>Добавить в календарь</Text></Pressable><Pressable onPress={() => setShowReasons(true)} style={styles.safetyAction}><Flag color="#111" size={20} /><Text style={styles.safetyActionText}>Пожаловаться</Text></Pressable></>}</AppSheetModal>;
}

async function addEventToCalendar(event: EventSummary) {
  const eventUrl = formatEventPublicUrl(event.id);
  const startDate = new Date(event.startsAt);
  const endDate = new Date(event.endsAt);
  const location = [event.cityName, event.venueName, event.venueAddress].filter(Boolean).join(', ');
  if (Platform.OS === 'web') {
    const toIcsDate = (date: Date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const escapeIcs = (value: string) => value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//VOLNA//Events//RU', 'BEGIN:VEVENT', `UID:${event.id}@volna.social`, `DTSTAMP:${toIcsDate(new Date())}`, `DTSTART:${toIcsDate(startDate)}`, `DTEND:${toIcsDate(endDate)}`, `SUMMARY:${escapeIcs(event.title)}`, `LOCATION:${escapeIcs(location)}`, `DESCRIPTION:${escapeIcs(`${event.about || event.typeLabel}\n${eventUrl}`)}`, 'BEGIN:VALARM', 'TRIGGER:-PT1H', 'ACTION:DISPLAY', `DESCRIPTION:${escapeIcs(event.title)}`, 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${event.title.replace(/[^a-zа-яё0-9]+/gi, '-').replace(/^-|-$/g, '') || 'volna-event'}.ics`;
    link.click();
    URL.revokeObjectURL(url);
    return;
  }
  const permission = await Calendar.requestCalendarPermissionsAsync();
  if (permission.status !== 'granted') throw new Error('Разрешите VOLNA доступ к календарю');
  const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  const target = calendars.find((item) => item.allowsModifications) ?? calendars[0];
  if (!target) throw new Error('На устройстве не найден доступный календарь');
  await Calendar.createEventAsync(target.id, {
    title: event.title,
    startDate,
    endDate,
    location,
    notes: [event.about || event.typeLabel, eventUrl].filter(Boolean).join('\n'),
    url: eventUrl,
    alarms: [{ relativeOffset: -60 }],
  });
}

function formatEventPublicUrl(eventId: string) {
  return `https://volna.social/events?event=${encodeURIComponent(eventId)}`;
}

type EventScheduleEditorItem = {
  id: string;
  artist: string;
  accountUsername: string | null;
  stageName: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
};

function formatScheduleEditorDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.${date.getFullYear()}`;
}

function formatScheduleTimeInput(date: Date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function eventScheduleEditorItems(event: EventSummary): EventScheduleEditorItem[] {
  return event.lineup.map((item) => ({
    id: item.id,
    artist: item.accountUsername ? `@${item.accountUsername}` : item.displayName,
    accountUsername: item.accountUsername,
    stageName: item.stageName ?? '',
    startDate: formatScheduleEditorDate(item.startsAt ?? event.startsAt),
    startTime: formatScheduleTime(item.startsAt),
    endDate: formatScheduleEditorDate(item.endsAt ?? item.startsAt ?? event.startsAt),
    endTime: formatScheduleTime(item.endsAt),
  }));
}

function eventScheduleEditorStages(event: EventSummary) {
  return event.scheduleStages?.length
    ? [...event.scheduleStages]
    : [...new Set(event.lineup.map((item) => item.stageName?.trim()).filter((value): value is string => Boolean(value)))];
}

function eventScheduleEditorHasPerformanceTimes(event: EventSummary) {
  return event.lineup.some((item) => Boolean(item.startsAt || item.endsAt));
}

function EventScheduleEditor({ adminMode, authToken, event, isVisible, onClose, onNotify, onSaved }: { adminMode: boolean; authToken: string; event: EventSummary; isVisible: boolean; onClose: () => void; onNotify: (message: string, type?: ToastMessage['type']) => void; onSaved: () => Promise<void> }) {
  const [items, setItems] = useState<EventScheduleEditorItem[]>(() => eventScheduleEditorItems(event));
  const [stages, setStages] = useState<string[]>(() => eventScheduleEditorStages(event));
  const [hasPerformanceTimes, setHasPerformanceTimes] = useState(() => eventScheduleEditorHasPerformanceTimes(event));
  const [datePicker, setDatePicker] = useState<{ itemId: string; field: 'start' | 'end' } | null>(null);
  const [timePicker, setTimePicker] = useState<{ itemId: string; field: 'start' | 'end' } | null>(null);
  const [stagePickerItemId, setStagePickerItemId] = useState<string | null>(null);
  const [activeArtistItemId, setActiveArtistItemId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const activeArtistItem = items.find((item) => item.id === activeArtistItemId);
  const artistSearch = useAccountSearchSuggestions(
    activeArtistItem?.artist ?? '',
    Boolean(activeArtistItem && !activeArtistItem.accountUsername),
  );

  useEffect(() => {
    if (!isVisible) return;
    setItems(eventScheduleEditorItems(event));
    setStages(eventScheduleEditorStages(event));
    setHasPerformanceTimes(eventScheduleEditorHasPerformanceTimes(event));
    setActiveArtistItemId(null);
    setDatePicker(null);
    setTimePicker(null);
    setStagePickerItemId(null);
    setIsSaving(false);
  }, [event, isVisible]);

  const updateItem = (itemId: string, patch: Partial<EventScheduleEditorItem>) => {
    setItems((current) => current.map((item) => item.id === itemId ? { ...item, ...patch } : item));
  };
  const updateStage = (index: number, value: string) => {
    const previous = stages[index] ?? '';
    setStages((current) => current.map((stage, stageIndex) => stageIndex === index ? value : stage));
    if (previous) setItems((current) => current.map((item) => item.stageName === previous ? { ...item, stageName: value } : item));
  };
  const removeStage = (index: number) => {
    const removed = stages[index] ?? '';
    setStages((current) => current.filter((_, stageIndex) => stageIndex !== index));
    if (removed) setItems((current) => current.map((item) => item.stageName === removed ? { ...item, stageName: '' } : item));
  };

  const eventStart = new Date(event.startsAt);
  const eventEnd = new Date(event.endsAt);
  const selectedDateItem = datePicker ? items.find((item) => item.id === datePicker.itemId) : null;
  const selectedTimeItem = timePicker ? items.find((item) => item.id === timePicker.itemId) : null;
  const selectedStageItem = items.find((item) => item.id === stagePickerItemId);
  const availableStages = stages.map((stage) => stage.trim()).filter(Boolean);
  const selectedTimeDateValue = timePicker?.field === 'end' ? selectedTimeItem?.endDate : selectedTimeItem?.startDate;
  const selectedTimeDate = parseDateInput(selectedTimeDateValue ?? '');
  let pickerMinTime = selectedTimeDate && isSameCalendarDate(selectedTimeDate, eventStart) ? formatScheduleTimeInput(eventStart) : '00:00';
  let pickerMaxTime = selectedTimeDate && isSameCalendarDate(selectedTimeDate, eventEnd) ? formatScheduleTimeInput(eventEnd) : '23:55';
  if (timePicker?.field === 'end' && selectedTimeItem && selectedTimeItem.startDate === selectedTimeItem.endDate && selectedTimeItem.startTime > pickerMinTime) pickerMinTime = selectedTimeItem.startTime;
  if (timePicker?.field === 'start' && selectedTimeItem && selectedTimeItem.startDate === selectedTimeItem.endDate && selectedTimeItem.endTime && selectedTimeItem.endTime < pickerMaxTime) pickerMaxTime = selectedTimeItem.endTime;

  const save = async () => {
    const scheduleStages = stages.map((stage) => stage.trim()).filter(Boolean);
    if (new Set(scheduleStages.map((stage) => stage.toLocaleLowerCase('ru-RU'))).size !== scheduleStages.length) {
      throw new Error('Названия сцен не должны повторяться');
    }

    const lineup: Array<{ accountUsername?: string; displayName: string; stageName?: string; startsAt?: string; endsAt?: string }> = [];
    for (const item of items) {
      const artist = item.artist.trim();
      if (!artist) continue;
      if (artist.length < 2) throw new Error('Имя артиста должно быть не короче двух символов');

      const username = item.accountUsername?.trim() ?? '';
      const stageName = scheduleStages.length ? item.stageName.trim() : '';
      if (stageName && !scheduleStages.includes(stageName)) throw new Error(`Выберите сцену из редактора сцен: ${artist}`);

      let startsAt: Date | null = null;
      let endsAt: Date | null = null;
      if (hasPerformanceTimes) {
        if (!item.startTime.trim() || !item.endTime.trim()) {
          throw new Error(`Укажите время начала и конца выступления: ${artist}`);
        }
        startsAt = parseDateTimeInput(item.startDate, item.startTime);
        endsAt = parseDateTimeInput(item.endDate, item.endTime);
        if (!startsAt || !endsAt) throw new Error(`Проверьте дату и время выступления: ${artist}`);
        if (startsAt < eventStart || startsAt > eventEnd) throw new Error(`Начало выступления ${artist} должно быть внутри дат события`);
        if (endsAt <= startsAt || endsAt > eventEnd) throw new Error(`Конец выступления ${artist} должен быть позже начала и внутри дат события`);
      }

      lineup.push({
        accountUsername: username || undefined,
        displayName: username || artist,
        stageName: stageName || undefined,
        startsAt: startsAt?.toISOString(),
        endsAt: endsAt?.toISOString(),
      });
    }

    const response = await fetch(`${apiUrl}/events/${event.id}/lineup`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json', ...(adminMode ? { 'x-volna-admin-mode': '1' } : {}) },
      body: JSON.stringify({ hasTimetable: hasPerformanceTimes, scheduleStages, lineup }),
    });
    if (!response.ok) throw new Error(await readApiError(response, 'Не удалось сохранить расписание'));
    await onSaved();
    onClose();
    onNotify('Расписание сохранено', 'success');
  };

  const submitSave = async () => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      await save();
    } catch (error) {
      onNotify(error instanceof Error ? error.message : 'Не удалось сохранить расписание', 'error');
    } finally {
      setIsSaving(false);
    }
  };
  const closeEditor = () => {
    if (!isSaving) onClose();
  };

  return <Modal animationType="slide" onRequestClose={closeEditor} visible={isVisible}>
    <SafeAreaView style={styles.eventEditorScreen}>
      <View style={styles.eventEditorHeader}>
        <View style={styles.eventEditorHeaderSide}>
          <Pressable accessibilityLabel="Отменить редактирование расписания" accessibilityRole="button" disabled={isSaving} onPress={closeEditor} style={styles.eventEditorCancel}>
            <Text style={styles.eventEditorCancelText}>Отмена</Text>
          </Pressable>
        </View>
        <Text numberOfLines={1} style={styles.eventEditorTitle}>Расписание</Text>
        <View style={[styles.eventEditorHeaderSide, styles.eventEditorHeaderSideTrailing]}>
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: isSaving }} disabled={isSaving} onPress={() => void submitSave()} style={[styles.eventEditorSave, isSaving && styles.disabledButton]}>
            {isSaving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.eventEditorSaveText}>Сохранить</Text>}
          </Pressable>
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.eventEditorContent} keyboardShouldPersistTaps="handled" style={styles.eventEditorScroll}>
          <View style={styles.eventStageEditor}>
            <View style={styles.eventStageEditorHeader}>
              <View style={styles.eventStageEditorCopy}>
                <Text style={styles.eventStageEditorTitle}>Сцены</Text>
                <Text style={styles.eventStageEditorHint}>Названия сцен используются в таблице расписания.</Text>
              </View>
            </View>
            {stages.map((stage, index) => <View key={`stage-${index}`} style={styles.eventStageEditorRow}>
              <PanelsTopLeft color="#6f7b86" size={18} strokeWidth={1.9} />
              <TextInput maxLength={80} onChangeText={(value) => updateStage(index, value)} placeholder="Название сцены" placeholderTextColor="#98a3ae" style={styles.eventStageEditorInput} value={stage} />
              <Pressable accessibilityLabel="Удалить сцену" accessibilityRole="button" onPress={() => removeStage(index)} style={styles.eventStageEditorRemove}><X color="#6f7b86" size={19} /></Pressable>
            </View>)}
            <Pressable accessibilityRole="button" onPress={() => setStages((current) => [...current, ''])} style={styles.eventStageEditorAdd}><Plus color="#111" size={18} /><Text style={styles.eventStageEditorAddText}>Добавить сцену</Text></Pressable>
          </View>

          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: hasPerformanceTimes }}
            onPress={() => {
              setHasPerformanceTimes((current) => !current);
              if (hasPerformanceTimes) {
                setDatePicker(null);
                setTimePicker(null);
              }
            }}
            style={styles.eventPerformanceTimeToggle}
          >
            <View style={[styles.eventPerformanceTimeCheckbox, hasPerformanceTimes && styles.eventPerformanceTimeCheckboxActive]}>
              {hasPerformanceTimes ? <Check color="#fff" size={15} strokeWidth={2.5} /> : null}
            </View>
            <View style={styles.eventPerformanceTimeCopy}>
              <Text style={styles.eventPerformanceTimeTitle}>Указать время выступлений</Text>
              <Text style={styles.eventPerformanceTimeHint}>Начало и конец станут обязательными для каждого участника.</Text>
            </View>
          </Pressable>

          {items.map((item) => <View key={item.id} style={styles.eventEditorCard}>
            <View style={styles.eventEditorInputRow}>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={(artist) => {
                  setActiveArtistItemId(item.id);
                  updateItem(item.id, { artist, accountUsername: null });
                }}
                onFocus={() => setActiveArtistItemId(item.id)}
                placeholder="@username или имя"
                placeholderTextColor="#8e99a4"
                style={styles.eventEditorInput}
                value={item.artist}
              />
              <Pressable accessibilityLabel="Удалить участника" accessibilityRole="button" onPress={() => setItems((current) => current.filter((candidate) => candidate.id !== item.id))} style={styles.eventPartnerRemove}><X color="#6f7b86" size={20} /></Pressable>
            </View>
            {activeArtistItemId === item.id && artistSearch.queryLength > 0 && artistSearch.queryLength < 3 ? <Text style={styles.communityAudioParticipantSearchHint}>Поиск начнётся после ввода 3 символов</Text> : null}
            {activeArtistItemId === item.id && artistSearch.isSearching ? <View style={styles.communityAudioParticipantSearchStatus}><ActivityIndicator color="#6f7b86" size="small" /><Text style={styles.communityAudioParticipantSearchStatusText}>Ищем профили…</Text></View> : null}
            {activeArtistItemId === item.id && artistSearch.suggestions.length ? <View style={styles.entityUsernameSuggestions}>{artistSearch.suggestions.map((suggestion) => <Pressable accessibilityRole="button" key={suggestion.id} onPress={() => {
              updateItem(item.id, { accountUsername: suggestion.username, artist: `@${suggestion.username}` });
              setActiveArtistItemId(null);
            }} style={styles.entityUsernameSuggestionRow}>
              {suggestion.avatarUrl ? <Image source={{ uri: suggestion.avatarUrl }} style={styles.entityUsernameSuggestionAvatar} /> : <View style={styles.entityUsernameSuggestionAvatar}><Text style={styles.entityUsernameSuggestionAvatarText}>{getAvatarInitial(suggestion.name)}</Text></View>}
              <View style={styles.publicPageTeamCopy}><Text numberOfLines={1} style={styles.publicPageTeamName}>{suggestion.name}</Text><Text numberOfLines={1} style={styles.publicPageTeamUsername}>@{suggestion.username} · Профиль</Text></View>
            </Pressable>)}</View> : null}
            {availableStages.length ? <Pressable accessibilityLabel="Выбрать сцену" accessibilityRole="button" onPress={() => setStagePickerItemId(item.id)} style={styles.eventEditorStageButton}>
              <PanelsTopLeft color="#6f7b86" size={18} />
              <Text numberOfLines={1} style={[styles.eventEditorStageText, !item.stageName && styles.eventEditorPlaceholder]}>{item.stageName || 'Выбрать сцену'}</Text>
              <ChevronRight color="#8e99a4" size={19} />
            </Pressable> : null}
            {hasPerformanceTimes ? <>
              <View style={styles.eventEditorDateTimeRow}>
                <Text style={styles.eventEditorDateTimeLabel}>Начало</Text>
                <Pressable accessibilityLabel="Выбрать дату начала выступления" accessibilityRole="button" onPress={() => setDatePicker({ itemId: item.id, field: 'start' })} style={styles.eventEditorDateTimeButton}><CalendarDays color="#6f7b86" size={18} /><Text style={styles.eventEditorDateTimeText}>{item.startDate}</Text></Pressable>
                <Pressable accessibilityLabel="Выбрать время начала выступления" accessibilityRole="button" onPress={() => setTimePicker({ itemId: item.id, field: 'start' })} style={styles.eventEditorTime}><Clock3 color="#6f7b86" size={18} /><Text style={[styles.eventEditorDateTimeText, !item.startTime && styles.eventEditorPlaceholder]}>{item.startTime || 'Время'}</Text></Pressable>
              </View>
              <View style={styles.eventEditorDateTimeRow}>
                <Text style={styles.eventEditorDateTimeLabel}>Конец</Text>
                <Pressable accessibilityLabel="Выбрать дату конца выступления" accessibilityRole="button" onPress={() => setDatePicker({ itemId: item.id, field: 'end' })} style={styles.eventEditorDateTimeButton}><CalendarDays color="#6f7b86" size={18} /><Text style={styles.eventEditorDateTimeText}>{item.endDate}</Text></Pressable>
                <Pressable accessibilityLabel="Выбрать время конца выступления" accessibilityRole="button" onPress={() => setTimePicker({ itemId: item.id, field: 'end' })} style={styles.eventEditorTime}><Clock3 color="#6f7b86" size={18} /><Text style={[styles.eventEditorDateTimeText, !item.endTime && styles.eventEditorPlaceholder]}>{item.endTime || 'Время'}</Text></Pressable>
              </View>
            </> : null}
          </View>)}
          <Pressable onPress={() => setItems((current) => [...current, {
            id: `schedule-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            artist: '',
            accountUsername: null,
            stageName: '',
            startDate: formatScheduleEditorDate(event.startsAt),
            startTime: '',
            endDate: formatScheduleEditorDate(event.startsAt),
            endTime: '',
          }])} accessibilityRole="button" style={styles.eventEditorAdd}><Plus color="#111" size={20} /><Text>Добавить участника</Text></Pressable>
      </ScrollView>
      <SelectionPickerModal
        embedded
        emptyText="Сначала добавьте сцену"
        isVisible={stagePickerItemId !== null && availableStages.length > 0}
        onClose={() => setStagePickerItemId(null)}
        options={[
          { key: 'none', muted: true, onPress: () => { if (stagePickerItemId) updateItem(stagePickerItemId, { stageName: '' }); setStagePickerItemId(null); }, selected: !selectedStageItem?.stageName, title: 'Без сцены' },
          ...availableStages.map((stage) => ({ key: stage, onPress: () => { if (stagePickerItemId) updateItem(stagePickerItemId, { stageName: stage }); setStagePickerItemId(null); }, selected: selectedStageItem?.stageName === stage, title: stage })),
        ]}
        title="Сцена участника"
      />
      <CalendarPickerModal
        embedded
        isVisible={datePicker !== null}
        maxDate={eventEnd}
        minDate={datePicker?.field === 'end' ? parseDateInput(selectedDateItem?.startDate ?? '') ?? eventStart : eventStart}
        onClose={() => setDatePicker(null)}
        onSelect={(value) => {
          if (datePicker) {
            if (datePicker.field === 'start') {
              const nextStart = parseDateInput(value);
              const currentEnd = parseDateInput(selectedDateItem?.endDate ?? '');
              updateItem(datePicker.itemId, { startDate: value, ...(nextStart && currentEnd && currentEnd < nextStart ? { endDate: value } : null) });
            } else {
              updateItem(datePicker.itemId, { endDate: value });
            }
          }
          setDatePicker(null);
        }}
        selectedValue={datePicker?.field === 'end' ? selectedDateItem?.endDate ?? '' : selectedDateItem?.startDate ?? ''}
        title={datePicker?.field === 'end' ? 'Дата конца выступления' : 'Дата начала выступления'}
      />
      <TimePickerModal
        embedded
        isVisible={timePicker !== null}
        maxTime={pickerMaxTime}
        minTime={pickerMinTime}
        onClose={() => setTimePicker(null)}
        onSelect={(value) => {
          if (timePicker) updateItem(timePicker.itemId, timePicker.field === 'start' ? { startTime: value } : { endTime: value });
          setTimePicker(null);
        }}
        value={timePicker?.field === 'end' ? selectedTimeItem?.endTime ?? '' : selectedTimeItem?.startTime ?? ''}
      />
    </SafeAreaView>
  </Modal>;
}

function formatScheduleTime(value: string | null) {
  if (!value) return '';
  return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}


export function EventSection({ title, events, onOpenEvent, onOpenPublicPage, onSetParticipation }: {
  title: string;
  events: ProfileEvent[];
  onOpenEvent: (eventId: string) => void;
  onOpenPublicPage: (username: string) => Promise<void>;
  onSetParticipation: (event: ProfileEvent, status: EventParticipationStatus) => void;
}) {
  if (!events.length) {
    return null;
  }

  return (
    <View style={styles.eventSection}>
      <Text style={styles.sectionTitle}>
        <Text style={styles.sectionSlash}>/ </Text>
        {title}
      </Text>

      {events.map((event) => <EventCard
        event={event}
        flushHorizontal
        key={event.id}
        onOpen={() => onOpenEvent(event.id)}
        onOpenPublicPage={onOpenPublicPage}
        onSetParticipation={(status) => onSetParticipation(event, status)}
      />)}
    </View>
  );
}

export function EventPoster({ posterUrl, style }: { posterUrl: string | null; style: object }) {
  if (posterUrl) {
    return <Image source={{ uri: posterUrl }} style={style} resizeMode="cover" />;
  }

  return (
    <View style={[style, styles.eventPosterPlaceholder]}>
      <CalendarDays color="#8e99a4" size={24} strokeWidth={1.8} />
    </View>
  );
}

function EventCounters({ goingCount, watchingCount }: { goingCount: number; watchingCount: number }) {
  return <View style={styles.eventCountersRow}>
    <Text style={styles.eventCounterText}><Text style={styles.counterNumber}>{goingCount}</Text> {russianPlural(goingCount, 'пойдёт', 'пойдут', 'пойдут')}</Text>
    <Text style={styles.eventCounterSeparator}>·</Text>
    <Text style={styles.eventCounterText}><Text style={styles.counterNumber}>{watchingCount}</Text> {russianPlural(watchingCount, 'отслеживает', 'отслеживают', 'отслеживают')}</Text>
  </View>;
}

export function formatEventMeta(cityName: string, venueName: string, tail?: string | null) {
  return [cityName, venueName].filter(Boolean).join(', ') + (tail ? ` ⊙ ${tail}` : '');
}

export function formatEventDateLabel(value: string) {
  const date = new Date(value);
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);

  if (isSameCalendarDate(date, now)) {
    return 'Сегодня';
  }

  if (isSameCalendarDate(date, tomorrow)) {
    return 'Завтра';
  }

  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(date);
}

export function formatEventVenueAddress(address?: string | null, countryName?: string | null, cityName?: string | null) {
  const repeatedLocationParts = new Set([countryName, cityName]
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim().toLocaleLowerCase('ru-RU'))
    .filter(Boolean));
  return (typeof address === 'string' ? address : '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part && !repeatedLocationParts.has(part.toLocaleLowerCase('ru-RU')))
    .join(', ');
}

export function formatEventDateRangeLabel(startsAt: string, endsAt: string) {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return formatEventDateLabel(startsAt);
  if (isSameCalendarDate(start, end)) return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(start);

  const sameMonth = start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth();
  if (sameMonth) {
    const month = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' })
      .formatToParts(end)
      .find((part) => part.type === 'month')?.value ?? '';
    return `${start.getDate()}–${end.getDate()} ${month}`.trim();
  }
  const formatter = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' });
  return `${formatter.format(start)} — ${formatter.format(end)}`;
}

function groupEventLineupByDay(lineup: EventSummary['lineup']) {
  const sorted = lineup.map((item, index) => ({ item, index })).sort((left, right) => {
    const leftTime = left.item.startsAt ? new Date(left.item.startsAt).getTime() : Number.POSITIVE_INFINITY;
    const rightTime = right.item.startsAt ? new Date(right.item.startsAt).getTime() : Number.POSITIVE_INFINITY;
    return leftTime - rightTime || left.index - right.index;
  });
  const groups = new Map<string, { dayStart: number | null; key: string; label: string; shortLabel: string; items: EventSummary['lineup'] }>();
  for (const { item } of sorted) {
    const date = item.startsAt ? new Date(item.startsAt) : null;
    const key = date && Number.isFinite(date.getTime()) ? `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}` : 'without-time';
    const dayStart = date && Number.isFinite(date.getTime())
      ? new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
      : null;
    const label = date && Number.isFinite(date.getTime())
      ? capitalizeFirst(new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }).format(date))
      : 'Без времени';
    const shortLabel = date && Number.isFinite(date.getTime())
      ? capitalizeFirst(new Intl.DateTimeFormat('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' }).format(date).replace(/\./g, ''))
      : 'Без времени';
    const group = groups.get(key) ?? { dayStart, key, label, shortLabel, items: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function capitalizeFirst(value: string) {
  return value ? value.charAt(0).toLocaleUpperCase('ru-RU') + value.slice(1) : value;
}

export function isSameCalendarDate(left: Date, right: Date) {
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
}


