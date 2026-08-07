import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { Image as ExpoImage } from 'expo-image';
import * as Location from 'expo-location';
import {
  Bell,
  CalendarDays,
  Check,
  ChevronLeft,
  Disc3,
  LockKeyhole,
  MapPin,
  Menu,
  MessageSquare,
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
} from 'lucide-react-native';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import {
  messagePreview,
  messagingSurfaceErrorMessage,
  type MessagingAttachment,
  type MessagingMessage,
  type MessagingPartner,
  type MessagingSurfaceController,
  type MessagingThread,
} from './messaging-surface-controller.mjs';
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

function Avatar({ partner, size = 44 }: { partner: Pick<MessagingPartner, 'avatarUrl' | 'name'>; size?: number }) {
  const frame = { width: size, height: size, borderRadius: size / 2 };
  const avatarUrl = trustedPublicMediaUrl(partner.avatarUrl);
  return <View style={[ui.avatar, frame]}>
    {avatarUrl
      ? <ExpoImage cachePolicy="memory-disk" contentFit="cover" source={{ uri: avatarUrl }} style={frame} />
      : <Text style={ui.avatarInitial}>{partner.name.slice(0, 1).toUpperCase()}</Text>}
  </View>;
}

function Header({ onBack, onOpenMenu, onOpenNotifications, title, children }: { onBack?: () => void; onOpenMenu?: () => void; onOpenNotifications?: () => void; title?: string; children?: ReactNode }) {
  return <View style={ui.header}>
    <View style={ui.headerLeft}>
      {onBack ? <Pressable accessibilityLabel="Назад" accessibilityRole="button" onPress={onBack} style={ui.iconButton}><ChevronLeft color="#111" size={29} /></Pressable> : null}
      {children ?? <Text style={ui.headerTitle}>{title}</Text>}
    </View>
    <View style={ui.headerActions}>
      {onOpenNotifications ? <Pressable accessibilityLabel="Уведомления" accessibilityRole="button" onPress={onOpenNotifications} style={ui.iconButton}><Bell color="#111" size={21} /></Pressable> : null}
      {onOpenMenu ? <Pressable accessibilityLabel="Меню" accessibilityRole="button" onPress={onOpenMenu} style={ui.iconButton}><Menu color="#111" size={23} /></Pressable> : null}
    </View>
  </View>;
}

function Sheet({ children, isVisible, onClose, title }: { children: ReactNode; isVisible: boolean; onClose: () => void; title: string }) {
  const { height: windowHeight } = useWindowDimensions();
  const dragY = useRef(new Animated.Value(0)).current;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => { if (isVisible) dragY.setValue(0); }, [dragY, isVisible]);
  const restore = useCallback(() => Animated.spring(dragY, { damping: 24, mass: 0.8, stiffness: 280, toValue: 0, useNativeDriver: Platform.OS !== 'web' }).start(), [dragY]);
  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => gesture.dy > 8 && Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.25,
    onPanResponderGrant: () => { Keyboard.dismiss(); dragY.stopAnimation(); },
    onPanResponderMove: (_event, gesture) => dragY.setValue(Math.max(0, gesture.dy)),
    onPanResponderRelease: (_event, gesture) => {
      const threshold = Math.min(160, Math.max(84, windowHeight * 0.12));
      if (gesture.dy < threshold && !(gesture.dy >= 36 && gesture.vy >= 0.9)) { restore(); return; }
      Animated.timing(dragY, { duration: 180, toValue: windowHeight, useNativeDriver: Platform.OS !== 'web' }).start(({ finished }) => {
        if (!finished) { restore(); return; }
        onCloseRef.current();
        dragY.setValue(0);
      });
    },
    onPanResponderTerminate: restore,
    onPanResponderTerminationRequest: () => false,
  }), [dragY, restore, windowHeight]);
  const backdropOpacity = dragY.interpolate({ extrapolate: 'clamp', inputRange: [0, Math.max(1, windowHeight * 0.35)], outputRange: [1, 0] });
  return <Modal animationType="slide" onRequestClose={onClose} presentationStyle="overFullScreen" transparent visible={isVisible}>
    <Pressable accessibilityLabel="Закрыть окно" onPress={onClose} style={ui.sheetBackdrop}>
      <Animated.View pointerEvents="none" style={[ui.sheetBackdropFill, { opacity: backdropOpacity }]} />
      <Animated.View style={[ui.sheetSurface, { transform: [{ translateY: dragY }] }]}>
        <Pressable accessibilityRole="none" onPress={() => undefined}>
        <View {...panResponder.panHandlers} style={[ui.sheetHeader, Platform.OS === 'web' ? ({ touchAction: 'none' } as never) : null]}><Text style={ui.sheetTitle}>{title}</Text><Pressable accessibilityLabel="Закрыть" accessibilityRole="button" hitSlop={10} onPress={onClose}><X color="#111" size={23} /></Pressable></View>
        <ScrollView contentContainerStyle={ui.sheetBody} keyboardShouldPersistTaps="handled">{children}</ScrollView>
        </Pressable>
      </Animated.View>
    </Pressable>
  </Modal>;
}

function EmptyState({ error, loading, onRetry, search }: { error?: string | null; loading?: boolean; onRetry?: () => void; search?: boolean }) {
  if (loading) return <View style={ui.empty}><ActivityIndicator color="#111" /><Text style={ui.emptyText}>Загружаем диалоги…</Text></View>;
  return <View style={ui.empty}>
    <MessageSquare color="#7d8894" size={29} />
    <Text style={ui.emptyTitle}>{error ? 'Не удалось загрузить сообщения' : search ? 'Ничего не найдено' : 'Сообщений пока нет'}</Text>
    <Text style={ui.emptyText}>{error ?? (search ? 'Попробуйте изменить поисковый запрос.' : 'Начните диалог с человеком из VOLNA.')}</Text>
    {error && onRetry ? <Pressable accessibilityRole="button" onPress={onRetry} style={ui.secondaryButton}><Text style={ui.secondaryButtonText}>Повторить</Text></Pressable> : null}
  </View>;
}

export function VolnaMessagesScreen({
  accountId,
  controller,
  onActivity,
  onBack,
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
  const [threads, setThreads] = useState<MessagingThread[]>([]);
  const [query, setQuery] = useState('');
  const [localMatchThreadIds, setLocalMatchThreadIds] = useState<Set<string>>(() => new Set());
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [newMessageOpen, setNewMessageOpen] = useState(false);
  const loadRef = useRef<Promise<void> | null>(null);

  const load = useCallback(async (reset = true) => {
    if (loadRef.current) return loadRef.current;
    const work = (async () => {
      if (reset) setLoadError(null);
      else setLoadingMore(true);
      try {
        const page = await controller.listThreads(accountId, { cursor: reset ? null : nextCursor });
        setThreads((current) => reset ? page.items : [...current, ...page.items.filter((item) => !current.some((stored) => stored.id === item.id))]);
        setNextCursor(page.nextCursor);
      } catch (error) {
        if (reset) setLoadError(messagingSurfaceErrorMessage(error));
      } finally {
        setLoading(false);
        setLoadingMore(false);
        setRefreshing(false);
      }
    })();
    loadRef.current = work;
    try { await work; } finally { if (loadRef.current === work) loadRef.current = null; }
  }, [accountId, controller, nextCursor]);

  useEffect(() => { void load(true); }, [accountId]);
  useEffect(() => {
    let dispose: (() => void) | undefined;
    let active = true;
    void controller.subscribeRealtime({ accountId, onActivity, onEncryptedEnvelope: () => void load(true), onThreadUpdated: () => void load(true) }).then((cleanup) => {
      if (active) dispose = cleanup;
      else cleanup();
    }).catch(() => undefined);
    return () => { active = false; dispose?.(); };
  }, [accountId, controller, load, onActivity]);

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
    if (unresolvedLocalMatch && nextCursor && !loading && !loadingMore && !loadRef.current) {
      void load(false);
    }
  }, [load, loading, loadingMore, nextCursor, unresolvedLocalMatch]);
  const visibleThreads = useMemo(() => normalized ? threads.filter((thread) => (
    `${thread.partner.name} ${thread.partner.username} ${thread.lastMessageText ?? ''}`.toLocaleLowerCase('ru-RU').includes(normalized)
    || localMatchThreadIds.has(thread.id)
  )) : threads, [localMatchThreadIds, normalized, threads]);

  return <View style={ui.screen}>
    <Header onBack={onBack} onOpenMenu={onOpenMenu} onOpenNotifications={onOpenNotifications} title="Сообщения" />
    <View style={ui.threadToolbar}>
      <View style={ui.searchField}><Search color="#7d8894" size={19} /><TextInput accessibilityLabel="Поиск по сообщениям" onChangeText={setQuery} placeholder="Поиск" placeholderTextColor="#98a3ae" style={ui.searchInput} value={query} />{query ? <Pressable accessibilityLabel="Очистить поиск" onPress={() => setQuery('')} style={ui.smallIconButton}><X color="#6f7b86" size={17} /></Pressable> : null}</View>
      <Pressable accessibilityLabel="Новое сообщение" accessibilityRole="button" onPress={() => setNewMessageOpen(true)} style={ui.composeButton}><SquarePen color="#111" size={23} /></Pressable>
    </View>
    <FlatList
      contentContainerStyle={visibleThreads.length ? ui.threadList : ui.threadListEmpty}
      data={visibleThreads}
      keyExtractor={(item) => item.id}
      ListEmptyComponent={<EmptyState error={loadError} loading={loading} onRetry={() => void load(true)} search={Boolean(normalized)} />}
      ListFooterComponent={loadingMore ? <ActivityIndicator color="#111" style={ui.footerLoader} /> : null}
      onEndReached={() => { if (nextCursor && !loadingMore) void load(false); }}
      onEndReachedThreshold={0.35}
      refreshControl={<RefreshControl onRefresh={() => { setRefreshing(true); void load(true); }} refreshing={refreshing} tintColor="#111" />}
      renderItem={({ item }) => <Pressable accessibilityLabel={`Открыть чат с ${item.partner.name}`} accessibilityRole="button" onPress={() => void onOpenChat(item.partner.username)} style={ui.threadRow}>
        <Avatar partner={item.partner} />
        <View style={ui.threadCopy}>
          <View style={ui.threadHeader}><View style={ui.threadNameLine}><VerifiedName isVerified={item.partner.isVerified} name={item.partner.name} style={ui.threadName} /><Text numberOfLines={1} style={ui.threadUsername}>@{item.partner.username}</Text></View><Text style={ui.threadTime}>{formatChatTime(item.lastMessageAt)}</Text></View>
          <View style={ui.threadMeta}><Text numberOfLines={1} style={ui.threadPreview}>{item.lastMessageText || 'Чат создан'}</Text>{item.encryptionMode === 'MLS_V1' ? <LockKeyhole color="#6f7b86" size={13} /> : null}{item.unreadCount > 0 ? <View style={ui.unreadBadge}><Text style={ui.unreadText}>{item.unreadCount > 99 ? '99+' : item.unreadCount}</Text></View> : null}</View>
        </View>
      </Pressable>}
      showsVerticalScrollIndicator={false}
    />
    <NewMessageSheet controller={controller} isVisible={newMessageOpen} onClose={() => setNewMessageOpen(false)} onOpenChat={onOpenChat} ownUsername={ownUsername} />
  </View>;
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
    {loading ? <ActivityIndicator color="#111" style={ui.sheetLoader} /> : results.map((profile) => <Pressable key={profile.id} onPress={() => { onClose(); void onOpenChat(profile.username); }} style={ui.personRow}><Avatar partner={profile} /><View style={ui.personCopy}><VerifiedName isVerified={profile.isVerified} name={profile.name} style={ui.personName} /><Text style={ui.personUsername}>@{profile.username}</Text></View></Pressable>)}
    {!loading && normalized.length > 0 && normalized.length < 3 ? <Text style={ui.hint}>Введите минимум 3 символа</Text> : null}
    {!loading && normalized.length >= 3 && !results.length ? <Text style={ui.hint}>Пользователи не найдены</Text> : null}
  </Sheet>;
}

type AudioContextValue = { activeId: string | null; playing: boolean; toggle: (id: string, attachment: Extract<MessagingAttachment, { kind: 'music' }>) => void };
const AudioContext = createContext<AudioContextValue | null>(null);

function MessagingAudioProvider({ children }: { children: ReactNode }) {
  const player = useAudioPlayer(null, { updateInterval: 250 });
  const status = useAudioPlayerStatus(player);
  const [activeId, setActiveId] = useState<string | null>(null);
  const loadedUrlRef = useRef<string | null>(null);
  const toggle = useCallback((id: string, attachment: Extract<MessagingAttachment, { kind: 'music' }>) => {
    const metadata = attachment.metadata ?? {};
    const previewUrl = safeHttpsUrl(metadata.previewUrl);
    const externalUrl = safeHttpsUrl(metadata.externalUrl);
    if (activeId === id && status.playing) { player.pause(); return; }
    if (previewUrl) {
      if (loadedUrlRef.current !== previewUrl) { player.replace(previewUrl); loadedUrlRef.current = previewUrl; }
      setActiveId(id);
      player.play();
      return;
    }
    if (externalUrl) void Linking.openURL(externalUrl);
  }, [activeId, player, status.playing]);
  useEffect(() => () => { player.pause(); }, [player]);
  return <AudioContext.Provider value={{ activeId, playing: Boolean(status.playing), toggle }}>{children}</AudioContext.Provider>;
}

export function VolnaChatScreen({
  accountId,
  controller,
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
  const [text, setText] = useState('');
  const [attachment, setAttachment] = useState<MessagingAttachment | null>(null);
  const [sending, setSending] = useState(false);
  const [attachmentOpen, setAttachmentOpen] = useState(false);
  const [musicOpen, setMusicOpen] = useState(false);
  const [messageMenu, setMessageMenu] = useState<MessagingMessage | null>(null);
  const [editing, setEditing] = useState<MessagingMessage | null>(null);
  const [customReaction, setCustomReaction] = useState('');
  const scrollRef = useRef<ScrollView>(null);

  const open = useCallback(async (allowActivation = true, showLoading = true) => {
    if (showLoading) {
      setThread(null);
      setLoading(true);
      setLoadError(null);
    }
    try {
      setThread(await controller.openThread(accountId, partnerUsername, { allowActivation }));
      setSyncError(null);
    }
    catch (error) {
      if (showLoading) setLoadError(error);
      else setSyncError(error);
    }
    finally { if (showLoading) setLoading(false); }
  }, [accountId, controller, partnerUsername]);
  useEffect(() => { void open(true); }, [open]);

  useEffect(() => {
    if (!thread) return;
    let dispose: (() => void) | undefined;
    let active = true;
    void controller.subscribeRealtime({
      accountId,
      thread,
      onActivity,
      onEncryptedEnvelope: (threadId) => { if (threadId === thread.id) void open(false, false); },
      onLegacyMessage: (message) => { if (message.threadId === thread.id) setThread((current) => current ? { ...current, lastMessageAt: message.createdAt, lastMessageText: messagePreview(message), messages: [...current.messages.filter((item) => item.id !== message.id), message] } : current); },
      onLegacyReaction: (change) => { if (change.threadId === thread.id) setThread((current) => current ? { ...current, messages: current.messages.map((message) => message.id !== change.messageId ? message : { ...message, reactions: [...message.reactions.filter((reaction) => reaction.accountId !== change.accountId), ...(change.emoji ? [{ accountId: change.accountId, emoji: change.emoji }] : [])] }) } : current); },
    }).then((cleanup) => { if (active) dispose = cleanup; else cleanup(); }).catch(() => undefined);
    return () => { active = false; dispose?.(); };
  }, [accountId, controller, onActivity, open, thread?.id, thread?.encryptionMode]);

  const hasContent = Boolean(text.trim() || attachment);
  const send = async () => {
    if (!thread || sending) return;
    const trimmed = text.trim();
    if (editing) {
      if (!trimmed) return;
      setSending(true);
      try { setThread({ ...thread, messages: await controller.editMessage(accountId, thread, editing.id, trimmed) }); setText(''); setEditing(null); }
      catch (error) { Alert.alert('Сообщения', messagingSurfaceErrorMessage(error)); }
      finally { setSending(false); }
      return;
    }
    if (!trimmed && !attachment) return;
    setSending(true);
    try {
      const messages = await controller.sendMessage(accountId, thread, { ...(trimmed ? { text: trimmed } : {}), ...(attachment ? { attachment } : {}) });
      const last = messages.at(-1);
      setThread({ ...thread, messages, lastMessageAt: last?.createdAt ?? thread.lastMessageAt, lastMessageText: messagePreview(last) });
      setText('');
      setAttachment(null);
      onActivity?.();
    } catch (error) { Alert.alert('Сообщения', messagingSurfaceErrorMessage(error)); }
    finally { setSending(false); }
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

  if (loading && !thread) return <View style={ui.screen}><Header onBack={onBack} title="Сообщения" /><View style={ui.center}><ActivityIndicator color="#111" /></View></View>;
  if (loadError || !thread) {
    const setupRequired = errorCode(loadError) === 'security_setup_required';
    return <View style={ui.screen}><Header onBack={onBack} title="Сообщения" /><View style={ui.blocked}><ShieldAlert color="#111" size={34} /><Text style={ui.blockedTitle}>{setupRequired ? 'Настройте защищённые сообщения' : 'Чат временно недоступен'}</Text><Text style={ui.blockedText}>{messagingSurfaceErrorMessage(loadError)}</Text>{setupRequired && onOpenMessageSecurity ? <Pressable onPress={onOpenMessageSecurity} style={ui.primaryButton}><Text style={ui.primaryButtonText}>Открыть настройку</Text></Pressable> : <Pressable onPress={() => void open(true)} style={ui.secondaryButton}><Text style={ui.secondaryButtonText}>Повторить</Text></Pressable>}</View></View>;
  }

  return <MessagingAudioProvider><View style={ui.screen}>
    <Header onBack={onBack}>
      <Pressable accessibilityLabel={`Открыть профиль ${thread.partner.name}`} onPress={() => void onOpenProfile(thread.partner.username)} style={ui.chatIdentity}><Avatar partner={thread.partner} size={38} /><View style={ui.chatIdentityCopy}><VerifiedName isVerified={thread.partner.isVerified} name={thread.partner.name} style={ui.headerTitle} /><Text style={ui.chatUsername}>@{thread.partner.username}</Text></View></Pressable>
    </Header>
    <View style={[ui.securityBanner, thread.encryptionMode === 'MLS_V1' ? ui.securityBannerProtected : ui.securityBannerLegacy]}>{thread.encryptionMode === 'MLS_V1' ? <LockKeyhole color="#323a43" size={14} /> : <ShieldAlert color="#6f7b86" size={14} />}<Text style={ui.securityBannerText}>{thread.encryptionMode === 'MLS_V1' ? 'Сквозное шифрование · сервер не видит содержимое' : 'Обычный чат · содержимое доступно серверу'}</Text></View>
    {syncError ? <View accessibilityRole="alert" style={ui.syncErrorBanner}><ShieldAlert color="#7d4e00" size={14} /><Text style={ui.syncErrorText}>{`Безопасная синхронизация приостановлена: ${messagingSurfaceErrorMessage(syncError)}`}</Text></View> : null}
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={ui.chatShell}>
      <ScrollView contentContainerStyle={ui.messages} onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })} ref={scrollRef} showsVerticalScrollIndicator={false}>
        {thread.messages.map((message, index) => <MessageRow accountId={accountId} key={message.id} message={message} onLongPress={() => setMessageMenu(message)} onOpenEvent={onOpenEvent} onOpenProfile={onOpenProfile} onOpenPublicPage={onOpenPublicPage} onReact={(emoji) => void react(message, emoji)} previous={thread.messages[index - 1]} />)}
      </ScrollView>
      {attachment ? <DraftAttachment attachment={attachment} onRemove={() => setAttachment(null)} /> : null}
      <View style={ui.composer}>
        {editing ? <View style={ui.editBar}><View style={ui.flex}><Text style={ui.editTitle}>Редактирование сообщения</Text><Text numberOfLines={1} style={ui.editText}>{editing.text}</Text></View><Pressable accessibilityLabel="Отменить редактирование" onPress={() => { setEditing(null); setText(''); }} style={ui.smallIconButton}><X color="#6f7b86" size={19} /></Pressable></View> : null}
        <View style={ui.inputShell}>
          <Pressable accessibilityLabel="Прикрепить" accessibilityRole="button" disabled={Boolean(editing)} onPress={() => setAttachmentOpen(true)} style={ui.composerIcon}><Paperclip color={editing ? '#aab4be' : '#111'} size={21} /></Pressable>
          <TextInput maxLength={1000} multiline onChangeText={setText} placeholder="Сообщение" placeholderTextColor="#98a3ae" style={ui.messageInput} value={text} />
          {hasContent ? <Pressable accessibilityLabel="Отправить сообщение" accessibilityRole="button" disabled={sending} onPress={() => void send()} style={ui.composerIcon}>{sending ? <ActivityIndicator color="#111" size="small" /> : <Send color="#111" size={21} />}</Pressable> : null}
        </View>
      </View>
    </KeyboardAvoidingView>
    <AttachmentSheet controller={controller} isVisible={attachmentOpen} onClose={() => setAttachmentOpen(false)} onMusic={() => { setAttachmentOpen(false); setMusicOpen(true); }} onSelect={(value) => { setAttachment(value); setAttachmentOpen(false); }} />
    <MusicSheet controller={controller} isVisible={musicOpen} onClose={() => setMusicOpen(false)} onSelect={(value) => { setAttachment(value); setMusicOpen(false); }} />
    <Sheet isVisible={Boolean(messageMenu)} onClose={() => setMessageMenu(null)} title="Реакция">
      <View style={ui.reactionPicker}>{REACTIONS.map((emoji) => { const selected = messageMenu?.reactions.some((reaction) => reaction.accountId === accountId && reaction.emoji === emoji) === true; return <Pressable accessibilityLabel={`Реакция ${emoji}`} accessibilityState={{ selected }} key={emoji} onPress={() => messageMenu && void react(messageMenu, emoji)} style={[ui.reactionButton, selected && ui.reactionButtonSelected]}><Text style={ui.reactionEmoji}>{emoji}</Text></Pressable>; })}</View>
      <View style={ui.customReaction}><TextInput maxLength={32} onChangeText={setCustomReaction} placeholder="Любой эмодзи" placeholderTextColor="#98a3ae" style={ui.customReactionInput} value={customReaction} /><Pressable disabled={!customReaction.trim()} onPress={() => messageMenu && void react(messageMenu, customReaction)} style={ui.customReactionButton}><Text style={ui.customReactionButtonText}>Добавить</Text></Pressable></View>
      {messageMenu?.senderAccountId === accountId && messageMenu.text && Date.now() - Date.parse(messageMenu.createdAt) <= 60_000 ? <Pressable onPress={() => { setEditing(messageMenu); setText(messageMenu.text ?? ''); setAttachment(null); setMessageMenu(null); }} style={ui.sheetAction}><Text style={ui.sheetActionText}>Редактировать</Text></Pressable> : null}
    </Sheet>
  </View></MessagingAudioProvider>;
}

function MessageRow({ accountId, message, onLongPress, onOpenEvent, onOpenProfile, onOpenPublicPage, onReact, previous }: { accountId: string; message: MessagingMessage; onLongPress: () => void; onOpenEvent: (eventId: string) => void; onOpenProfile: (username: string) => void | Promise<void>; onOpenPublicPage: (username: string) => void | Promise<void>; onReact: (emoji: string) => void; previous?: MessagingMessage }) {
  const own = message.senderAccountId === accountId;
  const showDay = !previous || dayKey(previous.createdAt) !== dayKey(message.createdAt);
  const reactions = Object.entries(message.reactions.reduce<Record<string, { count: number; mine: boolean }>>((result, reaction) => { const current = result[reaction.emoji] ?? { count: 0, mine: false }; result[reaction.emoji] = { count: current.count + 1, mine: current.mine || reaction.accountId === accountId }; return result; }, {}));
  return <View>{showDay ? <View style={ui.daySeparator}><Text style={ui.dayText}>{formatDay(message.createdAt)}</Text></View> : null}<View style={[ui.messageRow, own && ui.messageRowOwn]}><View style={[ui.messageStack, own && ui.messageStackOwn]}><Pressable delayLongPress={350} onLongPress={onLongPress} style={[ui.messageGroup, own && ui.messageGroupOwn]}>
    {message.deletedAt ? <View style={[ui.bubble, own && ui.bubbleOwn]}><Text style={[ui.deletedText, own && ui.ownMuted]}>Сообщение удалено</Text><Timestamp label={formatClock(message.createdAt)} own={own} /></View> : <>
      {message.attachment ? <AttachmentCard attachment={message.attachment} messageId={message.id} onOpenEvent={onOpenEvent} onOpenProfile={onOpenProfile} onOpenPublicPage={onOpenPublicPage} own={own} /> : null}
      {message.text ? <View style={[ui.bubble, own && ui.bubbleOwn]}><Text style={[ui.bubbleText, own && ui.bubbleTextOwn]}>{message.text}</Text><Timestamp label={message.editedAt ? `изменено ${formatClock(message.editedAt)}` : formatClock(message.createdAt)} own={own} /></View> : !message.attachment ? <View style={[ui.bubble, own && ui.bubbleOwn]}><Text style={[ui.deletedText, own && ui.ownMuted]}>Неподдерживаемое сообщение</Text></View> : null}
    </>}
  </Pressable>{reactions.length ? <View style={[ui.reactionRow, own && ui.reactionRowOwn]}>{reactions.map(([emoji, value]) => <Pressable accessibilityLabel={`Реакция ${emoji}, ${value.count}`} accessibilityState={{ selected: value.mine }} key={emoji} onPress={() => onReact(emoji)} style={[ui.reactionChip, value.mine && ui.reactionChipMine]}><Text style={ui.reactionText}>{emoji}{value.count > 1 ? ` ${value.count}` : ''}</Text></Pressable>)}</View> : null}</View></View></View>;
}

function Timestamp({ label, own }: { label: string; own: boolean }) { return <Text style={[ui.timestamp, own && ui.timestampOwn]}>{label}</Text>; }

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
  return <Pressable accessibilityLabel={`Открыть ${name}`} disabled={!targetUsername} onPress={press} style={[ui.entityCard, own && ui.entityCardOwn]}>{image ? <ExpoImage cachePolicy="memory-disk" contentFit="cover" source={{ uri: image }} style={ui.entityAvatar} /> : <View style={[ui.entityAvatar, ui.entityImageFallback]}>{attachment.entityType === 'account' ? <UserRound color={own ? '#fff' : '#6f7b86'} size={22} /> : <UsersRound color={own ? '#fff' : '#6f7b86'} size={22} />}</View>}<View style={ui.flex}><VerifiedName inverted={own} isVerified={snapshot.isVerified === true} name={name} style={[ui.entityTitle, own && ui.ownText]} />{targetUsername ? <Text style={[ui.attachmentMeta, own && ui.ownMuted]}>@{targetUsername}</Text> : null}{typeof snapshot.subtitle === 'string' ? <Text numberOfLines={2} style={[ui.attachmentMeta, own && ui.ownMuted]}>{snapshot.subtitle}</Text> : null}</View></Pressable>;
}

function MusicCard({ attachment, messageId, own }: { attachment: Extract<MessagingAttachment, { kind: 'music' }>; messageId: string; own: boolean }) {
  const audio = useContext(AudioContext);
  const artwork = trustedPublicMediaUrl(attachment.metadata?.artworkUrl);
  const active = audio?.activeId === messageId && audio.playing;
  return <Pressable accessibilityLabel={`${active ? 'Поставить на паузу' : 'Воспроизвести'} ${attachment.title}`} onPress={() => audio?.toggle(messageId, attachment)} style={[ui.musicCard, own && ui.attachmentCardOwn]}>{artwork ? <ExpoImage cachePolicy="memory-disk" contentFit="cover" source={{ uri: artwork }} style={ui.musicArtwork} /> : <View style={[ui.musicArtwork, ui.entityImageFallback]}><Disc3 color="#6f7b86" size={21} /></View>}<View style={ui.flex}><Text numberOfLines={1} style={[ui.attachmentTitle, own && ui.ownText]}>{attachment.title}</Text><Text numberOfLines={1} style={[ui.attachmentMeta, own && ui.ownMuted]}>{attachment.artist}</Text></View><View style={[ui.playButton, own && ui.playButtonOwn]}>{active ? <Pause color={own ? '#111' : '#fff'} size={13} /> : <Play color={own ? '#111' : '#fff'} fill={own ? '#111' : '#fff'} size={12} />}</View></Pressable>;
}

function DraftAttachment({ attachment, onRemove }: { attachment: MessagingAttachment; onRemove: () => void }) {
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
    <View style={ui.attachmentActions}><Pressable onPress={onMusic} style={ui.attachmentAction}><View style={ui.draftIcon}><Disc3 color="#111" size={23} /></View><Text style={ui.attachmentActionText}>Музыка</Text></Pressable><Pressable disabled={locating} onPress={() => void location()} style={ui.attachmentAction}><View style={ui.draftIcon}>{locating ? <ActivityIndicator color="#111" /> : <MapPin color="#111" size={23} />}</View><Text style={ui.attachmentActionText}>Геопозиция</Text></Pressable></View>
    <Text style={ui.sectionTitle}>Профиль, сообщество или событие</Text>
    <View style={ui.searchField}><Search color="#7d8894" size={19} /><TextInput autoCapitalize="none" onChangeText={setQuery} placeholder="Название или @юзернейм" placeholderTextColor="#98a3ae" style={ui.searchInput} value={query} /></View>
    {loading ? <ActivityIndicator color="#111" style={ui.sheetLoader} /> : <>{results.accounts.map((item) => <SearchResult key={`a-${String(item.id)}`} item={item} kind="account" onPress={() => onSelect(entity(item, 'account'))} />)}{results.communities.map((item) => <SearchResult key={`p-${String(item.id)}`} item={item} kind="community" onPress={() => onSelect(entity(item, 'publicPage'))} />)}{results.events.map((item) => <SearchResult key={`e-${String(item.id)}`} item={item} kind="event" onPress={() => onSelect(event(item))} />)}</>}
    {!loading && query.trim().length > 0 && query.trim().length < 3 ? <Text style={ui.hint}>Введите минимум 3 символа</Text> : null}
  </Sheet>;
}

function SearchResult({ item, kind, onPress }: { item: Record<string, unknown>; kind: 'account' | 'community' | 'event'; onPress: () => void }) {
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
    {loading ? <ActivityIndicator color="#111" style={ui.sheetLoader} /> : visible.map((track, index) => { const attachment = musicAttachment(track); const artwork = trustedPublicMediaUrl(attachment.metadata?.artworkUrl); return <Pressable key={`${attachment.provider}:${attachment.id}:${index}`} onPress={() => onSelect(attachment)} style={ui.searchResult}>{artwork ? <ExpoImage cachePolicy="memory-disk" contentFit="cover" source={{ uri: artwork }} style={ui.searchResultImage} /> : <View style={[ui.searchResultImage, ui.entityImageFallback]}><Disc3 color="#6f7b86" size={21} /></View>}<View style={ui.flex}><Text numberOfLines={1} style={ui.personName}>{attachment.title}</Text><Text numberOfLines={1} style={ui.personUsername}>{attachment.artist}</Text></View></Pressable>; })}
    {!loading && !visible.length ? <Text style={ui.hint}>Добавьте музыку в профиль или найдите трек</Text> : null}
  </Sheet>;
}

export function MessagingShareTargets({ accountId, controller, draft, enabled = true, onError, onSent }: { accountId?: string; controller: MessagingSurfaceController; draft: { text?: string; attachment?: MessagingAttachment }; enabled?: boolean; onError?: (message: string) => void; onSent?: (username: string) => void }) {
  const [query, setQuery] = useState('');
  const [profiles, setProfiles] = useState<MessagingPartner[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const normalized = query.trim().replace(/^@/, '');
  useEffect(() => {
    if (!enabled) { setProfiles([]); setLoading(false); return; }
    if (normalized.length > 0 && normalized.length < 3) { setProfiles([]); return; }
    let active = true;
    const timer = setTimeout(() => { setLoading(true); void controller.searchProfiles(normalized, { shareRecipients: true }).then((items) => { if (active) setProfiles(items); }).catch((error) => { if (active) onError?.(messagingSurfaceErrorMessage(error)); }).finally(() => { if (active) setLoading(false); }); }, normalized.length >= 3 ? SEARCH_DELAY_MS : 0);
    return () => { active = false; clearTimeout(timer); };
  }, [controller, enabled, normalized, onError]);
  const send = async (profile: MessagingPartner) => {
    setSending(profile.username);
    try { const resolvedAccountId = accountId ?? await controller.resolveOwnAccountId(); const thread = await controller.openThread(resolvedAccountId, profile.username); await controller.sendMessage(resolvedAccountId, thread, draft); onSent?.(profile.username); }
    catch (error) { onError?.(messagingSurfaceErrorMessage(error)); }
    finally { setSending(null); }
  };
  return <><View style={ui.searchField}><Search color="#7d8894" size={19} /><TextInput autoCapitalize="none" onChangeText={setQuery} placeholder="Имя или @юзернейм" placeholderTextColor="#98a3ae" style={ui.searchInput} value={query} /></View>{loading ? <ActivityIndicator color="#111" style={ui.sheetLoader} /> : profiles.map((profile) => <Pressable accessibilityLabel={`Отправить пользователю ${profile.name}`} disabled={Boolean(sending)} key={profile.id} onPress={() => void send(profile)} style={ui.personRow}><Avatar partner={profile} /><View style={ui.personCopy}><VerifiedName isVerified={profile.isVerified} name={profile.name} style={ui.personName} /><Text style={ui.personUsername}>@{profile.username}</Text></View><View style={ui.sendCircle}>{sending === profile.username ? <ActivityIndicator color="#fff" size="small" /> : <Send color="#fff" fill="#fff" size={15} />}</View></Pressable>)}</>;
}

function formatChatTime(value: string | null) { if (!value) return ''; const date = new Date(value); const now = new Date(); return dayKey(value) === dayKey(now.toISOString()) ? formatClock(value) : new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit' }).format(date); }
function formatClock(value: string) { return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date(value)); }
function dayKey(value: string) { const date = new Date(value); return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`; }
function formatDay(value: string) { const date = new Date(value); if (!Number.isFinite(date.getTime())) return ''; const today = new Date(); const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1); if (dayKey(value) === dayKey(today.toISOString())) return 'Сегодня'; if (dayKey(value) === dayKey(yesterday.toISOString())) return 'Вчера'; return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', ...(date.getFullYear() !== today.getFullYear() ? { year: 'numeric' as const } : {}) }).format(date); }

const ui = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' }, flex: { flex: 1, minWidth: 0 }, center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { height: 52, paddingHorizontal: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#d7dee5', backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerLeft: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center' }, headerActions: { flexDirection: 'row', alignItems: 'center' }, headerTitle: { color: '#111', fontSize: 16, lineHeight: 21, fontWeight: '600' },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, smallIconButton: { width: 36, height: 44, alignItems: 'center', justifyContent: 'center' },
  verifiedRow: { minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 4 }, verifiedName: { flexShrink: 1 },
  avatar: { overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f3f5f7' }, avatarInitial: { color: '#111', fontSize: 15, fontWeight: '600' },
  threadToolbar: { paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', gap: 8 }, searchField: { flex: 1, minHeight: 44, paddingHorizontal: 14, borderRadius: 8, borderWidth: 1, borderColor: '#d7dee5', backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center', gap: 9 }, searchInput: { flex: 1, minWidth: 0, height: 44, paddingVertical: 0, color: '#111', fontSize: 16 },
  composeButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f3f5f7' }, threadList: { paddingHorizontal: 10, paddingBottom: 24 }, threadListEmpty: { flexGrow: 1 },
  threadRow: { minHeight: 68, paddingHorizontal: 8, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 11 }, threadCopy: { flex: 1, minWidth: 0 }, threadHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }, threadNameLine: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 5 }, threadName: { color: '#111', fontSize: 15, lineHeight: 20, fontWeight: '600' }, threadUsername: { flexShrink: 1, color: '#8e99a4', fontSize: 12 }, threadTime: { color: '#8e99a4', fontSize: 12 }, threadMeta: { marginTop: 3, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 6 }, threadPreview: { flex: 1, color: '#6f7b86', fontSize: 14 }, unreadBadge: { minWidth: 20, height: 18, paddingHorizontal: 5, borderRadius: 9, backgroundColor: '#8e99a4', alignItems: 'center', justifyContent: 'center' }, unreadText: { color: '#fff', fontSize: 10, fontWeight: '600' }, footerLoader: { marginVertical: 16 },
  empty: { minHeight: 176, flex: 1, padding: 24, alignItems: 'center', justifyContent: 'center', gap: 8 }, emptyTitle: { color: '#111', fontSize: 16, fontWeight: '600', textAlign: 'center' }, emptyText: { color: '#6f7b86', fontSize: 14, lineHeight: 20, textAlign: 'center' },
  primaryButton: { minHeight: 44, marginTop: 10, paddingHorizontal: 20, borderRadius: 22, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' }, primaryButtonText: { color: '#fff', fontSize: 14, fontWeight: '600' }, secondaryButton: { minHeight: 44, marginTop: 8, paddingHorizontal: 20, borderRadius: 22, backgroundColor: '#f3f5f7', alignItems: 'center', justifyContent: 'center' }, secondaryButtonText: { color: '#111', fontSize: 14, fontWeight: '600' },
  sheetBackdrop: { flex: 1, paddingTop: 70, justifyContent: 'flex-end', alignItems: 'center' }, sheetBackdropFill: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.64)' }, sheetSurface: { width: '100%', maxWidth: 600, maxHeight: '88%', borderTopLeftRadius: 12, borderTopRightRadius: 12, backgroundColor: '#fff', overflow: 'hidden' }, sheetHeader: { minHeight: 64, paddingLeft: 20, paddingRight: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, sheetTitle: { color: '#111', fontSize: 20, lineHeight: 26, fontWeight: '600' }, sheetBody: { paddingHorizontal: 16, paddingBottom: 22, gap: 8 }, sheetLoader: { marginVertical: 24 }, sheetAction: { minHeight: 52, alignItems: 'center', justifyContent: 'center' }, sheetActionText: { color: '#111', fontSize: 15, fontWeight: '600' },
  personRow: { minHeight: 62, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 11 }, personCopy: { flex: 1, minWidth: 0 }, personName: { color: '#111', fontSize: 15, lineHeight: 20, fontWeight: '600' }, personUsername: { color: '#7d8894', fontSize: 12, lineHeight: 17 }, hint: { paddingVertical: 24, color: '#7d8894', fontSize: 14, textAlign: 'center' }, sendCircle: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' },
  chatIdentity: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 }, chatIdentityCopy: { flex: 1, minWidth: 0 }, chatUsername: { marginTop: -1, color: '#6f7b86', fontSize: 12 }, securityBanner: { minHeight: 34, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }, securityBannerProtected: { backgroundColor: '#e8edf2' }, securityBannerLegacy: { backgroundColor: '#f3f5f7' }, securityBannerText: { color: '#53606c', fontSize: 12, lineHeight: 17 }, syncErrorBanner: { minHeight: 40, paddingHorizontal: 16, paddingVertical: 7, backgroundColor: '#fff1cf', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 }, syncErrorText: { flexShrink: 1, color: '#7d4e00', fontSize: 12, lineHeight: 17, textAlign: 'center' },
  blocked: { flex: 1, padding: 28, alignItems: 'center', justifyContent: 'center', gap: 10 }, blockedTitle: { color: '#111', fontSize: 18, lineHeight: 24, fontWeight: '600', textAlign: 'center' }, blockedText: { color: '#6f7b86', fontSize: 14, lineHeight: 20, textAlign: 'center' }, chatShell: { flex: 1 }, messages: { flexGrow: 1, justifyContent: 'flex-end', paddingHorizontal: 12, paddingVertical: 14, gap: 4 }, daySeparator: { alignItems: 'center', paddingVertical: 10 }, dayText: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 14, overflow: 'hidden', color: '#6f7b86', backgroundColor: '#f3f5f7', fontSize: 12 },
  messageRow: { flexDirection: 'row', justifyContent: 'flex-start' }, messageRowOwn: { justifyContent: 'flex-end' }, messageStack: { maxWidth: '82%', alignItems: 'flex-start' }, messageStackOwn: { alignItems: 'flex-end' }, messageGroup: { borderRadius: 12, overflow: 'hidden' }, messageGroupOwn: { alignItems: 'flex-end' }, bubble: { minWidth: 74, paddingHorizontal: 12, paddingTop: 9, paddingBottom: 6, borderRadius: 12, backgroundColor: '#f3f5f7' }, bubbleOwn: { backgroundColor: '#111' }, bubbleText: { color: '#111', fontSize: 16, lineHeight: 21 }, bubbleTextOwn: { color: '#fff' }, deletedText: { color: '#6f7b86', fontSize: 14, fontStyle: 'italic' }, timestamp: { marginTop: 3, color: '#8e99a4', fontSize: 10, textAlign: 'right' }, timestampOwn: { color: '#b9c3cd' }, ownText: { color: '#fff' }, ownMuted: { color: '#b9c3cd' },
  reactionRow: { marginTop: 3, flexDirection: 'row', flexWrap: 'wrap', gap: 4 }, reactionRowOwn: { justifyContent: 'flex-end' }, reactionChip: { minHeight: 28, paddingHorizontal: 9, borderRadius: 14, backgroundColor: '#f3f5f7', alignItems: 'center', justifyContent: 'center' }, reactionChipMine: { backgroundColor: '#e8edf2' }, reactionText: { fontSize: 13 },
  attachmentCard: { minWidth: 220, padding: 12, borderRadius: 12, backgroundColor: '#f3f5f7', flexDirection: 'row', alignItems: 'center', gap: 10 }, attachmentCardOwn: { backgroundColor: '#111' }, attachmentIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }, attachmentIconOwn: { backgroundColor: '#323a43' }, attachmentTitle: { color: '#111', fontSize: 15, lineHeight: 20, fontWeight: '600' }, attachmentMeta: { color: '#6f7b86', fontSize: 12, lineHeight: 17 },
  entityCard: { minWidth: 240, maxWidth: 320, padding: 10, borderRadius: 12, backgroundColor: '#f3f5f7', flexDirection: 'row', alignItems: 'center', gap: 10 }, entityCardOwn: { backgroundColor: '#111' }, entityImage: { width: 58, height: 74, borderRadius: 4 }, entityAvatar: { width: 46, height: 46, borderRadius: 23 }, entityImageFallback: { backgroundColor: '#e8edf2', alignItems: 'center', justifyContent: 'center' }, entityTitle: { color: '#111', fontSize: 15, lineHeight: 20, fontWeight: '600' }, musicCard: { minWidth: 240, maxWidth: 320, padding: 10, borderRadius: 12, backgroundColor: '#f3f5f7', flexDirection: 'row', alignItems: 'center', gap: 10 }, musicArtwork: { width: 48, height: 48, borderRadius: 4 }, playButton: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' }, playButtonOwn: { backgroundColor: '#fff' },
  draftAttachment: { marginHorizontal: 12, marginTop: 6, padding: 10, borderRadius: 8, backgroundColor: '#f3f5f7', flexDirection: 'row', alignItems: 'center', gap: 10 }, draftIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#e8edf2', alignItems: 'center', justifyContent: 'center' }, draftTitle: { color: '#111', fontSize: 14, lineHeight: 19, fontWeight: '600' }, draftMeta: { color: '#6f7b86', fontSize: 12, lineHeight: 17 }, composer: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: Platform.OS === 'web' ? 12 : 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#d7dee5', backgroundColor: '#fff' }, inputShell: { minHeight: 46, borderRadius: 23, backgroundColor: '#f3f5f7', flexDirection: 'row', alignItems: 'flex-end' }, composerIcon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, messageInput: { flex: 1, minHeight: 44, maxHeight: 132, paddingTop: 11, paddingBottom: 10, color: '#111', fontSize: 16, lineHeight: 21 }, editBar: { paddingHorizontal: 8, paddingBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 8 }, editTitle: { color: '#111', fontSize: 12, fontWeight: '600' }, editText: { marginTop: 2, color: '#6f7b86', fontSize: 12 },
  reactionPicker: { flexDirection: 'row', justifyContent: 'space-between', gap: 4 }, reactionButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#f3f5f7', alignItems: 'center', justifyContent: 'center' }, reactionButtonSelected: { backgroundColor: '#e8edf2' }, reactionEmoji: { fontSize: 22 }, customReaction: { marginTop: 8, flexDirection: 'row', gap: 8 }, customReactionInput: { flex: 1, height: 44, paddingHorizontal: 14, borderRadius: 8, borderWidth: 1, borderColor: '#d7dee5', color: '#111', fontSize: 16 }, customReactionButton: { minWidth: 100, height: 44, borderRadius: 22, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' }, customReactionButtonText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  attachmentActions: { flexDirection: 'row', gap: 8 }, attachmentAction: { flex: 1, minHeight: 78, borderRadius: 8, backgroundColor: '#f3f5f7', alignItems: 'center', justifyContent: 'center', gap: 6 }, attachmentActionText: { color: '#111', fontSize: 14, fontWeight: '600' }, sectionTitle: { marginTop: 12, color: '#6f7b86', fontSize: 14, fontWeight: '600' }, searchResult: { minHeight: 62, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', gap: 11 }, searchResultImage: { width: 44, height: 52, borderRadius: 4 }, searchResultAvatar: { width: 44, height: 44, borderRadius: 22 }, resultKind: { color: '#8e99a4', fontSize: 11 },
});
