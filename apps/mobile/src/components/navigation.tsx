import { Bell, CalendarDays, Check, ChevronLeft, Copy, Disc3, List, Sparkles, UsersRound, X } from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ActivityIndicator, Animated, Easing, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppImage as Image } from './AppImage';
import { styles } from '../styles';
import type { AppTab, ToastMessage } from '../types';
import { apiFetch, apiUrl } from '../api/client';
import { getAvatarInitial } from '../domain';
import { PostFeed } from './PostFeed';
import type { AppPost } from '../types';
import { AppRefreshControl } from './AppRefreshControl';
import { markNotificationsRead, refreshNotificationBadge } from '../notifications/badgeStore';
import { ScreenTopBar } from './ScreenTopBar';
export { ScreenTopBar } from './ScreenTopBar';

export function TopToast({ onClose, toast }: { onClose: () => void; toast: ToastMessage | null }) {
  return Platform.OS === 'web'
    ? <WebTopToast onClose={onClose} toast={toast} />
    : <NativeTopToast onClose={onClose} toast={toast} />;
}

function ToastCard({ toast }: { toast: ToastMessage }) {
  return (
    <View style={styles.topToastCard}>
      <View style={[styles.topToastIcon, toast.type === 'error' && styles.topToastIconError]}>
        {toast.type === 'error' ? (
          <X color="#c62828" size={15} strokeWidth={2.8} />
        ) : (
          <Check color="#2fa84f" size={15} strokeWidth={2.8} />
        )}
      </View>
      <Text style={styles.topToastText}>{toast.message}</Text>
    </View>
  );
}

function WebTopToast({ onClose, toast }: { onClose: () => void; toast: ToastMessage | null }) {
  const [isVisible, setIsVisible] = useState(false);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!toast || typeof window === 'undefined') return undefined;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    setIsVisible(false);
    const frame = window.requestAnimationFrame(() => setIsVisible(true));
    let closeTimer: ReturnType<typeof setTimeout> | undefined;
    const exitTimer = setTimeout(() => {
      setIsVisible(false);
      closeTimer = setTimeout(onClose, reducedMotion ? 0 : 160);
    }, 4000);
    return () => {
      window.cancelAnimationFrame(frame);
      clearTimeout(exitTimer);
      if (closeTimer) clearTimeout(closeTimer);
    };
  }, [onClose, toast]);

  if (!toast || typeof document === 'undefined') return null;
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const content = (
    <View
      pointerEvents="none"
      style={[
        styles.topToastLayer,
        { paddingTop: insets.top },
        {
          opacity: isVisible ? 1 : 0,
          transform: [{ translateY: isVisible ? 0 : -24 }],
          transitionDuration: reducedMotion ? '0ms' : isVisible ? '180ms' : '150ms',
          transitionProperty: 'opacity, transform',
          transitionTimingFunction: isVisible ? 'cubic-bezier(0.22, 1, 0.36, 1)' : 'cubic-bezier(0.4, 0, 1, 1)',
          willChange: 'opacity, transform',
        } as never,
      ]}
    >
      <ToastCard toast={toast} />
    </View>
  );
  return createPortal(content, document.body);
}

function NativeTopToast({ onClose, toast }: { onClose: () => void; toast: ToastMessage | null }) {
  const visibility = useRef(new Animated.Value(0)).current;
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!toast) {
      return;
    }

    visibility.setValue(0);
    Animated.timing(visibility, {
      duration: 180,
      easing: Easing.out(Easing.cubic),
      toValue: 1,
      useNativeDriver: true,
    }).start();

    const timeout = setTimeout(() => {
      Animated.timing(visibility, {
        duration: 150,
        easing: Easing.in(Easing.cubic),
        toValue: 0,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) {
          onClose();
        }
      });
    }, 4000);

    return () => clearTimeout(timeout);
  }, [onClose, toast, visibility]);

  if (!toast) {
    return null;
  }

  const content = (
    <Animated.View pointerEvents="none" style={[styles.topToastLayer, {
      opacity: visibility,
      paddingTop: insets.top,
      transform: [{
        translateY: visibility.interpolate({ inputRange: [0, 1], outputRange: [-24, 0] }),
      }],
    }]}>
      <ToastCard toast={toast} />
    </Animated.View>
  );

  return content;
}


export function PlaceholderScreen({
  onOpenMenu,
  onOpenNotifications,
  title,
}: {
  onOpenMenu: () => void;
  onOpenNotifications: () => void;
  title: string;
}) {
  return (
    <>
      <ScreenTopBar onOpenMenu={onOpenMenu} onOpenNotifications={onOpenNotifications} title={title} />
      <View style={styles.placeholderScreen}>
        <Text style={styles.placeholderTitle}>{title}</Text>
      </View>
    </>
  );
}


function formatNotificationDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function NotificationsScreen({ authToken, onBack, onNotify, onOpenChat, onOpenEditProfile, onOpenEvent, onOpenMenu, onOpenMessages, onOpenProfile, onOpenPublicPage }: { authToken: string; onBack: () => void; onNotify: (message: string, type?: ToastMessage['type']) => void; onOpenChat: (username: string) => Promise<void>; onOpenEditProfile: () => void; onOpenEvent: (eventId: string) => void; onOpenMenu: () => void; onOpenMessages: () => void; onOpenProfile: (username: string) => Promise<void>; onOpenPublicPage: (username: string) => Promise<void> }) {
  type FollowRequest = { id: string; createdAt: string; follower: { id: string; username: string; name: string; avatarUrl: string | null } };
  type MentionNotification = { id: string; postId: string; createdAt: string; mentionedPageName: string | null; post: AppPost };
  type NotificationSource = { username: string; name: string; avatarUrl: string | null };
  type SystemNotification = { id: string; eventId: string | null; postId: string | null; eventType: string; type: string; title: string; body: string; codes: string[]; createdAt: string; sourceAccount: NotificationSource | null; sourceCommunity: NotificationSource | null };
  const [requests, setRequests] = useState<FollowRequest[]>([]);
  const [mentions, setMentions] = useState<MentionNotification[]>([]);
  const [systemNotifications, setSystemNotifications] = useState<SystemNotification[]>([]);
  const [activeTab, setActiveTab] = useState<'all' | 'requests'>('all');
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [savingUsername, setSavingUsername] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    setLoadError(null);
    const headers = { Authorization: `Bearer ${authToken}` };
    void Promise.all([apiFetch(`${apiUrl}/profiles/follow-requests`, { headers }), apiFetch(`${apiUrl}/posts/notifications/mentions`, { headers }), apiFetch(`${apiUrl}/notifications`, { headers })])
      .then(async ([requestsResponse, mentionsResponse, systemResponse]) => {
        if (!requestsResponse.ok || !mentionsResponse.ok || !systemResponse.ok) throw new Error('Не удалось загрузить уведомления');
        const [nextRequests, nextMentions, nextSystem] = await Promise.all([requestsResponse.json() as Promise<FollowRequest[]>, mentionsResponse.json() as Promise<MentionNotification[]>, systemResponse.json() as Promise<SystemNotification[]>]);
        if (active) {
          setRequests(nextRequests);
          setMentions(nextMentions);
          setSystemNotifications(nextSystem);
          markNotificationsRead();
          void apiFetch(`${apiUrl}/notifications/read-all`, { method: 'POST', headers })
            .then(() => refreshNotificationBadge({ force: true }));
        }
      })
      .catch((error: unknown) => { if (active) setLoadError(error instanceof Error ? error.message : 'Не удалось загрузить уведомления'); })
      .finally(() => { if (active) setIsLoading(false); });
    return () => { active = false; };
  }, [authToken, reloadKey]);

  const resolveRequest = async (username: string, approve: boolean) => {
    setSavingUsername(username);
    try {
      const response = await apiFetch(`${apiUrl}/profiles/follow-requests/${encodeURIComponent(username)}${approve ? '/approve' : ''}`, { method: approve ? 'POST' : 'DELETE', headers: { Authorization: `Bearer ${authToken}` } });
      if (!response.ok) throw new Error('Не удалось обработать заявку');
      setRequests((current) => current.filter((request) => request.follower.username !== username));
    } finally {
      setSavingUsername(null);
    }
  };

  const copyInviteCode = async (code: string) => {
    try {
      await Clipboard.setStringAsync(code);
      onNotify('Код скопирован в буфер обмена', 'success');
    } catch {
      onNotify('Не удалось скопировать код', 'error');
    }
  };

  if (selectedPostId) return <><View style={styles.topBar}><View style={styles.topBarLeft}><Pressable onPress={() => setSelectedPostId(null)} style={styles.topBarIconButton}><ChevronLeft size={29} color="#090909" strokeWidth={2.1} /></Pressable><Text style={styles.topBarTitle}>Публикация</Text></View></View><ScrollView><PostFeed authToken={authToken} authorType="account" canCreate={false} focusPostId={selectedPostId} onNotify={onNotify} onOpenProfile={onOpenProfile} onOpenPublicPage={onOpenPublicPage} username="" /></ScrollView></>;

  return (
    <>
      <ScreenTopBar
        canGoBack
        onBack={onBack}
        onOpenMenu={onOpenMenu}
        onOpenMessages={onOpenMessages}
        onOpenNotifications={() => setReloadKey((value) => value + 1)}
        title="Уведомления"
      />
      <ScrollView alwaysBounceVertical contentContainerStyle={styles.notificationsContent} refreshControl={<AppRefreshControl refreshing={isLoading} tintColor="#111" onRefresh={() => setReloadKey((value) => value + 1)} />} showsVerticalScrollIndicator={false}>
        {requests.length ? (
          <View accessibilityRole="tablist" style={styles.notificationsTabs}>
            {([{ value: 'all', label: 'Все' }, { value: 'requests', label: `Заявки ${requests.length}` }] as const).map((tab) => (
              <Pressable accessibilityRole="tab" accessibilityState={{ selected: activeTab === tab.value }} key={tab.value} onPress={() => setActiveTab(tab.value)} style={[styles.notificationsTab, activeTab === tab.value && styles.notificationsTabActive]}>
                <Text style={[styles.notificationsTabText, activeTab === tab.value && styles.notificationsTabTextActive]}>{tab.label}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        {isLoading ? <View style={styles.loadingRow}><ActivityIndicator color="#111" /></View> : null}
        {!isLoading && loadError ? <View style={styles.emptyProfileTab}><Text style={styles.emptyProfileTabTitle}>{loadError}</Text><Pressable accessibilityRole="button" onPress={() => setReloadKey((value) => value + 1)} style={styles.notificationsRetryButton}><Text style={styles.notificationsRetryText}>Повторить</Text></Pressable></View> : null}
        {!isLoading && activeTab === 'all' ? systemNotifications.map((notification) => {
          const sourceAccount = notification.sourceAccount;
          const source = sourceAccount ?? notification.sourceCommunity;
          const sourceUsername = source?.username ?? 'volna';
          const sourceName = source?.name ?? 'VOLNA Social';
          const openSource = () => sourceAccount ? onOpenProfile(sourceUsername) : onOpenPublicPage(sourceUsername);
          const openNotification = notification.eventId
            ? () => onOpenEvent(notification.eventId!)
            : notification.postId
              ? () => setSelectedPostId(notification.postId)
            : sourceAccount
              ? () => void onOpenProfile(sourceUsername)
              : undefined;
          return (
            <Pressable accessibilityRole={openNotification ? 'link' : undefined} key={notification.id} onPress={openNotification} style={styles.followRequestRow}>
              <Pressable accessibilityLabel={`Открыть ${sourceName}`} accessibilityRole="link" onPress={(event) => { event.stopPropagation(); void openSource(); }}>
                {source?.avatarUrl ? <Image source={{ uri: source.avatarUrl }} style={styles.followRequestAvatar} /> : <View style={[styles.followRequestAvatar, styles.volnaNotificationAvatar]}><Text style={styles.volnaNotificationAvatarText}>{getAvatarInitial(sourceName)}</Text></View>}
              </Pressable>
              <View style={styles.notificationCopy}>
                <View style={styles.notificationSourceRow}><Text numberOfLines={1} style={styles.notificationTitle}>{sourceName}</Text><Pressable accessibilityRole="link" onPress={(event) => { event.stopPropagation(); void openSource(); }}><Text style={styles.notificationSourceLink}>@{sourceUsername}</Text></Pressable></View>
                <Text style={styles.notificationTitle}>{notification.title}</Text>
                <Text style={styles.notificationText}>{notification.body}</Text>
                {notification.eventType === 'CONNECT_LIKE' && sourceAccount ? (
                  <Pressable
                    accessibilityLabel={`Открыть профиль ${sourceName}`}
                    accessibilityRole="link"
                    onPress={(event) => {
                      event.stopPropagation();
                      void onOpenProfile(sourceUsername);
                    }}
                  >
                    <Text style={styles.notificationInlineLink}>Открыть профиль @{sourceUsername}</Text>
                  </Pressable>
                ) : null}
                {notification.type.startsWith('CONNECT_MATCH_') && sourceAccount ? (
                  <Pressable
                    accessibilityLabel={`Написать сообщение ${sourceName}`}
                    accessibilityRole="link"
                    onPress={(event) => {
                      event.stopPropagation();
                      void onOpenChat(sourceUsername);
                    }}
                  >
                    <Text style={styles.notificationInlineLink}>Написать сообщение</Text>
                  </Pressable>
                ) : null}
                {notification.type === 'WELCOME' ? <Pressable accessibilityLabel="Открыть редактор профиля" accessibilityRole="link" onPress={(event) => { event.stopPropagation(); onOpenEditProfile(); }}><Text style={styles.notificationInlineLink}>Заполнить профиль</Text></Pressable> : null}
                {notification.postId ? <Pressable accessibilityLabel="Открыть публикацию" accessibilityRole="link" onPress={(event) => { event.stopPropagation(); setSelectedPostId(notification.postId); }}><Text style={styles.notificationInlineLink}>Открыть публикацию</Text></Pressable> : null}
                <Text style={styles.notificationTimestamp}>{formatNotificationDateTime(notification.createdAt)}</Text>
                {notification.eventId ? <Text style={styles.notificationTime}>Открыть событие</Text> : null}
                {notification.codes.length ? <View style={styles.inviteCodesRow}>{notification.codes.map((code) => <Pressable accessibilityLabel={`Скопировать код ${code}`} key={code} onPress={(event) => { event.stopPropagation(); void copyInviteCode(code); }} style={styles.inviteCodeChip}><Text selectable style={styles.inviteCodeText}>{code}</Text><Copy color="#fff" size={15} strokeWidth={1.9} /></Pressable>)}</View> : null}
              </View>
            </Pressable>
          );
        }) : null}
        {!isLoading && activeTab === 'all' ? mentions.map((mention) => (
          <Pressable accessibilityRole="link" key={mention.id} onPress={() => setSelectedPostId(mention.postId)} style={styles.followRequestRow}>
            {mention.post.author.avatarUrl ? <Image source={{ uri: mention.post.author.avatarUrl }} style={styles.followRequestAvatar} /> : <View style={styles.followRequestAvatar}><Text style={styles.followRequestAvatarText}>{getAvatarInitial(mention.post.author.name)}</Text></View>}
            <View style={styles.notificationCopy}><Text style={styles.notificationTitle}>{mention.mentionedPageName ? `${mention.post.author.name} упомянул сообщество ${mention.mentionedPageName}` : `${mention.post.author.name} упомянул вас`}</Text><Text numberOfLines={2} style={styles.notificationText}>{mention.post.text || 'Публикация с вложением'}</Text><Text style={styles.notificationTimestamp}>{formatNotificationDateTime(mention.createdAt)}</Text><Text style={styles.notificationTime}>Открыть публикацию</Text></View>
          </Pressable>
        )) : null}
        {!isLoading && requests.length ? requests.map((request) => (
          <View key={request.id} style={styles.followRequestRow}>
            {request.follower.avatarUrl ? <Image source={{ uri: request.follower.avatarUrl }} style={styles.followRequestAvatar} /> : <View style={styles.followRequestAvatar}><Text style={styles.followRequestAvatarText}>{getAvatarInitial(request.follower.name)}</Text></View>}
            <View style={styles.notificationCopy}>
              <Text style={styles.notificationTitle}>{request.follower.name}</Text>
              <Text style={styles.notificationText}>@{request.follower.username} хочет подписаться</Text>
              <Text style={styles.notificationTimestamp}>{formatNotificationDateTime(request.createdAt)}</Text>
              <View style={styles.followRequestActions}>
                <Pressable disabled={savingUsername === request.follower.username} onPress={() => void resolveRequest(request.follower.username, true)} style={styles.followRequestApprove}><Text style={styles.notificationActionText}>Подтвердить</Text></Pressable>
                <Pressable disabled={savingUsername === request.follower.username} onPress={() => void resolveRequest(request.follower.username, false)} style={styles.followRequestReject}><Text style={styles.followRequestRejectText}>Удалить</Text></Pressable>
              </View>
            </View>
          </View>
        )) : null}
        {!isLoading && !loadError && !requests.length && !mentions.length && !systemNotifications.length ? <View style={styles.emptyProfileTab}><Bell color="#7d8894" size={28} /><Text style={styles.emptyProfileTabTitle}>Новых уведомлений нет</Text></View> : null}
      </ScrollView>
    </>
  );
}


export function BottomNavigation({
  activeTab,
  onChangeTab,
  onHeightChange,
}: {
  activeTab: AppTab;
  onChangeTab: (tab: AppTab) => void;
  onHeightChange?: (height: number) => void;
}) {
  const insets = useSafeAreaInsets();
  const bottomNavigationInsetStyle = Platform.OS === 'web'
    ? {
        height: 'calc(72px + env(safe-area-inset-bottom, 0px))' as unknown as number,
        minHeight: 'calc(72px + env(safe-area-inset-bottom, 0px))' as unknown as number,
        paddingBottom: 'env(safe-area-inset-bottom, 0px)' as unknown as number,
      }
    : {
        height: 72 + Math.max(0, insets.bottom),
        minHeight: 72 + Math.max(0, insets.bottom),
        paddingBottom: Math.max(0, insets.bottom),
      };
  const items: Array<{
    icon: typeof CalendarDays;
    label: string;
    tab: AppTab;
  }> = [
    { icon: List, label: 'Лента', tab: 'feed' },
    { icon: CalendarDays, label: 'События', tab: 'events' },
    { icon: UsersRound, label: 'Сообщество', tab: 'locations' },
    { icon: Sparkles, label: 'Коннект', tab: 'community' },
    { icon: Disc3, label: 'Музыка', tab: 'music' },
  ];

  // On an installed iOS PWA the outer SafeAreaView owns the home-indicator
  // inset. When the navigation hides, collapse that reserved inset together
  // with the 72px bar so the page can continue all the way to the viewport.
  return (
    <View style={[
      styles.bottomNav,
      bottomNavigationInsetStyle,
    ]} onLayout={(event) => onHeightChange?.(event.nativeEvent.layout.height)}>
      {items.map((item) => {
        const Icon = item.icon;
        const isActive = activeTab === item.tab;

        return (
          <Pressable
            key={item.tab}
            accessibilityRole="button"
            accessibilityState={{ selected: isActive }}
            onPress={() => onChangeTab(item.tab)}
            style={styles.bottomNavItem}
          >
            <View style={styles.bottomNavIconWrap}>
              <Icon color={isActive ? '#050505' : '#7d8894'} size={25} strokeWidth={1.8} />
            </View>
            <Text style={[styles.bottomNavLabel, isActive && styles.bottomNavLabelActive]} numberOfLines={1}>
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}


