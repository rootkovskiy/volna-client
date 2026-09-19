import { OwnershipTransferNotification } from './OwnershipTransferNotification';
import type { OwnershipTransfer } from './OwnershipTransferStatus';
import { LoadingIndicator } from '@volna/messaging-client/loading';
import { MotionDisclosure } from '@volna/messaging-client/ui-motion';
import { Bell, CalendarDays, Copy, Disc3, List, Sparkles, UsersRound } from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppImage as Image } from './AppImage';
import { styles } from '../styles';
import type { AppTab, ToastMessage } from '../types';
import { apiFetch, apiUrl } from '../api/client';
import { getAvatarInitial } from '../domain';
import { PostFeed } from './PostFeed';
import type { AppPost } from '../types';
import { AppRefreshControl } from './AppRefreshControl';
import { refreshNotificationBadge } from '../notifications/badgeStore';
import { createNotificationRefresh, notificationSurfaceVisible, subscribeNotificationUpdates } from '../notifications/liveUpdates';
import { ScreenTopBar } from './ScreenTopBar';
export { ScreenTopBar } from './ScreenTopBar';

export { TopToast } from './TopToast';


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

export function NotificationsScreen({ accountId, onOpenMessageSecurity, authToken, onBack, onNotify, onOpenChat, onOpenEditProfile, onOpenEvent, onOpenMenu, onOpenMessages, onOpenProfile, onOpenPublicPage }: { accountId: string; onOpenMessageSecurity: () => void; authToken: string; onBack: () => void; onNotify: (message: string, type?: ToastMessage['type']) => void; onOpenChat: (username: string) => Promise<void>; onOpenEditProfile: () => void; onOpenEvent: (eventId: string) => void; onOpenMenu: () => void; onOpenMessages: () => void; onOpenProfile: (username: string) => Promise<void>; onOpenPublicPage: (username: string) => Promise<void> }) {
  type FollowRequest = { id: string; createdAt: string; follower: { id: string; username: string; name: string; avatarUrl: string | null } };
  type MentionNotification = { id: string; postId: string; createdAt: string; mentionedPageName: string | null; post: AppPost };
  type NotificationSource = { username: string; name: string; avatarUrl: string | null };
  type SystemNotification = { readAt: string | null; ownershipTransfer?: OwnershipTransfer | null; id: string; eventId: string | null; postId: string | null; eventType: string; type: string; title: string; body: string; codes: string[]; createdAt: string; sourceAccount: NotificationSource | null; sourceCommunity: NotificationSource | null };
  const notificationScope = useRef(0);
  useEffect(() => { notificationScope.current++; return () => { notificationScope.current++; }; }, [authToken]);
  const [requests, setRequests] = useState<FollowRequest[]>([]);
  const [mentions, setMentions] = useState<MentionNotification[]>([]);
  const [systemNotifications, setSystemNotifications] = useState<SystemNotification[]>([]);
  const [activeTab, setActiveTab] = useState<'all' | 'requests'>('all');
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [leavingRequests, setLeavingRequests] = useState<string[]>([]);
  const [savingUsername, setSavingUsername] = useState<string | null>(null);
  const retainedRequests = useRef(new Set<string>());
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const showingNotifications = useRef(true);
  showingNotifications.current = activeTab === 'all' && !selectedPostId;

  useEffect(() => {
    setIsLoading(true);
    setLoadError(null);
    const headers = { Authorization: `Bearer ${authToken}` };
    const loader = createNotificationRefresh({
      visible: notificationSurfaceVisible,
      load: async signal => {
        const [requestsResponse, mentionsResponse, systemResponse] = await Promise.all([
          apiFetch(`${apiUrl}/profiles/follow-requests`, { headers, signal, cache: 'no-store' }),
          apiFetch(`${apiUrl}/posts/notifications/mentions`, { headers, signal, cache: 'no-store' }),
          apiFetch(`${apiUrl}/notifications`, { headers, signal, cache: 'no-store' }),
        ]);
        if (!requestsResponse.ok || !mentionsResponse.ok || !systemResponse.ok) throw new Error('Не удалось загрузить уведомления');
        return Promise.all([requestsResponse.json() as Promise<FollowRequest[]>, mentionsResponse.json() as Promise<MentionNotification[]>, systemResponse.json() as Promise<SystemNotification[]>]);
      },
      commit: async ([nextRequests, nextMentions, nextSystem], signal) => {
        setRequests(current => [...nextRequests, ...current.filter(item => retainedRequests.current.has(item.follower.username) && !nextRequests.some(next => next.id === item.id))]);
        setMentions(nextMentions); setSystemNotifications(nextSystem);
        setIsLoading(false); setLoadError(null);
        // Only acknowledge the authorized snapshot that this visible screen
        // actually displayed. A concurrently arriving item stays unread.
        const ids = showingNotifications.current ? nextSystem.filter(item => !item.readAt).map(item => item.id) : [];
        if (ids.length && notificationSurfaceVisible()) {
          const response = await apiFetch(`${apiUrl}/notifications/read`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, signal, body: JSON.stringify({ ids }) });
          if (!response.ok) throw new Error('Не удалось отметить уведомления прочитанными');
          if (!signal.aborted) void refreshNotificationBadge({ force: true });
        }
      },
      onError: error => { setLoadError(error instanceof Error ? error.message : 'Не удалось загрузить уведомления'); setIsLoading(false); },
    });
    refreshRef.current = loader.refresh;
    const unsubscribe = subscribeNotificationUpdates(accountId, () => { void loader.refresh(); });
    return () => { unsubscribe(); loader.dispose(); };
  }, [accountId, authToken]);

  useEffect(() => { void refreshRef.current(); }, [accountId, authToken, reloadKey, activeTab, selectedPostId]);

  const refreshSystemNotifications = async () => {
    await refreshRef.current();
  };
  const hasPendingOwnership = systemNotifications.some(item => item.ownershipTransfer?.status === 'PENDING');
  useEffect(() => {
    if (!hasPendingOwnership) return;
    const timer = setInterval(() => { void refreshRef.current(); }, 15_000);
    return () => clearInterval(timer);
  }, [authToken, hasPendingOwnership]);

  const resolveRequest = async (username: string, approve: boolean) => {
    const scope = notificationScope.current;
    retainedRequests.current.add(username);
    setSavingUsername(username);
    try {
      const response = await apiFetch(`${apiUrl}/profiles/follow-requests/${encodeURIComponent(username)}${approve ? '/approve' : ''}`, { method: approve ? 'POST' : 'DELETE', headers: { Authorization: `Bearer ${authToken}` } });
      if (!response.ok) throw new Error('Не удалось обработать заявку');
      if (scope !== notificationScope.current) return;
      setLeavingRequests(current => [...current, username]);
      void refreshRef.current();
    } catch (error) {
      retainedRequests.current.delete(username);
      if (scope !== notificationScope.current) return;
      onNotify(error instanceof Error ? error.message : 'Не удалось обработать заявку', 'error');
    } finally {
      if (scope === notificationScope.current) setSavingUsername(null);
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

  if (selectedPostId) return <><ScreenTopBar onBack={() => setSelectedPostId(null)} title="Публикация" /><ScrollView><PostFeed authToken={authToken} authorType="account" canCreate={false} focusPostId={selectedPostId} onNotify={onNotify} onOpenProfile={onOpenProfile} onOpenPublicPage={onOpenPublicPage} username="" /></ScrollView></>;

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
        {isLoading ? <View style={styles.loadingRow}><LoadingIndicator /></View> : null}
        {!isLoading && loadError ? <View style={styles.emptyProfileTab}><Text style={styles.emptyProfileTabTitle}>{loadError}</Text><Pressable accessibilityRole="button" onPress={() => setReloadKey((value) => value + 1)} style={styles.notificationsRetryButton}><Text style={styles.notificationsRetryText}>Повторить</Text></Pressable></View> : null}
        {!isLoading && activeTab === 'all' ? systemNotifications.map((notification) => {
          const sourceAccount = notification.sourceAccount;
          const source = sourceAccount ?? notification.sourceCommunity;
          const sourceUsername = source?.username ?? 'volna';
          const sourceName = source?.name ?? 'VOLNA Social';
          const openSource = () => sourceAccount ? onOpenProfile(sourceUsername) : onOpenPublicPage(sourceUsername);
          const openNotification = notification.ownershipTransfer ? () => void onOpenPublicPage(notification.ownershipTransfer!.community.username) : notification.type.startsWith('MATRIX_NEW_LOGIN_') ? onOpenMessageSecurity : notification.eventId
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
                {notification.ownershipTransfer ? <OwnershipTransferNotification transfer={notification.ownershipTransfer} onChanged={() => { void refreshSystemNotifications().catch(() => undefined); }} /> : null}
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
          <MotionDisclosure key={request.id} visible={!leavingRequests.includes(request.follower.username)} onClosed={() => { retainedRequests.current.delete(request.follower.username); setRequests(current => current.filter(item => item.id !== request.id)); setLeavingRequests(current => current.filter(username => username !== request.follower.username)); }}>
          <View style={styles.followRequestRow}>
            {request.follower.avatarUrl ? <Image source={{ uri: request.follower.avatarUrl }} style={styles.followRequestAvatar} /> : <View style={styles.followRequestAvatar}><Text style={styles.followRequestAvatarText}>{getAvatarInitial(request.follower.name)}</Text></View>}
            <View style={styles.notificationCopy}>
              <Text style={styles.notificationTitle}>{request.follower.name}</Text>
              <Text style={styles.notificationText}>@{request.follower.username} хочет подписаться</Text>
              <Text style={styles.notificationTimestamp}>{formatNotificationDateTime(request.createdAt)}</Text>
              <View style={styles.followRequestActions}>
                <Pressable disabled={savingUsername !== null || leavingRequests.includes(request.follower.username)} onPress={() => void resolveRequest(request.follower.username, true)} style={styles.followRequestApprove}><Text style={styles.notificationActionText}>Подтвердить</Text></Pressable>
                <Pressable disabled={savingUsername !== null || leavingRequests.includes(request.follower.username)} onPress={() => void resolveRequest(request.follower.username, false)} style={styles.followRequestReject}><Text style={styles.followRequestRejectText}>Удалить</Text></Pressable>
              </View>
            </View>
          </View></MotionDisclosure>
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


