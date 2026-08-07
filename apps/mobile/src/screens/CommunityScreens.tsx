import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, Disc3, EllipsisVertical, Globe2, Handshake, Heart, Images, Info, List, MapPin, Pause, Pencil, Phone, Play, Plus, Radio, Save, Search, Settings, Share2, ShoppingBag, SlidersHorizontal, TriangleAlert, UserRound, UsersRound, X } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { createElement, type Dispatch, type ReactNode, type SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Easing, KeyboardAvoidingView, LayoutAnimation, Modal, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { ScreenTopBar } from '../components/navigation';
import { AppAnimatedImage, AppImage as Image } from '../components/AppImage';
import { VolnaSwitch } from '../components/VolnaSwitch';
import { PostFeed, usePostAvailability } from '../components/PostFeed';
import { FollowListModal, MutualFollowersSummary } from '../components/FollowListModal';
import { MentionText } from '../components/MentionText';
import { LocationPickerModal } from '../components/LocationPickerModal';
import { CountryPickerModal, SelectionPickerModal, type SelectionPickerOption } from '../components/SelectionPickerModal';
import { AppRefreshControl } from '../components/AppRefreshControl';
import { AvatarEditButton } from '../components/AvatarEditButton';
import { EntityShareModal } from '../components/EntityShareModal';
import { VerifiedName } from '../components/VerifiedBadge';
import { AppSheetModal } from '../components/AppSheetModal';
import { AnimatedSegmentedControl } from '../components/AnimatedSegmentedControl';
import { useGlobalAudioControls, type GlobalTrackQueueItem } from '../components/GlobalAudioPlayer';
import { AudioReleaseAttachmentCard } from '../components/AudioReleaseAttachmentCard';
import { boundedPlaybackQueue } from '../components/audioPlayerCore';
import { ExternalReleaseEditorField } from '../components/ExternalReleaseEditorField';
import { buildPlayableQueue, getBandcampRelease } from '../music/musicRuntime';
import { AvatarCropModal, AvatarPreviewModal, ConnectInterestSelector, ConnectPhotosEditor, MusicGenreSelector, PrimaryTrackCatalogSearch, PrimaryTrackInlinePreview, ProfileSafetyModal, SocialIcon, SocialLinkInput, TrackPlayerPill, type PrimaryExternalTrackCandidate } from './ProfileScreens';
import { EventCard, EventDetailScreen } from './EventScreens';
import { CalendarPickerModal } from './CreateEventScreen';
import { CatalogCategoryTile, locationCategoryOptions, useCategoryCovers } from '../components/CatalogCategoryTile';
import { CatalogInnerHeader } from '../components/CatalogInnerHeader';
import { EditorAutosaveStatus } from '../components/EditorAutosaveStatus';
import { apiFetch as fetch, apiUrl, readApiError, remoteSearchDebounceMs } from '../api/client';
import { audioReleaseGenreLimit, avatarThumbnail, connectInterestLabels, connectPhotoThumbnail, countryOptions, formatCityName, formatCountryCity, getAvatarInitial, groupMusicGenreChips, isMusicSubgenreValue, normalizePhoneDigits, normalizeSocialLink, normalizeUsernameInput, phoneCountryOptions, postImageThumbnail, publicPageTypeGroups, publicPageTypeLabels, releasePrimaryGenreLimit, russianPlural, splitInternationalPhone, uploadAvatarAsset, uploadConnectPhotoAsset, uploadPostImageAsset } from '../domain';
import { styles } from '../styles';
import { resolveForegroundLocation } from '../location/foregroundLocation';
import { normalizeExternalHttpsUrl } from '../security/externalUrls.mjs';
import { openExternalHttpsUrl } from '../security/openExternalUrl';
import type { AppleMusicTrack, AppPost, AvatarCropAsset, ConnectGoal, ConnectPhoto, CreateCommunityInput, CursorPage, EventParticipationStatus, EventSummary, Gender, PartnerPageInput, PartnerReference, Profile, PublicAccount, PublicPage, PublicPageAudioRelease, PublicPageContentTab, PublicPageDetail, PublicPageListTab, PublicPagePermission, PublicPageProduct, PublicPageTeamMember, PublicPageTypeOption, QuotedPost, TeamMemberInput, ToastMessage, UpdateCommunityInput } from '../types';

const connectGoalLabels: Record<ConnectGoal, string> = {
  ANY: 'Без конкретики',
  COLLABORATION: 'Коллаборации',
  FRIENDSHIP: 'Знакомства',
  DATING: 'Романтика',
  VOLUNTEERS: 'Волонтёрство',
  EMPLOYEES: 'Набор в команду',
};

const communityContentPageSize = 10;
const allPublicPagePermissions: PublicPagePermission[] = [
  'PROFILE_EDIT',
  'CONNECT_MANAGE',
  'PUBLICATIONS_MANAGE',
  'MEDIA_MANAGE',
  'MUSIC_MANAGE',
  'EVENTS_MANAGE',
  'PRODUCTS_MANAGE',
  'TEAM_MANAGE',
  'PARTNERS_MANAGE',
  'MEMBERSHIP_MANAGE',
  'TELEGRAM_FEED_MANAGE',
  'NOTIFICATIONS_VIEW',
  'MESSAGES_MANAGE',
  'ADMINISTRATORS_MANAGE',
];
const publicPagePermissionGroups: Array<{
  title: string;
  permissions: Array<{ value: PublicPagePermission; label: string; description: string }>;
}> = [
  {
    title: 'Профиль',
    permissions: [
      { value: 'PROFILE_EDIT', label: 'Редактирование профиля', description: 'Данные, ссылки, тип и оформление сообщества.' },
      { value: 'CONNECT_MANAGE', label: 'Коннект', description: 'Карточка, фотографии и настройки Коннекта.' },
    ],
  },
  {
    title: 'Содержимое',
    permissions: [
      { value: 'PUBLICATIONS_MANAGE', label: 'Публикации', description: 'Создание публикаций и ответы от имени сообщества.' },
      { value: 'MEDIA_MANAGE', label: 'Медиа', description: 'Фотографии и обложки во вкладках сообщества.' },
      { value: 'MUSIC_MANAGE', label: 'Музыка', description: 'Релизы и музыкальные материалы.' },
      { value: 'EVENTS_MANAGE', label: 'События', description: 'Создание и редактирование событий.' },
      { value: 'PRODUCTS_MANAGE', label: 'Товары', description: 'Товары, изображения и ссылки для заказа.' },
      { value: 'TEAM_MANAGE', label: 'Команда', description: 'Состав команды сообщества.' },
      { value: 'PARTNERS_MANAGE', label: 'Партнёры', description: 'Список партнёров сообщества.' },
    ],
  },
  {
    title: 'Аудитория и связь',
    permissions: [
      { value: 'MEMBERSHIP_MANAGE', label: 'Заявки на вступление', description: 'Принятие и отклонение заявок закрытого сообщества.' },
      { value: 'TELEGRAM_FEED_MANAGE', label: 'Telegram Feed', description: 'Подключение и отключение Telegram-канала.' },
      { value: 'NOTIFICATIONS_VIEW', label: 'Уведомления', description: 'Получение уведомлений сообщества.' },
      { value: 'MESSAGES_MANAGE', label: 'Сообщения', description: 'Чтение и ответы на сообщения сообщества.' },
    ],
  },
  {
    title: 'Доступ',
    permissions: [
      { value: 'ADMINISTRATORS_MANAGE', label: 'Управление доступами', description: 'Добавление и настройка прав других администраторов.' },
    ],
  },
];
const connectMinimumAge = 18;
const connectMaximumAge = 80;
const defaultConnectFilterGoals: ConnectGoal[] = ['ANY', 'COLLABORATION', 'FRIENDSHIP', 'DATING', 'EMPLOYEES', 'VOLUNTEERS'];

type ConnectFilterPreferences = {
  ageRange: [number, number];
  gender: 'ANY' | Gender;
  goals: ConnectGoal[];
  includeCommunities: boolean;
  interests: string[];
  musicGenres: string[];
};

function normalizeConnectAgeRange(value: [number, number], maximumAge: number): [number, number] {
  const normalizedMaximum = Math.max(
    connectMinimumAge + 1,
    Math.min(maximumAge, Math.round(value[1])),
  );
  const normalizedMinimum = Math.max(
    connectMinimumAge,
    Math.min(normalizedMaximum - 1, Math.round(value[0])),
  );
  return [normalizedMinimum, normalizedMaximum];
}

function activeConnectFilterCount(filters: ConnectFilterPreferences, maximumAge = connectMaximumAge) {
  const hasDefaultGoals = (
    filters.goals.length === defaultConnectFilterGoals.length
    && defaultConnectFilterGoals.every((goal) => filters.goals.includes(goal))
  );
  return (
    Number(filters.gender !== 'ANY')
    + Number(filters.ageRange[0] !== connectMinimumAge || filters.ageRange[1] !== maximumAge)
    + Number(!hasDefaultGoals)
    + Number(!filters.includeCommunities)
    + Number(filters.interests.length > 0)
    + Number(filters.musicGenres.length > 0)
  );
}

type SafetyReportReason = 'SPAM' | 'HARASSMENT' | 'IMPERSONATION' | 'ILLEGAL_CONTENT' | 'OTHER';

const connectReportCategories: Array<{ label: string; reason: SafetyReportReason }> = [
  { label: 'Фейк', reason: 'IMPERSONATION' },
  { label: 'Неприемлемый контент', reason: 'ILLEGAL_CONTENT' },
  { label: 'Возраст', reason: 'OTHER' },
  { label: 'Оскорбления', reason: 'HARASSMENT' },
  { label: 'Поведение вне приложения', reason: 'OTHER' },
  { label: 'Мошенничество или спам', reason: 'SPAM' },
];
const connectImagePrefetchCacheLimit = 160;
const connectPrefetchedImageUrls = new Map<string, true>();
const connectImagePrefetches = new Map<string, Promise<void>>();

type CatalogItem =
  | { kind: 'account'; value: PublicAccount }
  | { kind: 'community'; value: PublicPage };

type LocationCategory = typeof locationCategoryOptions[number]['value'];

function connectProfilePhotoUrls(profile: Pick<Profile, 'connectPhotos' | 'avatarUrl'> | PublicAccount | null) {
  if (!profile) return [];
  const connectPhotos = Array.isArray(profile.connectPhotos)
    ? profile.connectPhotos.map((photo) => photo?.imageUrl).filter((url): url is string => Boolean(url))
    : [];
  return [...new Set(connectPhotos.length ? connectPhotos : profile.avatarUrl ? [profile.avatarUrl] : [])];
}

function rememberPrefetchedConnectImage(url: string) {
  connectPrefetchedImageUrls.delete(url);
  connectPrefetchedImageUrls.set(url, true);
  while (connectPrefetchedImageUrls.size > connectImagePrefetchCacheLimit) {
    const oldestUrl = connectPrefetchedImageUrls.keys().next().value;
    if (!oldestUrl) break;
    connectPrefetchedImageUrls.delete(oldestUrl);
  }
}

function prefetchConnectImage(url: string) {
  if (!url || connectPrefetchedImageUrls.has(url)) return Promise.resolve();
  const existing = connectImagePrefetches.get(url);
  if (existing) return existing;

  const prefetch = Image.prefetch(url)
    .then(() => {
      rememberPrefetchedConnectImage(url);
    })
    .catch(() => undefined)
    .finally(() => {
      connectImagePrefetches.delete(url);
    });
  connectImagePrefetches.set(url, prefetch);
  return prefetch;
}

function normalizeCommunitySocialLinks(values: Record<'bandcamp' | 'soundcloud' | 'instagram' | 'threads' | 'telegram' | 'youtube' | 'letterboxd', string>) {
  const entries = Object.entries(values).map(([provider, value]) => [provider, normalizeSocialLink(value, provider as keyof typeof values)] as const);
  return { error: entries.find(([, result]) => result.error)?.[1].error ?? null, links: Object.fromEntries(entries.map(([provider, result]) => [`${provider}Url`, result.url])) };
}

function normalizeCommunityWebsite(value: string) {
  const raw = value.trim();
  if (!raw) return { url: '', error: null };
  try {
    const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!parsed.hostname.includes('.') || parsed.username || parsed.password || !['http:', 'https:'].includes(parsed.protocol)) {
      return { url: '', error: 'Укажите корректный веб-сайт' };
    }
    parsed.protocol = 'https:';
    return { url: parsed.toString(), error: null };
  }
  catch { return { url: '', error: 'Укажите корректный веб-сайт' }; }
}

export function MyCommunitiesScreen({
  onBack,
  onCreateCommunity,
  onCreateEvent,
  onEditCommunity,
  onOpenCommunityCabinet,
  onNotify,
  onOpenPublicPage,
}: {
  onBack: () => void;
  onCreateCommunity: () => void;
  onCreateEvent: () => void;
  onEditCommunity: (username: string) => Promise<void>;
  onOpenCommunityCabinet: (username: string) => Promise<void>;
  onNotify: (message: string, type?: ToastMessage['type']) => void;
  onOpenPublicPage: (username: string) => Promise<void>;
}) {
  const [pages, setPages] = useState<PublicPage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const load = useCallback(async (refresh = false) => {
    refresh ? setIsRefreshing(true) : setIsLoading(true);
    try {
      const response = await fetch(`${apiUrl}/public-pages/owned/mine`, { cache: refresh ? 'no-store' : undefined });
      if (!response.ok) throw new Error(await readApiError(response, 'Не удалось загрузить сообщества'));
      setPages(await response.json() as PublicPage[]);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : 'Не удалось загрузить сообщества', 'error');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [onNotify]);

  useEffect(() => { void load(); }, [load]);
  const canCreateEvent = pages.some((page) => page.moderationStatus === 'APPROVED');

  return (
    <View style={styles.myCommunitiesScreen}>
      <View style={styles.topBar}>
        <View style={styles.topBarLeft}>
          <Pressable accessibilityLabel="Назад" onPress={onBack} style={styles.topBarIconButton}><ChevronLeft color="#111" size={29} strokeWidth={2.1} /></Pressable>
          <Text style={styles.topBarTitle}>Мои сообщества</Text>
        </View>
      </View>
      <ScrollView
        contentContainerStyle={styles.myCommunitiesContent}
        refreshControl={<AppRefreshControl refreshing={isRefreshing} onRefresh={() => load(true)} />}
      >
        <View style={styles.myCommunitiesActions}>
          <Pressable onPress={onCreateCommunity} style={styles.myCommunitiesPrimaryAction}><Plus color="#fff" size={21} strokeWidth={2} /><Text style={styles.myCommunitiesPrimaryActionText}>Создать сообщество</Text></Pressable>
          <Pressable disabled={!canCreateEvent} onPress={onCreateEvent} style={[styles.myCommunitiesSecondaryAction, !canCreateEvent && styles.disabledButton]}><CalendarDays color="#111" size={20} strokeWidth={2} /><Text style={styles.myCommunitiesSecondaryActionText}>Создать событие</Text></Pressable>
        </View>
        <Text style={styles.myCommunitiesSectionTitle}>Сообщества в управлении</Text>
        {isLoading ? <ActivityIndicator color="#111" style={{ marginTop: 24 }} /> : null}
        {!isLoading && !pages.length ? <View style={styles.myCommunitiesEmpty}><UsersRound color="#7d8894" size={32} strokeWidth={1.8} /><Text style={styles.myCommunitiesEmptyTitle}>Сообществ пока нет</Text><Text style={styles.myCommunitiesEmptyText}>Создайте первое сообщество — оно появится здесь сразу после отправки на модерацию.</Text></View> : null}
        {pages.map((page) => (
          <View key={page.id} style={[styles.myCommunityRow, page.moderationStatus !== 'APPROVED' && styles.sideMenuPageItemInactive]}>
            <Pressable accessibilityLabel={`Открыть ${page.name}`} onPress={() => void onOpenPublicPage(page.username)} style={styles.myCommunityMainAction}>
              {page.avatarUrl ? <Image source={{ uri: page.avatarUrl }} style={styles.myCommunityAvatar} /> : <View style={styles.myCommunityAvatar}><Text style={styles.sideMenuPageAvatarText}>{getAvatarInitial(page.name)}</Text></View>}
              <View style={styles.myCommunityCopy}>
                <Text numberOfLines={1} style={styles.myCommunityName}>{page.name}</Text>
                <Text style={styles.myCommunityUsername}>@{page.username}</Text>
              </View>
            </Pressable>
            {page.moderationStatus === 'PENDING' ? <Text style={styles.myCommunityStatus}>На модерации</Text> : null}
            {page.moderationStatus === 'REJECTED' ? <Text style={styles.myCommunityStatus}>Отклонено</Text> : null}
            {(page.managementPermissions?.includes('TELEGRAM_FEED_MANAGE') || page.managementPermissions?.includes('ADMINISTRATORS_MANAGE') || page.managementPermissions?.includes('PROFILE_EDIT')) ? <View style={styles.myCommunityManagementActions}>
              {(page.managementPermissions.includes('TELEGRAM_FEED_MANAGE') || page.managementPermissions.includes('ADMINISTRATORS_MANAGE')) ? <Pressable accessibilityLabel={`Открыть кабинет ${page.name}`} hitSlop={6} onPress={() => void onOpenCommunityCabinet(page.username)} style={styles.myCommunityEditButton}>
                <Settings color="#111" size={20} strokeWidth={1.9} />
              </Pressable> : null}
              {page.managementPermissions.includes('PROFILE_EDIT') ? <Pressable accessibilityLabel={`Редактировать ${page.name}`} hitSlop={6} onPress={() => void onEditCommunity(page.username)} style={styles.myCommunityEditButton}>
                <Pencil color="#111" size={20} strokeWidth={1.9} />
              </Pressable> : null}
            </View> : null}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

type CatalogLocation = { cityId: string; cityName: string; countryCode: string; countryName: string };
type SelectableCatalogCity = CatalogLocation & { id: string; name: string; latitude: number | null; longitude: number | null; country: { name: string } };
const nearbyCatalogCityRadiusKilometers = 120;

function catalogDistanceKilometers(latitude: number, longitude: number, cityLatitude: number, cityLongitude: number) {
  const toRadians = (value: number) => value * Math.PI / 180;
  const latitudeDelta = toRadians(cityLatitude - latitude);
  const longitudeDelta = toRadians(cityLongitude - longitude);
  const startLatitude = toRadians(latitude);
  const endLatitude = toRadians(cityLatitude);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(startLatitude) * Math.cos(endLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

export function CommunityCabinetScreen({ authToken, isOwner, onBack, onNotify, page }: { authToken: string; isOwner: boolean; onBack: () => void; onNotify: (message: string, type?: ToastMessage['type']) => void; page: PublicPageDetail }) {
  const [auditLog, setAuditLog] = useState<Array<{ id: string; action: string; details: Record<string, unknown> | null; createdAt: string; actor: { username: string; name: string } }>>([]);
  const effectivePermissions = isOwner ? allPublicPagePermissions : page.myPermissions;
  const canManageTelegramFeed = effectivePermissions.includes('TELEGRAM_FEED_MANAGE');
  const canManageAdministrators = effectivePermissions.includes('ADMINISTRATORS_MANAGE');
  const grantablePermissions = isOwner
    ? allPublicPagePermissions
    : effectivePermissions.filter((permission) => permission !== 'ADMINISTRATORS_MANAGE');
  const loadAuditLog = useCallback(async () => {
    if (!isOwner) return;
    const response = await fetch(`${apiUrl}/public-pages/${encodeURIComponent(page.username)}/audit-log`, { headers: { Authorization: `Bearer ${authToken}` } });
    if (response.ok) setAuditLog(await response.json());
  }, [authToken, isOwner, page.username]);
  useEffect(() => { void loadAuditLog(); }, [loadAuditLog]);
  const actionLabels: Record<string, string> = { PROFILE_UPDATED: 'изменил профиль сообщества', TEAM_MEMBER_SAVED: 'изменил состав команды', TEAM_MEMBER_REMOVED: 'удалил участника команды', PARTNER_SAVED: 'добавил или изменил партнёра', PARTNER_REMOVED: 'удалил партнёра', ACCESS_SAVED: 'изменил доступ к управлению', ACCESS_REMOVED: 'удалил доступ к управлению', PRODUCT_ADDED: 'добавил товар', PRODUCT_REMOVED: 'удалил товар', AUDIO_RELEASE_ADDED: 'добавил музыкальный релиз', AUDIO_RELEASE_REMOVED: 'удалил музыкальный релиз', EVENT_CREATED: 'создал событие', EVENT_UPDATED: 'изменил событие', EVENT_REMOVED: 'удалил событие', EVENT_PARTNER_ADDED: 'добавил партнёра события', EVENT_PARTNER_REMOVED: 'удалил партнёра события', EVENT_LINEUP_UPDATED: 'изменил лайнап события', POST_CREATED: 'опубликовал запись', POST_REPOSTED: 'сделал репост', POST_REMOVED: 'удалил публикацию', TELEGRAM_FEED_CONNECTED: 'подключил Telegram Feed', TELEGRAM_FEED_DISCONNECTED: 'отключил Telegram Feed' };
  const auditSubject = (details: Record<string, unknown> | null) => {
    const value = details?.title ?? details?.name ?? details?.username;
    return typeof value === 'string' && value.trim() ? ` «${value.trim()}»` : '';
  };
  return (
    <View style={styles.myCommunitiesScreen}>
      <View style={styles.topBar}>
        <View style={styles.topBarLeft}>
          <Pressable accessibilityLabel="Назад" onPress={onBack} style={styles.topBarIconButton}><ChevronLeft color="#111" size={29} strokeWidth={2.1} /></Pressable>
          <Text style={styles.topBarTitle}>Кабинет сообщества</Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.communityCabinetContent} showsVerticalScrollIndicator={false}>
        {canManageTelegramFeed ? <View style={styles.communityCabinetSection}>
          <Text style={[styles.editSectionTitle, styles.communityCabinetSectionTitle]}>Telegram Feed</Text>
          <TelegramFeedSection authToken={authToken} onChanged={loadAuditLog} onNotify={onNotify} page={page} />
        </View> : null}
        {canManageAdministrators ? <View style={styles.communityCabinetSection}>
          <Text style={[styles.editSectionTitle, styles.communityCabinetSectionTitle]}>Доступ к управлению</Text>
          <CommunityAdministrationSection authToken={authToken} grantablePermissions={grantablePermissions} initialAdministrators={page.administrators || []} onChanged={loadAuditLog} onNotify={onNotify} pageUsername={page.username} />
        </View> : null}
        {isOwner ? <View style={styles.communityCabinetSection}>
          <Text style={[styles.editSectionTitle, styles.communityCabinetSectionTitle]}>Журнал действий</Text>
          <View style={styles.communityAuditCard}>{auditLog.length ? auditLog.map((item) => <View key={item.id} style={styles.communityAuditRow}><Text style={styles.communityAuditText}><Text style={styles.communityAuditActor}>{item.actor.name}</Text> {actionLabels[item.action] ?? 'изменил сообщество'}{auditSubject(item.details)}</Text><Text style={styles.communityAuditMeta}>@{item.actor.username} · {new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(item.createdAt))}</Text></View>) : <Text style={styles.settingsHint}>Изменений пока нет</Text>}</View>
        </View> : null}
      </ScrollView>
    </View>
  );
}

type TelegramFeedStatus = {
  configured: boolean;
  botUsername: string | null;
  addBotUrl: string | null;
  historyImportConfigured: boolean;
  connectionAttempt: null | { state: 'PENDING' | 'COMPLETED' | 'EXPIRED' | 'ERROR'; errorMessage: string | null };
  connection: null | {
    id: string;
    channelUsername: string;
    channelTitle: string;
    botUsername: string;
    lastSyncedAt: string | null;
    avatarUrl: string | null;
  };
};

function TelegramFeedSection({ authToken, onChanged, onNotify, page }: { authToken: string; onChanged: () => void; onNotify: (message: string, type?: ToastMessage['type']) => void; page: PublicPageDetail }) {
  const [status, setStatus] = useState<TelegramFeedStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const loadStatus = useCallback(async (quiet = false) => {
    try {
      const response = await fetch(`${apiUrl}/public-pages/${encodeURIComponent(page.username)}/telegram-feed`, { headers: { Authorization: `Bearer ${authToken}` } });
      if (!response.ok) throw new Error(await readApiError(response, 'Не удалось проверить Telegram Feed'));
      setStatus(await response.json() as TelegramFeedStatus);
    } catch (error) {
      if (!quiet) onNotify(error instanceof Error ? error.message : 'Не удалось проверить Telegram Feed', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [authToken, onNotify, page.username]);
  useEffect(() => { void loadStatus(); }, [loadStatus]);
  useEffect(() => {
    if (!isConnecting) return undefined;
    const interval = setInterval(() => { void loadStatus(true); }, 2000);
    return () => clearInterval(interval);
  }, [isConnecting, loadStatus]);
  useEffect(() => {
    if (!isConnecting || !status?.connection) return;
    setIsConnecting(false);
    onChanged();
    onNotify('Telegram Feed подключён');
  }, [isConnecting, onChanged, onNotify, status?.connection]);
  useEffect(() => {
    if (!isConnecting || !status?.connectionAttempt || status.connectionAttempt.state === 'PENDING') return;
    if (status.connectionAttempt.state === 'ERROR') onNotify(status.connectionAttempt.errorMessage || 'Не удалось подключить Telegram-канал', 'error');
    if (status.connectionAttempt.state === 'EXPIRED') onNotify('Время подключения Telegram-канала истекло', 'error');
    setIsConnecting(false);
  }, [isConnecting, onNotify, status?.connectionAttempt]);
  const connect = async () => {
    if (isSaving || isConnecting) return;
    setIsSaving(true);
    try {
      const response = await fetch(`${apiUrl}/public-pages/${encodeURIComponent(page.username)}/telegram-feed/start`, { method: 'POST', headers: { Authorization: `Bearer ${authToken}` } });
      if (!response.ok) throw new Error(await readApiError(response, 'Не удалось подключить Telegram Feed'));
      const result = await response.json() as { url?: string };
      if (!result.url) throw new Error('Telegram-бот не вернул ссылку подключения');
      const connectionUrl = normalizeExternalHttpsUrl(result.url, ['t.me', 'telegram.me', 'telegram.org']);
      if (!connectionUrl) throw new Error('Telegram-бот вернул небезопасную ссылку подключения');
      await openExternalHttpsUrl(connectionUrl);
      setStatus((current) => current ? { ...current, connectionAttempt: { state: 'PENDING', errorMessage: null } } : current);
      setIsConnecting(true);
    } catch (error) {
      setIsConnecting(false);
      onNotify(error instanceof Error ? error.message : 'Не удалось подключить Telegram Feed', 'error');
    } finally {
      setIsSaving(false);
    }
  };
  const performDisconnect = async () => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      const response = await fetch(`${apiUrl}/public-pages/${encodeURIComponent(page.username)}/telegram-feed`, { method: 'DELETE', headers: { Authorization: `Bearer ${authToken}` } });
      if (!response.ok) throw new Error(await readApiError(response, 'Не удалось отключить Telegram Feed'));
      await loadStatus();
      onChanged();
      onNotify('Telegram Feed отключён');
    } catch (error) {
      onNotify(error instanceof Error ? error.message : 'Не удалось отключить Telegram Feed', 'error');
    } finally {
      setIsSaving(false);
    }
  };
  const disconnect = () => {
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.confirm('Отключить Telegram Feed?\n\nНовые публикации перестанут синхронизироваться.')) void performDisconnect();
      return;
    }
    Alert.alert('Отключить Telegram Feed?', 'Новые публикации перестанут синхронизироваться.', [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Отключить', style: 'destructive', onPress: () => void performDisconnect() },
    ]);
  };

  if (isLoading) return <View style={styles.telegramFeedCard}><ActivityIndicator color="#111" /></View>;
  if (status?.connection) return <View style={styles.telegramFeedCard}>
    <View style={styles.telegramFeedConnectedHeader}>{status.connection.avatarUrl ? <Image accessibilityLabel={`Аватар Telegram-канала ${status.connection.channelTitle}`} source={{ uri: `${apiUrl}${status.connection.avatarUrl}`, headers: { Authorization: `Bearer ${authToken}` } }} style={styles.telegramFeedChannelAvatar} /> : <View style={styles.telegramFeedIcon}><Radio color="#111" size={20} /></View>}<View style={styles.telegramFeedCopy}><Text numberOfLines={1} style={styles.telegramFeedTitle}>{status.connection.channelTitle}</Text><Text style={styles.telegramFeedMeta}>@{status.connection.channelUsername} · подключено</Text></View><Check color="#2db75d" size={21} strokeWidth={2.2} /></View>
    <Text style={styles.telegramFeedHint}>{status.historyImportConfigured ? 'Последние 10 публикаций импортируются при подключении. Новые публикации синхронизируются автоматически.' : 'Новые публикации будут синхронизироваться автоматически. Импорт последних 10 появится после настройки MTProto.'}</Text>
    <Pressable accessibilityRole="button" disabled={isSaving} onPress={disconnect} style={styles.telegramFeedSecondaryButton}><Text style={styles.telegramFeedSecondaryButtonText}>Отключить</Text></Pressable>
  </View>;
  return <View style={styles.telegramFeedCard}>
    <Text style={styles.telegramFeedHint}>Нажмите кнопку и выберите публичный канал в Telegram. Права бота: чтение публикаций сообщества.</Text>
    <Pressable accessibilityRole="button" disabled={isSaving || isConnecting || !status?.configured} onPress={() => void connect()} style={[styles.telegramFeedPrimaryButton, (isSaving || isConnecting || !status?.configured) && styles.disabledButton]}>{isSaving || isConnecting ? <ActivityIndicator color="#fff" size="small" /> : <Plus color="#fff" size={18} />}<Text style={styles.telegramFeedPrimaryButtonText}>{isConnecting ? 'Ожидаем выбор канала' : 'Подключить Telegram'}</Text></Pressable>
    {!status?.configured ? <Text style={styles.telegramFeedError}>Telegram-бот пока не настроен на сервере.</Text> : null}
  </View>;
}

export function CreateCommunityScreen({
  onBack,
  onCreate,
  onNotify,
}: {
  onBack: () => void;
  onCreate: (data: CreateCommunityInput) => Promise<void>;
  onNotify: (message: string, type?: ToastMessage['type']) => void;
}) {
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [usernameState, setUsernameState] = useState<'idle' | 'checking' | 'invalid' | 'taken' | 'available'>('idle');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [avatarCropAsset, setAvatarCropAsset] = useState<AvatarCropAsset | null>(null);
  const [type, setType] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [countryName, setCountryName] = useState('');
  const [countryCode, setCountryCode] = useState('');
  const [cityName, setCityName] = useState('');
  const [cityId, setCityId] = useState('');
  const [address, setAddress] = useState('');
  const [phoneCode, setPhoneCode] = useState('+7');
  const [contactPhone, setContactPhone] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [isPhoneCodePickerOpen, setIsPhoneCodePickerOpen] = useState(false);
  const [phoneCodeSearch, setPhoneCodeSearch] = useState('');
  const [about, setAbout] = useState('');
  const [bandcampUrl, setBandcampUrl] = useState(''); const [soundcloudUrl, setSoundcloudUrl] = useState('');
  const [instagramUrl, setInstagramUrl] = useState('');
  const [threadsUrl, setThreadsUrl] = useState(''); const [telegramUrl, setTelegramUrl] = useState('');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [letterboxdUrl, setLetterboxdUrl] = useState('');
  const [typeOptions, setTypeOptions] = useState<PublicPageTypeOption[]>([]);
  const [isTypePickerOpen, setIsTypePickerOpen] = useState(false);
  const [isLocationPickerOpen, setIsLocationPickerOpen] = useState(false);
  const [countrySearch, setCountrySearch] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const filteredCountries = useMemo(() => {
    const normalizedSearch = countrySearch.trim().toLowerCase();

    if (!normalizedSearch) {
      return countryOptions;
    }

    return countryOptions.filter((country) => country.toLowerCase().startsWith(normalizedSearch));
  }, [countrySearch]);
  const selectedType = typeOptions.find((option) => option.value === type);
  const phoneCodeLabels = useMemo(() => phoneCountryOptions.map((option) => `${option.country} (${option.code})`).filter((label) => label.toLowerCase().includes(phoneCodeSearch.trim().toLowerCase())), [phoneCodeSearch]);

  useEffect(() => {
    let isMounted = true;

    fetch(`${apiUrl}/public-pages/types`)
      .then((response) => response.json() as Promise<PublicPageTypeOption[]>)
      .then((options) => {
        if (isMounted) {
          setTypeOptions(options);
        }
      })
      .catch(() => {
        if (isMounted) {
          setTypeOptions([]);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    const normalizedUsername = username.trim().replace(/^@/, '').toLowerCase();

    if (!normalizedUsername) {
      setUsernameState('idle');
      return;
    }

    if (!/^(?=.{3,20}$)(?=.*[a-z])[a-z0-9_]+$/.test(normalizedUsername)) {
      setUsernameState('invalid');
      return;
    }

    const controller = new AbortController();
    setUsernameState('checking');
    const timeout = setTimeout(() => {
      fetch(`${apiUrl}/auth/username-available?username=${encodeURIComponent(normalizedUsername)}`, { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) {
            throw new Error('Не удалось проверить URL-name');
          }
          return response.json() as Promise<{ available: boolean }>;
        })
        .then((result) => setUsernameState(result.available ? 'available' : 'taken'))
        .catch((error: unknown) => {
          if (!(error instanceof Error && error.name === 'AbortError')) {
            setUsernameState('invalid');
          }
        });
    }, 350);

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [username]);

  const pickAvatar = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Фото', 'Нужно разрешение на выбор фото из галереи.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ allowsEditing: false, base64: false, mediaTypes: ['images'], quality: 1 });
    if (!result.canceled) {
      const asset = result.assets[0];
      setAvatarCropAsset({ uri: asset.uri, width: asset.width || 1200, height: asset.height || 1200, mimeType: asset.mimeType || 'image/jpeg' });
    }
  };

  const submit = async () => {
    const normalizedUsername = username.replace(/^@/, '').trim().toLowerCase();

    if (name.trim().length < 2) {
      onNotify('Укажите название минимум из 2 символов', 'error');
      return;
    }

    if (!/^(?=.{3,20}$)(?=.*[a-z])[a-z0-9_]+$/.test(normalizedUsername)) {
      onNotify('URL-name: 3–20 символов, минимум одна латинская буква, допустимы цифры и _', 'error');
      return;
    }

    if (usernameState === 'checking') {
      onNotify('Подождите завершения проверки URL-name', 'error');
      return;
    }

    if (usernameState !== 'available') {
      onNotify(usernameState === 'taken' ? 'Этот URL-name уже занят' : 'Не удалось подтвердить доступность URL-name', 'error');
      return;
    }

    if (!type) {
      onNotify('Выберите тип сообщества', 'error');
      return;
    }

    const phoneDigits = normalizePhoneDigits(`${phoneCode}${contactPhone}`);
    if (contactPhone && phoneDigits.length < 7) {
      onNotify('Телефон должен содержать от 7 до 15 цифр', 'error');
      return;
    }

    if (!avatarUrl) {
      onNotify('Добавьте аватарку сообщества', 'error');
      return;
    }
    const social = normalizeCommunitySocialLinks({ bandcamp: bandcampUrl, soundcloud: soundcloudUrl, instagram: instagramUrl, threads: threadsUrl, telegram: telegramUrl, youtube: youtubeUrl, letterboxd: letterboxdUrl });
    if (social.error) { onNotify(social.error, 'error'); return; }
    const website = normalizeCommunityWebsite(websiteUrl); if (website.error) { onNotify(website.error, 'error'); return; }

    setIsSaving(true);

    try {
      await onCreate({
        avatarLocalUri: avatarUrl,
        username: normalizedUsername,
        name: name.trim(),
        type,
        countryName: countryName.trim(),
        countryCode,
        cityName: cityName.trim(),
        cityId,
        address: address.trim(),
        contactPhone: contactPhone ? `+${phoneDigits}` : undefined,
        websiteUrl: website.url,
        about: about.trim(),
        isPrivate,
        ...social.links,
      });
    } catch (error) {
      onNotify(error instanceof Error ? error.message : 'Не удалось создать сообщество', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <View style={styles.topBar}>
        <View style={styles.topBarLeft}>
          <Pressable onPress={onBack} style={styles.topBarIconButton}>
            <ChevronLeft size={29} color="#090909" strokeWidth={2.1} />
          </Pressable>
          <Text style={styles.topBarTitle}>Создать сообщество</Text>
        </View>
      </View>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.editShell}>
        <ScrollView
          contentContainerStyle={[styles.editContent, styles.createCommunityContent]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.editIdentityRow}>
            <View style={styles.avatarEditRow}>
              <Pressable accessibilityLabel="Добавить аватарку сообщества" accessibilityRole="button" onPress={pickAvatar} style={styles.avatarEditButton}>
                {avatarUrl ? <Image source={{ uri: avatarUrl }} style={styles.avatarEditPreview} /> : <View style={[styles.avatarEditPreview, styles.avatarEditPlaceholder]}><Plus color="#111" size={28} strokeWidth={1.8} /></View>}
              </Pressable>
              <Text style={styles.changeAvatarText}>{avatarUrl ? 'Изменить' : 'Добавить фото'}</Text>
            </View>
            <View style={[styles.editFieldGroup, styles.createCommunityIdentityFields, styles.editorBorderlessSurface]}>
              <View style={styles.editFieldRow}>
                <Text style={styles.usernamePrefix}>@</Text>
                <TextInput
                  autoCapitalize="none"
                  autoCorrect={false}
                  maxLength={20}
                  onChangeText={(value) => {
                    setUsernameState(value ? 'checking' : 'idle');
                    setUsername(normalizeUsernameInput(value, 20));
                  }}
                  placeholder="url-name"
                  placeholderTextColor="#98a3ae"
                  style={[styles.editGroupInput, styles.editGroupUsernameInput]}
                  value={username}
                />
                <View pointerEvents="none" style={styles.usernameStatusSlot}>
                  {usernameState === 'checking' ? <ActivityIndicator color="#7d8894" size="small" /> : null}
                  {usernameState === 'available' ? <Check color="#2fa84f" size={20} strokeWidth={2.4} /> : null}
                  {usernameState === 'taken' || usernameState === 'invalid' ? <X color="#c62828" size={19} strokeWidth={2.4} /> : null}
                </View>
              </View>
              <View style={styles.editFieldSeparator} />
              <TextInput onChangeText={setName} placeholder="Название" placeholderTextColor="#98a3ae" style={[styles.editGroupInput, styles.editGroupInputWithLeftPadding]} value={name} />
            </View>
          </View>
          <Text style={styles.editHelperText}>URL-name будет использоваться как короткая ссылка сообщества.</Text>

          <Pressable onPress={() => setIsTypePickerOpen(true)} style={[styles.editSelectInput, styles.editorBorderlessSurface]}>
            <Text style={[styles.editSelectText, !selectedType && styles.editSelectPlaceholder]}>
              {selectedType?.label || 'Категория сообщества *'}
            </Text>
            <Text style={styles.editSelectChevron}>›</Text>
          </Pressable>

          <View style={styles.createAccessBlock}>
            <Text style={styles.settingsLabel}>Доступ</Text>
            <Text style={styles.createAccessHint}>
            Открытое сообщество видно всем: любой может подписаться и читать контент. В закрытом доступ получают только после подтверждения заявки. Заявка поступит в уведомления владельца сообщества, где её можно подтвердить или отклонить.
            </Text>
            <AnimatedSegmentedControl accessibilityLabel="Доступ к сообществу" containerStyle={styles.privacySegment} onChange={setIsPrivate} options={[{ label: 'Открытое', value: false }, { label: 'Закрытое', value: true }]} value={isPrivate} />
          </View>

          <View style={styles.editLocationRow}>
            <Pressable onPress={() => setIsLocationPickerOpen(true)} style={[styles.editSelectInput, styles.editorBorderlessSurface, { flex: 1 }]}>
              <Text numberOfLines={1} style={[styles.editSelectText, !countryName && styles.editSelectPlaceholder]}>
                {cityName ? `${countryName}, ${cityName}` : countryName || 'Местоположение'}
              </Text>
              <Text style={styles.editSelectChevron}>›</Text>
            </Pressable>
          </View>

          <TextInput autoCapitalize="words" maxLength={200} onChangeText={setAddress} placeholder="Улица, дом" placeholderTextColor="#98a3ae" style={[styles.editInput, styles.communityAddressInput, styles.editorBorderlessSurface]} value={address} />

          <View style={styles.phoneInputRow}>
            <Pressable onPress={() => setIsPhoneCodePickerOpen(true)} style={[styles.phoneCodeInput, styles.editorBorderlessSurface]}><Text style={styles.editSelectText}>{phoneCode}</Text><Text style={styles.editSelectChevron}>›</Text></Pressable>
            <TextInput keyboardType="phone-pad" maxLength={10} onChangeText={(value) => setContactPhone(normalizePhoneDigits(value, 10))} placeholder="Телефон" placeholderTextColor="#98a3ae" style={[styles.editInput, styles.phoneNumberInput, styles.editorBorderlessSurface]} value={contactPhone} />
          </View>
          <TextInput autoCapitalize="none" autoCorrect={false} keyboardType="url" maxLength={300} onChangeText={setWebsiteUrl} placeholder="Веб-сайт" placeholderTextColor="#98a3ae" style={[styles.editInput, styles.communityWebsiteInput, styles.editorBorderlessSurface]} value={websiteUrl} />

          <TextInput
            multiline
            onChangeText={setAbout}
            placeholder="Описание (необязательно)"
            placeholderTextColor="#98a3ae"
            style={[styles.editInput, styles.editTextArea, styles.editorBorderlessSurface]}
            textAlignVertical="top"
            value={about}
          />

          <Text style={styles.editSectionTitle}>Ссылки</Text>
          <SocialLinkInput kind="bandcamp" onChangeText={setBandcampUrl} placeholder="Bandcamp" value={bandcampUrl} />
          <SocialLinkInput kind="soundcloud" onChangeText={setSoundcloudUrl} placeholder="SoundCloud" value={soundcloudUrl} />
          <SocialLinkInput kind="instagram" onChangeText={setInstagramUrl} placeholder="Instagram" value={instagramUrl} />
          <SocialLinkInput kind="threads" onChangeText={setThreadsUrl} placeholder="Threads" value={threadsUrl} />
          <SocialLinkInput kind="telegram" onChangeText={setTelegramUrl} placeholder="Telegram" value={telegramUrl} />
          <SocialLinkInput kind="youtube" onChangeText={setYoutubeUrl} placeholder="YouTube" value={youtubeUrl} />
          <SocialLinkInput kind="letterboxd" onChangeText={setLetterboxdUrl} placeholder="Letterboxd" value={letterboxdUrl} />

          <Text style={styles.editHelperText}>Один аккаунт может владеть максимум 3 сообществами.</Text>
        </ScrollView>
        <View pointerEvents="box-none" style={[styles.stickySaveArea, styles.createCommunityStickySaveArea]}>
          <Pressable disabled={isSaving} onPress={submit} style={[styles.saveProfileButton, isSaving && styles.disabledButton]}>
            {isSaving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveProfileText}>Создать</Text>}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
      <PublicPageTypePickerModal
        isVisible={isTypePickerOpen}
        onClose={() => setIsTypePickerOpen(false)}
        onSelect={(option) => {
          setType(option.value);
          setIsTypePickerOpen(false);
        }}
        options={typeOptions}
        selectedValue={type}
      />
      <LocationPickerModal
        initialCountryName={countryName}
        isVisible={isLocationPickerOpen}
        onClose={() => setIsLocationPickerOpen(false)}
        onSelect={(location) => {
          if (location.cityId !== cityId) setAddress('');
          setCountryName(location.countryName);
          setCountryCode(location.countryCode);
          setCityName(location.cityName);
          setCityId(location.cityId);
        }}
      />
      <AvatarCropModal asset={avatarCropAsset} onApply={setAvatarUrl} onClose={() => setAvatarCropAsset(null)} />
      <CountryPickerModal countries={phoneCodeLabels} isVisible={isPhoneCodePickerOpen} onChangeSearch={setPhoneCodeSearch} onClose={() => setIsPhoneCodePickerOpen(false)} onSelect={(label) => { const option = phoneCountryOptions.find((item) => label === `${item.country} (${item.code})`); if (option) setPhoneCode(option.code); setPhoneCodeSearch(''); setIsPhoneCodePickerOpen(false); }} search={phoneCodeSearch} />
    </>
  );
}

export function LocationsScreen({
  defaultLocation,
  onOpenMenu,
  onOpenMessages,
  onOpenNotifications,
  onOpenProfile,
  onOpenPublicPage,
}: {
  defaultLocation: { cityId: string | null; cityName: string; countryCode?: string; countryName: string };
  onOpenMenu: () => void;
  onOpenMessages: () => void;
  onOpenNotifications: () => void;
  onOpenProfile: (username: string) => Promise<void>;
  onOpenPublicPage: (username: string) => Promise<void>;
}) {
  const { covers: categoryCovers, reload: reloadCategoryCovers } = useCategoryCovers();
  const [activeCatalogTab, setActiveCatalogTab] = useState<'locations' | 'communities'>('locations');
  const [query, setQuery] = useState('');
  const [pages, setPages] = useState<PublicPage[]>([]);
  const [accounts, setAccounts] = useState<PublicAccount[]>([]);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [selectedLocationCategory, setSelectedLocationCategory] = useState<LocationCategory | null>(null);
  const [locationCategoryCounts, setLocationCategoryCounts] = useState<Record<LocationCategory, number> | null>(null);
  const profileCatalogLocation: CatalogLocation = {
    cityId: defaultLocation.cityId ?? '',
    cityName: defaultLocation.cityName,
    countryCode: defaultLocation.countryCode ?? '',
    countryName: defaultLocation.countryName,
  };
  const [locationFilters, setLocationFilters] = useState({
    ...profileCatalogLocation,
    types: [] as string[],
  });
  const activeCatalogTabRef = useRef(activeCatalogTab);
  const locationsManuallyChangedRef = useRef(false);
  const catalogLocationsRef = useRef<Record<'locations' | 'communities', CatalogLocation>>({
    locations: profileCatalogLocation,
    communities: { cityId: '', cityName: '', countryCode: '', countryName: '' },
  });
  const [isLocationPickerOpen, setIsLocationPickerOpen] = useState(false);
  const [isLocationFiltersOpen, setIsLocationFiltersOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const detectNearbyCity = async () => {
      try {
        const [position, cityResponse] = await Promise.all([
          resolveForegroundLocation(),
          fetch(`${apiUrl}/locations/cities`),
        ]);
        if (!position || !cityResponse.ok || cancelled || locationsManuallyChangedRef.current) return;
        const cities = await cityResponse.json() as SelectableCatalogCity[];
        const nearest = cities
          .filter((city) => Number.isFinite(city.latitude) && Number.isFinite(city.longitude))
          .map((city) => ({ city, distance: catalogDistanceKilometers(position.latitude, position.longitude, city.latitude!, city.longitude!) }))
          .sort((left, right) => left.distance - right.distance)[0];
        if (!nearest || nearest.distance > nearbyCatalogCityRadiusKilometers || cancelled) return;
        const detected = {
          cityId: nearest.city.id,
          cityName: nearest.city.name,
          countryCode: nearest.city.countryCode,
          countryName: nearest.city.country.name,
        };
        catalogLocationsRef.current.locations = detected;
        if (activeCatalogTabRef.current === 'locations') setLocationFilters((current) => ({ ...current, ...detected }));
      } catch {
        // The profile city remains the fallback when permission is denied or GPS is unavailable.
      }
    };
    void detectNearbyCity();
    return () => { cancelled = true; };
  }, []);

  const normalizedQuery = query.trim();
  const isSearching = normalizedQuery.length > 0;
  const items: CatalogItem[] = isSearching
    ? [
        ...pages.map((page) => ({ kind: 'community' as const, value: page })),
        ...accounts.map((account) => ({ kind: 'account' as const, value: account })),
      ]
    : activeCatalogTab === 'locations' && !selectedLocationCategory
      ? []
      : pages.map((page) => ({ kind: 'community' as const, value: page }));

  const loadCatalog = useCallback(async (reset = true, source: 'initial' | 'refresh' = 'initial', signal?: AbortSignal) => {
    if (!reset && !nextCursor) return;
    if (reset) source === 'refresh' ? setIsRefreshing(true) : setIsInitialLoading(true);
    else setIsLoadingMore(true);
    if (reset) setLoadError(null);
    try {
      if (normalizedQuery) {
        const encoded = encodeURIComponent(normalizedQuery);
        const [pagesResponse, accountsResponse] = await Promise.all([
          fetch(`${apiUrl}/public-pages?pageSize=15&q=${encoded}`, { cache: source === 'refresh' ? 'no-store' : undefined, signal }),
          fetch(`${apiUrl}/profiles?pageSize=15&q=${encoded}`, { cache: source === 'refresh' ? 'no-store' : undefined, signal }),
        ]);
        if (!pagesResponse.ok || !accountsResponse.ok) {
          throw new Error('Не удалось выполнить поиск');
        }
        const [pageResults, accountResults] = await Promise.all([
          pagesResponse.json() as Promise<CursorPage<PublicPage>>,
          accountsResponse.json() as Promise<CursorPage<PublicAccount>>,
        ]);
        setPages(pageResults.items);
        setAccounts(accountResults.items);
        setNextCursor(null);
        return;
      }

      if (activeCatalogTab === 'locations' && !selectedLocationCategory) {
        setPages([]);
        setAccounts([]);
        setNextCursor(null);
        return;
      }

      const cursorQuery = !reset && nextCursor ? `&cursor=${encodeURIComponent(nextCursor)}` : '';
      const categoryQuery = `&category=${activeCatalogTab}`;
      const locationCategoryQuery = activeCatalogTab === 'locations' && selectedLocationCategory
        ? `&locationCategory=${encodeURIComponent(selectedLocationCategory)}`
        : '';
      const catalogFilterQuery = `${locationFilters.cityId ? `&cityId=${encodeURIComponent(locationFilters.cityId)}` : ''}${locationFilters.types.length ? `&types=${encodeURIComponent(locationFilters.types.join(','))}` : ''}`;
      const response = await fetch(`${apiUrl}/public-pages?pageSize=15${categoryQuery}${locationCategoryQuery}${catalogFilterQuery}${cursorQuery}`, {
        cache: source === 'refresh' ? 'no-store' : undefined,
        signal,
      });
      if (!response.ok) throw new Error(await readApiError(response, 'Не удалось загрузить каталог'));
      const page = await response.json() as CursorPage<PublicPage>;
      setPages((current) => reset ? page.items : [...current, ...page.items.filter((item) => !current.some((existing) => existing.id === item.id))]);
      setAccounts([]);
      setNextCursor(page.nextCursor);
    } catch (error) {
      if (signal?.aborted) return;
      setLoadError(error instanceof Error ? error.message : 'Не удалось загрузить каталог');
    } finally {
      if (!signal?.aborted) {
        setIsInitialLoading(false);
        setIsRefreshing(false);
        setIsLoadingMore(false);
      }
    }
  }, [activeCatalogTab, locationFilters.cityId, locationFilters.types, nextCursor, normalizedQuery, selectedLocationCategory]);

  useEffect(() => {
    setPages([]);
    setAccounts([]);
    setNextCursor(null);
    setIsInitialLoading(true);
    const controller = new AbortController();
    const timeout = setTimeout(
      () => void loadCatalog(true, 'initial', controller.signal),
      normalizedQuery ? remoteSearchDebounceMs : 0,
    );
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
    // Pagination cursor must not restart the catalog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCatalogTab, locationFilters, query, selectedLocationCategory]);

  const loadLocationCategoryCounts = useCallback(async () => {
    if (activeCatalogTab !== 'locations' || isSearching) return;
    try {
      const cityQuery = locationFilters.cityId ? `?cityId=${encodeURIComponent(locationFilters.cityId)}` : '';
      const response = await fetch(`${apiUrl}/public-pages/location-category-counts${cityQuery}`);
      if (!response.ok) throw new Error(await readApiError(response, 'Не удалось загрузить категории локаций'));
      setLocationCategoryCounts(await response.json() as Record<LocationCategory, number>);
    } catch {
      setLocationCategoryCounts(null);
    }
  }, [activeCatalogTab, isSearching, locationFilters.cityId]);

  useEffect(() => { void loadLocationCategoryCounts(); }, [loadLocationCategoryCounts]);

  const loadingState = isInitialLoading ? <View style={styles.loadingRow}><ActivityIndicator color="#111" /></View> : null;
  const footer = isLoadingMore ? <ActivityIndicator color="#111" style={{ marginVertical: 16 }} /> : null;

  return (
    <>
      <ScreenTopBar onOpenMenu={onOpenMenu} onOpenMessages={onOpenMessages} onOpenNotifications={onOpenNotifications} title="Сообщество" />
      <FlashList
        alwaysBounceVertical
        data={items}
        keyExtractor={(item) => `${item.kind}:${item.value.id}`}
        contentContainerStyle={styles.locationsContent}
        ListHeaderComponent={<>
          {selectedLocationCategory ? null : <View style={styles.catalogSearchWrap}>
            <View style={styles.catalogSearchField}>
              <Search color="#8e99a4" size={19} strokeWidth={1.9} />
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={setQuery}
                placeholder="Поиск людей и сообществ"
                placeholderTextColor="#8e99a4"
                style={styles.catalogSearchInput}
                value={query}
              />
            </View>
          </View>}
          {!isSearching && !(activeCatalogTab === 'locations' && selectedLocationCategory) ? (
            <View accessibilityRole="tablist" style={styles.eventCatalogTabs}>
              {([
                { value: 'locations', label: 'Локации' },
                { value: 'communities', label: 'Сообщества' },
              ] as const).map((tab) => {
                const isActive = activeCatalogTab === tab.value;
                return (
                  <Pressable
                    accessibilityRole="tab"
                    accessibilityState={{ selected: isActive }}
                    key={tab.value}
                    onPress={() => {
                      catalogLocationsRef.current[activeCatalogTab] = {
                        cityId: locationFilters.cityId,
                        cityName: locationFilters.cityName,
                        countryCode: locationFilters.countryCode,
                        countryName: locationFilters.countryName,
                      };
                      activeCatalogTabRef.current = tab.value;
                      setActiveCatalogTab(tab.value);
                      setLocationFilters((current) => ({ ...current, ...catalogLocationsRef.current[tab.value], types: [] }));
                      if (tab.value === 'communities') setSelectedLocationCategory(null);
                    }}
                    style={styles.eventCatalogTab}
                  >
                    <Text style={[styles.eventCatalogTabText, isActive && styles.eventCatalogTabTextActive]}>{tab.label}</Text>
                    {isActive ? <View pointerEvents="none" style={styles.activeTabIndicator} /> : null}
                  </Pressable>
                );
              })}
            </View>
          ) : null}
          {!isSearching && !selectedLocationCategory ? (
            <View style={styles.eventFilterHeader}>
              <View style={styles.eventCatalogControls}>
                <Pressable accessibilityLabel={locationFilters.cityName ? `Местоположение: ${locationFilters.cityName}` : locationFilters.countryName ? `Местоположение: ${locationFilters.countryName}` : 'Выбрать местоположение'} accessibilityRole="button" onPress={() => setIsLocationPickerOpen(true)} style={[styles.connectFilterButton, styles.eventCatalogControlButton, Boolean(locationFilters.cityId || locationFilters.countryCode) && styles.eventFilterButtonActive]}>
                  <MapPin color="#111" size={18} strokeWidth={1.8} />
                  <Text numberOfLines={1} style={[styles.connectFilterButtonText, styles.eventCatalogLocationText]}>{locationFilters.cityName || locationFilters.countryName || 'Местоположение'}</Text>
                </Pressable>
                {activeCatalogTab === 'communities' ? (
                  <Pressable accessibilityLabel={locationFilters.types.length ? `Фильтры, активно: ${locationFilters.types.length}` : 'Фильтры'} accessibilityRole="button" onPress={() => setIsLocationFiltersOpen(true)} style={[styles.connectFilterButton, styles.eventCatalogControlButton, locationFilters.types.length > 0 && styles.eventFilterButtonActive]}>
                    <SlidersHorizontal color="#111" size={18} strokeWidth={1.8} />
                    <Text style={styles.connectFilterButtonText}>Фильтры</Text>
                    {locationFilters.types.length ? <View style={styles.eventFilterCountBadge}><Text style={styles.eventFilterCountBadgeText}>{locationFilters.types.length}</Text></View> : null}
                  </Pressable>
                ) : null}
              </View>
            </View>
          ) : null}
          {!isSearching && activeCatalogTab === 'locations' ? (
            selectedLocationCategory ? <>
              <CatalogInnerHeader
                backLabel="Назад к категориям локаций"
                onBack={() => { setLocationFilters((current) => ({ ...current, types: [] })); setSelectedLocationCategory(null); }}
                title={locationCategoryOptions.find((category) => category.value === selectedLocationCategory)?.label ?? ''}
              />
              <View style={[styles.eventFilterHeader, styles.locationCategoryFilterHeader]}>
                <View style={styles.eventCatalogControls}>
                  <Pressable accessibilityLabel={locationFilters.cityName ? `Местоположение: ${locationFilters.cityName}` : locationFilters.countryName ? `Местоположение: ${locationFilters.countryName}` : 'Выбрать местоположение'} accessibilityRole="button" onPress={() => setIsLocationPickerOpen(true)} style={[styles.connectFilterButton, styles.eventCatalogControlButton, Boolean(locationFilters.cityId || locationFilters.countryCode) && styles.eventFilterButtonActive]}>
                    <MapPin color="#111" size={18} strokeWidth={1.8} />
                    <Text numberOfLines={1} style={[styles.connectFilterButtonText, styles.eventCatalogLocationText]}>{locationFilters.cityName || locationFilters.countryName || 'Местоположение'}</Text>
                  </Pressable>
                </View>
              </View>
            </> : (
              <View accessibilityLabel="Категории локаций" style={styles.eventCategoryGrid}>
                {locationCategoryOptions.map((category) => {
                  const count = locationCategoryCounts?.[category.value];
                  const countLabel = count === undefined ? '—' : `${count} ${russianPlural(count, 'локация', 'локации', 'локаций')}`;
                  return (
                    <CatalogCategoryTile
                      accessibilityLabel={`${category.label}, ${count === undefined ? 'счётчик загружается' : countLabel}`}
                      category={category.label}
                      countLabel={countLabel}
                      coverUrl={categoryCovers[`locations:${category.value}`]}
                      key={category.value}
                      onPress={() => { setLocationFilters((current) => ({ ...current, types: [] })); setSelectedLocationCategory(category.value); }}
                    />
                  );
                })}
              </View>
            )
          ) : null}
        </>}
        refreshControl={<AppRefreshControl refreshing={isRefreshing} tintColor="#111" onRefresh={() => void Promise.all([loadCatalog(true, 'refresh'), loadLocationCategoryCounts(), reloadCategoryCovers()])} />}
        onEndReached={() => !isSearching && (activeCatalogTab !== 'locations' || selectedLocationCategory) && void loadCatalog(false)}
        onEndReachedThreshold={0.4}
        showsVerticalScrollIndicator={false}
        style={styles.screenScroll}
        ListEmptyComponent={activeCatalogTab === 'locations' && !selectedLocationCategory && !isSearching ? null : loadingState ?? (!isInitialLoading && loadError ? <View style={styles.emptyProfileTab}><Text style={styles.emptyProfileTabTitle}>{loadError}</Text><Pressable onPress={() => void loadCatalog(true)} style={styles.notificationsRetryButton}><Text style={styles.notificationsRetryText}>Повторить</Text></Pressable></View> : !isInitialLoading && isSearching ? <Text style={styles.countryEmptyText}>Ничего не найдено</Text> : !isInitialLoading ? <Text style={styles.countryEmptyText}>{activeCatalogTab === 'locations' ? 'Локации не найдены' : 'Сообщества не найдены'}</Text> : null)}
        ListFooterComponent={footer}
        renderItem={({ item }) => {
          if (item.kind === 'account') {
            const account = item.value;
            return (
              <Pressable onPress={() => void onOpenProfile(account.username)} style={[styles.communityRow, styles.catalogAccountRow]}>
                <View style={styles.communityAvatar}>
                  {account.avatarUrl ? <Image source={{ uri: avatarThumbnail(account.avatarUrl) ?? account.avatarUrl }} style={styles.communityAvatarImage} /> : <Text style={styles.communityAvatarText}>{account.name.slice(0, 1).toUpperCase()}</Text>}
                </View>
                <View style={styles.communityCopy}>
                  <VerifiedName isVerified={account.isVerified} name={account.name} style={styles.communityName} />
                  <Text style={styles.communityUsername}>@{account.username}</Text>
                </View>
              </Pressable>
            );
          }

          const page = item.value;
            const locationLabel = formatCountryCity(page.countryName, page.cityName);
            return (
              <Pressable onPress={() => void onOpenPublicPage(page.username)} style={styles.publicPageRow}>
                {page.avatarUrl ? <Image source={{ uri: avatarThumbnail(page.avatarUrl) ?? page.avatarUrl }} style={styles.publicPageAvatar} /> : <View style={styles.publicPageAvatar}><Text style={styles.publicPageAvatarText}>{page.name.slice(0, 1).toUpperCase()}</Text></View>}
                <View style={styles.publicPageCopy}>
                  <VerifiedName badgeSize={13} isVerified={page.isVerified} name={page.name} numberOfLines={1} style={styles.publicPageName} />
                  <Text style={styles.publicPageType}>{page.typeLabel}</Text>
                  {locationLabel ? <Text style={styles.publicPageLocation} numberOfLines={1}>{locationLabel}</Text> : null}
                </View>
              </Pressable>
            );
        }}
      />
      <CatalogFiltersModal
        catalogTab={activeCatalogTab}
        category={selectedLocationCategory}
        initialTypes={locationFilters.types}
        isVisible={isLocationFiltersOpen}
        onApply={(types) => { setLocationFilters((current) => ({ ...current, types })); setIsLocationFiltersOpen(false); }}
        onClose={() => setIsLocationFiltersOpen(false)}
      />
      <LocationPickerModal
        initialCountryName={locationFilters.countryName || undefined}
        isVisible={isLocationPickerOpen}
        onClose={() => setIsLocationPickerOpen(false)}
        onSelect={(location) => {
          if (activeCatalogTab === 'locations') locationsManuallyChangedRef.current = true;
          catalogLocationsRef.current[activeCatalogTab] = {
            cityId: location.cityId,
            cityName: location.cityName,
            countryCode: location.countryCode,
            countryName: location.countryName,
          };
          setLocationFilters((current) => ({
            ...current,
            cityId: location.cityId,
            cityName: location.cityName,
            countryCode: location.countryCode,
            countryName: location.countryName,
          }));
        }}
      />
    </>
  );
}

function CatalogFiltersModal({
  catalogTab,
  category,
  initialTypes,
  isVisible,
  onApply,
  onClose,
}: {
  catalogTab: 'locations' | 'communities';
  category: LocationCategory | null;
  initialTypes: string[];
  isVisible: boolean;
  onApply: (types: string[]) => void;
  onClose: () => void;
}) {
  const [draftTypes, setDraftTypes] = useState(initialTypes);
  const [typeOptions, setTypeOptions] = useState<PublicPageTypeOption[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!isVisible) return;
    setDraftTypes(initialTypes);
    setIsLoading(true);
    const localOptions = publicPageTypeGroups
      .find((group) => group.title === (catalogTab === 'communities' ? 'Организации' : 'Локации'))
      ?.values.map((value) => ({ value, label: publicPageTypeLabels[value] })) ?? [];
    const optionsPromise = category
      ? fetch(`${apiUrl}/public-pages/location-types?category=${encodeURIComponent(category)}`)
        .then(async (response) => response.ok ? response.json() as Promise<PublicPageTypeOption[]> : [])
      : Promise.resolve(localOptions);
    void optionsPromise
      .then((options) => {
        setTypeOptions(options);
        const allowed = new Set(options.map((option) => option.value));
        setDraftTypes((current) => current.filter((value) => allowed.has(value)));
      })
      .catch(() => setTypeOptions([]))
      .finally(() => setIsLoading(false));
  }, [catalogTab, category, initialTypes, isVisible]);

  return (
    <AppSheetModal
      footer={<View style={styles.eventFilterActions}><Pressable onPress={() => setDraftTypes([])} style={styles.eventFilterReset}><Text style={styles.eventFilterResetText}>Сбросить</Text></Pressable><Pressable onPress={() => onApply(draftTypes)} style={styles.eventFilterApply}><Text style={styles.eventFilterApplyText}>Показать</Text></Pressable></View>}
      footerContainerStyle={styles.eventFilterFooter}
      isVisible={isVisible}
      onClose={onClose}
      scroll
      title={catalogTab === 'communities' ? 'Фильтры сообществ' : 'Фильтры локаций'}
    >
      <Text style={[styles.connectFilterTitle, styles.eventFilterFirstTitle]}>{catalogTab === 'communities' ? 'Тип сообщества' : 'Тип локации'}</Text>
      {isLoading ? <ActivityIndicator color="#111" style={{ marginVertical: 18 }} /> : (
        <View style={styles.eventFilterChips}>
          {typeOptions.map((option) => {
            const selected = draftTypes.includes(option.value);
            return (
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selected }}
                key={option.value}
                onPress={() => setDraftTypes((current) => selected ? current.filter((value) => value !== option.value) : [...current, option.value])}
                style={[styles.eventFilterChip, selected && styles.eventFilterChipActive]}
              >
                <Text style={[styles.eventFilterChipText, selected && styles.eventFilterChipTextActive]}>{option.label}</Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </AppSheetModal>
  );
}

export function PublicPageScreen({
  activeContentTab,
  adminMode = false,
  isGlobalAdmin = false,
  authToken,
  canGoBack,
  onBack,
  onContentTabChange,
  onAddPartnerPage,
  onAddTeamMember,
  onOpenMenu,
  onOpenMessages,
  onOpenMention,
  onOpenNotifications,
  onOpenCreateEvent,
  onOpenCommunityCabinet,
  onOpenEditCommunity,
  onOpenProfile,
  onOpenPost,
  focusPostId,
  onOpenPublicPage,
  onBlockPublicPage,
  onReportPublicPage,
  onTogglePublicPageFollow,
  onToggleEventParticipation,
  onToggleFavorite,
  onNotify,
  onRemovePartnerPage,
  onRemoveTeamMember,
  ownAccountId,
  page,
  isRefreshing,
  onRefresh,
}: {
  activeContentTab: PublicPageContentTab;
  adminMode?: boolean;
  isGlobalAdmin?: boolean;
  authToken: string;
  canGoBack: boolean;
  onBack: () => void;
  onContentTabChange: (tab: PublicPageContentTab) => void;
  onAddPartnerPage: (pageUsername: string, data: PartnerPageInput) => Promise<void>;
  onAddTeamMember: (pageUsername: string, data: TeamMemberInput) => Promise<void>;
  onOpenMenu: () => void;
  onOpenMessages: () => void;
  onOpenMention: (username: string) => Promise<void>;
  onOpenNotifications: () => void;
  onOpenCreateEvent: () => void;
  onOpenCommunityCabinet: () => void;
  onOpenEditCommunity: () => void;
  onOpenProfile: (username: string) => Promise<void>;
  onOpenPost: (post: AppPost | QuotedPost) => Promise<void>;
  focusPostId: string | null;
  onOpenPublicPage: (username: string) => Promise<void>;
  onBlockPublicPage: (username: string) => Promise<void>;
  onReportPublicPage: (username: string, reason: 'SPAM' | 'HARASSMENT' | 'IMPERSONATION' | 'ILLEGAL_CONTENT' | 'OTHER') => Promise<void>;
  onTogglePublicPageFollow: (username: string, followStatus: PublicPage['followStatus']) => Promise<void>;
  onToggleEventParticipation: (eventId: string, status: EventParticipationStatus | null) => Promise<EventSummary>;
  onToggleFavorite: (username: string, isFavorite: boolean) => Promise<void>;
  onNotify: (message: string, type?: ToastMessage['type']) => void;
  onRemovePartnerPage: (pageUsername: string, partnerId: string) => Promise<void>;
  onRemoveTeamMember: (pageUsername: string, accountUsername: string) => Promise<void>;
  ownAccountId: string;
  page: PublicPageDetail;
  isRefreshing: boolean;
  onRefresh: () => Promise<void>;
}) {
  const globalAudio = useGlobalAudioControls();
  const [displayedIsFavorite, setDisplayedIsFavorite] = useState(page.isFavorite);
  const [radioNowPlaying, setRadioNowPlaying] = useState<{ artist: string | null; title: string | null }>({ artist: null, title: null });
  useEffect(() => setDisplayedIsFavorite(page.isFavorite), [page.isFavorite, page.username]);
  useEffect(() => {
    if (globalAudio.activeTrack?.radioPageUsername === page.username) setDisplayedIsFavorite(globalAudio.isSavedRadio);
  }, [globalAudio.activeTrack?.radioPageUsername, globalAudio.isSavedRadio, page.username]);
  useEffect(() => {
    if (page.type !== 'RADIO_STATION' || !page.radioStreamUrl?.trim()) {
      setRadioNowPlaying({ artist: null, title: null });
      return;
    }
    let cancelled = false;
    const refresh = async () => {
      try {
        const response = await fetch(`${apiUrl}/public-pages/radio-stream/${encodeURIComponent(page.username)}/now-playing`);
        if (!response.ok) return;
        const result = await response.json() as { artist?: string | null; title?: string | null };
        if (!cancelled) setRadioNowPlaying({
          artist: result.artist?.trim() || null,
          title: result.title?.trim() || null,
        });
      } catch {
        // Keep the station identity when its stream has no ICY metadata.
      }
    };
    void refresh();
    const interval = setInterval(() => void refresh(), 15_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [page.radioStreamUrl, page.type, page.username]);
  const displayedRadioMetadata = globalAudio.activeTrack?.radioPageUsername === page.username
    ? {
        title: globalAudio.activeTrack.title || radioNowPlaying.title,
        artist: globalAudio.activeTrack.artist === 'Радиостанция' ? radioNowPlaying.artist : globalAudio.activeTrack.artist,
      }
    : radioNowPlaying;
  const radioTrack = useMemo<GlobalTrackQueueItem | null>(() => {
    const streamUrl = page.radioStreamUrl?.trim();
    if (page.type !== 'RADIO_STATION' || !streamUrl) return null;
    return {
      id: `radio:${page.id}`,
      title: radioNowPlaying.title || page.name,
      artist: radioNowPlaying.artist || 'Радиостанция',
      artworkUrl: page.avatarUrl,
      previewUrl: streamUrl,
      provider: 'volna',
      collectionTitle: 'Прямой эфир',
      isLiveStream: true,
      radioPageUsername: page.username,
      radioStationName: page.name,
      isRadioFavorite: displayedIsFavorite,
    };
  }, [displayedIsFavorite, page.avatarUrl, page.id, page.name, page.radioStreamUrl, page.type, page.username, radioNowPlaying.artist, radioNowPlaying.title]);
  const isRadioPlaying = Boolean(radioTrack && globalAudio.isTrackPlaying(radioTrack.id));
  const isRadioLoading = Boolean(radioTrack && globalAudio.activeTrack?.id === radioTrack.id && globalAudio.isAudioLoading);
  const playRadio = useCallback(async () => {
    if (!radioTrack) return;
    try {
      if (isRadioPlaying) {
        globalAudio.pause();
        return;
      }
      await globalAudio.play(radioTrack);
    } catch (error) {
      globalAudio.setExpanded(false);
      onNotify(error instanceof Error ? error.message : 'Не удалось запустить радиостанцию', 'error');
    }
  }, [globalAudio, isRadioPlaying, onNotify, radioTrack]);
  const communityTrackProvider = page.trackProvider && ['apple', 'yandex', 'soundcloud', 'bandcamp', 'youtube'].includes(page.trackProvider)
    ? page.trackProvider as 'apple' | 'yandex' | 'soundcloud' | 'bandcamp' | 'youtube'
    : null;
  const hasCommunityTrack = Boolean(communityTrackProvider && page.trackTitle?.trim() && page.trackPreviewUrl?.trim());
  const selectContentTab = (tab: PublicPageContentTab) => {
    onContentTabChange(tab);
    if (Platform.OS === 'web' && typeof window !== 'undefined') window.history.replaceState({}, '', `/${page.username}${tab === 'feed' ? '' : `?tab=${encodeURIComponent(tab)}`}`);
  };
  const [isFollowSaving, setIsFollowSaving] = useState(false);
  const [isFavoriteSaving, setIsFavoriteSaving] = useState(false);
  const [isSafetyMenuOpen, setIsSafetyMenuOpen] = useState(false);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [isAvatarPreviewOpen, setIsAvatarPreviewOpen] = useState(false);
  const [followersViewTab, setFollowersViewTab] = useState<'mutual' | 'followers' | null>(null);
  const [communityEvents, setCommunityEvents] = useState<EventSummary[]>([]);
  const [communityEventsNextCursor, setCommunityEventsNextCursor] = useState<string | null>(null);
  const [areEventsLoaded, setAreEventsLoaded] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<EventSummary | null>(null);
  const [areEventsLoading, setAreEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [isVerified, setIsVerified] = useState(page.isVerified);
  const [isVerificationSaving, setIsVerificationSaving] = useState(false);
  const [ownerUsername, setOwnerUsername] = useState('');
  const [isOwnerSaving, setIsOwnerSaving] = useState(false);
  const [isAudioReleaseModalOpen, setIsAudioReleaseModalOpen] = useState(false);
  const [editingAudioRelease, setEditingAudioRelease] = useState<PublicPageAudioRelease | null>(null);
  const [isInformationNoticeOpen, setIsInformationNoticeOpen] = useState(false);
  const [isInformationFeedbackOpen, setIsInformationFeedbackOpen] = useState(false);
  const [informationFeedback, setInformationFeedback] = useState('');
  const [informationFeedbackType, setInformationFeedbackType] = useState<'CLAIM_COMMUNITY' | 'REPORT_BUG' | 'SUGGEST_IMPROVEMENT'>('CLAIM_COMMUNITY');
  const setIsInformationFeedbackType = setInformationFeedbackType;
  const [isFeedbackTypeMenuOpen, setIsFeedbackTypeMenuOpen] = useState(false);
  const [isInformationFeedbackSending, setIsInformationFeedbackSending] = useState(false);
  const [labelGenreViewportWidth, setLabelGenreViewportWidth] = useState(0);
  const [labelGenreContentWidth, setLabelGenreContentWidth] = useState(0);
  const [labelGenreScrollX, setLabelGenreScrollX] = useState(0);
  const [isAudioReleaseCalendarOpen, setIsAudioReleaseCalendarOpen] = useState(false);
  const [audioReleaseUrl, setAudioReleaseUrl] = useState('');
  const [audioReleaseDate, setAudioReleaseDate] = useState(() => formatCommunityReleaseDateInput(new Date()));
  const [audioReleaseGenres, setAudioReleaseGenres] = useState<string[]>([]);
  const [audioReleaseParticipants, setAudioReleaseParticipants] = useState<string[]>([]);
  const [audioReleaseUseCommunityLabel, setAudioReleaseUseCommunityLabel] = useState(page.type === 'MUSIC_LABEL');
  const [audioReleaseLabelName, setAudioReleaseLabelName] = useState('');
  const [audioReleaseParticipantQuery, setAudioReleaseParticipantQuery] = useState('');
  const [audioReleaseParticipantSuggestions, setAudioReleaseParticipantSuggestions] = useState<Array<{ entityType: 'account' | 'community'; id: string; username: string; name: string; avatarUrl: string | null; canSelect: boolean }>>([]);
  const [isAudioReleaseParticipantSearching, setIsAudioReleaseParticipantSearching] = useState(false);
  const [isAudioReleaseParticipantSearchSettled, setIsAudioReleaseParticipantSearchSettled] = useState(false);
  const [audioReleasePreview, setAudioReleasePreview] = useState<PublicPageAudioRelease | null>(null);
  const [audioReleaseResolveError, setAudioReleaseResolveError] = useState<string | null>(null);
  const [audioReleaseResolveRevision, setAudioReleaseResolveRevision] = useState(0);
  const [isAudioReleaseResolving, setIsAudioReleaseResolving] = useState(false);
  const [publishAudioReleaseToFeed, setPublishAudioReleaseToFeed] = useState(false);
  const [isAudioReleaseSaving, setIsAudioReleaseSaving] = useState(false);
  const [audioReleases, setAudioReleases] = useState<PublicPageAudioRelease[]>(page.audioReleases ?? []);
  const showLabelGenreLeftFade = labelGenreScrollX > 2;
  const showLabelGenreRightFade = labelGenreContentWidth - labelGenreViewportWidth - labelGenreScrollX > 2;
  useEffect(() => {
    setLabelGenreScrollX(0);
    setLabelGenreContentWidth(0);
  }, [page.id, page.musicLabelGenres]);
  const [audioReleasesNextCursor, setAudioReleasesNextCursor] = useState<string | null>(null);
  const [areAudioReleasesLoading, setAreAudioReleasesLoading] = useState(false);
  const [areAudioReleasesLoaded, setAreAudioReleasesLoaded] = useState(false);
  const [teamMembers, setTeamMembers] = useState<PublicPageTeamMember[]>([]);
  const [teamNextCursor, setTeamNextCursor] = useState<string | null>(null);
  const [isTeamLoading, setIsTeamLoading] = useState(false);
  const [isTeamLoaded, setIsTeamLoaded] = useState(false);
  const [partners, setPartners] = useState<PartnerReference[]>([]);
  const [partnersNextCursor, setPartnersNextCursor] = useState<string | null>(null);
  const [arePartnersLoading, setArePartnersLoading] = useState(false);
  const [arePartnersLoaded, setArePartnersLoaded] = useState(false);
  const [products, setProducts] = useState<PublicPageProduct[]>([]);
  const [productsNextCursor, setProductsNextCursor] = useState<string | null>(null);
  const [areProductsLoading, setAreProductsLoading] = useState(false);
  const [areProductsLoaded, setAreProductsLoaded] = useState(false);
  const audioReleaseEditorInsets = useSafeAreaInsets();
  const [visibleContentItemCount, setVisibleContentItemCount] = useState(communityContentPageSize);
  const lastContentLoadHeight = useRef(0);
  useEffect(() => setIsVerified(page.isVerified), [page.id, page.isVerified]);
  const loadAudioReleases = useCallback(async (reset = false) => {
    if (areAudioReleasesLoading || (!reset && areAudioReleasesLoaded && !audioReleasesNextCursor)) return;
    setAreAudioReleasesLoading(true);
    try {
      const cursor = reset ? null : audioReleasesNextCursor;
      const params = new URLSearchParams({ pageSize: String(communityContentPageSize) });
      if (cursor) params.set('cursor', cursor);
      const response = await fetch(`${apiUrl}/public-pages/${encodeURIComponent(page.username)}/audio-releases?${params.toString()}`, {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
      });
      if (!response.ok) throw new Error(await readApiError(response, 'Не удалось загрузить релизы'));
      const result = await response.json() as CursorPage<PublicPageAudioRelease>;
      setAudioReleases((current) => reset ? result.items : [...current, ...result.items.filter((item) => !current.some((existing) => existing.id === item.id))]);
      setAudioReleasesNextCursor(result.nextCursor);
      setAreAudioReleasesLoaded(true);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : 'Не удалось загрузить релизы', 'error');
    } finally {
      setAreAudioReleasesLoading(false);
    }
  }, [areAudioReleasesLoaded, areAudioReleasesLoading, audioReleasesNextCursor, authToken, onNotify, page.username]);
  const loadCommunitySection = useCallback(async <T extends { id: string }>(
    section: 'team' | 'partners' | 'products',
    reset: boolean,
    cursor: string | null,
    setItems: Dispatch<SetStateAction<T[]>>,
    setCursor: (value: string | null) => void,
    setLoaded: (value: boolean) => void,
    setLoading: (value: boolean) => void,
    errorMessage: string,
  ) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ pageSize: String(communityContentPageSize) });
      if (!reset && cursor) params.set('cursor', cursor);
      const response = await fetch(`${apiUrl}/public-pages/${encodeURIComponent(page.username)}/${section}?${params.toString()}`, {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
      });
      if (!response.ok) throw new Error(await readApiError(response, errorMessage));
      const result = await response.json() as CursorPage<T>;
      setItems((current) => reset ? result.items : [...current, ...result.items.filter((item) => !current.some((existing) => existing.id === item.id))]);
      setCursor(result.nextCursor);
      setLoaded(true);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : errorMessage, 'error');
    } finally {
      setLoading(false);
    }
  }, [authToken, onNotify, page.username]);
  const loadTeam = useCallback((reset = false) => {
    if (isTeamLoading || (!reset && isTeamLoaded && !teamNextCursor)) return Promise.resolve();
    return loadCommunitySection('team', reset, teamNextCursor, setTeamMembers, setTeamNextCursor, setIsTeamLoaded, setIsTeamLoading, 'Не удалось загрузить команду');
  }, [isTeamLoaded, isTeamLoading, loadCommunitySection, teamNextCursor]);
  const loadPartners = useCallback((reset = false) => {
    if (arePartnersLoading || (!reset && arePartnersLoaded && !partnersNextCursor)) return Promise.resolve();
    return loadCommunitySection('partners', reset, partnersNextCursor, setPartners, setPartnersNextCursor, setArePartnersLoaded, setArePartnersLoading, 'Не удалось загрузить партнёров');
  }, [arePartnersLoaded, arePartnersLoading, loadCommunitySection, partnersNextCursor]);
  const loadProducts = useCallback((reset = false) => {
    if (areProductsLoading || (!reset && areProductsLoaded && !productsNextCursor)) return Promise.resolve();
    return loadCommunitySection('products', reset, productsNextCursor, setProducts, setProductsNextCursor, setAreProductsLoaded, setAreProductsLoading, 'Не удалось загрузить товары');
  }, [areProductsLoaded, areProductsLoading, loadCommunitySection, productsNextCursor]);
  useEffect(() => {
    setAudioReleases(page.audioReleases ?? []);
    setAudioReleasesNextCursor(null);
    setAreAudioReleasesLoaded(false);
    setTeamMembers([]);
    setTeamNextCursor(null);
    setIsTeamLoaded(false);
    setPartners([]);
    setPartnersNextCursor(null);
    setArePartnersLoaded(false);
    setProducts([]);
    setProductsNextCursor(null);
    setAreProductsLoaded(false);
  }, [page.id]);
  useEffect(() => {
    const query = audioReleaseParticipantQuery.trim().replace(/^@/, '');
    setIsAudioReleaseParticipantSearching(false);
    setIsAudioReleaseParticipantSearchSettled(false);
    if (!isAudioReleaseModalOpen || query.length < 3 || audioReleaseParticipants.length >= 5) {
      setAudioReleaseParticipantSuggestions([]);
      return;
    }
    const controller = new AbortController();
    let isCurrent = true;
    const timer = setTimeout(() => {
      setIsAudioReleaseParticipantSearching(true);
      void Promise.all([
        fetch(`${apiUrl}/search?q=${encodeURIComponent(query)}`, { signal: controller.signal })
          .then(async (response): Promise<{ accounts: Array<{ id: string; username: string; name: string; avatarUrl?: string | null }>; communities: Array<{ id: string; username: string; name: string; avatarUrl?: string | null }> }> => response.ok ? response.json() : { accounts: [], communities: [] }),
        fetch(`${apiUrl}/public-pages/${encodeURIComponent(page.username)}/audio-release-participant-followers?q=${encodeURIComponent(query)}`, { signal: controller.signal })
          .then(async (response): Promise<Array<{ id: string; username: string }>> => response.ok ? response.json() : []),
      ])
        .then(([result, followers]) => {
          if (!isCurrent) return;
          const followerIds = new Set(followers.map((item) => item.id));
          setAudioReleaseParticipantSuggestions([
            ...(result.accounts ?? []).map((item) => ({ entityType: 'account' as const, ...item, avatarUrl: item.avatarUrl ?? null, canSelect: followerIds.has(item.id) })),
            ...(result.communities ?? []).map((item) => ({ entityType: 'community' as const, ...item, avatarUrl: item.avatarUrl ?? null, canSelect: true })),
          ].filter((item) => !audioReleaseParticipants.includes(`@${item.username}`)).slice(0, 6));
        })
        .catch((error: unknown) => {
          if (isCurrent && (error as { name?: string }).name !== 'AbortError') setAudioReleaseParticipantSuggestions([]);
        })
        .finally(() => {
          if (!isCurrent) return;
          setIsAudioReleaseParticipantSearching(false);
          setIsAudioReleaseParticipantSearchSettled(true);
        });
    }, remoteSearchDebounceMs);
    return () => { isCurrent = false; clearTimeout(timer); controller.abort(); };
  }, [audioReleaseParticipantQuery, audioReleaseParticipants, isAudioReleaseModalOpen, page.username]);
  useEffect(() => {
    setIsAudioReleaseResolving(false);
    setAudioReleaseResolveError(null);
    if (!isAudioReleaseModalOpen) { setAudioReleasePreview(null); return; }
    const releaseUrl = audioReleaseUrl.trim();
    if (!releaseUrl) { setAudioReleasePreview(null); return; }
    const normalizeForComparison = (value: string) => value.trim().replace(/\/$/, '').toLowerCase();
    if (editingAudioRelease && normalizeForComparison(releaseUrl) === normalizeForComparison(editingAudioRelease.releaseUrl)) {
      setAudioReleasePreview(editingAudioRelease);
      return;
    }
    setAudioReleasePreview(null);
    let parsed: URL;
    try { parsed = new URL(releaseUrl); } catch { return; }
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const provider = host === 'soundcloud.com' || host === 'on.soundcloud.com'
      ? 'soundcloud'
      : host === 'bandcamp.com' || host.endsWith('.bandcamp.com')
        ? 'bandcamp'
        : host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com' || host === 'youtu.be'
          ? 'youtube'
          : null;
    if (!provider) return;
    const controller = new AbortController();
    let isCurrent = true;
    const timer = setTimeout(() => {
      setIsAudioReleaseResolving(true);
      const request = provider === 'bandcamp'
        ? getBandcampRelease(releaseUrl).then((metadata) => ({ provider, releaseUrl: metadata.externalUrl || releaseUrl, embedUrl: null, metadata }))
        : provider === 'youtube'
          ? fetch(`${apiUrl}/music/resolve?url=${encodeURIComponent(releaseUrl)}`, { signal: controller.signal })
            .then(async (response) => {
              if (!response.ok) throw new Error('Не удалось определить видео YouTube');
              const resolved = await response.json() as { kind: string; track?: { id: string; title: string; artist: string; artworkUrl: string | null; previewUrl: string; externalUrl: string; durationSeconds: number | null } };
              if (resolved.kind !== 'track' || !resolved.track) throw new Error('Ссылка должна вести на видео YouTube');
              const track = resolved.track;
              return {
                provider,
                releaseUrl: track.externalUrl,
                embedUrl: null,
                metadata: {
                  title: track.title,
                  artist: track.artist,
                  artworkUrl: track.artworkUrl,
                  externalUrl: track.externalUrl,
                  tracks: [{ id: track.id, title: track.title, artist: track.artist, artworkUrl: track.artworkUrl, previewUrl: track.previewUrl, externalUrl: track.externalUrl, durationSeconds: track.durationSeconds }],
                },
              };
            })
          : fetch(`${apiUrl}/music/soundcloud/release?url=${encodeURIComponent(releaseUrl)}`, { signal: controller.signal })
          .then(async (response) => {
            if (!response.ok) throw new Error('Не удалось определить релиз');
            const metadata = await response.json() as { title: string; artist: string; artworkUrl: string | null; externalUrl?: string; url?: string; embedUrl?: string; tracks?: Array<{ id: string; title: string; artist: string }> };
            return { provider, releaseUrl: metadata.externalUrl || metadata.url || releaseUrl, embedUrl: metadata.embedUrl ?? null, metadata: { ...metadata, externalUrl: metadata.externalUrl || metadata.url || releaseUrl } };
          });
      void request.then((resolved) => {
        if (!isCurrent) return;
        setIsAudioReleaseResolving(false);
        setAudioReleaseResolveError(null);
        setAudioReleasePreview({
          id: `preview:${resolved.provider}:${resolved.releaseUrl}`,
          provider: resolved.provider as PublicPageAudioRelease['provider'],
          releaseUrl: resolved.releaseUrl,
          embedUrl: resolved.embedUrl,
          genres: [],
          participants: [],
          releaseDate: new Date().toISOString().slice(0, 10),
          createdAt: new Date().toISOString(),
          metadata: resolved.metadata,
        });
      }).catch((reason: unknown) => {
        if (!isCurrent) return;
        setIsAudioReleaseResolving(false);
        setAudioReleasePreview(null);
        setAudioReleaseResolveError(reason instanceof Error ? reason.message : 'Не удалось определить релиз');
      });
    }, 500);
    return () => { isCurrent = false; clearTimeout(timer); controller.abort(); };
  }, [audioReleaseResolveRevision, audioReleaseUrl, editingAudioRelease, isAudioReleaseModalOpen]);
  useEffect(() => setOwnerUsername(''), [page.id, page.ownerId]);
  useEffect(() => {
    setVisibleContentItemCount(communityContentPageSize);
    lastContentLoadHeight.current = 0;
  }, [activeContentTab, page.id]);
  const updateVerification = async (nextValue: boolean) => {
    setIsVerificationSaving(true);
    try {
      const response = await fetch(`${apiUrl}/public-pages/${encodeURIComponent(page.username)}/verification`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ isVerified: nextValue }),
      });
      if (!response.ok) throw new Error(await readApiError(response, 'Не удалось изменить статус сообщества'));
      setIsVerified(nextValue);
      onNotify(nextValue ? 'Сообщество подтверждено' : 'Подтверждение сообщества снято', 'success');
    } catch (error) {
      onNotify(error instanceof Error ? error.message : 'Не удалось изменить статус сообщества', 'error');
    } finally {
      setIsVerificationSaving(false);
    }
  };
  const assignInformationPageOwner = async () => {
    const username = normalizeUsernameInput(ownerUsername);
    if (username.length < 3) {
      onNotify('Введите минимум 3 символа и выберите профиль', 'error');
      return;
    }

    setIsOwnerSaving(true);
    try {
      const response = await fetch(`${apiUrl}/admin/information-pages/${encodeURIComponent(page.id)}/owner`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      });
      if (!response.ok) throw new Error(await readApiError(response, 'Не удалось назначить владельца'));
      setOwnerUsername('');
      onNotify('Владелец сообщества назначен', 'success');
      await onRefresh();
    } catch (error) {
      onNotify(error instanceof Error ? error.message : 'Не удалось назначить владельца', 'error');
    } finally {
      setIsOwnerSaving(false);
    }
  };
  const removeInformationPageOwner = async () => {
    setIsOwnerSaving(true);
    try {
      const response = await fetch(`${apiUrl}/admin/information-pages/${encodeURIComponent(page.id)}/owner`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!response.ok) throw new Error(await readApiError(response, 'Не удалось удалить владельца'));
      onNotify('Владелец удалён. Сообщество снова стало информационным', 'success');
      await onRefresh();
    } catch (error) {
      onNotify(error instanceof Error ? error.message : 'Не удалось удалить владельца', 'error');
    } finally {
      setIsOwnerSaving(false);
    }
  };
  const hasCommunityPermission = useCallback((permission: PublicPagePermission) => (
    page.ownerId === ownAccountId
    || adminMode
    || (!isGlobalAdmin && page.myPermissions.includes(permission))
  ), [adminMode, isGlobalAdmin, ownAccountId, page.myPermissions, page.ownerId]);
  const canManageProfile = hasCommunityPermission('PROFILE_EDIT');
  const canManagePublications = hasCommunityPermission('PUBLICATIONS_MANAGE');
  const canManageMedia = hasCommunityPermission('MEDIA_MANAGE');
  const canManageMusic = hasCommunityPermission('MUSIC_MANAGE');
  const canManageEvents = hasCommunityPermission('EVENTS_MANAGE');
  const canManageProducts = hasCommunityPermission('PRODUCTS_MANAGE');
  const canManageTeam = hasCommunityPermission('TEAM_MANAGE');
  const canManagePartners = hasCommunityPermission('PARTNERS_MANAGE');
  const isCommunityManager = page.ownerId === ownAccountId || adminMode || (!isGlobalAdmin && page.myPermissions.length > 0);
  const canJoinImmediately = isCommunityManager || isGlobalAdmin;
  const isPublished = page.moderationStatus === 'APPROVED';
  const canFollowPage = isPublished;
  const adminCommunityActions = adminMode ? (
    <View style={styles.publicPageAdminActions}>
      <Pressable
        accessibilityLabel="Редактировать профиль сообщества"
        accessibilityRole="button"
        onPress={onOpenEditCommunity}
        style={({ pressed }) => [styles.publicPageAdminAction, pressed && styles.publicPageAdminActionPressed]}
      >
        <Pencil color="#111" size={19} strokeWidth={1.9} />
        <Text numberOfLines={1} style={styles.publicPageAdminActionText}>Профиль</Text>
      </Pressable>
      <Pressable
        accessibilityLabel="Открыть кабинет сообщества"
        accessibilityRole="button"
        onPress={onOpenCommunityCabinet}
        style={({ pressed }) => [styles.publicPageAdminAction, pressed && styles.publicPageAdminActionPressed]}
      >
        <Settings color="#111" size={20} strokeWidth={1.9} />
        <Text numberOfLines={1} style={styles.publicPageAdminActionText}>Кабинет</Text>
      </Pressable>
    </View>
  ) : null;
  const hasPosts = usePostAvailability('community', page.username);
  const locationLabel = formatCountryCity(page.countryName, page.cityName);
  const followButtonLabel =
    page.followStatus === 'PENDING'
      ? 'Ждем подтверждения'
      : page.isFollowing
        ? 'Отписаться'
        : page.isPrivate && !canJoinImmediately
          ? 'Подать заявку'
          : 'Подписаться';
  const isFollowButtonSecondary = Boolean(page.followStatus);
  const visibleContentTabs = useMemo(() => [
    ...(canManagePublications || hasPosts ? [{ label: 'Публикации', value: 'feed' as const, icon: List }] : []),
    ...(canManageMedia ? [{ label: 'Медиа', value: 'photos' as const, icon: Images }] : []),
    ...(canManageMusic || page.audioReleasesCount > 0 ? [{ label: 'Музыка', value: 'music' as const, icon: Disc3 }] : []),
    ...(canManageEvents || page.upcomingEventsCount > 0 ? [{ label: 'События', value: 'events' as const, icon: CalendarDays }] : []),
    ...(canManageTeam || page.teamCount > 0 ? [{ label: 'Команда', value: 'team' as const, icon: UsersRound }] : []),
    ...(canManagePartners || page.partnersCount > 0 ? [{ label: 'Партнеры', value: 'partners' as const, icon: Handshake }] : []),
    ...(canManageProducts || page.productsCount > 0 ? [{ label: 'Товары', value: 'products' as const, icon: ShoppingBag }] : []),
  ], [canManageEvents, canManageMedia, canManageMusic, canManagePartners, canManageProducts, canManagePublications, canManageTeam, hasPosts, page.audioReleasesCount, page.partnersCount, page.productsCount, page.teamCount, page.upcomingEventsCount]);

  useEffect(() => {
    if (activeContentTab === 'music' && !areAudioReleasesLoaded) void loadAudioReleases(true);
  }, [activeContentTab, areAudioReleasesLoaded, loadAudioReleases]);
  useEffect(() => {
    lastContentLoadHeight.current = 0;
  }, [activeContentTab, page.id]);
  useEffect(() => {
    if (activeContentTab === 'team' && !isTeamLoaded) void loadTeam(true);
    if (activeContentTab === 'partners' && !arePartnersLoaded) void loadPartners(true);
    if (activeContentTab === 'products' && !areProductsLoaded) void loadProducts(true);
  }, [activeContentTab, arePartnersLoaded, areProductsLoaded, isTeamLoaded, loadPartners, loadProducts, loadTeam]);

  const openNewAudioRelease = () => {
    setEditingAudioRelease(null);
    setAudioReleasePreview(null);
    setPublishAudioReleaseToFeed(false);
    setAudioReleaseUrl('');
    setAudioReleaseDate(formatCommunityReleaseDateInput(new Date()));
    setAudioReleaseGenres([]);
    setAudioReleaseParticipants([]);
    setAudioReleaseUseCommunityLabel(page.type === 'MUSIC_LABEL');
    setAudioReleaseLabelName('');
    setAudioReleaseParticipantQuery('');
    setIsAudioReleaseModalOpen(true);
  };
  const openAudioReleaseEditor = (release: PublicPageAudioRelease) => {
    setEditingAudioRelease(release);
    setAudioReleasePreview(release);
    setPublishAudioReleaseToFeed(false);
    setAudioReleaseUrl(release.releaseUrl);
    setAudioReleaseDate(formatCommunityReleaseDateInput(new Date(release.releaseDate)));
    setAudioReleaseGenres(release.genres);
    setAudioReleaseParticipants((release.participants ?? []).map((participant) => participant.entityType === 'text' ? participant.name : `@${participant.username}`));
    setAudioReleaseUseCommunityLabel(page.type === 'MUSIC_LABEL' && release.labelPage?.id === page.id);
    setAudioReleaseLabelName(release.labelName ?? '');
    setAudioReleaseParticipantQuery('');
    setIsAudioReleaseModalOpen(true);
  };
  const saveAudioRelease = async () => {
    if (!audioReleaseUrl.trim()) {
      onNotify('Укажите ссылку на релиз SoundCloud, Bandcamp или видео YouTube', 'error');
      return;
    }
    if (!audioReleasePreview) {
      onNotify('Дождитесь успешной проверки ссылки на релиз', 'error');
      return;
    }
    if (!audioReleaseGenres.length || audioReleaseGenres.length > audioReleaseGenreLimit || !audioReleaseGenres.every(isMusicSubgenreValue)) {
      onNotify(`Выберите от 1 до ${audioReleaseGenreLimit} жанров музыки`, 'error');
      return;
    }
    setIsAudioReleaseSaving(true);
    try {
      const response = await fetch(`${apiUrl}/public-pages/${encodeURIComponent(page.username)}/audio-releases${editingAudioRelease ? `/${encodeURIComponent(editingAudioRelease.id)}` : ''}`, {
        method: editingAudioRelease ? 'PATCH' : 'POST',
        headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          releaseUrl: audioReleaseUrl.trim(),
          releaseDate: communityReleaseDateToIso(audioReleaseDate),
          genres: audioReleaseGenres,
          participantUsernames: audioReleaseParticipants,
          useCommunityLabel: page.type === 'MUSIC_LABEL' && audioReleaseUseCommunityLabel,
          labelName: page.type === 'MUSIC_LABEL' && audioReleaseUseCommunityLabel ? '' : audioReleaseLabelName.trim(),
          ...(!editingAudioRelease ? { publishToFeed: publishAudioReleaseToFeed } : {}),
        }),
      });
      if (!response.ok) throw new Error(await readApiError(response, editingAudioRelease ? 'Не удалось обновить релиз' : 'Не удалось добавить релиз'));
      setAudioReleaseUrl('');
      setAudioReleaseDate(formatCommunityReleaseDateInput(new Date()));
      setAudioReleaseGenres([]);
      setAudioReleaseParticipants([]);
      setAudioReleaseUseCommunityLabel(page.type === 'MUSIC_LABEL');
      setAudioReleaseLabelName('');
      setAudioReleaseParticipantQuery('');
      setPublishAudioReleaseToFeed(false);
      setIsAudioReleaseModalOpen(false);
      onNotify(editingAudioRelease ? 'Релиз обновлён' : 'Аудио-релиз добавлен', 'success');
      setEditingAudioRelease(null);
      await onRefresh();
      await loadAudioReleases(true);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : editingAudioRelease ? 'Не удалось обновить релиз' : 'Не удалось добавить релиз', 'error');
    } finally {
      setIsAudioReleaseSaving(false);
    }
  };

  const removeAudioRelease = async (releaseId: string) => {
    try {
      const response = await fetch(`${apiUrl}/public-pages/${encodeURIComponent(page.username)}/audio-releases/${encodeURIComponent(releaseId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!response.ok) throw new Error(await readApiError(response, 'Не удалось удалить релиз'));
      onNotify('Аудио-релиз удалён', 'success');
      await onRefresh();
      await loadAudioReleases(true);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : 'Не удалось удалить релиз', 'error');
    }
  };

  useEffect(() => {
    if (!visibleContentTabs.some((tab) => tab.value === activeContentTab)) {
      onContentTabChange(visibleContentTabs[0]?.value ?? 'feed');
    }
  }, [activeContentTab, onContentTabChange, visibleContentTabs]);

  const loadCommunityEvents = useCallback(async (reset = false) => {
    if (areEventsLoading || (!reset && areEventsLoaded && !communityEventsNextCursor)) return;
    setAreEventsLoading(true);
    setEventsError(null);
    try {
      const params = new URLSearchParams({
        organizerPageId: page.id,
        period: 'upcoming',
        pageSize: String(communityContentPageSize),
      });
      if (!reset && communityEventsNextCursor) params.set('cursor', communityEventsNextCursor);
      const response = await fetch(`${apiUrl}/events?${params.toString()}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!response.ok) throw new Error(await readApiError(response, 'Не удалось загрузить события'));
      const result = await response.json() as CursorPage<EventSummary>;
      setCommunityEvents((current) => reset
        ? result.items
        : [...current, ...result.items.filter((item) => !current.some((existing) => existing.id === item.id))]);
      setCommunityEventsNextCursor(result.nextCursor);
      setAreEventsLoaded(true);
    } catch (error) {
      setEventsError(error instanceof Error ? error.message : 'Не удалось загрузить события');
    } finally {
      setAreEventsLoading(false);
    }
  }, [areEventsLoaded, areEventsLoading, authToken, communityEventsNextCursor, page.id]);

  useEffect(() => {
    setCommunityEvents([]);
    setCommunityEventsNextCursor(null);
    setAreEventsLoaded(false);
    setSelectedEvent(null);
    setEventsError(null);
  }, [page.id]);

  useEffect(() => {
    if (activeContentTab === 'events' && !areEventsLoaded) void loadCommunityEvents(true);
  }, [activeContentTab, areEventsLoaded, loadCommunityEvents]);

  const updateEventParticipation = async (event: EventSummary, status: EventParticipationStatus) => {
    const updated = await onToggleEventParticipation(event.id, event.myParticipationStatus === status ? null : status);
    setCommunityEvents((current) => current.map((item) => item.id === updated.id ? updated : item));
    setSelectedEvent((current) => current?.id === updated.id ? updated : current);
  };

  if (selectedEvent) {
    return <EventDetailScreen authToken={authToken} canManageOverride={canManageEvents} event={selectedEvent} onBack={() => setSelectedEvent(null)} onNotify={onNotify} onOpenMenu={onOpenMenu} onOpenMessages={onOpenMessages} onOpenNotifications={onOpenNotifications} onOpenProfile={onOpenProfile} onOpenPublicPage={onOpenPublicPage} onToggleParticipation={onToggleEventParticipation} onUpdate={(updated) => { setSelectedEvent(updated); setCommunityEvents((current) => current.map((item) => item.id === updated.id ? updated : item)); }} />;
  }

  return (
    <>
      <ScreenTopBar
        canGoBack={canGoBack}
        onBack={onBack}
        onOpenMenu={onOpenMenu}
        onOpenMessages={onOpenMessages}
        onOpenNotifications={onOpenNotifications}
        title="Сообщество"
      />
      <ScrollView
        alwaysBounceVertical
        contentContainerStyle={styles.publicPageContent}
        onScroll={({ nativeEvent }) => {
          if (!['feed', 'music', 'events', 'team', 'partners', 'products'].includes(activeContentTab)) return;
          const isNearBottom = nativeEvent.contentOffset.y + nativeEvent.layoutMeasurement.height >= nativeEvent.contentSize.height - 320;
          const hasListGrown = lastContentLoadHeight.current === 0 || nativeEvent.contentSize.height >= lastContentLoadHeight.current + 120;
          if (!isNearBottom || !hasListGrown) return;
          lastContentLoadHeight.current = nativeEvent.contentSize.height;
          if (activeContentTab === 'feed') {
            setVisibleContentItemCount((current) => current + communityContentPageSize);
          } else if (activeContentTab === 'music') {
            void loadAudioReleases();
          } else if (activeContentTab === 'events') {
            void loadCommunityEvents();
          } else if (activeContentTab === 'team') {
            void loadTeam();
          } else if (activeContentTab === 'partners') {
            void loadPartners();
          } else if (activeContentTab === 'products') {
            void loadProducts();
          }
        }}
        refreshControl={<AppRefreshControl refreshing={isRefreshing} tintColor="#111" onRefresh={() => void onRefresh()} />}
        scrollEventThrottle={100}
        showsVerticalScrollIndicator={false}
      >
        {hasCommunityTrack ? (
          <View style={[styles.profileTrackBar, styles.communityProfileTrackBarScrollable]}>
            <PrimaryTrackInlinePreview
              artist={page.trackArtist}
              artworkUrl={page.trackArtworkUrl}
              autoPlay={false}
              clipDurationSeconds={page.trackClipDurationSeconds}
              previewUrl={page.trackPreviewUrl!}
              provider={communityTrackProvider!}
              startSeconds={page.trackStartSeconds}
              title={page.trackTitle!}
              variant="header"
            />
          </View>
        ) : null}
        {!page.ownerId ? <View style={styles.informationPageBanner}>
          <Pressable accessibilityHint="Открывает пояснение о статусе страницы" accessibilityRole="button" onPress={() => setIsInformationNoticeOpen(true)} style={styles.informationPageBannerHeader}><Text style={styles.informationPageBannerText}>Информационное сообщество</Text><Info color="#53606c" size={15} strokeWidth={2} /></Pressable>
          {adminMode ? <View style={styles.informationPageBannerOwner}>
            <Text style={styles.informationPageBannerOwnerLabel}>Назначить владельца</Text>
            <EntityUsernameLookup
              endAdornment={<Pressable accessibilityLabel="Сохранить владельца" accessibilityRole="button" disabled={isOwnerSaving || normalizeUsernameInput(ownerUsername).length < 3} onPress={() => void assignInformationPageOwner()} style={[styles.entityUsernameSaveButton, (isOwnerSaving || normalizeUsernameInput(ownerUsername).length < 3) && styles.disabledButton]}>{isOwnerSaving ? <ActivityIndicator color="#fff" size="small" /> : <Save color="#fff" size={19} strokeWidth={2} />}</Pressable>}
              entityType="account"
              onChange={setOwnerUsername}
              placeholder="username владельца"
              value={ownerUsername}
            />
            {adminCommunityActions}
          </View> : null}
        </View> : null}
        <View style={styles.publicPageHeroRow}>
          {page.avatarUrl ? (
            <Pressable accessibilityLabel={`Открыть аватар сообщества ${page.name}`} accessibilityRole="button" onPress={() => setIsAvatarPreviewOpen(true)}>
              <Image source={{ uri: page.avatarUrl }} style={styles.publicPageHeroAvatar} resizeMode="cover" />
            </Pressable>
          ) : (
            <View style={[styles.publicPageHeroAvatar, styles.publicPageHeroAvatarPlaceholder]}>
              <Text style={styles.publicPageHeroAvatarText}>{getAvatarInitial(page.name)}</Text>
            </View>
          )}

          <View style={styles.publicPageHeroCopy}>
            <VerifiedName isVerified={isVerified} name={page.name} numberOfLines={2} style={styles.publicPageHeroName} />
            <Text style={styles.publicPageHeroUsername}>@{page.username}</Text>
            <Text style={styles.publicPageHeroType}>{page.typeLabel}</Text>
            {page.moderationStatus === 'PENDING' ? <Text style={styles.informationPageBadge}>На модерации</Text> : null}
            {page.moderationStatus === 'REJECTED' ? <Text style={styles.informationPageBadge}>Отклонено модератором</Text> : null}
            {page.bandcampUrl || page.soundcloudUrl || page.instagramUrl || page.threadsUrl || page.telegramUrl || page.youtubeUrl || page.letterboxdUrl ? <View style={styles.profileSocialIcons}>
              <SocialIcon icon="bandcamp" url={page.bandcampUrl} /><SocialIcon icon="soundcloud" url={page.soundcloudUrl} />
              <SocialIcon icon="instagram" url={page.instagramUrl} /><SocialIcon icon="threads" url={page.threadsUrl} /><SocialIcon icon="telegram" url={page.telegramUrl} /><SocialIcon icon="youtube" url={page.youtubeUrl} /><SocialIcon icon="letterboxd" url={page.letterboxdUrl} />
            </View> : null}
            {normalizeExternalHttpsUrl(page.websiteUrl) ? <Pressable accessibilityRole="link" onPress={() => void openExternalHttpsUrl(page.websiteUrl)} style={styles.publicPageHeroWebsite}><Globe2 size={14} color="#111" strokeWidth={1.8} /><Text numberOfLines={1} style={styles.publicPageHeroWebsiteText}>{page.websiteUrl!.replace(/^https?:\/\//i, '').replace(/\/$/, '')}</Text></Pressable> : null}
            {page.isPrivate ? <Text style={styles.publicPageHeroAccess}>Закрытое сообщество</Text> : null}
            <Pressable accessibilityRole="button" onPress={() => setFollowersViewTab('followers')} style={[styles.followCounterButton, { alignSelf: 'flex-start' }]}><Text style={styles.followCounterText}><Text style={styles.counterNumber}>{page.followersCount}</Text> {russianPlural(page.followersCount, 'подписчик', 'подписчика', 'подписчиков')}</Text></Pressable>
          </View>
        </View>
        {page.contactPhone || locationLabel || page.address || page.about || (page.type === 'MUSIC_LABEL' && page.musicLabelGenres?.length) ? (
          <View style={styles.publicPageDetails}>
            {page.contactPhone ? (
              <View style={styles.publicPageDetailsRow}>
                <Phone size={15} color="#111" strokeWidth={1.8} />
                <Text style={styles.locationText}>{page.contactPhone}</Text>
              </View>
            ) : null}
            {locationLabel ? (
              <View style={styles.publicPageDetailsRow}>
                <MapPin size={15} color="#111" strokeWidth={1.8} />
                <Text style={styles.locationText}>{locationLabel}</Text>
              </View>
            ) : null}
            {page.address ? <Text style={styles.publicPageDetailsAddress}>{page.address}</Text> : null}
            {page.about ? <MentionText onOpenMention={onOpenMention} style={styles.publicPageDetailsAbout}>{page.about}</MentionText> : null}
            {page.type === 'MUSIC_LABEL' && page.musicLabelGenres?.length ? (
              <View style={styles.publicPageLabelGenres}>
                <ScrollView
                  accessibilityLabel="Жанры музыкального лейбла"
                  contentContainerStyle={styles.publicPageLabelGenresContent}
                  horizontal
                  onContentSizeChange={(width) => setLabelGenreContentWidth(width)}
                  onLayout={(event) => setLabelGenreViewportWidth(event.nativeEvent.layout.width)}
                  onScroll={(event) => setLabelGenreScrollX(event.nativeEvent.contentOffset.x)}
                  scrollEventThrottle={16}
                  showsHorizontalScrollIndicator={false}
                >
                  <Text style={styles.publicPageLabelGenresLabel}>Жанры:</Text>
                  {groupMusicGenreChips(page.musicLabelGenres).flatMap((genre) => genre.subgenres.map((subgenre) => (
                    <View key={`${genre.key}:${subgenre}`} style={styles.tag}>
                      <Text numberOfLines={1} style={[styles.tagText, styles.tagGenreText, styles.publicPageLabelGenreText]}>
                        {subgenre}
                      </Text>
                    </View>
                  )))}
                </ScrollView>
                {showLabelGenreLeftFade ? (
                  <View pointerEvents="none" style={[styles.publicPageLabelGenresFade, styles.publicPageLabelGenresFadeLeft]}>
                    <Svg height="100%" width="100%">
                      <Defs><LinearGradient id="label-genres-left" x1="0" y1="0" x2="1" y2="0"><Stop offset="0" stopColor="#fff" stopOpacity="1" /><Stop offset="1" stopColor="#fff" stopOpacity="0" /></LinearGradient></Defs>
                      <Rect fill="url(#label-genres-left)" height="100%" width="100%" />
                    </Svg>
                  </View>
                ) : null}
                {showLabelGenreRightFade ? (
                  <View pointerEvents="none" style={[styles.publicPageLabelGenresFade, styles.publicPageLabelGenresFadeRight]}>
                    <Svg height="100%" width="100%">
                      <Defs><LinearGradient id="label-genres-right" x1="0" y1="0" x2="1" y2="0"><Stop offset="0" stopColor="#fff" stopOpacity="0" /><Stop offset="1" stopColor="#fff" stopOpacity="1" /></LinearGradient></Defs>
                      <Rect fill="url(#label-genres-right)" height="100%" width="100%" />
                    </Svg>
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>
        ) : null}
        {radioTrack ? (
          <Pressable
            accessibilityLabel={isRadioLoading ? 'Аудиопоток загружается' : isRadioPlaying ? 'Приостановить радиостанцию' : 'Слушать радиостанцию'}
            accessibilityRole="button"
            accessibilityState={{ disabled: isRadioLoading }}
            disabled={isRadioLoading}
            onPress={() => void playRadio()}
            style={styles.publicPageRadioPlayer}
          >
            {page.avatarUrl ? <Image source={{ uri: page.avatarUrl }} style={styles.publicPageRadioArtwork} /> : <View style={[styles.publicPageRadioArtwork, styles.publicPageRadioArtworkFallback]}><Radio color="#6f7b86" size={21} strokeWidth={1.8} /></View>}
            <View style={styles.publicPageRadioCopy}>
              <Text numberOfLines={1} style={styles.publicPageRadioTitle}>{displayedRadioMetadata.title || page.name}</Text>
              <Text numberOfLines={1} style={styles.publicPageRadioMeta}>{displayedRadioMetadata.artist || 'Прямой эфир'}</Text>
            </View>
            <View pointerEvents="none" style={styles.publicPageRadioPlayButton}>
              {isRadioLoading ? <ActivityIndicator color="#fff" size="small" /> : isRadioPlaying ? <Pause color="#fff" fill="#fff" size={18} /> : <Play color="#fff" fill="#fff" size={18} />}
            </View>
          </Pressable>
        ) : null}
        {!isCommunityManager ? <MutualFollowersSummary endpoint={`/public-pages/${encodeURIComponent(page.username)}/mutual-followers`} onPress={() => setFollowersViewTab('mutual')} /> : null}

        {adminMode && page.ownerId ? (
          <>
            <View style={[styles.settingsCard, styles.publicPageAdminCard, { alignItems: 'center', flexDirection: 'row' }]}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={styles.settingsLabel}>Подтвержденный аккаунт</Text>
                <Text style={{ color: '#6f7b86', fontSize: 14, lineHeight: 19, marginTop: 3 }}>Галочка будет отображаться рядом с названием сообщества во всех разделах VOLNA.</Text>
              </View>
              <VolnaSwitch disabled={isVerificationSaving} value={isVerified} onValueChange={(value) => void updateVerification(value)} />
            </View>
            <View style={styles.informationPageOwnerCard}>
              <Text style={styles.settingsLabel}>Владелец сообщества</Text>
              {page.owner ? (
                <Pressable accessibilityRole="link" onPress={() => void onOpenProfile(page.owner!.username)} style={styles.informationPageCurrentOwner}>
                  {page.owner.avatarUrl ? (
                    <Image source={{ uri: page.owner.avatarUrl }} style={styles.informationPageCurrentOwnerAvatar} />
                  ) : (
                    <View style={[styles.informationPageCurrentOwnerAvatar, styles.publicPageHeroAvatarPlaceholder]}>
                      <Text style={styles.informationPageCurrentOwnerAvatarText}>{getAvatarInitial(page.owner.name)}</Text>
                    </View>
                  )}
                  <View style={styles.informationPageCurrentOwnerCopy}>
                    <VerifiedName isVerified={page.owner.isVerified} name={page.owner.name} numberOfLines={1} style={styles.informationPageCurrentOwnerName} />
                    <Text numberOfLines={1} style={styles.informationPageCurrentOwnerUsername}>@{page.owner.username}</Text>
                  </View>
                </Pressable>
              ) : (
                <Text style={styles.informationPageOwnerDescription}>Данные владельца обновляются.</Text>
              )}
              <Pressable
                accessibilityRole="button"
                disabled={isOwnerSaving}
                onPress={() => void removeInformationPageOwner()}
                style={[styles.informationPageRemoveOwnerButton, isOwnerSaving && styles.disabledButton]}
              >
                {isOwnerSaving ? <ActivityIndicator color="#d93025" /> : <Text style={styles.informationPageRemoveOwnerText}>Удалить владельца</Text>}
              </Pressable>
            </View>
            {adminCommunityActions}
          </>
        ) : null}
        <View style={styles.publicPageActionsRow}>
          {canFollowPage ? (
            <Pressable
              disabled={isFollowSaving}
              onPress={async () => {
                setIsFollowSaving(true);
                try {
                  await onTogglePublicPageFollow(page.username, page.followStatus);
                } catch (error) {
                  onNotify(error instanceof Error ? error.message : 'Не удалось обновить подписку', 'error');
                } finally {
                  setIsFollowSaving(false);
                }
              }}
              style={[
                styles.publicPageFollowButton,
                isFollowButtonSecondary && styles.publicPageFollowButtonSecondary,
                isFollowSaving && styles.disabledButton,
              ]}
            >
              {isFollowSaving ? (
                <ActivityIndicator color={isFollowButtonSecondary ? '#111' : '#fff'} />
              ) : (
                <Text style={[styles.publicPageFollowText, isFollowButtonSecondary && styles.publicPageFollowTextSecondary]}>
                  {followButtonLabel}
                </Text>
              )}
            </Pressable>
          ) : null}
          {isPublished ? (
            <>
              <Pressable accessibilityLabel={displayedIsFavorite ? 'Удалить из любимых сообществ' : 'Добавить в любимые сообщества'} accessibilityRole="button" accessibilityState={{ selected: displayedIsFavorite, disabled: isFavoriteSaving }} disabled={isFavoriteSaving} onPress={async () => { setIsFavoriteSaving(true); const nextFavorite = !displayedIsFavorite; try { if (globalAudio.activeTrack?.radioPageUsername === page.username) await globalAudio.toggleFavoriteRadio(); else await onToggleFavorite(page.username, displayedIsFavorite); setDisplayedIsFavorite(nextFavorite); } finally { setIsFavoriteSaving(false); } }} style={[styles.messageButton, !displayedIsFavorite && styles.favoriteLocationButtonActive]}>
                <Heart size={21} color={displayedIsFavorite ? '#111' : '#fff'} fill={displayedIsFavorite ? '#111' : 'transparent'} />
              </Pressable>
              <Pressable accessibilityLabel="Поделиться сообществом" accessibilityRole="button" onPress={() => setIsShareOpen(true)} style={styles.messageButton}>
                <Share2 size={21} color="#111" strokeWidth={1.8} />
              </Pressable>
            </>
          ) : null}
          {!isCommunityManager ? (
            <Pressable onPress={() => setIsSafetyMenuOpen(true)} style={styles.messageButton}>
              <EllipsisVertical size={22} color="#111" strokeWidth={1.9} />
            </Pressable>
          ) : null}
        </View>

        <EntityShareModal
          authToken={authToken}
          chatPublicPageId={page.id}
          chatSnapshot={{ avatarUrl: page.avatarUrl, isVerified: page.isVerified, name: page.name, subtitle: page.typeLabel, username: page.username }}
          isVisible={isShareOpen}
          onClose={() => setIsShareOpen(false)}
          onNotify={onNotify}
          repost={{
            previewTitle: page.name,
            previewMeta: `@${page.username} · ${page.typeLabel}`,
          }}
          shareText={`${page.name} (@${page.username}) в VOLNA\nhttps://volna.social/${encodeURIComponent(page.username)}`}
          shareTitle={page.name}
          shareUrl={`https://volna.social/${encodeURIComponent(page.username)}`}
          subjectLabel="Сообщество"
        />

        <ProfileSafetyModal
          isVisible={!isCommunityManager && isSafetyMenuOpen}
          onBlock={async () => {
            setIsSafetyMenuOpen(false);
            await onBlockPublicPage(page.username);
          }}
          onClose={() => setIsSafetyMenuOpen(false)}
          onNotify={onNotify}
          onReport={async (reason) => {
            setIsSafetyMenuOpen(false);
            await onReportPublicPage(page.username, reason);
          }}
          targetKind="community"
        />

        {visibleContentTabs.length ? <View style={styles.tabs}>
          {visibleContentTabs.map((tab) => {
            const isActive = activeContentTab === tab.value;
            const Icon = tab.icon;

            return (
              <Pressable
                accessibilityLabel={tab.value === 'events' && page.upcomingEventsCount > 0 ? `${tab.label}, предстоящих: ${page.upcomingEventsCount}` : tab.label}
                accessibilityRole="tab"
                accessibilityState={{ selected: isActive }}
                key={tab.value}
                onPress={() => selectContentTab(tab.value)}
                style={[styles.profileTabButton, isActive && styles.activeTab]}
              >
                <View style={styles.communityTabIconWrap}>
                  <Icon color={isActive ? '#111' : '#6f7b86'} size={22} strokeWidth={isActive ? 2.1 : 1.8} />
                  {tab.value === 'events' && page.upcomingEventsCount > 0 ? (
                    <View style={styles.communityEventCountBadge}>
                      <Text style={styles.communityEventCountText}>{page.upcomingEventsCount > 99 ? '99+' : page.upcomingEventsCount}</Text>
                    </View>
                  ) : null}
                </View>
                {isActive ? <View pointerEvents="none" style={styles.activeTabIndicator} /> : null}
              </Pressable>
            );
          })}
        </View> : null}

        {activeContentTab === 'events' ? (
          <View style={styles.publicPageTeamList}>
            {canManageEvents ? <Pressable accessibilityRole="button" onPress={onOpenCreateEvent} style={styles.postComposerTrigger}><Plus color="#111" size={20} strokeWidth={2} /><Text style={styles.postComposerTriggerText}>Добавить событие</Text></Pressable> : null}
            <Text style={[styles.sectionTitle, styles.communityEventsSectionTitle, canManageEvents && styles.communityEventsSectionTitleAfterAction]}>
              <Text style={styles.sectionSlash}>/ </Text>
              Предстоящие события
            </Text>
            {areEventsLoading && !communityEvents.length ? <ActivityIndicator color="#111" style={{ marginVertical: 24 }} /> : null}
            {eventsError && !communityEvents.length ? <View style={styles.emptyProfileTab}><Text style={styles.emptyProfileTabTitle}>Не удалось загрузить события</Text><Text style={styles.emptyProfileTabText}>{eventsError}</Text><Pressable accessibilityRole="button" onPress={() => void loadCommunityEvents(true)} style={styles.postComposerTrigger}><Text style={styles.postComposerTriggerText}>Повторить</Text></Pressable></View> : null}
            {!areEventsLoading && !eventsError && !communityEvents.length ? <View style={styles.emptyProfileTab}><CalendarDays color="#111" size={28} strokeWidth={1.8} /><Text style={styles.emptyProfileTabTitle}>Событий пока нет</Text></View> : null}
            {communityEvents.map((event) => <EventCard compactList flushHorizontal key={event.id} event={event} onOpen={() => setSelectedEvent(event)} onOpenPublicPage={onOpenPublicPage} onSetParticipation={(status) => void updateEventParticipation(event, status).catch((error) => onNotify(error instanceof Error ? error.message : 'Не удалось обновить участие', 'error'))} />)}
            {areEventsLoading && communityEvents.length ? <ActivityIndicator color="#111" style={{ marginVertical: 16 }} /> : null}
          </View>
        ) : null}

        {activeContentTab === 'team' ? (
          <PublicPageTeamSection
            canManage={canManageTeam}
            showEditor
            members={teamMembers}
            onAddTeamMember={async (data) => {
              await onAddTeamMember(page.username, data);
              await loadTeam(true);
            }}
            onNotify={onNotify}
            onOpenProfile={onOpenProfile}
            onRemoveTeamMember={async (accountUsername) => {
              await onRemoveTeamMember(page.username, accountUsername);
              await loadTeam(true);
            }}
          />
        ) : null}
        {activeContentTab === 'team' && isTeamLoading && !teamMembers.length ? <ActivityIndicator color="#111" style={{ marginVertical: 24 }} /> : null}
        {activeContentTab === 'team' && isTeamLoading && teamMembers.length ? <ActivityIndicator color="#111" style={{ marginVertical: 16 }} /> : null}

        {activeContentTab === 'partners' ? (
          <PublicPagePartnersSection
            canManage={canManagePartners}
            showEditor
            onAddPartnerPage={async (data) => {
              await onAddPartnerPage(page.username, data);
              await loadPartners(true);
            }}
            onNotify={onNotify}
            onOpenPublicPage={onOpenPublicPage}
            onRemovePartnerPage={async (partnerId) => {
              await onRemovePartnerPage(page.username, partnerId);
              await loadPartners(true);
            }}
            partners={partners}
          />
        ) : null}
        {activeContentTab === 'partners' && arePartnersLoading && !partners.length ? <ActivityIndicator color="#111" style={{ marginVertical: 24 }} /> : null}
        {activeContentTab === 'partners' && arePartnersLoading && partners.length ? <ActivityIndicator color="#111" style={{ marginVertical: 16 }} /> : null}

        {activeContentTab === 'music' ? (
          <CommunityAudioReleasesSection
            allReleases={audioReleases}
            canManage={canManageMusic}
            onAdd={openNewAudioRelease}
            onEdit={openAudioReleaseEditor}
            onNeedMoreReleases={audioReleasesNextCursor ? () => void loadAudioReleases() : undefined}
            releases={audioReleases}
          />
        ) : null}
        {activeContentTab === 'music' && areAudioReleasesLoading && !audioReleases.length ? <ActivityIndicator color="#111" style={{ marginVertical: 24 }} /> : null}
        {activeContentTab === 'music' && areAudioReleasesLoading && audioReleases.length ? <ActivityIndicator color="#111" style={{ marginVertical: 16 }} /> : null}

        {activeContentTab === 'products' ? (
          <PublicPageProductsSection
            authToken={authToken}
            canManage={canManageProducts}
            initialProducts={products}
            onNotify={onNotify}
            pageUsername={page.username}
          />
        ) : null}
        {activeContentTab === 'products' && areProductsLoading ? <ActivityIndicator color="#111" style={{ marginVertical: 16 }} /> : null}

        {activeContentTab === 'feed' ? <PostFeed authToken={authToken} authorType="community" canCreate={canManagePublications} composerAuthor={{ avatarUrl: page.avatarUrl, isVerified: page.isVerified, name: page.name, username: page.username }} CropModal={AvatarCropModal} focusPostId={focusPostId} maxItems={visibleContentItemCount} onNotify={onNotify} onOpenPost={onOpenPost} onOpenProfile={onOpenProfile} onOpenPublicPage={onOpenPublicPage} username={page.username} /> : null}

        {canManageMedia && activeContentTab === 'photos' ? (
          <View style={styles.emptyProfileTab}>
            <Images color="#111" size={29} strokeWidth={1.8} />
            <Text style={styles.emptyProfileTabTitle}>Медиа появятся здесь</Text>
            <Text style={styles.emptyProfileTabText}>Здесь будут фотографии и другие медиа сообщества.</Text>
          </View>
        ) : null}

      </ScrollView>
      <AvatarPreviewModal imageUrl={page.avatarOriginalUrl ?? page.avatarUrl} isVisible={Boolean(page.avatarUrl) && isAvatarPreviewOpen} name={page.name} onClose={() => setIsAvatarPreviewOpen(false)} />
      <FollowListModal
        initialTab={followersViewTab ?? 'followers'}
        isVisible={followersViewTab !== null}
        onClose={() => setFollowersViewTab(null)}
        onOpenProfile={onOpenProfile}
        tabs={[
          ...(!isCommunityManager ? [{ key: 'mutual', label: 'Общие', endpoint: `/public-pages/${encodeURIComponent(page.username)}/mutual-followers` }] : []),
          { key: 'followers', label: `${page.followersCount} ${russianPlural(page.followersCount, 'подписчик', 'подписчика', 'подписчиков')}`, endpoint: `/public-pages/${encodeURIComponent(page.username)}/followers-list` },
        ]}
        title={`@${page.username}`}
      />
      <AppSheetModal contentContainerStyle={styles.informationPageNoticeContent} isVisible={isInformationNoticeOpen} onClose={() => setIsInformationNoticeOpen(false)} title="Об информационном сообществе">
        <Text style={styles.informationPageNoticeText}>Эта страница создана администрацией VOLNA в информационных целях и не является официальным представительством указанного сообщества, организации или бренда.</Text>
        <Text style={styles.informationPageNoticeText}>Размещённые сведения собраны из открытых источников.</Text>
        <Text style={styles.informationPageNoticeText}>Если вы являетесь уполномоченным представителем этой организации или бренда, пожалуйста, свяжитесь с нами.</Text>
        <Pressable accessibilityRole="link" onPress={() => { setIsInformationNoticeOpen(false); setIsInformationFeedbackOpen(true); }}><Text style={styles.informationPageNoticeLink}>Перейти к форме обратной связи</Text></Pressable>
      </AppSheetModal>
      <Modal animationType="slide" onRequestClose={() => setIsInformationFeedbackOpen(false)} visible={isInformationFeedbackOpen}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.editShell}>
          <View style={styles.topBar}><View style={styles.topBarLeft}><Pressable accessibilityLabel="Назад" onPress={() => setIsInformationFeedbackOpen(false)} style={styles.topBarIconButton}><ChevronLeft color="#111" size={29} /></Pressable><Text style={styles.topBarTitle}>Обратная связь</Text></View></View>
          <ScrollView contentContainerStyle={[styles.editContent, styles.feedbackFormContent]} keyboardShouldPersistTaps="handled">
            <Text style={styles.feedbackFieldLabel}>Тип обращения</Text>
            <View style={styles.feedbackTypeSelectWrap}>
              <Pressable accessibilityRole="button" accessibilityState={{ expanded: isFeedbackTypeMenuOpen }} onPress={() => setIsFeedbackTypeMenuOpen((value) => !value)} style={styles.feedbackTypeSelect}><Text numberOfLines={1} style={styles.feedbackTypeSelectText}>{informationFeedbackType === 'CLAIM_COMMUNITY' ? 'Заявить о правах на сообщество' : informationFeedbackType === 'REPORT_BUG' ? 'Сообщить о баге' : 'Предложение по улучшению'}</Text><ChevronDown color="#606c78" size={18} /></Pressable>
              {isFeedbackTypeMenuOpen ? <View style={styles.feedbackTypeDropdown}>{([
                ['CLAIM_COMMUNITY', 'Заявить о правах на сообщество'], ['REPORT_BUG', 'Сообщить о баге'], ['SUGGEST_IMPROVEMENT', 'Предложение по улучшению'],
              ] as const).map(([value, label]) => <Pressable key={value} onPress={() => { setInformationFeedbackType(value); setIsFeedbackTypeMenuOpen(false); }} style={[styles.feedbackTypeDropdownOption, informationFeedbackType === value && styles.feedbackTypeDropdownOptionActive]}><Text style={[styles.feedbackTypeDropdownText, informationFeedbackType === value && styles.feedbackTypeDropdownTextActive]}>{label}</Text>{informationFeedbackType === value ? <Check color="#fff" size={18} /> : null}</Pressable>)}</View> : null}
            </View>
            {informationFeedbackType === 'CLAIM_COMMUNITY' ? <View style={styles.feedbackClaimBlock}>
              <Text style={styles.feedbackFormTitle}>Представительство сообщества</Text>
              <Text style={styles.feedbackFormDescription}>Сообщите, какую организацию вы представляете и как администрация VOLNA может связаться с вами. Обращение будет доступно только администраторам.</Text>
              <View style={[styles.moderationCard, styles.feedbackCommunityCard]}><Text style={styles.moderationTitle}>{page.name}</Text><Text style={styles.moderationMeta}>@{page.username}</Text></View>
            </View> : null}
            <TextInput maxLength={2000} multiline onChangeText={setInformationFeedback} placeholder="Ваше сообщение" placeholderTextColor="#8e99a4" style={[styles.editInput, styles.editTextArea, styles.feedbackMessageInput]} textAlignVertical="top" value={informationFeedback} />
            <Text style={styles.feedbackCounter}>{informationFeedback.length}/2000</Text>
            <Pressable disabled={isInformationFeedbackSending || informationFeedback.trim().length < 20} onPress={async () => { setIsInformationFeedbackSending(true); try { const response = await fetch(`${apiUrl}/public-pages/${encodeURIComponent(page.username)}/information-message`, { method: 'POST', headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: informationFeedbackType, message: informationFeedback.trim() }) }); if (!response.ok) throw new Error(await readApiError(response, 'Не удалось отправить сообщение')); setInformationFeedback(''); setIsInformationFeedbackType('CLAIM_COMMUNITY'); setIsInformationFeedbackOpen(false); onNotify('Сообщение отправлено администрации'); } catch (error) { onNotify(error instanceof Error ? error.message : 'Не удалось отправить сообщение', 'error'); } finally { setIsInformationFeedbackSending(false); } }} style={[styles.saveProfileButton, (isInformationFeedbackSending || informationFeedback.trim().length < 20) && styles.disabledButton]}>{isInformationFeedbackSending ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveProfileText}>Отправить</Text>}</Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
      <Modal animationType="slide" onRequestClose={() => { setIsAudioReleaseModalOpen(false); setEditingAudioRelease(null); }} visible={isAudioReleaseModalOpen}>
        <View style={[styles.communityAudioEditor, { paddingTop: audioReleaseEditorInsets.top, paddingBottom: audioReleaseEditorInsets.bottom }]}>
          <View style={styles.communityAudioEditorHeader}>
            <Pressable accessibilityRole="button" onPress={() => { setIsAudioReleaseModalOpen(false); setEditingAudioRelease(null); }} style={styles.communityAudioEditorCancel}><Text style={styles.communityAudioEditorCancelText}>Отмена</Text></Pressable>
            <View style={styles.communityAudioEditorHeaderSpacer} />
            <Pressable accessibilityRole="button" disabled={isAudioReleaseSaving || !audioReleasePreview || !audioReleaseGenres.length || audioReleaseGenres.length > audioReleaseGenreLimit || !audioReleaseGenres.every(isMusicSubgenreValue)} onPress={() => void saveAudioRelease()} style={[styles.communityAudioEditorSubmit, (isAudioReleaseSaving || !audioReleasePreview || !audioReleaseGenres.length || audioReleaseGenres.length > audioReleaseGenreLimit || !audioReleaseGenres.every(isMusicSubgenreValue)) && styles.disabledButton]}>
              {isAudioReleaseSaving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.communityAudioEditorSubmitText}>{editingAudioRelease ? 'Сохранить' : 'Добавить'}</Text>}
            </Pressable>
          </View>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.communityAudioEditorKeyboard}>
            <ScrollView contentContainerStyle={styles.communityAudioEditorContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <View style={styles.communityAudioReleaseSourceAndDate}>
                <ExternalReleaseEditorField
                  error={audioReleaseResolveError}
                  hint="Поддерживаются ссылки SoundCloud, Bandcamp и YouTube."
                  isResolving={isAudioReleaseResolving}
                  onChangeText={setAudioReleaseUrl}
                  onResolve={() => setAudioReleaseResolveRevision((current) => current + 1)}
                  preview={audioReleasePreview}
                  surface="grouped"
                  value={audioReleaseUrl}
                />
                <Pressable accessibilityRole="button" onPress={() => setIsAudioReleaseCalendarOpen(true)} style={styles.communityAudioDateButton}>
                  <CalendarDays color="#6f7b86" size={20} strokeWidth={1.8} />
                  <View style={{ flex: 1 }}><Text style={styles.communityAudioDateLabel}>Дата релиза</Text><Text style={styles.communityAudioDateValue}>{audioReleaseDate}</Text></View>
                  <ChevronRight color="#6f7b86" size={19} strokeWidth={1.8} />
                </Pressable>
              </View>
              <View style={styles.communityAudioLabelSection}>
                <Text style={styles.communityAudioParticipantsTitle}>Лейбл</Text>
                {page.type === 'MUSIC_LABEL' ? (
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: audioReleaseUseCommunityLabel }}
                    onPress={() => {
                      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                      setAudioReleaseUseCommunityLabel((current) => !current);
                    }}
                    style={styles.communityAudioLabelCheckboxRow}
                  >
                    <View style={[styles.communityAudioPublishCheckbox, audioReleaseUseCommunityLabel && styles.communityAudioPublishCheckboxActive]}>
                      {audioReleaseUseCommunityLabel ? <Check color="#fff" size={15} strokeWidth={2.5} /> : null}
                    </View>
                    <Text style={styles.communityAudioLabelCheckboxText}>Указать {page.musicLabelName?.trim() || page.name} в качестве лейбла</Text>
                  </Pressable>
                ) : null}
                {page.type !== 'MUSIC_LABEL' || !audioReleaseUseCommunityLabel ? (
                  <TextInput
                    accessibilityLabel="Название лейбла"
                    autoCapitalize="words"
                    autoCorrect={false}
                    maxLength={80}
                    onChangeText={setAudioReleaseLabelName}
                    placeholder="Название лейбла"
                    placeholderTextColor="#98a3ae"
                    style={styles.communityAudioLabelInput}
                    value={audioReleaseLabelName}
                  />
                ) : null}
              </View>
              <View style={styles.communityAudioParticipantsSection}>
                <Text style={styles.communityAudioParticipantsTitle}>Участники релиза</Text>
                <Text style={styles.communityAudioParticipantsHint}>До 5 профилей, сообществ или имён текстом</Text>
                {audioReleaseParticipants.length ? <View style={styles.communityAudioParticipantChips}>{audioReleaseParticipants.map((participant) => <View key={participant} style={styles.communityAudioParticipantChip}><Text numberOfLines={1} style={[styles.communityAudioParticipantChipText, participant.startsWith('@') && styles.communityAudioParticipantChipUsername]}>{participant}</Text><Pressable accessibilityLabel={`Удалить ${participant}`} onPress={() => setAudioReleaseParticipants((current) => current.filter((item) => item !== participant))}><X color="#6f7b86" size={16} /></Pressable></View>)}</View> : null}
                <View style={styles.communityAudioParticipantInputRow}><TextInput autoCapitalize="none" autoCorrect={false} editable={audioReleaseParticipants.length < 5} maxLength={80} onChangeText={setAudioReleaseParticipantQuery} onSubmitEditing={() => { const value = audioReleaseParticipantQuery.trim(); if (!value || audioReleaseParticipants.some((item) => item.toLowerCase() === value.toLowerCase())) return; if (value.startsWith('@')) { onNotify('Выберите профиль из списка результатов', 'error'); return; } setAudioReleaseParticipants((current) => [...current, value].slice(0, 5)); setAudioReleaseParticipantQuery(''); setAudioReleaseParticipantSuggestions([]); }} placeholder="@username или имя участника" placeholderTextColor="#98a3ae" style={styles.communityAudioParticipantInput} value={audioReleaseParticipantQuery} /><Pressable accessibilityLabel="Добавить участника текстом" disabled={!audioReleaseParticipantQuery.trim() || audioReleaseParticipants.length >= 5} onPress={() => { const value = audioReleaseParticipantQuery.trim(); if (!value || audioReleaseParticipants.some((item) => item.toLowerCase() === value.toLowerCase())) return; if (value.startsWith('@')) { onNotify('Выберите профиль из списка результатов', 'error'); return; } setAudioReleaseParticipants((current) => [...current, value].slice(0, 5)); setAudioReleaseParticipantQuery(''); setAudioReleaseParticipantSuggestions([]); }} style={[styles.communityAudioParticipantAdd, (!audioReleaseParticipantQuery.trim() || audioReleaseParticipants.length >= 5) && styles.disabledButton]}><Plus color="#111" size={20} /></Pressable></View>
                {audioReleaseParticipantQuery.trim().replace(/^@/, '').length > 0 && audioReleaseParticipantQuery.trim().replace(/^@/, '').length < 3 ? <Text style={styles.communityAudioParticipantSearchHint}>Поиск начнётся после ввода 3 символов</Text> : null}
                {isAudioReleaseParticipantSearching ? <View style={styles.communityAudioParticipantSearchStatus}><ActivityIndicator color="#6f7b86" size="small" /><Text style={styles.communityAudioParticipantSearchStatusText}>Ищем профили и сообщества…</Text></View> : null}
                {audioReleaseParticipantSuggestions.length ? <View style={styles.communityAudioParticipantSuggestions}>{audioReleaseParticipantSuggestions.map((suggestion) => <Pressable accessibilityRole="button" key={`${suggestion.entityType}:${suggestion.id}`} onPress={() => { if (!suggestion.canSelect) { onNotify('Профиль не подписан на сообщество', 'error'); return; } setAudioReleaseParticipants((current) => [...current, `@${suggestion.username}`].slice(0, 5)); setAudioReleaseParticipantQuery(''); setAudioReleaseParticipantSuggestions([]); }} style={styles.entityUsernameSuggestionRow}>{suggestion.avatarUrl ? <Image source={{ uri: suggestion.avatarUrl }} style={styles.entityUsernameSuggestionAvatar} /> : <View style={styles.entityUsernameSuggestionAvatar}><Text style={styles.entityUsernameSuggestionAvatarText}>{getAvatarInitial(suggestion.name)}</Text></View>}<View style={styles.publicPageTeamCopy}><Text numberOfLines={1} style={styles.publicPageTeamName}>{suggestion.name}</Text><Text numberOfLines={1} style={styles.publicPageTeamUsername}>@{suggestion.username} · {suggestion.entityType === 'account' ? 'Профиль' : 'Сообщество'}</Text></View></Pressable>)}</View> : null}
                {isAudioReleaseParticipantSearchSettled && !audioReleaseParticipantSuggestions.length ? <Text style={styles.communityAudioParticipantSearchHint}>Профили и сообщества не найдены</Text> : null}
              </View>
              <MusicGenreSelector editorCard maxSelected={audioReleaseGenreLimit} primarySelectionCount={releasePrimaryGenreLimit} selected={audioReleaseGenres} subgenresOnly title="Жанры релиза" onChange={setAudioReleaseGenres} />
              {!editingAudioRelease ? <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: publishAudioReleaseToFeed }} onPress={() => setPublishAudioReleaseToFeed((current) => !current)} style={styles.communityAudioPublishRow}>
                <View style={[styles.communityAudioPublishCheckbox, publishAudioReleaseToFeed && styles.communityAudioPublishCheckboxActive]}>{publishAudioReleaseToFeed ? <Check color="#fff" size={15} strokeWidth={2.5} /> : null}</View>
                <View style={styles.communityAudioPublishCopy}><Text style={styles.communityAudioPublishTitle}>Опубликовать в ленте</Text><Text style={styles.communityAudioPublishHint}>Релиз появится отдельной публикацией сообщества</Text></View>
              </Pressable> : null}
              {editingAudioRelease ? <View style={styles.communityAudioEditorDeleteSection}><Pressable accessibilityRole="button" onPress={() => Alert.alert('Удалить релиз?', 'Релиз исчезнет из сообщества и связанных поверхностей.', [{ text: 'Отмена', style: 'cancel' }, { text: 'Удалить', style: 'destructive', onPress: () => void removeAudioRelease(editingAudioRelease.id).then(() => { setIsAudioReleaseModalOpen(false); setEditingAudioRelease(null); }) }])} style={styles.communityAudioEditorDelete}><Text style={styles.communityAudioEditorDeleteText}>Удалить релиз</Text></Pressable></View> : null}
            </ScrollView>
          </KeyboardAvoidingView>
        </View>
      </Modal>
      <CalendarPickerModal
        isVisible={isAudioReleaseCalendarOpen}
        minDate={new Date(1900, 0, 1)}
        onClose={() => setIsAudioReleaseCalendarOpen(false)}
        onSelect={(value) => { setAudioReleaseDate(value); setIsAudioReleaseCalendarOpen(false); }}
        selectedValue={audioReleaseDate}
        title="Дата релиза"
      />
    </>
  );
}

function formatCommunityReleaseDateInput(value: Date) {
  return `${String(value.getDate()).padStart(2, '0')}.${String(value.getMonth() + 1).padStart(2, '0')}.${value.getFullYear()}`;
}

function communityReleaseDateToIso(value: string) {
  const [day, month, year] = value.split('.');
  return `${year}-${month}-${day}`;
}

function CommunityAudioReleasesSection({
  allReleases,
  canManage,
  onAdd,
  onEdit,
  onNeedMoreReleases,
  releases,
}: {
  allReleases: PublicPageAudioRelease[];
  canManage: boolean;
  onAdd: () => void;
  onEdit: (release: PublicPageAudioRelease) => void;
  onNeedMoreReleases?: () => void;
  releases: PublicPageAudioRelease[];
}) {
  const globalAudio = useGlobalAudioControls();
  const releaseQueues = useMemo(() => allReleases.map((release) => buildPlayableQueue(release)), [allReleases]);
  const allPlayableTracks = useMemo(() => releaseQueues.flat(), [releaseQueues]);
  const queueForRelease = useCallback((releaseIndex: number) => {
    const target = releaseQueues[releaseIndex]?.[0];
    return target ? boundedPlaybackQueue(allPlayableTracks, target) : [];
  }, [allPlayableTracks, releaseQueues]);
  const releaseIndexByCollectionId = useMemo(() => {
    const indexes = new Map<string, number>();
    releaseQueues.forEach((queue, releaseIndex) => {
      const collectionId = queue[0]?.collectionId?.trim();
      if (collectionId) indexes.set(collectionId, releaseIndex);
    });
    return indexes;
  }, [releaseQueues]);
  const queueWindowResolver = useCallback((target: GlobalTrackQueueItem) => {
    const collectionId = target.collectionId?.trim();
    const releaseIndex = collectionId ? releaseIndexByCollectionId.get(collectionId) : undefined;
    const resolvedIndex = releaseIndex ?? releaseQueues.findIndex((queue) => queue.some((track) => track.id === target.id));
    return resolvedIndex >= 0 ? queueForRelease(resolvedIndex) : target.id ? [target] : [];
  }, [queueForRelease, releaseIndexByCollectionId, releaseQueues]);

  useEffect(() => {
    const activeTrack = globalAudio.activeTrack;
    if (!activeTrack) return;
    const collectionId = activeTrack.collectionId?.trim();
    const activeReleaseIndex = collectionId ? releaseIndexByCollectionId.get(collectionId) : undefined;
    const resolvedReleaseIndex = activeReleaseIndex ?? releaseQueues.findIndex((queue) => queue.some((track) => track.id === activeTrack.id));
    if (resolvedReleaseIndex >= Math.max(0, releaseQueues.length - 3)) onNeedMoreReleases?.();
    const nextQueue = queueWindowResolver(activeTrack);
    if (nextQueue.length > 1) globalAudio.setActiveQueue(nextQueue, queueWindowResolver);
  }, [globalAudio.activeTrack?.collectionId, globalAudio.activeTrack?.id, globalAudio.setActiveQueue, onNeedMoreReleases, queueWindowResolver, releaseIndexByCollectionId, releaseQueues]);

  return (
    <View style={styles.communityAudioSection}>
      {canManage ? (
        <Pressable accessibilityRole="button" onPress={onAdd} style={styles.postComposerTrigger}>
          <Plus color="#111" size={20} strokeWidth={2} />
          <Text style={styles.postComposerTriggerText}>Добавить аудио-релиз</Text>
        </Pressable>
      ) : null}
      {releases.map((release) => {
        const releaseIndex = allReleases.findIndex((item) => item.id === release.id);
        const profileQueue: GlobalTrackQueueItem[] | undefined = releaseIndex >= 0 ? queueForRelease(releaseIndex) : undefined;
        const releaseDateLabel = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(release.releaseDate));
        return (
        <View key={release.id} style={styles.communityAudioRelease}>
          <AudioReleaseAttachmentCard
            communityLayout
            onEdit={canManage ? () => onEdit(release) : undefined}
            profileQueue={profileQueue}
            queueWindowResolver={queueWindowResolver}
            release={release}
            releaseDateLabel={releaseDateLabel}
          />
        </View>
        );
      })}
      {!releases.length && !canManage ? <View style={styles.emptyProfileTab}><Disc3 color="#111" size={28} strokeWidth={1.8} /><Text style={styles.emptyProfileTabTitle}>Релизов пока нет</Text></View> : null}
    </View>
  );
}

export function PublicPageEditScreen({
  authToken,
  canEditUsername,
  onAddPartnerPage,
  onAddTeamMember,
  onBack,
  onNotify,
  onOpenProfile,
  onOpenPublicPage,
  onRemovePartnerPage,
  onRemoveTeamMember,
  onSave,
  page,
}: {
  authToken: string;
  canEditUsername: boolean;
  onAddPartnerPage: (data: PartnerPageInput) => Promise<void>;
  onAddTeamMember: (data: TeamMemberInput) => Promise<void>;
  onBack: () => void;
  onNotify: (message: string, type?: ToastMessage['type']) => void;
  onOpenProfile: (username: string) => Promise<void>;
  onOpenPublicPage: (username: string) => Promise<void>;
  onRemovePartnerPage: (partnerId: string) => Promise<void>;
  onRemoveTeamMember: (accountUsername: string) => Promise<void>;
  onSave: (data: UpdateCommunityInput, options?: { silent?: boolean }) => Promise<void>;
  page: PublicPageDetail;
}) {
  const [username, setUsername] = useState(page.username);
  const [name, setName] = useState(page.name);
  const [type, setType] = useState(page.type);
  const [selectedLocationCategories, setSelectedLocationCategories] = useState<string[]>(() => page.locationCategories ?? []);
  const [isPrivate, setIsPrivate] = useState(page.isPrivate);
  const [countryName, setCountryName] = useState(page.countryName);
  const [countryCode, setCountryCode] = useState('');
  const [cityName, setCityName] = useState(page.cityName);
  const [cityId, setCityId] = useState(page.cityId ?? '');
  const [address, setAddress] = useState(page.address ?? '');
  const initialPhone = splitInternationalPhone(page.contactPhone);
  const [phoneCode, setPhoneCode] = useState(initialPhone.code);
  const [contactPhone, setContactPhone] = useState(initialPhone.number);
  const [websiteUrl, setWebsiteUrl] = useState(page.websiteUrl ?? '');
  const [radioStreamUrl, setRadioStreamUrl] = useState(page.radioStreamUrl ?? '');
  const [radioStreamState, setRadioStreamState] = useState<'idle' | 'checking' | 'valid' | 'invalid'>(page.radioStreamUrl ? 'valid' : 'idle');
  const [musicLabelName, setMusicLabelName] = useState(page.musicLabelName ?? '');
  const [musicLabelState, setMusicLabelState] = useState<'idle' | 'valid' | 'invalid'>(page.musicLabelName ? 'valid' : 'idle');
  const [musicLabelGenres, setMusicLabelGenres] = useState<string[]>(page.musicLabelGenres ?? []);
  const [labelledReleasesCount, setLabelledReleasesCount] = useState(page.labelledReleasesCount ?? 0);
  const [isRemovingReleaseLabel, setIsRemovingReleaseLabel] = useState(false);
  const [isPhoneCodePickerOpen, setIsPhoneCodePickerOpen] = useState(false);
  const [phoneCodeSearch, setPhoneCodeSearch] = useState('');
  const [about, setAbout] = useState(page.about);
  const [trackTitle, setTrackTitle] = useState(page.trackTitle ?? '');
  const [trackArtist, setTrackArtist] = useState(page.trackArtist ?? '');
  const [trackArtworkUrl, setTrackArtworkUrl] = useState(page.trackArtworkUrl ?? '');
  const [trackPreviewUrl, setTrackPreviewUrl] = useState(page.trackPreviewUrl ?? '');
  const [trackExternalUrl, setTrackExternalUrl] = useState(page.trackExternalUrl ?? '');
  const [trackProvider, setTrackProvider] = useState(page.trackProvider ?? '');
  const [trackStartSeconds, setTrackStartSeconds] = useState(page.trackStartSeconds ?? 0);
  const [trackClipDurationSeconds, setTrackClipDurationSeconds] = useState(page.trackClipDurationSeconds ?? 30);
  const [trackDurationSeconds, setTrackDurationSeconds] = useState<number | null>(page.trackDurationSeconds ?? null);
  const [trackPreviewDurationSeconds, setTrackPreviewDurationSeconds] = useState(page.trackPreviewDurationSeconds ?? 30);
  const [bandcampUrl, setBandcampUrl] = useState(page.bandcampUrl ?? ''); const [soundcloudUrl, setSoundcloudUrl] = useState(page.soundcloudUrl ?? '');
  const [instagramUrl, setInstagramUrl] = useState(page.instagramUrl ?? '');
  const [threadsUrl, setThreadsUrl] = useState(page.threadsUrl ?? ''); const [telegramUrl, setTelegramUrl] = useState(page.telegramUrl ?? '');
  const [youtubeUrl, setYoutubeUrl] = useState(page.youtubeUrl ?? '');
  const [letterboxdUrl, setLetterboxdUrl] = useState(page.letterboxdUrl ?? '');
  const [connectEnabled, setConnectEnabled] = useState(page.isVerified ? page.connectEnabled ?? false : false);
  const [connectAbout, setConnectAbout] = useState(page.connectAbout ?? '');
  const [connectGoals, setConnectGoals] = useState<ConnectGoal[]>(() => {
    const allowed = (page.connectGoals || []).filter((goal): goal is 'COLLABORATION' | 'VOLUNTEERS' | 'EMPLOYEES' => (
      goal === 'COLLABORATION'
      || goal === 'VOLUNTEERS'
      || goal === 'EMPLOYEES'
    ));
    return allowed.length ? allowed : ['COLLABORATION'];
  });
  const [connectSwitchRejectionKey, setConnectSwitchRejectionKey] = useState(0);
  const [avatarUrl, setAvatarUrl] = useState(page.avatarUrl);
  const [avatarKey, setAvatarKey] = useState(page.avatarKey ?? null);
  const [avatarCropAsset, setAvatarCropAsset] = useState<AvatarCropAsset | null>(null);
  const [connectPhotos, setConnectPhotos] = useState<ConnectPhoto[]>(() => page.connectPhotos?.length
    ? page.connectPhotos
    : page.connectImageUrl && page.connectImageKey
      ? [{ imageUrl: page.connectImageUrl, imageKey: page.connectImageKey }]
      : []);
  const connectImageUrl = connectPhotos[0]?.imageUrl ?? null;
  const [connectImageCrop, setConnectImageCrop] = useState<{ asset: AvatarCropAsset; index: number } | null>(null);
  const [typeOptions, setTypeOptions] = useState<PublicPageTypeOption[]>([]);
  const [isTypePickerOpen, setIsTypePickerOpen] = useState(false);
  const [isLocationPickerOpen, setIsLocationPickerOpen] = useState(false);
  const [countrySearch, setCountrySearch] = useState('');
  const [autoSaveStatus, setAutoSaveStatus] = useState<'saved' | 'saving' | 'pending' | 'error'>('saved');
  const [verificationRequestStatus, setVerificationRequestStatus] = useState<'PENDING' | 'APPROVED' | 'REJECTED' | null>(page.isVerified ? 'APPROVED' : null);
  const [isVerificationRequestLoading, setIsVerificationRequestLoading] = useState(false);
  const didInitializeAutoSave = useRef(false);
  const autoSaveQueue = useRef<Promise<void>>(Promise.resolve());
  const filteredCountries = useMemo(() => {
    const normalizedSearch = countrySearch.trim().toLowerCase();

    if (!normalizedSearch) {
      return countryOptions;
    }

    return countryOptions.filter((country) => country.toLowerCase().startsWith(normalizedSearch));
  }, [countrySearch]);
  const selectedType = typeOptions.find((option) => option.value === type);
  const isTypeLockedByReleases = page.type === 'MUSIC_LABEL' && labelledReleasesCount > 0;
  const availableLocationCategories = selectedType?.locationCategories ?? [];
  const phoneCodeLabels = useMemo(() => phoneCountryOptions.map((option) => `${option.country} (${option.code})`).filter((label) => label.toLowerCase().includes(phoneCodeSearch.trim().toLowerCase())), [phoneCodeSearch]);
  const primaryCommunityTrack = trackTitle && trackPreviewUrl && trackProvider
    ? {
        artist: trackArtist,
        artworkUrl: trackArtworkUrl || null,
        externalUrl: trackExternalUrl || null,
        previewUrl: trackPreviewUrl,
        title: trackTitle,
      }
    : null;
  const primaryTrackStartSelectionDuration = trackProvider === 'apple' || trackProvider === 'yandex'
    ? trackPreviewDurationSeconds
    : trackDurationSeconds ?? trackPreviewDurationSeconds;
  const selectPrimaryCatalogTrack = (track: AppleMusicTrack) => {
    const previewDurationSeconds = Number.isFinite(track.previewDurationSeconds) ? track.previewDurationSeconds : 30;
    setTrackTitle(track.title);
    setTrackArtist(track.artist);
    setTrackArtworkUrl(track.artworkUrl ?? '');
    setTrackPreviewUrl(track.previewUrl);
    setTrackExternalUrl(track.externalUrl);
    setTrackProvider(track.provider);
    setTrackStartSeconds(0);
    setTrackClipDurationSeconds(Math.min(30, previewDurationSeconds));
    setTrackDurationSeconds(Number.isFinite(track.durationSeconds) ? track.durationSeconds : null);
    setTrackPreviewDurationSeconds(previewDurationSeconds);
  };
  const selectPrimaryExternalTrack = (track: PrimaryExternalTrackCandidate) => {
    const availableDuration = track.durationSeconds ?? track.previewDurationSeconds ?? 30;
    setTrackTitle(track.title);
    setTrackArtist(track.artist);
    setTrackArtworkUrl(track.artworkUrl ?? '');
    setTrackPreviewUrl(track.previewUrl || track.externalUrl);
    setTrackExternalUrl(track.externalUrl);
    setTrackProvider(track.provider);
    setTrackStartSeconds(0);
    setTrackClipDurationSeconds(Math.min(30, availableDuration));
    setTrackDurationSeconds(track.durationSeconds ?? null);
    setTrackPreviewDurationSeconds(track.previewDurationSeconds ?? availableDuration);
  };
  const removePrimaryTrack = () => {
    setTrackTitle('');
    setTrackArtist('');
    setTrackArtworkUrl('');
    setTrackPreviewUrl('');
    setTrackExternalUrl('');
    setTrackProvider('');
    setTrackStartSeconds(0);
    setTrackClipDurationSeconds(30);
    setTrackDurationSeconds(null);
    setTrackPreviewDurationSeconds(30);
  };

  useEffect(() => {
    let isMounted = true;

    fetch(`${apiUrl}/public-pages/types`)
      .then((response) => response.json() as Promise<PublicPageTypeOption[]>)
      .then((options) => {
        if (isMounted) {
          setTypeOptions(options);
          if (page.locationCategories === undefined) {
            const currentType = options.find((option) => option.value === type);
            setSelectedLocationCategories(currentType?.locationCategories?.slice(0, 1).map((category) => category.value) ?? []);
          }
        }
      })
      .catch(() => {
        if (isMounted) {
          setTypeOptions([]);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    void fetch(`${apiUrl}/public-pages/${encodeURIComponent(page.username)}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(await readApiError(response, 'Не удалось обновить данные лейбла'));
        return response.json() as Promise<PublicPageDetail>;
      })
      .then((freshPage) => {
        if (!isMounted) return;
        const nextCount = freshPage.labelledReleasesCount ?? 0;
        setLabelledReleasesCount(nextCount);
        if (freshPage.type === 'MUSIC_LABEL' && nextCount > 0) setType('MUSIC_LABEL');
      })
      .catch(() => undefined);
    return () => {
      isMounted = false;
    };
  }, [authToken, page.username]);

  useEffect(() => {
    if (!page.ownerId || page.isVerified) return;
    let active = true;
    void fetch(`${apiUrl}/public-pages/${encodeURIComponent(page.username)}/verification-request`, {
      headers: { Authorization: `Bearer ${authToken}` },
    }).then(async (response) => {
      if (!response.ok) return;
      const data = await response.json() as {
        isVerified: boolean;
        request: { status: 'PENDING' | 'APPROVED' | 'REJECTED' } | null;
      };
      if (active) setVerificationRequestStatus(data.isVerified ? 'APPROVED' : data.request?.status ?? null);
    });
    return () => { active = false; };
  }, [authToken, page.isVerified, page.ownerId, page.username]);

  const submitVerificationRequest = async () => {
    if (isVerificationRequestLoading || verificationRequestStatus === 'PENDING' || page.isVerified) return;
    setIsVerificationRequestLoading(true);
    try {
      const response = await fetch(`${apiUrl}/public-pages/${encodeURIComponent(page.username)}/verification-request`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!response.ok) throw new Error(await readApiError(response, 'Не удалось подать заявку'));
      setVerificationRequestStatus('PENDING');
      onNotify('Заявка отправлена на проверку', 'success');
    } catch (error) {
      onNotify(error instanceof Error ? error.message : 'Не удалось подать заявку', 'error');
    } finally {
      setIsVerificationRequestLoading(false);
    }
  };

  useEffect(() => {
    if (type !== 'RADIO_STATION') {
      setRadioStreamState('idle');
      return;
    }
    const value = radioStreamUrl.trim();
    if (!value) {
      setRadioStreamState('idle');
      return;
    }
    setRadioStreamState('checking');
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      void fetch(`${apiUrl}/public-pages/radio-stream/validate?url=${encodeURIComponent(value)}`, {
        cache: 'no-store',
        headers: { Authorization: `Bearer ${authToken}` },
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) throw new Error(await readApiError(response, 'Не удалось проверить аудиопоток'));
          return response.json() as Promise<{ valid: boolean }>;
        })
        .then((result) => setRadioStreamState(result.valid ? 'valid' : 'invalid'))
        .catch((error) => {
          if (error instanceof Error && error.name === 'AbortError') return;
          setRadioStreamState('invalid');
        });
    }, 700);
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [authToken, radioStreamUrl, type]);

  useEffect(() => {
    if (type !== 'MUSIC_LABEL') {
      setMusicLabelState('idle');
      return;
    }
    const value = musicLabelName.trim().replace(/\s+/g, ' ');
    if (!value) {
      setMusicLabelState('idle');
      return;
    }
    setMusicLabelState(value.length >= 2 && value.length <= 80 && !/[<>\r\n\u0000-\u001f]/.test(value) ? 'valid' : 'invalid');
  }, [musicLabelName, type]);

  const pickAvatar = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Фото', 'Нужно разрешение на выбор фото из галереи.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: false,
      base64: false,
      mediaTypes: ['images'],
      quality: 1,
    });

    if (!result.canceled) {
      const asset = result.assets[0];
      setAvatarCropAsset({
        uri: asset.uri,
        width: asset.width || 1200,
        height: asset.height || 1200,
        mimeType: asset.mimeType || 'image/jpeg',
      });
    }
  };

  const pickConnectImage = async (index: number) => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Фото Коннекта', 'Нужно разрешение на выбор фото из галереи.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ allowsEditing: false, base64: false, mediaTypes: ['images'], quality: 1 });
    if (result.canceled) return;
    const asset = result.assets[0];
    setConnectImageCrop({ asset: { uri: asset.uri, width: asset.width || 1200, height: asset.height || 1200, mimeType: asset.mimeType || 'image/jpeg' }, index });
  };

  const submit = async () => {
    const normalizedUsername = username.replace(/^@/, '').trim().toLowerCase();

    if (!/^[a-z0-9_]{3,30}$/.test(normalizedUsername)) {
      onNotify('URL-name: 3-30 символов, латиница, цифры и _', 'error');
      return;
    }

    if (name.trim().length < 2) {
      setAutoSaveStatus('pending');
      return;
    }

    if (!type) {
      setAutoSaveStatus('pending');
      return;
    }
    if (type === 'RADIO_STATION' && radioStreamUrl.trim() && radioStreamState !== 'valid') {
      setAutoSaveStatus('pending');
      return;
    }
    if (type === 'MUSIC_LABEL' && musicLabelName.trim() && musicLabelState !== 'valid') {
      setAutoSaveStatus('pending');
      return;
    }

    const phoneDigits = normalizePhoneDigits(`${phoneCode}${contactPhone}`);
    if (contactPhone && phoneDigits.length < 7) {
      setAutoSaveStatus('pending');
      return;
    }

    if (connectEnabled && !cityId) {
      setAutoSaveStatus('pending');
      return;
    }

    if (connectEnabled && !connectGoals.length) {
      setAutoSaveStatus('pending');
      return;
    }
    if (connectEnabled && !connectImageUrl) {
      setAutoSaveStatus('pending');
      return;
    }
    const social = normalizeCommunitySocialLinks({ bandcamp: bandcampUrl, soundcloud: soundcloudUrl, instagram: instagramUrl, threads: threadsUrl, telegram: telegramUrl, youtube: youtubeUrl, letterboxd: letterboxdUrl });
    if (social.error) { setAutoSaveStatus('pending'); return; }
    const website = normalizeCommunityWebsite(websiteUrl); if (website.error) { setAutoSaveStatus('pending'); return; }

    setAutoSaveStatus('saving');

    try {
      let savedAvatarUrl = avatarUrl;
      let savedAvatarKey = avatarKey;
      let avatarChanged = false;
      if (avatarUrl && !/^https?:\/\//i.test(avatarUrl)) {
        const uploaded = await uploadAvatarAsset(avatarUrl, authToken, 'community', page.username);
        savedAvatarUrl = uploaded.avatarUrl;
        savedAvatarKey = uploaded.avatarKey;
        setAvatarUrl(savedAvatarUrl);
        setAvatarKey(savedAvatarKey);
        avatarChanged = true;
      }
      const savedConnectPhotos: ConnectPhoto[] = [];
      let didUploadConnectPhoto = false;
      for (const photo of connectPhotos) {
        if (photo.imageKey) savedConnectPhotos.push(photo);
        else {
          savedConnectPhotos.push(await uploadConnectPhotoAsset(photo.imageUrl, authToken, page.username));
          didUploadConnectPhoto = true;
        }
      }
      if (didUploadConnectPhoto) setConnectPhotos(savedConnectPhotos);
      await onSave({
        username: normalizedUsername,
        name: name.trim(),
        type,
        locationCategories: selectedLocationCategories,
        countryName: countryName.trim(),
        countryCode,
        cityName: cityName.trim(),
        cityId,
        address: address.trim(),
        contactPhone: contactPhone ? `+${phoneDigits}` : undefined,
        websiteUrl: website.url,
        radioStreamUrl: type === 'RADIO_STATION' ? radioStreamUrl.trim() || null : null,
        musicLabelName: type === 'MUSIC_LABEL' ? musicLabelName.trim().replace(/\s+/g, ' ') || null : null,
        musicLabelGenres: type === 'MUSIC_LABEL' ? musicLabelGenres : [],
        trackTitle: trackTitle.trim() || null,
        trackArtist: trackArtist.trim() || null,
        trackArtworkUrl: trackArtworkUrl.trim() || null,
        trackPreviewUrl: trackPreviewUrl.trim() || null,
        trackExternalUrl: trackExternalUrl.trim() || null,
        trackProvider: trackProvider.trim() || null,
        trackStartSeconds: Math.round(Number(trackStartSeconds) * 100) / 100,
        trackClipDurationSeconds: Math.round(Number(trackClipDurationSeconds) * 100) / 100,
        trackDurationSeconds: trackDurationSeconds == null ? null : Math.round(Number(trackDurationSeconds) * 100) / 100,
        trackPreviewDurationSeconds: Math.round(Number(trackPreviewDurationSeconds) * 100) / 100,
        about: about.trim(),
        ...social.links,
        ...(avatarChanged ? { avatarUrl: savedAvatarUrl, avatarKey: savedAvatarKey } : {}),
        isPrivate,
        connectEnabled,
        connectGoals,
        connectPhotos: savedConnectPhotos,
        connectAbout,
      }, { silent: true });
      setAutoSaveStatus('saved');
    } catch (error) {
      setAutoSaveStatus('error');
      onNotify(error instanceof Error ? error.message : 'Не удалось сохранить сообщество', 'error');
    }
  };

  const removeReleaseLabel = useCallback(async () => {
    setIsRemovingReleaseLabel(true);
    try {
      const response = await fetch(`${apiUrl}/public-pages/${encodeURIComponent(page.username)}/audio-release-label`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!response.ok) throw new Error(await readApiError(response, 'Не удалось удалить лейбл у релизов'));
      const result = await response.json() as { removedCount: number };
      setLabelledReleasesCount(0);
      onNotify(result.removedCount > 0
        ? `Лейбл удалён у ${result.removedCount} ${russianPlural(result.removedCount, 'релиза', 'релизов', 'релизов')}`
        : 'У релизов уже нет этого лейбла');
    } catch (error) {
      onNotify(error instanceof Error ? error.message : 'Не удалось удалить лейбл у релизов', 'error');
    } finally {
      setIsRemovingReleaseLabel(false);
    }
  }, [authToken, onNotify, page.username]);

  const confirmRemoveReleaseLabel = useCallback(() => {
    Alert.alert(
      'Удалить лейбл',
      `Вы уверены? Связь с лейблом будет удалена у ${labelledReleasesCount} ${russianPlural(labelledReleasesCount, 'релиза', 'релизов', 'релизов')}. Сами релизы и сообщество останутся без изменений.`,
      [
        { text: 'Отмена', style: 'cancel' },
        { text: 'Удалить', style: 'destructive', onPress: () => void removeReleaseLabel() },
      ],
    );
  }, [labelledReleasesCount, removeReleaseLabel]);

  useEffect(() => {
    if (!didInitializeAutoSave.current) {
      didInitializeAutoSave.current = true;
      return;
    }

    setAutoSaveStatus('pending');
    const timeout = setTimeout(() => {
      autoSaveQueue.current = autoSaveQueue.current
        .catch(() => undefined)
        .then(submit);
    }, 800);
    return () => clearTimeout(timeout);
  }, [
    about, address, avatarKey, avatarUrl, bandcampUrl, cityId, cityName, connectEnabled,
    connectAbout, connectGoals, connectPhotos, contactPhone, countryCode, countryName,
    instagramUrl, isPrivate, letterboxdUrl, musicLabelGenres, musicLabelName, musicLabelState, name, phoneCode,
    radioStreamState, radioStreamUrl, soundcloudUrl, telegramUrl,
    selectedLocationCategories, threadsUrl, trackArtist, trackArtworkUrl, trackClipDurationSeconds,
    trackDurationSeconds, trackExternalUrl, trackPreviewDurationSeconds, trackPreviewUrl, trackProvider,
    trackStartSeconds, trackTitle, type, username, websiteUrl, youtubeUrl,
  ]);

  return (
    <>
      <View style={styles.topBar}>
        <View style={styles.topBarLeft}>
          <Pressable onPress={onBack} style={styles.topBarIconButton}>
            <ChevronLeft size={29} color="#090909" strokeWidth={2.1} />
          </Pressable>
          <Text style={styles.topBarTitle}>Редактировать</Text>
        </View>
        <EditorAutosaveStatus status={autoSaveStatus} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.editShell}>
        <ScrollView contentContainerStyle={[styles.editContent, styles.publicPageEditContent]} showsVerticalScrollIndicator={false}>
          <View style={styles.editIdentityRow}>
            <View style={styles.avatarEditRow}>
              <AvatarEditButton avatarUrl={avatarUrl} entityType="community" onPress={pickAvatar} />
              <Text style={styles.changeAvatarText}>Фото</Text>
            </View>

            <View style={[styles.editFieldGroup, styles.editorBorderlessSurface]}>
              <View style={styles.editFieldRow}>
                <Text style={styles.usernamePrefix}>@</Text>
                <TextInput
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={canEditUsername}
                  onChangeText={(value) => setUsername(normalizeUsernameInput(value))}
                  placeholder="url-name"
                  placeholderTextColor="#98a3ae"
                  style={[styles.editGroupInput, styles.editGroupUsernameInput]}
                  value={username}
                />
              </View>
              <View style={styles.editFieldSeparator} />
              <TextInput
                onChangeText={setName}
                placeholder="Название"
                placeholderTextColor="#98a3ae"
                style={[styles.editGroupInput, styles.editGroupInputWithLeftPadding]}
                value={name}
              />
            </View>
          </View>

          <Pressable
            accessibilityState={{ disabled: isTypeLockedByReleases }}
            disabled={isTypeLockedByReleases}
            onPress={() => setIsTypePickerOpen(true)}
            style={[styles.editSelectInput, styles.editorBorderlessSurface, isTypeLockedByReleases && styles.editSelectInputDisabled]}
          >
            <Text
              numberOfLines={1}
              style={[
                styles.editSelectText,
                !selectedType && styles.editSelectPlaceholder,
                isTypeLockedByReleases && styles.editSelectTextDisabled,
              ]}
            >
              {selectedType?.label || 'Выберите категорию сообщества'}
            </Text>
            <Text style={styles.editSelectChevron}>›</Text>
          </Pressable>

          {isTypeLockedByReleases ? (
            <View style={styles.communityTypeLockNotice}>
              <Text style={styles.communityTypeLockText}>Для смены типа сообщества необходимо убрать ваше сообщество в качестве лейбла со всех музыкальных релизов</Text>
              <Pressable
                accessibilityRole="button"
                disabled={isRemovingReleaseLabel}
                onPress={confirmRemoveReleaseLabel}
                style={styles.communityTypeUnlockButton}
              >
                {isRemovingReleaseLabel ? <ActivityIndicator color="#c62828" size="small" /> : <Text style={styles.communityTypeUnlockButtonText}>Удалить лейбл</Text>}
              </Pressable>
            </View>
          ) : null}

          {availableLocationCategories.length ? (
            <View style={styles.communityCategorySelectionBlock}>
              <Text style={styles.communityCategorySelectionTitle}>Показывать в категории</Text>
              {availableLocationCategories.map((option) => {
                const isSelected = selectedLocationCategories.includes(option.value);
                return (
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: isSelected }}
                    key={option.value}
                    onPress={() => {
                      setSelectedLocationCategories((current) => (
                        current.includes(option.value)
                          ? current.filter((category) => category !== option.value)
                          : [...current, option.value]
                      ));
                    }}
                    style={styles.communityCategorySelectionRow}
                  >
                    <View style={[styles.communityCategorySelectionCheckbox, isSelected && styles.communityCategorySelectionCheckboxActive]}>
                      {isSelected ? <Check color="#fff" size={15} strokeWidth={2.4} /> : null}
                    </View>
                    <Text style={styles.communityCategorySelectionText}>{option.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}

          {type === 'RADIO_STATION' ? (
            <View style={styles.communityTypeMetadataField}>
              <Text style={styles.communityTypeMetadataLabel}>Ссылка на аудиопоток</Text>
              <View style={styles.communityTypeMetadataInputRow}>
                <TextInput
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  maxLength={2048}
                  onChangeText={setRadioStreamUrl}
                  placeholder="https://…"
                  placeholderTextColor="#98a3ae"
                  style={styles.communityTypeMetadataInput}
                  value={radioStreamUrl}
                />
                {radioStreamState === 'checking' ? <ActivityIndicator color="#6f7b86" size="small" /> : null}
                {radioStreamState === 'valid' ? <Check accessibilityLabel="Аудиопоток работает" color="#2fa84f" size={20} strokeWidth={2.4} /> : null}
                {radioStreamState === 'invalid' ? <X accessibilityLabel="Аудиопоток недоступен" color="#c62828" size={19} strokeWidth={2.4} /> : null}
              </View>
            </View>
          ) : null}

          {type === 'MUSIC_LABEL' ? (
            <>
              <View style={styles.communityTypeMetadataField}>
                <Text style={styles.communityTypeMetadataLabel}>Название лейбла</Text>
                <View style={styles.communityTypeMetadataInputRow}>
                  <TextInput
                    maxLength={80}
                    onChangeText={setMusicLabelName}
                    placeholder="Название лейбла"
                    placeholderTextColor="#98a3ae"
                    style={styles.communityTypeMetadataInput}
                    value={musicLabelName}
                  />
                  {musicLabelState === 'valid' ? <Check accessibilityLabel="Название заполнено верно" color="#2fa84f" size={20} strokeWidth={2.4} /> : null}
                  {musicLabelState === 'invalid' ? <X accessibilityLabel="Название заполнено неверно" color="#c62828" size={19} strokeWidth={2.4} /> : null}
                </View>
              </View>
              <MusicGenreSelector
                editorCard
                editorWhiteCard
                maxSelected={5}
                selected={musicLabelGenres}
                title="Жанры лейбла"
                onChange={setMusicLabelGenres}
              />
            </>
          ) : null}

          <View style={styles.createAccessBlock}>
            <Text style={styles.settingsLabel}>Доступ</Text>
            <Text style={styles.createAccessHint}>
              Открытое сообщество видно всем: любой может подписаться и читать контент. В закрытом доступ получают только после подтверждения заявки. Заявка поступит в уведомления владельца сообщества, где её можно подтвердить или отклонить.
            </Text>
            <AnimatedSegmentedControl accessibilityLabel="Доступ к сообществу" containerStyle={styles.privacySegment} onChange={setIsPrivate} options={[{ label: 'Открытое', value: false }, { label: 'Закрытое', value: true }]} value={isPrivate} />
          </View>

          <View style={styles.editLocationRow}>
            <Pressable onPress={() => setIsLocationPickerOpen(true)} style={[styles.editSelectInput, styles.editorBorderlessSurface, { flex: 1 }]}>
              <Text numberOfLines={1} style={[styles.editSelectText, !countryName && styles.editSelectPlaceholder]}>
                {cityName ? `${countryName}, ${cityName}` : countryName || 'Местоположение'}
              </Text>
              <Text style={styles.editSelectChevron}>›</Text>
            </Pressable>
          </View>

          <TextInput autoCapitalize="words" maxLength={200} onChangeText={setAddress} placeholder="Улица, дом" placeholderTextColor="#98a3ae" style={[styles.editInput, styles.communityAddressInput, styles.editorBorderlessSurface]} value={address} />

          <View style={styles.phoneInputRow}>
            <Pressable onPress={() => setIsPhoneCodePickerOpen(true)} style={[styles.phoneCodeInput, styles.editorBorderlessSurface]}><Text style={styles.editSelectText}>{phoneCode}</Text><Text style={styles.editSelectChevron}>›</Text></Pressable>
            <TextInput keyboardType="phone-pad" maxLength={10} onChangeText={(value) => setContactPhone(normalizePhoneDigits(value, 10))} placeholder="Телефон" placeholderTextColor="#98a3ae" style={[styles.editInput, styles.phoneNumberInput, styles.editorBorderlessSurface]} value={contactPhone} />
          </View>

          <TextInput autoCapitalize="none" autoCorrect={false} keyboardType="url" maxLength={300} onChangeText={setWebsiteUrl} placeholder="Веб-сайт" placeholderTextColor="#98a3ae" style={[styles.editInput, styles.communityWebsiteInput, styles.editorBorderlessSurface]} value={websiteUrl} />

          <TextInput
            multiline
            onChangeText={setAbout}
            placeholder="Описание (необязательно)"
            placeholderTextColor="#98a3ae"
            style={[styles.editInput, styles.editTextArea, styles.editorBorderlessSurface]}
            textAlignVertical="top"
            value={about}
          />

          <View style={styles.primaryTrackPickerBlock}>
            <View style={styles.primaryTrackPickerList}>
              <View style={[styles.primaryTrackPickerRow, styles.primaryTrackPickerRowActive]}>
                {primaryCommunityTrack ? (
                  <>
                    {primaryCommunityTrack.artworkUrl ? (
                      <Image source={{ uri: primaryCommunityTrack.artworkUrl }} style={styles.primaryTrackPickerArtwork} />
                    ) : (
                      <View style={styles.primaryTrackPickerArtworkPlaceholder}><Disc3 color="#111" size={18} /></View>
                    )}
                    <View style={styles.primaryTrackPickerCopy}>
                      <Text numberOfLines={1} style={styles.primaryTrackPickerTitle}>{primaryCommunityTrack.title}</Text>
                      <Text numberOfLines={1} style={styles.primaryTrackPickerMeta}>{primaryCommunityTrack.artist || 'Музыка сообщества'}</Text>
                    </View>
                  </>
                ) : null}
                <PrimaryTrackCatalogSearch
                  clipDurationSeconds={trackClipDurationSeconds}
                  durationSeconds={primaryTrackStartSelectionDuration}
                  onChangeStart={setTrackStartSeconds}
                  onDurationChange={setTrackDurationSeconds}
                  onRemove={removePrimaryTrack}
                  onSelect={selectPrimaryCatalogTrack}
                  onSelectExternal={selectPrimaryExternalTrack}
                  playback={primaryCommunityTrack}
                  provider={(trackProvider || 'apple') as 'apple' | 'yandex' | 'soundcloud' | 'bandcamp' | 'youtube'}
                  startSeconds={trackStartSeconds}
                />
              </View>
            </View>
          </View>

          <Text style={styles.editSectionTitle}>Ссылки</Text>
          <SocialLinkInput kind="bandcamp" onChangeText={setBandcampUrl} placeholder="Bandcamp" value={bandcampUrl} />
          <SocialLinkInput kind="soundcloud" onChangeText={setSoundcloudUrl} placeholder="SoundCloud" value={soundcloudUrl} />
          <SocialLinkInput kind="instagram" onChangeText={setInstagramUrl} placeholder="Instagram" value={instagramUrl} />
          <SocialLinkInput kind="threads" onChangeText={setThreadsUrl} placeholder="Threads" value={threadsUrl} />
          <SocialLinkInput kind="telegram" onChangeText={setTelegramUrl} placeholder="Telegram" value={telegramUrl} />
          <SocialLinkInput kind="youtube" onChangeText={setYoutubeUrl} placeholder="YouTube" value={youtubeUrl} />
          <SocialLinkInput kind="letterboxd" onChangeText={setLetterboxdUrl} placeholder="Letterboxd" value={letterboxdUrl} />

          {!page.isVerified && page.ownerId ? <>
            <Text style={styles.editSectionTitle}>Подтверждённый профиль</Text>
            <View style={styles.profileVerificationRequestCard}>
              <Text style={styles.profileVerificationRequestTitle}>Получить галочку</Text>
              <Text style={styles.profileVerificationRequestText}>
                Подтверждённый профиль сообщества вызывает больше доверия и может участвовать в Коннекте.
                Проверка и выдача галочки выполняются модерацией VOLNA.
              </Text>
              <Pressable
                accessibilityLabel="Подать заявку на подтверждение сообщества"
                accessibilityRole="button"
                disabled={isVerificationRequestLoading || verificationRequestStatus === 'PENDING'}
                onPress={() => void submitVerificationRequest()}
                style={[
                  styles.profileVerificationRequestButton,
                  verificationRequestStatus === 'PENDING' && styles.disabledButton,
                ]}
              >
                {isVerificationRequestLoading
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.profileVerificationRequestButtonText}>
                    {verificationRequestStatus === 'PENDING' ? 'Заявка на рассмотрении' : 'Подать заявку'}
                  </Text>}
              </Pressable>
            </View>
          </> : null}

          <Text style={styles.editSectionTitle}>Коннект</Text>
          <ConnectPhotosEditor
            about={connectAbout}
            onAdd={(index) => { void pickConnectImage(index); }}
            onChangeAbout={setConnectAbout}
            onChange={(photos) => {
              setConnectPhotos(photos);
              if (!photos.length && connectEnabled) setConnectEnabled(false);
            }}
            photos={connectPhotos}
          />
          <View style={styles.connectGoalsBlock}>
            <Text style={styles.connectGoalsTitle}>Цели взаимодействия</Text>
            <View style={styles.connectGoalChips}>
              {([
                { value: 'COLLABORATION', label: 'Коллаборации' },
                { value: 'EMPLOYEES', label: 'Набор в команду' },
                { value: 'VOLUNTEERS', label: 'Волонтёрство' },
              ] as Array<{ value: ConnectGoal; label: string }>).map((option) => {
                const selected = connectGoals.includes(option.value);
                return (
                  <Pressable
                    key={option.value}
                    onPress={() => setConnectGoals((current) => (
                      selected
                        ? current.filter((goal) => goal !== option.value)
                        : [...current, option.value]
                    ))}
                    style={[styles.connectGoalChip, selected && styles.connectGoalChipActive]}
                  >
                    <Text style={[styles.connectGoalChipText, selected && styles.connectGoalChipTextActive]}>
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
          <View style={styles.connectOptInBlock}>
            <View style={styles.connectOptInCopy}>
              <Text style={styles.settingsLabel}>Сообщество в Коннекте</Text>
              <Text style={styles.settingsHint}>
                Подтверждённые сообщества могут искать участников, волонтёров, сотрудников и партнёров.
              </Text>
            </View>
            <VolnaSwitch
              accessibilityLabel="Сообщество в Коннекте"
              onValueChange={(enabled) => {
                if (enabled && !page.isVerified) {
                  setConnectSwitchRejectionKey((current) => current + 1);
                  onNotify('Чтобы включить Коннект, сообщество должно быть подтверждено', 'error');
                  return;
                }
                if (enabled && !cityId) {
                  setConnectSwitchRejectionKey((current) => current + 1);
                  onNotify('Чтобы включить Коннект, выберите страну и город', 'error');
                  return;
                }
                if (enabled && !connectGoals.length) {
                  setConnectSwitchRejectionKey((current) => current + 1);
                  onNotify('Чтобы включить Коннект, выберите хотя бы одну цель взаимодействия', 'error');
                  return;
                }
                if (enabled && !connectPhotos.length) {
                  setConnectSwitchRejectionKey((current) => current + 1);
                  onNotify('Чтобы включить Коннект, добавьте хотя бы одну фотографию', 'error');
                  return;
                }
                setConnectEnabled(enabled);
              }}
              rejectionAnimationKey={connectSwitchRejectionKey}
              value={connectEnabled}
            />
          </View>

        </ScrollView>
      </KeyboardAvoidingView>
      <PublicPageTypePickerModal
        isVisible={isTypePickerOpen}
        onClose={() => setIsTypePickerOpen(false)}
        onSelect={(option) => {
          if (option.value !== type) {
            setSelectedLocationCategories(option.locationCategories?.slice(0, 1).map((category) => category.value) ?? []);
          }
          if (option.value !== 'RADIO_STATION') {
            setRadioStreamUrl('');
            setRadioStreamState('idle');
          }
          if (option.value !== 'MUSIC_LABEL') {
            setMusicLabelName('');
            setMusicLabelState('idle');
          }
          setType(option.value);
          setIsTypePickerOpen(false);
        }}
        options={typeOptions}
        selectedValue={type}
      />
      <LocationPickerModal
        initialCountryName={countryName}
        isVisible={isLocationPickerOpen}
        onClose={() => setIsLocationPickerOpen(false)}
        onSelect={(location) => {
          if (location.cityId !== cityId) setAddress('');
          setCountryName(location.countryName);
          setCountryCode(location.countryCode);
          setCityName(location.cityName);
          setCityId(location.cityId);
        }}
      />
      <AvatarCropModal
        asset={avatarCropAsset}
        onApply={setAvatarUrl}
        onClose={() => setAvatarCropAsset(null)}
      />
      <AvatarCropModal
        asset={connectImageCrop?.asset ?? null}
        cropShape="connect"
        label="Фото Коннекта"
        onApply={(uri) => {
          const index = connectImageCrop?.index ?? connectPhotos.length;
          setConnectPhotos((current) => {
            const next = [...current];
            const item = { imageKey: '', imageUrl: uri };
            if (index >= next.length) next.push(item);
            else next[index] = item;
            return next.slice(0, 5);
          });
        }}
        onClose={() => setConnectImageCrop(null)}
      />
      <CountryPickerModal countries={phoneCodeLabels} isVisible={isPhoneCodePickerOpen} onChangeSearch={setPhoneCodeSearch} onClose={() => setIsPhoneCodePickerOpen(false)} onSelect={(label) => { const option = phoneCountryOptions.find((item) => label === `${item.country} (${item.code})`); if (option) setPhoneCode(option.code); setPhoneCodeSearch(''); setIsPhoneCodePickerOpen(false); }} search={phoneCodeSearch} />
    </>
  );
}

function EntityUsernameLookup({
  allowFreeText = false,
  endAdornment,
  entityType,
  isMuted = false,
  maxLength,
  onChange,
  placeholder,
  searchEndpoint,
  value,
}: {
  allowFreeText?: boolean;
  endAdornment?: ReactNode;
  entityType: 'account' | 'community';
  isMuted?: boolean;
  maxLength?: number;
  onChange: (value: string) => void;
  placeholder: string;
  searchEndpoint?: string;
  value: string;
}) {
  const [suggestions, setSuggestions] = useState<Array<{ id: string; name: string; username: string; avatarUrl: string | null }>>([]);
  const [isSelectionCommitted, setIsSelectionCommitted] = useState(false);

  useEffect(() => {
    const query = allowFreeText
      ? value.trim().replace(/^@/, '')
      : normalizeUsernameInput(value);
    if (query.length < 3 || isSelectionCommitted) {
      setSuggestions([]);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      const endpoint = searchEndpoint || `/${entityType === 'account' ? 'profiles' : 'public-pages'}`;
      void fetch(`${apiUrl}${endpoint}?q=${encodeURIComponent(query)}&pageSize=6`, { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error('lookup failed');
          const payload = await response.json() as CursorPage<PublicAccount | PublicPage> | Array<PublicAccount | PublicPage>;
          const items = Array.isArray(payload) ? payload : payload.items;
          setSuggestions(items.map((item) => ({ id: item.id, name: item.name, username: item.username, avatarUrl: item.avatarUrl })));
        })
        .catch((error: unknown) => {
          if (!(error instanceof Error) || error.name !== 'AbortError') setSuggestions([]);
        });
    }, remoteSearchDebounceMs);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [allowFreeText, entityType, isSelectionCommitted, searchEndpoint, value]);

  return (
    <View>
      <View style={[styles.entityUsernameField, isMuted && styles.entityUsernameFieldMuted]}>
        {!allowFreeText ? <Text style={styles.entityUsernamePrefix}>@</Text> : null}
        <TextInput
          autoCapitalize={allowFreeText ? 'words' : 'none'}
          autoCorrect={false}
          maxLength={maxLength}
          onChangeText={(nextValue) => {
            setIsSelectionCommitted(false);
            onChange(allowFreeText ? nextValue : normalizeUsernameInput(nextValue));
          }}
          placeholder={placeholder}
          placeholderTextColor="#98a3ae"
          style={styles.entityUsernameInput}
          value={value}
        />
        {endAdornment}
      </View>
      {suggestions.length ? (
        <View style={styles.entityUsernameSuggestions}>
          {suggestions.map((suggestion) => (
            <Pressable
              key={suggestion.id}
              onPress={() => {
                setIsSelectionCommitted(true);
                setSuggestions([]);
                onChange(allowFreeText ? `@${suggestion.username}` : suggestion.username);
              }}
              style={styles.entityUsernameSuggestionRow}
            >
              {suggestion.avatarUrl ? (
                <Image resizeMode="cover" source={{ uri: suggestion.avatarUrl }} style={styles.entityUsernameSuggestionAvatar} />
              ) : (
                <View style={styles.entityUsernameSuggestionAvatar}>
                  <Text style={styles.entityUsernameSuggestionAvatarText}>{getAvatarInitial(suggestion.name)}</Text>
                </View>
              )}
              <View style={styles.publicPageTeamCopy}>
                <Text numberOfLines={1} style={styles.publicPageTeamName}>{suggestion.name}</Text>
                <Text numberOfLines={1} style={styles.publicPageTeamUsername}>@{suggestion.username}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function CommunityAdministrationSection({
  authToken,
  grantablePermissions,
  initialAdministrators,
  onChanged,
  onNotify,
  pageUsername,
}: {
  authToken: string;
  grantablePermissions: PublicPagePermission[];
  initialAdministrators: PublicPageDetail['administrators'];
  onChanged?: () => void | Promise<void>;
  onNotify: (message: string, type?: ToastMessage['type']) => void;
  pageUsername: string;
}) {
  const [administrators, setAdministrators] = useState(initialAdministrators);
  const [username, setUsername] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [selectedPermissions, setSelectedPermissions] = useState<PublicPagePermission[]>([]);
  const isEditing = administrators.some((item) => item.account.username === username.replace(/^@/, '').trim().toLowerCase());

  useEffect(() => setAdministrators(initialAdministrators), [initialAdministrators]);

  const reset = () => {
    setUsername('');
    setSelectedPermissions([]);
  };

  const togglePermission = (permission: PublicPagePermission) => {
    setSelectedPermissions((current) => current.includes(permission)
      ? current.filter((item) => item !== permission)
      : [...current, permission]);
  };

  const add = async () => {
    const normalized = username.replace(/^@/, '').trim().toLowerCase();
    if (!normalized) return onNotify('Укажите username подписчика', 'error');
    if (!selectedPermissions.length) return onNotify('Выберите хотя бы одно право доступа', 'error');
    setIsSaving(true);
    try {
      const response = await fetch(`${apiUrl}/public-pages/${pageUsername}/administrators`, { method: 'POST', headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: normalized, permissions: selectedPermissions }) });
      if (!response.ok) throw new Error(await readApiError(response, 'Не удалось назначить администратора'));
      const administrator = await response.json() as PublicPageDetail['administrators'][number];
      setAdministrators((current) => [administrator, ...current.filter((item) => item.account.username !== administrator.account.username)]);
      reset();
      onNotify(isEditing ? 'Права администратора обновлены' : 'Администратор добавлен');
      await onChanged?.();
    } catch (error) { onNotify(error instanceof Error ? error.message : 'Не удалось назначить администратора', 'error'); } finally { setIsSaving(false); }
  };

  return <View style={[styles.publicPageTeamEditor, styles.communityAdministrationCard]}>
    <Text style={[styles.settingsHint, styles.communityAdministrationDescription]}>Добавьте подписчика и отметьте только те разделы, к которым ему нужен доступ. Владелец, @url, удаление сообщества и журнал действий не делегируются.</Text>
    <EntityUsernameLookup entityType="account" isMuted onChange={setUsername} placeholder="username подписчика" searchEndpoint={`/public-pages/${pageUsername}/followers`} value={username} />
    <View style={styles.communityPermissionGroups}>
      {publicPagePermissionGroups.map((group) => {
        const visiblePermissions = group.permissions.filter((permission) => grantablePermissions.includes(permission.value));
        if (!visiblePermissions.length) return null;
        return <View key={group.title} style={styles.communityPermissionGroup}>
          <Text style={styles.communityPermissionGroupTitle}>{group.title}</Text>
          {visiblePermissions.map((permission) => {
            const isSelected = selectedPermissions.includes(permission.value);
            return <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: isSelected }}
              key={permission.value}
              onPress={() => togglePermission(permission.value)}
              style={styles.communityPermissionRow}
            >
              <View style={[styles.communityPermissionCheckbox, isSelected && styles.communityPermissionCheckboxActive]}>
                {isSelected ? <Check color="#fff" size={15} strokeWidth={2.4} /> : null}
              </View>
              <View style={styles.communityPermissionCopy}>
                <Text style={styles.communityPermissionLabel}>{permission.label}</Text>
                <Text style={styles.communityPermissionDescription}>{permission.description}</Text>
              </View>
            </Pressable>;
          })}
        </View>;
      })}
    </View>
    <View style={styles.communityPermissionFormActions}>
      {username || selectedPermissions.length ? <Pressable accessibilityRole="button" onPress={reset} style={styles.communityPermissionResetButton}><Text style={styles.communityPermissionResetText}>Сбросить</Text></Pressable> : null}
      <Pressable disabled={isSaving} onPress={() => void add()} style={[styles.publicPageTeamAddButton, styles.communityPermissionSaveButton, isSaving && styles.disabledButton]}>{isSaving ? <ActivityIndicator color="#fff" /> : <Text style={styles.publicPageTeamAddText}>{isEditing ? 'Сохранить права' : 'Добавить'}</Text>}</Pressable>
    </View>
    {administrators.map((item) => <View key={item.id} style={styles.publicPageTeamRow}>{item.account.avatarUrl ? <Image source={{ uri: item.account.avatarUrl }} style={styles.publicPageTeamAvatar} /> : <View style={styles.publicPageTeamAvatar}><Text style={styles.publicPageTeamAvatarText}>{getAvatarInitial(item.account.name)}</Text></View>}<View style={styles.publicPageTeamCopy}><Text style={styles.publicPageTeamName}>{item.account.name}</Text><Text style={styles.publicPageTeamUsername}>@{item.account.username}</Text><Text style={styles.communityAccessRoleLabel}>{item.permissions.length} {russianPlural(item.permissions.length, 'право', 'права', 'прав')}</Text></View><View style={styles.communityAdministratorActions}><Pressable accessibilityLabel="Настроить права" onPress={() => { setUsername(item.account.username); setSelectedPermissions(item.permissions.filter((permission) => grantablePermissions.includes(permission))); }} style={styles.publicPageTeamRemove}><Pencil color="#6f7b86" size={18} /></Pressable><Pressable accessibilityLabel="Убрать доступ" onPress={async () => { const response = await fetch(`${apiUrl}/public-pages/${pageUsername}/administrators/${item.account.username}`, { method: 'DELETE', headers: { Authorization: `Bearer ${authToken}` } }); if (response.ok) { setAdministrators((current) => current.filter((admin) => admin.id !== item.id)); if (username === item.account.username) reset(); await onChanged?.(); } else onNotify(await readApiError(response, 'Не удалось убрать доступ'), 'error'); }} style={styles.publicPageTeamRemove}><X color="#6f7b86" size={20} /></Pressable></View></View>)}
  </View>;
}

function PublicPageProductsSection({
  authToken,
  canManage,
  initialProducts,
  onNotify,
  pageUsername,
}: {
  authToken: string;
  canManage: boolean;
  initialProducts: PublicPageProduct[];
  onNotify: (message: string, type?: ToastMessage['type']) => void;
  pageUsername: string;
}) {
  const [products, setProducts] = useState(initialProducts);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [priceLabel, setPriceLabel] = useState('');
  const [currency, setCurrency] = useState<'RUB' | 'USD' | 'EUR'>('RUB');
  const [orderUrl, setOrderUrl] = useState('');
  const [images, setImages] = useState<Array<{ imageUrl: string; imageKey: string }>>([]);
  const [previewImage, setPreviewImage] = useState<{ name: string; url: string } | null>(null);

  useEffect(() => setProducts(initialProducts), [initialProducts]);

  const resetEditor = () => {
    setName('');
    setDescription('');
    setPriceLabel('');
    setCurrency('RUB');
    setOrderUrl('');
    setImages([]);
    setIsEditorOpen(false);
  };

  const selectImage = async () => {
    const remainingSlots = 5 - images.length;
    if (remainingSlots <= 0) {
      onNotify('К товару можно добавить не более 5 фотографий', 'error');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: remainingSlots,
      quality: 0.9,
    });
    const selectedAssets = result.canceled ? [] : result.assets.filter((asset) => Boolean(asset.uri)).slice(0, remainingSlots);
    if (!selectedAssets.length) return;
    setIsSaving(true);
    try {
      const uploaded: Array<{ imageUrl: string; imageKey: string }> = [];
      for (const asset of selectedAssets) uploaded.push(await uploadPostImageAsset(asset.uri, authToken));
      setImages((current) => [...current, ...uploaded].slice(0, 5));
    } catch (error) {
      onNotify(error instanceof Error ? error.message : 'Не удалось загрузить изображение товара', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const submit = async () => {
    const nextName = name.trim();
    if (!nextName) {
      onNotify('Укажите название товара', 'error');
      return;
    }
    const nextOrderUrl = orderUrl.trim();
    if (nextOrderUrl && !/^https:\/\//i.test(nextOrderUrl)) {
      onNotify('Ссылка для заказа должна начинаться с https://', 'error');
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch(`${apiUrl}/public-pages/${encodeURIComponent(pageUsername)}/products`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: nextName,
          description: description.trim() || undefined,
          priceLabel: priceLabel.trim() || undefined,
          currency,
          orderUrl: nextOrderUrl || undefined,
          imageKeys: images.map((image) => image.imageKey),
        }),
      });
      if (!response.ok) throw new Error(await readApiError(response, 'Не удалось добавить товар'));
      const product = await response.json() as PublicPageProduct;
      setProducts((current) => [...current, product]);
      resetEditor();
      onNotify('Товар добавлен', 'success');
    } catch (error) {
      onNotify(error instanceof Error ? error.message : 'Не удалось добавить товар', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const remove = async (productId: string) => {
    const response = await fetch(`${apiUrl}/public-pages/${encodeURIComponent(pageUsername)}/products/${encodeURIComponent(productId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (!response.ok) {
      onNotify(await readApiError(response, 'Не удалось удалить товар'), 'error');
      return;
    }
    setProducts((current) => current.filter((item) => item.id !== productId));
  };

  return (
    <View style={styles.publicPageProductsSection}>
      {canManage && !isEditorOpen ? (
        <Pressable accessibilityRole="button" onPress={() => setIsEditorOpen(true)} style={styles.postComposerTrigger}>
          <Plus color="#111" size={20} strokeWidth={2} />
          <Text style={styles.postComposerTriggerText}>Добавить товар</Text>
        </Pressable>
      ) : null}

      {canManage && isEditorOpen ? (
        <View style={styles.publicPageProductEditor}>
          <Pressable accessibilityLabel="Закрыть форму" onPress={resetEditor} style={styles.postComposerClose}>
            <X color="#111" size={21} />
          </Pressable>
          <Text style={styles.publicPageTeamEditorTitle}>Новый товар</Text>
          <View style={styles.publicPageProductImageEditorRow}>
            {images.map((image, index) => <View key={image.imageKey} style={styles.publicPageProductImageEditorItem}>
              <Image resizeMode="cover" source={{ uri: postImageThumbnail(image.imageUrl) ?? image.imageUrl }} style={styles.publicPageProductImage} />
              <Pressable accessibilityLabel={`Удалить фотографию ${index + 1}`} onPress={() => setImages((current) => current.filter((item) => item.imageKey !== image.imageKey))} style={styles.publicPageProductImageEditorRemove}><X color="#fff" size={15} strokeWidth={2.4} /></Pressable>
            </View>)}
            {images.length < 5 ? <Pressable accessibilityRole="button" onPress={() => void selectImage()} style={styles.publicPageProductImagePicker}>
              <ShoppingBag color="#6f7b86" size={27} strokeWidth={1.8} /><Text style={styles.publicPageProductImagePickerText}>{images.length ? `${images.length}/5` : 'Добавить фото'}</Text>
            </Pressable> : null}
          </View>
          <TextInput maxLength={100} onChangeText={setName} placeholder="Название" placeholderTextColor="#8e99a4" style={styles.publicPageTeamInput} value={name} />
          <View style={styles.publicPageProductPriceRow}>
            <TextInput keyboardType="decimal-pad" maxLength={12} onChangeText={(value) => setPriceLabel(value.replace(/[^0-9.,]/g, ''))} placeholder="Цена (необязательно)" placeholderTextColor="#8e99a4" style={[styles.publicPageTeamInput, styles.publicPageProductPriceInput]} value={priceLabel} />
            <View style={styles.publicPageProductCurrencyPicker}>
              {(['RUB', 'USD', 'EUR'] as const).map((value) => (
                <Pressable accessibilityRole="button" key={value} onPress={() => setCurrency(value)} style={[styles.publicPageProductCurrencyOption, currency === value && styles.publicPageProductCurrencyOptionActive]}>
                  <Text style={[styles.publicPageProductCurrencyText, currency === value && styles.publicPageProductCurrencyTextActive]}>{value === 'RUB' ? '₽' : value === 'USD' ? '$' : '€'}</Text>
                </Pressable>
              ))}
            </View>
          </View>
          <TextInput maxLength={600} multiline onChangeText={setDescription} placeholder="Описание" placeholderTextColor="#8e99a4" style={[styles.publicPageTeamInput, styles.publicPageProductDescriptionInput]} textAlignVertical="top" value={description} />
          <TextInput autoCapitalize="none" autoCorrect={false} keyboardType="url" maxLength={2_000} onChangeText={setOrderUrl} placeholder="Ссылка для заказа (необязательно)" placeholderTextColor="#8e99a4" style={styles.publicPageTeamInput} value={orderUrl} />
          <Pressable disabled={isSaving} onPress={() => void submit()} style={[styles.publicPageTeamAddButton, isSaving && styles.disabledButton]}>
            {isSaving ? <ActivityIndicator color="#fff" /> : <Text style={styles.publicPageTeamAddText}>Добавить</Text>}
          </Pressable>
        </View>
      ) : null}

      {!products.length && !isEditorOpen ? (
        <View style={styles.emptyProfileTab}>
          <ShoppingBag color="#111" size={30} strokeWidth={1.8} />
          <Text style={styles.emptyProfileTabTitle}>Товаров пока нет</Text>
          <Text style={styles.emptyProfileTabText}>Здесь появятся мерч, музыка, искусство и другие товары сообщества.</Text>
        </View>
      ) : null}

      <View style={styles.publicPageProductGrid}>
        {products.map((product) => (
          <View key={product.id} style={styles.publicPageProductCard}>
            {(product.imageUrls?.length || product.imageUrl) ? <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} style={styles.publicPageProductGallery}>{(product.imageUrls?.length ? product.imageUrls : [product.imageUrl!]).map((imageUrl, index) => <Pressable accessibilityLabel={`Открыть фотографию ${index + 1} товара ${product.name}`} accessibilityRole="imagebutton" key={imageUrl} onPress={() => setPreviewImage({ name: product.name, url: imageUrl })} style={styles.publicPageProductGalleryImage}><Image resizeMode="cover" source={{ uri: postImageThumbnail(imageUrl) ?? imageUrl }} style={styles.publicPageProductImage} /></Pressable>)}</ScrollView> : <View style={styles.publicPageProductPlaceholder}><ShoppingBag color="#6f7b86" size={30} strokeWidth={1.8} /></View>}
            {canManage ? <Pressable accessibilityLabel={`Удалить ${product.name}`} onPress={() => void remove(product.id)} style={styles.publicPageProductRemove}><X color="#fff" size={17} strokeWidth={2.2} /></Pressable> : null}
            <View style={styles.publicPageProductCopy}>
              <Text numberOfLines={2} style={styles.publicPageProductName}>{product.name}</Text>
              {product.priceLabel ? <Text numberOfLines={1} style={styles.publicPageProductPrice}>{product.priceLabel}{' '}{product.currency === 'USD' ? '$' : product.currency === 'EUR' ? '€' : '₽'}</Text> : null}
              {product.description ? <Text numberOfLines={3} style={styles.publicPageProductDescription}>{product.description}</Text> : null}
              {normalizeExternalHttpsUrl(product.orderUrl) ? <Pressable accessibilityRole="link" onPress={() => void openExternalHttpsUrl(product.orderUrl)} style={styles.publicPageProductOrderButton}><Text style={styles.publicPageProductOrderText}>Заказать</Text></Pressable> : null}
            </View>
          </View>
        ))}
      </View>
      <AvatarPreviewModal imageUrl={previewImage?.url ?? null} isVisible={Boolean(previewImage?.url)} name={previewImage?.name ?? ''} onClose={() => setPreviewImage(null)} />
    </View>
  );
}

function PublicPagePartnersSection({
  canManage,
  isEmbedded = false,
  onAddPartnerPage,
  onNotify,
  onOpenPublicPage,
  onRemovePartnerPage,
  partners,
  showEditor = true,
}: {
  canManage: boolean;
  isEmbedded?: boolean;
  onAddPartnerPage: (data: PartnerPageInput) => Promise<void>;
  onNotify: (message: string, type?: ToastMessage['type']) => void;
  onOpenPublicPage: (username: string) => Promise<void>;
  onRemovePartnerPage: (partnerId: string) => Promise<void>;
  partners: PartnerReference[];
  showEditor?: boolean;
}) {
  const [value, setValue] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isEditorOpen, setIsEditorOpen] = useState(false);

  const submit = async () => {
    const nextValue = value.trim();

    if (!nextValue) {
      onNotify('Укажите название партнёра', 'error');
      return;
    }

    setIsSaving(true);
    try {
      await onAddPartnerPage({ value: nextValue });
      setValue('');
      setIsEditorOpen(false);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : 'Не удалось добавить партнера', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <View style={[styles.publicPageTeamList, isEmbedded && styles.publicPageTeamListEmbedded]}>
      {canManage && showEditor && !isEditorOpen ? <Pressable accessibilityRole="button" onPress={() => setIsEditorOpen(true)} style={styles.postComposerTrigger}><Plus color="#111" size={20} strokeWidth={2} /><Text style={styles.postComposerTriggerText}>Добавить партнёра</Text></Pressable> : null}
      {canManage && showEditor && isEditorOpen ? (
        <View style={[styles.publicPageTeamEditor, isEmbedded && styles.publicPageTeamEditorEmbedded]}>
          <Pressable accessibilityLabel="Закрыть форму" onPress={() => setIsEditorOpen(false)} style={styles.postComposerClose}><X color="#111" size={21} /></Pressable>
          <Text style={styles.publicPageTeamEditorTitle}>Добавить партнёра</Text>
          <EntityUsernameLookup
            allowFreeText
            entityType="community"
            maxLength={80}
            onChange={setValue}
            placeholder="@username или название партнёра"
            value={value}
          />
          <Pressable disabled={isSaving} onPress={submit} style={[styles.publicPageTeamAddButton, isSaving && styles.disabledButton]}>
            {isSaving ? <ActivityIndicator color="#fff" /> : <Text style={styles.publicPageTeamAddText}>Добавить</Text>}
          </Pressable>
        </View>
      ) : null}

      {partners.map((partner) => (
        <Pressable disabled={!partner.username} key={partner.id} onPress={() => partner.username ? void onOpenPublicPage(partner.username) : undefined} style={styles.publicPageTeamRow}>
          {partner.avatarUrl ? (
            <Image source={{ uri: partner.avatarUrl }} style={styles.publicPageTeamAvatar} resizeMode="cover" />
          ) : (
            <View style={styles.publicPageTeamAvatar}>
              <Text style={styles.publicPageTeamAvatarText}>{getAvatarInitial(partner.name)}</Text>
            </View>
          )}
          <View style={styles.publicPageTeamCopy}>
            <Text numberOfLines={1} style={styles.publicPageTeamName}>
              {partner.name}
            </Text>
            {partner.username ? <Text numberOfLines={1} style={styles.publicPageTeamUsername}>@{partner.username}</Text> : null}
            {partner.typeLabel || partner.cityName ? <Text numberOfLines={1} style={styles.publicPageTeamRole}>{[partner.typeLabel, partner.cityName].filter(Boolean).join(' · ')}</Text> : null}
          </View>
          {canManage && showEditor ? (
            <Pressable
              onPress={async (event) => {
                event.stopPropagation();
                try {
                  await onRemovePartnerPage(partner.id);
                } catch (error) {
                  onNotify(error instanceof Error ? error.message : 'Не удалось убрать партнера', 'error');
                }
              }}
              style={styles.publicPageTeamRemove}
            >
              <X color="#6f7b86" size={20} strokeWidth={2} />
            </Pressable>
          ) : null}
        </Pressable>
      ))}
    </View>
  );
}

function PublicPageTeamSection({
  canManage,
  isEmbedded = false,
  members,
  onAddTeamMember,
  onNotify,
  onOpenProfile,
  onRemoveTeamMember,
  showEditor = true,
}: {
  canManage: boolean;
  isEmbedded?: boolean;
  members: PublicPageTeamMember[];
  onAddTeamMember: (data: TeamMemberInput) => Promise<void>;
  onNotify: (message: string, type?: ToastMessage['type']) => void;
  onOpenProfile: (username: string) => Promise<void>;
  onRemoveTeamMember: (accountUsername: string) => Promise<void>;
  showEditor?: boolean;
}) {
  const [username, setUsername] = useState('');
  const [roleTitle, setRoleTitle] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isEditorOpen, setIsEditorOpen] = useState(false);

  const submit = async () => {
    const nextUsername = username.replace(/^@/, '').trim().toLowerCase();

    if (!nextUsername) {
      onNotify('Укажите username участника', 'error');
      return;
    }

    setIsSaving(true);
    try {
      await onAddTeamMember({ username: nextUsername, roleTitle });
      setUsername('');
      setRoleTitle('');
      setIsEditorOpen(false);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : 'Не удалось добавить участника команды', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <View style={[styles.publicPageTeamList, isEmbedded && styles.publicPageTeamListEmbedded]}>
      {canManage && showEditor && !isEditorOpen ? <Pressable accessibilityRole="button" onPress={() => setIsEditorOpen(true)} style={styles.postComposerTrigger}><Plus color="#111" size={20} strokeWidth={2} /><Text style={styles.postComposerTriggerText}>Добавить участника</Text></Pressable> : null}
      {canManage && showEditor && isEditorOpen ? (
        <View style={[styles.publicPageTeamEditor, isEmbedded && styles.publicPageTeamEditorEmbedded]}>
          <Pressable accessibilityLabel="Закрыть форму" onPress={() => setIsEditorOpen(false)} style={styles.postComposerClose}><X color="#111" size={21} /></Pressable>
          <Text style={styles.publicPageTeamEditorTitle}>Добавить в команду</Text>
          <View style={styles.publicPageTeamEditorFields}>
            <EntityUsernameLookup entityType="account" onChange={setUsername} placeholder="username" value={username} />
            <TextInput
              onChangeText={setRoleTitle}
              placeholder="Роль"
              placeholderTextColor="#98a3ae"
              style={styles.publicPageTeamInput}
              value={roleTitle}
            />
          </View>
          <Pressable disabled={isSaving} onPress={submit} style={[styles.publicPageTeamAddButton, isSaving && styles.disabledButton]}>
            {isSaving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.publicPageTeamAddText}>Добавить</Text>
            )}
          </Pressable>
        </View>
      ) : null}

      {!members.length ? (
        <View style={styles.emptyProfileTab}>
          <UsersRound color="#111" size={30} strokeWidth={1.8} />
          <Text style={styles.emptyProfileTabTitle}>Команда пока не указана</Text>
          <Text style={styles.emptyProfileTabText}>Владелец сообщества сможет добавить сюда профили людей из команды.</Text>
        </View>
      ) : null}

      {members.map((member) => (
        <Pressable
          key={member.id}
          onPress={() => void onOpenProfile(member.account.username)}
          style={styles.publicPageTeamRow}
        >
          {member.account.avatarUrl ? (
            <Image source={{ uri: member.account.avatarUrl }} style={styles.publicPageTeamAvatar} resizeMode="cover" />
          ) : (
            <View style={styles.publicPageTeamAvatar}>
              <Text style={styles.publicPageTeamAvatarText}>{getAvatarInitial(member.account.name)}</Text>
            </View>
          )}
          <View style={styles.publicPageTeamCopy}>
            <Text numberOfLines={1} style={styles.publicPageTeamName}>
              {member.account.name}
            </Text>
            <Text numberOfLines={1} style={styles.publicPageTeamUsername}>
              @{member.account.username}
            </Text>
            {member.roleTitle ? (
              <Text numberOfLines={1} style={styles.publicPageTeamRole}>
                {member.roleTitle}
              </Text>
            ) : null}
          </View>
          {canManage && showEditor ? (
            <Pressable
              onPress={async (event) => {
                event.stopPropagation();
                try {
                  await onRemoveTeamMember(member.account.username);
                } catch (error) {
                  onNotify(error instanceof Error ? error.message : 'Не удалось убрать участника команды', 'error');
                }
              }}
              style={styles.publicPageTeamRemove}
            >
              <X color="#6f7b86" size={20} strokeWidth={2} />
            </Pressable>
          ) : null}
        </Pressable>
      ))}
    </View>
  );
}

function ConnectAccountGridCard({
  account,
  onPress,
  showCommittedLike = false,
}: {
  account: PublicAccount;
  onPress: () => void;
  showCommittedLike?: boolean;
}) {
  const cityLabel = formatCityName(account.countryName, account.cityName);
  const locationLabel = formatConnectLocationLabel(cityLabel, account.connectDistanceKm);
  const connectImageUrl = account.connectPhotos[0]?.imageUrl ?? account.avatarUrl;
  const compactImageUrl = connectPhotoThumbnail(connectImageUrl) ?? connectImageUrl;
  return (
    <Pressable accessibilityLabel={`Посмотреть фотографии ${account.name}`} onPress={onPress} style={styles.connectGridCard}>
      <View style={styles.connectGridAvatar}>
        <View style={styles.connectGridPhoto}>
          {compactImageUrl ? (
            <Image source={{ uri: compactImageUrl }} style={styles.connectGridAvatarImage} resizeMode="cover" />
          ) : (
            <Text style={styles.connectGridAvatarText}>{account.name.slice(0, 1).toUpperCase()}</Text>
          )}
          <Svg pointerEvents="none" style={styles.connectGridInfoGradient} width="100%" height="100%">
            <Defs>
              <LinearGradient id={`connect-grid-info-gradient-${account.id}`} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor="#111" stopOpacity="0" />
                <Stop offset="0.75" stopColor="#111" stopOpacity="0" />
                <Stop offset="0.84" stopColor="#111" stopOpacity="0.14" />
                <Stop offset="0.91" stopColor="#111" stopOpacity="0.46" />
                <Stop offset="0.96" stopColor="#111" stopOpacity="0.8" />
                <Stop offset="1" stopColor="#111" stopOpacity="1" />
              </LinearGradient>
            </Defs>
            <Rect width="100%" height="100%" fill={`url(#connect-grid-info-gradient-${account.id})`} />
          </Svg>
        </View>
        <View pointerEvents="none" style={styles.connectGridInfo}>
          <VerifiedName badgeInverted isVerified={account.isVerified} name={`${account.name}${account.age ? `, ${account.age}` : ''}`} style={styles.connectGridName} />
          {locationLabel ? <Text ellipsizeMode="tail" numberOfLines={1} style={styles.connectGridCity}>{locationLabel}</Text> : null}
        </View>
        {showCommittedLike ? (
          <View pointerEvents="none" style={styles.connectGridCommittedLike}>
            <Heart color="#fff" fill="#ff3b5c" size={21} strokeWidth={2} />
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

function ConnectCommunityGridCard({
  page,
  onPress,
}: {
  page: PublicPage;
  onPress: () => void;
}) {
  const cityLabel = formatCityName(page.countryName, page.cityName);
  const locationLabel = formatConnectLocationLabel(cityLabel, page.connectDistanceKm);
  const connectImageUrl = page.connectPhotos?.[0]?.imageUrl ?? page.connectImageUrl ?? page.avatarUrl;
  const compactImageUrl = connectPhotoThumbnail(connectImageUrl) ?? connectImageUrl;
  return (
    <Pressable accessibilityLabel={`Открыть сообщество ${page.name}`} onPress={onPress} style={styles.connectGridCard}>
      <View style={styles.connectGridAvatar}>
        <View style={styles.connectGridPhoto}>
          {compactImageUrl ? (
            <Image source={{ uri: compactImageUrl }} style={styles.connectGridAvatarImage} resizeMode="cover" />
          ) : (
            <Text style={styles.connectGridAvatarText}>{getAvatarInitial(page.name)}</Text>
          )}
          <Svg pointerEvents="none" style={styles.connectGridInfoGradient} width="100%" height="100%">
            <Defs>
              <LinearGradient id={`connect-community-gradient-${page.id}`} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor="#111" stopOpacity="0" />
                <Stop offset="0.75" stopColor="#111" stopOpacity="0" />
                <Stop offset="0.84" stopColor="#111" stopOpacity="0.14" />
                <Stop offset="0.91" stopColor="#111" stopOpacity="0.46" />
                <Stop offset="0.96" stopColor="#111" stopOpacity="0.8" />
                <Stop offset="1" stopColor="#111" stopOpacity="1" />
              </LinearGradient>
            </Defs>
            <Rect width="100%" height="100%" fill={`url(#connect-community-gradient-${page.id})`} />
          </Svg>
        </View>
        <View pointerEvents="none" style={styles.connectGridInfo}>
          <VerifiedName badgeInverted isVerified={page.isVerified} name={page.name} style={styles.connectGridName} />
          {locationLabel ? <Text ellipsizeMode="tail" numberOfLines={1} style={styles.connectGridCity}>{locationLabel}</Text> : null}
        </View>
      </View>
    </Pressable>
  );
}

function formatConnectLocationLabel(cityLabel: string, distanceKm?: number | null) {
  const distanceLabel = typeof distanceKm === 'number' && Number.isFinite(distanceKm)
    ? `${Math.max(0, distanceKm)} км`
    : '';
  return [cityLabel, distanceLabel].filter(Boolean).join(' · ');
}

export function CommunityScreen({
  connectEnabled,
  onCheckProfileReport,
  onNotify,
  onOpenEditProfile,
  onOpenMenu,
  onOpenMessages,
  onOpenNotifications,
  onOpenProfile,
  onOpenPublicPage,
  onReportProfile,
  ownUsername,
}: {
  connectEnabled: boolean;
  onCheckProfileReport: (username: string) => Promise<boolean>;
  onNotify: (message: string, type?: ToastMessage['type']) => void;
  onOpenEditProfile: () => void;
  onOpenMenu: () => void;
  onOpenMessages: () => void;
  onOpenNotifications: () => void;
  onOpenProfile: (username: string) => Promise<void>;
  onOpenPublicPage: (username: string) => Promise<void>;
  onReportProfile: (username: string, reason: SafetyReportReason, details?: string) => Promise<void>;
  ownUsername: string;
}) {
  const [accounts, setAccounts] = useState<PublicAccount[]>([]);
  const [pages, setPages] = useState<PublicPage[]>([]);
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  const [gender, setGender] = useState<'ANY' | Gender>('ANY');
  const [ageRange, setAgeRange] = useState<[number, number]>([connectMinimumAge, connectMaximumAge]);
  const [maximumConnectAge, setMaximumConnectAge] = useState(connectMaximumAge);
  const [areConnectPreferencesLoaded, setAreConnectPreferencesLoaded] = useState(false);
  const [goals, setGoals] = useState<ConnectGoal[]>(defaultConnectFilterGoals);
  const [includeCommunities, setIncludeCommunities] = useState(true);
  const [filterInterests, setFilterInterests] = useState<string[]>([]);
  const [filterMusicGenres, setFilterMusicGenres] = useState<string[]>([]);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [pagesNextCursor, setPagesNextCursor] = useState<string | null>(null);
  const [selectedConnectAccount, setSelectedConnectAccount] = useState<PublicAccount | null>(null);
  const [reportingConnectAccount, setReportingConnectAccount] = useState<PublicAccount | null>(null);
  const [checkingReportUsername, setCheckingReportUsername] = useState<string | null>(null);
  const [reportedConnectUsernames, setReportedConnectUsernames] = useState<Set<string>>(() => new Set());
  const [isOwnProfileLoading, setIsOwnProfileLoading] = useState(false);
  const [likedConnectUsernames, setLikedConnectUsernames] = useState<Set<string>>(() => new Set());
  const [committedConnectUsernames, setCommittedConnectUsernames] = useState<Set<string>>(() => new Set());
  const [matches, setMatches] = useState<PublicAccount[]>([]);
  const [matchesNextCursor, setMatchesNextCursor] = useState<string | null>(null);
  const [isMatchesOpen, setIsMatchesOpen] = useState(false);
  const [isMatchesLoading, setIsMatchesLoading] = useState(false);
  const [isMatchesLoadingMore, setIsMatchesLoadingMore] = useState(false);
  const committingConnectLikesRef = useRef(new Set<string>());
  const lastConnectLocationSyncRef = useRef(0);
  const activeFilterCount = areConnectPreferencesLoaded
    ? activeConnectFilterCount({
      ageRange,
      gender,
      goals,
      includeCommunities,
      interests: filterInterests,
      musicGenres: filterMusicGenres,
    }, maximumConnectAge)
    : 0;

  useEffect(() => {
    let isCurrent = true;
    if (!connectEnabled) {
      setAreConnectPreferencesLoaded(true);
      return () => { isCurrent = false; };
    }
    setAreConnectPreferencesLoaded(false);
    void (async () => {
      try {
        const response = await fetch(`${apiUrl}/profiles/connect-preferences`);
        if (!response.ok) throw new Error(await readApiError(response, 'Не удалось загрузить фильтры Коннекта'));
        const preferences = await response.json() as {
          minAge: number;
          maxAge: number;
          maximumAge: number;
          gender: 'ANY' | Gender;
          goals: ConnectGoal[];
          includeCommunities: boolean;
          interests: string[];
          musicGenres: string[];
        };
        if (!isCurrent) return;
        const nextMaximumAge = preferences.maximumAge === 60 ? 60 : connectMaximumAge;
        setMaximumConnectAge(nextMaximumAge);
        setAgeRange(normalizeConnectAgeRange([preferences.minAge, preferences.maxAge], nextMaximumAge));
        setGender(preferences.gender);
        setGoals(preferences.goals);
        setIncludeCommunities(preferences.includeCommunities);
        setFilterInterests(preferences.interests);
        setFilterMusicGenres(preferences.musicGenres);
      } catch {
        if (!isCurrent) return;
        setMaximumConnectAge(connectMaximumAge);
        setAgeRange([connectMinimumAge, connectMaximumAge]);
        setGender('ANY');
        setGoals(defaultConnectFilterGoals);
        setIncludeCommunities(true);
        setFilterInterests([]);
        setFilterMusicGenres([]);
      } finally {
        if (isCurrent) setAreConnectPreferencesLoaded(true);
      }
    })();
    return () => { isCurrent = false; };
  }, [connectEnabled, ownUsername]);

  const persistConnectFilters = useCallback((value: ConnectFilterPreferences) => {
    void (async () => {
      try {
        const response = await fetch(`${apiUrl}/profiles/connect-preferences`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            minAge: value.ageRange[0],
            maxAge: value.ageRange[1],
            gender: value.gender,
            goals: value.goals,
            includeCommunities: value.includeCommunities,
            interests: value.interests,
            musicGenres: value.musicGenres,
          }),
        });
        if (!response.ok) throw new Error(await readApiError(response, 'Не удалось сохранить фильтры Коннекта'));
      } catch (error) {
        onNotify(error instanceof Error ? error.message : 'Не удалось сохранить фильтры Коннекта', 'error');
      }
    })();
  }, [onNotify]);

  const applyConnectFilters = useCallback((next: ConnectFilterPreferences) => {
    const normalizedNext = {
      ...next,
      ageRange: normalizeConnectAgeRange(next.ageRange, maximumConnectAge),
    };
    const sameValues = (current: string[], incoming: string[]) => (
      current.length === incoming.length && current.every((value, index) => value === incoming[index])
    );
    const filtersChanged = (
      ageRange[0] !== normalizedNext.ageRange[0]
      || ageRange[1] !== normalizedNext.ageRange[1]
      || gender !== normalizedNext.gender
      || !sameValues(goals, normalizedNext.goals)
      || includeCommunities !== normalizedNext.includeCommunities
      || !sameValues(filterInterests, normalizedNext.interests)
      || !sameValues(filterMusicGenres, normalizedNext.musicGenres)
    );
    setAgeRange((current) => (
      current[0] === normalizedNext.ageRange[0] && current[1] === normalizedNext.ageRange[1]
        ? current
        : normalizedNext.ageRange
    ));
    setGender((current) => current === normalizedNext.gender ? current : normalizedNext.gender);
    setGoals((current) => sameValues(current, normalizedNext.goals) ? current : normalizedNext.goals);
    setIncludeCommunities((current) => (
      current === normalizedNext.includeCommunities ? current : normalizedNext.includeCommunities
    ));
    setFilterInterests((current) => (
      sameValues(current, normalizedNext.interests) ? current : normalizedNext.interests
    ));
    setFilterMusicGenres((current) => (
      sameValues(current, normalizedNext.musicGenres) ? current : normalizedNext.musicGenres
    ));
    setIsFiltersOpen(false);
    if (filtersChanged) persistConnectFilters(normalizedNext);
  }, [
    ageRange,
    filterInterests,
    filterMusicGenres,
    gender,
    goals,
    includeCommunities,
    maximumConnectAge,
    persistConnectFilters,
  ]);

  const syncConnectLocation = useCallback(async () => {
    if (Date.now() - lastConnectLocationSyncRef.current < 5 * 60 * 1_000) return;
    try {
      const permission = await Location.getForegroundPermissionsAsync();
      if (!permission.granted) return;
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const response = await fetch(`${apiUrl}/profiles/connect-location`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        }),
      });
      if (response.ok) lastConnectLocationSyncRef.current = Date.now();
    } catch {
      // Ranking safely falls back to the profile city when location is unavailable.
    }
  }, []);

  const loadMatches = useCallback(async (reset = true) => {
    if (!connectEnabled || (!reset && !matchesNextCursor)) return;
    reset ? setIsMatchesLoading(true) : setIsMatchesLoadingMore(true);
    try {
      const cursorQuery = !reset && matchesNextCursor ? `&cursor=${encodeURIComponent(matchesNextCursor)}` : '';
      const response = await fetch(`${apiUrl}/profiles/connect/matches?pageSize=10${cursorQuery}`, {
        cache: reset ? 'no-store' : undefined,
      });
      if (!response.ok) throw new Error(await readApiError(response, 'Не удалось загрузить совпадения'));
      const page = await response.json() as CursorPage<PublicAccount>;
      setMatches((current) => reset
        ? page.items
        : [...current, ...page.items.filter((item) => !current.some((existing) => existing.id === item.id))]);
      setMatchesNextCursor(page.nextCursor);
    } catch {
      if (reset) setMatches([]);
    } finally {
      setIsMatchesLoading(false);
      setIsMatchesLoadingMore(false);
    }
  }, [connectEnabled, matchesNextCursor]);

  const loadAccounts = useCallback(async (reset = true, source: 'initial' | 'refresh' = 'initial') => {
    if (!connectEnabled) {
      setIsInitialLoading(false);
      setIsRefreshing(false);
      setIsLoadingMore(false);
      return;
    }
    const canLoadMoreAccounts = Boolean(nextCursor);
    const canLoadMorePages = includeCommunities && !filterInterests.length && Boolean(pagesNextCursor);
    if (!reset && !canLoadMoreAccounts && !canLoadMorePages) return;
    if (reset) source === 'refresh' ? setIsRefreshing(true) : setIsInitialLoading(true);
    else setIsLoadingMore(true);
    if (reset) setLoadError(null);
    try {
      if (reset) await syncConnectLocation();
      const cursorQuery = !reset && nextCursor ? `&cursor=${encodeURIComponent(nextCursor)}` : '';
      const pagesCursorQuery = !reset && pagesNextCursor ? `&cursor=${encodeURIComponent(pagesNextCursor)}` : '';
      const interestsQuery = filterInterests.length ? `&interests=${encodeURIComponent(filterInterests.join(','))}` : '';
      const musicGenresQuery = filterMusicGenres.length ? `&musicGenres=${encodeURIComponent(filterMusicGenres.join(','))}` : '';
      const ageQuery = `&minAge=${ageRange[0]}&maxAge=${ageRange[1]}`;
      const filterQuery = `${gender === 'ANY' ? '' : `&gender=${gender}`}&goals=${goals.join(',')}${ageQuery}${interestsQuery}${musicGenresQuery}`;
      const shouldLoadAccounts = reset || canLoadMoreAccounts;
      const shouldLoadPages = includeCommunities && !filterInterests.length && (reset || canLoadMorePages);
      const [response, pagesResponse] = await Promise.all([
        shouldLoadAccounts
        ? fetch(`${apiUrl}/profiles?pageSize=10&connectOnly=true${filterQuery}${cursorQuery}`, {
            cache: source === 'refresh' ? 'no-store' : undefined,
          })
        : null,
        shouldLoadPages
          ? fetch(`${apiUrl}/public-pages?pageSize=10&connectOnly=true&goals=${encodeURIComponent(goals.join(','))}${musicGenresQuery}${pagesCursorQuery}`, {
              cache: source === 'refresh' ? 'no-store' : undefined,
            })
          : null,
      ]);
      if (response && !response.ok) throw new Error(await readApiError(response, 'Не удалось загрузить Коннект'));
      if (pagesResponse && !pagesResponse.ok) throw new Error(await readApiError(pagesResponse, 'Не удалось загрузить сообщества Коннекта'));
      const page = response ? await response.json() as CursorPage<PublicAccount> : null;
      const publicPage = pagesResponse ? await pagesResponse.json() as CursorPage<PublicPage> : null;
      const committedUsernames = (page?.items ?? []).filter((item) => item.viewerConnectLiked).map((item) => item.username);
      if (committedUsernames.length) {
        setCommittedConnectUsernames((current) => new Set([...current, ...committedUsernames]));
        setLikedConnectUsernames((current) => new Set([...current, ...committedUsernames]));
      }
      if (page) {
        setAccounts((current) => reset ? page.items : [...current, ...page.items.filter((item) => !current.some((existing) => existing.id === item.id))]);
        setNextCursor(page.nextCursor);
      } else if (reset) {
        setAccounts([]);
        setNextCursor(null);
      }
      if (publicPage) {
        setPages((current) => reset
          ? publicPage.items
          : [...current, ...publicPage.items.filter((item) => !current.some((existing) => existing.id === item.id))]);
        setPagesNextCursor(publicPage.nextCursor);
      } else if (reset) {
        setPages([]);
        setPagesNextCursor(null);
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Не удалось загрузить Коннект');
    } finally {
      setIsInitialLoading(false);
      setIsRefreshing(false);
      setIsLoadingMore(false);
    }
  }, [ageRange, connectEnabled, filterInterests, filterMusicGenres, gender, goals, includeCommunities, nextCursor, pagesNextCursor, syncConnectLocation]);

  const commitConnectLike = useCallback(async (username: string) => {
    if (
      username === ownUsername
      || !likedConnectUsernames.has(username)
      || committedConnectUsernames.has(username)
      || committingConnectLikesRef.current.has(username)
    ) return;

    committingConnectLikesRef.current.add(username);
    setCommittedConnectUsernames((current) => new Set(current).add(username));
    try {
      const response = await fetch(`${apiUrl}/profiles/${encodeURIComponent(username)}/connect-like`, {
        method: 'POST',
      });
      if (!response.ok) throw new Error(await readApiError(response, 'Не удалось отправить лайк'));
      const result = await response.json() as { matched?: boolean };
      setAccounts((current) => current.map((account) => (
        account.username === username ? { ...account, viewerConnectLiked: true } : account
      )));
      if (result.matched) {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setAccounts((current) => current.filter((account) => account.username !== username));
        void loadMatches(true);
      }
    } catch (error) {
      setCommittedConnectUsernames((current) => {
        const next = new Set(current);
        next.delete(username);
        return next;
      });
      setLikedConnectUsernames((current) => {
        const next = new Set(current);
        next.delete(username);
        return next;
      });
      Alert.alert('Коннект', error instanceof Error ? error.message : 'Не удалось отправить лайк');
    } finally {
      committingConnectLikesRef.current.delete(username);
    }
  }, [committedConnectUsernames, likedConnectUsernames, loadMatches, ownUsername]);

  const closeConnectProfile = useCallback(() => {
    if (selectedConnectAccount) void commitConnectLike(selectedConnectAccount.username);
    setSelectedConnectAccount(null);
  }, [commitConnectLike, selectedConnectAccount]);

  useEffect(() => {
    setAccounts([]);
    setPages([]);
    setNextCursor(null);
    setPagesNextCursor(null);
    if (connectEnabled && areConnectPreferencesLoaded) {
      void loadAccounts(true);
      void loadMatches(true);
    }
    else if (!connectEnabled) setIsInitialLoading(false);
    // Cursor is intentionally excluded: loading another page must not reset the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ageRange, areConnectPreferencesLoaded, connectEnabled, ownUsername, gender, goals, includeCommunities, filterInterests, filterMusicGenres]);

  const connectItems: CatalogItem[] = [
    ...accounts.map((value) => ({ kind: 'account' as const, value })),
    ...pages.map((value) => ({ kind: 'community' as const, value })),
  ].sort((left, right) => (
    (left.value.connectDistanceKm ?? Number.POSITIVE_INFINITY)
    - (right.value.connectDistanceKm ?? Number.POSITIVE_INFINITY)
  ));
  const navigationAccounts = isMatchesOpen ? matches : accounts;
  const selectedConnectAccountIndex = selectedConnectAccount
    ? navigationAccounts.findIndex((candidate) => candidate.id === selectedConnectAccount.id)
    : -1;
  const adjacentConnectAccounts = selectedConnectAccountIndex >= 0 && navigationAccounts.length > 1
    ? [-1, 1]
        .map((direction) => navigationAccounts[
          (selectedConnectAccountIndex + direction + navigationAccounts.length) % navigationAccounts.length
        ])
        .filter((candidate, index, candidates) => (
          Boolean(candidate)
          && candidate.id !== selectedConnectAccount?.id
          && candidates.findIndex((item) => item.id === candidate.id) === index
        ))
    : [];
  const openOwnConnectProfile = useCallback(async () => {
    if (isOwnProfileLoading) return;
    setIsOwnProfileLoading(true);
    try {
      const response = await fetch(`${apiUrl}/profiles/${encodeURIComponent(ownUsername)}`);
      if (!response.ok) throw new Error(await readApiError(response, 'Не удалось загрузить ваш профиль'));
      const profile = await response.json() as Profile & { age?: number | null };
      setSelectedConnectAccount({ ...profile, age: profile.age ?? null });
    } catch (error) {
      Alert.alert('Мой профиль', error instanceof Error ? error.message : 'Не удалось загрузить ваш профиль');
    } finally {
      setIsOwnProfileLoading(false);
    }
  }, [isOwnProfileLoading, ownUsername]);

  if (!connectEnabled) {
    return (
      <>
        <ScreenTopBar onOpenMenu={onOpenMenu} onOpenMessages={onOpenMessages} onOpenNotifications={onOpenNotifications} title="Коннект" />
        <View style={styles.connectDisabledState}>
          <Text style={styles.connectDisabledTitle}>Коннект не активирован</Text>
          <Text style={styles.connectDisabledText}>
            Включите Коннект в своем{' '}
            <Text accessibilityRole="link" onPress={onOpenEditProfile} style={styles.connectDisabledLink}>профиле</Text>
          </Text>
        </View>
      </>
    );
  }

  const matchesGrid = (
    <>
      <CatalogInnerHeader backLabel="Назад в Коннект" onBack={() => setIsMatchesOpen(false)} title="Совпадения" />
      <FlashList
        data={matches}
        numColumns={2}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.connectGridContent}
        onEndReached={() => void loadMatches(false)}
        onEndReachedThreshold={0.4}
        renderItem={({ item }) => <ConnectAccountGridCard account={item} onPress={() => setSelectedConnectAccount(item)} showCommittedLike />}
        ListEmptyComponent={isMatchesLoading
          ? <View style={styles.loadingRow}><ActivityIndicator color="#111" /></View>
          : <View style={styles.emptyProfileTab}><Text style={styles.emptyProfileTabTitle}>Здесь пока ничего нет</Text></View>}
        ListFooterComponent={isMatchesLoadingMore ? <ActivityIndicator color="#111" style={{ marginVertical: 16 }} /> : null}
        showsVerticalScrollIndicator={false}
      />
    </>
  );

  return (
    <>
      <ScreenTopBar onOpenMenu={onOpenMenu} onOpenMessages={onOpenMessages} onOpenNotifications={onOpenNotifications} title="Коннект" />
      {isMatchesOpen ? matchesGrid : <FlashList
        alwaysBounceVertical
        data={connectItems}
        numColumns={2}
        keyExtractor={(item) => `${item.kind}:${item.value.id}`}
        contentContainerStyle={styles.connectGridContent}
        refreshControl={<AppRefreshControl refreshing={isRefreshing} tintColor="#111" onRefresh={() => void loadAccounts(true, 'refresh')} />}
        showsVerticalScrollIndicator={false}
        onEndReached={() => void loadAccounts(false)}
        onEndReachedThreshold={0.4}
        ListHeaderComponent={
          <>
            {isMatchesLoading || matches.length ? <View style={styles.connectMatchesPreview}>
              <View style={styles.connectMatchesHeader}>
                <Text style={styles.connectMatchesTitle}>Совпадения</Text>
                <Pressable accessibilityLabel="Показать все совпадения" accessibilityRole="button" onPress={() => setIsMatchesOpen(true)} style={styles.connectMatchesAllButton}>
                  <Text style={styles.connectMatchesAllText}>Все</Text>
                  <ChevronRight color="#6f7b86" size={18} strokeWidth={1.8} />
                </Pressable>
              </View>
              {isMatchesLoading && !matches.length ? <ActivityIndicator color="#6f7b86" style={styles.connectMatchesLoader} /> : matches.length ? (
                  <ScrollView horizontal contentContainerStyle={styles.connectMatchesList} showsHorizontalScrollIndicator={false}>
                    {matches.map((account) => {
                      const imageUrl = account.connectPhotos[0]?.imageUrl ?? account.avatarUrl;
                      const compactImageUrl = connectPhotoThumbnail(imageUrl) ?? imageUrl;
                      return (
                        <Pressable accessibilityLabel={`Открыть совпадение ${account.name}`} accessibilityRole="button" key={account.id} onPress={() => setSelectedConnectAccount(account)} style={styles.connectMatchPreviewItem}>
                          <View style={styles.connectMatchPreviewAvatar}>
                            {compactImageUrl ? <Image source={{ uri: compactImageUrl }} style={styles.connectMatchPreviewImage} /> : <Text style={styles.connectMatchPreviewInitial}>{getAvatarInitial(account.name)}</Text>}
                          </View>
                          <Text numberOfLines={1} style={styles.connectMatchPreviewName}>@{account.username}</Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                ) : null}
            </View> : null}
            <View style={[styles.connectFilterBar, styles.connectFilterActions]}>
              <Pressable
                accessibilityLabel={activeFilterCount ? `Фильтры, активно: ${activeFilterCount}` : 'Фильтры'}
                accessibilityRole="button"
                onPress={() => setIsFiltersOpen(true)}
                style={[
                  styles.connectFilterButton,
                  styles.connectFilterActionButton,
                  activeFilterCount > 0 && styles.eventFilterButtonActive,
                ]}
              >
                <SlidersHorizontal color="#111" size={19} strokeWidth={1.9} />
                <Text style={styles.connectFilterButtonText}>Фильтры</Text>
                {activeFilterCount ? (
                  <View style={styles.eventFilterCountBadge}>
                    <Text style={styles.eventFilterCountBadgeText}>{activeFilterCount}</Text>
                  </View>
                ) : null}
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={isOwnProfileLoading}
                onPress={() => void openOwnConnectProfile()}
                style={[styles.connectFilterButton, styles.connectFilterActionButton]}
              >
                {isOwnProfileLoading
                  ? <ActivityIndicator color="#111" size="small" />
                  : <UserRound color="#111" size={19} strokeWidth={1.9} />}
                <Text style={styles.connectFilterButtonText}>Мой профиль</Text>
              </Pressable>
            </View>
          </>
        }
        ListEmptyComponent={
          isInitialLoading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color="#111" />
            </View>
          ) : loadError ? (
            <View style={styles.emptyProfileTab}><Text style={styles.emptyProfileTabTitle}>{loadError}</Text><Pressable onPress={() => void loadAccounts(true)} style={styles.notificationsRetryButton}><Text style={styles.notificationsRetryText}>Повторить</Text></Pressable></View>
          ) : null
        }
        renderItem={({ item }) => {
          if (item.kind === 'community') {
            return <ConnectCommunityGridCard page={item.value} onPress={() => void onOpenPublicPage(item.value.username)} />;
          }
          return <ConnectAccountGridCard account={item.value} onPress={() => setSelectedConnectAccount(item.value)} showCommittedLike={committedConnectUsernames.has(item.value.username)} />;
        }}
        ListFooterComponent={isLoadingMore ? <ActivityIndicator color="#111" style={{ marginVertical: 16 }} /> : null}
      />}
      <ConnectFiltersModal
        ageRange={ageRange}
        gender={gender}
        goals={goals}
        includeCommunities={includeCommunities}
        interests={filterInterests}
        isVisible={isFiltersOpen}
        musicGenres={filterMusicGenres}
        maximumAge={maximumConnectAge}
        onApply={applyConnectFilters}
      />
      <ConnectProfileModal
        account={selectedConnectAccount}
        adjacentAccounts={adjacentConnectAccounts}
        isLiked={Boolean(selectedConnectAccount && likedConnectUsernames.has(selectedConnectAccount.username))}
        isLikeCommitted={Boolean(selectedConnectAccount && committedConnectUsernames.has(selectedConnectAccount.username))}
        isOwnProfile={selectedConnectAccount?.username === ownUsername}
        onClose={closeConnectProfile}
        onToggleLike={() => {
          if (!selectedConnectAccount || selectedConnectAccount.username === ownUsername) return;
          if (committedConnectUsernames.has(selectedConnectAccount.username) || committingConnectLikesRef.current.has(selectedConnectAccount.username)) return;
          setLikedConnectUsernames((current) => {
            const next = new Set(current);
            next.has(selectedConnectAccount.username)
              ? next.delete(selectedConnectAccount.username)
              : next.add(selectedConnectAccount.username);
            return next;
          });
        }}
        onNavigateAccount={(direction) => {
          if (!selectedConnectAccount || navigationAccounts.length < 2) return;
          void commitConnectLike(selectedConnectAccount.username);
          const currentIndex = navigationAccounts.findIndex((candidate) => candidate.id === selectedConnectAccount.id);
          if (currentIndex < 0) return;
          const nextIndex = (currentIndex + direction + navigationAccounts.length) % navigationAccounts.length;
          setSelectedConnectAccount(navigationAccounts[nextIndex]);
        }}
        onOpenProfile={onOpenProfile}
        onCloseReport={() => setReportingConnectAccount(null)}
        onNotify={onNotify}
        onReport={() => {
          if (!selectedConnectAccount || selectedConnectAccount.username === ownUsername) return;
          const target = selectedConnectAccount;
          setReportingConnectAccount(target);
          if (reportedConnectUsernames.has(target.username)) return;
          setCheckingReportUsername(target.username);
          void onCheckProfileReport(target.username)
            .then((alreadyReported) => {
              if (!alreadyReported) return;
              setReportedConnectUsernames((current) => new Set(current).add(target.username));
            })
            .catch((error) => {
              onNotify(error instanceof Error ? error.message : 'Не удалось проверить жалобу', 'error');
            })
            .finally(() => {
              setCheckingReportUsername((current) => current === target.username ? null : current);
            });
        }}
        onSubmitReport={async (username, reason, details) => {
          await onReportProfile(username, reason, details);
          setReportedConnectUsernames((current) => new Set(current).add(username));
        }}
        isReportStatusLoading={Boolean(reportingConnectAccount && checkingReportUsername === reportingConnectAccount.username)}
        hasAlreadyReported={Boolean(reportingConnectAccount && reportedConnectUsernames.has(reportingConnectAccount.username))}
        reportAccount={reportingConnectAccount}
      />
    </>
  );
}

function ConnectProfileModal({ account, adjacentAccounts, hasAlreadyReported, isLiked, isLikeCommitted, isOwnProfile, isReportStatusLoading, onClose, onCloseReport, onNavigateAccount, onNotify, onOpenProfile, onReport, onSubmitReport, onToggleLike, reportAccount }: {
  account: PublicAccount | null;
  adjacentAccounts: PublicAccount[];
  hasAlreadyReported: boolean;
  isLiked: boolean;
  isLikeCommitted: boolean;
  isOwnProfile: boolean;
  isReportStatusLoading: boolean;
  onClose: () => void;
  onCloseReport: () => void;
  onNavigateAccount: (direction: -1 | 1) => void;
  onNotify: (message: string, type?: ToastMessage['type']) => void;
  onOpenProfile: (username: string) => Promise<void>;
  onReport: () => void;
  onSubmitReport: (username: string, reason: SafetyReportReason, details?: string) => Promise<void>;
  onToggleLike: () => void;
  reportAccount: PublicAccount | null;
}) {
  const safeAreaInsets = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();
  const [activeIndex, setActiveIndex] = useState(0);
  const [profileDetails, setProfileDetails] = useState<Profile | null>(null);
  const [areGenresExpanded, setAreGenresExpanded] = useState(false);
  const [photoAspectRatio, setPhotoAspectRatio] = useState(9 / 16);
  const [profileInfoHeight, setProfileInfoHeight] = useState(0);
  const photoChromeOpacity = useRef(new Animated.Value(1)).current;
  const photoScale = useRef(new Animated.Value(1)).current;
  const photoTranslateX = useRef(new Animated.Value(0)).current;
  const photoTranslateY = useRef(new Animated.Value(0)).current;
  const profileTranslateX = useRef(new Animated.Value(0)).current;
  const profileTranslateY = useRef(new Animated.Value(0)).current;
  const likeScale = useRef(new Animated.Value(1)).current;
  const profileCardRef = useRef<any>(null);
  const profileSlideRef = useRef<any>(null);
  const webMotionFrame = useRef<number | null>(null);
  const webMotionTimers = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const pendingWebProfileY = useRef(0);
  const committedPhotoScale = useRef(1);
  const livePhotoScale = useRef(1);
  const pinchStartDistance = useRef<number | null>(null);
  const pinchStartFocal = useRef<{ x: number; y: number } | null>(null);
  const isProfileTransitioning = useRef(false);
  const gestureStartedAt = useRef({ time: 0, x: 0, y: 0 });
  const isPhotoChromeHidden = useRef(false);
  const currentProfileDetails = account && profileDetails?.id === account.id ? profileDetails : null;
  const currentPrefetchPhotoUrls = connectProfilePhotoUrls(currentProfileDetails ?? account);
  const adjacentPrefetchPhotoGroups = adjacentAccounts.map(connectProfilePhotoUrls);
  const currentPrefetchSignature = currentPrefetchPhotoUrls.join('\n');
  const adjacentPrefetchSignature = adjacentPrefetchPhotoGroups.map((urls) => urls.join('\n')).join('\n---\n');

  useEffect(() => {
    setActiveIndex(0);
    setAreGenresExpanded(false);
    committedPhotoScale.current = 1;
    livePhotoScale.current = 1;
    photoScale.setValue(1);
    photoTranslateX.setValue(0);
    photoTranslateY.setValue(0);
    profileTranslateY.setValue(0);
    likeScale.setValue(1);
    photoChromeOpacity.setValue(1);
    isPhotoChromeHidden.current = false;
    setPhotoAspectRatio(9 / 16);
    setProfileInfoHeight(0);
  }, [account?.id, likeScale, photoChromeOpacity, photoScale, photoTranslateX, photoTranslateY, profileTranslateY]);
  useEffect(() => () => {
    if (webMotionFrame.current !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(webMotionFrame.current);
    }
    for (const timer of webMotionTimers.current) clearTimeout(timer);
    webMotionTimers.current = [];
  }, []);
  useEffect(() => {
    if (!account) {
      setProfileDetails(null);
      return;
    }

    let isCurrent = true;
    setProfileDetails(null);
    void fetch(`${apiUrl}/profiles/${encodeURIComponent(account.username)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(await readApiError(response, 'Не удалось загрузить профиль'));
        return response.json() as Promise<Profile>;
      })
      .then((profile) => {
        if (isCurrent) setProfileDetails(profile);
      })
      .catch(() => {
        // Basic Connect data remains visible if the detail request is temporarily unavailable.
      });

    return () => {
      isCurrent = false;
    };
  }, [account?.id, account?.username]);
  useEffect(() => {
    if (!account) return undefined;
    let isCancelled = false;

    // Adjacent cards enter from the side, so their first image has immediate priority.
    for (const photoGroup of adjacentPrefetchPhotoGroups) {
      if (photoGroup[0]) void prefetchConnectImage(photoGroup[0]);
    }

    void (async () => {
      // The active image is already requested by the visible Image component.
      for (const url of currentPrefetchPhotoUrls.slice(1)) {
        if (isCancelled) return;
        await prefetchConnectImage(url);
      }
      for (const photoGroup of adjacentPrefetchPhotoGroups) {
        for (const url of photoGroup.slice(1)) {
          if (isCancelled) return;
          await prefetchConnectImage(url);
        }
      }
    })();

    return () => {
      isCancelled = true;
    };
    // Stable URL signatures prevent profile-detail hydration from restarting identical work.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.id, adjacentPrefetchSignature, currentPrefetchSignature]);
  if (!account) return null;

  const displayedProfile = currentProfileDetails ?? account;
  const connectPhotos = Array.isArray(displayedProfile.connectPhotos)
    ? displayedProfile.connectPhotos.filter((photo) => Boolean(photo?.imageUrl))
    : [];
  const photos = connectPhotos.length
    ? connectPhotos.map((photo) => photo.imageUrl)
    : displayedProfile.avatarUrl ? [displayedProfile.avatarUrl] : [];
  const safeActiveIndex = photos.length ? activeIndex % photos.length : 0;
  const location = formatConnectLocationLabel(
    formatCityName(displayedProfile.countryName, displayedProfile.cityName),
    account.connectDistanceKm,
  );
  const goals = (displayedProfile.connectGoals ?? account.connectGoals ?? []).map((goal) => connectGoalLabels[goal]);
  const interests = (displayedProfile.connectInterests ?? account.connectInterests ?? [])
    .map((interest) => connectInterestLabels[interest] ?? interest)
    .slice(0, 5);
  const musicSubgenres = groupMusicGenreChips(displayedProfile.musicGenres ?? [])
    .flatMap((genre) => genre.subgenres.map((subgenre) => ({
      key: `${genre.key}:${subgenre}`,
      label: subgenre,
    })));
  const hasSocialLinks = Boolean(currentProfileDetails && (
    currentProfileDetails.bandcampUrl
    || currentProfileDetails.soundcloudUrl
    || currentProfileDetails.instagramUrl
    || currentProfileDetails.threadsUrl
    || currentProfileDetails.telegramUrl
    || currentProfileDetails.youtubeUrl
    || currentProfileDetails.letterboxdUrl
  ));
  const cardWidth = width;
  const cardHeight = height;
  const containedPhotoHeight = Math.min(cardHeight, cardWidth / Math.max(photoAspectRatio, 0.01));
  const photoTop = Math.max(0, cardHeight - containedPhotoHeight) * 0.4;
  const photoBottom = photoTop + containedPhotoHeight;
  const profileInfoTop = profileInfoHeight > 0 ? cardHeight - profileInfoHeight : photoBottom;
  const bottomGradientHeight = Math.min(180, Math.max(100, photoBottom - profileInfoTop + 24));
  const bottomGradientTop = Math.max(photoTop, photoBottom - bottomGradientHeight);
  const webMotionEasing = 'cubic-bezier(0.22, 1, 0.36, 1)';
  const setWebTransform = (target: { current: any }, transform: string, duration = 0) => {
    if (Platform.OS !== 'web') return false;
    const style = target.current?.style;
    if (!style) return false;
    style.transition = duration > 0 ? `transform ${duration}ms ${webMotionEasing}` : 'none';
    style.transform = transform;
    return true;
  };
  const scheduleWebTimer = (callback: () => void, duration: number) => {
    const timer = setTimeout(() => {
      webMotionTimers.current = webMotionTimers.current.filter((candidate) => candidate !== timer);
      callback();
    }, duration);
    webMotionTimers.current.push(timer);
  };
  const flushWebProfileY = () => {
    if (webMotionFrame.current !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(webMotionFrame.current);
      webMotionFrame.current = null;
    }
    setWebTransform(profileCardRef, `translate3d(0, ${pendingWebProfileY.current}px, 0)`);
  };
  const scheduleWebProfileY = (value: number) => {
    pendingWebProfileY.current = value;
    if (Platform.OS !== 'web' || typeof window === 'undefined' || webMotionFrame.current !== null) return;
    webMotionFrame.current = window.requestAnimationFrame(() => {
      webMotionFrame.current = null;
      setWebTransform(profileCardRef, `translate3d(0, ${pendingWebProfileY.current}px, 0)`);
    });
  };
  const openProfile = () => {
    const username = account.username;
    onClose();
    void onOpenProfile(username);
  };
  const toggleLikeWithPulse = () => {
    likeScale.stopAnimation();
    likeScale.setValue(1);
    Animated.sequence([
      Animated.timing(likeScale, {
        duration: 110,
        easing: Easing.out(Easing.cubic),
        toValue: 1.24,
        useNativeDriver: true,
      }),
      Animated.timing(likeScale, {
        duration: 90,
        easing: Easing.inOut(Easing.cubic),
        toValue: 0.96,
        useNativeDriver: true,
      }),
      Animated.timing(likeScale, {
        duration: 120,
        easing: Easing.out(Easing.cubic),
        toValue: 1,
        useNativeDriver: true,
      }),
    ]).start();
    onToggleLike();
  };
  const resetPhotoScale = (onComplete?: () => void) => {
    committedPhotoScale.current = 1;
    livePhotoScale.current = 1;
    photoScale.stopAnimation();
    photoTranslateX.stopAnimation();
    photoTranslateY.stopAnimation();
    Animated.parallel([
      Animated.timing(photoScale, { duration: 160, easing: Easing.out(Easing.cubic), toValue: 1, useNativeDriver: true }),
      Animated.timing(photoTranslateX, { duration: 160, easing: Easing.out(Easing.cubic), toValue: 0, useNativeDriver: true }),
      Animated.timing(photoTranslateY, { duration: 160, easing: Easing.out(Easing.cubic), toValue: 0, useNativeDriver: true }),
    ]).start(({ finished }) => {
      if (finished) onComplete?.();
    });
  };
  const profileInfoOpacity = photoScale.interpolate({
    inputRange: [1, 1.08],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });
  const combinedPhotoChromeOpacity = Animated.multiply(profileInfoOpacity, photoChromeOpacity);
  const setPhotoChromeVisible = (isVisible: boolean) => {
    const shouldHide = !isVisible;
    if (isPhotoChromeHidden.current === shouldHide) return;
    isPhotoChromeHidden.current = shouldHide;
    photoChromeOpacity.stopAnimation();
    Animated.timing(photoChromeOpacity, {
      duration: isVisible ? 140 : 80,
      easing: isVisible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      toValue: isVisible ? 1 : 0,
      useNativeDriver: true,
    }).start();
  };
  const changePhoto = (direction: -1 | 1) => {
    if (photos.length < 2) return;
    resetPhotoScale();
    setActiveIndex((current) => (current + direction + photos.length) % photos.length);
  };
  const changeProfile = (direction: -1 | 1) => {
    if (isProfileTransitioning.current) return;
    isProfileTransitioning.current = true;
    resetPhotoScale();
    if (setWebTransform(profileSlideRef, `translate3d(${-direction * cardWidth}px, 0, 0)`, 180)) {
      scheduleWebTimer(() => {
        onNavigateAccount(direction);
        if (typeof window === 'undefined') return;
        window.requestAnimationFrame(() => {
          setWebTransform(profileSlideRef, `translate3d(${direction * cardWidth}px, 0, 0)`);
          window.requestAnimationFrame(() => {
            setWebTransform(profileSlideRef, 'translate3d(0, 0, 0)', 180);
            scheduleWebTimer(() => {
              isProfileTransitioning.current = false;
            }, 180);
          });
        });
      }, 180);
      return;
    }
    Animated.timing(profileTranslateX, {
      duration: 160,
      easing: Easing.in(Easing.cubic),
      toValue: -direction * cardWidth,
      useNativeDriver: true,
    }).start(() => {
      onNavigateAccount(direction);
      profileTranslateX.setValue(direction * cardWidth);
      requestAnimationFrame(() => {
        Animated.timing(profileTranslateX, {
          duration: 180,
          easing: Easing.out(Easing.cubic),
          toValue: 0,
          useNativeDriver: true,
        }).start(() => {
          isProfileTransitioning.current = false;
        });
      });
    });
  };
  const touchDistance = (touches: ArrayLike<{ pageX: number; pageY: number }>) => {
    if (touches.length < 2) return 0;
    const dx = touches[0].pageX - touches[1].pageX;
    const dy = touches[0].pageY - touches[1].pageY;
    return Math.sqrt((dx * dx) + (dy * dy));
  };
  const resetProfileTranslateY = () => {
    flushWebProfileY();
    if (setWebTransform(profileCardRef, 'translate3d(0, 0, 0)', 160)) {
      pendingWebProfileY.current = 0;
      return;
    }
    pendingWebProfileY.current = 0;
    profileTranslateY.stopAnimation();
    Animated.timing(profileTranslateY, {
      duration: 160,
      easing: Easing.out(Easing.cubic),
      toValue: 0,
      useNativeDriver: true,
    }).start();
  };
  const closeWithSwipe = () => {
    flushWebProfileY();
    if (setWebTransform(profileCardRef, `translate3d(0, ${cardHeight}px, 0)`, 180)) {
      pendingWebProfileY.current = cardHeight;
      scheduleWebTimer(onClose, 180);
      return;
    }
    pendingWebProfileY.current = cardHeight;
    Animated.timing(profileTranslateY, {
      duration: 180,
      easing: Easing.in(Easing.cubic),
      toValue: cardHeight,
      useNativeDriver: true,
    }).start(onClose);
  };
  const touchFocal = (touches: ArrayLike<{ pageX: number; pageY: number }>) => ({
    x: (touches[0].pageX + touches[1].pageX) / 2,
    y: (touches[0].pageY + touches[1].pageY) / 2,
  });
  const photoGestureResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 4 || Math.abs(gesture.dy) > 4,
    onPanResponderGrant: (event) => {
      const touches = event.nativeEvent.touches;
      const firstTouch = touches[0];
      gestureStartedAt.current = { time: Date.now(), x: firstTouch?.pageX ?? 0, y: firstTouch?.pageY ?? 0 };
      pinchStartDistance.current = touches.length >= 2 ? touchDistance(touches) : null;
      pinchStartFocal.current = touches.length >= 2 ? touchFocal(touches) : null;
      if (touches.length >= 2) setPhotoChromeVisible(false);
    },
    onPanResponderMove: (event) => {
      const touches = event.nativeEvent.touches;
      if (touches.length < 2) {
        // Once a pinch has started, lifting one finger must not reinterpret the
        // remaining touch as a downward card-dismiss gesture for a frame.
        if (pinchStartDistance.current !== null) return;
        const firstTouch = touches[0];
        if (!firstTouch) return;
        const dx = firstTouch.pageX - gestureStartedAt.current.x;
        const dy = firstTouch.pageY - gestureStartedAt.current.y;
        if (dy > 0 && Math.abs(dy) > Math.abs(dx) * 1.1) {
          const nextProfileY = Math.min(cardHeight, dy);
          if (Platform.OS === 'web') scheduleWebProfileY(nextProfileY);
          else profileTranslateY.setValue(nextProfileY);
        }
        return;
      }
      setPhotoChromeVisible(false);
      const distance = touchDistance(touches);
      if (!pinchStartDistance.current) {
        pinchStartDistance.current = distance;
        pinchStartFocal.current = touchFocal(touches);
        return;
      }
      const nextScale = Math.max(1, Math.min(3, committedPhotoScale.current * (distance / pinchStartDistance.current)));
      const focal = touchFocal(touches);
      const startFocal = pinchStartFocal.current ?? focal;
      const cardCenterX = width / 2;
      const cardCenterY = cardHeight / 2;
      const maxTranslateX = cardWidth * (nextScale - 1) / 2;
      const maxTranslateY = cardHeight * (nextScale - 1) / 2;
      const nextTranslateX = focal.x - cardCenterX - ((startFocal.x - cardCenterX) * nextScale);
      const nextTranslateY = focal.y - cardCenterY - ((startFocal.y - cardCenterY) * nextScale);
      livePhotoScale.current = nextScale;
      photoScale.setValue(nextScale);
      photoTranslateX.setValue(Math.max(-maxTranslateX, Math.min(maxTranslateX, nextTranslateX)));
      photoTranslateY.setValue(Math.max(-maxTranslateY, Math.min(maxTranslateY, nextTranslateY)));
    },
    onPanResponderRelease: (event, gesture) => {
      const wasPinching = pinchStartDistance.current !== null;
      pinchStartDistance.current = null;
      pinchStartFocal.current = null;
      if (wasPinching) {
        resetProfileTranslateY();
        resetPhotoScale(() => setPhotoChromeVisible(true));
        return;
      }
      const isDownwardDismiss = gesture.dy > Math.abs(gesture.dx) * 1.1
        && (gesture.dy >= 80 || (gesture.dy >= 36 && gesture.vy >= 0.75));
      if (isDownwardDismiss) {
        closeWithSwipe();
        return;
      }
      resetProfileTranslateY();
      if (Math.abs(gesture.dx) >= 54 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.25) {
        changeProfile(gesture.dx < 0 ? 1 : -1);
        return;
      }
      const elapsed = Date.now() - gestureStartedAt.current.time;
      if (elapsed <= 350 && Math.abs(gesture.dx) < 12 && Math.abs(gesture.dy) < 12) {
        changePhoto(event.nativeEvent.locationX < cardWidth / 2 ? -1 : 1);
      }
    },
    onPanResponderTerminate: () => {
      pinchStartDistance.current = null;
      pinchStartFocal.current = null;
      resetProfileTranslateY();
      resetPhotoScale(() => setPhotoChromeVisible(true));
    },
  });

  return (
    <Modal animationType={Platform.OS === 'web' ? 'none' : 'fade'} onRequestClose={reportAccount ? onCloseReport : onClose} visible transparent>
      <View style={styles.connectProfileBackdrop}>
        <Animated.View
          ref={profileCardRef}
          renderToHardwareTextureAndroid
          shouldRasterizeIOS
          style={[
            styles.connectProfileCard,
            { height: cardHeight, width: cardWidth },
            Platform.OS === 'web'
              ? ({ backfaceVisibility: 'hidden', transform: [{ translateY: 0 }], willChange: 'transform' } as never)
              : { transform: [{ translateY: profileTranslateY }] },
          ]}
        >
          <Animated.View
            ref={profileSlideRef}
            {...photoGestureResponder.panHandlers}
            renderToHardwareTextureAndroid
            shouldRasterizeIOS
            style={[
              styles.connectProfileSlide,
              styles.connectProfileGestureSurface,
              { width: cardWidth },
              Platform.OS === 'web'
                ? ({ backfaceVisibility: 'hidden', transform: [{ translateX: 0 }], willChange: 'transform' } as never)
                : { transform: [{ translateX: profileTranslateX }] },
            ]}
          >
            {photos.length ? (
              <View style={[styles.connectProfileImageFrame, { height: containedPhotoHeight, top: photoTop }]}>
                <AppAnimatedImage
                  onLoad={(event) => {
                    rememberPrefetchedConnectImage(photos[safeActiveIndex]);
                    const source = event.source;
                    if (source?.width > 0 && source?.height > 0) {
                      setPhotoAspectRatio(source.width / source.height);
                    }
                  }}
                  source={{ uri: photos[safeActiveIndex] }}
                  resizeMode="contain"
                  style={[styles.connectProfileImage, { transform: [{ translateX: photoTranslateX }, { translateY: photoTranslateY }, { scale: photoScale }] }]}
                />
              </View>
            ) : (
              <Text style={styles.connectProfilePlaceholder}>{getAvatarInitial(account.name)}</Text>
            )}
          </Animated.View>
          <Animated.View pointerEvents="none" style={[styles.connectProfileTopGradient, { opacity: photoChromeOpacity, top: photoTop }]}>
            <Svg height="100%" width="100%">
              <Defs>
                <LinearGradient id="connect-profile-top-gradient" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor="#111" stopOpacity="1" />
                  <Stop offset="0.15" stopColor="#111" stopOpacity="0.94" />
                  <Stop offset="0.3" stopColor="#111" stopOpacity="0.78" />
                  <Stop offset="0.5" stopColor="#111" stopOpacity="0.5" />
                  <Stop offset="0.7" stopColor="#111" stopOpacity="0.22" />
                  <Stop offset="0.85" stopColor="#111" stopOpacity="0.06" />
                  <Stop offset="1" stopColor="#111" stopOpacity="0" />
                </LinearGradient>
              </Defs>
              <Rect width="100%" height="100%" fill="url(#connect-profile-top-gradient)" />
            </Svg>
          </Animated.View>
          <Animated.View
            pointerEvents="none"
            style={[
              styles.connectProfileBottomGradient,
              { height: bottomGradientHeight, opacity: photoChromeOpacity, top: bottomGradientTop },
            ]}
          >
            <Svg height="100%" width="100%">
              <Defs>
                <LinearGradient id="connect-profile-bottom-gradient" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor="#111" stopOpacity="0" />
                  <Stop offset="0.15" stopColor="#111" stopOpacity="0.06" />
                  <Stop offset="0.3" stopColor="#111" stopOpacity="0.22" />
                  <Stop offset="0.5" stopColor="#111" stopOpacity="0.5" />
                  <Stop offset="0.7" stopColor="#111" stopOpacity="0.78" />
                  <Stop offset="0.85" stopColor="#111" stopOpacity="0.94" />
                  <Stop offset="1" stopColor="#111" stopOpacity="1" />
                </LinearGradient>
              </Defs>
              <Rect width="100%" height="100%" fill="url(#connect-profile-bottom-gradient)" />
            </Svg>
          </Animated.View>
          <Animated.View
            pointerEvents="none"
            style={[styles.connectProfileBottomSeam, { opacity: photoChromeOpacity, top: photoBottom - 1 }]}
          />
          <Animated.View style={[styles.connectProfileTopMeta, { opacity: photoChromeOpacity, top: safeAreaInsets.top + 48 }]}>
            {location ? <Text numberOfLines={1} style={styles.connectProfileTopMetaText}>{location}</Text> : null}
            {goals.length ? (
              <View style={styles.connectProfileTopGoals}>
                {goals.map((goal) => (
                  <View key={goal} style={styles.connectProfileTopGoalChip}>
                    <Text numberOfLines={1} style={styles.connectProfileTopGoalText}>{goal}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </Animated.View>
          <Animated.View pointerEvents="box-none" style={[StyleSheet.absoluteFillObject, { opacity: photoChromeOpacity, zIndex: 4 }]}>
            <Pressable accessibilityLabel="Закрыть просмотр" onPress={onClose} style={[styles.connectProfileClose, { top: safeAreaInsets.top + 18 }]}>
              <X color="#aab4be" size={25} strokeWidth={2} />
            </Pressable>
            {!isOwnProfile ? (
              <Pressable accessibilityLabel="Пожаловаться на профиль" onPress={onReport} style={[styles.connectProfileReport, { top: safeAreaInsets.top + 70 }]}>
                <View style={styles.connectProfileReportIcon}>
                  <TriangleAlert color="#aab4be" size={23} strokeWidth={2} />
                </View>
              </Pressable>
            ) : null}
          </Animated.View>
          {photos.length > 1 ? (
            <Animated.View pointerEvents="none" style={[styles.connectProfilePagination, { opacity: photoChromeOpacity, top: safeAreaInsets.top + 20 }]}>
              {photos.map((_, index) => <View key={index} style={[styles.connectProfilePaginationDot, index === safeActiveIndex && styles.connectProfilePaginationDotActive]} />)}
            </Animated.View>
          ) : null}
          <Animated.View
            onLayout={(event) => {
              const nextHeight = Math.ceil(event.nativeEvent.layout.height);
              setProfileInfoHeight((currentHeight) => (
                Math.abs(currentHeight - nextHeight) < 1 ? currentHeight : nextHeight
              ));
            }}
            style={[styles.connectProfileInfo, { opacity: combinedPhotoChromeOpacity }]}
          >
            <View style={styles.connectProfileInfoLead}>
              <View style={styles.connectProfileIdentityRow}>
                <Pressable accessibilityLabel={`Открыть профиль ${account.name}`} accessibilityRole="link" onPress={openProfile} style={styles.connectProfileIdentityLink}>
                  <VerifiedName badgeInverted isVerified={displayedProfile.isVerified} name={`${displayedProfile.name}${account.age ? `, ${account.age}` : ''}`} style={styles.connectProfileName} badgeSize={18} />
                  <Text style={styles.connectProfileUsername}>@{account.username}</Text>
                </Pressable>
                {!isOwnProfile ? (
                  <Pressable accessibilityLabel={isLikeCommitted ? 'Лайк отправлен' : isLiked ? 'Убрать лайк' : 'Поставить лайк'} accessibilityRole="button" accessibilityState={{ disabled: isLikeCommitted, selected: isLiked }} disabled={isLikeCommitted} onPress={toggleLikeWithPulse} style={[styles.connectProfileLikeButton, isLiked && styles.connectProfileLikeButtonActive]}>
                    <Animated.View style={{ transform: [{ scale: likeScale }] }}>
                      <Heart color={isLiked ? '#ff3b5c' : '#fff'} fill={isLiked ? '#ff3b5c' : 'transparent'} size={34} strokeWidth={2} />
                    </Animated.View>
                  </Pressable>
                ) : null}
              </View>
              {hasSocialLinks && currentProfileDetails ? (
                <View style={styles.connectProfileSocialIcons}>
                  <SocialIcon compact icon="bandcamp" inverted url={currentProfileDetails.bandcampUrl} />
                  <SocialIcon compact icon="soundcloud" inverted url={currentProfileDetails.soundcloudUrl} />
                  <SocialIcon compact icon="instagram" inverted url={currentProfileDetails.instagramUrl} />
                  <SocialIcon compact icon="threads" inverted url={currentProfileDetails.threadsUrl} />
                  <SocialIcon compact icon="telegram" inverted url={currentProfileDetails.telegramUrl} />
                  <SocialIcon compact icon="youtube" inverted url={currentProfileDetails.youtubeUrl} />
                  <SocialIcon compact icon="letterboxd" inverted url={currentProfileDetails.letterboxdUrl} />
                </View>
              ) : null}
              {displayedProfile.connectAbout ? <Text numberOfLines={3} style={styles.connectProfileAbout}>{displayedProfile.connectAbout}</Text> : null}
            </View>
            <View style={[styles.connectProfileInfoSolid, { paddingBottom: 16 + safeAreaInsets.bottom }]}>
            {interests.length ? (
              <View style={styles.connectProfileInterests}>
                {interests.map((interest) => (
                  <View key={interest} style={styles.connectProfileInterestChip}>
                    <Text numberOfLines={1} style={styles.connectProfileInterestText}>{interest}</Text>
                  </View>
                ))}
              </View>
            ) : null}
            {musicSubgenres.length ? (
              <>
                <Pressable accessibilityRole="button" onPress={() => setAreGenresExpanded((value) => !value)} style={styles.connectProfileGenresToggle}>
                  <Text style={styles.connectProfileGenresToggleText}>Любимая музыка · {musicSubgenres.length}</Text>
                  <ChevronDown color="#fff" size={17} style={areGenresExpanded ? styles.connectProfileGenresChevronExpanded : undefined} />
                </Pressable>
                {areGenresExpanded ? <View style={styles.connectProfileGenres}>
                  {musicSubgenres.map((genre) => (
                    <View key={genre.key} style={styles.connectProfileGenreChip}>
                      <Text numberOfLines={1} style={styles.connectProfileGenreText}>{genre.label}</Text>
                    </View>
                  ))}
                </View> : null}
              </>
            ) : null}
            {displayedProfile.trackTitle && displayedProfile.trackPreviewUrl ? (
              <View style={styles.connectProfileTrack}>
                <PrimaryTrackInlinePreview
                  artist={displayedProfile.trackArtist}
                  artworkUrl={displayedProfile.trackArtworkUrl}
                  autoPlay
                  clipDurationSeconds={displayedProfile.trackClipDurationSeconds}
                  previewUrl={displayedProfile.trackPreviewUrl!}
                  provider={displayedProfile.trackProvider}
                  startSeconds={displayedProfile.trackStartSeconds}
                  title={displayedProfile.trackTitle!}
                  variant="connect"
                />
              </View>
            ) : null}
            </View>
          </Animated.View>
        </Animated.View>
        <ConnectReportModal
          account={reportAccount}
          embedded
          hasAlreadyReported={hasAlreadyReported}
          isStatusLoading={isReportStatusLoading}
          onClose={onCloseReport}
          onNotify={onNotify}
          onSubmit={onSubmitReport}
        />
      </View>
    </Modal>
  );
}

function ConnectReportModal({
  account,
  embedded = false,
  hasAlreadyReported,
  isStatusLoading,
  onClose,
  onNotify,
  onSubmit,
}: {
  account: PublicAccount | null;
  embedded?: boolean;
  hasAlreadyReported: boolean;
  isStatusLoading: boolean;
  onClose: () => void;
  onNotify: (message: string, type?: ToastMessage['type']) => void;
  onSubmit: (username: string, reason: SafetyReportReason, details?: string) => Promise<void>;
}) {
  const [selectedCategory, setSelectedCategory] = useState<(typeof connectReportCategories)[number] | null>(null);
  const [details, setDetails] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const trimmedDetails = details.trim();
  const canSubmit = Boolean(account && selectedCategory && trimmedDetails.length >= 3 && !isSubmitting);

  useEffect(() => {
    setSelectedCategory(null);
    setDetails('');
    setIsSubmitting(false);
  }, [account?.id]);

  const close = () => {
    if (!isSubmitting) onClose();
  };

  const submit = async () => {
    if (!account || !selectedCategory || trimmedDetails.length < 3 || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await onSubmit(
        account.username,
        selectedCategory.reason,
        `Категория: ${selectedCategory.label}\n${trimmedDetails}`,
      );
      onClose();
    } catch (error) {
      onNotify(error instanceof Error ? error.message : 'Не удалось отправить жалобу', 'error');
      setIsSubmitting(false);
    }
  };

  return (
    <AppSheetModal
      contentContainerStyle={styles.connectReportContent}
      embedded={embedded}
      footer={hasAlreadyReported || isStatusLoading ? undefined : (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSubmit }}
          disabled={!canSubmit}
          onPress={() => void submit()}
          style={[styles.connectReportSubmit, !canSubmit && styles.connectReportSubmitDisabled]}
        >
          {isSubmitting
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.connectReportSubmitText}>Отправить жалобу</Text>}
        </Pressable>
      )}
      footerContainerStyle={styles.connectReportFooter}
      isVisible={Boolean(account)}
      onClose={close}
      scroll
      subtitle="Это останется между нами"
      title="Пожаловаться"
    >
      {isStatusLoading ? (
        <View style={styles.connectReportStatus}>
          <ActivityIndicator color="#111" />
        </View>
      ) : hasAlreadyReported ? (
        <View style={styles.connectReportStatus}>
          <Text style={styles.connectReportStatusText}>Вы уже отправили жалобу</Text>
        </View>
      ) : (
      <>
      <View style={styles.connectReportReasonList}>
        {connectReportCategories.map((category) => {
          const isSelected = selectedCategory?.label === category.label;
          return (
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ checked: isSelected }}
              key={category.label}
              onPress={() => setSelectedCategory(category)}
              style={[styles.connectReportReason, isSelected && styles.connectReportReasonActive]}
            >
              <Text style={[styles.connectReportReasonText, isSelected && styles.connectReportReasonTextActive]}>{category.label}</Text>
              {isSelected ? <Check color="#fff" size={20} strokeWidth={2.2} /> : <ChevronRight color="#8e99a4" size={20} strokeWidth={2} />}
            </Pressable>
          );
        })}
      </View>
      <View style={styles.connectReportDetails}>
        <Text style={styles.connectReportDetailsLabel}>Что произошло?</Text>
        <TextInput
          accessibilityLabel="Описание жалобы"
          maxLength={900}
          multiline
          onChangeText={setDetails}
          placeholder="Опишите, на что именно вы жалуетесь"
          placeholderTextColor="#8e99a4"
          style={styles.connectReportDetailsInput}
          value={details}
        />
        <Text style={styles.connectReportCounter}>{details.length}/900</Text>
      </View>
      </>
      )}
    </AppSheetModal>
  );
}

function ConnectAgeRangeSlider({ maximumAge, onChange, value }: {
  maximumAge: number;
  onChange: (value: [number, number]) => void;
  value: [number, number];
}) {
  const [trackWidth, setTrackWidth] = useState(0);
  const [draftValue, setDraftValue] = useState<[number, number]>(value);
  const valueRef = useRef(draftValue);
  const dragStartRef = useRef(value);
  const webPointerIdRef = useRef<number | null>(null);
  valueRef.current = draftValue;
  useEffect(() => {
    valueRef.current = value;
    setDraftValue(value);
  }, [value]);
  const ageSpan = maximumAge - connectMinimumAge;
  const thumbSize = 28;
  const usableWidth = Math.max(1, trackWidth - thumbSize);
  const ageToPosition = (age: number) => thumbSize / 2 + ((age - connectMinimumAge) / ageSpan) * usableWidth;
  const ageDeltaFromGesture = (dx: number) => Math.round((dx / usableWidth) * ageSpan);
  const setRange = useCallback((next: [number, number]) => {
    valueRef.current = next;
    setDraftValue(next);
  }, []);
  const updateMinimum = (dx: number) => {
    const nextMinimum = Math.max(connectMinimumAge, Math.min(dragStartRef.current[0] + ageDeltaFromGesture(dx), valueRef.current[1] - 1));
    setRange([nextMinimum, valueRef.current[1]]);
  };
  const updateMaximum = (dx: number) => {
    const nextMaximum = Math.min(maximumAge, Math.max(dragStartRef.current[1] + ageDeltaFromGesture(dx), valueRef.current[0] + 1));
    setRange([valueRef.current[0], nextMaximum]);
  };
  const updateNearestThumb = useCallback((locationX: number) => {
    const relativeX = Math.max(thumbSize / 2, Math.min(trackWidth - thumbSize / 2, locationX));
    const age = connectMinimumAge + Math.round(((relativeX - thumbSize / 2) / usableWidth) * ageSpan);
    const current = valueRef.current;
    const next: [number, number] = Math.abs(age - current[0]) <= Math.abs(age - current[1])
      ? [Math.max(connectMinimumAge, Math.min(age, current[1] - 1)), current[1]]
      : [current[0], Math.min(maximumAge, Math.max(age, current[0] + 1))];
    setRange(next);
    onChange(next);
  }, [ageSpan, maximumAge, onChange, setRange, trackWidth, usableWidth]);
  const updateWebThumb = useCallback((thumb: 'minimum' | 'maximum', element: HTMLElement, clientX: number) => {
    const track = element.parentElement?.getBoundingClientRect();
    if (!track) return;
    const measuredUsableWidth = Math.max(1, track.width - thumbSize);
    const relativeX = Math.max(thumbSize / 2, Math.min(track.width - thumbSize / 2, clientX - track.left));
    const age = connectMinimumAge + Math.round(((relativeX - thumbSize / 2) / measuredUsableWidth) * ageSpan);
    const current = valueRef.current;
    setRange(thumb === 'minimum'
      ? [Math.max(connectMinimumAge, Math.min(age, current[1] - 1)), current[1]]
      : [current[0], Math.min(maximumAge, Math.max(age, current[0] + 1))]);
  }, [ageSpan, maximumAge, setRange]);
  const adjustThumbFromKeyboard = useCallback((thumb: 'minimum' | 'maximum', delta: number) => {
    const current = valueRef.current;
    const next: [number, number] = thumb === 'minimum'
      ? [Math.max(connectMinimumAge, Math.min(current[0] + delta, current[1] - 1)), current[1]]
      : [current[0], Math.min(maximumAge, Math.max(current[1] + delta, current[0] + 1))];
    setRange(next);
    onChange(next);
  }, [onChange, setRange]);
  const webThumb = (thumb: 'minimum' | 'maximum', position: number) => createElement('div', {
    'aria-label': thumb === 'minimum' ? 'Минимальный возраст' : 'Максимальный возраст',
    'aria-valuemax': thumb === 'minimum' ? valueRef.current[1] - 1 : maximumAge,
    'aria-valuemin': thumb === 'minimum' ? connectMinimumAge : valueRef.current[0] + 1,
    'aria-valuenow': thumb === 'minimum' ? draftValue[0] : draftValue[1],
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      adjustThumbFromKeyboard(thumb, event.key === 'ArrowRight' ? 1 : -1);
    },
    onPointerCancel: (event: PointerEvent) => {
      if (webPointerIdRef.current !== event.pointerId) return;
      webPointerIdRef.current = null;
      onChange(valueRef.current);
    },
    onPointerDown: (event: PointerEvent & { currentTarget: HTMLElement }) => {
      if (webPointerIdRef.current !== null) return;
      event.preventDefault();
      event.stopPropagation();
      webPointerIdRef.current = event.pointerId;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      updateWebThumb(thumb, event.currentTarget, event.clientX);
    },
    onPointerMove: (event: PointerEvent & { currentTarget: HTMLElement }) => {
      if (webPointerIdRef.current !== event.pointerId) return;
      event.preventDefault();
      updateWebThumb(thumb, event.currentTarget, event.clientX);
    },
    onPointerUp: (event: PointerEvent & { currentTarget: HTMLElement }) => {
      if (webPointerIdRef.current !== event.pointerId) return;
      event.preventDefault();
      updateWebThumb(thumb, event.currentTarget, event.clientX);
      webPointerIdRef.current = null;
      onChange(valueRef.current);
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture?.(event.pointerId);
    },
    role: 'slider',
    style: {
      cursor: 'ew-resize',
      height: 44,
      left: position - 22,
      position: 'absolute',
      top: 0,
      touchAction: 'none',
      userSelect: 'none',
      width: 44,
      zIndex: 3,
    },
    tabIndex: 0,
  });
  const minimumResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => { dragStartRef.current = valueRef.current; },
    onPanResponderMove: (_event, gesture) => updateMinimum(gesture.dx),
    onPanResponderRelease: () => onChange(valueRef.current),
    onPanResponderTerminate: () => onChange(valueRef.current),
    onPanResponderTerminationRequest: () => false,
  // The responders read current values through refs so dragging never resets mid-gesture.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [maximumAge, usableWidth]);
  const maximumResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => { dragStartRef.current = valueRef.current; },
    onPanResponderMove: (_event, gesture) => updateMaximum(gesture.dx),
    onPanResponderRelease: () => onChange(valueRef.current),
    onPanResponderTerminate: () => onChange(valueRef.current),
    onPanResponderTerminationRequest: () => false,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [maximumAge, usableWidth]);
  const minimumPosition = ageToPosition(draftValue[0]);
  const maximumPosition = ageToPosition(draftValue[1]);
  const selectionOverflow = 9;
  const selectionLeft = Math.max(0, minimumPosition - selectionOverflow);
  const selectionRight = Math.min(trackWidth, maximumPosition + selectionOverflow);

  return (
    <View style={styles.connectAgeRange}>
      <View style={styles.connectAgeRangeHeader}>
        <Text style={styles.connectAgeRangeLabel}>Возраст:</Text>
        <Text style={styles.connectAgeRangeValue}>{draftValue[0]}–{draftValue[1]} лет</Text>
      </View>
      <Pressable
        accessibilityLabel={`Возраст от ${draftValue[0]} до ${draftValue[1]} лет`}
        onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
        onPress={(event) => updateNearestThumb(event.nativeEvent.locationX)}
        style={styles.connectAgeRangeTrackArea}
      >
        <View style={styles.connectAgeRangeTrack} />
        {trackWidth ? <View style={[styles.connectAgeRangeSelection, {
          left: selectionLeft,
          width: Math.max(0, selectionRight - selectionLeft),
        }]} /> : null}
        {trackWidth ? <>
          <View
            accessibilityLabel={`Минимальный возраст ${draftValue[0]}`}
            accessibilityRole="adjustable"
            accessibilityValue={{ min: connectMinimumAge, max: draftValue[1] - 1, now: draftValue[0] }}
             {...(Platform.OS === 'web' ? {} : minimumResponder.panHandlers)}
             pointerEvents={Platform.OS === 'web' ? 'none' : 'auto'}
             style={[styles.connectAgeRangeThumb, { left: minimumPosition - thumbSize / 2 }]}
          >
            <View style={styles.connectAgeRangeThumbDot} />
          </View>
          <View
            accessibilityLabel={`Максимальный возраст ${draftValue[1]}`}
            accessibilityRole="adjustable"
            accessibilityValue={{ min: draftValue[0] + 1, max: maximumAge, now: draftValue[1] }}
             {...(Platform.OS === 'web' ? {} : maximumResponder.panHandlers)}
             pointerEvents={Platform.OS === 'web' ? 'none' : 'auto'}
             style={[styles.connectAgeRangeThumb, { left: maximumPosition - thumbSize / 2 }]}
          >
            <View style={styles.connectAgeRangeThumbDot} />
          </View>
          {Platform.OS === 'web' ? webThumb('minimum', minimumPosition) : null}
          {Platform.OS === 'web' ? webThumb('maximum', maximumPosition) : null}
        </> : null}
      </Pressable>
    </View>
  );
}

function ConnectFiltersModal({ ageRange, gender, goals, includeCommunities, interests, isVisible, maximumAge, musicGenres, onApply }: {
  ageRange: [number, number]; gender: 'ANY' | Gender; goals: ConnectGoal[]; includeCommunities: boolean; interests: string[]; isVisible: boolean; maximumAge: number; musicGenres: string[];
  onApply: (value: {
    ageRange: [number, number];
    gender: 'ANY' | Gender;
    goals: ConnectGoal[];
    includeCommunities: boolean;
    interests: string[];
    musicGenres: string[];
  }) => void;
}) {
  const [draft, setDraft] = useState({
    ageRange,
    gender,
    goals,
    includeCommunities,
    interests,
    musicGenres,
  });
  const hasAppliedRef = useRef(false);

  useEffect(() => {
    if (!isVisible) return;
    hasAppliedRef.current = false;
    setDraft({
      ageRange: normalizeConnectAgeRange(ageRange, maximumAge),
      gender,
      goals: [...goals],
      includeCommunities,
      interests: [...interests],
      musicGenres: [...musicGenres],
    });
  }, [ageRange, gender, goals, includeCommunities, interests, isVisible, maximumAge, musicGenres]);

  const closeAndApply = () => {
    if (hasAppliedRef.current) return;
    hasAppliedRef.current = true;
    onApply(draft);
  };
  const toggleGoal = (goal: ConnectGoal) => setDraft((current) => ({
    ...current,
    goals: current.goals.includes(goal)
      ? (current.goals.length > 1 ? current.goals.filter((value) => value !== goal) : current.goals)
      : [...current.goals, goal],
  }));
  return <AppSheetModal
    isVisible={isVisible}
    onClose={closeAndApply}
    scroll
    title="Фильтры Коннекта"
  >
    <View style={styles.connectFilterContent}>
      <View style={styles.connectFilterDemographics}>
        <View style={styles.connectFilterSection}>
          <Text style={[styles.connectFilterTitle, styles.connectFilterSectionTitle]}>Кого ищем</Text>
          <AnimatedSegmentedControl
            accessibilityLabel="Пол"
            containerStyle={[styles.privacySegment, styles.connectFilterSegment]}
            onChange={(value) => setDraft((current) => ({ ...current, gender: value }))}
            options={[{ value: 'MALE', label: 'Мужчины' }, { value: 'FEMALE', label: 'Женщины' }, { value: 'ANY', label: 'Неважно' }]}
            value={draft.gender}
          />
        </View>
        <ConnectAgeRangeSlider maximumAge={maximumAge} onChange={(value) => setDraft((current) => ({ ...current, ageRange: value }))} value={draft.ageRange} />
      </View>
      <View style={styles.connectFilterSection}>
        <Text style={[styles.connectFilterTitle, styles.connectFilterSectionTitle]}>Кого показывать</Text>
        <AnimatedSegmentedControl
          accessibilityLabel="Кого показывать"
          containerStyle={[styles.privacySegment, styles.connectFilterSegment]}
          onChange={(value) => setDraft((current) => ({ ...current, includeCommunities: value }))}
          options={[
            { value: true, label: 'Людей и сообщества' },
            { value: false, label: 'Только людей' },
          ]}
          value={draft.includeCommunities}
        />
      </View>
      <View style={styles.connectFilterSection}>
        <Text style={[styles.connectFilterTitle, styles.connectFilterSectionTitle]}>Цели</Text>
        <View style={styles.connectFilterOptions}>
          {([
            { value: 'ANY', label: 'Без конкретики' },
            { value: 'COLLABORATION', label: 'Коллаборации' },
            { value: 'FRIENDSHIP', label: 'Знакомства' },
            { value: 'DATING', label: 'Романтика' },
            { value: 'EMPLOYEES', label: 'Набор в команду' },
            { value: 'VOLUNTEERS', label: 'Волонтёрство' },
          ] as Array<{ value: ConnectGoal; label: string }>).map((option) => (
            <Pressable key={option.value} onPress={() => toggleGoal(option.value)} style={[styles.connectFilterChip, draft.goals.includes(option.value) && styles.connectFilterChipActive]}>
              <Text style={[styles.connectFilterChipText, draft.goals.includes(option.value) && styles.connectFilterChipTextActive]}>{option.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      <View style={styles.connectFilterTaxonomySections}>
        <View style={styles.connectFilterSection}>
          <MusicGenreSelector
            filterCard
            maxSelected={18}
            onChange={(value) => setDraft((current) => ({ ...current, musicGenres: value }))}
            selected={draft.musicGenres}
            subgenresOnly
            title="Музыкальные жанры"
          />
        </View>
        <View style={styles.connectFilterSection}>
          <ConnectInterestSelector filterCard onChange={(value) => setDraft((current) => ({ ...current, interests: value }))} selected={draft.interests} />
        </View>
      </View>
      <Pressable onPress={closeAndApply} style={styles.connectFilterApply}>
        <Text style={styles.connectFilterApplyText}>Показать</Text>
      </Pressable>
    </View>
  </AppSheetModal>;
}


function PublicPageTypePickerModal({
  isVisible,
  onClose,
  onSelect,
  options,
  selectedValue,
}: {
  isVisible: boolean;
  onClose: () => void;
  onSelect: (option: PublicPageTypeOption) => void;
  options: PublicPageTypeOption[];
  selectedValue: string;
}) {
  const [activeGroupTitle, setActiveGroupTitle] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const groupedOptions = publicPageTypeGroups
    .map((group) => ({
      ...group,
      options: group.values
        .map((value) => options.find((option) => option.value === value))
        .filter((option): option is PublicPageTypeOption => Boolean(option)),
    }))
    .filter((group) => group.options.length > 0);
  const groupedValues = new Set(publicPageTypeGroups.flatMap((group) => group.values));
  const otherOptions = options.filter((option) => !groupedValues.has(option.value));
  const groups = [...groupedOptions, ...(otherOptions.length ? [{ title: 'Другое', values: [], options: otherOptions }] : [])];
  const activeGroup = groups.find((group) => group.title === activeGroupTitle) ?? null;
  const normalizedSearch = search.trim().toLocaleLowerCase('ru-RU');

  useEffect(() => {
    if (!isVisible) return;
    setActiveGroupTitle(null);
    setSearch('');
  }, [isVisible]);

  const pickerOptions: SelectionPickerOption[] = normalizedSearch
    ? groups.flatMap((group) => group.options
        .filter((option) => `${option.label} ${group.title}`.toLocaleLowerCase('ru-RU').includes(normalizedSearch))
        .map((option) => ({
          key: option.value,
          title: option.label,
          meta: group.title,
          selected: option.value === selectedValue,
          onPress: () => onSelect(option),
        })))
    : activeGroup
      ? activeGroup.options.map((option) => ({
          key: option.value,
          title: option.label,
          selected: option.value === selectedValue,
          onPress: () => onSelect(option),
        }))
      : groups.map((group) => ({
          key: group.title,
          title: group.title,
          meta: `${group.options.length} вариантов`,
          navigates: true,
          onPress: () => {
            setActiveGroupTitle(group.title);
            setSearch('');
          },
        }));

  return (
    <SelectionPickerModal
      backLabel={!normalizedSearch && activeGroup ? 'Все категории' : undefined}
      emptyText="Ничего не найдено"
      isVisible={isVisible}
      onBack={!normalizedSearch && activeGroup ? () => {
        setActiveGroupTitle(null);
        setSearch('');
      } : undefined}
      onChangeSearch={setSearch}
      onClose={onClose}
      options={pickerOptions}
      search={search}
      searchPlaceholder="Найти тип сообщества"
      title="Тип сообщества"
    />
  );
}


