import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react-native';
import { ActivityIndicator, Animated, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { AppRefreshControl } from '../components/AppRefreshControl';
import {
  MINI_PLAYER_ENTER_DURATION_MS,
  MINI_PLAYER_ENTER_EASING,
  MINI_PLAYER_EXIT_DURATION_MS,
  MINI_PLAYER_EXIT_EASING,
  useGlobalAudioControls,
} from '../components/GlobalAudioPlayer';
import { PostFeed } from '../components/PostFeed';
import { ScreenTopBar } from '../components/navigation';
import type { AppPost, QuotedPost } from '../types';
import { styles } from '../styles';

const MIN_REFRESH_INDICATOR_MS = 500;

export function FeedScreen({ authToken, composerAuthor, composerRequest, onNotify, onOpenMenu, onOpenMessages, onOpenNotifications, onOpenPost, onOpenProfile, onOpenPublicPage, username }: {
  authToken: string;
  composerAuthor: { avatarUrl?: string | null; isVerified?: boolean; name: string; username?: string };
  composerRequest?: import('../components/GlobalAudioPlayer').TrackComposerRequest | null;
  onNotify: (message: string, type?: 'success' | 'error') => void;
  onOpenMenu: () => void;
  onOpenMessages: () => void;
  onOpenNotifications: () => void;
  onOpenPost: (post: AppPost | QuotedPost) => Promise<void>;
  onOpenProfile: (username: string) => Promise<void>;
  onOpenPublicPage: (username: string) => Promise<void>;
  username: string;
}) {
  const globalAudio = useGlobalAudioControls();
  const [refreshKey, setRefreshKey] = useState(0);
  const [composerOpenRequest, setComposerOpenRequest] = useState(0);
  const [activeFeedTab, setActiveFeedTab] = useState<'for-you' | 'following'>('for-you');
  const [visiblePostCount, setVisiblePostCount] = useState(10);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const refreshStartedAtRef = useRef(0);
  const manualRefreshRef = useRef(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPostLoadHeightRef = useRef(0);
  const webPullOffset = useRef(new Animated.Value(0)).current;
  const createPostPlayerOffset = useRef(new Animated.Value(globalAudio.activeTrack ? 1 : 0)).current;
  const webRefreshIndicatorOpacity = webPullOffset.interpolate({
    inputRange: [0, 20, 52],
    outputRange: [0, 0.35, 1],
    extrapolate: 'clamp',
  });
  const handleRefresh = useCallback(() => {
    if (manualRefreshRef.current) return;
    manualRefreshRef.current = true;
    refreshStartedAtRef.current = Date.now();
    setIsRefreshing(true);
    setVisiblePostCount(10);
    lastPostLoadHeightRef.current = 0;
    setRefreshKey((value) => value + 1);
  }, []);
  const handleLoadingChange = useCallback((loading: boolean) => {
    if (loading || !manualRefreshRef.current) return;
    const remaining = Math.max(0, MIN_REFRESH_INDICATOR_MS - (Date.now() - refreshStartedAtRef.current));
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      manualRefreshRef.current = false;
      refreshTimerRef.current = null;
      setIsRefreshing(false);
    }, remaining);
  }, []);

  useEffect(() => () => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
  }, []);

  useEffect(() => {
    Animated.timing(createPostPlayerOffset, {
      duration: globalAudio.activeTrack ? MINI_PLAYER_ENTER_DURATION_MS : MINI_PLAYER_EXIT_DURATION_MS,
      easing: globalAudio.activeTrack ? MINI_PLAYER_ENTER_EASING : MINI_PLAYER_EXIT_EASING,
      toValue: globalAudio.activeTrack ? 1 : 0,
      useNativeDriver: true,
    }).start();
  }, [createPostPlayerOffset, globalAudio.activeTrack]);

  const changeFeedTab = (value: 'for-you' | 'following') => {
    setActiveFeedTab(value);
    setVisiblePostCount(10);
    lastPostLoadHeightRef.current = 0;
  };

  return <>
    <ScreenTopBar onOpenMenu={onOpenMenu} onOpenMessages={onOpenMessages} onOpenNotifications={onOpenNotifications} title="Лента" />
    <View accessibilityRole="tablist" style={styles.eventCatalogTabs}>
      {([['for-you', 'Для вас'], ['following', 'Подписки']] as const).map(([value, label]) => {
        const isActive = activeFeedTab === value;
        return <Pressable accessibilityRole="tab" accessibilityState={{ selected: isActive }} key={value} onPress={() => changeFeedTab(value)} style={styles.eventCatalogTab}>
          <Text style={[styles.eventCatalogTabText, isActive && styles.eventCatalogTabTextActive]}>{label}</Text>
          {isActive ? <View pointerEvents="none" style={styles.activeTabIndicator} /> : null}
        </Pressable>;
      })}
    </View>
    <View style={styles.feedScreenBody}>
      {Platform.OS === 'web' ? <Animated.View pointerEvents="none" style={[styles.feedRefreshIndicator, { opacity: webRefreshIndicatorOpacity }]}><View style={styles.feedRefreshIndicatorBubble}><ActivityIndicator color="#111" size="small" /></View></Animated.View> : null}
      <Animated.View style={[styles.feedPullContent, Platform.OS === 'web' ? { transform: [{ translateY: webPullOffset }] } : undefined]}>
        <ScrollView
          alwaysBounceVertical
          onScroll={({ nativeEvent }) => {
            const isNearBottom = nativeEvent.contentOffset.y + nativeEvent.layoutMeasurement.height >= nativeEvent.contentSize.height - 320;
            const hasListGrown = lastPostLoadHeightRef.current === 0 || nativeEvent.contentSize.height >= lastPostLoadHeightRef.current + 120;
            if (!isNearBottom || !hasListGrown) return;
            lastPostLoadHeightRef.current = nativeEvent.contentSize.height;
            setVisiblePostCount((current) => current + 10);
          }}
          refreshControl={<AppRefreshControl onRefresh={handleRefresh} refreshing={isRefreshing} tintColor="#111" webPullOffset={webPullOffset} />}
          scrollEventThrottle={100}
          showsVerticalScrollIndicator={false}
        >
          <PostFeed
            authToken={authToken}
            authorType="account"
            canCreate
            composerAuthor={composerAuthor}
            composerOpenRequest={composerOpenRequest}
            composerRequest={composerRequest}
            emptyMessage={activeFeedTab === 'following' ? 'В подписках пока нет публикаций' : 'Публикаций пока нет'}
            feed
            feedMode={activeFeedTab}
            hideComposerTrigger
            key={activeFeedTab}
            maxItems={visiblePostCount}
            onComposerOpenRequestHandled={() => setComposerOpenRequest(0)}
            onLoadingChange={handleLoadingChange}
            onNotify={onNotify}
            onOpenPost={onOpenPost}
            onOpenProfile={onOpenProfile}
            onOpenPublicPage={onOpenPublicPage}
            refreshKey={refreshKey}
            username={username}
          />
        </ScrollView>
      </Animated.View>
      <Animated.View
        style={[
          styles.feedCreatePostButtonAnchor,
          {
            transform: [{
              translateY: createPostPlayerOffset.interpolate({
                inputRange: [0, 1],
                outputRange: [0, -66],
              }),
            }],
          },
        ]}
      >
        <Pressable
          accessibilityHint="Откроется редактор новой публикации"
          accessibilityLabel="Создать публикацию"
          accessibilityRole="button"
          onPress={() => setComposerOpenRequest((current) => current + 1)}
          style={styles.feedCreatePostButton}
        >
          <Plus color="#111" size={24} strokeWidth={2} />
        </Pressable>
      </Animated.View>
    </View>
  </>;
}
