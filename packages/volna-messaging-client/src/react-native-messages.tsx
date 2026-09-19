import { AppSheetModal } from './app-sheet';
import { TouchActionSelectionStyles } from './touch-action-selection';
import { randomUUID } from 'expo-crypto';
import { createMessageSendAttempt } from './message-send-attempt';
import { publicPageTypeLabels } from './community-labels';
import { ScreenTopBar as Header, topBarStyles } from './screen-top-bar';
import { SearchField, searchFieldStyles } from './search-field';
import { LoadingIndicator } from './loading';
import { MotionDisclosure, useReducedMotion } from './ui-motion';
import { useWebChatViewport } from './web-chat-viewport';
import { isAppForeground, subscribeAppActivity } from './app-activity';
import { useChatActivity } from './use-chat-activity';
import { formatPresence } from './chat-activity.mjs';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { getMusicAvailability, musicAvailabilityIdentity, musicUnavailableLabel, subscribeMusicAvailability } from './music-availability';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { Image as ExpoImage } from 'expo-image';
import * as Location from 'expo-location';
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Disc3,
  LockKeyhole,
  MapPin,
  MessageSquare,
  Ellipsis,
  Paperclip,
  Pause,
  Play,
  Search,
  Send,
  ShieldAlert,
  SquarePen,
  UserRound,
  UsersRound,
  X,
  KeyRound,
} from 'lucide-react-native';
import {
  createElement,
  createContext,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  Alert,
  Animated,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  PanResponder,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type GestureResponderEvent,
  type StyleProp,
  type TextStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import {
  messagePreview,
  messagingSurfaceErrorMessage,
  type MessagingAttachment,
  type MessagingMessage,
  type MessagingPartner,
  type MessagingSurfaceController,
  type MessagingThread,
  type MessagingThreadListPage,
} from './messaging-surface-controller.mjs';
import type { MatrixDeviceSecurity, MatrixRoomSecurity, MatrixVerificationState } from './matrix-engine';
import { matrixQrPayload } from './matrix-qr-payload.mjs';
import { MatrixSecurityFlow } from './matrix-security-flow';
import { isActiveMatrixVerification, matrixSecurityErrorMessage, matrixSecurityOverview, selectMatrixVerification } from './matrix-security-presentation.mjs';
import { safeHttpsUrl, trustedPublicMediaUrl } from './media-policy.mjs';

const VERIFIED_BADGE_PATH = 'M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.854-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.688-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.634.433 1.218.877 1.688.47.443 1.054.747 1.687.878.633.132 1.29.084 1.897-.136.274.586.705 1.084 1.246 1.439.54.354 1.17.551 1.816.569.647-.016 1.276-.213 1.817-.567s.972-.854 1.245-1.44c.604.239 1.266.296 1.903.164.636-.132 1.22-.447 1.68-.907.46-.46.776-1.044.908-1.681s.075-1.299-.165-1.903c.586-.274 1.084-.705 1.439-1.246.354-.54.551-1.17.569-1.816zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z';
const REACTIONS = ['❤️', '👍', '🔥', '😂', '😮', '😢'];
const SEARCH_DELAY_MS = 1_000;

function errorCode(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : null;
}

function VerifiedName({ isVerified, name, inverted = false, style }: { isVerified?: boolean; name: string; inverted?: boolean; style?: StyleProp<TextStyle> }) {
  return <View style={ui.verifiedRow}>
    <Text numberOfLines={1} style={[style, ui.verifiedName]}>{name}</Text>
    {isVerified ? <Svg accessibilityLabel="Подтверждённый аккаунт" height={19} role="img" viewBox="0 0 22 22" width={19}><Path d={VERIFIED_BADGE_PATH} fill={inverted ? '#fff' : '#111'} fillRule="evenodd" /></Svg> : null}
  </View>;
}

export function Avatar({ partner, size = 44, online = false }: { partner: Pick<MessagingPartner, 'avatarUrl' | 'name'>; size?: number; online?: boolean }) {
  const frame = { width: size, height: size, borderRadius: size / 2 };
  const avatarUrl = trustedPublicMediaUrl(partner.avatarUrl);
  return <View style={frame}><View style={[ui.avatar, frame]}>
    {avatarUrl
      ? <ExpoImage cachePolicy="memory-disk" contentFit="cover" source={{ uri: avatarUrl }} style={frame} />
      : <Text style={ui.avatarInitial}>{partner.name.slice(0, 1).toUpperCase()}</Text>}
  </View>{online ? <View accessibilityLabel="Онлайн" style={ui.onlineDot} /> : null}</View>;
}

function Sheet({ children, isVisible, onClose, title, bodyRef, touchActionMenu = false }: { children: ReactNode; isVisible: boolean; onClose: () => void; title: string; bodyRef?: RefObject<ScrollView | null>; touchActionMenu?: boolean }) {
  return <AppSheetModal isVisible={isVisible} onClose={onClose} title={title} touchActionMenu={touchActionMenu} scroll bodyRef={bodyRef} contentContainerStyle={ui.sheetBody}>{children}</AppSheetModal>;
}

export function MessagesEmptyState({ error, loading, onRetry, search }: { error?: string | null; loading?: boolean; onRetry?: () => void; search?: boolean }) {
  if (loading) return <View style={ui.empty}><LoadingIndicator /><Text style={ui.emptyText}>Загружаем диалоги…</Text></View>;
  return <View style={ui.empty}>
    <MessageSquare color="#7d8894" size={29} />
    <Text style={ui.emptyTitle}>{error ? 'Не удалось загрузить сообщения' : search ? 'Ничего не найдено' : 'Сообщений пока нет'}</Text>
    <Text style={ui.emptyText}>{error ?? (search ? 'Попробуйте изменить поисковый запрос.' : 'Начните диалог с человеком из VOLNA.')}</Text>
    {error && onRetry ? <Pressable accessibilityRole="button" onPress={onRetry} style={ui.secondaryButton}><Text style={ui.secondaryButtonText}>Повторить</Text></Pressable> : null}
  </View>;
}

export function VolnaMessagesScreen(props: Parameters<typeof MessagesScreenContent>[0]) {
  return <MessagesScreenContent key={props.accountId} {...props} />;
}

function MessagesScreenContent({
  accountId,
  controller,
  onActivity,
  onOpenChat,
  onOpenMenu,
  onOpenNotifications,
  ownUsername,
}: {
  accountId: string;
  controller: MessagingSurfaceController;
  onActivity?: () => void;
  onBack: () => void;
  onOpenChat: (username: string) => void | Promise<void>;
  onOpenMenu?: () => void;
  onOpenNotifications?: () => void;
  ownUsername: string;
}) {
  const [snapshot] = useState(() => controller.getThreadListSnapshot(accountId));
  const [threads, setThreads] = useState<MessagingThread[]>(() => snapshot?.items ?? []);
  const [chatStateRevision, setChatStateRevision] = useState(0);
  const activity = useChatActivity(controller, accountId, threads.map(t => t.id), chatStateRevision);
  const [query, setQuery] = useState('');
  const [localMatchThreadIds, setLocalMatchThreadIds] = useState<Set<string>>(() => new Set());
  const [nextCursor, setNextCursor] = useState<string | null>(snapshot?.nextCursor ?? null);
  const [loading, setLoading] = useState(!snapshot);
  const [hydrating, setHydrating] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [newMessageOpen, setNewMessageOpen] = useState(false);
  const [deleteThread, setDeleteThread] = useState<MessagingThread | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deleteRunning = useRef(false);
  const deleteAttempt = useRef(createMessageSendAttempt(() => randomUUID()));
  const selectDeletion = (thread: MessagingThread) => {
    deleteAttempt.current.clear(); setDeleteError(null); setDeleteThread(thread);
  };
  const removeThread = async (scope: 'self' | 'everyone') => {
    if (!deleteThread || deleteRunning.current) return;
    deleteRunning.current = true; setDeleteBusy(true); setDeleteError(null);
    try {
      await controller.deleteContent(accountId, deleteThread, { scope,
        operationId: deleteAttempt.current.get(`${accountId}:${deleteThread.id}`, { scope }) });
      setThreads(current => current.filter(thread => thread.id !== deleteThread.id));
      setDeleteThread(null); deleteAttempt.current.clear(); onActivity?.(); load(true);
    } catch (error) { setDeleteError(messagingSurfaceErrorMessage(error)); }
    finally { deleteRunning.current = false; setDeleteBusy(false); }
  };
  const loadRef = useRef<Promise<void> | null>(null);
  const runLoadRef = useRef<(reset: boolean) => void>(() => undefined);
  const onActivityRef = useRef(onActivity);
  onActivityRef.current = onActivity;
  const load = useCallback((reset = true) => runLoadRef.current(reset), []);
  useEffect(() => {
    let dispose: (() => void) | undefined;
    let active = true;
    let cursor: string | null = snapshot?.nextCursor ?? null;
    let reloadQueued = false;
    const abort = new AbortController();
    const runLoad = (reset: boolean) => {
      if (!active) return;
      if (loadRef.current) {
        // A realtime update during initial crypto sync must be replayed once.
        if (reset) reloadQueued = true;
        return;
      }
      if (!reset && !cursor) return;
      setHydrating(true);
      if (reset) setLoadError(null);
      else setLoadingMore(true);
      const applyPage = (page: MessagingThreadListPage) => {
        if (!active) return;
        setThreads((current) => {
          if (reset) return page.items;
          const updates = new Map(page.items.map((item) => [item.id, item]));
          return [...current.map((item) => updates.get(item.id) ?? item), ...page.items.filter((item) => !current.some((stored) => stored.id === item.id))];
        });
        cursor = page.nextCursor;
        setNextCursor(cursor);
        setLoading(false);
        setRefreshing(false);
      };
      const work = controller.listThreads(accountId, { cursor: reset ? null : cursor, signal: abort.signal, onInitialPage: applyPage })
        .then(applyPage)
        .catch((error) => {
          if (!active) return;
          setLoadError(messagingSurfaceErrorMessage(error));
          if (error instanceof Error && 'code' in error && error.code === 'thread_list_access_revoked') {
            setThreads([]);
            cursor = null;
            setNextCursor(null);
            return;
          }
          setThreads((current) => current.map((item) => item.previewPending && !item.previewAvailable ? { ...item, lastMessageText: null } : item));
        })
        .finally(() => {
          if (loadRef.current === work) loadRef.current = null;
          if (!active) return;
          setHydrating(false);
          setLoading(false);
          setLoadingMore(false);
          setRefreshing(false);
          if (reloadQueued) { reloadQueued = false; runLoad(true); }
        });
      loadRef.current = work;
    };
    runLoadRef.current = runLoad;
    runLoad(true);
    const releaseActivity = subscribeAppActivity(() => { if (isAppForeground()) runLoad(true); });
    void controller.subscribeRealtime({ accountId, onChatStateUpdated: () => setChatStateRevision(value => value + 1), onActivity: () => onActivityRef.current?.(), onEncryptedEnvelope: () => runLoad(true), onThreadUpdated: () => runLoad(true) }).then((cleanup) => {
      if (active) dispose = cleanup;
      else cleanup();
    }).catch(() => undefined);
    return () => { active = false; abort.abort(); loadRef.current = null; dispose?.(); releaseActivity(); };
  }, [accountId, controller, snapshot]);

  const normalized = query.trim().toLocaleLowerCase('ru-RU');
  useEffect(() => {
    if (normalized.normalize('NFKC').length < 2) { setLocalMatchThreadIds(new Set()); return; }
    let active = true;
    const timer = setTimeout(() => {
      void controller.searchLocalMessages(accountId, normalized).then((results) => {
        if (active) setLocalMatchThreadIds(new Set(results.map((result) => result.threadId)));
      }).catch(() => { if (active) setLocalMatchThreadIds(new Set()); });
    }, 180);
    return () => { active = false; clearTimeout(timer); };
  }, [accountId, controller, normalized]);
  const unresolvedLocalMatch = useMemo(() => (
    [...localMatchThreadIds].some((threadId) => !threads.some((thread) => thread.id === threadId))
  ), [localMatchThreadIds, threads]);
  useEffect(() => {
    if (unresolvedLocalMatch && nextCursor && !loading && !hydrating && !loadingMore && !loadRef.current) {
      void load(false);
    }
  }, [hydrating, load, loading, loadingMore, nextCursor, unresolvedLocalMatch]);
  const visibleThreads = useMemo(() => normalized ? threads.filter((thread) => (
    `${thread.partner.name} ${thread.partner.username} ${thread.lastMessageText ?? ''}`.toLocaleLowerCase('ru-RU').includes(normalized)
    || localMatchThreadIds.has(thread.id)
  )) : threads, [localMatchThreadIds, normalized, threads]);

  return <View style={ui.screen}>
    <TouchActionSelectionStyles />
    <Header onOpenMenu={onOpenMenu} onOpenNotifications={onOpenNotifications} onOpenMessages={() => load(true)} title="Сообщения" />
    <View style={[searchFieldStyles.toolbar, ui.threadToolbar]}>
      <SearchField accessibilityLabel="Поиск по сообщениям" onChangeText={setQuery} onClear={() => setQuery('')} placeholder="Поиск" style={{ flex: 1 }} value={query} />
      <Pressable accessibilityLabel="Новое сообщение" accessibilityRole="button" onPress={() => setNewMessageOpen(true)} style={ui.composeButton}><SquarePen color="#111" size={23} /></Pressable>
    </View>
    <FlatList
      contentContainerStyle={visibleThreads.length ? ui.threadList : ui.threadListEmpty}
      data={visibleThreads}
      keyExtractor={(item) => item.id}
      ListEmptyComponent={<MessagesEmptyState error={loadError} loading={loading} onRetry={() => void load(true)} search={Boolean(normalized)} />}
      ListFooterComponent={loadingMore ? <LoadingIndicator style={ui.footerLoader} /> : loadError && threads.length ? <Pressable accessibilityRole="button" onPress={() => load(true)} style={ui.secondaryButton}><Text style={ui.secondaryButtonText}>Повторить обновление</Text></Pressable> : null}
      onEndReached={() => { if (nextCursor && !loadingMore) void load(false); }}
      onEndReachedThreshold={0.35}
      refreshControl={<RefreshControl onRefresh={() => { setRefreshing(true); void load(true); }} refreshing={refreshing} tintColor="#111" />}
      renderItem={({ item }) => <Pressable accessibilityLabel={`Открыть чат с ${item.partner.name}`} accessibilityRole="button"
        accessibilityActions={[{ name: 'longpress', label: 'Удалить переписку' }]}
        onAccessibilityAction={event => { if (event.nativeEvent.actionName === 'longpress') selectDeletion(item); }}
        onLongPress={() => selectDeletion(item)}
        {...(Platform.OS === 'web' ? { dataSet: { 'volna-touch-action': 'true' }, onContextMenu: (event: { preventDefault(): void }) => { event.preventDefault(); selectDeletion(item); },
          onKeyDown: (event: { key: string; shiftKey: boolean; repeat: boolean; preventDefault(): void; stopPropagation(): void }) => {
            if (!event.repeat && (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) { event.preventDefault(); event.stopPropagation(); selectDeletion(item); }
          } } : {})}
        onPress={() => void onOpenChat(item.partner.username)} style={ui.threadRow}>
        <Avatar partner={item.partner} online={(activity.state[item.id]?.presence?.onlineUntil ?? 0) > activity.clock} />
        <View style={ui.threadCopy}>
          <View style={ui.threadHeader}><View style={ui.threadNameLine}><VerifiedName isVerified={item.partner.isVerified} name={item.partner.name} style={ui.threadName} /><Text numberOfLines={1} style={ui.threadUsername}>@{item.partner.username}</Text></View><Text style={ui.threadTime}>{formatChatTime(item.lastMessageAt)}</Text></View>
          <View style={ui.threadMeta}><Text numberOfLines={1} style={ui.threadPreview}>{item.lastMessageText || (item.previewPending && !item.previewAvailable ? loadError ? 'Не удалось обновить сообщения' : 'Обновление сообщений…' : 'Чат создан')}</Text>{!item.previewPending && item.encryptionMode !== 'E2EE_PENDING' ? <LockKeyhole color="#6f7b86" size={13} /> : null}{item.unreadCount > 0 ? <View style={ui.unreadBadge}><Text style={ui.unreadText}>{item.unreadCount > 99 ? '99+' : item.unreadCount}</Text></View> : null}</View>
        </View>
      </Pressable>}
      showsVerticalScrollIndicator={false}
    />
    <NewMessageSheet controller={controller} isVisible={newMessageOpen} onClose={() => setNewMessageOpen(false)} onOpenChat={onOpenChat} ownUsername={ownUsername} />
    <DeletionSheet isVisible={Boolean(deleteThread)} message={false} busy={deleteBusy} error={deleteError}
      onClose={() => { if (!deleteRunning.current) setDeleteThread(null); }} onDelete={scope => void removeThread(scope)} />
  </View>;
}

export function DeletionSheet({ isVisible, message, busy, error, onClose, onDelete }: {
  isVisible: boolean; message: boolean; busy: boolean; error: string | null;
  onClose(): void; onDelete(scope: 'self' | 'everyone'): void;
}) {
  return <Sheet touchActionMenu isVisible={isVisible} onClose={onClose} title={message ? 'Удалить сообщение?' : 'Удалить переписку?'}>
    <Text style={ui.hint}>{message ? 'Удалить только у вас или также у собеседника? Отменить удаление нельзя.' : 'Все сообщения этой переписки будут удалены только у вас или у обоих участников. Новые сообщения останутся доступны. Отменить удаление нельзя.'}</Text>
    {error ? <Text accessibilityRole="alert" style={ui.hint}>{error}</Text> : null}
    {busy ? <LoadingIndicator /> : null}
    <Pressable accessibilityRole="button" disabled={busy} onPress={() => onDelete('self')} style={ui.sheetAction}><Text style={ui.sheetActionText}>Удалить у меня</Text></Pressable>
    <Pressable accessibilityRole="button" disabled={busy} onPress={() => onDelete('everyone')} style={ui.sheetAction}><Text style={ui.sheetActionText}>Удалить у всех</Text></Pressable>
    <Pressable accessibilityRole="button" disabled={busy} onPress={onClose} style={ui.sheetAction}><Text style={ui.sheetActionText}>Отмена</Text></Pressable>
  </Sheet>;
}

function NewMessageSheet({ controller, isVisible, onClose, onOpenChat, ownUsername }: { controller: MessagingSurfaceController; isVisible: boolean; onClose: () => void; onOpenChat: (username: string) => void | Promise<void>; ownUsername: string }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MessagingPartner[]>([]);
  const [loading, setLoading] = useState(false);
  const normalized = query.trim().replace(/^@/, '');
  useEffect(() => {
    if (!isVisible || normalized.length < 3) { setResults([]); setLoading(false); return; }
    let active = true;
    const timer = setTimeout(() => {
      setLoading(true);
      void controller.searchProfiles(normalized).then((items) => { if (active) setResults(items.filter((item) => item.username !== ownUsername)); }).catch(() => { if (active) setResults([]); }).finally(() => { if (active) setLoading(false); });
    }, SEARCH_DELAY_MS);
    return () => { active = false; clearTimeout(timer); };
  }, [controller, isVisible, normalized, ownUsername]);
  useEffect(() => { if (!isVisible) { setQuery(''); setResults([]); } }, [isVisible]);
  return <Sheet isVisible={isVisible} onClose={onClose} title="Новое сообщение">
    <View style={ui.searchField}><Search color="#7d8894" size={19} /><TextInput autoCapitalize="none" autoFocus onChangeText={setQuery} placeholder="Имя или @юзернейм" placeholderTextColor="#98a3ae" style={ui.searchInput} value={query} /></View>
    {loading ? <LoadingIndicator style={ui.sheetLoader} /> : results.map((profile) => <Pressable key={profile.id} onPress={() => { onClose(); void onOpenChat(profile.username); }} style={ui.personRow}><Avatar partner={profile} /><View style={ui.personCopy}><VerifiedName isVerified={profile.isVerified} name={profile.name} style={ui.personName} /><Text style={ui.personUsername}>@{profile.username}</Text></View></Pressable>)}
    {!loading && normalized.length > 0 && normalized.length < 3 ? <Text style={ui.hint}>Введите минимум 3 символа</Text> : null}
    {!loading && normalized.length >= 3 && !results.length ? <Text style={ui.hint}>Пользователи не найдены</Text> : null}
  </Sheet>;
}

type AudioContextValue = {
  activeId: string | null;
  artworkUrl: (attachment: Extract<MessagingAttachment, { kind: 'music' }>) => string | null;
  duration: number;
  loading: boolean;
  playing: boolean;
  progress: number;
  seek: (progress: number) => Promise<void>;
  toggle: (id: string, attachment: Extract<MessagingAttachment, { kind: 'music' }>) => Promise<void>;
};
const AudioContext = createContext<AudioContextValue | null>(null);

function MessagingAudioProvider({ children, controller, visibleMessageIds }: { children: ReactNode; controller: MessagingSurfaceController; visibleMessageIds: string[] }) {
  const player = useAudioPlayer(null, { updateInterval: 250 });
  const status = useAudioPlayerStatus(player);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [playbackIntent, setPlaybackIntent] = useState(false);
  const activeIdRef = useRef<string | null>(null);
  const loadedUrlRef = useRef<string | null>(null);
  const playbackIntentRef = useRef(false);
  const playbackRequestRef = useRef(0);
  const statusOwnerIdRef = useRef<string | null>(null);
  const transitioningRequestRef = useRef<number | null>(null);
  const toggle = useCallback(async (id: string, attachment: Extract<MessagingAttachment, { kind: 'music' }>) => {
    const resolved = controller.resolveMusicPlayback(attachment);
    const previewUrl = safeHttpsUrl(resolved.previewUrl);
    const externalUrl = safeHttpsUrl(resolved.externalUrl);
    if (activeIdRef.current === id && playbackIntentRef.current) {
      playbackRequestRef.current += 1;
      transitioningRequestRef.current = null;
      playbackIntentRef.current = false;
      setPlaybackIntent(false);
      setLoading(false);
      player.pause();
      return;
    }
    if (!previewUrl) {
      if (externalUrl) await Linking.openURL(externalUrl);
      else Alert.alert('Музыка', 'Для этого трека нет доступного аудиопотока или внешней ссылки.');
      return;
    }
    const requestId = ++playbackRequestRef.current;
    void controller.checkMusicAvailabilityForPlayback(attachment).then((availability) => {
      const label = musicUnavailableLabel(availability, attachment.provider);
      if (!label || playbackRequestRef.current !== requestId) return;
      playbackRequestRef.current += 1;
      player.pause(); playbackIntentRef.current = false;
      setPlaybackIntent(false); setLoading(false);
      Alert.alert('Музыка', label);
    });
    transitioningRequestRef.current = requestId;
    activeIdRef.current = id;
    playbackIntentRef.current = true;
    setActiveId(id);
    setPlaybackIntent(true);
    setLoading(true);
    try {
      const webMedia = Platform.OS === 'web'
        ? (player as unknown as { media?: HTMLAudioElement }).media
        : undefined;
      if (loadedUrlRef.current !== previewUrl) {
        player.pause();
        if (webMedia) {
          webMedia.src = previewUrl;
          webMedia.setAttribute('playsinline', '');
          webMedia.load();
        } else {
          player.replace({ uri: previewUrl });
        }
        loadedUrlRef.current = previewUrl;
      }
      if (webMedia) await webMedia.play();
      else player.play();
      if (requestId !== playbackRequestRef.current || activeIdRef.current !== id) return;
      if (webMedia) {
        statusOwnerIdRef.current = id;
        transitioningRequestRef.current = null;
        setLoading(false);
      }
    } catch {
      if (requestId !== playbackRequestRef.current || activeIdRef.current !== id) return;
      transitioningRequestRef.current = null;
      player.pause();
      playbackIntentRef.current = false;
      setPlaybackIntent(false);
      setLoading(false);
      activeIdRef.current = null;
      statusOwnerIdRef.current = null;
      setActiveId(null);
      loadedUrlRef.current = null;
      if (externalUrl) {
        await Linking.openURL(externalUrl).catch(() => {
          Alert.alert('Музыка', 'Не удалось открыть аудиопоток или страницу трека.');
        });
      } else {
        Alert.alert('Музыка', 'Не удалось воспроизвести этот аудиопоток.');
      }
    }
  }, [controller, player]);
  useEffect(() => {
    if (!activeIdRef.current || visibleMessageIds.includes(activeIdRef.current)) return;
    ++playbackRequestRef.current;
    activeIdRef.current = null; statusOwnerIdRef.current = null; loadedUrlRef.current = null;
    transitioningRequestRef.current = null; playbackIntentRef.current = false;
    setActiveId(null); setPlaybackIntent(false); setLoading(false);
    player.pause(); player.replace(null);
  }, [player, visibleMessageIds]);
  useEffect(() => {
    if (!playbackIntentRef.current || !activeIdRef.current) return;
    if (status.didJustFinish && transitioningRequestRef.current === null) {
      playbackIntentRef.current = false;
      setPlaybackIntent(false);
      setLoading(false);
      return;
    }
    if (status.isBuffering) setLoading(true);
    else if (status.playing) {
      statusOwnerIdRef.current = activeIdRef.current;
      transitioningRequestRef.current = null;
      setLoading(false);
    }
  }, [status.didJustFinish, status.isBuffering, status.playing]);
  useEffect(() => () => {
    playbackRequestRef.current += 1;
    playbackIntentRef.current = false;
    player.pause();
  }, [player]);
  const statusMatchesActiveTrack = Boolean(activeId && statusOwnerIdRef.current === activeId);
  const duration = statusMatchesActiveTrack && Number.isFinite(Number(status.duration)) && Number(status.duration) > 0 ? Number(status.duration) : 0;
  const currentTime = Number.isFinite(Number(status.currentTime)) ? Math.max(0, Number(status.currentTime)) : 0;
  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0;
  const seek = useCallback(async (nextProgress: number) => {
    if (!activeIdRef.current || !Number.isFinite(nextProgress)) return;
    const webMedia = Platform.OS === 'web'
      ? (player as unknown as { media?: HTMLAudioElement }).media
      : undefined;
    const mediaDuration = webMedia && Number.isFinite(webMedia.duration) && webMedia.duration > 0
      ? webMedia.duration
      : duration;
    if (mediaDuration <= 0) return;
    const nextTime = Math.min(mediaDuration, Math.max(0, nextProgress) * mediaDuration);
    if (webMedia) webMedia.currentTime = nextTime;
    else await player.seekTo(nextTime);
  }, [duration, player]);
  const artworkUrl = useCallback((attachment: Extract<MessagingAttachment, { kind: 'music' }>) => controller.resolveMusicArtwork(attachment), [controller]);
  return <AudioContext.Provider value={{ activeId, artworkUrl, duration, loading, playing: playbackIntent, progress, seek, toggle }}>{children}</AudioContext.Provider>;
}

export function ChatHistoryUnavailable({ onRecover }: { onRecover?: () => void }) {
  return <View accessibilityRole="alert" style={ui.matrixChatPrompt}><Text style={ui.matrixChatPromptTitle}>Часть истории недоступна на этом устройстве</Text><Text style={ui.matrixChatPromptText}>Некоторые сообщения пока не удалось расшифровать или проверить на этом устройстве. Если вы сменили устройство, подтвердите его на прежнем устройстве или используйте ранее сохранённый ключ восстановления. Без доступных ключей старую историю восстановить нельзя.</Text><Pressable accessibilityRole="button" onPress={onRecover} style={ui.matrixChatPromptButton}><Text style={ui.matrixChatPromptButtonText}>Восстановить доступ</Text></Pressable></View>;
}

export function ChatHistoryPagination({ busy, error, onLoad }: { busy: boolean; error?: boolean; onLoad(): void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={error ? 'Повторить загрузку истории' : 'Загрузить предыдущие сообщения'} accessibilityState={{ disabled: busy, busy }} disabled={busy} onPress={onLoad} style={ui.secondaryButton}>
    {busy ? <LoadingIndicator /> : <Text style={ui.secondaryButtonText}>{error ? 'Повторить загрузку истории' : 'Предыдущие сообщения'}</Text>}
  </Pressable>;
}

export function VolnaChatScreen(props: Parameters<typeof ChatScreenContent>[0]) {
  return <ChatScreenContent key={`${props.accountId}:${props.partnerUsername}`} {...props} />;
}

function ChatScreenContent({
  accountId,
  controller,
  composerAccessory,
  onActivity,
  onBack,
  onOpenEvent,
  onOpenMessageSecurity,
  onOpenProfile,
  onOpenPublicPage,
  partnerUsername,
}: {
  accountId: string;
  controller: MessagingSurfaceController;
  /** Host-owned UI above the composer; no message content or draft state is exposed. */
  composerAccessory?: ReactNode;
  onActivity?: () => void;
  onBack: () => void;
  onOpenEvent: (eventId: string) => void;
  onOpenMessageSecurity?: () => void;
  onOpenProfile: (username: string) => void | Promise<void>;
  onOpenPublicPage: (username: string) => void | Promise<void>;
  partnerUsername: string;
}) {
  const [thread, setThread] = useState<MessagingThread | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [syncError, setSyncError] = useState<unknown>(null);
  const [sendError, setSendError] = useState<unknown>(null);
  const [text, setText] = useState('');
  const [attachment, setAttachment] = useState<MessagingAttachment | null>(null);
  const [sending, setSending] = useState(false);
  const sendAttempt = useRef(createMessageSendAttempt(() => `message_${randomUUID().replaceAll('-', '')}`));
  const sendingRef = useRef(false);
  const [attachmentOpen, setAttachmentOpen] = useState(false);
  const [musicOpen, setMusicOpen] = useState(false);
  const [messageMenu, setMessageMenu] = useState<MessagingMessage | null>(null);
  const [chatMenuOpen, setChatMenuOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ messageId?: string } | null>(null);
  const [deletingMessage, setDeletingMessage] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deleting = useRef(false);
  const deleteAttempt = useRef(createMessageSendAttempt(() => randomUUID()));
  const [editing, setEditing] = useState<MessagingMessage | null>(null);
  const [customReaction, setCustomReaction] = useState('');
  const [matrixSecurityOpen, setMatrixSecurityOpen] = useState(false);
  const [matrixSecurityStart, setMatrixSecurityStart] = useState<'home' | 'devices' | 'partner' | 'recovery'>('home');
  const [matrixSecurity, setMatrixSecurity] = useState<MatrixRoomSecurity | null>(null);
  const [matrixSecurityLoading, setMatrixSecurityLoading] = useState(false);
  const [matrixRecoveryKey, setMatrixRecoveryKey] = useState('');
  const [matrixSecurityError, setMatrixSecurityError] = useState<string | null>(null);
  const [matrixSecurityReadError, setMatrixSecurityReadError] = useState<string | null>(null);
  const [matrixRecoveryCloseRequested, setMatrixRecoveryCloseRequested] = useState(false);
  const [matrixVerification, setMatrixVerification] = useState<MatrixVerificationState | null>(null);
  const [matrixScannerOpen, setMatrixScannerOpen] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const matrixScanLocked = useRef(false);
  const scrollRef = useRef<ScrollView>(null);
  const nearBottom = useRef(true);
  const openRevision = useRef(0);
  const historyBusy = useRef(false);
  const historyRefreshQueued = useRef(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState(false);
  const historyOffset = useRef(0);
  const historyRowY = useRef(new Map<string, number>());
  const historyRows = useRef(new Map<string, View>());
  const historyAnchor = useRef<{ id: string; y: number; offset: number } | null>(null);
  const historyScrollArmed = useRef(false);
  const reduceMotion = useReducedMotion();
  const safeAreaInsets = useSafeAreaInsets();
  const webViewport = useWebChatViewport(ui.composer.backgroundColor);

  useEffect(() => {
    if (Platform.OS === 'web') return undefined;
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSubscription = Keyboard.addListener(showEvent, () => setKeyboardVisible(true));
    const hideSubscription = Keyboard.addListener(hideEvent, () => setKeyboardVisible(false));
    return () => { showSubscription.remove(); hideSubscription.remove(); };
  }, []);

  const open = useCallback(async (allowActivation = true, showLoading = true) => {
    if (historyBusy.current && !showLoading) { historyRefreshQueued.current = true; return; }
    const revision = ++openRevision.current;
    if (showLoading) {
      setThread(null);
      setLoading(true);
      setLoadError(null);
    }
    try {
      const next = await controller.openThread(accountId, partnerUsername, { allowActivation, markRead: isAppForeground() && nearBottom.current });
      if (revision !== openRevision.current) return;
      setThread(next);
      setSyncError(null);
    }
    catch (error) {
      if (revision !== openRevision.current) return;
      if (showLoading) setLoadError(error);
      else setSyncError(error);
    }
    finally { if (revision === openRevision.current) setLoading(false); }
  }, [accountId, controller, partnerUsername]);
  const loadEarlier = async () => {
    if (!thread?.hasMoreHistory || historyBusy.current) return;
    historyBusy.current = true;
    historyScrollArmed.current = false;
    nearBottom.current = false;
    const revision = ++openRevision.current;
    const first = thread.messages[0];
    const anchor = first && historyRowY.current.has(first.id)
      ? { id: first.id, y: historyRowY.current.get(first.id)!, offset: historyOffset.current } : null;
    setHistoryLoading(true); setHistoryError(false);
    try {
      // Reopening explicitly loads one bounded SDK page and rechecks current
      // audience, room membership, authenticity and deletion metadata.
      const next = await controller.openThread(accountId, partnerUsername, { markRead: false, loadEarlier: true });
      if (revision !== openRevision.current) return;
      historyAnchor.current = next.messages.some(message => message.id === anchor?.id)
        && next.messages[0]?.id !== first?.id && anchor
        ? { ...anchor, offset: historyOffset.current } : null;
      setThread(next);
    } catch {
      if (revision === openRevision.current) setHistoryError(true);
    } finally {
      if (revision === openRevision.current) {
        historyBusy.current = false; setHistoryLoading(false);
        if (historyRefreshQueued.current) { historyRefreshQueued.current = false; void open(false, false); }
      }
    }
  };
  const [activityRevision, setActivityRevision] = useState(0);
  const [chatStateRevision, setChatStateRevision] = useState(0);
  const chatActivity = useChatActivity(controller, accountId, thread ? [thread.id] : [], chatStateRevision);
  const peerActivity = thread ? chatActivity.state[thread.id] : undefined;
  const presenceLabel = formatPresence(peerActivity?.presence, chatActivity.clock);
  useEffect(() => subscribeAppActivity(() => { setActivityRevision(value => value + 1); }), []);
  useEffect(() => { if (activityRevision && isAppForeground()) void open(false, false); }, [activityRevision, open]);
  const [readRevision, setReadRevision] = useState(0);
  const lastIncoming = thread?.messages.filter(message => message.senderAccountId !== accountId && message.securityMode === 'e2ee').at(-1);
  useEffect(() => {
    if (!thread || !lastIncoming || !isAppForeground() || !nearBottom.current) return;
    let active = true;
    void controller.markMessageRead(accountId, thread, lastIncoming.id).then(() => { if (active) onActivity?.(); })
      .catch(error => { if (active) setSyncError(error); });
    return () => { active = false; };
  }, [accountId, controller, thread?.id, lastIncoming?.id, activityRevision, readRevision]);
  useEffect(() => {
    historyBusy.current = false; historyRefreshQueued.current = false;
    historyAnchor.current = null; historyRowY.current.clear(); historyRows.current.clear();
    historyOffset.current = 0; historyScrollArmed.current = false;
    setHistoryLoading(false); setHistoryError(false);
    void open(true);
    return () => { openRevision.current++; historyAnchor.current = null; };
  }, [open]);

  useEffect(() => {
    if (!thread) return;
    let dispose: (() => void) | undefined;
    let active = true;
    void controller.subscribeRealtime({
      accountId,
      thread,
      onActivity,
      onChatStateUpdated: () => { if (active) setChatStateRevision(value => value + 1); },
      onReconnect: () => { if (active && isAppForeground()) void open(false, false); },
      onEncryptedEnvelope: (threadId) => { if (active && threadId === thread.id && isAppForeground()) void open(false, false); },
    }).then((cleanup) => { if (active) dispose = cleanup; else cleanup(); }).catch((error) => { if (active) setSyncError(error); });
    return () => { active = false; dispose?.(); };
  }, [accountId, controller, onActivity, open, thread?.id, thread?.encryptionMode]);

  const hasContent = Boolean(text.trim() || attachment);
  const beginDelete = (target: { messageId?: string }) => {
    setDeletingMessage(Boolean(target.messageId));
    setMessageMenu(null); setChatMenuOpen(false); setDeleteError(null);
    deleteAttempt.current.clear(); setDeleteTarget(target);
  };
  const removeContent = async (scope: 'self' | 'everyone') => {
    if (!thread || !deleteTarget || deleting.current) return;
    deleting.current = true; setDeleteBusy(true); setDeleteError(null);
    const operationId = deleteAttempt.current.get(`${accountId}:${thread.id}`, { ...deleteTarget, scope });
    try {
      const next = await controller.deleteContent(accountId, thread, { ...deleteTarget, scope, operationId });
      ++openRevision.current;
      setThread(next); setDeleteTarget(null); deleteAttempt.current.clear();
      if (editing && (!deleteTarget.messageId || editing.id === deleteTarget.messageId)) setEditing(null);
      onActivity?.();
      if (!deleteTarget.messageId) onBack();
    } catch (error) { setDeleteError(messagingSurfaceErrorMessage(error)); }
    finally { deleting.current = false; setDeleteBusy(false); }
  };
  const send = async () => {
    if (!thread || sendingRef.current) return;
    const trimmed = text.trim();
    if (editing) {
      if (!trimmed) return;
      sendingRef.current = true;
      setSending(true);
      setSendError(null);
      try { setThread({ ...thread, messages: await controller.editMessage(accountId, thread, editing.id, trimmed) }); setText(''); setEditing(null); }
      catch (error) { setSendError(error); }
      finally { sendingRef.current = false; setSending(false); }
      return;
    }
    if (!trimmed && !attachment) return;
    sendingRef.current = true;
    setSending(true);
    setSendError(null);
    try {
      const draft = { ...(trimmed ? { text: trimmed } : {}), ...(attachment ? { attachment } : {}) };
      const clientRequestId = sendAttempt.current.get(`${accountId}:${thread.id}`, draft);
      const messages = await controller.sendMessage(accountId, thread, { ...draft, clientRequestId });
      sendAttempt.current.clear();
      const last = messages.at(-1);
      setThread({ ...thread, messages, lastMessageAt: last?.createdAt ?? thread.lastMessageAt, lastMessageText: messagePreview(last) });
      setText('');
      setAttachment(null);
      onActivity?.();
    } catch (error) { setSendError(error); }
    finally { sendingRef.current = false; setSending(false); }
  };

  const react = async (message: MessagingMessage, emoji: string) => {
    if (!thread) return;
    try {
      const mine = message.reactions.find((reaction) => reaction.accountId === accountId)?.emoji ?? null;
      setThread({ ...thread, messages: await controller.reactToMessage(accountId, thread, message.id, emoji, mine) });
      setMessageMenu(null);
      setCustomReaction('');
    } catch (error) { Alert.alert('Сообщения', messagingSurfaceErrorMessage(error)); }
  };

  const matrixActionRunning = useRef(false);
  const matrixRefreshRunning = useRef(false);
  const matrixRefreshPaused = useRef(false);
  const matrixSecurityRevision = useRef(0);
  const matrixSecurityVisible = useRef(matrixSecurityOpen);
  const matrixSecurityScroll = useRef<ScrollView>(null);
  matrixSecurityVisible.current = matrixSecurityOpen;
  const refreshMatrixSecurity = useCallback(async () => {
    if (!thread || thread.encryptionMode !== 'MATRIX_V1' || matrixRefreshRunning.current || matrixActionRunning.current) return;
    matrixRefreshRunning.current = true;
    const revision = matrixSecurityRevision.current;
    try {
      const next = await controller.getMatrixRoomSecurity(accountId, thread);
      if (revision !== matrixSecurityRevision.current) return;
      matrixRefreshPaused.current = false;
      setMatrixSecurity(next);
      setMatrixVerification((current) => { const peer = (item: MatrixVerificationState) => next.partnerDevices.some(device => device.userId === item.otherUserId); return selectMatrixVerification({ ...next, pendingVerifications: next.pendingVerifications.filter(peer), verificationUpdates: next.verificationUpdates?.filter(peer) }, current && peer(current) ? current : null); });
      setMatrixSecurityReadError(null);
    } catch (error) {
      if (revision === matrixSecurityRevision.current) {
        matrixRefreshPaused.current = true;
        setMatrixSecurityReadError(matrixSecurityErrorMessage(error));
      }
    } finally {
      matrixRefreshRunning.current = false;
      if (revision === matrixSecurityRevision.current) setMatrixSecurityLoading(false);
    }
  }, [accountId, controller, thread?.id, thread?.encryptionMode]);
  useEffect(() => {
    if (!thread || thread.encryptionMode !== 'MATRIX_V1') return;
    matrixRefreshPaused.current = false;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (!matrixRefreshPaused.current) await refreshMatrixSecurity();
      if (active) timer = setTimeout(poll, matrixSecurityVisible.current ? 1_500 : 4_000);
    };
    void poll();
    return () => { active = false; clearTimeout(timer); matrixSecurityRevision.current += 1; };
  }, [refreshMatrixSecurity, thread?.id, thread?.encryptionMode]);
  const openMatrixSecurity = async (start: 'home' | 'devices' | 'partner' | 'recovery' = 'home') => {
    if (!thread || thread.encryptionMode !== 'MATRIX_V1') return;
    Keyboard.dismiss();
    setMatrixSecurityStart(start);
    setMatrixSecurityOpen(true);
    if (!matrixSecurity) setMatrixSecurityLoading(true);
    await refreshMatrixSecurity();
  };
  const closeMatrixSecurity = () => {
    if (matrixScannerOpen) { setMatrixScannerOpen(false); return; }
    if (matrixRecoveryKey || matrixActionRunning.current) { setMatrixRecoveryCloseRequested(true); return; }
    if (!isActiveMatrixVerification(matrixVerification)) setMatrixVerification(null);
    setMatrixSecurityOpen(false);
  };
  const runMatrixSecurityAction = async (action: () => Promise<MatrixVerificationState>) => {
    if (matrixActionRunning.current) return;
    matrixActionRunning.current = true;
    const revision = ++matrixSecurityRevision.current;
    setMatrixSecurityLoading(true);
    setMatrixSecurityError(null);
    try {
      const next = await action();
      if (revision === matrixSecurityRevision.current) setMatrixVerification(next);
    } catch (error) {
      if (revision === matrixSecurityRevision.current) setMatrixSecurityError(matrixSecurityErrorMessage(error));
    } finally {
      matrixActionRunning.current = false;
      if (revision === matrixSecurityRevision.current) setMatrixSecurityLoading(false);
    }
  };
  const startMatrixVerification = (device: MatrixDeviceSecurity) => {
    if (!thread || device.current) return;
    setMatrixSecurityOpen(true);
    void runMatrixSecurityAction(() => controller.startMatrixDeviceVerification(accountId, thread, device.userId, device.deviceId));
  };
  const setupMatrixRecovery = async (replaceExisting = false) => {
    if (matrixActionRunning.current || matrixRecoveryKey) return;
    matrixActionRunning.current = true;
    const revision = ++matrixSecurityRevision.current;
    setMatrixSecurityLoading(true);
    setMatrixSecurityError(null);
    try {
      const result = await (replaceExisting ? controller.resetMatrixRecovery(accountId) : controller.setupMatrixRecovery(accountId));
      if (revision === matrixSecurityRevision.current) setMatrixRecoveryKey(result.recoveryKey);
    } catch (error) {
      if (revision === matrixSecurityRevision.current) setMatrixSecurityError(matrixSecurityErrorMessage(error));
    } finally {
      matrixActionRunning.current = false;
      if (revision === matrixSecurityRevision.current) setMatrixSecurityLoading(false);
    }
  };
  const recoverMatrix = async (recoveryKey: string) => {
    if (!recoveryKey.trim() || matrixActionRunning.current) return false;
    matrixActionRunning.current = true;
    const revision = ++matrixSecurityRevision.current;
    setMatrixSecurityLoading(true);
    setMatrixSecurityError(null);
    try {
      await controller.recoverMatrixSecurity(accountId, recoveryKey);
      if (revision !== matrixSecurityRevision.current) return false;
      if (thread) {
        const next = await controller.getMatrixRoomSecurity(accountId, thread);
        if (revision !== matrixSecurityRevision.current) return false;
        setMatrixSecurity(next);
      }
      return true;
    } catch (error) {
      if (revision === matrixSecurityRevision.current) setMatrixSecurityError(matrixSecurityErrorMessage(error));
      return false;
    } finally {
      matrixActionRunning.current = false;
      if (revision === matrixSecurityRevision.current) setMatrixSecurityLoading(false);
    }
  };

  const openMatrixScanner = async () => {
    if (!matrixVerification?.qrSupported || !isActiveMatrixVerification(matrixVerification)) return;
    const revision = matrixSecurityRevision.current;
    try {
      const permission = cameraPermission?.granted ? cameraPermission : await requestCameraPermission();
      if (revision !== matrixSecurityRevision.current || !matrixSecurityVisible.current) return;
      if (!permission.granted) { setMatrixSecurityError('Камера недоступна. Разрешите доступ к ней или сравните эмодзи.'); return; }
      matrixScanLocked.current = false;
      setMatrixScannerOpen(true);
    } catch {
      if (revision === matrixSecurityRevision.current) setMatrixSecurityError('Не удалось открыть камеру. Используйте сравнение эмодзи.');
    }
  };

  const scanMatrixQr = (result: BarcodeScanningResult) => {
    if (!matrixVerification || matrixScanLocked.current) return;
    matrixScanLocked.current = true;
    setMatrixScannerOpen(false);
    try {
      const encoded = matrixQrPayload(result, Platform.OS);
      void runMatrixSecurityAction(() => controller.scanMatrixQrVerification(accountId, matrixVerification.id, encoded));
    } catch {
      setMatrixSecurityError('Этот QR-код не подходит для проверки. Используйте код VOLNA или сравните эмодзи.');
    }
  };

  if (loading && !thread) return <View style={ui.screen}><Header onBack={onBack} title="Сообщения" /><View style={ui.center}><LoadingIndicator /></View><View style={{ paddingBottom: Math.max(safeAreaInsets.bottom, 8) }}>{composerAccessory}</View></View>;
  if (loadError || !thread) {
    const setupRequired = errorCode(loadError) === 'security_setup_required';
    return <View style={ui.screen}><Header onBack={onBack} title="Сообщения" /><View style={ui.blocked}><ShieldAlert color="#111" size={34} /><Text style={ui.blockedTitle}>{setupRequired ? 'Настройте защищённые сообщения' : 'Чат временно недоступен'}</Text><Text style={ui.blockedText}>{messagingSurfaceErrorMessage(loadError)}</Text>{setupRequired && onOpenMessageSecurity ? <Pressable onPress={onOpenMessageSecurity} style={ui.primaryButton}><Text style={ui.primaryButtonText}>Открыть настройку</Text></Pressable> : <Pressable onPress={() => void open(true)} style={ui.secondaryButton}><Text style={ui.secondaryButtonText}>Повторить</Text></Pressable>}</View><View style={{ paddingBottom: Math.max(safeAreaInsets.bottom, 8) }}>{composerAccessory}</View></View>;
  }

  const securityLabel = 'Защищённый чат · сквозное шифрование';
  const pendingVerification = isActiveMatrixVerification(matrixVerification) && matrixSecurity?.partnerDevices.some(device => device.userId === matrixVerification?.otherUserId) ? matrixVerification : null;
  const matrixOverview = matrixSecurityOverview(matrixSecurity, pendingVerification);
  const showMatrixVerificationPrompt = thread.encryptionMode === 'MATRIX_V1' && (matrixSecurity?.partnerIdentityChanged || !!pendingVerification);
  const composerKeyboardVisible = Platform.OS === 'web' ? webViewport.keyboardVisible : keyboardVisible;
  const webViewportStyle = Platform.OS === 'web' && webViewport.keyboardVisible && webViewport.height
    ? ({
        position: 'absolute',
        left: 0,
        right: 0,
        top: webViewport.top,
        height: Math.max(240, webViewport.height - safeAreaInsets.top),
      } as never)
    : null;

  return <MessagingAudioProvider controller={controller} visibleMessageIds={thread.messages.map(message => message.id)}><View style={[ui.screen, webViewportStyle]}>
    <TouchActionSelectionStyles />
    <Header onBack={onBack} trailingAction={<Pressable accessibilityRole="button" accessibilityLabel="Действия с перепиской" onPress={() => setChatMenuOpen(true)} style={topBarStyles.iconButton}><Ellipsis size={24} color="#98a3ae" /></Pressable>}>
      <Pressable accessibilityLabel={`Открыть профиль ${thread.partner.name}`} onPress={() => void onOpenProfile(thread.partner.username)} style={ui.chatIdentity}><Avatar partner={thread.partner} size={38} online={(peerActivity?.presence?.onlineUntil ?? 0) > chatActivity.clock} /><View style={ui.chatIdentityCopy}><VerifiedName isVerified={thread.partner.isVerified} name={thread.partner.name} style={topBarStyles.title} /><View style={ui.chatPresenceLine}><Text numberOfLines={1} style={ui.chatUsername}>@{thread.partner.username}</Text>{presenceLabel ? <Text numberOfLines={1} style={ui.chatPresenceText}>{'· '}{presenceLabel}</Text> : null}</View></View></Pressable>
    </Header>
    <Pressable accessibilityHint={thread.encryptionMode === 'MATRIX_V1' ? 'Проверить защиту этой переписки' : undefined} accessibilityRole={thread.encryptionMode === 'MATRIX_V1' ? 'button' : undefined} disabled={thread.encryptionMode !== 'MATRIX_V1'} onPress={() => void openMatrixSecurity('partner')} style={[ui.securityBanner, ui.securityBannerProtected]}><View style={ui.securityBannerCopy}><LockKeyhole color="#323a43" size={14} /><Text style={ui.securityBannerText}>{securityLabel}</Text></View>{thread.encryptionMode === 'MATRIX_V1' ? <View style={ui.securityBannerAction}><ChevronRight color="#53606c" size={16} /></View> : null}</Pressable>
    {syncError ? <View accessibilityRole="alert" style={ui.syncErrorBanner}><ShieldAlert color="#7d4e00" size={14} /><Text style={ui.syncErrorText}>{`Безопасная синхронизация приостановлена: ${messagingSurfaceErrorMessage(syncError)}`}</Text></View> : null}
    {showMatrixVerificationPrompt ? <View style={ui.matrixChatPrompt}><View style={ui.matrixChatPromptHeader}><View style={ui.matrixChatPromptIcon}><KeyRound color="#111" size={18} /></View><View style={ui.flex}><Text style={ui.matrixChatPromptTitle}>{matrixOverview.title}</Text><Text style={ui.matrixChatPromptText}>{matrixOverview.description}</Text></View></View><Pressable accessibilityRole="button" disabled={matrixSecurityLoading} onPress={() => void openMatrixSecurity(matrixOverview.action === 'verification' ? 'home' : matrixOverview.action ?? 'home')} style={ui.matrixChatPromptButton}><Text style={ui.matrixChatPromptButtonText}>{pendingVerification ? 'Продолжить проверку' : matrixOverview.action === 'partner' ? 'Проверить собеседника' : matrixOverview.action === 'recovery' ? 'Настроить доступ' : 'Подтвердить устройство'}</Text></Pressable></View> : null}
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={ui.chatShell}>
      <View style={ui.messageHistory}>
      <ComposerFade />
      <ScrollView contentContainerStyle={ui.messages} onLayout={() => { if (nearBottom.current) scrollRef.current?.scrollToEnd({ animated: false }); }} onScroll={({ nativeEvent }) => {
        const offset = nativeEvent.contentOffset.y;
        historyOffset.current = offset;
        const next = nativeEvent.contentSize.height - offset - nativeEvent.layoutMeasurement.height < 80;
        if (next && !nearBottom.current) setReadRevision(value => value + 1);
        nearBottom.current = next;
        if (offset > 120) historyScrollArmed.current = true;
        if (offset < 80 && historyScrollArmed.current && !historyError) void loadEarlier();
      }} scrollEventThrottle={32} onContentSizeChange={() => {
        const anchor = historyAnchor.current;
        const row = anchor && historyRows.current.get(anchor.id);
        const content = scrollRef.current?.getInnerViewNode();
        if (anchor && row && content) row.measureLayout(content, (_x, y) => {
          if (historyAnchor.current !== anchor) return;
          historyAnchor.current = null;
          historyRowY.current.set(anchor.id, y);
          scrollRef.current?.scrollTo({ y: Math.max(0, anchor.offset + y - anchor.y), animated: false });
        }, () => { if (historyAnchor.current === anchor) historyAnchor.current = null; });
        else if (nearBottom.current && !historyBusy.current && !anchor) scrollRef.current?.scrollToEnd({ animated: !reduceMotion });
      }} ref={scrollRef} showsVerticalScrollIndicator={false} style={[ui.messageScroll, Platform.OS === 'web' ? { overflowAnchor: 'none' } as never : null]}>
        {thread.hasMoreHistory ? <ChatHistoryPagination busy={historyLoading} error={historyError} onLoad={() => void loadEarlier()} /> : null}
        {thread.hasUndecryptableEvents ? <ChatHistoryUnavailable onRecover={onOpenMessageSecurity} /> : null}
        {thread.messages.map((message, index) => { const interactive = thread.encryptionMode !== 'MATRIX_V1' || message.securityMode === 'e2ee'; return <View key={message.id} ref={node => { if (node) historyRows.current.set(message.id, node); else historyRows.current.delete(message.id); }} onLayout={({ nativeEvent }) => {
          const y = nativeEvent.layout.y;
          historyRowY.current.set(message.id, y);
        }}><MessageRow accountId={accountId} interactive={interactive} message={message} onLongPress={() => setMessageMenu(message)} onOpenEvent={onOpenEvent} onOpenProfile={onOpenProfile} onOpenPublicPage={onOpenPublicPage} onReact={(emoji) => void react(message, emoji)} previous={thread.messages[index - 1]} /></View>; })}
      </ScrollView>
      </View>
      <View style={ui.composerDock}>
      {composerAccessory}
      <View style={[ui.composer, { paddingBottom: composerKeyboardVisible ? (Platform.OS === 'web' ? webViewport.keyboardPaddingBottom : 8) : Math.max(safeAreaInsets.bottom, 8), paddingLeft: Math.max(safeAreaInsets.left, 20), paddingRight: Math.max(safeAreaInsets.right, 20) }]}>
        <MotionDisclosure visible={Boolean(attachment)}>{attachment ? <DraftAttachment attachment={attachment} onRemove={() => setAttachment(null)} /> : null}</MotionDisclosure>
        <MotionDisclosure visible={Boolean(editing)}>{editing ? <View style={ui.editBar}><View style={ui.flex}><Text style={ui.editTitle}>Редактирование сообщения</Text><Text numberOfLines={1} style={ui.editText}>{editing.text}</Text></View><Pressable accessibilityLabel="Отменить редактирование" onPress={() => { setEditing(null); setText(''); setSendError(null); }} style={ui.smallIconButton}><X color="#6f7b86" size={19} /></Pressable></View> : null}</MotionDisclosure>
        {sendError ? <View accessibilityRole="alert" style={ui.syncErrorBanner}><Text style={ui.syncErrorText}>{messagingSurfaceErrorMessage(sendError)}</Text></View> : null}
        <View style={ui.inputShell}>
          <Pressable accessibilityLabel="Прикрепить" accessibilityRole="button" disabled={Boolean(editing)} onPress={() => setAttachmentOpen(true)} style={ui.composerIcon}><Paperclip color={editing ? '#aab4be' : '#111'} size={21} /></Pressable>
          <TextInput accessibilityLabel="Сообщение" maxLength={1000} multiline={false} onChangeText={setText} onSubmitEditing={() => void send()} returnKeyType="send" blurOnSubmit={false} placeholder="Сообщение" placeholderTextColor="#98a3ae" style={ui.messageInput} value={text} />
          {hasContent ? <Pressable accessibilityLabel="Отправить сообщение" accessibilityRole="button" disabled={sending} onPress={() => void send()} style={ui.composerIcon}>{sending ? <LoadingIndicator size="small" /> : <Send color="#111" size={21} />}</Pressable> : null}
        </View>
      </View>
      </View>
    </KeyboardAvoidingView>
    <AttachmentSheet controller={controller} isVisible={attachmentOpen} onClose={() => setAttachmentOpen(false)} onMusic={() => { setAttachmentOpen(false); setMusicOpen(true); }} onSelect={(value) => { setAttachment(value); setAttachmentOpen(false); }} />
    <MusicSheet controller={controller} isVisible={musicOpen} onClose={() => setMusicOpen(false)} onSelect={(value) => { setAttachment(value); setMusicOpen(false); }} />
    <Sheet isVisible={chatMenuOpen} onClose={() => setChatMenuOpen(false)} title="Переписка">
      <Pressable accessibilityRole="button" onPress={() => beginDelete({})} style={ui.sheetAction}><Text style={ui.sheetActionText}>Удалить переписку</Text></Pressable>
    </Sheet>
    <DeletionSheet isVisible={Boolean(deleteTarget)} message={deletingMessage} busy={deleteBusy} error={deleteError}
      onClose={() => { if (!deleting.current) setDeleteTarget(null); }} onDelete={scope => void removeContent(scope)} />
    <Sheet touchActionMenu isVisible={Boolean(messageMenu)} onClose={() => setMessageMenu(null)} title="Сообщение">
      <View style={ui.reactionPicker}>{REACTIONS.map((emoji) => { const selected = messageMenu?.reactions.some((reaction) => reaction.accountId === accountId && reaction.emoji === emoji) === true; return <Pressable accessibilityLabel={`Реакция ${emoji}`} accessibilityState={{ selected }} key={emoji} onPress={() => messageMenu && void react(messageMenu, emoji)} style={[ui.reactionButton, selected && ui.reactionButtonSelected]}><Text style={ui.reactionEmoji}>{emoji}</Text></Pressable>; })}</View>
      <View style={ui.customReaction}><TextInput maxLength={32} onChangeText={setCustomReaction} placeholder="Любой эмодзи" placeholderTextColor="#98a3ae" style={ui.customReactionInput} value={customReaction} /><Pressable disabled={!customReaction.trim()} onPress={() => messageMenu && void react(messageMenu, customReaction)} style={ui.customReactionButton}><Text style={ui.customReactionButtonText}>Добавить</Text></Pressable></View>
      {messageMenu ? <Pressable accessibilityRole="button" onPress={() => beginDelete({ messageId: messageMenu.id })} style={ui.sheetAction}><Text style={ui.sheetActionText}>Удалить сообщение</Text></Pressable> : null}
{messageMenu?.senderAccountId === accountId && messageMenu.text && (thread.encryptionMode !== 'MATRIX_V1' || messageMenu.securityMode === 'e2ee') && Date.now() - Date.parse(messageMenu.createdAt) <= 60_000 ? <Pressable onPress={() => { setEditing(messageMenu); setText(messageMenu.text ?? ''); setAttachment(null); setMessageMenu(null); }} style={ui.sheetAction}><Text style={ui.sheetActionText}>Редактировать</Text></Pressable> : null}
    </Sheet>
    <Sheet bodyRef={matrixSecurityScroll} isVisible={matrixSecurityOpen} onClose={closeMatrixSecurity} title="Защита сообщений">
      {matrixScannerOpen ? <View><CameraView barcodeScannerSettings={{ barcodeTypes: ['qr'] }} facing="back" onBarcodeScanned={scanMatrixQr} style={{ height: 260 }} /><Text style={ui.hint}>Сканируйте код со второго устройства. Если камера не распознаёт QR, вернитесь к сравнению эмодзи.</Text><Pressable accessibilityRole="button" onPress={() => setMatrixScannerOpen(false)} style={ui.secondaryButton}><Text style={ui.secondaryButtonText}>Назад к проверке</Text></Pressable></View> : null}
      <View style={matrixScannerOpen ? { display: 'none' } : undefined}>
      <MatrixSecurityFlow
        scope="conversation"
        initialStep={matrixSecurityStart}
        busy={matrixSecurityLoading} closeRequested={matrixRecoveryCloseRequested}
        error={matrixSecurityError ?? matrixSecurityReadError} partnerName={thread.partner.name}
        recoveryKey={matrixRecoveryKey} security={matrixSecurity} verification={matrixSecurity?.partnerDevices.some(device => device.userId === matrixVerification?.otherUserId) ? matrixVerification : null}
        onClose={closeMatrixSecurity} onRetry={() => { setMatrixSecurityError(null); void refreshMatrixSecurity(); }}
        onStepChange={() => matrixSecurityScroll.current?.scrollTo({ y: 0, animated: false })}
        onRecoverySaved={() => { setMatrixRecoveryKey(''); setMatrixRecoveryCloseRequested(false); void refreshMatrixSecurity(); }}
        onRecover={recoverMatrix} onSetupRecovery={() => void setupMatrixRecovery()} onStart={startMatrixVerification}
        onResetRecovery={() => void setupMatrixRecovery(true)}
        onAccept={() => matrixVerification && void runMatrixSecurityAction(() => controller.acceptMatrixVerification(accountId, matrixVerification.id))}
        onCancel={() => matrixVerification && void runMatrixSecurityAction(() => controller.cancelMatrixVerification(accountId, matrixVerification.id))}
        onConfirm={() => matrixVerification && void runMatrixSecurityAction(() => controller.confirmMatrixVerification(accountId, matrixVerification.id))}
        onMismatch={() => matrixVerification && void runMatrixSecurityAction(() => controller.mismatchMatrixVerification(accountId, matrixVerification.id))}
        onStartSas={() => matrixVerification && void runMatrixSecurityAction(() => controller.startMatrixSasVerification(accountId, matrixVerification.id))}
        onGenerateQr={() => matrixVerification && void runMatrixSecurityAction(() => controller.generateMatrixQrVerification(accountId, matrixVerification.id))}
        onScanQr={() => void openMatrixScanner()}
      />
      </View>
    </Sheet>
  </View></MessagingAudioProvider>;
}

function ComposerFade() {
  return <View pointerEvents="none" style={ui.composerFade}><Svg height="100%" width="100%"><Defs><LinearGradient id="message-composer-fade" x1="0" x2="0" y1="0" y2="1"><Stop offset="0" stopColor="#f3f5f7" stopOpacity="0" /><Stop offset="1" stopColor="#f3f5f7" stopOpacity="1" /></LinearGradient></Defs><Rect fill="url(#message-composer-fade)" height="100%" width="100%" /></Svg></View>;
}


export function MessageRow({ accountId, interactive, message, onLongPress, onOpenEvent, onOpenProfile, onOpenPublicPage, onReact, previous }: { accountId: string; interactive: boolean; message: MessagingMessage; onLongPress: () => void; onOpenEvent: (eventId: string) => void; onOpenProfile: (username: string) => void | Promise<void>; onOpenPublicPage: (username: string) => void | Promise<void>; onReact: (emoji: string) => void; previous?: MessagingMessage }) {
  const own = message.senderAccountId === accountId;
  const webActions = Platform.OS === 'web' && interactive ? {
    dataSet: { 'volna-touch-action': 'true' },
    tabIndex: 0 as const,
    onContextMenu: (event: { preventDefault: () => void }) => { event.preventDefault(); onLongPress(); },
    onKeyDown: (event: { key: string; shiftKey: boolean; repeat: boolean; preventDefault: () => void; stopPropagation: () => void }) => {
      if (event.repeat || !(event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) return;
      event.preventDefault(); event.stopPropagation(); onLongPress();
    },
  } : {};
  const showDay = !previous || dayKey(previous.createdAt) !== dayKey(message.createdAt);
  const reactions = Object.entries(message.reactions.reduce<Record<string, { count: number; mine: boolean }>>((result, reaction) => { const current = result[reaction.emoji] ?? { count: 0, mine: false }; result[reaction.emoji] = { count: current.count + 1, mine: current.mine || reaction.accountId === accountId }; return result; }, {}));
  return <View>{showDay ? <View style={ui.daySeparator}><Text style={ui.dayText}>{formatDay(message.createdAt)}</Text></View> : null}<View style={[ui.messageRow, own && ui.messageRowOwn]}><View style={[ui.messageStack, own && ui.messageStackOwn]}><Pressable {...webActions} delayLongPress={350} onLongPress={interactive ? onLongPress : undefined} accessibilityActions={interactive ? [{ name: 'longpress', label: 'Действия с сообщением' }] : undefined} onAccessibilityAction={event => { if (interactive && event.nativeEvent.actionName === 'longpress') onLongPress(); }} style={[ui.messageGroup, own && ui.messageGroupOwn]}>
    {message.deletedAt ? <View style={[ui.bubble, own && ui.bubbleOwn]}><Text style={[ui.deletedText, own && ui.ownMuted]}>Сообщение удалено</Text><Timestamp label={formatClock(message.createdAt)} own={own} /></View> : <>
      {message.attachment ? <AttachmentCard attachment={message.attachment} messageId={message.id} onOpenEvent={onOpenEvent} onOpenProfile={onOpenProfile} onOpenPublicPage={onOpenPublicPage} own={own} /> : null}
      {message.text ? <View style={[ui.bubble, own && ui.bubbleOwn]}><Text style={[ui.bubbleText, own && ui.bubbleTextOwn]}>{message.text}</Text><Timestamp label={message.editedAt ? `изменено ${formatClock(message.editedAt)}` : formatClock(message.createdAt)} own={own} /></View> : !message.attachment ? <View style={[ui.bubble, own && ui.bubbleOwn]}><Text style={[ui.deletedText, own && ui.ownMuted]}>Неподдерживаемое сообщение</Text></View> : null}
    </>}
    {message.attachment && !message.text && !message.deletedAt ? <Timestamp label={formatClock(message.createdAt)} own={false} /> : null}
  </Pressable>{reactions.length ? <View style={[ui.reactionRow, own && ui.reactionRowOwn]}>{reactions.map(([emoji, value]) => <Pressable accessibilityLabel={`Реакция ${emoji}, ${value.count}`} accessibilityState={{ selected: value.mine, disabled: !interactive }} disabled={!interactive} key={emoji} onPress={() => onReact(emoji)} style={[ui.reactionChip, value.mine && ui.reactionChipMine]}><Text style={ui.reactionText}>{emoji}{value.count > 1 ? ` ${value.count}` : ''}</Text></Pressable>)}</View> : null}</View></View></View>;
}

function Timestamp({ label, own }: { label: string; own: boolean }) { return <View style={ui.timestampRow}><Text style={[ui.timestamp, own && ui.timestampOwn]}>{label}</Text></View>; }

function AttachmentCard({ attachment, messageId, onOpenEvent, onOpenProfile, onOpenPublicPage, own }: { attachment: MessagingAttachment; messageId: string; onOpenEvent: (eventId: string) => void; onOpenProfile: (username: string) => void | Promise<void>; onOpenPublicPage: (username: string) => void | Promise<void>; own: boolean }) {
  if (attachment.kind === 'location') return <Pressable accessibilityLabel="Открыть геопозицию на карте" onPress={() => void Linking.openURL(`https://yandex.ru/maps/?pt=${attachment.longitude},${attachment.latitude}&z=16&l=map`)} style={[ui.attachmentCard, own && ui.attachmentCardOwn]}><View style={[ui.attachmentIcon, own && ui.attachmentIconOwn]}><MapPin color={own ? '#fff' : '#111'} size={22} /></View><View style={ui.flex}><Text style={[ui.attachmentTitle, own && ui.ownText]}>Геопозиция</Text><Text style={[ui.attachmentMeta, own && ui.ownMuted]}>Открыть на карте</Text></View></Pressable>;
  if (attachment.kind === 'music') return <MusicCard attachment={attachment} messageId={messageId} own={own} />;
  const snapshot = attachment.snapshot ?? {};
  if (attachment.entityType === 'event') {
    const title = typeof snapshot.title === 'string' ? snapshot.title : 'Событие';
    const image = trustedPublicMediaUrl(snapshot.posterUrl);
    return <Pressable accessibilityLabel={`Открыть событие ${title}`} onPress={() => onOpenEvent(attachment.id)} style={[ui.entityCard, own && ui.entityCardOwn]}>{image ? <ExpoImage cachePolicy="memory-disk" contentFit="cover" source={{ uri: image }} style={ui.entityImage} /> : <View style={ui.entityImageFallback}><CalendarDays color="#6f7b86" size={22} /></View>}<View style={ui.flex}><Text numberOfLines={2} style={[ui.entityTitle, own && ui.ownText]}>{title}</Text>{typeof snapshot.organizerName === 'string' ? <Text numberOfLines={1} style={[ui.attachmentMeta, own && ui.ownMuted]}>{snapshot.organizerName}</Text> : null}{typeof snapshot.startsAt === 'string' ? <Text style={[ui.attachmentMeta, own && ui.ownMuted]}>{formatDay(snapshot.startsAt)}</Text> : null}</View></Pressable>;
  }
  const name = typeof snapshot.name === 'string' ? snapshot.name : 'Профиль';
  const targetUsername = typeof snapshot.username === 'string' && /^[a-z0-9_.-]{2,32}$/.test(snapshot.username) ? snapshot.username : null;
  const image = trustedPublicMediaUrl(snapshot.avatarUrl);
  const press = () => { if (!targetUsername) return; if (attachment.entityType === 'account') void onOpenProfile(targetUsername); else void onOpenPublicPage(targetUsername); };
  const subtitle = typeof snapshot.subtitle === 'string'
    ? (attachment.entityType === 'publicPage' && Object.prototype.hasOwnProperty.call(publicPageTypeLabels, snapshot.subtitle) ? publicPageTypeLabels[snapshot.subtitle] : snapshot.subtitle)
    : null;
  return <Pressable accessibilityLabel={`Открыть ${name}`} disabled={!targetUsername} onPress={press} style={[ui.entityCard, own && ui.entityCardOwn]}>{image ? <ExpoImage cachePolicy="memory-disk" contentFit="cover" source={{ uri: image }} style={ui.entityAvatar} /> : <View style={[ui.entityAvatar, ui.entityImageFallback]}>{attachment.entityType === 'account' ? <UserRound color={own ? '#fff' : '#6f7b86'} size={22} /> : <UsersRound color={own ? '#fff' : '#6f7b86'} size={22} />}</View>}<View style={ui.flex}><VerifiedName inverted={own} isVerified={snapshot.isVerified === true} name={name} style={[ui.entityTitle, own && ui.ownText]} />{targetUsername ? <Text style={[ui.attachmentMeta, own && ui.ownMuted]}>@{targetUsername}</Text> : null}{subtitle ? <Text numberOfLines={2} style={[ui.attachmentMeta, own && ui.ownMuted]}>{subtitle}</Text> : null}</View></Pressable>;
}

function MusicCard({ attachment, messageId, own }: { attachment: Extract<MessagingAttachment, { kind: 'music' }>; messageId: string; own: boolean }) {
  const identity = musicAvailabilityIdentity({ provider: attachment.provider, ...attachment.metadata });
  const availability = useSyncExternalStore(subscribeMusicAvailability, () => getMusicAvailability(identity?.key ?? null), () => null);
  const unavailableLabel = musicUnavailableLabel(availability, attachment.provider);
  const audio = useContext(AudioContext);
  const artwork = trustedPublicMediaUrl(audio?.artworkUrl(attachment) ?? attachment.metadata?.artworkUrl);
  const [artworkFailed, setArtworkFailed] = useState(false);
  const [scrubProgress, setScrubProgress] = useState<number | null>(null);
  const progressWidth = useRef(1);
  const scrubStartX = useRef(0);
  const nativeTapStart = useRef<{ pageX: number; pageY: number } | null>(null);
  const webPointerId = useRef<number | null>(null);
  const webPointerStart = useRef<{ x: number; y: number } | null>(null);
  const webScrubbing = useRef(false);
  const webScrubProgress = useRef<number | null>(null);
  const settleTarget = useRef<number | null>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fillProgress = useRef(new Animated.Value(0)).current;
  useEffect(() => setArtworkFailed(false), [artwork]);
  const current = audio?.activeId === messageId;
  const active = Boolean(current && audio?.playing);
  const loading = Boolean(current && audio?.loading);
  const duration = current ? audio?.duration ?? 0 : 0;
  const progress = current ? audio?.progress ?? 0 : 0;
  const canSeek = Boolean(current && audio && duration > 0 && !loading);
  const displayedProgress = scrubProgress ?? progress;
  const clearSettle = useCallback(() => {
    settleTarget.current = null;
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = null;
  }, []);
  useEffect(() => {
    const target = settleTarget.current;
    if (target === null || Math.abs(progress - target) > 0.02) return;
    clearSettle();
    setScrubProgress(null);
  }, [clearSettle, progress]);
  useEffect(() => {
    if (current) return;
    clearSettle();
    setScrubProgress(null);
  }, [clearSettle, current]);
  useEffect(() => () => clearSettle(), [clearSettle]);
  useEffect(() => {
    fillProgress.stopAnimation();
    if (scrubProgress !== null) {
      fillProgress.setValue(displayedProgress);
      return;
    }
    Animated.timing(fillProgress, {
      duration: active ? 280 : 120,
      easing: undefined,
      toValue: displayedProgress,
      useNativeDriver: false,
    }).start();
  }, [active, displayedProgress, fillProgress, scrubProgress]);
  const updateScrub = useCallback((localX: number, commit = false) => {
    if (!canSeek || !audio || !Number.isFinite(localX) || progressWidth.current <= 0) return;
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
      clearSettle();
      setScrubProgress(null);
    });
  }, [audio, canSeek, clearSettle]);
  const adjustBySeconds = useCallback((seconds: number) => {
    if (!canSeek || duration <= 0) return;
    updateScrub((displayedProgress + seconds / duration) * progressWidth.current, true);
  }, [canSeek, displayedProgress, duration, updateScrub]);
  const beginNativeTap = useCallback((event: GestureResponderEvent) => {
    const { pageX, pageY } = event.nativeEvent;
    nativeTapStart.current = Number.isFinite(pageX) && Number.isFinite(pageY) ? { pageX, pageY } : null;
  }, []);
  const endNativeTap = useCallback((event: GestureResponderEvent) => {
    const start = nativeTapStart.current;
    nativeTapStart.current = null;
    if (!start) return;
    const { locationX, pageX, pageY } = event.nativeEvent;
    if (![locationX, pageX, pageY].every(Number.isFinite) || Math.hypot(pageX - start.pageX, pageY - start.pageY) > 8) return;
    clearSettle();
    updateScrub(locationX, true);
  }, [clearSettle, updateScrub]);
  const scrubResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_event, gesture) => canSeek && Math.abs(gesture.dx) > 3 && Math.abs(gesture.dx) >= Math.abs(gesture.dy),
    onPanResponderGrant: (event, gesture) => {
      nativeTapStart.current = null;
      clearSettle();
      scrubStartX.current = Number(event.nativeEvent.locationX) - gesture.dx;
      updateScrub(scrubStartX.current + gesture.dx);
    },
    onPanResponderMove: (_event, gesture) => updateScrub(scrubStartX.current + gesture.dx),
    onPanResponderRelease: (_event, gesture) => updateScrub(scrubStartX.current + gesture.dx, true),
    onPanResponderReject: () => { nativeTapStart.current = null; clearSettle(); setScrubProgress(null); },
    onPanResponderTerminate: () => { nativeTapStart.current = null; clearSettle(); setScrubProgress(null); },
    onPanResponderTerminationRequest: () => false,
  }), [canSeek, clearSettle, updateScrub]);
  const updateWebScrub = useCallback((element: HTMLElement, clientX: number, commit = false) => {
    const rect = element.getBoundingClientRect();
    if (!Number.isFinite(clientX) || rect.width <= 0) return;
    const next = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    webScrubProgress.current = next;
    updateScrub(next * progressWidth.current, commit);
  }, [updateScrub]);
  const nativeAccessibility = Platform.OS === 'web' ? {} : {
    accessible: true,
    accessibilityActions: [{ name: 'increment' as const, label: 'Перемотать вперёд' }, { name: 'decrement' as const, label: 'Перемотать назад' }],
    accessibilityLabel: `Позиция трека ${attachment.title}`,
    accessibilityRole: 'adjustable' as const,
    accessibilityValue: duration > 0 ? { min: 0, max: Math.round(duration), now: Math.round(displayedProgress * duration) } : undefined,
    onAccessibilityAction: (event: { nativeEvent: { actionName: string } }) => adjustBySeconds(event.nativeEvent.actionName === 'increment' ? 5 : -5),
  };
  return <View style={[ui.musicCard, own && ui.attachmentCardOwn, unavailableLabel && { opacity: 0.65 }]}>
    <Animated.View pointerEvents="none" style={[ui.musicProgressFill, own && ui.musicProgressFillOwn, { width: fillProgress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]} />
    <View style={ui.musicCardContent}>
      <View onLayout={(event) => { progressWidth.current = Math.max(1, event.nativeEvent.layout.width); }} style={ui.musicScrubSurface}>
        {artwork && !artworkFailed ? <ExpoImage cachePolicy="memory-disk" contentFit="cover" onError={() => setArtworkFailed(true)} source={{ uri: artwork }} style={ui.musicArtwork} /> : <View style={[ui.musicArtwork, ui.entityImageFallback]}><Disc3 color="#6f7b86" size={21} /></View>}
        <View style={ui.flex}><Text numberOfLines={1} style={[ui.attachmentTitle, own && ui.ownText]}>{attachment.title}</Text><Text numberOfLines={1} style={[ui.attachmentMeta, own && ui.ownMuted]}>{attachment.artist}</Text>{unavailableLabel ? <Text style={[ui.attachmentMeta, own && ui.ownMuted]}>ⓘ {unavailableLabel}</Text> : null}</View>
        {Platform.OS !== 'web' ? <View {...nativeAccessibility} {...scrubResponder.panHandlers} onTouchCancel={() => { nativeTapStart.current = null; }} onTouchEnd={endNativeTap} onTouchStart={beginNativeTap} pointerEvents={canSeek ? 'auto' : 'none'} style={ui.musicScrubGestureSurface} /> : createElement('div', {
          'aria-label': `Позиция трека ${attachment.title}`,
          'aria-valuemax': Math.round(duration),
          'aria-valuemin': 0,
          'aria-valuenow': Math.round(displayedProgress * duration),
          onKeyDown: (event: KeyboardEvent & { currentTarget: HTMLElement }) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            event.preventDefault();
            adjustBySeconds(event.key === 'ArrowRight' ? 5 : -5);
          },
          onLostPointerCapture: (event: PointerEvent & { currentTarget: HTMLElement }) => {
            if (webPointerId.current !== event.pointerId) return;
            const finalProgress = webScrubProgress.current;
            webPointerId.current = null;
            webPointerStart.current = null;
            webScrubbing.current = false;
            webScrubProgress.current = null;
            if (finalProgress === null) setScrubProgress(null);
            else updateScrub(finalProgress * progressWidth.current, true);
          },
          onPointerCancel: (event: PointerEvent & { currentTarget: HTMLElement }) => {
            if (webPointerId.current !== event.pointerId) return;
            webPointerId.current = null;
            webPointerStart.current = null;
            webScrubbing.current = false;
            webScrubProgress.current = null;
            clearSettle();
            setScrubProgress(null);
          },
          onPointerDown: (event: PointerEvent & { currentTarget: HTMLElement }) => {
            if (!canSeek || webPointerId.current !== null) return;
            webPointerId.current = event.pointerId;
            webPointerStart.current = { x: event.clientX, y: event.clientY };
            webScrubbing.current = false;
            event.currentTarget.setPointerCapture?.(event.pointerId);
          },
          onPointerMove: (event: PointerEvent & { currentTarget: HTMLElement }) => {
            if (webPointerId.current !== event.pointerId) return;
            const start = webPointerStart.current;
            if (!webScrubbing.current) {
              if (!start) return;
              const deltaX = event.clientX - start.x;
              const deltaY = event.clientY - start.y;
              if (Math.abs(deltaX) <= 3 || Math.abs(deltaX) < Math.abs(deltaY)) return;
              webScrubbing.current = true;
              clearSettle();
            }
            event.preventDefault();
            updateWebScrub(event.currentTarget, event.clientX);
          },
          onPointerUp: (event: PointerEvent & { currentTarget: HTMLElement }) => {
            if (webPointerId.current !== event.pointerId) return;
            if (webScrubbing.current) {
              event.preventDefault();
              updateWebScrub(event.currentTarget, event.clientX, true);
            } else {
              event.preventDefault();
              clearSettle();
              updateWebScrub(event.currentTarget, event.clientX, true);
            }
            webPointerId.current = null;
            webPointerStart.current = null;
            webScrubbing.current = false;
            webScrubProgress.current = null;
            if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture?.(event.pointerId);
          },
          role: 'slider',
          tabIndex: canSeek ? 0 : -1,
          onContextMenu: (event: Event) => event.preventDefault(),
          style: { WebkitTouchCallout: 'none', WebkitUserSelect: 'none', cursor: canSeek ? 'ew-resize' : 'default', height: '100%', inset: 0, pointerEvents: canSeek ? 'auto' : 'none', position: 'absolute', touchAction: 'pan-y', userSelect: 'none', width: '100%', zIndex: 2 },
        })}
      </View>
      <Pressable accessibilityLabel={`${loading ? 'Загружается' : active ? 'Поставить на паузу' : 'Воспроизвести'} ${attachment.title}`} accessibilityRole="button" disabled={loading} onPress={() => { if (audio) void audio.toggle(messageId, attachment); }} style={[ui.playButton, own && ui.playButtonOwn]}>{loading ? <LoadingIndicator tone={own ? 'default' : 'inverse'} size="small" /> : active ? <Pause color={own ? '#111' : '#fff'} fill={own ? '#111' : '#fff'} size={13} /> : <Play color={own ? '#111' : '#fff'} fill={own ? '#111' : '#fff'} size={12} />}</Pressable>
    </View>
  </View>;
}

export function DraftAttachment({ attachment, onRemove }: { attachment: MessagingAttachment; onRemove: () => void }) {
  const title = attachment.kind === 'location' ? 'Текущая геопозиция' : attachment.kind === 'music' ? attachment.title : attachment.entityType === 'event' ? String(attachment.snapshot?.title ?? 'Событие') : String(attachment.snapshot?.name ?? 'Профиль');
  const meta = attachment.kind === 'location' ? 'Доступна только участникам чата' : attachment.kind === 'music' ? attachment.artist : attachment.entityType === 'event' ? 'Событие' : typeof attachment.snapshot?.username === 'string' ? `@${attachment.snapshot.username}` : '';
  return <View style={ui.draftAttachment}><View style={ui.draftIcon}>{attachment.kind === 'location' ? <MapPin color="#111" size={21} /> : attachment.kind === 'music' ? <Disc3 color="#6f7b86" size={21} /> : attachment.entityType === 'account' ? <UserRound color="#6f7b86" size={21} /> : attachment.entityType === 'publicPage' ? <UsersRound color="#6f7b86" size={21} /> : <CalendarDays color="#6f7b86" size={21} />}</View><View style={ui.flex}><Text numberOfLines={1} style={ui.draftTitle}>{title}</Text><Text numberOfLines={1} style={ui.draftMeta}>{meta}</Text></View><Pressable accessibilityLabel="Убрать вложение" onPress={onRemove} style={ui.smallIconButton}><X color="#6f7b86" size={19} /></Pressable></View>;
}

function AttachmentSheet({ controller, isVisible, onClose, onMusic, onSelect }: { controller: MessagingSurfaceController; isVisible: boolean; onClose: () => void; onMusic: () => void; onSelect: (attachment: MessagingAttachment) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ accounts: Array<Record<string, unknown>>; communities: Array<Record<string, unknown>>; events: Array<Record<string, unknown>> }>({ accounts: [], communities: [], events: [] });
  const [loading, setLoading] = useState(false);
  const [locating, setLocating] = useState(false);
  useEffect(() => {
    const normalized = query.trim().replace(/^@/, '');
    if (!isVisible || normalized.length < 3) { setResults({ accounts: [], communities: [], events: [] }); return; }
    let active = true;
    const timer = setTimeout(() => { setLoading(true); void controller.searchAttachments(normalized).then((value) => { if (active) setResults(value); }).catch(() => undefined).finally(() => { if (active) setLoading(false); }); }, SEARCH_DELAY_MS);
    return () => { active = false; clearTimeout(timer); };
  }, [controller, isVisible, query]);
  useEffect(() => { if (!isVisible) setQuery(''); }, [isVisible]);
  const location = async () => {
    setLocating(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) throw new Error('Разрешите доступ к геопозиции в настройках устройства');
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      onSelect({ kind: 'location', latitude: position.coords.latitude, longitude: position.coords.longitude, ...(typeof position.coords.accuracy === 'number' ? { accuracy: position.coords.accuracy } : {}) });
    } catch (error) { Alert.alert('Геопозиция', error instanceof Error ? error.message : 'Не удалось определить геопозицию'); }
    finally { setLocating(false); }
  };
  const entity = (item: Record<string, unknown>, entityType: 'account' | 'publicPage'): MessagingAttachment => ({ kind: 'entity', entityType, id: String(item.id), snapshot: { name: String(item.name ?? 'Профиль'), username: typeof item.username === 'string' ? item.username : null, avatarUrl: typeof item.avatarUrl === 'string' ? item.avatarUrl : null, cityName: typeof item.cityName === 'string' ? item.cityName : null, subtitle: typeof item.typeLabel === 'string' ? item.typeLabel : null, isVerified: item.isVerified === true } });
  const event = (item: Record<string, unknown>): MessagingAttachment => ({ kind: 'entity', entityType: 'event', id: String(item.id), snapshot: { title: String(item.title ?? 'Событие'), posterUrl: typeof item.posterUrl === 'string' ? item.posterUrl : null, startsAt: typeof item.startsAt === 'string' ? item.startsAt : null, organizerName: typeof item.organizerName === 'string' ? item.organizerName : null } });
  return <Sheet isVisible={isVisible} onClose={onClose} title="Прикрепить">
    <View style={ui.attachmentActions}><Pressable onPress={onMusic} style={ui.attachmentAction}><View style={ui.draftIcon}><Disc3 color="#111" size={23} /></View><Text style={ui.attachmentActionText}>Музыка</Text></Pressable><Pressable disabled={locating} onPress={() => void location()} style={ui.attachmentAction}><View style={ui.draftIcon}>{locating ? <LoadingIndicator /> : <MapPin color="#111" size={23} />}</View><Text style={ui.attachmentActionText}>Геопозиция</Text></Pressable></View>
    <Text style={ui.sectionTitle}>Профиль, сообщество или событие</Text>
    <View style={ui.searchField}><Search color="#7d8894" size={19} /><TextInput autoCapitalize="none" onChangeText={setQuery} placeholder="Название или @юзернейм" placeholderTextColor="#98a3ae" style={ui.searchInput} value={query} /></View>
    {loading ? <LoadingIndicator style={ui.sheetLoader} /> : <>{results.accounts.map((item) => <SearchResult key={`a-${String(item.id)}`} item={item} kind="account" onPress={() => onSelect(entity(item, 'account'))} />)}{results.communities.map((item) => <SearchResult key={`p-${String(item.id)}`} item={item} kind="community" onPress={() => onSelect(entity(item, 'publicPage'))} />)}{results.events.map((item) => <SearchResult key={`e-${String(item.id)}`} item={item} kind="event" onPress={() => onSelect(event(item))} />)}</>}
    {!loading && query.trim().length > 0 && query.trim().length < 3 ? <Text style={ui.hint}>Введите минимум 3 символа</Text> : null}
  </Sheet>;
}

export function SearchResult({ item, kind, onPress }: { item: Record<string, unknown>; kind: 'account' | 'community' | 'event'; onPress: () => void }) {
  const title = String(kind === 'event' ? item.title ?? 'Событие' : item.name ?? 'Профиль');
  const image = trustedPublicMediaUrl(kind === 'event' ? item.posterUrl : item.avatarUrl);
  const meta = kind === 'event' ? String(item.organizerName ?? 'Событие') : `@${String(item.username ?? '')}`;
  return <Pressable onPress={onPress} style={ui.searchResult}>{image ? <ExpoImage cachePolicy="memory-disk" contentFit="cover" source={{ uri: image }} style={kind === 'event' ? ui.searchResultImage : ui.searchResultAvatar} /> : <View style={[kind === 'event' ? ui.searchResultImage : ui.searchResultAvatar, ui.entityImageFallback]}>{kind === 'account' ? <UserRound color="#6f7b86" size={21} /> : kind === 'community' ? <UsersRound color="#6f7b86" size={21} /> : <CalendarDays color="#6f7b86" size={21} />}</View>}<View style={ui.flex}><Text numberOfLines={1} style={ui.personName}>{title}</Text><Text numberOfLines={1} style={ui.personUsername}>{meta}</Text></View><Text style={ui.resultKind}>{kind === 'account' ? 'Профиль' : kind === 'community' ? 'Сообщество' : 'Событие'}</Text></Pressable>;
}

function musicAttachment(value: Record<string, any>): Extract<MessagingAttachment, { kind: 'music' }> {
  if (value.kind === 'track' && value.track) return musicAttachment(value.track);
  const provider = ['apple', 'yandex', 'youtube', 'volna', 'soundcloud', 'bandcamp'].includes(value.provider ?? value.kind) ? (value.provider ?? value.kind) : 'volna';
  const id = String(value.id ?? value.trackId ?? value.url ?? '');
  return { kind: 'music', provider, id, title: String(value.title ?? 'Музыка'), artist: String(value.artist ?? 'VOLNA'), metadata: { artworkUrl: typeof value.artworkUrl === 'string' ? value.artworkUrl : null, previewUrl: typeof value.previewUrl === 'string' ? value.previewUrl : null, externalUrl: typeof (value.externalUrl ?? value.url) === 'string' ? (value.externalUrl ?? value.url) : null, sourceTrackUrl: typeof value.sourceTrackUrl === 'string' ? value.sourceTrackUrl : null } };
}

function MusicSheet({ controller, isVisible, onClose, onSelect }: { controller: MessagingSurfaceController; isVisible: boolean; onClose: () => void; onSelect: (attachment: MessagingAttachment) => void }) {
  const [query, setQuery] = useState('');
  const [tracks, setTracks] = useState<Array<Record<string, any>>>([]);
  const [results, setResults] = useState<Array<Record<string, any>>>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => { if (!isVisible) return; setLoading(true); void controller.loadOwnMusic().then(setTracks).catch(() => setTracks([])).finally(() => setLoading(false)); }, [controller, isVisible]);
  useEffect(() => {
    if (!isVisible || query.trim().length < 2 || /^https?:\/\//i.test(query.trim())) { setResults([]); return; }
    let active = true;
    const timer = setTimeout(() => { setLoading(true); void controller.searchMusic(query).then((items) => { if (active) setResults(items); }).catch(() => undefined).finally(() => { if (active) setLoading(false); }); }, SEARCH_DELAY_MS);
    return () => { active = false; clearTimeout(timer); };
  }, [controller, isVisible, query]);
  useEffect(() => { if (!isVisible) { setQuery(''); setResults([]); } }, [isVisible]);
  const resolve = async () => { try { setLoading(true); onSelect(musicAttachment(await controller.resolveMusic(query))); } catch (error) { Alert.alert('Музыка', messagingSurfaceErrorMessage(error)); } finally { setLoading(false); } };
  const visible = results.length ? results : tracks;
  return <Sheet isVisible={isVisible} onClose={onClose} title="Музыка">
    <View style={ui.searchField}><Search color="#7d8894" size={19} /><TextInput autoCapitalize="none" onChangeText={setQuery} onSubmitEditing={() => { if (/^https?:\/\//i.test(query.trim())) void resolve(); }} placeholder="Название или ссылка" placeholderTextColor="#98a3ae" style={ui.searchInput} value={query} />{/^https?:\/\//i.test(query.trim()) ? <Pressable accessibilityLabel="Добавить по ссылке" onPress={() => void resolve()} style={ui.smallIconButton}><Check color="#111" size={20} /></Pressable> : null}</View>
    {loading ? <LoadingIndicator style={ui.sheetLoader} /> : visible.map((track, index) => { const attachment = musicAttachment(track); const artwork = safeHttpsUrl(attachment.metadata?.artworkUrl); return <Pressable key={`${attachment.provider}:${attachment.id}:${index}`} onPress={() => onSelect(attachment)} style={ui.searchResult}>{artwork ? <ExpoImage cachePolicy="memory-disk" contentFit="cover" source={{ uri: artwork }} style={ui.searchResultImage} /> : <View style={[ui.searchResultImage, ui.entityImageFallback]}><Disc3 color="#6f7b86" size={21} /></View>}<View style={ui.flex}><Text numberOfLines={1} style={ui.personName}>{attachment.title}</Text><Text numberOfLines={1} style={ui.personUsername}>{attachment.artist}</Text></View></Pressable>; })}
    {!loading && !visible.length ? <Text style={ui.hint}>Добавьте музыку в профиль или найдите трек</Text> : null}
  </Sheet>;
}

export function MessagingShareTargets({ accountId, controller, draft, enabled = true, onError, onSent }: { accountId?: string; controller: MessagingSurfaceController; draft: { text?: string; attachment?: MessagingAttachment }; enabled?: boolean; onError?: (message: string) => void; onSent?: (username: string) => void }) {
  const [query, setQuery] = useState('');
  const [profiles, setProfiles] = useState<MessagingPartner[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const shareAttempt = useRef(createMessageSendAttempt(() => `message_${randomUUID().replaceAll('-', '')}`));
  const shareRunning = useRef(false);
  const normalized = query.trim().replace(/^@/, '');
  useEffect(() => {
    if (!enabled) { setProfiles([]); setLoading(false); return; }
    if (normalized.length > 0 && normalized.length < 3) { setProfiles([]); return; }
    let active = true;
    const timer = setTimeout(() => { setLoading(true); void controller.searchProfiles(normalized, { shareRecipients: true }).then((items) => { if (active) setProfiles(items); }).catch((error) => { if (active) onError?.(messagingSurfaceErrorMessage(error)); }).finally(() => { if (active) setLoading(false); }); }, normalized.length >= 3 ? SEARCH_DELAY_MS : 0);
    return () => { active = false; clearTimeout(timer); };
  }, [controller, enabled, normalized, onError]);
  const send = async (profile: MessagingPartner) => {
    if (shareRunning.current) return;
    shareRunning.current = true;
    setSending(profile.username);
    try { const resolvedAccountId = accountId ?? await controller.resolveOwnAccountId(); const thread = await controller.openThread(resolvedAccountId, profile.username); const clientRequestId = shareAttempt.current.get(`${resolvedAccountId}:${thread.id}`, draft); await controller.sendMessage(resolvedAccountId, thread, { ...draft, clientRequestId }); shareAttempt.current.clear(); onSent?.(profile.username); }
    catch (error) { onError?.(messagingSurfaceErrorMessage(error)); }
    finally { shareRunning.current = false; setSending(null); }
  };
  return <><View style={ui.searchField}><Search color="#7d8894" size={19} /><TextInput autoCapitalize="none" onChangeText={setQuery} placeholder="Имя или @юзернейм" placeholderTextColor="#98a3ae" style={ui.searchInput} value={query} /></View>{loading ? <LoadingIndicator style={ui.sheetLoader} /> : profiles.map((profile) => <Pressable accessibilityLabel={`Отправить пользователю ${profile.name}`} disabled={Boolean(sending)} key={profile.id} onPress={() => void send(profile)} style={ui.personRow}><Avatar partner={profile} /><View style={ui.personCopy}><VerifiedName isVerified={profile.isVerified} name={profile.name} style={ui.personName} /><Text style={ui.personUsername}>@{profile.username}</Text></View><View style={ui.sendCircle}>{sending === profile.username ? <LoadingIndicator tone="inverse" size="small" /> : <Send color="#fff" fill="#fff" size={15} />}</View></Pressable>)}</>;
}

function formatChatTime(value: string | null) { if (!value) return ''; const date = new Date(value); const now = new Date(); return dayKey(value) === dayKey(now.toISOString()) ? formatClock(value) : new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit' }).format(date); }
function formatClock(value: string) { return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date(value)); }
function dayKey(value: string) { const date = new Date(value); return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`; }
function formatDay(value: string) { const date = new Date(value); if (!Number.isFinite(date.getTime())) return ''; const today = new Date(); const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1); if (dayKey(value) === dayKey(today.toISOString())) return 'Сегодня'; if (dayKey(value) === dayKey(yesterday.toISOString())) return 'Вчера'; return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', ...(date.getFullYear() !== today.getFullYear() ? { year: 'numeric' as const } : {}) }).format(date); }

const ui = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' }, flex: { flex: 1, minWidth: 0 }, center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, smallIconButton: { width: 36, height: 44, alignItems: 'center', justifyContent: 'center' },
  verifiedRow: { minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 4 }, verifiedName: { flexShrink: 1 },
  onlineDot: { position: 'absolute', bottom: 0, right: 0, width: 11, height: 11, borderRadius: 6, borderWidth: 2, borderColor: '#fff', backgroundColor: '#21c45a' },
  chatPresenceLine: { flexDirection: 'row', alignItems: 'center', gap: 5, minWidth: 0 },
  chatPresenceText: { flexShrink: 1, color: '#6f7b86', fontSize: 12 },
  timestampRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4, marginTop: 3 },
  avatar: { overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f3f5f7' }, avatarInitial: { color: '#111', fontSize: 15, fontWeight: '600' },
  threadToolbar: { flexDirection: 'row', gap: 8 }, searchField: { flex: 1, minHeight: 44, paddingHorizontal: 14, borderRadius: 8, borderWidth: 1, borderColor: '#d7dee5', backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center', gap: 9 }, searchInput: { flex: 1, minWidth: 0, height: 44, paddingVertical: 0, color: '#111', fontSize: 16 },
  composeButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f3f5f7' }, threadList: { paddingHorizontal: 10, paddingBottom: 24 }, threadListEmpty: { flexGrow: 1 },
  threadRow: { minHeight: 68, paddingHorizontal: 8, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 11 }, threadCopy: { flex: 1, minWidth: 0 }, threadHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }, threadNameLine: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 5 }, threadName: { color: '#111', fontSize: 15, lineHeight: 20, fontWeight: '600' }, threadUsername: { flexShrink: 1, color: '#8e99a4', fontSize: 12 }, threadTime: { color: '#8e99a4', fontSize: 12 }, threadMeta: { marginTop: 3, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 6 }, threadPreview: { flex: 1, color: '#6f7b86', fontSize: 14 }, unreadBadge: { minWidth: 20, height: 18, paddingHorizontal: 5, borderRadius: 9, backgroundColor: '#8e99a4', alignItems: 'center', justifyContent: 'center' }, unreadText: { color: '#fff', fontSize: 10, fontWeight: '600' }, footerLoader: { marginVertical: 16 },
  empty: { minHeight: 176, flex: 1, padding: 24, alignItems: 'center', justifyContent: 'center', gap: 8 }, emptyTitle: { color: '#111', fontSize: 16, fontWeight: '600', textAlign: 'center' }, emptyText: { color: '#6f7b86', fontSize: 14, lineHeight: 20, textAlign: 'center' },
  primaryButton: { minHeight: 44, marginTop: 10, paddingHorizontal: 20, borderRadius: 22, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' }, primaryButtonText: { color: '#fff', fontSize: 14, fontWeight: '600' }, secondaryButton: { minHeight: 44, marginTop: 8, paddingHorizontal: 20, borderRadius: 22, backgroundColor: '#f3f5f7', alignItems: 'center', justifyContent: 'center' }, secondaryButtonText: { color: '#111', fontSize: 14, fontWeight: '600' }, sheetBody: { gap: 10 }, sheetLoader: { marginVertical: 24 }, sheetAction: { minHeight: 52, alignItems: 'center', justifyContent: 'center' }, sheetActionText: { color: '#111', fontSize: 15, fontWeight: '600' },
  personRow: { minHeight: 62, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 11 }, personCopy: { flex: 1, minWidth: 0 }, personName: { color: '#111', fontSize: 15, lineHeight: 20, fontWeight: '600' }, personUsername: { color: '#7d8894', fontSize: 12, lineHeight: 17 }, hint: { paddingVertical: 24, color: '#7d8894', fontSize: 14, textAlign: 'center' }, sendCircle: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' },
  chatIdentity: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 }, chatIdentityCopy: { flex: 1, minWidth: 0 }, chatUsername: { flexShrink: 1, marginTop: -1, color: '#6f7b86', fontSize: 12 }, securityBanner: { minHeight: 40, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }, securityBannerCopy: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 6 }, securityBannerAction: { minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: 2 }, securityBannerActionText: { color: '#53606c', fontSize: 12, lineHeight: 17, fontWeight: '600' }, securityBannerProtected: { backgroundColor: '#e8edf2' }, securityBannerText: { flexShrink: 1, color: '#53606c', fontSize: 12, lineHeight: 17 }, syncErrorBanner: { minHeight: 40, paddingHorizontal: 16, paddingVertical: 7, backgroundColor: '#fff1cf', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 }, syncErrorText: { flexShrink: 1, color: '#7d4e00', fontSize: 12, lineHeight: 17, textAlign: 'center' },
  matrixChatPrompt: { marginHorizontal: 12, marginTop: 10, padding: 12, borderRadius: 10, backgroundColor: '#f3f5f7', gap: 10 }, matrixChatPromptHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 }, matrixChatPromptIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }, matrixChatPromptTitle: { color: '#111', fontSize: 14, lineHeight: 19, fontWeight: '600' }, matrixChatPromptText: { marginTop: 2, color: '#53606c', fontSize: 12, lineHeight: 17 }, matrixChatPromptButton: { minHeight: 42, borderRadius: 21, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 }, matrixChatPromptButtonText: { color: '#fff', fontSize: 13, lineHeight: 18, fontWeight: '600' },
  blocked: { flex: 1, padding: 28, alignItems: 'center', justifyContent: 'center', gap: 10 }, blockedTitle: { color: '#111', fontSize: 18, lineHeight: 24, fontWeight: '600', textAlign: 'center' }, blockedText: { color: '#6f7b86', fontSize: 14, lineHeight: 20, textAlign: 'center' }, chatShell: { flex: 1, position: 'relative' }, messageHistory: { flex: 1, minHeight: 0, position: 'relative' }, messageScroll: { flex: 1, zIndex: 1 }, messages: { flexGrow: 1, justifyContent: 'flex-end', paddingHorizontal: 12, paddingTop: 14, paddingBottom: 34, gap: 4 }, daySeparator: { alignItems: 'center', paddingVertical: 10 }, dayText: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 14, overflow: 'hidden', color: '#6f7b86', backgroundColor: '#f3f5f7', fontSize: 12 },
  messageRow: { flexDirection: 'row', justifyContent: 'flex-start' }, messageRowOwn: { justifyContent: 'flex-end' }, messageStack: { maxWidth: '82%', alignItems: 'flex-start' }, messageStackOwn: { alignItems: 'flex-end' }, messageGroup: { borderRadius: 12, overflow: 'hidden' }, messageGroupOwn: { alignItems: 'flex-end' }, bubble: { minWidth: 74, paddingHorizontal: 12, paddingTop: 9, paddingBottom: 6, borderRadius: 12, backgroundColor: '#f3f5f7' }, bubbleOwn: { backgroundColor: '#111' }, bubbleText: { color: '#111', fontSize: 16, lineHeight: 21 }, bubbleTextOwn: { color: '#fff' }, deletedText: { color: '#6f7b86', fontSize: 14, fontStyle: 'italic' }, timestamp: { marginTop: 3, color: '#8e99a4', fontSize: 10, textAlign: 'right' }, timestampOwn: { color: '#b9c3cd' }, ownText: { color: '#fff' }, ownMuted: { color: '#b9c3cd' },
  reactionRow: { marginTop: 3, flexDirection: 'row', flexWrap: 'wrap', gap: 4 }, reactionRowOwn: { justifyContent: 'flex-end' }, reactionChip: { minHeight: 28, paddingHorizontal: 9, borderRadius: 14, backgroundColor: '#f3f5f7', alignItems: 'center', justifyContent: 'center' }, reactionChipMine: { backgroundColor: '#e8edf2' }, reactionText: { fontSize: 13 },
  attachmentCard: { minWidth: 220, padding: 12, borderRadius: 12, backgroundColor: '#f3f5f7', flexDirection: 'row', alignItems: 'center', gap: 10 }, attachmentCardOwn: { backgroundColor: '#111' }, attachmentIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }, attachmentIconOwn: { backgroundColor: '#323a43' }, attachmentTitle: { color: '#111', fontSize: 15, lineHeight: 20, fontWeight: '600' }, attachmentMeta: { color: '#6f7b86', fontSize: 12, lineHeight: 17 },
  entityCard: { minWidth: 240, maxWidth: 320, padding: 10, borderRadius: 12, backgroundColor: '#f3f5f7', flexDirection: 'row', alignItems: 'center', gap: 10 }, entityCardOwn: { backgroundColor: '#111' }, entityImage: { width: 58, height: 74, borderRadius: 4 }, entityAvatar: { width: 46, height: 46, borderRadius: 23 }, entityImageFallback: { backgroundColor: '#e8edf2', alignItems: 'center', justifyContent: 'center' }, entityTitle: { color: '#111', fontSize: 15, lineHeight: 20, fontWeight: '600' }, musicCard: { minWidth: 240, maxWidth: 320, borderRadius: 12, overflow: 'hidden', position: 'relative', backgroundColor: '#f3f5f7' }, musicProgressFill: { position: 'absolute', top: 0, bottom: 0, left: 0, backgroundColor: '#dfe5ea' }, musicProgressFillOwn: { backgroundColor: '#333' }, musicCardContent: { position: 'relative', zIndex: 1, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 10 }, musicScrubSurface: { minHeight: 48, minWidth: 0, flex: 1, position: 'relative', flexDirection: 'row', alignItems: 'center', gap: 10 }, musicScrubGestureSurface: { ...StyleSheet.absoluteFillObject, zIndex: 2 }, musicArtwork: { width: 48, height: 48, borderRadius: 4 }, playButton: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' }, playButtonOwn: { backgroundColor: '#fff' },
  draftAttachment: { marginBottom: 8, padding: 10, borderRadius: 8, backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center', gap: 10 }, draftIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#e8edf2', alignItems: 'center', justifyContent: 'center' }, draftTitle: { color: '#111', fontSize: 14, lineHeight: 19, fontWeight: '600' }, draftMeta: { color: '#6f7b86', fontSize: 12, lineHeight: 17 }, composerDock: { flexShrink: 0, backgroundColor: '#f3f5f7' }, composer: { position: 'relative', zIndex: 2, paddingTop: 8, backgroundColor: '#f3f5f7' }, composerFade: { position: 'absolute', zIndex: 0, left: 0, right: 0, bottom: 0, height: 82 }, inputShell: { height: 48, borderRadius: 24, backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center', overflow: 'hidden' }, composerIcon: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center' }, messageInput: { flex: 1, minWidth: 0, height: 46, paddingVertical: 0, paddingRight: 12, color: '#111', fontSize: 16, ...(Platform.OS === 'web' ? {} : { lineHeight: 21, textAlignVertical: 'center' as const }) }, editBar: { paddingHorizontal: 8, paddingBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 8 }, editTitle: { color: '#111', fontSize: 12, fontWeight: '600' }, editText: { marginTop: 2, color: '#6f7b86', fontSize: 12 },
  reactionPicker: { flexDirection: 'row', justifyContent: 'space-between', gap: 4 }, reactionButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#f3f5f7', alignItems: 'center', justifyContent: 'center' }, reactionButtonSelected: { backgroundColor: '#e8edf2' }, reactionEmoji: { fontSize: 22 }, customReaction: { marginTop: 8, flexDirection: 'row', gap: 8 }, customReactionInput: { flex: 1, height: 44, paddingHorizontal: 14, borderRadius: 8, borderWidth: 1, borderColor: '#d7dee5', color: '#111', fontSize: 16 }, customReactionButton: { minWidth: 100, height: 44, borderRadius: 22, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' }, customReactionButtonText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  attachmentActions: { flexDirection: 'row', gap: 8 }, attachmentAction: { flex: 1, minHeight: 78, borderRadius: 8, backgroundColor: '#f3f5f7', alignItems: 'center', justifyContent: 'center', gap: 6 }, attachmentActionText: { color: '#111', fontSize: 14, fontWeight: '600' }, sectionTitle: { marginTop: 12, color: '#6f7b86', fontSize: 14, fontWeight: '600' }, searchResult: { minHeight: 62, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', gap: 11 }, searchResultImage: { width: 44, height: 52, borderRadius: 4 }, searchResultAvatar: { width: 44, height: 44, borderRadius: 22 }, resultKind: { color: '#8e99a4', fontSize: 11 },
});

// Public presentation primitives, also used by the isolated visual catalog.
export { MatrixSecurityFlow };
export const messagingStyles = ui;
