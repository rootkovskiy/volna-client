import { Bell, Check, ChevronLeft, ChevronRight, Copy, Eye, KeyRound, Search, ShieldCheck, Star, Trash2, UserMinus, UserPlus, X } from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { apiFetch as fetch, apiUrl, readApiError, remoteSearchDebounceMs, reportApiError } from '../api/client';
import { styles } from '../styles';
import type { CursorPage, MessagePrivacy, PublicAccount, PublicPage, PublicPageTypeOption, ToastMessage } from '../types';
import { getPasswordStrength, normalizeAsciiPassword, uploadCategoryCoverAsset } from '../domain';
import { PasswordStrengthIndicator } from '../components/PasswordStrengthIndicator';
import { VolnaSwitch } from '../components/VolnaSwitch';
import { LocationPickerModal, type LocationSelection } from '../components/LocationPickerModal';
import { AppRefreshControl } from '../components/AppRefreshControl';
import { AppSheetModal } from '../components/AppSheetModal';
import { PostFeed } from '../components/PostFeed';
import { AnimatedSegmentedControl } from '../components/AnimatedSegmentedControl';
import { currentWebPushPermission, removeWebPushSubscription, requestWebPushPermission } from '../pushNotifications';
import type { AvatarCropAsset } from '../types';
import { AvatarCropModal } from './ProfileScreens';
import { CatalogCategoryTile, type CategoryCover, type CategoryCoverSurface, eventCategoryOptions, locationCategoryOptions } from '../components/CatalogCategoryTile';

type NotificationEventType = 'NEW_FOLLOWER' | 'DIRECT_MESSAGE' | 'POST_LIKE' | 'POST_REPOST' | 'CONNECT_LIKE' | 'POST_REPLY' | 'POST_MENTION' | 'FOLLOW_REQUEST' | 'COMMUNITY_EVENT' | 'COMMUNITY_RELEASE' | 'EVENT_REMINDER' | 'MODERATION' | 'SYSTEM';
type NotificationDeliveryMode = 'OFF' | 'IN_APP' | 'IN_APP_AND_PUSH';
type NotificationPreferenceItem = { eventType: NotificationEventType; label: string; hint: string; requiredInApp?: boolean };
type EventReminderOffsetMinutes = 180 | 1440 | 4320 | 10080;

const eventReminderOptions: ReadonlyArray<{ value: EventReminderOffsetMinutes; label: string }> = [
  { value: 180, label: 'В день события' },
  { value: 1440, label: 'За сутки' },
  { value: 4320, label: 'За 3 дня' },
  { value: 10080, label: 'За неделю' },
];

const personalNotificationEvents: NotificationPreferenceItem[] = [
  { eventType: 'NEW_FOLLOWER', label: 'Новый подписчик', hint: 'Кто-то подписался на вас' },
  { eventType: 'FOLLOW_REQUEST', label: 'Запрос на подписку', hint: 'Новый запрос для закрытого профиля', requiredInApp: true },
  { eventType: 'DIRECT_MESSAGE', label: 'Сообщения', hint: 'Вам написали новое сообщение' },
  { eventType: 'POST_LIKE', label: 'Лайки публикаций', hint: 'Кому-то понравилась ваша публикация' },
  { eventType: 'POST_REPOST', label: 'Репосты публикаций', hint: 'Кто-то репостнул вашу публикацию' },
  { eventType: 'POST_REPLY', label: 'Ответы и комментарии', hint: 'Ответ в обсуждении вашей публикации' },
  { eventType: 'POST_MENTION', label: 'Упоминания', hint: 'Вас упомянули в публикации или ответе' },
  { eventType: 'CONNECT_LIKE', label: 'Лайки в Коннекте', hint: 'Ваш профиль понравился в Коннекте', requiredInApp: true },
  { eventType: 'EVENT_REMINDER', label: 'Напоминания о событиях', hint: 'Скоро начнётся выбранное вами событие', requiredInApp: true },
  { eventType: 'MODERATION', label: 'Модерация', hint: 'Результаты проверки и важные действия', requiredInApp: true },
  { eventType: 'SYSTEM', label: 'Системные', hint: 'Безопасность, коды и важные новости VOLNA', requiredInApp: true },
];

const communityNotificationEvents: NotificationPreferenceItem[] = [
  { eventType: 'COMMUNITY_EVENT', label: 'События сообществ', hint: 'Новое событие сообщества, которое вы отслеживаете' },
  { eventType: 'COMMUNITY_RELEASE', label: 'Музыкальные релизы', hint: 'Новый релиз сообщества, которое вы отслеживаете' },
];

const notificationEvents = [...personalNotificationEvents, ...communityNotificationEvents];

const requiredInAppNotificationTypes = new Set<NotificationEventType>(
  notificationEvents.filter((item) => item.requiredInApp).map((item) => item.eventType),
);

export function SubscriptionScreen({
  expiresAt,
  isActive,
  onBack,
}: {
  expiresAt: string | null;
  isActive: boolean;
  onBack: () => void;
}) {
  const formattedExpiry = expiresAt
    ? new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(expiresAt))
    : 'Без даты окончания';

  return (
    <View style={styles.subscriptionScreen}>
      <View style={styles.topBar}>
        <View style={styles.topBarLeft}>
          <Pressable accessibilityLabel="Назад" onPress={onBack} style={styles.topBarIconButton}>
            <ChevronLeft color="#090909" size={29} />
          </Pressable>
          <Text style={styles.topBarTitle}>Подписка</Text>
        </View>
      </View>
      <View style={styles.subscriptionScreenContent}>
        <View style={styles.subscriptionStatusCard}>
          <View style={styles.subscriptionStatusIcon}>
            <Star color="#111" fill="#111" size={24} strokeWidth={1.8} />
          </View>
          <View style={styles.subscriptionStatusCopy}>
            <Text style={styles.subscriptionStatusTitle}>{isActive ? 'Подписка активна' : 'Подписки нет'}</Text>
            <Text style={styles.subscriptionStatusText}>{isActive ? (expiresAt ? `Действует до ${formattedExpiry}` : formattedExpiry) : 'Сейчас подписка не подключена'}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const normalizeNotificationMode = (eventType: NotificationEventType, mode: NotificationDeliveryMode) => (
  eventType === 'DIRECT_MESSAGE' && mode === 'IN_APP'
    ? 'OFF'
    : mode === 'OFF' && requiredInAppNotificationTypes.has(eventType) ? 'IN_APP' : mode
);

type ModerationReport = {
  id: string;
  targetType: string;
  targetId: string;
  reason: string;
  details: string | null;
  status: 'OPEN' | 'REVIEWING' | 'RESOLVED' | 'REJECTED';
  createdAt: string;
  reporter: { username: string; name: string };
  subjectAccount: { username: string; name: string; suspendedUntil: string | null } | null;
  moderationStats: { acceptedDistinctTargets30d: number; threshold: number; suspendedUntil: string | null };
};

type AdminStats = { totalUsers: number; period: 'day' | 'month'; points: Array<{ period: string; count: number }> };
type PendingCommunity = PublicPage & { createdAt: string; owner: { username: string; name: string } | null };
type PendingProfileVerificationRequest = {
  id: string;
  createdAt: string;
  account: {
    id: string;
    username: string;
    name: string;
    avatarUrl: string | null;
    cityName: string;
    about: string;
  } | null;
  publicPage: {
    id: string;
    username: string;
    name: string;
    avatarUrl: string | null;
    cityName: string;
    about: string;
    ownerId: string;
  } | null;
};
type AdminInviteCode = { id: string; code: string; label: string | null; createdAt: string; redeemedAt: string | null; creator: { username: string; name: string }; redeemedBy: { username: string; name: string } | null };
type AdminInformationArtist = Pick<PublicAccount, 'id' | 'username' | 'name' | 'countryName' | 'cityName' | 'cityId' | 'about' | 'avatarUrl' | 'isInformational'> & { temporaryAccessIssuedAt: string | null };
type InformationPageMessage = { id: string; type: 'CLAIM_COMMUNITY' | 'REPORT_BUG' | 'SUGGEST_IMPROVEMENT'; message: string; readAt: string | null; createdAt: string; page: { username: string; name: string }; sender: { username: string; name: string; email: string | null } };
type ReservedUsername = { username: string; createdAt: string; createdBy: { username: string; name: string } | null; occupiedBy: 'ACCOUNT' | 'PUBLIC_PAGE' | null };

function CommunityRejectionModal({ page, onClose, onReject }: { page: PendingCommunity | null; onClose: () => void; onReject: (reason?: string) => Promise<void> }) {
  const [reason, setReason] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  useEffect(() => { if (page) setReason(''); }, [page]);
  const submit = async () => {
    setIsSaving(true);
    try { await onReject(reason.trim() || undefined); onClose(); }
    finally { setIsSaving(false); }
  };
  return <AppSheetModal isVisible={Boolean(page)} onClose={onClose} subtitle="Необязательно. Если указать причину, владелец увидит её в уведомлении." title="Причина отклонения"><TextInput maxLength={500} multiline onChangeText={setReason} placeholder="Напишите причину" placeholderTextColor="#98a3ae" style={styles.moderationRejectInput} textAlignVertical="top" value={reason} /><Text style={styles.moderationRejectCounter}>{reason.length}/500</Text><View style={styles.moderationActions}><Pressable disabled={isSaving} onPress={() => void submit()} style={[styles.moderationActionButton, isSaving && styles.disabledButton]}><Text style={styles.moderationActionText}>{isSaving ? 'Отклоняем…' : 'Отклонить'}</Text></Pressable><Pressable disabled={isSaving} onPress={onClose} style={styles.moderationSecondaryButton}><Text style={styles.moderationSecondaryText}>Отмена</Text></Pressable></View></AppSheetModal>;
}

export function AdminScreen({ authToken, embedded = false, onBack, onNotify }: { authToken: string; embedded?: boolean; onBack: () => void; onNotify: (message: string, type?: ToastMessage['type']) => void }) {
  const [section, setSection] = useState<'dashboard' | 'covers' | 'pages' | 'messages' | 'invites' | 'usernames'>('dashboard');
  const [period, setPeriod] = useState<'day' | 'month'>('day');
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [pages, setPages] = useState<PublicPage[]>([]);
  const [pageSearchQuery, setPageSearchQuery] = useState('');
  const [artists, setArtists] = useState<AdminInformationArtist[]>([]);
  const [pendingPages, setPendingPages] = useState<PendingCommunity[]>([]);
  const [inviteCodes, setInviteCodes] = useState<AdminInviteCode[]>([]);
  const [informationMessages, setInformationMessages] = useState<InformationPageMessage[]>([]);
  const [reservedUsernames, setReservedUsernames] = useState<ReservedUsername[]>([]);
  const [reservedUsernameInput, setReservedUsernameInput] = useState('');
  const [isReservedUsernameSaving, setIsReservedUsernameSaving] = useState(false);
  const [inviteLabel, setInviteLabel] = useState('');
  const [inviteCount, setInviteCount] = useState('2');
  const [types, setTypes] = useState<PublicPageTypeOption[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [assigningPageId, setAssigningPageId] = useState<string | null>(null);
  const [ownerQuery, setOwnerQuery] = useState('');
  const [ownerSuggestions, setOwnerSuggestions] = useState<PublicAccount[]>([]);
  const [selectedOwner, setSelectedOwner] = useState<PublicAccount | null>(null);
  const [rejectingPage, setRejectingPage] = useState<PendingCommunity | null>(null);
  const [form, setForm] = useState<{ username: string; name: string; type: string; countryCode?: string; countryName: string; cityName: string; cityId?: string; about: string }>({ username: '', name: '', type: '', countryCode: '', countryName: '', cityName: '', cityId: '', about: '' });
  const [pageUsernameState, setPageUsernameState] = useState<'idle' | 'checking' | 'available' | 'taken' | 'invalid'>('idle');
  const [artistEditingId, setArtistEditingId] = useState<string | null>(null);
  const [issuedArtistAccess, setIssuedArtistAccess] = useState<{ username: string; password: string } | null>(null);
  const [artistForm, setArtistForm] = useState<{ username: string; name: string; countryCode?: string; countryName: string; cityName: string; cityId?: string; about: string }>({ username: '', name: '', countryCode: '', countryName: '', cityName: '', cityId: '', about: '' });
  const [locationTarget, setLocationTarget] = useState<'page' | 'artist' | null>(null);
  const [isTypePickerOpen, setIsTypePickerOpen] = useState(false);
  const [categoryCovers, setCategoryCovers] = useState<CategoryCover[]>([]);
  const [categoryCoverCrop, setCategoryCoverCrop] = useState<{ asset: AvatarCropAsset; surface: CategoryCoverSurface; category: string } | null>(null);
  const [isCategoryCoverSaving, setIsCategoryCoverSaving] = useState(false);
  const headers = { Authorization: `Bearer ${authToken}` };

  const loadStats = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`${apiUrl}/admin/stats?period=${period}`, { headers });
      if (!response.ok) throw new Error(await readApiError(response, 'Не удалось загрузить статистику'));
      setStats(await response.json() as AdminStats);
    } catch (error) { onNotify(error instanceof Error ? error.message : 'Ошибка статистики', 'error'); }
    finally { setIsLoading(false); }
  }, [authToken, period, onNotify]);

  const loadPages = useCallback(async () => {
    setIsLoading(true);
    try {
      const [pagesResponse, artistsResponse, typesResponse] = await Promise.all([
        fetch(`${apiUrl}/admin/information-pages`, { headers }),
        fetch(`${apiUrl}/admin/information-artists`, { headers }),
        fetch(`${apiUrl}/public-pages/types`),
      ]);
      if (!pagesResponse.ok) throw new Error(await readApiError(pagesResponse, 'Не удалось загрузить сообщества'));
      if (!artistsResponse.ok) throw new Error(await readApiError(artistsResponse, 'Не удалось загрузить артистов'));
      setPages(await pagesResponse.json() as PublicPage[]);
      setArtists(await artistsResponse.json() as AdminInformationArtist[]);
      if (typesResponse.ok) setTypes(await typesResponse.json() as PublicPageTypeOption[]);
      const pendingResponse = await fetch(`${apiUrl}/moderation/public-pages`, { headers });
      if (pendingResponse.ok) setPendingPages(await pendingResponse.json() as PendingCommunity[]);
    } catch (error) { onNotify(error instanceof Error ? error.message : 'Ошибка загрузки', 'error'); }
    finally { setIsLoading(false); }
  }, [authToken, onNotify]);

  const loadInvites = useCallback(async () => {
    setIsLoading(true);
    try { const response = await fetch(`${apiUrl}/admin/invite-codes`, { headers }); if (!response.ok) throw new Error(await readApiError(response, 'Не удалось загрузить коды')); setInviteCodes(await response.json() as AdminInviteCode[]); }
    catch (error) { onNotify(error instanceof Error ? error.message : 'Ошибка загрузки кодов', 'error'); }
    finally { setIsLoading(false); }
  }, [authToken, onNotify]);

  const loadInformationMessages = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`${apiUrl}/admin/information-messages`, { headers });
      if (!response.ok) throw new Error(await readApiError(response, 'Не удалось загрузить обращения'));
      const items = await response.json() as InformationPageMessage[];
      setInformationMessages(items.map((item) => ({ ...item, page: { ...item.page, name: `${item.type === 'CLAIM_COMMUNITY' ? 'Права на сообщество' : item.type === 'REPORT_BUG' ? 'Сообщение о баге' : 'Предложение'} — ${item.page.name}` } })));
    }
    catch (error) { onNotify(error instanceof Error ? error.message : 'Ошибка загрузки обращений', 'error'); }
    finally { setIsLoading(false); }
  }, [authToken, onNotify]);

  const loadReservedUsernames = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`${apiUrl}/admin/reserved-usernames`, { headers });
      if (!response.ok) throw new Error(await readApiError(response, 'Не удалось загрузить резерв username'));
      setReservedUsernames(await response.json() as ReservedUsername[]);
    } catch (error) { onNotify(error instanceof Error ? error.message : 'Ошибка загрузки username', 'error'); }
    finally { setIsLoading(false); }
  }, [authToken, onNotify]);

  const loadCategoryCovers = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`${apiUrl}/category-covers`);
      if (!response.ok) throw new Error(await readApiError(response, 'Не удалось загрузить обложки'));
      const payload = await response.json() as { items: CategoryCover[] };
      setCategoryCovers(payload.items);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : 'Не удалось загрузить обложки', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [onNotify]);

  useEffect(() => {
    if (section === 'dashboard') void loadStats();
    else if (section === 'covers') void loadCategoryCovers();
    else if (section === 'pages') void loadPages();
    else if (section === 'messages') void loadInformationMessages();
    else if (section === 'invites') void loadInvites();
    else void loadReservedUsernames();
  }, [section, loadStats, loadCategoryCovers, loadPages, loadInformationMessages, loadInvites, loadReservedUsernames]);

  const pickCategoryCover = async (surface: CategoryCoverSurface, category: string) => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return onNotify('Разрешите доступ к фотографиям', 'error');
    const result = await ImagePicker.launchImageLibraryAsync({ allowsEditing: false, base64: false, mediaTypes: ['images'], quality: 1 });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setCategoryCoverCrop({
      surface,
      category,
      asset: { uri: asset.uri, width: asset.width || 900, height: asset.height || 1200, mimeType: asset.mimeType || 'image/jpeg' },
    });
  };

  const saveCategoryCover = async (uri: string) => {
    if (!categoryCoverCrop || isCategoryCoverSaving) return;
    const { surface, category } = categoryCoverCrop;
    setIsCategoryCoverSaving(true);
    try {
      const asset = await uploadCategoryCoverAsset(uri, authToken, `${surface}_${category}`);
      const response = await fetch(`${apiUrl}/category-covers/${encodeURIComponent(surface)}/${encodeURIComponent(category)}`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageKey: asset.assetKey }),
      });
      if (!response.ok) throw new Error(await readApiError(response, 'Не удалось сохранить обложку'));
      const saved = await response.json() as CategoryCover;
      setCategoryCovers((current) => [...current.filter((item) => item.surface !== surface || item.category !== category), saved]);
      onNotify('Обложка категории сохранена', 'success');
    } catch (error) {
      onNotify(error instanceof Error ? error.message : 'Не удалось сохранить обложку', 'error');
    } finally {
      setIsCategoryCoverSaving(false);
      setCategoryCoverCrop(null);
    }
  };

  useEffect(() => {
    if (!assigningPageId || ownerQuery.trim().replace(/^@/, '').length < 2) { setOwnerSuggestions([]); return; }
    let active = true;
    const timer = setTimeout(() => {
      void fetch(`${apiUrl}/profiles?q=${encodeURIComponent(ownerQuery.trim().replace(/^@/, ''))}&pageSize=6`, { headers })
        .then(async (response) => response.ok ? response.json() as Promise<CursorPage<PublicAccount>> : { items: [], nextCursor: null })
        .then((result) => { if (active) setOwnerSuggestions(result.items); });
    }, remoteSearchDebounceMs);
    return () => { active = false; clearTimeout(timer); };
  }, [assigningPageId, authToken, ownerQuery]);

  useEffect(() => {
    const username = form.username.trim().replace(/^@/, '').toLowerCase();
    if (!username) { setPageUsernameState('idle'); return; }
    if (!/^[a-z0-9_]{3,30}$/.test(username)) { setPageUsernameState('invalid'); return; }
    let active = true;
    setPageUsernameState('checking');
    const timer = setTimeout(() => {
      void fetch(`${apiUrl}/admin/information-pages/username-available?username=${encodeURIComponent(username)}`, { headers })
        .then(async (response) => {
          if (!response.ok) throw new Error('availability');
          return response.json() as Promise<{ available: boolean }>;
        })
        .then((result) => { if (active) setPageUsernameState(result.available ? 'available' : 'taken'); })
        .catch(() => { if (active) setPageUsernameState('invalid'); });
    }, 350);
    return () => { active = false; clearTimeout(timer); };
  }, [authToken, form.username]);

  const generateInvites = async () => {
    const count = Number(inviteCount);
    if (inviteLabel.trim().length < 2) return onNotify('Укажите имя или метку приглашения', 'error');
    if (!Number.isInteger(count) || count < 1 || count > 20) return onNotify('Можно создать от 1 до 20 кодов', 'error');
    setIsLoading(true);
    try { const response = await fetch(`${apiUrl}/admin/invite-codes`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ label: inviteLabel.trim(), count }) }); if (!response.ok) throw new Error(await readApiError(response, 'Не удалось создать коды')); const created = await response.json() as AdminInviteCode[]; setInviteCodes((current) => [...created, ...current]); setInviteLabel(''); onNotify('Коды созданы'); }
    catch (error) { onNotify(error instanceof Error ? error.message : 'Не удалось создать коды', 'error'); }
    finally { setIsLoading(false); }
  };

  const reserveUsername = async () => {
    const username = reservedUsernameInput.trim().replace(/^@/, '').toLowerCase();
    if (!/^[a-z0-9_]{3,30}$/.test(username)) return onNotify('От 3 до 30 латинских букв, цифр или _', 'error');
    setIsReservedUsernameSaving(true);
    try {
      const response = await fetch(`${apiUrl}/admin/reserved-usernames`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ username }) });
      if (!response.ok) throw new Error(await readApiError(response, 'Не удалось зарезервировать username'));
      const created = await response.json() as ReservedUsername;
      setReservedUsernames((current) => [...current, created].sort((left, right) => left.username.localeCompare(right.username)));
      setReservedUsernameInput('');
      onNotify(`@${username} добавлен в резерв`, 'success');
    } catch (error) { onNotify(error instanceof Error ? error.message : 'Не удалось зарезервировать username', 'error'); }
    finally { setIsReservedUsernameSaving(false); }
  };

  const releaseUsername = (username: string) => {
    Alert.alert('Убрать из резерва?', `Username @${username} снова сможет занять профиль или сообщество, если он сейчас свободен.`, [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Убрать', style: 'destructive', onPress: () => void (async () => {
        const response = await fetch(`${apiUrl}/admin/reserved-usernames/${encodeURIComponent(username)}`, { method: 'DELETE', headers });
        if (!response.ok) return onNotify(await readApiError(response, 'Не удалось убрать username из резерва'), 'error');
        setReservedUsernames((current) => current.filter((item) => item.username !== username));
        onNotify(`@${username} убран из резерва`, 'success');
      })() },
    ]);
  };

  const resetForm = () => {
    setEditingId(null);
    setPageUsernameState('idle');
    setForm({ username: '', name: '', type: '', countryCode: '', countryName: '', cityName: '', cityId: '', about: '' });
  };
  const savePage = async () => {
    if (pageUsernameState !== 'available') throw new Error('Выберите свободный URL сообщества');
    const payload = { username: form.username, name: form.name, type: form.type, countryCode: form.countryCode, countryName: form.countryName, cityName: form.cityName, cityId: form.cityId, about: form.about };
    const response = await fetch(`${apiUrl}/admin/information-pages`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!response.ok) throw new Error(await readApiError(response, 'Не удалось сохранить сообщество'));
    resetForm();
    await loadPages();
    onNotify('Информационное сообщество создано', 'success');
  };
  const resetArtistForm = () => {
    setArtistEditingId(null);
    setArtistForm({ username: '', name: '', countryCode: '', countryName: '', cityName: '', cityId: '', about: '' });
  };
  const saveArtist = async () => {
    const endpoint = artistEditingId ? `${apiUrl}/admin/information-artists/${artistEditingId}` : `${apiUrl}/admin/information-artists`;
    const body = artistEditingId
      ? { name: artistForm.name.trim(), countryCode: artistForm.countryCode, countryName: artistForm.countryName, cityName: artistForm.cityName, cityId: artistForm.cityId, about: artistForm.about.trim() }
      : { username: artistForm.username, name: artistForm.name.trim(), countryCode: artistForm.countryCode, countryName: artistForm.countryName, cityName: artistForm.cityName, cityId: artistForm.cityId, about: artistForm.about.trim() };
    const response = await fetch(endpoint, { method: artistEditingId ? 'PATCH' : 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error(await readApiError(response, 'Не удалось сохранить профиль артиста'));
    resetArtistForm();
    await loadPages();
    onNotify(artistEditingId ? 'Профиль артиста обновлён' : 'Информационный профиль артиста создан', 'success');
  };
  const issueArtistAccess = async (artist: AdminInformationArtist) => {
    const response = await fetch(`${apiUrl}/admin/information-artists/${artist.id}/temporary-access`, { method: 'POST', headers });
    if (!response.ok) throw new Error(await readApiError(response, 'Не удалось создать временный пароль'));
    const result = await response.json() as { temporaryPassword: string };
    setIssuedArtistAccess({ username: artist.username, password: result.temporaryPassword });
    await loadPages();
  };
  const reviewCommunity = async (id: string, status: 'APPROVED' | 'REJECTED', reason?: string) => {
    const response = await fetch(`${apiUrl}/moderation/public-pages/${id}`, { method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ status, ...(reason ? { reason } : {}) }) });
    if (!response.ok) throw new Error(await readApiError(response, 'Не удалось завершить модерацию'));
    setPendingPages((current) => current.filter((page) => page.id !== id));
    onNotify(status === 'APPROVED' ? 'Сообщество опубликовано' : 'Сообщество отклонено', 'success');
  };
  const closeOwnerAssignment = () => { setAssigningPageId(null); setOwnerQuery(''); setOwnerSuggestions([]); setSelectedOwner(null); };
  const assignOwner = async () => {
    if (!assigningPageId || !selectedOwner) return onNotify('Выберите профиль владельца', 'error');
    setIsLoading(true);
    try {
      const response = await fetch(`${apiUrl}/admin/information-pages/${assigningPageId}/owner`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: selectedOwner.username }) });
      if (!response.ok) throw new Error(await readApiError(response, 'Не удалось назначить владельца'));
      setPages((current) => current.filter((page) => page.id !== assigningPageId));
      closeOwnerAssignment();
      onNotify('Владелец сообщества назначен', 'success');
    } catch (error) { onNotify(error instanceof Error ? error.message : 'Не удалось назначить владельца', 'error'); }
    finally { setIsLoading(false); }
  };
  const maxCount = Math.max(1, ...(stats?.points.map((point) => point.count) ?? []));
  const normalizedPageSearchQuery = pageSearchQuery.trim().replace(/^@/, '').toLocaleLowerCase('ru-RU');
  const matchingPages = normalizedPageSearchQuery
    ? pages.filter((page) => (
      page.name.toLocaleLowerCase('ru-RU').includes(normalizedPageSearchQuery)
      || page.username.toLocaleLowerCase('ru-RU').includes(normalizedPageSearchQuery)
    )).slice(0, 20)
    : [];

  return (
    <>
      {!embedded ? <View style={styles.topBar}>
        <View style={styles.topBarLeft}>
          <Pressable accessibilityLabel="Назад" accessibilityRole="button" onPress={onBack} style={styles.topBarIconButton}>
            <ChevronLeft size={29} color="#090909" />
          </Pressable>
          <Text style={styles.topBarTitle}>Админка</Text>
        </View>
      </View> : null}
      <View style={styles.adminScreen}>
        <View style={styles.adminTabs}>
          <Pressable accessibilityRole="tab" accessibilityState={{ selected: section === 'dashboard' }} onPress={() => setSection('dashboard')} style={[styles.adminTab, section === 'dashboard' && styles.adminTabActive]}><Text style={[styles.adminTabText, section === 'dashboard' && styles.adminTabTextActive]}>Главное</Text></Pressable>
          <Pressable accessibilityRole="tab" accessibilityState={{ selected: section === 'covers' }} onPress={() => setSection('covers')} style={[styles.adminTab, section === 'covers' && styles.adminTabActive]}><Text style={[styles.adminTabText, section === 'covers' && styles.adminTabTextActive]}>Обложки</Text></Pressable>
          <Pressable accessibilityRole="tab" accessibilityState={{ selected: section === 'pages' }} onPress={() => setSection('pages')} style={[styles.adminTab, section === 'pages' && styles.adminTabActive]}><Text style={[styles.adminTabText, section === 'pages' && styles.adminTabTextActive]}>Страницы</Text></Pressable>
          <Pressable accessibilityRole="tab" accessibilityState={{ selected: section === 'messages' }} onPress={() => setSection('messages')} style={[styles.adminTab, section === 'messages' && styles.adminTabActive]}><Text style={[styles.adminTabText, section === 'messages' && styles.adminTabTextActive]}>Обращения</Text></Pressable>
          <Pressable accessibilityRole="tab" accessibilityState={{ selected: section === 'invites' }} onPress={() => setSection('invites')} style={[styles.adminTab, section === 'invites' && styles.adminTabActive]}><Text style={[styles.adminTabText, section === 'invites' && styles.adminTabTextActive]}>Инвайты</Text></Pressable>
          <Pressable accessibilityRole="tab" accessibilityState={{ selected: section === 'usernames' }} onPress={() => setSection('usernames')} style={[styles.adminTab, section === 'usernames' && styles.adminTabActive]}><Text style={[styles.adminTabText, section === 'usernames' && styles.adminTabTextActive]}>Резерв</Text></Pressable>
        </View>
        {section === 'dashboard' ? (
          <ScrollView contentContainerStyle={styles.adminContent} refreshControl={<AppRefreshControl refreshing={isLoading} onRefresh={() => void loadStats()} />}>
            <Text style={styles.adminSectionTitle}>Мониторинг</Text>
            <View style={styles.adminMetricCard}><Text style={styles.adminMetricLabel}>Всего пользователей</Text><Text style={styles.adminMetricValue}>{stats?.totalUsers ?? '—'}</Text></View>
            <View style={styles.adminChartCard}>
              <View style={styles.adminChartHeader}><Text style={styles.adminChartTitle}>Новые регистрации</Text><View style={styles.adminPeriodControl}>{(['day', 'month'] as const).map((value) => <Pressable key={value} onPress={() => setPeriod(value)} style={[styles.adminPeriodButton, period === value && styles.adminPeriodButtonActive]}><Text style={[styles.adminPeriodText, period === value && styles.adminPeriodTextActive]}>{value === 'day' ? 'По дням' : 'По месяцам'}</Text></Pressable>)}</View></View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.adminChart}>
                {stats?.points.length ? stats.points.map((point) => <View key={point.period} style={styles.adminBarColumn}><Text style={styles.adminBarValue}>{point.count}</Text><View style={[styles.adminBar, { height: Math.max(4, 130 * point.count / maxCount) }]} /><Text style={styles.adminBarLabel}>{new Date(point.period).toLocaleDateString('ru-RU', period === 'day' ? { day: '2-digit', month: '2-digit' } : { month: 'short' })}</Text></View>) : <Text style={styles.adminEmptyText}>Регистраций за выбранный период нет</Text>}
              </ScrollView>
            </View>
          </ScrollView>
        ) : section === 'covers' ? (
          <ScrollView contentContainerStyle={styles.adminContent} refreshControl={<AppRefreshControl refreshing={isLoading} onRefresh={() => void loadCategoryCovers()} />}>
            <Text style={styles.adminSectionTitle}>Обложки категорий</Text>
            <Text style={styles.adminSectionDescription}>Нажмите на плитку, выберите изображение и настройте кадрирование 3:4. Масштаб и положение сохраняются в готовой обложке.</Text>
            <Text style={styles.adminListTitle}>События</Text>
            <View style={styles.adminCategoryCoverGrid}>
              {eventCategoryOptions.map((option) => {
                const cover = categoryCovers.find((item) => item.surface === 'events' && item.category === option.value);
                return <CatalogCategoryTile accessibilityLabel={`${cover ? 'Изменить' : 'Добавить'} обложку категории ${option.label}`} category={option.label} countLabel={cover ? 'Изменить' : 'Добавить'} coverUrl={cover?.imageUrl} key={option.value} onPress={() => void pickCategoryCover('events', option.value)} />;
              })}
            </View>
            <Text style={styles.adminListTitle}>Локации</Text>
            <View style={styles.adminCategoryCoverGrid}>
              {locationCategoryOptions.map((option) => {
                const cover = categoryCovers.find((item) => item.surface === 'locations' && item.category === option.value);
                return <CatalogCategoryTile accessibilityLabel={`${cover ? 'Изменить' : 'Добавить'} обложку категории ${option.label}`} category={option.label} countLabel={cover ? 'Изменить' : 'Добавить'} coverUrl={cover?.imageUrl} key={option.value} onPress={() => void pickCategoryCover('locations', option.value)} />;
              })}
            </View>
            {isCategoryCoverSaving ? <View style={styles.loadingRow}><ActivityIndicator color="#111" /><Text style={styles.adminSectionDescription}>Сохраняем обложку…</Text></View> : null}
          </ScrollView>
        ) : section === 'messages' ? (
          <ScrollView contentContainerStyle={styles.adminContent} refreshControl={<AppRefreshControl refreshing={isLoading} onRefresh={() => void loadInformationMessages()} />}>
            <Text style={styles.adminSectionTitle}>Обращения представителей</Text>
            <Text style={styles.adminSectionDescription}>Сообщения от пользователей, заявивших о связи с информационным сообществом.</Text>
            {informationMessages.map((item) => <View key={item.id} style={styles.moderationCard}><Text style={styles.moderationTitle}>{item.page.name} · @{item.page.username}</Text><Text style={styles.moderationMeta}>{item.sender.name} · @{item.sender.username}{item.sender.email ? ` · ${item.sender.email}` : ''}</Text><Text style={styles.moderationMeta}>{new Date(item.createdAt).toLocaleString('ru-RU')}</Text><Text style={styles.moderationDetails}>{item.message}</Text>{!item.readAt ? <Pressable onPress={async () => { const response = await fetch(`${apiUrl}/admin/information-messages/${item.id}/read`, { method: 'PATCH', headers }); if (response.ok) setInformationMessages((current) => current.map((message) => message.id === item.id ? { ...message, readAt: new Date().toISOString() } : message)); }} style={styles.moderationActionButton}><Text style={styles.moderationActionText}>Отметить прочитанным</Text></Pressable> : <Text style={styles.adminPageMeta}>Прочитано</Text>}</View>)}
            {!informationMessages.length && !isLoading ? <Text style={styles.adminEmptyText}>Обращений пока нет</Text> : null}
          </ScrollView>
        ) : section === 'invites' ? (
          <ScrollView contentContainerStyle={styles.adminContent} keyboardShouldPersistTaps="handled" refreshControl={<AppRefreshControl refreshing={isLoading} onRefresh={() => void loadInvites()} />}>
            <Text style={styles.adminSectionTitle}>Коды приглашений</Text>
            <Text style={styles.adminSectionDescription}>Метка поможет понять, для кого или какой кампании создан код. Автор и пользователь, применивший код, сохраняются автоматически.</Text>
            <View style={styles.adminInviteForm}><TextInput value={inviteLabel} onChangeText={setInviteLabel} placeholder="Имя или метка" placeholderTextColor="#98a3ae" style={styles.adminInput} /><TextInput keyboardType="number-pad" maxLength={2} value={inviteCount} onChangeText={(value) => setInviteCount(value.replace(/\D/g, '').slice(0, 2))} placeholder="Количество" placeholderTextColor="#98a3ae" style={styles.adminInput} /><Pressable disabled={isLoading} onPress={() => void generateInvites()} style={[styles.adminPrimaryButton, isLoading && styles.disabledButton]}><Text style={styles.adminPrimaryButtonText}>Сгенерировать</Text></Pressable></View>
            <Text style={styles.adminListTitle}>История кодов</Text>
            {inviteCodes.map((item) => <View key={item.id} style={styles.adminInviteCard}><View style={styles.adminPageCopy}><Text style={styles.adminInviteCode}>{item.code}</Text><Text style={styles.adminPageName}>{item.label || `От @${item.creator.username}`}</Text><Text style={styles.adminPageMeta}>Создал @{item.creator.username} · {item.redeemedBy ? `использовал @${item.redeemedBy.username}` : 'не использован'}</Text></View><Pressable accessibilityLabel={`Скопировать ${item.code}`} onPress={() => void Clipboard.setStringAsync(item.code)} style={styles.adminInviteCopy}><Copy color="#fff" size={17} /></Pressable></View>)}
            {!inviteCodes.length && !isLoading ? <Text style={styles.adminEmptyText}>Кодов пока нет</Text> : null}
          </ScrollView>
        ) : section === 'usernames' ? (
          <ScrollView contentContainerStyle={styles.adminContent} keyboardShouldPersistTaps="handled" refreshControl={<AppRefreshControl refreshing={isLoading} onRefresh={() => void loadReservedUsernames()} />}>
            <Text style={styles.adminSectionTitle}>Зарезервированные username</Text>
            <Text style={styles.adminSectionDescription}>Эти имена считаются занятыми одновременно для профилей и сообществ. Уже существующий владелец может сохранить своё имя, но после освобождения его никто не займёт.</Text>
            <View style={styles.adminInviteForm}>
              <View style={styles.adminUsernameInput}><Text style={styles.adminUsernamePrefix}>@</Text><TextInput autoCapitalize="none" autoCorrect={false} maxLength={30} value={reservedUsernameInput} onChangeText={(value) => setReservedUsernameInput(value.replace(/^@/, '').toLowerCase().replace(/[^a-z0-9_]/g, ''))} placeholder="username" placeholderTextColor="#98a3ae" style={styles.adminUsernameTextInput} /></View>
              <Pressable accessibilityRole="button" accessibilityState={{ disabled: !/^[a-z0-9_]{3,30}$/.test(reservedUsernameInput) || isReservedUsernameSaving }} disabled={!/^[a-z0-9_]{3,30}$/.test(reservedUsernameInput) || isReservedUsernameSaving} onPress={() => void reserveUsername()} style={[styles.adminPrimaryButton, (!/^[a-z0-9_]{3,30}$/.test(reservedUsernameInput) || isReservedUsernameSaving) && styles.disabledButton]}>{isReservedUsernameSaving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.adminPrimaryButtonText}>Добавить в резерв</Text>}</Pressable>
            </View>
            <Text style={styles.adminListTitle}>Список</Text>
            {reservedUsernames.map((item) => <View key={item.username} style={styles.adminPageCard}><View style={styles.adminPageCopy}><Text style={styles.adminPageName}>@{item.username}</Text><Text style={styles.adminPageMeta}>{item.createdBy ? `Добавил @${item.createdBy.username}` : 'Системный резерв'}{item.occupiedBy === 'ACCOUNT' ? ' · занят профилем' : item.occupiedBy === 'PUBLIC_PAGE' ? ' · занят сообществом' : ''}</Text></View><Pressable accessibilityLabel={`Убрать @${item.username} из резерва`} onPress={() => releaseUsername(item.username)} style={styles.adminDeleteButton}><Trash2 size={19} color="#d93025" /></Pressable></View>)}
            {!reservedUsernames.length && !isLoading ? <Text style={styles.adminEmptyText}>Зарезервированных username пока нет</Text> : null}
          </ScrollView>
        ) : (
          <ScrollView contentContainerStyle={styles.adminContent} keyboardShouldPersistTaps="handled" refreshControl={<AppRefreshControl refreshing={isLoading} onRefresh={() => void loadPages()} />}>
            <Text style={styles.adminSectionTitle}>Модерация</Text>
            <Text style={styles.adminSectionDescription}>Новые сообщества появляются здесь до публикации.</Text>
            {pendingPages.map((page) => <View key={page.id} style={styles.moderationCard}><Text style={styles.moderationTitle}>{page.name}</Text><Text style={styles.moderationMeta}>@{page.username} · создатель @{page.owner?.username}</Text><Text style={styles.moderationDetails}>{page.about}</Text><View style={styles.moderationActions}><Pressable onPress={() => void reviewCommunity(page.id, 'APPROVED').catch((error) => onNotify(error.message, 'error'))} style={styles.moderationActionButton}><Text style={styles.moderationActionText}>Опубликовать</Text></Pressable><Pressable onPress={() => setRejectingPage(page)} style={styles.moderationSecondaryButton}><Text style={styles.moderationSecondaryText}>Отклонить</Text></Pressable></View></View>)}
            {!pendingPages.length && !isLoading ? <Text style={styles.adminEmptyText}>Новых сообществ на модерации нет</Text> : null}
            <Text style={styles.adminSectionTitle}>Новое информационное сообщество</Text>
            <Text style={styles.adminSectionDescription}>Страница без владельца публикуется сразу. Существующие сообщества редактируются на их обычных страницах в режиме администрирования.</Text>
            <View style={styles.adminUsernameInput}><Text style={styles.adminUsernamePrefix}>@</Text><TextInput autoCapitalize="none" autoCorrect={false} maxLength={30} value={form.username} onChangeText={(username) => setForm({ ...form, username: username.replace(/^@/, '').toLowerCase().replace(/[^a-z0-9_]/g, '') })} placeholder="url-name" placeholderTextColor="#98a3ae" style={styles.adminUsernameTextInput} />{pageUsernameState === 'checking' ? <ActivityIndicator color="#6f7b86" size="small" /> : null}{pageUsernameState === 'available' ? <Check color="#2fa84f" size={20} strokeWidth={2.4} /> : null}{pageUsernameState === 'taken' || pageUsernameState === 'invalid' ? <X color="#c62828" size={19} strokeWidth={2.4} /> : null}</View>
            {pageUsernameState === 'available' ? <Text style={styles.adminUsernameAvailable}>URL свободен</Text> : null}
            {pageUsernameState === 'taken' ? <Text style={styles.adminUsernameError}>Этот URL уже занят</Text> : null}
            {pageUsernameState === 'invalid' ? <Text style={styles.adminUsernameError}>От 3 до 30 латинских букв, цифр или _</Text> : null}
            <TextInput value={form.name} onChangeText={(name) => setForm({ ...form, name })} placeholder="Название" placeholderTextColor="#98a3ae" style={styles.adminInput} />
            <Pressable accessibilityRole="button" onPress={() => setIsTypePickerOpen(true)} style={styles.adminTypeSelect}><Text style={form.type ? styles.adminTypeSelectText : styles.adminTypeSelectPlaceholder}>{types.find((option) => option.value === form.type)?.label || 'Тип сообщества'}</Text><ChevronRight color="#6f7b86" size={19} strokeWidth={1.8} /></Pressable>
            <Pressable accessibilityRole="button" onPress={() => setLocationTarget('page')} style={styles.adminPickerField}><Text style={form.countryName ? styles.adminPickerValue : styles.adminPickerPlaceholder}>{form.cityName ? `${form.countryName}, ${form.cityName}` : form.countryName || 'Местоположение'}</Text></Pressable>
            <TextInput multiline value={form.about} onChangeText={(about) => setForm({ ...form, about })} placeholder="Описание (необязательно)" placeholderTextColor="#98a3ae" style={[styles.adminInput, styles.adminAboutInput]} />
            <View style={styles.adminFormActions}><Pressable disabled={pageUsernameState !== 'available' || isLoading} onPress={() => void savePage().catch((error) => onNotify(error.message, 'error'))} style={[styles.adminPrimaryButton, (pageUsernameState !== 'available' || isLoading) && styles.disabledButton]}><Text style={styles.adminPrimaryButtonText}>Добавить</Text></Pressable></View>
            <Text style={styles.adminListTitle}>Управление информационным сообществом</Text>
            <View style={[styles.appSheetSearch, styles.adminPageSearch]}>
              <Search color="#6f7b86" size={19} />
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={setPageSearchQuery}
                placeholder="Название или @юзернейм"
                placeholderTextColor="#8e99a4"
                style={styles.appSheetSearchInput}
                value={pageSearchQuery}
              />
              {pageSearchQuery ? <Pressable accessibilityLabel="Очистить поиск" onPress={() => setPageSearchQuery('')}><X color="#6f7b86" size={19} /></Pressable> : null}
            </View>
            {matchingPages.map((page) => <View key={page.id}><View style={styles.adminPageCard}><Pressable onPress={() => { setEditingId(page.id); setForm({ username: page.username, name: page.name, type: page.type, countryName: page.countryName, cityName: page.cityName, about: page.about }); }} style={styles.adminPageCopy}><Text style={styles.adminPageName}>{page.name}</Text><Text style={styles.adminPageMeta}>@{page.username} · {page.cityName || 'Город не указан'}</Text></Pressable><Pressable accessibilityLabel={`Назначить владельца ${page.name}`} onPress={() => { setAssigningPageId(page.id); setOwnerQuery(''); setSelectedOwner(null); }} style={styles.adminDeleteButton}><UserPlus size={20} color="#111" /></Pressable><Pressable accessibilityLabel={`Удалить ${page.name}`} onPress={async () => { const response = await fetch(`${apiUrl}/admin/information-pages/${page.id}`, { method: 'DELETE', headers }); if (response.ok) await loadPages(); else onNotify('Не удалось удалить сообщество', 'error'); }} style={styles.adminDeleteButton}><Trash2 size={19} color="#d93025" /></Pressable></View>{assigningPageId === page.id ? <View style={styles.adminOwnerCard}><View style={styles.adminOwnerHeader}><View><Text style={styles.adminPageName}>Назначить владельца</Text><Text style={styles.adminPageMeta}>После передачи сообщество перестанет быть информационным.</Text></View><Pressable accessibilityLabel="Закрыть" onPress={closeOwnerAssignment}><X color="#111" size={22} /></Pressable></View><View style={styles.adminUsernameInput}><Text style={styles.adminUsernamePrefix}>@</Text><TextInput autoCapitalize="none" autoCorrect={false} onChangeText={(value) => { setOwnerQuery(value.replace(/^@/, '').toLowerCase()); setSelectedOwner(null); }} placeholder="Найти профиль" placeholderTextColor="#98a3ae" style={styles.adminUsernameTextInput} value={ownerQuery} /></View>{ownerSuggestions.map((account) => <Pressable key={account.id} onPress={() => { setSelectedOwner(account); setOwnerQuery(account.username); setOwnerSuggestions([]); }} style={[styles.adminOwnerSuggestion, selectedOwner?.id === account.id && styles.adminOwnerSuggestionSelected]}><Text style={styles.adminPageName}>{account.name}</Text><Text style={styles.adminPageMeta}>@{account.username}</Text></Pressable>)}<Pressable disabled={!selectedOwner || isLoading} onPress={() => void assignOwner()} style={[styles.adminPrimaryButton, (!selectedOwner || isLoading) && styles.disabledButton]}><Text style={styles.adminPrimaryButtonText}>Передать сообщество</Text></Pressable></View> : null}</View>)}
            {normalizedPageSearchQuery && !matchingPages.length && !isLoading ? <Text style={styles.adminEmptyText}>Ничего не найдено</Text> : null}

            <Text style={styles.adminSectionTitle}>Новый информационный артист</Text>
            <Text style={styles.adminSectionDescription}>Публичный профиль без учётной записи и возможности входа. Он использует обычную страницу профиля артиста.</Text>
            <View style={styles.adminUsernameInput}><Text style={styles.adminUsernamePrefix}>@</Text><TextInput autoCapitalize="none" autoCorrect={false} editable={!artistEditingId} maxLength={20} value={artistForm.username} onChangeText={(username) => setArtistForm({ ...artistForm, username: username.replace(/^@/, '').toLowerCase() })} placeholder="username артиста" placeholderTextColor="#98a3ae" style={styles.adminUsernameTextInput} /></View>
            <TextInput maxLength={30} value={artistForm.name} onChangeText={(name) => setArtistForm({ ...artistForm, name })} placeholder="Имя артиста" placeholderTextColor="#98a3ae" style={styles.adminInput} />
            <Pressable accessibilityRole="button" onPress={() => setLocationTarget('artist')} style={styles.adminPickerField}><Text style={artistForm.countryName ? styles.adminPickerValue : styles.adminPickerPlaceholder}>{artistForm.cityName ? `${artistForm.countryName}, ${artistForm.cityName}` : artistForm.countryName || 'Местоположение'}</Text></Pressable>
            <TextInput maxLength={600} multiline value={artistForm.about} onChangeText={(about) => setArtistForm({ ...artistForm, about })} placeholder="Описание (необязательно)" placeholderTextColor="#98a3ae" style={[styles.adminInput, styles.adminAboutInput]} />
            <View style={styles.adminFormActions}><Pressable onPress={() => void saveArtist().catch((error) => onNotify(error.message, 'error'))} style={styles.adminPrimaryButton}><Text style={styles.adminPrimaryButtonText}>{artistEditingId ? 'Сохранить' : 'Добавить артиста'}</Text></Pressable>{artistEditingId ? <Pressable onPress={resetArtistForm} style={styles.moderationSecondaryButton}><Text style={styles.moderationSecondaryText}>Отмена</Text></Pressable> : null}</View>
          </ScrollView>
        )}
      </View>
      <LocationPickerModal
        onClose={() => setLocationTarget(null)}
        onSelect={(location: LocationSelection) => {
          if (locationTarget === 'page') setForm((current) => ({ ...current, ...location }));
          if (locationTarget === 'artist') setArtistForm((current) => ({ ...current, ...location }));
          setLocationTarget(null);
        }}
        initialCountryName={locationTarget === 'page' ? form.countryName : artistForm.countryName}
        isVisible={locationTarget !== null}
      />
      <AppSheetModal isVisible={isTypePickerOpen} onClose={() => setIsTypePickerOpen(false)} scroll title="Тип сообщества">
        {types.map((option) => {
          const isSelected = form.type === option.value;
          return <Pressable accessibilityRole="button" accessibilityState={{ selected: isSelected }} key={option.value} onPress={() => { setForm((current) => ({ ...current, type: option.value })); setIsTypePickerOpen(false); }} style={[styles.adminTypeOption, isSelected && styles.adminTypeOptionSelected]}><Text style={[styles.adminTypeOptionText, isSelected && styles.adminTypeOptionTextSelected]}>{option.label}</Text>{isSelected ? <Check color="#fff" size={19} strokeWidth={2.2} /> : null}</Pressable>;
        })}
      </AppSheetModal>
      <AppSheetModal isVisible={Boolean(issuedArtistAccess)} onClose={() => setIssuedArtistAccess(null)} subtitle="Пароль показывается только сейчас. После входа артист обязан заменить его своим." title="Временный доступ">
        <View style={styles.adminOwnerCard}><Text style={styles.adminPageMeta}>Логин</Text><Text selectable style={styles.adminInviteCode}>@{issuedArtistAccess?.username}</Text><Text style={styles.adminPageMeta}>Одноразовый пароль</Text><Text selectable style={styles.adminInviteCode}>{issuedArtistAccess?.password}</Text><Pressable onPress={() => issuedArtistAccess ? void Clipboard.setStringAsync(`Логин: @${issuedArtistAccess.username}\nВременный пароль: ${issuedArtistAccess.password}`) : undefined} style={styles.adminPrimaryButton}><Copy color="#fff" size={17} /><Text style={styles.adminPrimaryButtonText}>Скопировать доступ</Text></Pressable></View>
      </AppSheetModal>
      <CommunityRejectionModal onClose={() => setRejectingPage(null)} onReject={(reason) => reviewCommunity(rejectingPage!.id, 'REJECTED', reason).catch((error) => { onNotify(error.message, 'error'); throw error; })} page={rejectingPage} />
      <AvatarCropModal asset={categoryCoverCrop?.asset ?? null} cropShape="category" label="обложку категории" onApply={(uri) => void saveCategoryCover(uri)} onClose={() => setCategoryCoverCrop(null)} />
    </>
  );
}

export function ModerationScreen({ authToken, embedded = false, onBack, onNotify }: { authToken: string; embedded?: boolean; onBack: () => void; onNotify: (message: string, type?: ToastMessage['type']) => void }) {
  const [reports, setReports] = useState<ModerationReport[]>([]);
  const [pendingPages, setPendingPages] = useState<PendingCommunity[]>([]);
  const [pendingProfileVerifications, setPendingProfileVerifications] = useState<PendingProfileVerificationRequest[]>([]);
  const [rejectingPage, setRejectingPage] = useState<PendingCommunity | null>(null);
  const [previewPostId, setPreviewPostId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const headers = { Authorization: `Bearer ${authToken}` };
      const [response, pagesResponse, profileVerificationsResponse] = await Promise.all([
        fetch(`${apiUrl}/moderation/reports?status=OPEN&pageSize=100`, { headers }),
        fetch(`${apiUrl}/moderation/public-pages`, { headers }),
        fetch(`${apiUrl}/moderation/profile-verification-requests`, { headers }),
      ]);
      if (!response.ok || !pagesResponse.ok || !profileVerificationsResponse.ok) {
        const failedResponse = !response.ok ? response : !pagesResponse.ok ? pagesResponse : profileVerificationsResponse;
        throw new Error(await readApiError(failedResponse, 'Не удалось загрузить модерацию'));
      }
      setReports(await response.json() as ModerationReport[]);
      setPendingPages(await pagesResponse.json() as PendingCommunity[]);
      setPendingProfileVerifications(await profileVerificationsResponse.json() as PendingProfileVerificationRequest[]);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : 'Не удалось загрузить жалобы', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [authToken, onNotify]);
  useEffect(() => { void load(); }, [load]);
  const review = async (id: string, status: ModerationReport['status']) => {
    const response = await fetch(`${apiUrl}/moderation/reports/${id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (!response.ok) throw new Error(await readApiError(response, 'Не удалось обновить жалобу'));
    await response.json() as ModerationReport;
    setReports((current) => current.filter((report) => report.id !== id));
    onNotify(status === 'RESOLVED' ? 'Жалоба принята' : 'Жалоба отклонена', 'success');
  };
  const reviewPage = async (id: string, status: 'APPROVED' | 'REJECTED', reason?: string) => {
    const response = await fetch(`${apiUrl}/moderation/public-pages/${id}`, { method: 'PATCH', headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ status, ...(reason ? { reason } : {}) }) });
    if (!response.ok) throw new Error(await readApiError(response, 'Не удалось завершить модерацию'));
    setPendingPages((current) => current.filter((page) => page.id !== id));
  };
  const reviewProfileVerification = async (id: string, status: 'APPROVED' | 'REJECTED') => {
    const response = await fetch(`${apiUrl}/moderation/profile-verification-requests/${id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (!response.ok) throw new Error(await readApiError(response, 'Не удалось обработать заявку'));
    setPendingProfileVerifications((current) => current.filter((request) => request.id !== id));
    onNotify(status === 'APPROVED' ? 'Профиль подтверждён' : 'Заявка отклонена', 'success');
  };
  return (
    <>
      {!embedded ? <View style={styles.topBar}>
        <View style={styles.topBarLeft}>
          <Pressable onPress={onBack} style={styles.topBarIconButton}><ChevronLeft size={29} color="#090909" /></Pressable>
          <Text style={styles.topBarTitle}>Модерация</Text>
        </View>
      </View> : null}
      <FlashList
        data={reports}
        keyExtractor={(report) => report.id}
        contentContainerStyle={styles.settingsContent}
        refreshControl={<AppRefreshControl refreshing={isLoading} onRefresh={() => void load()} tintColor="#111" />}
        ListHeaderComponent={(
          <View>
            <Text style={styles.adminListTitle}>Модерация сообществ</Text>
            {pendingPages.map((page) => (
              <View key={page.id} style={styles.moderationCard}>
                <Text style={styles.moderationTitle}>{page.name}</Text>
                <Text style={styles.moderationMeta}>@{page.username} · создатель @{page.owner?.username}</Text>
                <Text style={styles.moderationDetails}>{page.about}</Text>
                <View style={styles.moderationActions}>
                  <Pressable onPress={() => void reviewPage(page.id, 'APPROVED').catch((error) => onNotify(error.message, 'error'))} style={styles.moderationActionButton}><Text style={styles.moderationActionText}>Опубликовать</Text></Pressable>
                  <Pressable onPress={() => setRejectingPage(page)} style={styles.moderationSecondaryButton}><Text style={styles.moderationSecondaryText}>Отклонить</Text></Pressable>
                </View>
              </View>
            ))}
            {!pendingPages.length && !isLoading ? <Text style={styles.adminEmptyText}>Новых сообществ нет</Text> : null}

            <Text style={styles.adminListTitle}>Подтверждение профилей</Text>
            {pendingProfileVerifications.map((request) => {
              const target = request.account ?? request.publicPage;
              if (!target) return null;
              return (
                <View key={request.id} style={styles.moderationCard}>
                  <Text style={styles.moderationTitle}>{target.name}</Text>
                  <Text style={styles.moderationMeta}>
                    {request.publicPage ? 'Сообщество' : 'Профиль'} · @{target.username}
                    {target.cityName ? ` · ${target.cityName}` : ''}
                  </Text>
                  {target.about ? <Text style={styles.moderationDetails}>{target.about}</Text> : null}
                  <Text style={styles.moderationMeta}>Подана {new Date(request.createdAt).toLocaleString('ru-RU')}</Text>
                  <View style={styles.moderationActions}>
                    <Pressable onPress={() => void reviewProfileVerification(request.id, 'APPROVED').catch((error) => onNotify(error.message, 'error'))} style={styles.moderationActionButton}><Text style={styles.moderationActionText}>Подтвердить</Text></Pressable>
                    <Pressable onPress={() => void reviewProfileVerification(request.id, 'REJECTED').catch((error) => onNotify(error.message, 'error'))} style={styles.moderationSecondaryButton}><Text style={styles.moderationSecondaryText}>Отклонить</Text></Pressable>
                  </View>
                </View>
              );
            })}
            {!pendingProfileVerifications.length && !isLoading ? <Text style={styles.adminEmptyText}>Новых заявок нет</Text> : null}

            <Text style={styles.adminListTitle}>Жалобы</Text>
            <Text style={styles.adminEmptyText}>3 подтверждённых нарушения по разным объектам за 30 дней — блокировка аккаунта на 30 дней.</Text>
          </View>
        )}
        renderItem={({ item: report }) => (
          <View style={styles.moderationCard}>
            <Text style={styles.moderationTitle}>{report.reason} · {report.targetType}</Text>
            <Text style={styles.moderationMeta}>@{report.reporter.username} · {new Date(report.createdAt).toLocaleString('ru-RU')}</Text>
            <Text style={styles.moderationTarget} numberOfLines={2}>Объект: {report.targetId}</Text>
            {report.targetType === 'POST' ? (
              <Pressable accessibilityRole="link" onPress={() => setPreviewPostId(report.targetId)} style={styles.moderationPostLink}>
                <Eye color="#111" size={18} strokeWidth={1.9} />
                <Text style={styles.moderationPostLinkText}>Посмотреть публикацию</Text>
              </Pressable>
            ) : null}
            {report.subjectAccount ? <Text style={styles.moderationMeta}>Нарушитель: @{report.subjectAccount.username}</Text> : null}
            <Text style={styles.moderationMeta}>Подтверждено за 30 дней: {report.moderationStats.acceptedDistinctTargets30d} из {report.moderationStats.threshold}</Text>
            {report.moderationStats.suspendedUntil && new Date(report.moderationStats.suspendedUntil) > new Date() ? <Text style={styles.moderationDetails}>Заблокирован до {new Date(report.moderationStats.suspendedUntil).toLocaleDateString('ru-RU')}</Text> : null}
            {report.details ? <Text style={styles.moderationDetails}>{report.details}</Text> : null}
            <View style={styles.moderationActions}>
              <Pressable onPress={() => void review(report.id, 'RESOLVED').catch((error) => onNotify(error.message, 'error'))} style={styles.moderationActionButton}><Text style={styles.moderationActionText}>Принять</Text></Pressable>
              <Pressable onPress={() => void review(report.id, 'REJECTED').catch((error) => onNotify(error.message, 'error'))} style={styles.moderationSecondaryButton}><Text style={styles.moderationSecondaryText}>Отклонить</Text></Pressable>
            </View>
          </View>
        )}
        ListEmptyComponent={!isLoading ? <View style={styles.emptyProfileTab}><ShieldCheck size={30} color="#6f7b86" /><Text style={styles.emptyProfileTabTitle}>Открытых жалоб нет</Text></View> : null}
      />
      <AppSheetModal isVisible={Boolean(previewPostId)} onClose={() => setPreviewPostId(null)} scroll title="Публикация по жалобе">
        {previewPostId ? (
          <PostFeed
            authToken={authToken}
            authorType="account"
            canCreate={false}
            focusPostId={previewPostId}
            onNotify={onNotify}
            onOpenProfile={async () => undefined}
            onOpenPublicPage={async () => undefined}
            username=""
          />
        ) : null}
      </AppSheetModal>
      <CommunityRejectionModal onClose={() => setRejectingPage(null)} onReject={(reason) => reviewPage(rejectingPage!.id, 'REJECTED', reason).catch((error) => { onNotify(error.message, 'error'); throw error; })} page={rejectingPage} />
    </>
  );
}

type ModeratorAccount = Pick<PublicAccount, 'id' | 'username' | 'name' | 'avatarUrl'> & { role: 'MODERATOR' };
type SubscriptionDuration = '1' | '3' | '6' | '12' | 'LIFETIME' | 'NONE';
type SubscriptionAccount = Pick<PublicAccount, 'id' | 'username' | 'name' | 'avatarUrl'> & {
  profileType: 'REGULAR' | 'SUBSCRIBER';
  subscriptionExpiresAt: string | null;
};

function ModeratorManagement({
  authToken,
  onNotify,
}: {
  authToken: string;
  onNotify: (message: string, type?: ToastMessage['type']) => void;
}) {
  const [moderators, setModerators] = useState<ModeratorAccount[]>([]);
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<PublicAccount[]>([]);
  const [selected, setSelected] = useState<PublicAccount | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const headers = { Authorization: `Bearer ${authToken}` };

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`${apiUrl}/admin/moderators`, { headers });
      if (!response.ok) throw new Error(await readApiError(response, 'Не удалось загрузить модераторов'));
      setModerators(await response.json() as ModeratorAccount[]);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : 'Не удалось загрузить модераторов', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [authToken, onNotify]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const normalized = query.trim().replace(/^@/, '');
    if (normalized.length < 2 || selected?.username === normalized) {
      setSuggestions([]);
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      void fetch(`${apiUrl}/profiles?q=${encodeURIComponent(normalized)}&pageSize=8`, { headers })
        .then(async (response) => response.ok ? response.json() as Promise<CursorPage<PublicAccount>> : { items: [], nextCursor: null })
        .then((result) => { if (active) setSuggestions(result.items.filter((item) => !moderators.some((moderator) => moderator.id === item.id))); });
    }, remoteSearchDebounceMs);
    return () => { active = false; clearTimeout(timer); };
  }, [authToken, moderators, query, selected]);

  const changeRole = async (username: string, role: 'USER' | 'MODERATOR') => {
    setIsLoading(true);
    try {
      const response = await fetch(`${apiUrl}/admin/accounts/${encodeURIComponent(username)}/role`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      if (!response.ok) throw new Error(await readApiError(response, 'Не удалось изменить роль'));
      setQuery('');
      setSelected(null);
      setSuggestions([]);
      await load();
      onNotify(role === 'MODERATOR' ? `@${username} назначен модератором` : `@${username} больше не модератор`, 'success');
    } catch (error) {
      onNotify(error instanceof Error ? error.message : 'Не удалось изменить роль', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.moderatorManagementContent} keyboardShouldPersistTaps="handled" refreshControl={<AppRefreshControl refreshing={isLoading} onRefresh={() => void load()} />}>
      <Text style={styles.adminSectionTitle}>Назначить модератора</Text>
      <Text style={styles.adminSectionDescription}>Модераторы рассматривают сообщества и жалобы, но не получают доступ к административным настройкам.</Text>
      <View style={styles.appSheetSearch}>
        <Search color="#6f7b86" size={19} />
        <TextInput autoCapitalize="none" onChangeText={(value) => { setQuery(value.replace(/^@/, '').toLowerCase()); setSelected(null); }} placeholder="Имя или @юзернейм" placeholderTextColor="#8e99a4" style={styles.appSheetSearchInput} value={query} />
      </View>
      {suggestions.map((account) => <Pressable key={account.id} onPress={() => { setSelected(account); setQuery(account.username); setSuggestions([]); }} style={[styles.moderatorRow, selected?.id === account.id && styles.moderatorRowSelected]}><View style={styles.adminPageCopy}><Text style={styles.adminPageName}>{account.name}</Text><Text style={styles.adminPageMeta}>@{account.username}</Text></View></Pressable>)}
      <Pressable disabled={!selected || isLoading} onPress={() => selected && void changeRole(selected.username, 'MODERATOR')} style={[styles.adminPrimaryButton, styles.moderatorAssignButton, (!selected || isLoading) && styles.disabledButton]}><UserPlus color="#fff" size={19} /><Text style={styles.adminPrimaryButtonText}>Назначить модератором</Text></Pressable>
      <Text style={styles.adminListTitle}>Действующие модераторы</Text>
      {moderators.map((moderator) => <View key={moderator.id} style={styles.moderatorRow}><View style={styles.adminPageCopy}><Text style={styles.adminPageName}>{moderator.name}</Text><Text style={styles.adminPageMeta}>@{moderator.username}</Text></View><Pressable accessibilityLabel={`Снять роль модератора с ${moderator.name}`} onPress={() => void changeRole(moderator.username, 'USER')} style={styles.adminDeleteButton}><UserMinus color="#d93025" size={20} /></Pressable></View>)}
      {!moderators.length && !isLoading ? <Text style={styles.adminEmptyText}>Назначенных модераторов пока нет</Text> : null}
    </ScrollView>
  );
}

function SubscriptionManagement({ authToken, onNotify }: { authToken: string; onNotify: (message: string, type?: ToastMessage['type']) => void }) {
  const [subscriptions, setSubscriptions] = useState<SubscriptionAccount[]>([]);
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<PublicAccount[]>([]);
  const [selected, setSelected] = useState<SubscriptionAccount | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const headers = { Authorization: `Bearer ${authToken}` };

  const loadSubscriptions = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`${apiUrl}/admin/subscriptions`, { headers });
      if (!response.ok) throw new Error(await readApiError(response, 'Не удалось загрузить подписки'));
      setSubscriptions(await response.json() as SubscriptionAccount[]);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : 'Не удалось загрузить подписки', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [authToken, onNotify]);

  useEffect(() => { void loadSubscriptions(); }, [loadSubscriptions]);
  useEffect(() => {
    const normalized = query.trim().replace(/^@/, '');
    if (normalized.length < 2 || selected?.username === normalized) {
      setSuggestions([]);
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      void fetch(`${apiUrl}/profiles?q=${encodeURIComponent(normalized)}&pageSize=8`, { headers })
        .then(async (response) => response.ok ? response.json() as Promise<CursorPage<PublicAccount>> : { items: [], nextCursor: null })
        .then((result) => { if (active) setSuggestions(result.items); });
    }, remoteSearchDebounceMs);
    return () => { active = false; clearTimeout(timer); };
  }, [authToken, query, selected]);

  const selectAccount = async (account: PublicAccount) => {
    setQuery(account.username);
    setSuggestions([]);
    setIsLoading(true);
    try {
      const response = await fetch(`${apiUrl}/admin/accounts/${encodeURIComponent(account.username)}/subscription`, { headers });
      if (!response.ok) throw new Error(await readApiError(response, 'Не удалось загрузить профиль'));
      setSelected(await response.json() as SubscriptionAccount);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : 'Не удалось загрузить профиль', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const assign = async (duration: SubscriptionDuration) => {
    if (!selected) return;
    setIsLoading(true);
    try {
      const response = await fetch(`${apiUrl}/admin/accounts/${encodeURIComponent(selected.username)}/subscription`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ duration }),
      });
      if (!response.ok) throw new Error(await readApiError(response, 'Не удалось изменить подписку'));
      const updated = await response.json() as SubscriptionAccount;
      setSelected(updated);
      await loadSubscriptions();
      onNotify(duration === 'NONE' ? `Подписка @${updated.username} отключена` : `Подписка @${updated.username} выдана`, 'success');
    } catch (error) {
      onNotify(error instanceof Error ? error.message : 'Не удалось изменить подписку', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const subscriptionLabel = (account: SubscriptionAccount) => account.profileType === 'REGULAR'
    ? 'Обычный'
    : account.subscriptionExpiresAt
      ? `Подписка до ${new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(account.subscriptionExpiresAt))}`
      : 'Бессрочная подписка';

  return <ScrollView contentContainerStyle={styles.moderatorManagementContent} keyboardShouldPersistTaps="handled" refreshControl={<AppRefreshControl refreshing={isLoading} onRefresh={() => void loadSubscriptions()} />}>
    <Text style={styles.adminSectionTitle}>Подписки аккаунтов</Text>
    <Text style={styles.adminSectionDescription}>Служебный тип профиля скрыт от других пользователей и виден только администраторам.</Text>
    <View style={styles.appSheetSearch}><Search color="#6f7b86" size={19} /><TextInput autoCapitalize="none" onChangeText={(value) => { setQuery(value.replace(/^@/, '').toLowerCase()); setSelected(null); }} placeholder="Имя или @юзернейм" placeholderTextColor="#8e99a4" style={styles.appSheetSearchInput} value={query} /></View>
    {suggestions.map((account) => <Pressable key={account.id} onPress={() => void selectAccount(account)} style={styles.moderatorRow}><View style={styles.adminPageCopy}><Text style={styles.adminPageName}>{account.name}</Text><Text style={styles.adminPageMeta}>@{account.username}</Text></View></Pressable>)}
    {selected ? <View style={styles.subscriptionEditorCard}><Text style={styles.adminPageName}>{selected.name}</Text><Text style={styles.adminPageMeta}>@{selected.username} · {subscriptionLabel(selected)}</Text><View style={styles.subscriptionDurationGrid}>{([['1', '1 месяц'], ['3', '3 месяца'], ['6', '6 месяцев'], ['12', '12 месяцев'], ['LIFETIME', 'Бессрочно']] as Array<[SubscriptionDuration, string]>).map(([value, label]) => <Pressable disabled={isLoading} key={value} onPress={() => void assign(value)} style={styles.subscriptionDurationButton}><Text style={styles.subscriptionDurationText}>{label}</Text></Pressable>)}</View>{selected.profileType === 'SUBSCRIBER' ? <Pressable disabled={isLoading} onPress={() => void assign('NONE')} style={styles.subscriptionRemoveButton}><Text style={styles.subscriptionRemoveText}>Отключить подписку</Text></Pressable> : null}</View> : null}
    <Text style={styles.adminListTitle}>Действующие подписки</Text>
    {subscriptions.map((account) => <Pressable key={account.id} onPress={() => { setSelected(account); setQuery(account.username); }} style={styles.moderatorRow}><View style={styles.adminPageCopy}><Text style={styles.adminPageName}>{account.name}</Text><Text style={styles.adminPageMeta}>@{account.username} · {subscriptionLabel(account)}</Text></View></Pressable>)}
    {!subscriptions.length && !isLoading ? <Text style={styles.adminEmptyText}>Выданных подписок пока нет</Text> : null}
  </ScrollView>;
}

export function ModerationCenterScreen({
  accountRole,
  adminMode,
  authToken,
  onBack,
  onChangeAdminMode,
  onNotify,
}: {
  accountRole: 'MODERATOR' | 'ADMIN';
  adminMode: boolean;
  authToken: string;
  onBack: () => void;
  onChangeAdminMode: (enabled: boolean) => void;
  onNotify: (message: string, type?: ToastMessage['type']) => void;
}) {
  const [section, setSection] = useState<'review' | 'admin' | 'subscriptions' | 'moderators'>('review');
  const isAdmin = accountRole === 'ADMIN';
  return (
    <View style={styles.moderationCenter}>
      <View style={styles.topBar}><View style={styles.topBarLeft}><Pressable onPress={onBack} style={styles.topBarIconButton}><ChevronLeft size={29} color="#090909" /></Pressable><Text style={styles.topBarTitle}>Модерация</Text></View></View>
      {isAdmin ? <View style={styles.moderationCenterControls}>
        <View style={styles.moderationAdminModeCard}><View style={styles.sideMenuAdminModeCopy}><ShieldCheck color="#111" size={22} /><View style={styles.adminPageCopy}><Text style={styles.sideMenuText}>Режим администрирования</Text><Text style={styles.sideMenuAdminModeHint}>Права владельца для управления сообществами</Text></View></View><VolnaSwitch accessibilityLabel="Режим администрирования" onValueChange={onChangeAdminMode} value={adminMode} /></View>
        <View style={styles.moderationCenterTabs}>
          {([
            { key: 'review', label: 'Проверка' },
            { key: 'admin', label: 'Админка' },
            { key: 'subscriptions', label: 'Подписки' },
            { key: 'moderators', label: 'Модераторы' },
          ] as const).map((item) => <Pressable key={item.key} onPress={() => setSection(item.key)} style={[styles.moderationCenterTab, section === item.key && styles.moderationCenterTabActive]}><Text style={[styles.moderationCenterTabText, section === item.key && styles.moderationCenterTabTextActive]}>{item.label}</Text></Pressable>)}
        </View>
      </View> : null}
      <View style={styles.moderationCenterBody}>
        {section === 'review' ? <ModerationScreen authToken={authToken} embedded onBack={onBack} onNotify={onNotify} /> : null}
        {isAdmin && section === 'admin' ? <AdminScreen authToken={authToken} embedded onBack={onBack} onNotify={onNotify} /> : null}
        {isAdmin && section === 'subscriptions' ? <SubscriptionManagement authToken={authToken} onNotify={onNotify} /> : null}
        {isAdmin && section === 'moderators' ? <ModeratorManagement authToken={authToken} onNotify={onNotify} /> : null}
      </View>
    </View>
  );
}

export function SettingsScreen({
  initialInvisibleMode,
  initialMessagePrivacy,
  initialReadReceiptsPrivacy,
  initialShowBirthYear,
  initialShowSavedMusicOnProfile,
  initialShowUploadedMusicOnProfile,
  onBack,
  onSave,
}: {
  initialInvisibleMode: boolean;
  initialMessagePrivacy: MessagePrivacy;
  initialReadReceiptsPrivacy: MessagePrivacy;
  initialShowBirthYear: boolean;
  initialShowSavedMusicOnProfile: boolean;
  initialShowUploadedMusicOnProfile: boolean;
  onBack: () => void;
  onSave: (data: {
    messagePrivacy: MessagePrivacy;
    readReceiptsPrivacy: MessagePrivacy;
    invisibleMode: boolean;
    showSavedMusicOnProfile: boolean;
    showUploadedMusicOnProfile: boolean;
    showBirthYear: boolean;
  }) => Promise<void>;
}) {
  const [messagePrivacy, setMessagePrivacy] = useState<MessagePrivacy>(initialMessagePrivacy);
  const [readReceiptsPrivacy, setReadReceiptsPrivacy] = useState<MessagePrivacy>(initialReadReceiptsPrivacy);
  const [showBirthYear, setShowBirthYear] = useState(initialShowBirthYear);
  const [isInvisibleMode, setIsInvisibleMode] = useState(initialInvisibleMode);
  const [showSavedMusicOnProfile, setShowSavedMusicOnProfile] = useState(initialShowSavedMusicOnProfile);
  const [showUploadedMusicOnProfile, setShowUploadedMusicOnProfile] = useState(initialShowUploadedMusicOnProfile);
  const [isSaving, setIsSaving] = useState(false);
  const [notificationModes, setNotificationModes] = useState<Record<string, NotificationDeliveryMode>>({});
  const [eventReminderOffsetsMinutes, setEventReminderOffsetsMinutes] = useState<EventReminderOffsetMinutes[]>([1440]);
  const [notificationsLoading, setNotificationsLoading] = useState(true);
  const [pushPermission, setPushPermission] = useState(() => currentWebPushPermission());
  const [isPushEnabled, setIsPushEnabled] = useState(() => currentWebPushPermission() === 'granted');
  const messagePrivacyOptions: Array<{ label: string; value: MessagePrivacy }> = [
    { label: 'Подписки', value: 'following' },
    { label: 'Все', value: 'everyone' },
  ];
  const privacyOptions: Array<{ label: string; value: MessagePrivacy }> = [
    { label: 'Никто', value: 'nobody' },
    { label: 'Подписки', value: 'following' },
    { label: 'Все', value: 'everyone' },
  ];
  const saveSettings = async (
    nextMessagePrivacy: MessagePrivacy,
    nextReadReceiptsPrivacy: MessagePrivacy,
    nextInvisibleMode: boolean,
    nextShowSavedMusicOnProfile = showSavedMusicOnProfile,
    nextShowUploadedMusicOnProfile = showUploadedMusicOnProfile,
    nextShowBirthYear = showBirthYear,
  ) => {
    setIsSaving(true);

    try {
      await onSave({
        messagePrivacy: nextMessagePrivacy,
        readReceiptsPrivacy: nextReadReceiptsPrivacy,
        invisibleMode: nextInvisibleMode,
        showSavedMusicOnProfile: nextShowSavedMusicOnProfile,
        showUploadedMusicOnProfile: nextShowUploadedMusicOnProfile,
        showBirthYear: nextShowBirthYear,
      });
    } catch (saveError) {
      reportApiError(saveError instanceof Error ? saveError.message : 'Не удалось сохранить настройки');
    } finally {
      setIsSaving(false);
    }
  };

  useEffect(() => {
    let active = true;
    void fetch(`${apiUrl}/notifications/preferences`).then(async (response) => {
      if (!response.ok) throw new Error(await readApiError(response, 'Не удалось загрузить настройки уведомлений'));
      return response.json() as Promise<Array<{ eventType: NotificationEventType; mode: NotificationDeliveryMode; reminderOffsetsMinutes?: EventReminderOffsetMinutes[] }>>;
    }).then((items) => {
      if (active) {
        setNotificationModes(Object.fromEntries(items.map((item) => [item.eventType, normalizeNotificationMode(item.eventType, item.mode)])));
        const reminderPreference = items.find((item) => item.eventType === 'EVENT_REMINDER');
        if (reminderPreference?.reminderOffsetsMinutes?.length) {
          setEventReminderOffsetsMinutes(reminderPreference.reminderOffsetsMinutes);
        }
      }
    }).catch((loadError) => { if (active) reportApiError(loadError instanceof Error ? loadError.message : 'Не удалось загрузить настройки уведомлений'); })
      .finally(() => { if (active) setNotificationsLoading(false); });
    return () => { active = false; };
  }, []);

  const setNotificationMode = async (eventType: NotificationEventType, mode: NotificationDeliveryMode) => {
    const previous = notificationModes;
    const next = { ...notificationModes, [eventType]: mode };
    setNotificationModes(next);
    try {
      if (Platform.OS === 'web' && mode === 'IN_APP_AND_PUSH' && (!isPushEnabled || pushPermission !== 'granted')) {
        const permission = await requestWebPushPermission();
        setPushPermission(permission);
        if (permission !== 'granted') throw new Error('Системные уведомления запрещены в настройках браузера');
        setIsPushEnabled(true);
      }
      const response = await fetch(`${apiUrl}/notifications/preferences`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preferences: Object.entries(next).map(([type, value]) => ({ eventType: type, mode: value })), eventReminderOffsetsMinutes }) });
      if (!response.ok) throw new Error(await readApiError(response, 'Не удалось сохранить настройки уведомлений'));
    } catch (saveError) {
      setNotificationModes(previous);
      reportApiError(saveError instanceof Error ? saveError.message : 'Не удалось сохранить настройки уведомлений');
    }
  };

  const toggleEventReminderOffset = async (offsetMinutes: EventReminderOffsetMinutes) => {
    const previous = eventReminderOffsetsMinutes;
    const next = previous.includes(offsetMinutes)
      ? previous.filter((value) => value !== offsetMinutes)
      : [...previous, offsetMinutes].sort((left, right) => left - right);
    if (!next.length) {
      reportApiError('Выберите хотя бы один срок напоминания');
      return;
    }
    setEventReminderOffsetsMinutes(next);
    try {
      const response = await fetch(`${apiUrl}/notifications/preferences`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          preferences: Object.entries(notificationModes).map(([eventType, mode]) => ({ eventType, mode })),
          eventReminderOffsetsMinutes: next,
        }),
      });
      if (!response.ok) throw new Error(await readApiError(response, 'Не удалось сохранить сроки напоминаний'));
    } catch (saveError) {
      setEventReminderOffsetsMinutes(previous);
      reportApiError(saveError instanceof Error ? saveError.message : 'Не удалось сохранить сроки напоминаний');
    }
  };

  const setSystemPushEnabled = async (enabled: boolean) => {
    try {
      if (enabled) {
        const permission = await requestWebPushPermission();
        setPushPermission(permission);
        if (permission !== 'granted') throw new Error('Системные уведомления запрещены в настройках браузера');
        setIsPushEnabled(true);
      } else {
        await removeWebPushSubscription();
        setIsPushEnabled(false);
      }
    } catch (pushError) {
      reportApiError(pushError instanceof Error ? pushError.message : 'Не удалось изменить системные уведомления');
    }
  };

  const renderNotificationPreferences = (items: NotificationPreferenceItem[]) => (
    notificationsLoading
      ? <ActivityIndicator color="#111" />
      : items.map((item, index) => <View key={item.eventType}>
        {index ? <View style={styles.settingsDivider} /> : null}
        <Text style={styles.settingsLabel}>{item.label}</Text>
        <Text style={styles.settingsHint}>{item.hint}</Text>
        <AnimatedSegmentedControl
          containerStyle={[styles.privacySegment, { marginTop: 10 }]}
          onChange={(value) => void setNotificationMode(item.eventType, value)}
          options={(item.eventType === 'DIRECT_MESSAGE'
            ? [{ value: 'OFF', label: 'Не получать', renderContent: (active: boolean) => <X color={active ? '#111' : '#6f7b86'} size={18} strokeWidth={2} /> }, { value: 'IN_APP_AND_PUSH', label: '+Push' }]
            : item.requiredInApp
              ? [{ value: 'IN_APP', label: 'Здесь' }, { value: 'IN_APP_AND_PUSH', label: '+Push' }]
              : [{ value: 'OFF', label: 'Не получать', renderContent: (active: boolean) => <X color={active ? '#111' : '#6f7b86'} size={18} strokeWidth={2} /> }, { value: 'IN_APP', label: 'Здесь' }, { value: 'IN_APP_AND_PUSH', label: '+Push' }]
          ) as ReadonlyArray<{ value: NotificationDeliveryMode; label: string; renderContent?: (active: boolean) => ReactNode }>}
          value={notificationModes[item.eventType] ?? 'IN_APP_AND_PUSH'}
        />
        {item.eventType === 'EVENT_REMINDER' ? <View style={styles.eventReminderOptions}>
          <Text style={styles.eventReminderOptionsLabel}>Когда напоминать</Text>
          <View style={styles.eventReminderOptionsGrid}>
            {eventReminderOptions.map((option) => {
              const selected = eventReminderOffsetsMinutes.includes(option.value);
              return <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selected }}
                key={option.value}
                onPress={() => void toggleEventReminderOffset(option.value)}
                style={[styles.eventReminderOption, selected && styles.eventReminderOptionActive]}
              >
                <Text style={[styles.eventReminderOptionText, selected && styles.eventReminderOptionTextActive]}>{option.label}</Text>
              </Pressable>;
            })}
          </View>
        </View> : null}
      </View>)
  );

  return (
    <>
      <View style={styles.topBar}>
        <View style={styles.topBarLeft}>
          <Pressable onPress={onBack} style={styles.topBarIconButton}>
            <ChevronLeft size={29} color="#090909" strokeWidth={2.1} />
          </Pressable>
          <Text style={styles.topBarTitle}>Настройки и приватность</Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.settingsContent} showsVerticalScrollIndicator={false}>
        <Text style={styles.settingsSectionTitle}>Уведомления</Text>
        <View style={styles.settingsCard}>
          <View style={styles.settingsSwitchRow}><View style={styles.settingsSwitchCopy}><View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Bell color="#111" size={20} /><Text style={styles.settingsLabel}>Push-уведомления</Text></View><Text style={styles.settingsHint}>{Platform.OS !== 'web' ? 'Разрешение управляется настройками приложения на устройстве' : isPushEnabled ? 'Разрешены на этом устройстве' : pushPermission === 'denied' ? 'Запрещены в настройках браузера' : pushPermission === 'unsupported' ? 'Не поддерживаются этим браузером' : 'Отключены на этом устройстве'}</Text></View><VolnaSwitch accessibilityLabel="Push-уведомления" disabled={Platform.OS !== 'web' || pushPermission === 'unsupported'} onValueChange={(value) => void setSystemPushEnabled(value)} value={isPushEnabled} /></View>
        </View>
        <View style={[styles.settingsCard, styles.settingsCardSpaced]}>
          {renderNotificationPreferences(personalNotificationEvents)}
        </View>

        <Text style={[styles.settingsSectionTitle, styles.settingsSectionTitleSpaced]}>Уведомления от сообществ</Text>
        <View style={styles.settingsCard}>
          {renderNotificationPreferences(communityNotificationEvents)}
        </View>

        <Text style={[styles.settingsSectionTitle, styles.settingsSectionTitleSpaced]}>Профиль</Text>
        <View style={styles.settingsCard}>
          <View style={styles.settingsSwitchRow}>
            <View style={styles.settingsSwitchCopy}>
              <Text style={styles.settingsLabel}>Показывать добавленную музыку</Text>
              <Text style={styles.settingsHint}>Треки и релизы, добавленные из музыкальных сервисов.</Text>
            </View>
            <VolnaSwitch
              accessibilityLabel="Показывать добавленную музыку в профиле"
              onValueChange={(value) => {
                setShowSavedMusicOnProfile(value);
                void saveSettings(messagePrivacy, readReceiptsPrivacy, isInvisibleMode, value, showUploadedMusicOnProfile);
              }}
              value={showSavedMusicOnProfile}
            />
          </View>
          <View style={styles.settingsDivider} />
          <View style={styles.settingsSwitchRow}>
            <View style={styles.settingsSwitchCopy}>
              <Text style={styles.settingsLabel}>Показывать загруженную музыку</Text>
              <Text style={styles.settingsHint}>Треки, загруженные вами в VOLNA.</Text>
            </View>
            <VolnaSwitch
              accessibilityLabel="Показывать загруженную музыку в профиле"
              onValueChange={(value) => {
                setShowUploadedMusicOnProfile(value);
                void saveSettings(messagePrivacy, readReceiptsPrivacy, isInvisibleMode, showSavedMusicOnProfile, value);
              }}
              value={showUploadedMusicOnProfile}
            />
          </View>
        </View>

        <Text style={[styles.settingsSectionTitle, styles.settingsSectionTitleSpaced]}>Конфиденциальность</Text>
        <View style={styles.settingsCard}>
          <Text style={styles.settingsLabel}>Кто может мне писать</Text>
          <AnimatedSegmentedControl accessibilityLabel="Кто может мне писать" containerStyle={styles.privacySegment} onChange={(value) => { setMessagePrivacy(value); void saveSettings(value, readReceiptsPrivacy, isInvisibleMode); }} options={messagePrivacyOptions} value={messagePrivacy} />
          <View style={styles.settingsDivider} />
          <Text style={styles.settingsLabel}>Кто может видеть статус мною прочитанных сообщений</Text>
          <AnimatedSegmentedControl accessibilityLabel="Кто может видеть статус мною прочитанных сообщений" containerStyle={styles.privacySegment} onChange={(value) => { setReadReceiptsPrivacy(value); void saveSettings(messagePrivacy, value, isInvisibleMode); }} options={privacyOptions} value={readReceiptsPrivacy} />
          <View style={styles.settingsDivider} />
          <Text style={styles.settingsLabel}>Кто видит мой возраст в Коннекте</Text>
          <AnimatedSegmentedControl
            accessibilityLabel="Кто видит мой возраст в Коннекте"
            containerStyle={styles.privacySegment}
            onChange={(value) => {
              const nextShowBirthYear = value === 'everyone';
              setShowBirthYear(nextShowBirthYear);
              void saveSettings(
                messagePrivacy,
                readReceiptsPrivacy,
                isInvisibleMode,
                showSavedMusicOnProfile,
                showUploadedMusicOnProfile,
                nextShowBirthYear,
              );
            }}
            options={[
              { label: 'Никто', value: 'nobody' },
              { label: 'Все', value: 'everyone' },
            ]}
            value={showBirthYear ? 'everyone' : 'nobody'}
          />
        </View>

        <Text style={[styles.settingsSectionTitle, styles.settingsSectionTitleSpaced]}>Активность</Text>
        <View style={styles.settingsCard}>
          <View style={styles.settingsSwitchRow}>
            <View style={styles.settingsSwitchCopy}>
              <Text style={styles.settingsLabel}>Режим невидимка</Text>
              <Text style={styles.settingsHint}>Скрывать ваше присутствие и активность в приложении.</Text>
            </View>
            <VolnaSwitch
              accessibilityLabel="Режим невидимка"
              onValueChange={(value) => {
                setIsInvisibleMode(value);
                void saveSettings(messagePrivacy, readReceiptsPrivacy, value);
              }}
              value={isInvisibleMode}
            />
          </View>
          {isSaving ? <Text style={styles.settingsSaving}>Сохраняем...</Text> : null}
        </View>
      </ScrollView>
    </>
  );
}

export function PasswordSecurityScreen({
  forced = false,
  onBack,
  onChangePassword,
  onOpenMessageSecurity,
}: {
  forced?: boolean;
  onBack: () => void;
  onChangePassword: (data: { currentPassword: string; newPassword: string }) => Promise<void>;
  onOpenMessageSecurity?: () => void;
}) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [repeatPassword, setRepeatPassword] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const submit = async () => {
    const current = currentPassword;
    const next = newPassword;
    const repeat = repeatPassword;

    setError(null);
    setSuccess(null);

    if (current.length < 6) {
      setError('Введите текущий пароль');
      return;
    }

    if (next.length < 6) {
      setError('Новый пароль должен быть минимум 6 символов');
      return;
    }

    if (getPasswordStrength(next) === 'low') {
      setError('Выберите пароль средней или высокой надёжности');
      return;
    }

    if (next === current) {
      setError('Новый пароль должен отличаться от текущего');
      return;
    }

    if (next !== repeat) {
      setError('Пароли не совпадают');
      return;
    }

    setIsSaving(true);

    try {
      await onChangePassword({ currentPassword: current, newPassword: next });
      setCurrentPassword('');
      setNewPassword('');
      setRepeatPassword('');
      setSuccess('Пароль обновлен');
    } catch (changeError) {
      reportApiError(changeError instanceof Error ? changeError.message : 'Не удалось поменять пароль');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <View style={styles.topBar}>
        <View style={styles.topBarLeft}>
          {!forced ? <Pressable onPress={onBack} style={styles.topBarIconButton}>
            <ChevronLeft size={29} color="#090909" strokeWidth={2.1} />
          </Pressable> : null}
          <Text style={styles.topBarTitle}>{forced ? 'Создайте постоянный пароль' : 'Пароль и безопасность'}</Text>
        </View>
      </View>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.securityShell}>
        <ScrollView contentContainerStyle={styles.settingsContent} showsVerticalScrollIndicator={false}>
          <Text style={styles.settingsSectionTitle}>{forced ? 'Вы вошли по временному паролю. Перед продолжением замените его своим.' : 'Смена пароля'}</Text>
          <View style={styles.settingsCard}>
            <TextInput
              autoCapitalize="none"
              onChangeText={setCurrentPassword}
              placeholder="Текущий пароль"
              placeholderTextColor="#98a3ae"
              secureTextEntry
              style={styles.passwordField}
              value={currentPassword}
            />
            <View style={styles.passwordFieldSeparator} />
            <TextInput
              autoCapitalize="none"
              onChangeText={(value) => setNewPassword(normalizeAsciiPassword(value))}
              placeholder="Новый пароль"
              placeholderTextColor="#98a3ae"
              secureTextEntry
              style={styles.passwordField}
              value={newPassword}
            />
            <PasswordStrengthIndicator password={newPassword} />
            <View style={styles.passwordFieldSeparator} />
            <TextInput
              autoCapitalize="none"
              onChangeText={(value) => setRepeatPassword(normalizeAsciiPassword(value))}
              placeholder="Повторите новый пароль"
              placeholderTextColor="#98a3ae"
              secureTextEntry
              style={styles.passwordField}
              value={repeatPassword}
            />
            <Text style={styles.settingsHint}>Минимум 6 символов, включая латинскую букву и цифру. Остальные сессии будут завершены.</Text>
            {error ? <Text style={styles.settingsError}>{error}</Text> : null}
            {success ? <Text style={styles.settingsSuccess}>{success}</Text> : null}
            <Pressable
              disabled={isSaving || getPasswordStrength(newPassword) === 'low'}
              onPress={submit}
              style={[styles.saveProfileButton, styles.saveProfileButtonSpacing, (isSaving || getPasswordStrength(newPassword) === 'low') && styles.disabledButton]}
            >
              {isSaving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveProfileText}>Сохранить пароль</Text>}
            </Pressable>
          </View>
          {!forced && onOpenMessageSecurity ? (
            <>
              <Text style={[styles.settingsSectionTitle, styles.settingsSectionTitleSpaced]}>Сообщения</Text>
              <Pressable
                accessibilityHint="Устройства, перенос и ключ восстановления"
                onPress={onOpenMessageSecurity}
                style={[styles.settingsCard, { alignItems: 'center', flexDirection: 'row', gap: 12, minHeight: 76 }]}
              >
                <View style={{ alignItems: 'center', backgroundColor: '#f0f1f3', borderRadius: 19, height: 38, justifyContent: 'center', width: 38 }}>
                  <ShieldCheck color="#111" size={21} strokeWidth={1.8} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.settingsLabel}>Защищённые сообщения</Text>
                  <Text style={styles.settingsHint}>Устройства, перенос истории и ключ восстановления</Text>
                </View>
                <ChevronRight color="#7b848d" size={21} />
              </Pressable>
            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

