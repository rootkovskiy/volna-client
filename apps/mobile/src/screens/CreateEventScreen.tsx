import { CalendarPickerModal, formatDateValue } from '../components/CalendarPickerModal';
import { ScreenTopBar } from '../components/ScreenTopBar';
import { LoadingIndicator } from '@volna/messaging-client/loading';
import { CalendarDays, Check, ChevronRight, Clock3, Link2, PanelsTopLeft, Plus, Search, Ticket, X } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { AppImage as Image } from '../components/AppImage';
import { apiFetch as fetch, apiUrl, remoteSearchDebounceMs } from '../api/client';
import { createEventArtistDraft, getAvatarInitial, getEndOfDay, parseDateInput, parseDateTimeInput } from '../domain';
import { styles } from '../styles';
import { AppSheetModal } from '../components/AppSheetModal';
import { SelectionPickerModal, type SelectionPickerOption } from '../components/SelectionPickerModal';
import { LocationPickerModal } from '../components/LocationPickerModal';
import { AvatarCropModal } from './ProfileScreens';
import { useAccountSearchSuggestions } from '../hooks/useAccountSearchSuggestions';
import type { AvatarCropAsset, CreateEventInput, CursorPage, EventArtistDraft, EventSummary, EventTypeOption, PublicPage, ToastMessage } from '../types';

type TimePickerTarget =
  | { kind: 'event'; field: 'start' | 'end' }
  | { kind: 'artist'; artistId: string; field: 'start' | 'end' };

type ArtistDatePickerTarget = { artistId: string; field: 'start' | 'end' };

function formatTimeValue(date: Date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function CreateEventScreen({
  adminMode,
  authToken,
  onBack,
  onCreate,
  onDelete,
  onNotify,
  ownAccountId,
  initialEvent,
  organizerPage,
}: {
  adminMode: boolean;
  authToken: string;
  onBack: () => void;
  onCreate: (data: CreateEventInput) => Promise<void>;
  onDelete?: () => Promise<void>;
  onNotify: (message: string, type?: ToastMessage['type']) => void;
  ownAccountId: string;
  initialEvent?: EventSummary;
  organizerPage?: PublicPage;
}) {
  const [ownedPages, setOwnedPages] = useState<PublicPage[]>([]);
  const [eventTypes, setEventTypes] = useState<EventTypeOption[]>([]);
  const [locations, setLocations] = useState<PublicPage[]>([]);
  const initialStart = initialEvent ? new Date(initialEvent.startsAt) : null;
  const initialEnd = initialEvent ? new Date(initialEvent.endsAt) : null;
  const initialHasEnd = Boolean(initialStart && initialEnd && (formatDateValue(initialStart) !== formatDateValue(initialEnd) || formatTimeValue(initialEnd) !== '23:59'));
  const [organizerPageId, setOrganizerPageId] = useState(initialEvent?.organizerPageId ?? organizerPage?.id ?? '');
  const [cityId, setCityId] = useState(initialEvent?.cityId ?? '');
  const [cityName, setCityName] = useState(initialEvent?.cityName ?? '');
  const [countryName, setCountryName] = useState(initialEvent?.countryName ?? '');
  const [title, setTitle] = useState(initialEvent?.title ?? '');
  const [type, setType] = useState(initialEvent?.type ?? '');
  const [posterLocalUri, setPosterLocalUri] = useState(initialEvent?.posterOriginalUrl ?? initialEvent?.posterUrl ?? '');
  const [posterThumbnailLocalUri, setPosterThumbnailLocalUri] = useState('');
  const [posterCropAsset, setPosterCropAsset] = useState<AvatarCropAsset | null>(null);
  const [startDate, setStartDate] = useState(initialStart ? formatDateValue(initialStart) : '');
  const [startTime, setStartTime] = useState(initialStart ? formatTimeValue(initialStart) : '');
  const [hasEndDate, setHasEndDate] = useState(initialHasEnd);
  const [endDate, setEndDate] = useState(initialEnd ? formatDateValue(initialEnd) : '');
  const [endTime, setEndTime] = useState(initialHasEnd && initialEnd ? formatTimeValue(initialEnd) : '');
  const [locationQuery, setLocationQuery] = useState(initialEvent?.venueName ?? '');
  const [venueAddress, setVenueAddress] = useState(initialEvent?.venueAddress ?? '');
  const [selectedLocation, setSelectedLocation] = useState<PublicPage | null>(null);
  const [hasLocationChanged, setHasLocationChanged] = useState(false);
  const [isLocationFocused, setIsLocationFocused] = useState(false);
  const [isLocationSearching, setIsLocationSearching] = useState(false);
  const [about, setAbout] = useState(initialEvent?.about ?? '');
  const [ticketUrl, setTicketUrl] = useState(initialEvent?.ticketUrl ?? '');
  const [admissionPrice, setAdmissionPrice] = useState(initialEvent?.admissionPrice ?? '');
  const [hasTimetable, setHasTimetable] = useState(Boolean(initialEvent?.lineup.some((item) => item.startsAt || item.endsAt)));
  const [scheduleStages, setScheduleStages] = useState<string[]>(() => initialEvent?.scheduleStages?.length
    ? initialEvent.scheduleStages
    : [...new Set(initialEvent?.lineup.map((item) => item.stageName?.trim()).filter((value): value is string => Boolean(value)) ?? [])]);
  const [artists, setArtists] = useState<EventArtistDraft[]>(() => initialEvent?.lineup.map((item) => ({
    id: item.id,
    accountUsername: item.accountUsername,
    displayName: item.displayName,
    query: item.accountUsername ? `@${item.accountUsername}` : item.displayName,
    stageName: item.stageName ?? '',
    startDate: item.startsAt ? formatDateValue(new Date(item.startsAt)) : '',
    endDate: item.endsAt ? formatDateValue(new Date(item.endsAt)) : item.startsAt ? formatDateValue(new Date(item.startsAt)) : '',
    startTime: item.startsAt ? formatTimeValue(new Date(item.startsAt)) : '',
    endTime: item.endsAt ? formatTimeValue(new Date(item.endsAt)) : '',
  })) ?? []);
  const [activeArtistId, setActiveArtistId] = useState<string | null>(null);
  const [isOrganizerPickerOpen, setIsOrganizerPickerOpen] = useState(false);
  const [isCityPickerOpen, setIsCityPickerOpen] = useState(false);
  const [isTypePickerOpen, setIsTypePickerOpen] = useState(false);
  const [timePickerTarget, setTimePickerTarget] = useState<TimePickerTarget | null>(null);
  const [datePickerArtistTarget, setDatePickerArtistTarget] = useState<ArtistDatePickerTarget | null>(null);
  const [stagePickerArtistId, setStagePickerArtistId] = useState<string | null>(null);
  const [eventDatePickerTarget, setEventDatePickerTarget] = useState<'start' | 'end' | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleteConfirmationOpen, setIsDeleteConfirmationOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const selectedOrganizer = organizerPage?.id === organizerPageId ? organizerPage : ownedPages.find((page) => page.id === organizerPageId);
  const selectedType = eventTypes.find((option) => option.value === type);
  const activeArtist = artists.find((artist) => artist.id === activeArtistId);
  const artistSearch = useAccountSearchSuggestions(
    activeArtist?.query ?? '',
    Boolean(activeArtist && !activeArtist.accountUsername),
  );
  const effectiveEndDate = hasEndDate ? endDate : startDate;
  const effectiveEndTime = hasEndDate ? endTime : '';
  const timePickerArtist = timePickerTarget?.kind === 'artist' ? artists.find((artist) => artist.id === timePickerTarget.artistId) : null;
  const datePickerArtist = datePickerArtistTarget ? artists.find((artist) => artist.id === datePickerArtistTarget.artistId) : null;
  const stagePickerArtist = artists.find((artist) => artist.id === stagePickerArtistId);
  const hasScheduleStages = scheduleStages.some((stage) => Boolean(stage.trim()));
  const timePickerDate = timePickerTarget?.kind === 'artist'
    ? timePickerTarget.field === 'start' ? timePickerArtist?.startDate ?? '' : timePickerArtist?.endDate ?? ''
    : timePickerTarget?.field === 'start' ? startDate : effectiveEndDate;
  const boundaryMinTime = timePickerDate === startDate ? (startTime || '00:00') : '00:00';
  const boundaryMaxTime = timePickerDate === effectiveEndDate ? (effectiveEndTime || '23:55') : '23:55';
  const timePickerMin = timePickerTarget?.kind === 'artist'
    && timePickerTarget.field === 'end'
    && timePickerArtist
    && timePickerArtist.startDate === timePickerArtist.endDate
    && timePickerArtist.startTime > boundaryMinTime
    ? timePickerArtist.startTime
    : boundaryMinTime;
  const timePickerMax = timePickerTarget?.kind === 'artist'
    && timePickerTarget.field === 'start'
    && timePickerArtist
    && timePickerArtist.startDate === timePickerArtist.endDate
    && timePickerArtist.endTime
    && timePickerArtist.endTime < boundaryMaxTime
    ? timePickerArtist.endTime
    : boundaryMaxTime;

  useEffect(() => {
    let isMounted = true;

    Promise.all([
      fetch(`${apiUrl}/public-pages/manageable/mine`, { headers: { Authorization: `Bearer ${authToken}`, ...(adminMode ? { 'x-volna-admin-mode': '1' } : {}) } }).then((response) => response.json() as Promise<PublicPage[]>),
      fetch(`${apiUrl}/events/types`).then((response) => response.json() as Promise<EventTypeOption[]>),
      fetch(`${apiUrl}/public-pages?pageSize=8`).then((response) => response.json() as Promise<CursorPage<PublicPage>>),
    ])
      .then(([pages, types, locationPage]) => {
        if (!isMounted) {
          return;
        }

        const nextOwnedPages = pages;
        setOwnedPages(nextOwnedPages);
        setOrganizerPageId((current) => (
          organizerPage
            ? organizerPage.id
            :
          current && nextOwnedPages.some((page) => page.id === current)
            ? current
            : !adminMode && !initialEvent
              ? nextOwnedPages[0]?.id ?? ''
              : ''
        ));
        setEventTypes(types);
        setLocations(locationPage.items);
        if (initialEvent?.venuePageId) {
          const match = locationPage.items.find((page) => page.id === initialEvent.venuePageId);
          if (match) setSelectedLocation(match);
        }
      })
      .catch(() => {
        if (isMounted) {
          onNotify('Не удалось загрузить данные для формы события', 'error');
        }
      });

    return () => {
      isMounted = false;
    };
  }, [adminMode, authToken, initialEvent?.id, initialEvent?.venuePageId, onNotify, organizerPage, ownAccountId]);

  useEffect(() => {
    if (!isLocationFocused || selectedLocation) return;

    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      setIsLocationSearching(true);
      try {
        const query = locationQuery.trim();
        const response = await fetch(`${apiUrl}/public-pages?pageSize=8${query ? `&q=${encodeURIComponent(query)}` : ''}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('Не удалось найти локации');
        const page = await response.json() as CursorPage<PublicPage>;
        setLocations(page.items);
      } catch (error) {
        if (!(error instanceof Error && error.name === 'AbortError')) setLocations([]);
      } finally {
        if (!controller.signal.aborted) setIsLocationSearching(false);
      }
    }, locationQuery.trim() ? remoteSearchDebounceMs : 0);

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [isLocationFocused, locationQuery, selectedLocation]);

  const clearLocation = () => {
    setLocationQuery('');
    setSelectedLocation(null);
    setLocations([]);
  };

  const chooseLocation = (location: PublicPage) => {
    setHasLocationChanged(true);
    setSelectedLocation(location);
    setLocationQuery(location.name);
    setVenueAddress(location.address ?? '');
    if (location.cityId) {
      setCityId(location.cityId);
      setCityName(location.cityName);
      setCountryName(location.countryName);
    }
    setIsLocationFocused(false);
  };

  const updateArtist = (artistId: string, patch: Partial<EventArtistDraft>) => {
    setArtists((currentArtists) =>
      currentArtists.map((artist) => (artist.id === artistId ? { ...artist, ...patch } : artist)),
    );
  };

  const addArtist = () => {
    setArtists((currentArtists) => [...currentArtists, {
      ...createEventArtistDraft(),
      startDate,
      endDate: effectiveEndDate || startDate,
    }]);
  };

  const updateScheduleStage = (index: number, value: string) => {
    const previous = scheduleStages[index] ?? '';
    setScheduleStages((current) => current.map((stage, stageIndex) => stageIndex === index ? value : stage));
    if (previous) {
      setArtists((current) => current.map((artist) => artist.stageName === previous ? { ...artist, stageName: value } : artist));
    }
  };

  const removeScheduleStage = (index: number) => {
    const removed = scheduleStages[index] ?? '';
    setScheduleStages((current) => current.filter((_, stageIndex) => stageIndex !== index));
    if (removed) {
      setArtists((current) => current.map((artist) => artist.stageName === removed ? { ...artist, stageName: '' } : artist));
    }
  };

  const pickPoster = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      onNotify('Нужно разрешить доступ к фотографиям, чтобы выбрать афишу', 'error');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ allowsEditing: false, base64: false, mediaTypes: ['images'], quality: 1 });
    if (!result.canceled) {
      const asset = result.assets[0];
      setPosterLocalUri(asset.uri);
      setPosterThumbnailLocalUri('');
      setPosterCropAsset({
        uri: asset.uri,
        width: asset.width || 1200,
        height: asset.height || 1600,
        mimeType: asset.mimeType || 'image/jpeg',
      });
    }
  };

  const removeArtist = (artistId: string) => {
    setArtists((currentArtists) => currentArtists.filter((artist) => artist.id !== artistId));
  };

  const submit = async () => {
    const startsAt = startTime.trim() ? parseDateTimeInput(startDate, startTime) : parseDateInput(startDate);
    const rawEndsAt = hasEndDate
      ? endTime.trim() ? parseDateTimeInput(endDate, endTime) : parseDateInput(endDate)
      : parseDateInput(startDate);
    const endsAt = rawEndsAt && (!hasEndDate || !endTime.trim()) ? getEndOfDay(rawEndsAt) : rawEndsAt;
    const normalizedArtists = artists
      .map((artist) => ({
        ...artist,
        displayName: (artist.displayName || artist.query).trim(),
      }))
      .filter((artist) => artist.displayName.length > 0);

    if (!organizerPageId && !adminMode) {
      onNotify('Выберите сообщество-организатор', 'error');
      return;
    }

    if (!cityId) {
      onNotify('Выберите город события', 'error');
      return;
    }

    if (title.trim().length < 2) {
      onNotify('Укажите название события минимум из 2 символов', 'error');
      return;
    }

    if (!type) {
      onNotify('Выберите тип события', 'error');
      return;
    }

    if (!posterLocalUri) {
      onNotify('Добавьте афишу события', 'error');
      return;
    }

    if (!startDate.trim() || (hasEndDate && !endDate.trim())) {
      onNotify(hasEndDate ? 'Укажите даты начала и конца события' : 'Укажите дату начала события', 'error');
      return;
    }

    if (locationQuery.trim().length < 2) { onNotify('Укажите локацию минимум из 2 символов', 'error'); return; }

    if (!startsAt || !endsAt || startsAt >= endsAt) {
      onNotify('Укажите корректные даты и время события', 'error');
      return;
    }

    const normalizedScheduleStages = scheduleStages.map((stage) => stage.trim()).filter(Boolean);
    if (new Set(normalizedScheduleStages.map((stage) => stage.toLocaleLowerCase('ru-RU'))).size !== normalizedScheduleStages.length) {
      onNotify('Названия сцен не должны повторяться', 'error');
      return;
    }

    const lineup: CreateEventInput['lineup'] = [];

    for (const artist of normalizedArtists) {
      const artistStartDate = hasEndDate ? artist.startDate : startDate;
      const artistEndDate = hasEndDate ? artist.endDate : startDate;
      let artistStartsAt: Date | null = null;
      let artistEndsAt: Date | null = null;

      if (hasTimetable) {
        if (hasEndDate && (!artist.startDate.trim() || !artist.endDate.trim())) {
          onNotify(`Укажите даты начала и конца выступления: ${artist.displayName}`, 'error');
          return;
        }

        if (!artist.startTime.trim() || !artist.endTime.trim()) {
          onNotify(`Укажите время начала и конца выступления: ${artist.displayName}`, 'error');
          return;
        }

        artistStartsAt = parseDateTimeInput(artistStartDate, artist.startTime);
        artistEndsAt = parseDateTimeInput(artistEndDate, artist.endTime);

        if (!artistStartsAt || !artistEndsAt || artistStartsAt >= artistEndsAt) {
          onNotify(`Проверьте дату и время выступления: ${artist.displayName}`, 'error');
          return;
        }

        if (artistStartsAt < startsAt || artistEndsAt > endsAt) {
          onNotify(`Выступление ${artist.displayName} должно быть внутри времени события`, 'error');
          return;
        }

      }

      if (normalizedScheduleStages.length && artist.stageName && !normalizedScheduleStages.includes(artist.stageName.trim())) {
        onNotify(`Выберите сцену из редактора сцен: ${artist.displayName}`, 'error');
        return;
      }

      lineup.push({
        accountUsername: artist.accountUsername || undefined,
        displayName: artist.displayName,
        stageName: normalizedScheduleStages.length ? artist.stageName.trim() || undefined : undefined,
        startsAt: artistStartsAt?.toISOString(),
        endsAt: artistEndsAt?.toISOString(),
      });
    }

    setIsSaving(true);

    try {
      await onCreate({
        posterLocalUri,
        posterThumbnailLocalUri: posterThumbnailLocalUri || undefined,
        organizerPageId: organizerPageId || undefined,
        cityId,
        venuePageId: selectedLocation?.id ?? (!hasLocationChanged ? initialEvent?.venuePageId ?? undefined : undefined),
        venueName: selectedLocation?.name || locationQuery.trim(),
        venueAddress: selectedLocation?.address?.trim() || venueAddress.trim(),
        title: title.trim(),
        type,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        about: about.trim() || undefined,
        ticketUrl: ticketUrl.trim() || undefined,
        admissionPrice: admissionPrice.trim() || undefined,
        hasTimetable,
        scheduleStages: normalizedScheduleStages,
        lineup,
      });
    } catch (error) {
      onNotify(error instanceof Error ? error.message : initialEvent ? 'Не удалось сохранить событие' : 'Не удалось создать событие', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <ScreenTopBar onBack={onBack} title={initialEvent ? 'Редактировать событие' : 'Создать событие'} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.editShell}>
        <ScrollView
          contentContainerStyle={[styles.editContent, styles.createCommunityContent, styles.createEventContent]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {organizerPage && selectedOrganizer ? <View style={[styles.communityCategorySelectionBlock, styles.eventFormSurface]}>
            <Text style={styles.communityCategorySelectionTitle}>Организатор</Text>
            <View style={styles.eventOrganizerInfoRow}>
              {selectedOrganizer.avatarUrl ? (
                <Image source={{ uri: selectedOrganizer.avatarUrl }} style={styles.eventOrganizerAvatar} resizeMode="cover" />
              ) : (
                <View style={styles.eventOrganizerAvatar}>
                  <Text style={styles.eventOrganizerAvatarText}>{getAvatarInitial(selectedOrganizer.name)}</Text>
                </View>
              )}
              <Text numberOfLines={1} style={styles.eventOrganizerInfoName}>{selectedOrganizer.name}</Text>
            </View>
          </View> : <Pressable disabled={Boolean(initialEvent)} onPress={() => setIsOrganizerPickerOpen(true)} style={[styles.editSelectInput, styles.eventFormSurface]}>
            <Text numberOfLines={1} style={[styles.editSelectText, !selectedOrganizer && styles.editSelectPlaceholder]}>
              {selectedOrganizer?.name || (adminMode ? 'Без организатора' : 'Сообщество-организатор')}
            </Text>
            {!initialEvent ? <Text style={styles.editSelectChevron}>›</Text> : null}
          </Pressable>}

          <TextInput
            onChangeText={setTitle}
            placeholder="Название события"
            placeholderTextColor="#98a3ae"
            style={[styles.editInputSpacing, styles.eventFormSurface, styles.eventFormSpacing]}
            value={title}
          />

          <Pressable onPress={() => setIsTypePickerOpen(true)} style={[styles.editSelectInput, styles.editInputSpacing, styles.eventFormSurface, styles.eventFormSpacing]}>
            <Text numberOfLines={1} style={[styles.editSelectText, !selectedType && styles.editSelectPlaceholder]}>
              {selectedType?.label || 'Тип события'}
            </Text>
            <Text style={styles.editSelectChevron}>›</Text>
          </Pressable>

          <Pressable accessibilityLabel="Выбрать город события" accessibilityRole="button" onPress={() => setIsCityPickerOpen(true)} style={[styles.editSelectInput, styles.editInputSpacing, styles.eventFormSurface, styles.eventFormSpacing]}>
            <Text numberOfLines={1} style={[styles.editSelectText, !cityId && styles.editSelectPlaceholder]}>
              {cityName ? `${countryName}, ${cityName}` : 'Город события'}
            </Text>
            <Text style={styles.editSelectChevron}>›</Text>
          </Pressable>

          <View style={styles.eventPosterCard}>
            <View style={styles.eventPosterHeader}>
              <View style={styles.eventPosterHeaderCopy}>
                <Text style={styles.eventPosterTitle}>Афиша</Text>
                <Text style={styles.eventPosterHint}>В карточках показывается в формате 1:1,414</Text>
              </View>
              {posterLocalUri ? (
                <Pressable accessibilityLabel="Удалить афишу" accessibilityRole="button" onPress={() => { setPosterLocalUri(''); setPosterThumbnailLocalUri(''); setPosterCropAsset(null); }} style={styles.eventPosterRemoveButton}>
                  <X color="#111" size={19} strokeWidth={1.8} />
                </Pressable>
              ) : null}
            </View>
            <Pressable accessibilityLabel={posterLocalUri ? 'Изменить афишу' : 'Добавить афишу'} accessibilityRole="button" onPress={() => void pickPoster()} style={styles.eventPosterPicker}>
              {posterLocalUri ? (
                <Image resizeMode="cover" source={{ uri: posterThumbnailLocalUri || posterLocalUri }} style={styles.eventPosterPreview} />
              ) : (
                <View style={styles.eventPosterPickerPlaceholder}>
                  <View style={styles.eventPosterPlusCircle}><Plus color="#111" size={24} strokeWidth={1.8} /></View>
                  <Text style={styles.eventPosterPlaceholderText}>Добавить афишу</Text>
                </View>
              )}
            </Pressable>
          </View>

          <View style={styles.eventLocationCard}>
            <Text style={styles.eventLocationTitle}>Локация</Text>
            <View style={styles.eventLocationSearchField}>
              <Search color="#6f7b86" size={20} strokeWidth={1.8} />
              <TextInput
                accessibilityLabel="Локация события"
                maxLength={120}
                onBlur={() => setTimeout(() => setIsLocationFocused(false), 120)}
                onChangeText={(value) => {
                  setHasLocationChanged(true);
                  setLocationQuery(value);
                  if (selectedLocation && value !== selectedLocation.name) setSelectedLocation(null);
                }}
                onFocus={() => setIsLocationFocused(true)}
                placeholder="Введите название локации"
                placeholderTextColor="#98a3ae"
                style={styles.eventLocationSearchInput}
                value={locationQuery}
              />
              {isLocationSearching ? <LoadingIndicator size="small" /> : null}
              {locationQuery ? (
                <Pressable accessibilityLabel="Очистить локацию" accessibilityRole="button" hitSlop={8} onPress={() => { setHasLocationChanged(true); clearLocation(); }} style={styles.eventLocationClearButton}>
                  <X color="#111" size={19} strokeWidth={1.8} />
                </Pressable>
              ) : null}
            </View>
            {isLocationFocused && !selectedLocation && locations.length ? (
              <View style={styles.eventLocationSuggestions}>
                {locations.map((location, index) => (
                  <Pressable
                    key={location.id}
                    onPress={() => chooseLocation(location)}
                    style={[styles.eventLocationSuggestion, index > 0 && styles.eventLocationSuggestionBorder]}
                  >
                    <View style={styles.eventLocationSuggestionAvatar}>
                      {location.avatarUrl ? <Image source={{ uri: location.avatarUrl }} style={styles.eventLocationSuggestionAvatarImage} /> : <Text style={styles.eventLocationSuggestionAvatarText}>{getAvatarInitial(location.name)}</Text>}
                    </View>
                    <View style={styles.eventLocationSuggestionCopy}>
                      <Text numberOfLines={1} style={styles.eventLocationSuggestionName}>{location.name}</Text>
                      <Text numberOfLines={1} style={styles.eventLocationSuggestionMeta}>{[location.cityName, location.address].filter(Boolean).join(' · ') || `@${location.username}`}</Text>
                    </View>
                  </Pressable>
                ))}
              </View>
            ) : null}
            {isLocationFocused && !isLocationSearching && !selectedLocation && locationQuery.trim().length >= 2 && !locations.length ? (
              <Text style={styles.eventLocationFreeTextHint}>Совпадений нет — оставим «{locationQuery.trim()}» как локацию.</Text>
            ) : null}
            {!selectedLocation ? <TextInput
              accessibilityLabel="Адрес или ориентир"
              maxLength={240}
              onChangeText={setVenueAddress}
              placeholder="Адрес или ориентир (необязательно)"
              placeholderTextColor="#98a3ae"
              style={[styles.editInputSpacing, styles.eventFormSurface, styles.eventFormSpacing]}
              value={venueAddress}
            /> : null}
          </View>

          <View style={[styles.editLocationRow, styles.eventDateRow]}>
            <Pressable accessibilityLabel="Выбрать дату начала" accessibilityRole="button" onPress={() => setEventDatePickerTarget('start')} style={[styles.editInput, styles.editLocationField, styles.eventDateInput, styles.eventFormSurface]}><CalendarDays color="#6f7b86" size={19} strokeWidth={1.9} /><Text style={[styles.eventDateButtonText, !startDate && styles.editSelectPlaceholder]}>{startDate || 'Дата начала'}</Text></Pressable>
            <Pressable accessibilityLabel="Выбрать время начала" onPress={() => setTimePickerTarget({ kind: 'event', field: 'start' })} style={[styles.editInput, styles.eventTimeField, styles.eventTimeButton, styles.eventFormSurface]}><Clock3 color="#6f7b86" size={18} /><Text style={[styles.eventTimeButtonText, !startTime && styles.editSelectPlaceholder]}>{startTime || 'Время'}</Text></Pressable>
          </View>
          <Pressable
            accessibilityLabel="Указать дату окончания события"
            accessibilityRole="checkbox"
            accessibilityState={{ checked: hasEndDate }}
            onPress={() => {
              setHasEndDate((current) => {
                if (current) {
                  setEndDate('');
                  setEndTime('');
                }
                return !current;
              });
            }}
            style={styles.eventEndDateToggle}
          >
            <View style={[styles.eventEndDateCheckbox, hasEndDate && styles.eventEndDateCheckboxActive]}>
              {hasEndDate ? <Check color="#fff" size={15} strokeWidth={2.4} /> : null}
            </View>
            <Text style={styles.eventEndDateToggleText}>Указать дату окончания события</Text>
          </Pressable>
          {hasEndDate ? (
            <View style={[styles.editLocationRow, styles.eventDateRow]}>
              <Pressable accessibilityLabel="Выбрать дату окончания" accessibilityRole="button" onPress={() => setEventDatePickerTarget('end')} style={[styles.editInput, styles.editLocationField, styles.eventDateInput, styles.eventFormSurface]}><CalendarDays color="#6f7b86" size={19} strokeWidth={1.9} /><Text style={[styles.eventDateButtonText, !endDate && styles.editSelectPlaceholder]}>{endDate || 'Дата конца'}</Text></Pressable>
              <Pressable accessibilityLabel="Выбрать время окончания" onPress={() => setTimePickerTarget({ kind: 'event', field: 'end' })} style={[styles.editInput, styles.eventTimeField, styles.eventTimeButton, styles.eventFormSurface]}><Clock3 color="#6f7b86" size={18} /><Text style={[styles.eventTimeButtonText, !endTime && styles.editSelectPlaceholder]}>{endTime || 'Время'}</Text></Pressable>
            </View>
          ) : null}
          <Text style={[styles.editHelperText, styles.eventDateHelper]}>Формат дат: ДД.ММ.ГГГГ. Время можно не указывать.</Text>

          <TextInput
            multiline
            onChangeText={setAbout}
            placeholder="Описание"
            placeholderTextColor="#98a3ae"
            style={[styles.editInput, styles.editTextArea, styles.eventFormSurface, styles.eventDescriptionInput]}
            textAlignVertical="top"
            value={about}
          />

          <Text style={[styles.editSectionTitle, styles.eventTicketSectionTitle]}>Билеты</Text>
          <View style={styles.eventTicketFields}>
            <View style={[styles.eventTicketInputRow, styles.eventFormSurface]}>
              <Link2 color="#6f7b86" size={19} strokeWidth={1.9} />
              <TextInput
                accessibilityLabel="Ссылка на покупку билета"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                maxLength={500}
                onChangeText={setTicketUrl}
                placeholder="Ссылка на покупку билета"
                placeholderTextColor="#98a3ae"
                style={styles.eventTicketInput}
                value={ticketUrl}
              />
            </View>
            <View style={[styles.eventTicketInputRow, styles.eventFormSurface]}>
              <Ticket color="#6f7b86" size={19} strokeWidth={1.9} />
              <TextInput
                accessibilityLabel="Цена входа"
                maxLength={80}
                onChangeText={setAdmissionPrice}
                placeholder="Цена входа, например 1 500 ₽"
                placeholderTextColor="#98a3ae"
                style={styles.eventTicketInput}
                value={admissionPrice}
              />
            </View>
          </View>

          <Text style={[styles.editSectionTitle, styles.eventParticipantsTitle]}>Участники</Text>
          <View style={styles.eventStageEditor}>
            <View style={styles.eventStageEditorHeader}>
              <View style={styles.eventStageEditorCopy}>
                <Text style={styles.eventStageEditorTitle}>Сцены</Text>
                <Text style={styles.eventStageEditorHint}>Добавьте сцены, затем назначьте их участникам.</Text>
              </View>
            </View>
            {scheduleStages.map((stage, stageIndex) => (
              <View key={`stage-${stageIndex}`} style={styles.eventStageEditorRow}>
                <PanelsTopLeft color="#6f7b86" size={18} strokeWidth={1.9} />
                <TextInput
                  maxLength={80}
                  onChangeText={(value) => updateScheduleStage(stageIndex, value)}
                  placeholder="Название сцены"
                  placeholderTextColor="#98a3ae"
                  style={styles.eventStageEditorInput}
                  value={stage}
                />
                <Pressable accessibilityLabel="Удалить сцену" hitSlop={6} onPress={() => removeScheduleStage(stageIndex)} style={styles.eventStageEditorRemove}>
                  <X color="#6f7b86" size={19} strokeWidth={1.8} />
                </Pressable>
              </View>
            ))}
            <Pressable onPress={() => setScheduleStages((current) => [...current, ''])} style={styles.eventStageEditorAdd}>
              <Plus color="#111" size={18} strokeWidth={2} />
              <Text style={styles.eventStageEditorAddText}>Добавить сцену</Text>
            </Pressable>
          </View>

          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: hasTimetable }}
            onPress={() => {
              setHasTimetable((current) => !current);
              if (hasTimetable) {
                setDatePickerArtistTarget(null);
                setTimePickerTarget((current) => current?.kind === 'artist' ? null : current);
              }
            }}
            style={styles.eventPerformanceTimeToggle}
          >
            <View style={[styles.eventPerformanceTimeCheckbox, hasTimetable && styles.eventPerformanceTimeCheckboxActive]}>
              {hasTimetable ? <Check color="#fff" size={15} strokeWidth={2.5} /> : null}
            </View>
            <View style={styles.eventPerformanceTimeCopy}>
              <Text style={styles.eventPerformanceTimeTitle}>Указать время выступлений</Text>
              <Text style={styles.eventPerformanceTimeHint}>Начало и конец станут обязательными для каждого участника.</Text>
            </View>
          </Pressable>

          {artists.map((artist) => {
            const isActiveArtist = activeArtistId === artist.id;

            return (
              <View key={artist.id} style={styles.eventArtistCard}>
                <View style={styles.eventArtistInputWrap}>
                  <TextInput
                    autoCapitalize="none"
                    autoCorrect={false}
                    onChangeText={(value) =>
                      updateArtist(artist.id, {
                        query: value,
                        displayName: value,
                        accountUsername: null,
                      })
                    }
                    onFocus={() => setActiveArtistId(artist.id)}
                    placeholder="@username или имя"
                    placeholderTextColor="#98a3ae"
                    style={[styles.publicPageTeamInput, styles.eventArtistInputWithRemove, styles.eventFormSurface]}
                    value={artist.query}
                  />
                  <Pressable
                    accessibilityLabel="Удалить участника"
                    accessibilityRole="button"
                    hitSlop={6}
                    onPress={() => removeArtist(artist.id)}
                    style={styles.eventArtistRemoveButton}
                  >
                    <X color="#6f7b86" size={20} strokeWidth={1.8} />
                  </Pressable>
                </View>
                {isActiveArtist && artistSearch.queryLength > 0 && artistSearch.queryLength < 3 ? (
                  <Text style={styles.communityAudioParticipantSearchHint}>Поиск начнётся после ввода 3 символов</Text>
                ) : null}
                {isActiveArtist && artistSearch.isSearching ? (
                  <View style={styles.communityAudioParticipantSearchStatus}>
                    <LoadingIndicator size="small" />
                    <Text style={styles.communityAudioParticipantSearchStatusText}>Ищем профили…</Text>
                  </View>
                ) : null}
                {isActiveArtist && artistSearch.suggestions.length ? (
                  <View style={styles.entityUsernameSuggestions}>
                    {artistSearch.suggestions.map((suggestion) => (
                      <Pressable
                        accessibilityRole="button"
                        key={suggestion.id}
                        onPress={() => {
                          updateArtist(artist.id, {
                            accountUsername: suggestion.username,
                            displayName: suggestion.name,
                            query: `@${suggestion.username}`,
                          });
                          setActiveArtistId(null);
                        }}
                        style={styles.entityUsernameSuggestionRow}
                      >
                        {suggestion.avatarUrl ? (
                          <Image source={{ uri: suggestion.avatarUrl }} style={styles.entityUsernameSuggestionAvatar} />
                        ) : (
                          <View style={styles.entityUsernameSuggestionAvatar}>
                            <Text style={styles.entityUsernameSuggestionAvatarText}>{getAvatarInitial(suggestion.name)}</Text>
                          </View>
                        )}
                        <View style={styles.publicPageTeamCopy}>
                          <Text numberOfLines={1} style={styles.publicPageTeamName}>{suggestion.name}</Text>
                          <Text numberOfLines={1} style={styles.publicPageTeamUsername}>@{suggestion.username} · Профиль</Text>
                        </View>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
                {hasScheduleStages ? (
                  <Pressable accessibilityLabel="Выбрать сцену участника" onPress={() => setStagePickerArtistId(artist.id)} style={[styles.publicPageTeamInput, styles.eventArtistStageButton, styles.eventFormSurface]}>
                    <PanelsTopLeft color="#6f7b86" size={18} strokeWidth={1.9} />
                    <Text numberOfLines={1} style={[styles.eventArtistDateText, !artist.stageName && styles.editSelectPlaceholder]}>{artist.stageName || 'Выбрать сцену'}</Text>
                    <ChevronRight color="#8e99a4" size={19} strokeWidth={1.8} />
                  </Pressable>
                ) : null}
                {hasTimetable ? (
                  <>
                    <View style={styles.eventArtistDateTimeRow}>
                      <Text style={styles.eventArtistDateTimeLabel}>Начало</Text>
                      <Pressable accessibilityLabel="Выбрать дату начала выступления" onPress={() => setDatePickerArtistTarget({ artistId: artist.id, field: 'start' })} style={[styles.publicPageTeamInput, styles.eventArtistDateButton, styles.eventFormSurface]}><CalendarDays color="#6f7b86" size={18} strokeWidth={1.9} /><Text style={[styles.eventArtistDateText, !artist.startDate && styles.editSelectPlaceholder]}>{artist.startDate || 'Дата'}</Text></Pressable>
                      <Pressable accessibilityLabel="Выбрать время начала участника" onPress={() => { if (!artist.startDate) { onNotify('Сначала выберите дату начала выступления', 'error'); return; } setTimePickerTarget({ kind: 'artist', artistId: artist.id, field: 'start' }); }} style={[styles.publicPageTeamInput, styles.eventArtistTimeButton, styles.eventFormSurface]}><Clock3 color="#6f7b86" size={18} /><Text style={[styles.eventTimeButtonText, !artist.startTime && styles.editSelectPlaceholder]}>{artist.startTime || 'Время'}</Text></Pressable>
                    </View>
                    <View style={styles.eventArtistDateTimeRow}>
                      <Text style={styles.eventArtistDateTimeLabel}>Конец</Text>
                      <Pressable accessibilityLabel="Выбрать дату конца выступления" onPress={() => setDatePickerArtistTarget({ artistId: artist.id, field: 'end' })} style={[styles.publicPageTeamInput, styles.eventArtistDateButton, styles.eventFormSurface]}><CalendarDays color="#6f7b86" size={18} strokeWidth={1.9} /><Text style={[styles.eventArtistDateText, !artist.endDate && styles.editSelectPlaceholder]}>{artist.endDate || 'Дата'}</Text></Pressable>
                      <Pressable accessibilityLabel="Выбрать время окончания участника" onPress={() => { if (!artist.endDate) { onNotify('Сначала выберите дату конца выступления', 'error'); return; } setTimePickerTarget({ kind: 'artist', artistId: artist.id, field: 'end' }); }} style={[styles.publicPageTeamInput, styles.eventArtistTimeButton, styles.eventFormSurface]}><Clock3 color="#6f7b86" size={18} /><Text style={[styles.eventTimeButtonText, !artist.endTime && styles.editSelectPlaceholder]}>{artist.endTime || 'Время'}</Text></Pressable>
                    </View>
                  </>
                ) : null}
              </View>
            );
          })}
          <Pressable onPress={addArtist} style={styles.eventAddArtistButton}>
            <Plus color="#111" size={18} strokeWidth={2} />
            <Text style={styles.eventAddArtistText}>Добавить участника</Text>
          </Pressable>
          <Pressable disabled={isSaving} onPress={submit} style={[styles.saveProfileButton, isSaving && styles.disabledButton]}>
            {isSaving ? <LoadingIndicator tone="inverse" /> : <Text style={styles.saveProfileText}>{initialEvent ? 'Сохранить' : 'Создать'}</Text>}
          </Pressable>
          {initialEvent && onDelete ? (
            <View style={styles.communityAudioEditorDeleteSection}>
              <Pressable
                accessibilityRole="button"
                onPress={() => setIsDeleteConfirmationOpen(true)}
                style={styles.communityAudioEditorDelete}
              >
                <Text style={styles.communityAudioEditorDeleteText}>Удалить событие</Text>
              </Pressable>
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>

      <AvatarCropModal
        asset={posterCropAsset}
        cropShape="poster"
        label="афишу события"
        onApply={setPosterThumbnailLocalUri}
        onClose={() => setPosterCropAsset(null)}
      />
      <AppSheetModal
        footer={(
          <View style={styles.eventFilterActions}>
            <Pressable disabled={isDeleting} onPress={() => setIsDeleteConfirmationOpen(false)} style={styles.eventFilterReset}>
              <Text style={styles.eventFilterResetText}>Отмена</Text>
            </Pressable>
            <Pressable
              disabled={isDeleting}
              onPress={() => {
                if (!onDelete) return;
                setIsDeleting(true);
                void onDelete()
                  .catch((error) => {
                    onNotify(error instanceof Error ? error.message : 'Не удалось удалить событие', 'error');
                  })
                  .finally(() => setIsDeleting(false));
              }}
              style={[styles.eventFilterApply, isDeleting && styles.disabledButton]}
            >
              {isDeleting ? <LoadingIndicator tone="inverse" /> : <Text style={styles.eventFilterApplyText}>Удалить</Text>}
            </Pressable>
          </View>
        )}
        isVisible={isDeleteConfirmationOpen}
        onClose={() => { if (!isDeleting) setIsDeleteConfirmationOpen(false); }}
        subtitle="Событие и связанные с ним данные будут удалены без возможности восстановления."
        title="Удалить событие?"
      >
        <View />
      </AppSheetModal>

      <SimpleOptionPickerModal
        isVisible={isOrganizerPickerOpen}
        onClose={() => setIsOrganizerPickerOpen(false)}
        onSelect={(value) => {
          setOrganizerPageId(value);
          setIsOrganizerPickerOpen(false);
        }}
        options={[
          ...(adminMode ? [{ label: 'Без организатора', meta: 'Информационное событие', value: '' }] : []),
          ...ownedPages.map((page) => ({ label: page.name, meta: `@${page.username}`, value: page.id })),
        ]}
        selectedValue={organizerPageId}
        title="Сообщество"
      />
      <LocationPickerModal
        initialCountryName={countryName}
        isVisible={isCityPickerOpen}
        onClose={() => setIsCityPickerOpen(false)}
        onSelect={(location) => {
          if (location.kind !== 'city') {
            onNotify('Для события нужно выбрать конкретный город', 'error');
            return;
          }
          setCityId(location.cityId);
          setCityName(location.cityName);
          setCountryName(location.countryName);
        }}
      />
      <CalendarPickerModal
        isVisible={datePickerArtistTarget !== null}
        maxDate={parseDateInput(effectiveEndDate) ?? parseDateInput(startDate) ?? new Date()}
        minDate={datePickerArtistTarget?.field === 'end'
          ? parseDateInput(datePickerArtist?.startDate ?? '') ?? parseDateInput(startDate) ?? new Date()
          : parseDateInput(startDate) ?? new Date()}
        onClose={() => setDatePickerArtistTarget(null)}
        onSelect={(value) => {
          if (datePickerArtistTarget) {
            if (datePickerArtistTarget.field === 'start') {
              const currentEnd = parseDateInput(datePickerArtist?.endDate ?? '');
              const nextStart = parseDateInput(value);
              updateArtist(datePickerArtistTarget.artistId, {
                startDate: value,
                ...(nextStart && currentEnd && currentEnd < nextStart ? { endDate: value } : null),
              });
            } else {
              updateArtist(datePickerArtistTarget.artistId, { endDate: value });
            }
          }
          setDatePickerArtistTarget(null);
        }}
        selectedValue={datePickerArtistTarget?.field === 'end' ? datePickerArtist?.endDate ?? '' : datePickerArtist?.startDate ?? ''}
        title={datePickerArtistTarget?.field === 'end' ? 'Дата конца выступления' : 'Дата начала выступления'}
      />
      <SelectionPickerModal
        emptyText="Сначала добавьте сцену в редакторе"
        isVisible={stagePickerArtistId !== null && hasScheduleStages}
        onClose={() => setStagePickerArtistId(null)}
        options={[
          { key: 'none', muted: true, onPress: () => { if (stagePickerArtistId) updateArtist(stagePickerArtistId, { stageName: '' }); setStagePickerArtistId(null); }, selected: !stagePickerArtist?.stageName, title: 'Без сцены' },
          ...scheduleStages.map((stage) => stage.trim()).filter(Boolean).map((stage) => ({
            key: stage,
            onPress: () => { if (stagePickerArtistId) updateArtist(stagePickerArtistId, { stageName: stage }); setStagePickerArtistId(null); },
            selected: stagePickerArtist?.stageName === stage,
            title: stage,
          })),
        ]}
        title="Сцена участника"
      />
      <CalendarPickerModal
        isVisible={eventDatePickerTarget !== null}
        minDate={eventDatePickerTarget === 'end' ? parseDateInput(startDate) ?? new Date() : new Date()}
        onClose={() => setEventDatePickerTarget(null)}
        onSelect={(value) => {
          if (eventDatePickerTarget === 'start') {
            setStartDate(value);
            const nextStart = parseDateInput(value);
            const currentEnd = parseDateInput(endDate);
            if (nextStart && currentEnd && currentEnd < nextStart) { setEndDate(''); setEndTime(''); }
          } else if (eventDatePickerTarget === 'end') setEndDate(value);
          setEventDatePickerTarget(null);
        }}
        selectedValue={eventDatePickerTarget === 'end' ? endDate : startDate}
        title={eventDatePickerTarget === 'end' ? 'Дата окончания' : 'Дата начала'}
      />
      <TimePickerModal
        isVisible={timePickerTarget !== null}
        maxTime={timePickerTarget?.kind === 'artist' ? timePickerMax : undefined}
        minTime={timePickerTarget?.kind === 'artist' ? timePickerMin : undefined}
        onClose={() => setTimePickerTarget(null)}
        onSelect={(value) => {
          if (timePickerTarget?.kind === 'event') {
            if (timePickerTarget.field === 'start') setStartTime(value); else setEndTime(value);
          } else if (timePickerTarget?.kind === 'artist') {
            updateArtist(timePickerTarget.artistId, timePickerTarget.field === 'start' ? { startTime: value } : { endTime: value });
          }
          setTimePickerTarget(null);
        }}
        value={timePickerTarget?.kind === 'event' ? (timePickerTarget.field === 'start' ? startTime : endTime) : timePickerTarget?.field === 'start' ? timePickerArtist?.startTime ?? '' : timePickerArtist?.endTime ?? ''}
      />
      <SimpleOptionPickerModal
        isVisible={isTypePickerOpen}
        onClose={() => setIsTypePickerOpen(false)}
        onSelect={(value) => {
          setType(value);
          setIsTypePickerOpen(false);
        }}
        options={eventTypes.map((eventType) => ({ label: eventType.label, value: eventType.value }))}
        selectedValue={type}
        title="Тип события"
      />
    </>
  );
}

export function TimePickerModal({ embedded = false, isVisible, maxTime = '23:55', minTime = '00:00', onClose, onSelect, value }: { embedded?: boolean; isVisible: boolean; maxTime?: string; minTime?: string; onClose: () => void; onSelect: (value: string) => void; value: string }) {
  const [selectedHour, setSelectedHour] = useState('00');
  const [selectedMinute, setSelectedMinute] = useState('00');
  const toMinutes = (time: string) => { const [hour = '0', minute = '0'] = time.split(':'); return Number(hour) * 60 + Number(minute); };
  const minMinutes = toMinutes(minTime);
  const maxMinutes = toMinutes(maxTime);
  const hours = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, '0')).filter((hour) => Number(hour) * 60 + 55 >= minMinutes && Number(hour) * 60 <= maxMinutes);
  const minutes = Array.from({ length: 12 }, (_, index) => String(index * 5).padStart(2, '0')).filter((minute) => { const candidate = Number(selectedHour) * 60 + Number(minute); return candidate >= minMinutes && candidate <= maxMinutes; });
  useEffect(() => {
    if (!isVisible) return;
    const requested = /^(\d{2}):(\d{2})$/.test(value) ? toMinutes(value) : minMinutes;
    const bounded = Math.min(maxMinutes, Math.max(minMinutes, requested));
    setSelectedHour(String(Math.floor(bounded / 60)).padStart(2, '0'));
    setSelectedMinute(String(Math.floor((bounded % 60) / 5) * 5).padStart(2, '0'));
  }, [isVisible, maxTime, minTime, value]);
  useEffect(() => { if (minutes.length && !minutes.includes(selectedMinute)) setSelectedMinute(minutes[0]); }, [minutes.join(','), selectedMinute]);
  return <AppSheetModal
    contentContainerStyle={styles.timePickerContent}
    embedded={embedded}
    footer={<View style={styles.timePickerActions}><Pressable onPress={() => onSelect('')} style={styles.adminSecondaryButton}><Text style={styles.timePickerClearText}>Не указывать</Text></Pressable><Pressable onPress={() => onSelect(`${selectedHour}:${selectedMinute}`)} style={styles.adminPrimaryButton}><Text style={styles.adminPrimaryButtonText}>Выбрать</Text></Pressable></View>}
    isVisible={isVisible}
    onClose={onClose}
    title="Выберите время"
  >
    <View style={styles.timePickerColumns}><View style={styles.timePickerColumn}><Text style={styles.timePickerLabel}>Часы</Text><ScrollView showsVerticalScrollIndicator={false}>{hours.map((hour) => <Pressable key={hour} onPress={() => setSelectedHour(hour)} style={[styles.timePickerOption, selectedHour === hour && styles.timePickerOptionActive]}><Text style={[styles.timePickerOptionText, selectedHour === hour && styles.timePickerOptionTextActive]}>{hour}</Text></Pressable>)}</ScrollView></View><Text style={styles.timePickerColon}>:</Text><View style={styles.timePickerColumn}><Text style={styles.timePickerLabel}>Минуты</Text><ScrollView showsVerticalScrollIndicator={false}>{minutes.map((minute) => <Pressable key={minute} onPress={() => setSelectedMinute(minute)} style={[styles.timePickerOption, selectedMinute === minute && styles.timePickerOptionActive]}><Text style={[styles.timePickerOptionText, selectedMinute === minute && styles.timePickerOptionTextActive]}>{minute}</Text></Pressable>)}</ScrollView></View></View>
  </AppSheetModal>;
}

function SimpleOptionPickerModal({
  isVisible,
  onClose,
  onSelect,
  options,
  selectedValue,
  title,
}: {
  isVisible: boolean;
  onClose: () => void;
  onSelect: (value: string) => void;
  options: Array<{ label: string; meta?: string; value: string }>;
  selectedValue: string;
  title: string;
}) {
  const pickerOptions: SelectionPickerOption[] = options.map((option) => ({
    key: option.value,
    title: option.label,
    meta: option.meta,
    selected: option.value === selectedValue,
    onPress: () => onSelect(option.value),
  }));

  return (
    <SelectionPickerModal
      isVisible={isVisible}
      onClose={onClose}
      options={pickerOptions}
      title={title}
    />
  );
}

