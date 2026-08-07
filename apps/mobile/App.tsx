import * as WebBrowser from 'expo-web-browser';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Sentry } from './src/monitoring/sentry';
import { startClientTelemetry } from './src/monitoring/clientTelemetry';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  BackHandler,
  Platform,
  Pressable,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { VolnaChatScreen as ChatScreen, VolnaMessagesScreen as MessagesScreen } from '@volna/messaging-client/react-native-messages';
import {
  apiFetch as fetch,
  apiUrl,
  baseFetch,
  clearStoredSessionToken,
  getStoredSessionToken,
  readApiError,
  setApiErrorHandler,
  setApiUnauthorizedHandler,
  setApiSessionToken,
  setApiMaintenanceHandler,
  setStoredSessionToken,
} from './src/api/client';
import { styles } from './src/styles';
import {
  BottomNavigation,
  NotificationsScreen,
  TopToast,
} from './src/components/navigation';
import { SideMenu } from './src/components/SideMenu';
import { GlobalAudioProvider, GlobalMiniPlayer } from './src/components/GlobalAudioPlayer';
import { PostThreadScreen } from './src/components/PostFeed';
import { PushPermissionPrompt } from './src/components/PushPermissionPrompt';
import { removeWebPushSubscription } from './src/pushNotifications';
import { clearNotificationBadge, refreshNotificationBadge } from './src/notifications/badgeStore';
import { AuthScreen } from './src/screens/AuthScreen';
import {
  CommunityCabinetScreen,
  CommunityScreen,
  CreateCommunityScreen,
  LocationsScreen,
  MyCommunitiesScreen,
  PublicPageEditScreen,
  PublicPageScreen,
} from './src/screens/CommunityScreens';
import { EventsScreen } from './src/screens/EventScreens';
import {
  EditProfileScreen,
  ProfileScreen,
} from './src/screens/ProfileScreens';
import { MusicCatalogScreen, MyMusicScreen } from './src/screens/MusicScreens';
import { CreateEventScreen } from './src/screens/CreateEventScreen';
import { EntityNotFoundScreen } from './src/screens/EntityNotFoundScreen';
import { FeedScreen } from './src/screens/FeedScreen';
import { MessageSecurityScreen } from './src/screens/MessageSecurityScreen';
import {
  ModerationCenterScreen,
  PasswordSecurityScreen,
  SettingsScreen,
  SubscriptionScreen,
} from './src/screens/SettingsScreens';
import { messagingSurfaceController, releaseSecureMessagingClient } from './src/messaging/secureMessaging';
import { fromApiMessagePrivacy, toApiMessagePrivacy, uploadAvatarAsset, uploadEventPosterAsset } from './src/domain';
import type {
  Profile,
  Account,
  Session,
  AppTab,
  ProfileMode,
  MessagePrivacy,
  ApiMessagePrivacy,
  NavigationState,
  ToastMessage,
  PublicPage,
  PublicPageTeamMember,
  PublicPageDetail,
  CreateCommunityInput,
  EventParticipationStatus,
  EventSummary,
  CreateEventInput,
  UpdateCommunityInput,
  TeamMemberInput,
  PartnerPageInput,
  PartnerReference,
  ProfileUpdate,
  AppPost,
  QuotedPost,
  ProfileContentTab,
  PublicPageContentTab,
} from './src/types';

type SystemStatus = {
  status: 'normal' | 'maintenance';
  reason: string | null;
  changedAt: string;
  retryAfterSeconds: number;
};

startClientTelemetry(apiUrl);
WebBrowser.maybeCompleteAuthSession();

const TAB_PATHS: Record<AppTab, string> = {
  feed: '/feed',
  events: '/events',
  locations: '/community',
  community: '/connect',
  music: '/music',
  messages: '/messages',
  profile: '/profile',
};

const PATH_TABS = Object.fromEntries(
  Object.entries(TAB_PATHS).map(([tab, path]) => [path, tab as AppTab]),
) as Record<string, AppTab>;

const LAST_SCREEN_STORAGE_VERSION = 1;
const lastScreenStorageKey = (accountId: string) => `volna:last-screen:v${LAST_SCREEN_STORAGE_VERSION}:${accountId}`;

function isPwaShellLaunch(): boolean {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return false;

  const search = new URLSearchParams(window.location.search);
  const isKnownShellPath = window.location.pathname === '/' || window.location.pathname === '/profile';
  return (
    isKnownShellPath
    && search.get('source') === 'pwa'
    && search.toString() === 'source=pwa'
  );
}

type PersistedScreen =
  | { version: 1; kind: 'tab'; activeTab: AppTab }
  | { version: 1; kind: 'profile'; activeTab: AppTab; username: string }
  | { version: 1; kind: 'publicPage'; activeTab: AppTab; username: string }
  | { version: 1; kind: 'post'; postId: string }
  | { version: 1; kind: 'event'; eventId: string }
  | { version: 1; kind: 'chat'; username: string }
  | {
      version: 1;
      kind: 'section';
      activeTab: AppTab;
      profileMode: Extract<
        ProfileMode,
        'myCommunities' | 'myMusic' | 'notifications' | 'settings' | 'security' | 'messageSecurity' | 'subscription' | 'moderation'
      >;
    };

const RESTORABLE_SECTIONS = new Set<ProfileMode>([
  'myCommunities',
  'myMusic',
  'notifications',
  'settings',
  'security',
  'messageSecurity',
  'subscription',
  'moderation',
]);

function parsePersistedScreen(value: string | null): PersistedScreen | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<PersistedScreen>;
    if (parsed.version !== LAST_SCREEN_STORAGE_VERSION || typeof parsed.kind !== 'string') return null;
    if (parsed.kind === 'tab' && typeof parsed.activeTab === 'string' && parsed.activeTab in TAB_PATHS) {
      return parsed as PersistedScreen;
    }
    if (
      (parsed.kind === 'profile' || parsed.kind === 'publicPage')
      && typeof parsed.activeTab === 'string'
      && parsed.activeTab in TAB_PATHS
      && typeof parsed.username === 'string'
      && /^[a-z0-9_]{3,30}$/.test(parsed.username)
    ) {
      return parsed as PersistedScreen;
    }
    if (parsed.kind === 'post' && typeof parsed.postId === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(parsed.postId)) {
      return parsed as PersistedScreen;
    }
    if (parsed.kind === 'event' && typeof parsed.eventId === 'string' && parsed.eventId.length <= 80) {
      return parsed as PersistedScreen;
    }
    if (parsed.kind === 'chat' && typeof parsed.username === 'string' && /^[a-z0-9_]{3,30}$/.test(parsed.username)) {
      return parsed as PersistedScreen;
    }
    if (
      parsed.kind === 'section'
      && typeof parsed.activeTab === 'string'
      && parsed.activeTab in TAB_PATHS
      && typeof parsed.profileMode === 'string'
      && RESTORABLE_SECTIONS.has(parsed.profileMode as ProfileMode)
    ) {
      return parsed as PersistedScreen;
    }
  } catch {
    // Invalid or legacy navigation state is discarded below.
  }
  return null;
}

function App({ initialUsername, initialPostId, initialTab = 'feed', initialProfileMode = 'view', initialChatUsername, initialCommunityCabinetUsername, initialEditEntity = false }: { initialUsername?: string; initialPostId?: string; initialTab?: AppTab; initialProfileMode?: ProfileMode; initialChatUsername?: string; initialCommunityCabinetUsername?: string; initialEditEntity?: boolean; [key: string]: unknown } = {}) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [ownProfile, setOwnProfile] = useState<Profile | null>(null);
  const [activeTab, setActiveTab] = useState<AppTab>(initialTab);
  const [profileMode, setProfileMode] = useState<ProfileMode>(initialProfileMode);
  const [profileContentTab, setProfileContentTab] = useState<ProfileContentTab>(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return 'feed';
    const value = new URLSearchParams(window.location.search).get('tab');
    return value && ['feed', 'photos', 'events', 'music', 'locations'].includes(value) ? value as ProfileContentTab : 'feed';
  });
  const [publicPageContentTab, setPublicPageContentTab] = useState<PublicPageContentTab>(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return 'feed';
    const value = new URLSearchParams(window.location.search).get('tab');
    return value && ['feed', 'photos', 'events', 'music', 'team', 'partners', 'products'].includes(value) ? value as PublicPageContentTab : 'feed';
  });
  const [playlistIdToEdit, setPlaylistIdToEdit] = useState<string | null>(null);
  const [activeChat, setActiveChat] = useState<string | null>(null);
  const [activePublicPage, setActivePublicPage] = useState<PublicPageDetail | null>(null);
  const [activePostId, setActivePostId] = useState<string | null>(null);
  const [activeEventId, setActiveEventId] = useState<string | null>(null);
  const [isRefreshingPublicPage, setIsRefreshingPublicPage] = useState(false);
  const [isSideMenuOpen, setIsSideMenuOpen] = useState(false);
  const [isProfileLoading, setIsProfileLoading] = useState(false);
  const [isSessionRestoring, setIsSessionRestoring] = useState(true);
  const [isLastScreenRestoring, setIsLastScreenRestoring] = useState(false);
  const [isInitialRouteResolving, setIsInitialRouteResolving] = useState(Boolean(initialUsername || initialPostId));
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [navigationStack, setNavigationStack] = useState<NavigationState[]>([]);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [maintenanceStatus, setMaintenanceStatus] = useState<SystemStatus | null>(null);
  const lastToastRef = useRef({ message: '', time: 0 });
  const sessionTokenRef = useRef('');
  const sessionAccountIdRef = useRef('');
  const sessionEpochRef = useRef(0);
  const registeredPushTokenRef = useRef<string | null>(null);
  const unauthorizedHandledRef = useRef(false);
  const openedShortLinkRef = useRef('');
  const openedInitialPostRef = useRef('');
  const openedInitialChatRef = useRef('');
  const openedInitialCommunityCabinetRef = useRef('');
  const navigationPersistenceReadyRef = useRef(false);
  const skipNextNavigationPersistenceRef = useRef(false);
  const editCommunityReturnsToStackRef = useRef(false);

  const showToast = useCallback((message: string, type: ToastMessage['type'] = 'success') => {
    const now = Date.now();
    if (lastToastRef.current.message === message && now - lastToastRef.current.time < 1_500) return;
    lastToastRef.current = { message, time: now };
    setToast({ id: Date.now(), message, type });
  }, []);
  const closeToast = useCallback(() => {
    setToast(null);
  }, []);

  const checkSystemStatus = useCallback(async () => {
    try {
      const response = await baseFetch(`${apiUrl}/system/status`, {
        headers: { 'x-client-platform': Platform.OS },
        credentials: Platform.OS === 'web' ? 'include' : undefined,
      });
      if (!response.ok) return;
      const next = (await response.json()) as SystemStatus;
      setMaintenanceStatus(next.status === 'maintenance' ? next : null);
    } catch {
      // A network outage is not automatically maintenance: the auth and loading
      // surfaces already explain connectivity failures without hiding the app.
    }
  }, []);

  useEffect(() => {
    setApiMaintenanceHandler(() => {
      setMaintenanceStatus((current) => current ?? {
        status: 'maintenance',
        reason: 'automatic-overload',
        changedAt: new Date().toISOString(),
        retryAfterSeconds: 15,
      });
      void checkSystemStatus();
    });
    void checkSystemStatus();
    return () => setApiMaintenanceHandler(null);
  }, [checkSystemStatus]);

  useEffect(() => {
    setApiErrorHandler((message) => showToast(message, 'error'));
    return () => setApiErrorHandler(null);
  }, [showToast]);

  useEffect(() => {
    if (!maintenanceStatus) return;
    const timer = setInterval(() => void checkSystemStatus(), 15_000);
    return () => clearInterval(timer);
  }, [checkSystemStatus, maintenanceStatus]);

  useEffect(() => {
    const handleUnauthorized = () => {
      if (unauthorizedHandledRef.current) return;
      unauthorizedHandledRef.current = true;
      sessionEpochRef.current += 1;
      sessionTokenRef.current = '';
      setApiSessionToken('');
      clearNotificationBadge();
      registeredPushTokenRef.current = null;
      void clearStoredSessionToken();
      if (sessionAccountIdRef.current) void releaseSecureMessagingClient(sessionAccountIdRef.current);
      if (Platform.OS === 'web') {
        void baseFetch(`${apiUrl}/auth/logout`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'x-client-platform': 'web' },
        });
      }
      setSession(null);
      setProfile(null);
      setOwnProfile(null);
      setActiveChat(null);
      setActivePublicPage(null);
      setNavigationStack([]);
      setIsSideMenuOpen(false);
      if (sessionAccountIdRef.current) {
        void AsyncStorage.removeItem(lastScreenStorageKey(sessionAccountIdRef.current));
      }
      sessionAccountIdRef.current = '';
      showToast('Сессия истекла. Войдите снова', 'error');
    };
    setApiUnauthorizedHandler(handleUnauthorized);
    return () => {
      setApiUnauthorizedHandler(null);
    };
  }, [showToast]);

  const registerPushToken = useCallback(async (nextSession: Session) => {
    if (Platform.OS === 'web') {
      return;
    }

    try {
      const Notifications = await import('expo-notifications');
      const permission = await Notifications.requestPermissionsAsync();

      const permissionResult = permission as unknown as {
        granted?: boolean;
        status?: string;
      };
      if (!permissionResult.granted && permissionResult.status !== 'granted') {
        return;
      }

      const token = await Notifications.getExpoPushTokenAsync();
      registeredPushTokenRef.current = token.data;
      await fetch(`${apiUrl}/chats/push-token`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${nextSession.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          platform: Platform.OS,
          token: token.data,
        }),
      });
    } catch {
      // Push registration should never block the app in local development.
    }
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') {
      return;
    }

    let style = document.getElementById('volna-web-focus-reset') as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement('style');
      style.id = 'volna-web-focus-reset';
      document.head.appendChild(style);
    }
    style.textContent = `
      input:focus,
      textarea:focus,
      [contenteditable="true"]:focus {
        outline: none !important;
      }

      input:-webkit-autofill,
      input:-webkit-autofill:hover,
      input:-webkit-autofill:focus,
      input:-webkit-autofill:active,
      textarea:-webkit-autofill,
      textarea:-webkit-autofill:hover,
      textarea:-webkit-autofill:focus,
      textarea:-webkit-autofill:active {
        -webkit-text-fill-color: #111 !important;
        caret-color: #111 !important;
        -webkit-box-shadow: 0 0 0 1000px #fff inset !important;
        box-shadow: 0 0 0 1000px #fff inset !important;
        transition: background-color 9999s ease-out 0s;
      }

      #push-permission-allow,
      #push-permission-allow:focus,
      #push-permission-allow:focus-visible,
      #push-permission-allow:active {
        outline: none !important;
        box-shadow: none !important;
        -webkit-tap-highlight-color: transparent !important;
      }
    `;
  }, []);

  const loadProfile = useCallback(async (username: string, mode: 'initial' | 'refresh' | 'silent' = 'initial', token?: string) => {
    if (mode === 'refresh') {
      setIsRefreshing(true);
    } else if (mode === 'initial') {
      setIsProfileLoading(true);
    } else {
      setIsProfileLoading(false);
    }

    try {
      const authToken = token ?? sessionTokenRef.current;
      const response = await fetch(`${apiUrl}/profiles/${username}`, {
        cache: mode === 'initial' ? undefined : 'no-store',
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
      });
      if (!response.ok) {
        throw new Error('Profile request failed');
      }
      const nextProfile = (await response.json()) as Profile;
      setProfile({ ...nextProfile, isFollowing: nextProfile.isFollowing ?? false, musicGenres: nextProfile.musicGenres ?? [] });
      return nextProfile;
    } finally {
      if (mode === 'initial') setIsProfileLoading(false);
      if (mode === 'refresh') setIsRefreshing(false);
      if (mode === 'silent') setIsProfileLoading(false);
    }
  }, []);

  const restoreLastScreen = useCallback(async (nextSession: Session, nextOwnProfile: Profile) => {
    // Older installed PWAs cold-start at `/profile?source=pwa`. That route is
    // application shell metadata, not a user-selected deep link.
    const isShellLaunch = isPwaShellLaunch();
    const hasExplicitInitialDestination = Boolean(
      initialUsername
      || initialPostId
      || initialChatUsername
      || initialCommunityCabinetUsername
      || initialEditEntity
      || (
        !isShellLaunch
        && (
          initialTab !== 'feed'
          || initialProfileMode !== 'view'
          || (
            Platform.OS === 'web'
            && typeof window !== 'undefined'
            && window.location.pathname !== '/'
          )
        )
      )
    );

    navigationPersistenceReadyRef.current = false;
    if (hasExplicitInitialDestination) {
      navigationPersistenceReadyRef.current = true;
      return;
    }

    setIsLastScreenRestoring(true);
    const storageKey = lastScreenStorageKey(nextSession.account.id);
    let discardSavedScreen = false;
    try {
      const storedValue = await AsyncStorage.getItem(storageKey);
      const savedScreen = parsePersistedScreen(storedValue);
      if (!savedScreen) {
        if (storedValue) {
          await AsyncStorage.removeItem(storageKey).catch(() => undefined);
        }
        setActiveTab('feed');
        setProfileMode('view');
        setProfile(nextOwnProfile);
        return;
      }

      setNavigationStack([]);
      setIsSideMenuOpen(false);
      setActiveChat(null);
      setActivePublicPage(null);
      setActivePostId(null);
      setActiveEventId(null);
      setProfile(nextOwnProfile);

      if (savedScreen.kind === 'tab') {
        setActiveTab(savedScreen.activeTab);
        setProfileMode('view');
        return;
      }

      if (savedScreen.kind === 'section') {
        if (
          savedScreen.profileMode === 'moderation'
          && nextSession.account.role !== 'ADMIN'
          && nextSession.account.role !== 'MODERATOR'
        ) {
          throw new Error('The saved moderation route is no longer available');
        }
        setActiveTab(savedScreen.activeTab);
        setProfileMode(savedScreen.profileMode);
        return;
      }

      if (savedScreen.kind === 'post') {
        const response = await fetch(`${apiUrl}/posts/${encodeURIComponent(savedScreen.postId)}`, {
          headers: nextSession.token ? { Authorization: `Bearer ${nextSession.token}` } : undefined,
        });
        if (!response.ok) {
          discardSavedScreen = response.status === 403 || response.status === 404;
          throw new Error('The saved post is no longer available');
        }
        setActiveTab('feed');
        setProfileMode('view');
        setActivePostId(savedScreen.postId);
        return;
      }

      if (savedScreen.kind === 'event') {
        const response = await fetch(`${apiUrl}/events/${encodeURIComponent(savedScreen.eventId)}`, {
          headers: nextSession.token ? { Authorization: `Bearer ${nextSession.token}` } : undefined,
        });
        if (!response.ok) {
          discardSavedScreen = response.status === 403 || response.status === 404;
          throw new Error('The saved event is no longer available');
        }
        setActiveTab('events');
        setProfileMode('view');
        setActiveEventId(savedScreen.eventId);
        return;
      }

      const headers = nextSession.token
        ? { Authorization: `Bearer ${nextSession.token}` }
        : undefined;
      if (savedScreen.kind === 'chat') {
        setActiveTab('messages');
        setActiveChat(savedScreen.username);
        setProfileMode('chat');
        return;
      }

      if (savedScreen.kind === 'profile') {
        let restoredProfile = nextOwnProfile;
        if (savedScreen.username !== nextSession.account.username) {
          const response = await fetch(`${apiUrl}/profiles/${encodeURIComponent(savedScreen.username)}`, { headers });
          if (!response.ok) {
            discardSavedScreen = response.status === 403 || response.status === 404;
            throw new Error('The saved profile is no longer available');
          }
          restoredProfile = await response.json() as Profile;
        }
        setActiveTab(savedScreen.activeTab);
        setProfile({
          ...restoredProfile,
          isFollowing: restoredProfile.isFollowing ?? false,
          musicGenres: restoredProfile.musicGenres ?? [],
        });
        setProfileMode(savedScreen.username === nextSession.account.username ? 'ownProfile' : 'view');
        return;
      }

      const response = await fetch(`${apiUrl}/public-pages/${encodeURIComponent(savedScreen.username)}`, { headers });
      if (!response.ok) {
        discardSavedScreen = response.status === 403 || response.status === 404;
        throw new Error('The saved community is no longer available');
      }
      setActiveTab(savedScreen.activeTab);
      setActivePublicPage(await response.json() as PublicPageDetail);
      setProfileMode('publicPage');
    } catch {
      if (discardSavedScreen) {
        await AsyncStorage.removeItem(storageKey).catch(() => undefined);
      } else {
        // Keep the last known destination through a transient route/API failure.
        skipNextNavigationPersistenceRef.current = true;
      }
      setNavigationStack([]);
      setActiveTab('feed');
      setProfileMode('view');
      setProfile(nextOwnProfile);
      setActiveChat(null);
      setActivePublicPage(null);
      setActivePostId(null);
      setActiveEventId(null);
    } finally {
      navigationPersistenceReadyRef.current = true;
      setIsLastScreenRestoring(false);
    }
  }, [
    initialChatUsername,
    initialCommunityCabinetUsername,
    initialEditEntity,
    initialPostId,
    initialProfileMode,
    initialTab,
    initialUsername,
  ]);

  const handleAuthenticated = async (nextSession: Session) => {
    unauthorizedHandledRef.current = false;
    const normalizedSession = { ...nextSession, token: nextSession.token ?? '' };
    sessionEpochRef.current += 1;
    sessionTokenRef.current = normalizedSession.token;
    sessionAccountIdRef.current = normalizedSession.account.id;
    setApiSessionToken(normalizedSession.token);
    await setStoredSessionToken(normalizedSession.token);
    setSession(normalizedSession);
    void refreshNotificationBadge({ force: true });
    void registerPushToken(normalizedSession);
    const nextProfile = await loadProfile(normalizedSession.account.username, 'initial', normalizedSession.token);
    const normalizedProfile = { ...nextProfile, isFollowing: nextProfile.isFollowing ?? false, musicGenres: nextProfile.musicGenres ?? [] };
    setOwnProfile(normalizedProfile);
    await restoreLastScreen(normalizedSession, normalizedProfile);
  };

  useEffect(() => {
    let isMounted = true;

    const restoreSession = async () => {
      try {
        const token = await getStoredSessionToken();
        if (Platform.OS !== 'web' && !token) {
          return;
        }
        setApiSessionToken(token ?? '');
        const response = await fetch(`${apiUrl}/auth/me`, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });

        if (!response.ok) {
          throw new Error('Stored session is invalid');
        }

        const result = (await response.json()) as { account: Account };

        if (!isMounted) {
          return;
        }

        const restoredSession = { token: token ?? '', account: result.account };
        unauthorizedHandledRef.current = false;
        sessionEpochRef.current += 1;
        sessionTokenRef.current = restoredSession.token;
        sessionAccountIdRef.current = restoredSession.account.id;
        setApiSessionToken(restoredSession.token);
        setSession(restoredSession);
        void refreshNotificationBadge({ force: true });
        void registerPushToken(restoredSession);
        const nextProfile = await loadProfile(result.account.username, 'initial', restoredSession.token);
        const normalizedProfile = { ...nextProfile, isFollowing: nextProfile.isFollowing ?? false, musicGenres: nextProfile.musicGenres ?? [] };
        setOwnProfile(normalizedProfile);
        await restoreLastScreen(restoredSession, normalizedProfile);
      } catch {
        setApiSessionToken('');
        clearNotificationBadge();
        await clearStoredSessionToken();
        if (isMounted) {
          setSession(null);
          setProfile(null);
          setOwnProfile(null);
        }
      } finally {
        if (isMounted) {
          setIsSessionRestoring(false);
        }
      }
    };

    void restoreSession();

    return () => {
      isMounted = false;
    };
  }, [loadProfile, registerPushToken, restoreLastScreen]);

  useEffect(() => {
    if (
      !session
      || !profile
      || isSessionRestoring
      || isLastScreenRestoring
      || isInitialRouteResolving
      || isProfileLoading
      || !navigationPersistenceReadyRef.current
    ) {
      return;
    }

    let screen: PersistedScreen | null = null;
    if (skipNextNavigationPersistenceRef.current) {
      skipNextNavigationPersistenceRef.current = false;
      return;
    }
    if (activePostId) {
      screen = { version: 1, kind: 'post', postId: activePostId };
    } else if (profileMode === 'chat' && activeChat) {
      screen = { version: 1, kind: 'chat', username: activeChat };
    } else if (profileMode === 'publicPage' && activePublicPage) {
      screen = { version: 1, kind: 'publicPage', activeTab, username: activePublicPage.username };
    } else if (
      profileMode === 'ownProfile'
      || (profileMode === 'view' && profile.username !== session.account.username)
    ) {
      screen = { version: 1, kind: 'profile', activeTab, username: profile.username };
    } else if (profileMode === 'view' && activeTab === 'events' && activeEventId) {
      screen = { version: 1, kind: 'event', eventId: activeEventId };
    } else if (RESTORABLE_SECTIONS.has(profileMode)) {
      screen = {
        version: 1,
        kind: 'section',
        activeTab,
        profileMode: profileMode as Extract<
          ProfileMode,
          'myCommunities' | 'myMusic' | 'notifications' | 'settings' | 'security' | 'subscription' | 'moderation'
        >,
      };
    } else if (profileMode === 'view') {
      screen = { version: 1, kind: 'tab', activeTab };
    }

    // Editors, composers, crop screens and missing-entity screens intentionally
    // leave the last stable destination untouched.
    if (screen) {
      void AsyncStorage.setItem(lastScreenStorageKey(session.account.id), JSON.stringify(screen));
    }
  }, [
    activeEventId,
    activeChat,
    activePostId,
    activePublicPage,
    activeTab,
    isLastScreenRestoring,
    isInitialRouteResolving,
    isProfileLoading,
    isSessionRestoring,
    profile,
    profileMode,
    session,
  ]);

  const handleRefresh = () => {
    if (profile) {
      const refreshedUsername = profile.username;
      void loadProfile(refreshedUsername, 'refresh')
        .then((nextProfile) => {
          if (session && refreshedUsername === session.account.username) {
            setOwnProfile({ ...nextProfile, isFollowing: nextProfile.isFollowing ?? false, musicGenres: nextProfile.musicGenres ?? [] });
          }
        })
        .catch((error) => {
          showToast(error instanceof Error ? error.message : 'Не удалось обновить профиль', 'error');
        });
    }
  };

  const rememberCurrentScreen = () => {
    setNavigationStack((stack) => [
      ...stack,
      {
        activeTab,
        profileMode,
        profile,
        profileContentTab,
        publicPage: activePublicPage,
        publicPageContentTab,
        chatUsername: activeChat,
        postId: activePostId,
        eventId: activeEventId,
        browserPath: Platform.OS === 'web' && typeof window !== 'undefined'
          ? `${window.location.pathname}${window.location.search}`
          : null,
      },
    ]);
  };

  const restoreBrowserPath = (state: NavigationState) => {
    if (Platform.OS !== 'web') return;

    if (state.browserPath?.startsWith('/')) {
      if (`${window.location.pathname}${window.location.search}` !== state.browserPath) {
        window.history.replaceState({}, '', state.browserPath);
      }
      return;
    }

    let path = TAB_PATHS[state.activeTab];
    if (state.profileMode === 'publicPage' && state.publicPage) {
      path = `/${state.publicPage.username}`;
    } else if (
      state.profile
      && (state.profileMode === 'ownProfile' || (state.profileMode === 'view' && session && state.profile.username !== session.account.username))
    ) {
      path = `/${state.profile.username}`;
    }

    const targetUrl = state.postId
      ? `/post/${encodeURIComponent(state.postId)}`
      : state.eventId && state.activeTab === 'events'
        ? `/events?event=${encodeURIComponent(state.eventId)}`
        : path;
    if (`${window.location.pathname}${window.location.search}` !== targetUrl) {
      window.history.replaceState({}, '', targetUrl);
    }
  };

  const handleChangeTab = (tab: AppTab, updateBrowserUrl = true) => {
    const shouldRefreshOwnProfile = Boolean(session && profile?.username !== session.account.username);
    setNavigationStack([]);
    setActiveTab(tab);
    setProfileMode('view');
    setProfileContentTab('feed');
    setPublicPageContentTab('feed');
    setIsSideMenuOpen(false);
    setActiveChat(null);
    setActivePublicPage(null);
    setActivePostId(null);
    setActiveEventId(null);

    if (updateBrowserUrl && Platform.OS === 'web' && window.location.pathname !== TAB_PATHS[tab]) {
      window.history.pushState({ tab }, '', TAB_PATHS[tab]);
    }

    if (session && ownProfile) {
      // Bottom-tab navigation always returns to the current account. Reuse the
      // hydrated snapshot immediately so profile/music rows never wait for a
      // second network round trip after viewing another entity.
      setProfile(ownProfile);
    }

    if (session && shouldRefreshOwnProfile) {
      void loadProfile(session.account.username, 'silent')
        .then((nextProfile) => {
          setOwnProfile({ ...nextProfile, isFollowing: nextProfile.isFollowing ?? false, musicGenres: nextProfile.musicGenres ?? [] });
        })
        .catch((error) => {
          showToast(error instanceof Error ? error.message : 'Не удалось обновить профиль', 'error');
        });
    }

  };

  const handleLogout = async () => {
    const tokenToUnregister = registeredPushTokenRef.current;
    const currentToken = sessionTokenRef.current;
    const currentAccountId = session?.account.id ?? sessionAccountIdRef.current;
    sessionEpochRef.current += 1;
    if (Platform.OS === 'web') await removeWebPushSubscription().catch(() => undefined);
    if (tokenToUnregister) {
      await fetch(`${apiUrl}/chats/push-token`, {
        method: 'DELETE',
        headers: {
          ...(currentToken ? { Authorization: `Bearer ${currentToken}` } : {}),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ token: tokenToUnregister, platform: Platform.OS }),
      }).catch(() => undefined);
    }
    await fetch(`${apiUrl}/auth/logout`, {
      method: 'POST',
      headers: currentToken ? { Authorization: `Bearer ${currentToken}` } : undefined,
    }).catch(() => undefined);
    await clearStoredSessionToken();
    if (currentAccountId) await releaseSecureMessagingClient(currentAccountId);
    if (session?.account.id) {
      await AsyncStorage.removeItem(lastScreenStorageKey(session.account.id)).catch(() => undefined);
    }
    sessionTokenRef.current = '';
    sessionAccountIdRef.current = '';
    setApiSessionToken('');
    clearNotificationBadge();
    registeredPushTokenRef.current = null;

    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      // Logging out replaces the entire authenticated application boundary.
      // A document navigation lets React Native Web dispose its global portal
      // and accessibility nodes with the old document instead of reconciling
      // them against the newly mounted authentication tree.
      window.location.replace('/');
      return;
    }

    setSession(null);
    setProfile(null);
    setOwnProfile(null);
    setNavigationStack([]);
    setActiveTab('feed');
    setProfileMode('view');
    setActiveChat(null);
    setActivePublicPage(null);
    setActivePostId(null);
    setIsSideMenuOpen(false);
  };

  const handleOpenProfile = async (username: string) => {
    if (!session) {
      return;
    }

    const normalizedUsername = username.replace(/^@/, '').trim().toLowerCase();
    rememberCurrentScreen();
    setProfileContentTab('feed');
    setProfileMode(normalizedUsername === session.account.username ? 'ownProfile' : 'view');
    setIsSideMenuOpen(false);
    setActivePublicPage(null);
    setActivePostId(null);
    const nextProfile = await loadProfile(normalizedUsername);
    if (normalizedUsername === session.account.username) {
      setOwnProfile({ ...nextProfile, isFollowing: nextProfile.isFollowing ?? false, musicGenres: nextProfile.musicGenres ?? [] });
    }
  };

  const handleOpenPublicPage = async (username: string) => {
    const normalizedUsername = username.replace(/^@/, '').trim().toLowerCase();
    rememberCurrentScreen();
    setPublicPageContentTab('feed');
    setIsSideMenuOpen(false);
    setActivePostId(null);
    const response = await fetch(`${apiUrl}/public-pages/${normalizedUsername}`, {
      headers: session
        ? {
            Authorization: `Bearer ${session.token}`,
          }
        : undefined,
    });

    if (!response.ok) {
      throw new Error(await readApiError(response, 'Не удалось открыть сообщество'));
    }

    setActivePublicPage((await response.json()) as PublicPageDetail);
    setProfileMode('publicPage');
  };

  const handleOpenMention = async (username: string) => {
    if (!session) return;
    const normalizedUsername = username.replace(/^@/, '').trim().toLowerCase();
    rememberCurrentScreen();
    setIsSideMenuOpen(false);
    setActivePostId(null);
    setActiveChat(null);
    if (Platform.OS === 'web') window.history.pushState({}, '', `/${normalizedUsername}`);

    const headers = { Authorization: `Bearer ${session.token}` };
    const [profileResponse, pageResponse] = await Promise.all([
      fetch(`${apiUrl}/profiles/${encodeURIComponent(normalizedUsername)}`, { headers }),
      fetch(`${apiUrl}/public-pages/${encodeURIComponent(normalizedUsername)}`, { headers }),
    ]);

    if (profileResponse.ok) {
      const nextProfile = await profileResponse.json() as Profile;
      setProfileContentTab('feed');
      setActivePublicPage(null);
      setProfile({ ...nextProfile, isFollowing: nextProfile.isFollowing ?? false, musicGenres: nextProfile.musicGenres ?? [] });
      setProfileMode(normalizedUsername === session.account.username ? 'ownProfile' : 'view');
      return;
    }
    if (pageResponse.ok) {
      setPublicPageContentTab('feed');
      setActivePublicPage(await pageResponse.json() as PublicPageDetail);
      setProfileMode('publicPage');
      return;
    }
    setActivePublicPage(null);
    setProfileMode('notFound');
  };

  const handleGoBack = async () => {
    const previous = navigationStack[navigationStack.length - 1];
    setIsSideMenuOpen(false);

    if (!previous) {
      if (activeEventId) {
        setActiveEventId(null);
        setActiveTab('events');
        setProfileMode('view');
        if (Platform.OS === 'web') window.history.replaceState({ tab: 'events' }, '', '/events');
        return;
      }
      if (activePostId) {
        setActivePostId(null);
        setActiveTab('feed');
        setProfileMode('view');
        if (Platform.OS === 'web') window.history.replaceState({ tab: 'feed' }, '', '/feed');
        return;
      }
      if (profileMode !== 'view' || (session && profile?.username !== session.account.username)) {
        setActivePublicPage(null);
        setActiveChat(null);
        setActivePostId(null);
        setProfileMode('view');
        if (ownProfile) {
          setProfile(ownProfile);
        } else if (session) {
          const nextProfile = await loadProfile(session.account.username);
          const normalizedOwnProfile = { ...nextProfile, isFollowing: nextProfile.isFollowing ?? false, musicGenres: nextProfile.musicGenres ?? [] };
          setProfile(normalizedOwnProfile);
          setOwnProfile(normalizedOwnProfile);
        }
        if (Platform.OS === 'web') window.history.replaceState({ tab: activeTab }, '', TAB_PATHS[activeTab]);
        return;
      }

      return;
    }

    const restoredProfile = previous.profile?.id === ownProfile?.id
      ? ownProfile
      : previous.profile?.id === profile?.id
        ? profile
        : previous.profile;
    const restoredPublicPage = previous.publicPage?.id === activePublicPage?.id
      ? activePublicPage
      : previous.publicPage;
    const restoredState: NavigationState = {
      ...previous,
      profile: restoredProfile,
      publicPage: restoredPublicPage,
    };

    setNavigationStack((stack) => stack.slice(0, -1));
    setActiveTab(restoredState.activeTab);
    setProfileMode(restoredState.profileMode);
    setProfile(restoredState.profile);
    setProfileContentTab(restoredState.profileContentTab ?? 'feed');
    setActivePublicPage(restoredState.publicPage);
    setPublicPageContentTab(restoredState.publicPageContentTab ?? 'feed');
    setActiveChat(restoredState.chatUsername);
    setActivePostId(restoredState.postId);
    setActiveEventId(restoredState.eventId ?? null);
    restoreBrowserPath(restoredState);

    if (restoredProfile?.id === ownProfile?.id) {
      setOwnProfile(restoredProfile);
    }
  };

  const handleOpenPost = async (post: AppPost | QuotedPost) => {
    if (!session || post.isDeleted) return;
    rememberCurrentScreen();
    setIsSideMenuOpen(false);
    setActiveChat(null);
    setActivePostId(post.id);
    if (Platform.OS === 'web') window.history.pushState({}, '', `/post/${encodeURIComponent(post.id)}`);

    if (post.author.entityType === 'account') {
      setActivePublicPage(null);
      const nextProfile = await loadProfile(post.author.username);
      if (post.author.username === session.account.username) {
        setOwnProfile({ ...nextProfile, isFollowing: nextProfile.isFollowing ?? false, musicGenres: nextProfile.musicGenres ?? [] });
      }
      setProfileMode(post.author.username === session.account.username ? 'ownProfile' : 'view');
      return;
    }

    const response = await fetch(`${apiUrl}/public-pages/${encodeURIComponent(post.author.username)}`, {
      headers: { Authorization: `Bearer ${session.token}` },
    });
    if (!response.ok) throw new Error(await readApiError(response, 'Не удалось открыть публикацию'));
    setActivePublicPage(await response.json() as PublicPageDetail);
    setProfileMode('publicPage');
  };

  const handleOpenChat = async (username: string) => {
    if (!session) return;
    const normalizedUsername = username.replace(/^@/, '').trim().toLowerCase();
    if (!/^[a-z0-9_]{3,30}$/.test(normalizedUsername)) {
      showToast('Некорректный адрес пользователя', 'error');
      return;
    }

    rememberCurrentScreen();
    setActivePostId(null);
    setActiveChat(normalizedUsername);
    setActivePublicPage(null);
    setProfileMode('chat');
  };

  const handleOpenMessages = async () => {
    if (!session) {
      return;
    }

    rememberCurrentScreen();
    setActivePostId(null);
    setActiveChat(null);
    setActivePublicPage(null);
    setActiveTab('messages');
    setProfileMode('view');
    setIsSideMenuOpen(false);
  };

  const handleOpenCreateCommunity = () => {
    rememberCurrentScreen();
    setActivePostId(null);
    setProfileMode('createCommunity');
    setActivePublicPage(null);
    setIsSideMenuOpen(false);
  };

  const handleOpenCreateEvent = () => {
    rememberCurrentScreen();
    setActivePostId(null);
    setProfileMode('createEvent');
    setActivePublicPage(null);
    setIsSideMenuOpen(false);
  };

  const handleCreateCommunity = async (data: CreateCommunityInput) => {
    if (!session) {
      return;
    }

    const { avatarLocalUri, ...payload } = data;
    if (!avatarLocalUri) throw new Error('Добавьте аватарку сообщества');
    const response = await fetch(`${apiUrl}/public-pages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(await readApiError(response, 'Не удалось создать сообщество'));
    }
    const createdPage = await response.json() as PublicPage;
    let avatarUploadError: Error | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const uploaded = await uploadAvatarAsset(avatarLocalUri, session.token, 'community', createdPage.username);
        const avatarResponse = await fetch(`${apiUrl}/public-pages/${createdPage.username}`, { method: 'PATCH', headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(uploaded) });
        if (!avatarResponse.ok) throw new Error(await readApiError(avatarResponse, 'Не удалось прикрепить аватарку'));
        avatarUploadError = null;
        break;
      } catch (error) {
        avatarUploadError = error instanceof Error ? error : new Error('Не удалось загрузить аватарку');
      }
    }
    setNavigationStack([]);
    setActiveTab('locations');
    setProfileMode('view');
    setIsSideMenuOpen(false);
    showToast(
      avatarUploadError
        ? `Сообщество создано и отправлено на модерацию без аватарки. Фото можно добавить позже в редактировании. ${avatarUploadError.message}`
        : 'Сообщество создано и отправлено на модерацию',
      avatarUploadError ? 'error' : 'success',
    );
  };

  const handleCreateEvent = async (data: CreateEventInput, options?: { adminMode?: boolean }) => {
    if (!session) {
      return;
    }

    const { posterLocalUri, posterThumbnailLocalUri, ...eventData } = data;
    const response = await fetch(`${apiUrl}/events`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.token}`,
        'Content-Type': 'application/json',
        ...(options?.adminMode ? { 'x-volna-admin-mode': '1' } : {}),
      },
      body: JSON.stringify(eventData),
    });

    if (!response.ok) {
      throw new Error(await readApiError(response, 'Не удалось создать ивент'));
    }

    const createdEvent = await response.json() as EventSummary;
    let posterUploaded = true;
    try {
      await uploadEventPosterAsset(posterLocalUri, session.token, createdEvent.id, posterThumbnailLocalUri);
    } catch (error) {
      posterUploaded = false;
      showToast(error instanceof Error ? `Ивент создан, но афиша не загрузилась: ${error.message}` : 'Ивент создан, но афиша не загрузилась', 'error');
    }

    setNavigationStack([]);
    setActiveTab('events');
    setProfileMode('view');
    setIsSideMenuOpen(false);
    if (posterUploaded) showToast('Ивент создан');
  };

  const handleToggleEventParticipation = async (eventId: string, status: EventParticipationStatus | null) => {
    if (!session) {
      throw new Error('Нужно войти в аккаунт');
    }

    const response = await fetch(`${apiUrl}/events/${eventId}/participation`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status }),
    });

    if (!response.ok) {
      throw new Error(await readApiError(response, 'Не удалось обновить ивент'));
    }

    const updatedEvent = (await response.json()) as EventSummary;
    await handleRefresh();
    return updatedEvent;
  };

  const handleSaveCommunity = async (pageUsername: string, data: UpdateCommunityInput, options?: { silent?: boolean }) => {
    if (!session) {
      return;
    }

    const response = await fetch(`${apiUrl}/public-pages/${pageUsername}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${session.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw new Error(await readApiError(response, 'Не удалось сохранить сообщество'));
    }

    const updatedPage = (await response.json()) as PublicPage;
    setActivePublicPage((currentPage) =>
      currentPage?.username === pageUsername
        ? {
            ...currentPage,
            ...updatedPage,
          }
        : currentPage,
    );
    if (!options?.silent) showToast('Сообщество сохранено');
  };

  const handleAddTeamMember = async (pageUsername: string, data: TeamMemberInput) => {
    if (!session) {
      return;
    }

    const response = await fetch(`${apiUrl}/public-pages/${pageUsername}/team`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw new Error(await readApiError(response, 'Не удалось добавить участника команды'));
    }

    const member = (await response.json()) as PublicPageTeamMember;
    setActivePublicPage((currentPage) =>
      currentPage?.username === pageUsername
        ? {
            ...currentPage,
            team: [member, ...currentPage.team.filter((teamMember) => teamMember.account.username !== member.account.username)],
          }
        : currentPage,
    );
    showToast('Участник добавлен');
  };

  const handleRemoveTeamMember = async (pageUsername: string, accountUsername: string) => {
    if (!session) {
      return;
    }

    const response = await fetch(`${apiUrl}/public-pages/${pageUsername}/team/${accountUsername}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${session.token}`,
      },
    });

    if (!response.ok) {
      throw new Error(await readApiError(response, 'Не удалось убрать участника команды'));
    }

    setActivePublicPage((currentPage) =>
      currentPage?.username === pageUsername
        ? {
            ...currentPage,
            team: currentPage.team.filter((teamMember) => teamMember.account.username !== accountUsername),
          }
        : currentPage,
    );
    showToast('Участник убран');
  };

  const handleAddPartnerPage = async (pageUsername: string, data: PartnerPageInput) => {
    if (!session) {
      return;
    }

    const response = await fetch(`${apiUrl}/public-pages/${pageUsername}/partners`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw new Error(await readApiError(response, 'Не удалось добавить партнера'));
    }

    const partner = (await response.json()) as PartnerReference;
    setActivePublicPage((currentPage) =>
      currentPage?.username === pageUsername
        ? {
            ...currentPage,
            partners: [partner, ...currentPage.partners.filter((item) => item.id !== partner.id)],
          }
        : currentPage,
    );
    showToast('Партнер добавлен');
  };

  const handleRemovePartnerPage = async (pageUsername: string, partnerId: string) => {
    if (!session) {
      return;
    }

    const response = await fetch(`${apiUrl}/public-pages/${pageUsername}/partners/${partnerId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${session.token}`,
      },
    });

    if (!response.ok) {
      throw new Error(await readApiError(response, 'Не удалось убрать партнера'));
    }

    setActivePublicPage((currentPage) =>
      currentPage?.username === pageUsername
        ? {
            ...currentPage,
            partners: currentPage.partners.filter((partner) => partner.id !== partnerId),
          }
        : currentPage,
    );
    showToast('Партнер убран');
  };

  const handleToggleFollow = async (username: string, followStatus: Profile['followStatus']) => {
    if (!session) {
      return;
    }

    const response = await fetch(`${apiUrl}/profiles/${username}/follow`, {
      method: followStatus ? 'DELETE' : 'POST',
      headers: {
        Authorization: `Bearer ${session.token}`,
      },
    });

    if (!response.ok) {
      throw new Error(await readApiError(response, 'Не удалось обновить подписку'));
    }

    const result = (await response.json()) as {
      followersCount: number;
      followingCount: number;
      isFollowing: boolean;
      followStatus: Profile['followStatus'];
    };

    setProfile((currentProfile) =>
      currentProfile?.username === username
        ? {
            ...currentProfile,
            followersCount: result.followersCount,
            followingCount: result.followingCount,
            isFollowing: result.isFollowing,
            followStatus: result.followStatus,
          }
        : currentProfile,
    );
  };

  const handleBlockProfile = async (username: string) => {
    if (!session) return;
    const response = await fetch(`${apiUrl}/safety/blocks/${username}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.token}` },
    });
    if (!response.ok) throw new Error(await readApiError(response, 'Не удалось заблокировать профиль'));
    showToast('Профиль заблокирован');
    await handleGoBack();
  };

  const handleReportProfile = async (
    username: string,
    reason: 'SPAM' | 'HARASSMENT' | 'IMPERSONATION' | 'ILLEGAL_CONTENT' | 'OTHER',
    details?: string,
  ) => {
    if (!session) return;
    const response = await fetch(`${apiUrl}/safety/reports`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetType: 'ACCOUNT',
        targetId: username,
        reason,
        ...(details ? { details } : {}),
      }),
    });
    if (!response.ok) throw new Error(await readApiError(response, 'Не удалось отправить жалобу'));
    const payload = await response.json() as { alreadyReported?: boolean };
    showToast(payload.alreadyReported ? 'Вы уже отправили жалобу' : 'Жалоба отправлена');
  };

  const handleOpenMyCommunities = () => {
    rememberCurrentScreen();
    setActivePostId(null);
    setProfileMode('myCommunities');
    setActivePublicPage(null);
    setIsSideMenuOpen(false);
  };

  const handleOpenMyMusic = () => {
    rememberCurrentScreen();
    setActivePostId(null);
    setPlaylistIdToEdit(null);
    setProfileMode('myMusic');
    setActivePublicPage(null);
    setIsSideMenuOpen(false);
  };
  const handleOpenEvent = (eventId: string) => {
    if (!eventId || (activeTab === 'events' && profileMode === 'view' && activeEventId === eventId)) return;
    rememberCurrentScreen();
    setActiveTab('events');
    setProfileMode('view');
    if (ownProfile) setProfile(ownProfile);
    setActiveChat(null);
    setActivePublicPage(null);
    setActivePostId(null);
    setActiveEventId(eventId);
    setIsSideMenuOpen(false);
    if (Platform.OS === 'web') {
      window.history.pushState({ tab: 'events', eventId }, '', `/events?event=${encodeURIComponent(eventId)}`);
    }
  };
  const handleEditPlaylist = (playlistId: string) => {
    rememberCurrentScreen();
    setActivePostId(null);
    setPlaylistIdToEdit(playlistId);
    setProfileMode('myMusic');
    setActivePublicPage(null);
    setIsSideMenuOpen(false);
  };

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const handleBrowserNavigation = () => {
      if (navigationStack.length || activeEventId || activePostId || profileMode !== 'view') {
        void handleGoBack();
        return;
      }
      const tab = PATH_TABS[window.location.pathname.toLowerCase()];
      if (tab) handleChangeTab(tab, false);
    };
    window.addEventListener('popstate', handleBrowserNavigation);
    return () => window.removeEventListener('popstate', handleBrowserNavigation);
  });

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!navigationStack.length && !activeEventId && !activePostId && profileMode === 'view') return false;
      void handleGoBack();
      return true;
    });
    return () => subscription.remove();
  });

  const handleRefreshPublicPage = async () => {
    if (!activePublicPage) return;
    setIsRefreshingPublicPage(true);
    try {
      const response = await fetch(`${apiUrl}/public-pages/${activePublicPage.username}`, {
        cache: 'no-store',
        headers: session ? { Authorization: `Bearer ${session.token}` } : undefined,
      });
      if (!response.ok) throw new Error(await readApiError(response, 'Не удалось обновить сообщество'));
      setActivePublicPage((await response.json()) as PublicPageDetail);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Не удалось обновить сообщество', 'error');
    } finally {
      setIsRefreshingPublicPage(false);
    }
  };

  const handleBlockPublicPage = async (username: string) => {
    if (!session) return;
    const response = await fetch(`${apiUrl}/safety/blocks/public-pages/${username}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.token}` },
    });
    if (!response.ok) throw new Error(await readApiError(response, 'Не удалось заблокировать сообщество'));
    showToast('Сообщество заблокировано');
    await handleGoBack();
  };

  const handleReportPublicPage = async (username: string, reason: 'SPAM' | 'HARASSMENT' | 'IMPERSONATION' | 'ILLEGAL_CONTENT' | 'OTHER') => {
    if (!session) return;
    const response = await fetch(`${apiUrl}/safety/reports`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetType: 'PUBLIC_PAGE', targetId: username, reason }),
    });
    if (!response.ok) throw new Error(await readApiError(response, 'Не удалось отправить жалобу'));
    const payload = await response.json() as { alreadyReported?: boolean };
    showToast(payload.alreadyReported ? 'Вы уже отправили жалобу' : 'Жалоба отправлена');
  };

  const handleCheckProfileReport = async (username: string) => {
    if (!session) return false;
    const response = await fetch(`${apiUrl}/safety/reports/accounts/${encodeURIComponent(username)}/status`, {
      headers: { Authorization: `Bearer ${session.token}` },
    });
    if (!response.ok) throw new Error(await readApiError(response, 'Не удалось проверить жалобу'));
    const payload = await response.json() as { alreadyReported?: boolean };
    return payload.alreadyReported === true;
  };

  const handleTogglePublicPageFollow = async (username: string, followStatus: PublicPage['followStatus']) => {
    if (!session) {
      return;
    }

    const response = await fetch(`${apiUrl}/public-pages/${username}/follow`, {
      method: followStatus ? 'DELETE' : 'POST',
      headers: {
        Authorization: `Bearer ${session.token}`,
      },
    });

    if (!response.ok) {
      throw new Error(await readApiError(response, 'Не удалось обновить подписку'));
    }

    const result = (await response.json()) as {
      followersCount: number;
      isFollowing: boolean;
      followStatus: PublicPage['followStatus'];
    };

    setActivePublicPage((currentPage) =>
      currentPage?.username === username
        ? {
            ...currentPage,
            followersCount: result.followersCount,
            isFollowing: result.isFollowing,
            followStatus: result.followStatus,
          }
        : currentPage,
    );
  };

  const handleToggleFavoritePublicPage = async (username: string, isFavorite: boolean) => {
    if (!session) return;
    const response = await fetch(`${apiUrl}/public-pages/${username}/favorite`, { method: isFavorite ? 'DELETE' : 'POST', headers: { Authorization: `Bearer ${session.token}` } });
    if (!response.ok) throw new Error(await readApiError(response, 'Не удалось обновить любимые сообщества'));
    setActivePublicPage((page) => page?.username === username ? { ...page, isFavorite: !isFavorite } : page);
    showToast(isFavorite ? 'Удалено из любимых сообществ' : 'Добавлено в любимые сообщества');
  };

  const handleSaveProfile = async (data: ProfileUpdate, options?: { stayOnScreen?: boolean }) => {
    if (!session) {
      return;
    }

    const response = await fetch(`${apiUrl}/auth/me`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${session.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw new Error(await readApiError(response, 'Не удалось сохранить профиль'));
    }

    const nextSession = (await response.json()) as { account: Account };
    const previous = navigationStack[navigationStack.length - 1];
    setSession({ ...session, account: nextSession.account });
    const savedProfile = await loadProfile(nextSession.account.username, options?.stayOnScreen ? 'silent' : 'initial');
    const normalizedSavedProfile = {
      ...savedProfile,
      isFollowing: savedProfile.isFollowing ?? false,
      musicGenres: savedProfile.musicGenres ?? [],
    };
    setOwnProfile(normalizedSavedProfile);
    if (options?.stayOnScreen) {
      setProfile((current) => current?.id === normalizedSavedProfile.id ? normalizedSavedProfile : current);
      return;
    }
    setNavigationStack((stack) => stack.slice(0, -1));
    if (previous) {
      setActiveTab(previous.activeTab);
      setProfileMode(previous.profileMode);
      setProfile(previous.profile?.username === normalizedSavedProfile.username ? normalizedSavedProfile : previous.profile);
      setProfileContentTab(previous.profileContentTab ?? 'feed');
      setActivePublicPage(previous.publicPage);
      setPublicPageContentTab(previous.publicPageContentTab ?? 'feed');
      setActiveChat(previous.chatUsername);
      setActivePostId(previous.postId);
      setActiveEventId(previous.eventId ?? null);
      restoreBrowserPath(previous);
    } else {
      setProfile(normalizedSavedProfile);
      setProfileMode('view');
    }
    showToast('Профиль сохранён', 'success');
  };

  const handleSaveAdminProfile = async (username: string, data: ProfileUpdate, options?: { stayOnScreen?: boolean }) => {
    if (!session) return;
    const response = await fetch(`${apiUrl}/profiles/${encodeURIComponent(username)}/admin-profile`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${session.token}`,
        'Content-Type': 'application/json',
        'x-volna-admin-mode': '1',
      },
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error(await readApiError(response, 'Не удалось сохранить профиль'));
    const result = await response.json() as { account?: Account };
    const nextUsername = result.account?.username ?? data.username ?? username;
    const savedProfile = await loadProfile(nextUsername, 'silent');
    const normalizedSavedProfile = {
      ...savedProfile,
      isFollowing: savedProfile.isFollowing ?? false,
      musicGenres: savedProfile.musicGenres ?? [],
      followingCount: savedProfile.isInformational ? 0 : savedProfile.followingCount,
    };
    setProfile(normalizedSavedProfile);
    if (!options?.stayOnScreen) showToast('Профиль сохранён', 'success');
  };

  const handleSaveSettings = async (data: {
    messagePrivacy: MessagePrivacy;
    readReceiptsPrivacy: MessagePrivacy;
    invisibleMode: boolean;
    showSavedMusicOnProfile: boolean;
    showUploadedMusicOnProfile: boolean;
    showBirthYear: boolean;
  }) => {
    if (!session) {
      return;
    }

    const response = await fetch(`${apiUrl}/auth/settings`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${session.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messagePrivacy: toApiMessagePrivacy(data.messagePrivacy),
        readReceiptsPrivacy: toApiMessagePrivacy(data.readReceiptsPrivacy),
        invisibleMode: data.invisibleMode,
        showSavedMusicOnProfile: data.showSavedMusicOnProfile,
        showUploadedMusicOnProfile: data.showUploadedMusicOnProfile,
        showBirthYear: data.showBirthYear,
      }),
    });

    if (!response.ok) {
      throw new Error(await readApiError(response, 'Не удалось сохранить настройки'));
    }

    const result = (await response.json()) as {
      settings: { messagePrivacy: ApiMessagePrivacy; readReceiptsPrivacy: ApiMessagePrivacy; invisibleMode: boolean; sharePlaybackActivity: boolean; showSavedMusicOnProfile: boolean; showUploadedMusicOnProfile: boolean; showBirthYear: boolean };
    };
    setSession({
      ...session,
      account: {
        ...session.account,
        messagePrivacy: result.settings.messagePrivacy,
        readReceiptsPrivacy: result.settings.readReceiptsPrivacy,
        invisibleMode: result.settings.invisibleMode,
        showSavedMusicOnProfile: result.settings.showSavedMusicOnProfile,
        showUploadedMusicOnProfile: result.settings.showUploadedMusicOnProfile,
        showBirthYear: result.settings.showBirthYear,
      },
    });
    setProfile((currentProfile) =>
      currentProfile?.username === session.account.username
        ? {
            ...currentProfile,
            messagePrivacy: result.settings.messagePrivacy,
            readReceiptsPrivacy: result.settings.readReceiptsPrivacy,
            invisibleMode: result.settings.invisibleMode,
            sharePlaybackActivity: result.settings.sharePlaybackActivity,
            showSavedMusicOnProfile: result.settings.showSavedMusicOnProfile,
            showUploadedMusicOnProfile: result.settings.showUploadedMusicOnProfile,
            showBirthYear: result.settings.showBirthYear,
          }
        : currentProfile,
    );
    setOwnProfile((currentProfile) => currentProfile
      ? {
          ...currentProfile,
          messagePrivacy: result.settings.messagePrivacy,
          readReceiptsPrivacy: result.settings.readReceiptsPrivacy,
          invisibleMode: result.settings.invisibleMode,
          sharePlaybackActivity: result.settings.sharePlaybackActivity,
          showSavedMusicOnProfile: result.settings.showSavedMusicOnProfile,
          showUploadedMusicOnProfile: result.settings.showUploadedMusicOnProfile,
          showBirthYear: result.settings.showBirthYear,
        }
      : currentProfile);
  };

  const handleChangePassword = async (data: { currentPassword: string; newPassword: string }) => {
    if (!session) {
      return;
    }

    const response = await fetch(`${apiUrl}/auth/password`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${session.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw new Error(await readApiError(response, 'Не удалось поменять пароль'));
    }
    setSession((current) => current ? { ...current, account: { ...current.account, mustChangePassword: false } } : current);
  };

  useEffect(() => {
    if (!initialUsername) { if (!initialPostId) setIsInitialRouteResolving(false); return; }
    if (!session || !profile || isSessionRestoring) return;
    const username = decodeURIComponent(initialUsername).trim().toLowerCase();
    if (!/^[a-z0-9_]{3,30}$/.test(username)) { setIsInitialRouteResolving(false); return; }
    const normalizedPostId = initialPostId?.trim() || null;
    const attemptKey = `${session.account.id}:${username}:${normalizedPostId ?? ''}`;
    if (openedShortLinkRef.current === attemptKey) { setIsInitialRouteResolving(false); return; }
    openedShortLinkRef.current = attemptKey;
    setIsInitialRouteResolving(true);
    let active = true;
    void (async () => {
      const headers = { Authorization: `Bearer ${session.token}` };
      const profileResponse = await fetch(`${apiUrl}/profiles/${encodeURIComponent(username)}`, { headers });
      if (!active) return;
      if (profileResponse.ok) {
        const nextProfile = await profileResponse.json() as Profile;
        if (!active) return;
        setNavigationStack([]);
        setActivePostId(normalizedPostId);
        setActivePublicPage(null);
        setProfile({ ...nextProfile, isFollowing: nextProfile.isFollowing ?? false, musicGenres: nextProfile.musicGenres ?? [] });
        if (username === session.account.username) setOwnProfile({ ...nextProfile, isFollowing: nextProfile.isFollowing ?? false, musicGenres: nextProfile.musicGenres ?? [] });
        setProfileMode(username === session.account.username ? 'ownProfile' : 'view');
        setIsInitialRouteResolving(false);
        return;
      }
      const pageResponse = await fetch(`${apiUrl}/public-pages/${encodeURIComponent(username)}`, { headers });
      if (!active) return;
      if (pageResponse.ok) {
        setNavigationStack([]);
        setActivePostId(normalizedPostId);
        setActivePublicPage(await pageResponse.json() as PublicPageDetail);
        setProfileMode(initialEditEntity ? 'editCommunity' : 'publicPage');
        setIsInitialRouteResolving(false);
        return;
      }
      setActivePublicPage(null);
      setProfileMode('notFound');
      setIsInitialRouteResolving(false);
    })().catch(() => {
      if (!active) return;
      setIsInitialRouteResolving(false);
      showToast('Не удалось открыть короткую ссылку', 'error');
    });
    return () => { active = false; };
  }, [initialEditEntity, initialPostId, initialUsername, isSessionRestoring, profile, session, showToast]);

  useEffect(() => {
    if (initialUsername || !initialPostId || !session || !profile || isSessionRestoring) return;
    const postId = initialPostId.trim();
    const attemptKey = `${session.account.id}:${postId}`;
    if (openedInitialPostRef.current === attemptKey) return;
    openedInitialPostRef.current = attemptKey;
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(postId)) {
      setProfileMode('notFound');
      setIsInitialRouteResolving(false);
      return;
    }
    setNavigationStack([]);
    setActivePostId(postId);
    setIsInitialRouteResolving(false);
  }, [initialPostId, initialUsername, isSessionRestoring, profile, session]);

  useEffect(() => {
    if (!initialChatUsername || !session || !profile || isSessionRestoring) return;
    const username = decodeURIComponent(initialChatUsername).replace(/^@/, '').trim().toLowerCase();
    const key = `${session.account.id}:${username}`;
    if (!username || openedInitialChatRef.current === key) return;
    openedInitialChatRef.current = key;
    void handleOpenChat(username).catch((error) => showToast(error instanceof Error ? error.message : 'Не удалось открыть чат', 'error'));
  }, [initialChatUsername, isSessionRestoring, profile, session, showToast]);

  useEffect(() => {
    if (!session || !profile || isSessionRestoring || profileMode !== 'moderation') return;
    if (session.account.role === 'ADMIN' || session.account.role === 'MODERATOR') return;
    setActiveTab('feed');
    setProfileMode('view');
    if (Platform.OS === 'web') window.history.replaceState({ tab: 'feed', profileMode: 'view' }, '', '/feed');
  }, [isSessionRestoring, profile, profileMode, session]);

  useEffect(() => {
    if (!initialCommunityCabinetUsername || !session || !profile || isSessionRestoring) return;
    const username = decodeURIComponent(initialCommunityCabinetUsername).replace(/^@/, '').trim().toLowerCase();
    const key = `${session.account.id}:${username}`;
    if (!username || openedInitialCommunityCabinetRef.current === key) return;
    openedInitialCommunityCabinetRef.current = key;
    void handleOpenPublicPage(username)
      .then(() => setProfileMode('communityCabinet'))
      .catch((error) => showToast(error instanceof Error ? error.message : 'Не удалось открыть кабинет сообщества', 'error'));
  }, [initialCommunityCabinetUsername, isSessionRestoring, profile, session, showToast]);

  useEffect(() => {
    if (Platform.OS !== 'web' || !session || !profile || isSessionRestoring) return;
    const pendingInitialUsername = initialUsername ? decodeURIComponent(initialUsername).trim().toLowerCase() : '';
    if (pendingInitialUsername && profileMode === 'view' && !activePublicPage && profile.username !== pendingInitialUsername) return;

    let path = TAB_PATHS[activeTab];
    const query = new URLSearchParams();
    if (profileMode === 'publicPage' && activePublicPage) path = `/${activePublicPage.username}`;
    else if (profileMode === 'communityCabinet' && activePublicPage) { path = '/community'; query.set('cabinet', activePublicPage.username); }
    else if (profileMode === 'editCommunity' && activePublicPage) { path = `/${activePublicPage.username}`; query.set('edit', '1'); }
    else if (profileMode === 'ownProfile' || (profileMode === 'view' && profile.username !== session.account.username)) path = `/${profile.username}`;
    else if (profileMode === 'edit') { path = '/profile'; query.set('section', 'edit'); }
    else if (profileMode === 'editAdminProfile') { path = `/${profile.username}`; query.set('edit', '1'); }
    else if (profileMode === 'settings') { path = '/profile'; query.set('section', 'settings'); }
    else if (profileMode === 'security') { path = '/profile'; query.set('section', 'security'); }
    else if (profileMode === 'messageSecurity') { path = '/profile'; query.set('section', 'message-security'); }
    else if (profileMode === 'subscription') { path = '/profile'; query.set('section', 'subscription'); }
    else if (profileMode === 'notifications') { path = '/profile'; query.set('section', 'notifications'); }
    else if (profileMode === 'moderation' || profileMode === 'admin') { path = '/profile'; query.set('section', 'moderation'); }
    else if (profileMode === 'myMusic') { path = '/profile'; query.set('section', 'music'); }
    else if (profileMode === 'myCommunities') { path = '/profile'; query.set('section', 'communities'); }
    else if (profileMode === 'createCommunity') { path = '/community'; query.set('create', '1'); }
    else if (profileMode === 'createEvent') { path = '/events'; query.set('create', '1'); }
    else if (profileMode === 'chat' && activeChat) { path = '/messages'; query.set('chat', activeChat); }
    else if (profileMode === 'messages') path = '/messages';
    if (activePostId) path = `/post/${encodeURIComponent(activePostId)}`;
    if (!activePostId && (profileMode === 'publicPage' || profileMode === 'ownProfile' || profileMode === 'view')) {
      const contentTab = new URLSearchParams(window.location.search).get('tab');
      if (contentTab && ['photos', 'events', 'music', 'locations', 'team', 'partners', 'products'].includes(contentTab)) query.set('tab', contentTab);
    }
    if (activeEventId && path === '/events') query.set('event', activeEventId);
    const target = `${path}${query.size ? `?${query.toString()}` : ''}`;
    if (`${window.location.pathname}${window.location.search}` !== target) window.history.replaceState({ tab: activeTab, profileMode }, '', target);
  }, [activeChat, activeEventId, activePostId, activePublicPage, activeTab, initialUsername, isSessionRestoring, profile, profileMode, session]);

  return (
    <SafeAreaProvider>
      <View style={styles.safeArea}>
        {maintenanceStatus ? (
          <MaintenanceScreen onRetry={checkSystemStatus} />
        ) : session && profile && !isInitialRouteResolving && !isLastScreenRestoring ? (
          <MainApp
            accountRole={session.account.role}
            activeTab={activeTab}
            activePublicPage={activePublicPage}
            activePostId={activePostId}
            activeEventId={activeEventId}
            profileContentTab={profileContentTab}
            publicPageContentTab={publicPageContentTab}
            canGoBack={navigationStack.length > 0 || profile.username !== session.account.username || profileMode !== 'view'}
            isRefreshingPublicPage={isRefreshingPublicPage}
            isProfileLoading={isProfileLoading}
            isRefreshing={isRefreshing}
            isSideMenuOpen={isSideMenuOpen}
            activeChat={activeChat}
            onChangeTab={handleChangeTab}
            onBlockProfile={handleBlockProfile}
            onBlockPublicPage={handleBlockPublicPage}
            onCloseEditCommunity={() => {
              if (editCommunityReturnsToStackRef.current) {
                editCommunityReturnsToStackRef.current = false;
                void handleGoBack();
                return;
              }
              setProfileMode('publicPage');
            }}
            onCreateCommunity={handleCreateCommunity}
            onAddTeamMember={handleAddTeamMember}
            onAddPartnerPage={handleAddPartnerPage}
            onGoBack={handleGoBack}
            onCloseSideMenu={() => setIsSideMenuOpen(false)}
            onLogout={handleLogout}
            onRefreshPublicPage={handleRefreshPublicPage}
            onOpenEdit={() => {
              rememberCurrentScreen();
              setActivePostId(null);
              setIsSideMenuOpen(false);
              if (ownProfile) {
                setProfile(ownProfile);
              }
              setProfileMode('edit');
            }}
            onOpenAdminProfileEdit={() => {
              rememberCurrentScreen();
              setActivePostId(null);
              setIsSideMenuOpen(false);
              setProfileMode('editAdminProfile');
            }}
            onOpenProfile={handleOpenProfile}
            onOpenPost={handleOpenPost}
            onOpenMention={handleOpenMention}
            onOpenPublicPage={handleOpenPublicPage}
            onRemoveTeamMember={handleRemoveTeamMember}
            onRemovePartnerPage={handleRemovePartnerPage}
            onNotify={showToast}
            onOpenChat={handleOpenChat}
            onOpenCreateCommunity={handleOpenCreateCommunity}
            onOpenCreateEvent={handleOpenCreateEvent}
            onOpenCommunityCabinet={() => {
              if (profileMode === 'publicPage') rememberCurrentScreen();
              setActivePostId(null);
              setProfileMode('communityCabinet');
            }}
            onOpenMyCommunities={handleOpenMyCommunities}
            onOpenMyMusic={handleOpenMyMusic}
            onEditPlaylist={handleEditPlaylist}
            onPlaylistEditorOpened={() => setPlaylistIdToEdit(null)}
            onCreateEvent={handleCreateEvent}
            onToggleEventParticipation={handleToggleEventParticipation}
            onOpenEditCommunity={() => {
              editCommunityReturnsToStackRef.current = profileMode !== 'publicPage';
              setActivePostId(null);
              setProfileMode('editCommunity');
            }}
            onOpenMessages={handleOpenMessages}
            onToggleFollow={handleToggleFollow}
            onTogglePublicPageFollow={handleTogglePublicPageFollow}
            onToggleFavoritePublicPage={handleToggleFavoritePublicPage}
            onOpenMenu={() => setIsSideMenuOpen(true)}
            onOpenNotifications={() => {
              rememberCurrentScreen();
              setActivePostId(null);
              setProfileMode('notifications');
              setIsSideMenuOpen(false);
            }}
            onRefreshProfile={handleRefresh}
            onCheckProfileReport={handleCheckProfileReport}
            onReportProfile={handleReportProfile}
            onReportPublicPage={handleReportPublicPage}
            onSaveProfile={handleSaveProfile}
            onSaveAdminProfile={handleSaveAdminProfile}
            onSaveCommunity={handleSaveCommunity}
            onSaveSettings={handleSaveSettings}
            onChangePassword={handleChangePassword}
            mustChangePassword={session.account.mustChangePassword}
            onShowSettings={() => {
              rememberCurrentScreen();
              setActivePostId(null);
              setProfileMode('settings');
              setIsSideMenuOpen(false);
            }}
            onShowSecurity={() => {
              rememberCurrentScreen();
              setActivePostId(null);
              setProfileMode('security');
              setIsSideMenuOpen(false);
            }}
            onShowModeration={() => {
              if (session.account.role !== 'ADMIN' && session.account.role !== 'MODERATOR') {
                setProfileMode('view');
                showToast('Раздел доступен только модераторам и администраторам', 'error');
                return;
              }
              rememberCurrentScreen();
              setActivePostId(null);
              setProfileMode('moderation');
              setIsSideMenuOpen(false);
            }}
            onShowSubscription={() => {
              rememberCurrentScreen();
              setActivePostId(null);
              setProfileMode('subscription');
              setIsSideMenuOpen(false);
            }}
            onShowMessageSecurity={() => {
              rememberCurrentScreen();
              setActivePostId(null);
              setProfileMode('messageSecurity');
              setIsSideMenuOpen(false);
            }}
            onOpenEvent={handleOpenEvent}
            onProfileContentTabChange={setProfileContentTab}
            onPublicPageContentTabChange={setPublicPageContentTab}
            ownAccountId={session.account.id}
            ownInvisibleMode={session.account.invisibleMode}
            ownMessagePrivacy={session.account.messagePrivacy}
            ownShowSavedMusicOnProfile={session.account.showSavedMusicOnProfile}
            ownShowUploadedMusicOnProfile={session.account.showUploadedMusicOnProfile}
            ownShowBirthYear={session.account.showBirthYear}
            ownProfile={ownProfile ?? profile}
            ownReadReceiptsPrivacy={session.account.readReceiptsPrivacy}
            ownUsername={session.account.username}
            subscriptionExpiresAt={session.account.subscriptionExpiresAt}
            showSubscription={session.account.profileType === 'SUBSCRIBER' && (
              !session.account.subscriptionExpiresAt
              || new Date(session.account.subscriptionExpiresAt).getTime() > Date.now()
            )}
            authToken={session.token}
            profile={profile}
            profileMode={profileMode}
            playlistIdToEdit={playlistIdToEdit}
          />
        ) : isSessionRestoring || isLastScreenRestoring || (session && profile && isInitialRouteResolving) ? (
          <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}><DevelopmentLoadingScreen /></SafeAreaView>
        ) : (
          <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}><AuthScreen isLoading={isProfileLoading} onAuthenticated={handleAuthenticated} /></SafeAreaView>
        )}
        <TopToast onClose={closeToast} toast={toast} />
        {session ? <PushPermissionPrompt onNotify={showToast} /> : null}
      </View>
    </SafeAreaProvider>
  );
}

export default Sentry.wrap(App);

function DevelopmentLoadingScreen() {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const animation = Animated.loop(Animated.timing(progress, { duration: 1200, toValue: 1, useNativeDriver: true }));
    animation.start();
    return () => animation.stop();
  }, [progress]);
  return <View accessibilityLiveRegion="polite" accessibilityRole="progressbar" style={styles.sessionRestoreScreen}>
    <View style={styles.developmentLoadingContent}>
      <Text style={styles.developmentLoadingBrand}>ВОЛНА</Text>
      <View style={styles.developmentLoadingTrack}><Animated.View style={[styles.developmentLoadingBar, { transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [-116, 278] }) }] }]} /></View>
      <Text style={styles.developmentLoadingTitle}>Восстанавливаем сессию</Text>
      <Text style={styles.developmentLoadingNote}>Режим разработки — обновления приложения загружаются напрямую</Text>
    </View>
  </View>;
}

function MaintenanceScreen({ onRetry }: { onRetry: () => void }) {
  return <SafeAreaView edges={['top', 'bottom']} style={styles.maintenanceScreen}>
    <View style={styles.maintenanceContent}>
      <Text style={styles.maintenanceBrand}>ВОЛНА</Text>
      <Text style={styles.maintenanceTitle}>Технические работы</Text>
      <Text style={styles.maintenanceText}>Система заметила аномальную нагрузку и временно остановила основные запросы. Мы проверяем состояние автоматически.</Text>
      <Pressable accessibilityRole="button" onPress={onRetry} style={styles.maintenanceButton}>
        <Text style={styles.maintenanceButtonText}>Проверить снова</Text>
      </Pressable>
    </View>
  </SafeAreaView>;
}

function MainApp({
  accountRole,
  activeChat,
  activePublicPage,
  activePostId,
  activeEventId,
  activeTab,
  profileContentTab,
  publicPageContentTab,
  authToken,
  canGoBack,
  isRefreshingPublicPage,
  isProfileLoading,
  isRefreshing,
  isSideMenuOpen,
  onBlockProfile,
  onBlockPublicPage,
  onChangeTab,
  onChangePassword,
  mustChangePassword,
  onCloseEditCommunity,
  onCloseSideMenu,
  onCreateCommunity,
  onCreateEvent,
  onAddTeamMember,
  onAddPartnerPage,
  onGoBack,
  onLogout,
  onRefreshPublicPage,
  onOpenEdit,
  onOpenAdminProfileEdit,
  onOpenChat,
  onOpenCreateCommunity,
  onOpenCreateEvent,
  onOpenCommunityCabinet,
  onOpenMyCommunities,
  onOpenMyMusic,
  onEditPlaylist,
  onPlaylistEditorOpened,
  onOpenEditCommunity,
  onOpenMessages,
  onOpenMenu,
  onNotify,
  onOpenProfile,
  onOpenPost,
  onOpenMention,
  onOpenPublicPage,
  onRemoveTeamMember,
  onRemovePartnerPage,
  onOpenNotifications,
  onOpenEvent,
  onProfileContentTabChange,
  onPublicPageContentTabChange,
  onRefreshProfile,
  onCheckProfileReport,
  onReportProfile,
  onReportPublicPage,
  onSaveProfile,
  onSaveAdminProfile,
  onSaveCommunity,
  onSaveSettings,
  onToggleFollow,
  onToggleEventParticipation,
  onTogglePublicPageFollow,
  onToggleFavoritePublicPage,
  onShowSettings,
  onShowSecurity,
  onShowMessageSecurity,
  onShowSubscription,
  onShowModeration,
  ownAccountId,
  ownInvisibleMode,
  ownMessagePrivacy,
  ownShowSavedMusicOnProfile,
  ownShowUploadedMusicOnProfile,
  ownShowBirthYear,
  ownProfile,
  ownReadReceiptsPrivacy,
  ownUsername,
  subscriptionExpiresAt,
  showSubscription,
  profile,
  profileMode,
  playlistIdToEdit,
}: {
  accountRole: Account['role'];
  activeChat: string | null;
  activePublicPage: PublicPageDetail | null;
  activePostId: string | null;
  activeEventId: string | null;
  activeTab: AppTab;
  profileContentTab: ProfileContentTab;
  publicPageContentTab: PublicPageContentTab;
  authToken: string;
  canGoBack: boolean;
  isRefreshingPublicPage: boolean;
  isProfileLoading: boolean;
  isRefreshing: boolean;
  isSideMenuOpen: boolean;
  onBlockProfile: (username: string) => Promise<void>;
  onBlockPublicPage: (username: string) => Promise<void>;
  onChangeTab: (tab: AppTab) => void;
  onChangePassword: (data: { currentPassword: string; newPassword: string }) => Promise<void>;
  mustChangePassword: boolean;
  onCloseEditCommunity: () => void;
  onCloseSideMenu: () => void;
  onCreateCommunity: (data: CreateCommunityInput) => Promise<void>;
  onCreateEvent: (data: CreateEventInput, options?: { adminMode?: boolean }) => Promise<void>;
  onAddTeamMember: (pageUsername: string, data: TeamMemberInput) => Promise<void>;
  onAddPartnerPage: (pageUsername: string, data: PartnerPageInput) => Promise<void>;
  onGoBack: () => void;
  onLogout: () => void;
  onRefreshPublicPage: () => Promise<void>;
  onOpenEdit: () => void;
  onOpenAdminProfileEdit: () => void;
  onOpenChat: (username: string) => Promise<void>;
  onOpenCreateCommunity: () => void;
  onOpenCreateEvent: () => void;
  onOpenCommunityCabinet: () => void;
  onOpenMyCommunities: () => void;
  onOpenMyMusic: () => void;
  onEditPlaylist: (playlistId: string) => void;
  onPlaylistEditorOpened: () => void;
  onOpenEditCommunity: () => void;
  onOpenMessages: () => Promise<void>;
  onOpenMenu: () => void;
  onNotify: (message: string, type?: ToastMessage['type']) => void;
  onOpenProfile: (username: string) => Promise<void>;
  onOpenPost: (post: AppPost | QuotedPost) => Promise<void>;
  onOpenMention: (username: string) => Promise<void>;
  onOpenPublicPage: (username: string) => Promise<void>;
  onRemoveTeamMember: (pageUsername: string, accountUsername: string) => Promise<void>;
  onRemovePartnerPage: (pageUsername: string, partnerId: string) => Promise<void>;
  onOpenNotifications: () => void;
  onOpenEvent: (eventId: string) => void;
  onProfileContentTabChange: (tab: ProfileContentTab) => void;
  onPublicPageContentTabChange: (tab: PublicPageContentTab) => void;
  onRefreshProfile: () => void | Promise<void>;
  onCheckProfileReport: (username: string) => Promise<boolean>;
  onReportProfile: (
    username: string,
    reason: 'SPAM' | 'HARASSMENT' | 'IMPERSONATION' | 'ILLEGAL_CONTENT' | 'OTHER',
    details?: string,
  ) => Promise<void>;
  onReportPublicPage: (username: string, reason: 'SPAM' | 'HARASSMENT' | 'IMPERSONATION' | 'ILLEGAL_CONTENT' | 'OTHER') => Promise<void>;
  onSaveProfile: (data: ProfileUpdate, options?: { stayOnScreen?: boolean }) => Promise<void>;
  onSaveAdminProfile: (username: string, data: ProfileUpdate, options?: { stayOnScreen?: boolean }) => Promise<void>;
  onSaveCommunity: (pageUsername: string, data: UpdateCommunityInput, options?: { silent?: boolean }) => Promise<void>;
  onSaveSettings: (data: {
    messagePrivacy: MessagePrivacy;
    readReceiptsPrivacy: MessagePrivacy;
    invisibleMode: boolean;
    showSavedMusicOnProfile: boolean;
    showUploadedMusicOnProfile: boolean;
    showBirthYear: boolean;
  }) => Promise<void>;
  onToggleFollow: (username: string, followStatus: Profile['followStatus']) => Promise<void>;
  onToggleEventParticipation: (eventId: string, status: EventParticipationStatus | null) => Promise<EventSummary>;
  onTogglePublicPageFollow: (username: string, followStatus: PublicPage['followStatus']) => Promise<void>;
  onToggleFavoritePublicPage: (username: string, isFavorite: boolean) => Promise<void>;
  onShowSettings: () => void;
  onShowSecurity: () => void;
  onShowMessageSecurity: () => void;
  onShowSubscription: () => void;
  onShowModeration: () => void;
  ownAccountId: string;
  ownInvisibleMode: boolean;
  ownMessagePrivacy: ApiMessagePrivacy;
  ownShowSavedMusicOnProfile: boolean;
  ownShowUploadedMusicOnProfile: boolean;
  ownShowBirthYear: boolean;
  ownProfile: Profile;
  ownReadReceiptsPrivacy: ApiMessagePrivacy;
  ownUsername: string;
  subscriptionExpiresAt: string | null;
  showSubscription: boolean;
  profile: Profile;
  profileMode: ProfileMode;
  playlistIdToEdit: string | null;
}) {
  const [adminMode, setAdminMode] = useState(false);
  const [releaseComposerRequest, setReleaseComposerRequest] = useState<import('./src/components/GlobalAudioPlayer').TrackComposerRequest | null>(null);
  const [bottomNavigationHeight, setBottomNavigationHeight] = useState(0);
  const openMessagesFromHeader = useCallback(() => {
    void onOpenMessages().catch((error) => {
      onNotify(error instanceof Error ? error.message : 'Не удалось открыть сообщения', 'error');
    });
  }, [onNotify, onOpenMessages]);
  const isProfileRouteVisible = profileMode === 'ownProfile' || (profileMode === 'view' && (activeTab === 'profile' || profile.username !== ownUsername));
  const { width: windowWidth } = useWindowDimensions();
  const drawerWidth = Math.min(Math.max(windowWidth * 0.76, 278), 330);
  const drawerProgress = useRef(new Animated.Value(isSideMenuOpen ? 1 : 0)).current;
  const [isDrawerTransitionActive, setIsDrawerTransitionActive] = useState(isSideMenuOpen);

  useEffect(() => {
    if (isSideMenuOpen) {
      setIsDrawerTransitionActive(true);
    }

    if (Platform.OS === 'web') {
      const timeout = setTimeout(() => {
        if (!isSideMenuOpen) {
          setIsDrawerTransitionActive(false);
        }
      }, isSideMenuOpen ? 280 : 240);
      return () => clearTimeout(timeout);
    }

    Animated.timing(drawerProgress, {
      toValue: isSideMenuOpen ? 1 : 0,
      duration: isSideMenuOpen ? 260 : 220,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished && !isSideMenuOpen) {
        setIsDrawerTransitionActive(false);
      }
    });
  }, [drawerProgress, isSideMenuOpen]);

  const appTranslateX = drawerProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -drawerWidth],
  });
  const appSurfaceMotionStyle = Platform.OS === 'web'
    ? {
        transform: [{ translateX: isSideMenuOpen ? -drawerWidth : 0 }],
        transitionDuration: isSideMenuOpen ? '280ms' : '240ms',
        transitionProperty: 'transform',
        transitionTimingFunction: isSideMenuOpen
          ? 'cubic-bezier(0.22, 1, 0.36, 1)'
          : 'cubic-bezier(0.4, 0, 0.2, 1)',
      }
    : { transform: [{ translateX: appTranslateX }] };

  if (mustChangePassword) {
    return <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}><PasswordSecurityScreen forced onBack={() => undefined} onChangePassword={onChangePassword} /></SafeAreaView>;
  }

  return (
    <GlobalAudioProvider
      onAddTrackToPost={(track) => {
        setReleaseComposerRequest({ track, nonce: Date.now() });
        onChangeTab('feed');
      }}
      onNotify={onNotify}
      storageScope={ownAccountId}
    >
    <View style={styles.appShell}>
      <View pointerEvents={isSideMenuOpen ? 'auto' : 'none'} style={[styles.sideMenuLayer, { width: drawerWidth }]}>
        <SafeAreaView edges={['top', 'bottom']} style={styles.drawerSafeArea}>
        <SideMenu
          adminMode={adminMode}
          isOpen={isSideMenuOpen}
          isAdmin={accountRole === 'ADMIN'}
          onChangeAdminMode={(enabled) => {
            setAdminMode(enabled);
            onNotify(enabled ? 'Режим администрирования включён' : 'Режим администрирования выключен', 'success');
          }}
          onClose={onCloseSideMenu}
          onLogout={onLogout}
          onOpenEdit={onOpenEdit}
          onOpenProfile={() => {
            void onOpenProfile(ownUsername).catch((error) => {
              onNotify(error instanceof Error ? error.message : 'Не удалось открыть профиль', 'error');
            });
          }}
          profile={ownProfile}
          onShowMyCommunities={onOpenMyCommunities}
          onShowMyMusic={onOpenMyMusic}
          onShowMessages={() => {
            void onOpenMessages().catch((error) => {
              onNotify(error instanceof Error ? error.message : 'Не удалось открыть сообщения', 'error');
            });
          }}
          onShowSecurity={onShowSecurity}
          onShowSubscription={onShowSubscription}
          onShowModeration={onShowModeration}
          onShowSettings={onShowSettings}
          showModeration={accountRole === 'MODERATOR' || accountRole === 'ADMIN'}
          showSubscription={showSubscription}
        />
        </SafeAreaView>
      </View>
      <Animated.View
        needsOffscreenAlphaCompositing={isDrawerTransitionActive}
        renderToHardwareTextureAndroid={isDrawerTransitionActive}
        shouldRasterizeIOS={isDrawerTransitionActive}
        style={[
          styles.appSurfaceFrame,
          styles.appSurfaceAnimated,
          isDrawerTransitionActive && styles.appSurfaceShifted,
          appSurfaceMotionStyle,
        ]}
      >
        <SafeAreaView edges={['top']} style={[styles.appSurface, isDrawerTransitionActive && styles.appSurfaceClipped]}>
        <View style={styles.mainContent}>
          {activeTab === 'feed' && profileMode === 'view' && !isProfileRouteVisible ? (
            <FeedScreen
              authToken={authToken}
              composerAuthor={{ avatarUrl: ownProfile.avatarUrl, isVerified: ownProfile.isVerified, name: ownProfile.name, username: ownProfile.username }}
              composerRequest={releaseComposerRequest}
              onNotify={onNotify}
              onOpenMenu={onOpenMenu}
              onOpenMessages={openMessagesFromHeader}
              onOpenNotifications={onOpenNotifications}
              onOpenPost={onOpenPost}
              onOpenProfile={onOpenProfile}
              onOpenPublicPage={onOpenPublicPage}
              username={ownUsername}
            />
          ) : null}
          {activeTab === 'events' && profileMode === 'view' && !isProfileRouteVisible ? (
            <EventsScreen
              accountRole={accountRole}
              adminMode={adminMode}
              authToken={authToken}
              defaultLocation={{
                cityId: ownProfile.cityId,
                cityName: ownProfile.cityName,
                countryCode: ownProfile.countryCode,
                countryName: ownProfile.countryName,
              }}
              initialEventId={activeEventId}
              onBackFromInitialEvent={onGoBack}
              onOpenMenu={onOpenMenu}
              onOpenMessages={openMessagesFromHeader}
              onOpenNotifications={onOpenNotifications}
              onOpenProfile={onOpenProfile}
              onOpenPublicPage={onOpenPublicPage}
              onToggleEventParticipation={onToggleEventParticipation}
              onNotify={onNotify}
              ownAccountId={ownAccountId}
            />
          ) : null}
          {activeTab === 'locations' && profileMode === 'view' && !isProfileRouteVisible ? (
            <LocationsScreen
              defaultLocation={{
                cityId: ownProfile.cityId,
                cityName: ownProfile.cityName,
                countryCode: ownProfile.countryCode,
                countryName: ownProfile.countryName,
              }}
              onOpenMenu={onOpenMenu}
              onOpenMessages={openMessagesFromHeader}
              onOpenNotifications={onOpenNotifications}
              onOpenPublicPage={onOpenPublicPage}
              onOpenProfile={onOpenProfile}
            />
          ) : null}
          {activeTab === 'community' && profileMode === 'view' && !isProfileRouteVisible ? (
            <CommunityScreen
              connectEnabled={ownProfile.connectEnabled}
              onNotify={onNotify}
              onOpenEditProfile={onOpenEdit}
              onOpenMenu={onOpenMenu}
              onOpenMessages={openMessagesFromHeader}
              onOpenNotifications={onOpenNotifications}
              onOpenProfile={onOpenProfile}
              onOpenPublicPage={onOpenPublicPage}
              onCheckProfileReport={onCheckProfileReport}
              onReportProfile={onReportProfile}
              ownUsername={ownUsername}
            />
          ) : null}
          {activeTab === 'music' && profileMode === 'view' && !isProfileRouteVisible ? (
            <MusicCatalogScreen
              onEditPlaylist={onEditPlaylist}
              onOpenMenu={onOpenMenu}
              onOpenMessages={openMessagesFromHeader}
              onOpenNotifications={onOpenNotifications}
              onOpenPublicPage={onOpenPublicPage}
              onNotify={onNotify}
              onRefreshProfile={onRefreshProfile}
              profile={profile}
            />
          ) : null}
          {activeTab === 'messages' && profileMode === 'view' && !isProfileRouteVisible ? (
            <MessagesScreen
              accountId={ownAccountId}
              controller={messagingSurfaceController}
              onActivity={() => void refreshNotificationBadge({ force: true })}
              onBack={onGoBack}
              onOpenMenu={onOpenMenu}
              onOpenChat={onOpenChat}
              onOpenNotifications={onOpenNotifications}
              ownUsername={ownUsername}
            />
          ) : null}
          {isProfileRouteVisible ? (
            <ProfileScreen
              activeContentTab={profileContentTab}
              adminMode={accountRole === 'ADMIN' && adminMode}
              authToken={authToken}
              canGoBack={canGoBack}
              isLoading={isProfileLoading}
              isRefreshing={isRefreshing}
              onBack={onGoBack}
              onBlock={onBlockProfile}
              onOpenEdit={onOpenEdit}
              onOpenAdminProfileEdit={onOpenAdminProfileEdit}
              onOpenEvent={onOpenEvent}
              onOpenChat={onOpenChat}
              onOpenMenu={onOpenMenu}
              onOpenMessages={openMessagesFromHeader}
              onOpenMention={onOpenMention}
              onOpenNotifications={onOpenNotifications}
              onOpenPublicPage={onOpenPublicPage}
              onOpenProfile={onOpenProfile}
              onOpenPost={onOpenPost}
              onContentTabChange={onProfileContentTabChange}
              focusPostId={null}
              onNotify={onNotify}
              onRefresh={onRefreshProfile}
              onReport={onReportProfile}
              onSave={onSaveProfile}
              onToggleFollow={onToggleFollow}
              onToggleEventParticipation={onToggleEventParticipation}
              ownUsername={ownUsername}
              profile={profile}
            />
          ) : null}
          {profileMode === 'edit' ? (
            <EditProfileScreen
              authToken={authToken}
              onBack={onGoBack}
              onNotify={onNotify}
              onSave={onSaveProfile}
              profile={ownProfile}
            />
          ) : null}
          {profileMode === 'editAdminProfile' ? (
            <EditProfileScreen
              administrativeTarget
              authToken={authToken}
              onBack={onGoBack}
              onNotify={onNotify}
              onSave={(data, options) => onSaveAdminProfile(profile.username, data, options)}
              profile={profile}
            />
          ) : null}
          {profileMode === 'settings' ? (
            <SettingsScreen
              initialInvisibleMode={ownInvisibleMode}
              initialMessagePrivacy={fromApiMessagePrivacy(ownMessagePrivacy)}
              initialReadReceiptsPrivacy={fromApiMessagePrivacy(ownReadReceiptsPrivacy)}
              initialShowBirthYear={ownShowBirthYear}
              initialShowSavedMusicOnProfile={ownShowSavedMusicOnProfile}
              initialShowUploadedMusicOnProfile={ownShowUploadedMusicOnProfile}
              onBack={onGoBack}
              onSave={onSaveSettings}
            />
          ) : null}
          {profileMode === 'security' ? (
            <PasswordSecurityScreen
              onBack={onGoBack}
              onChangePassword={onChangePassword}
              onOpenMessageSecurity={onShowMessageSecurity}
            />
          ) : null}
          {profileMode === 'messageSecurity' ? (
            <MessageSecurityScreen
              accountId={ownAccountId}
              onBack={onGoBack}
              onNotify={onNotify}
            />
          ) : null}
          {profileMode === 'moderation' && (accountRole === 'ADMIN' || accountRole === 'MODERATOR') ? (
            <ModerationCenterScreen
              accountRole={accountRole === 'ADMIN' ? 'ADMIN' : 'MODERATOR'}
              adminMode={adminMode}
              authToken={authToken}
              onBack={onGoBack}
              onChangeAdminMode={(enabled) => { setAdminMode(enabled); onNotify(enabled ? 'Режим администрирования включён' : 'Режим администрирования выключен', 'success'); }}
              onNotify={onNotify}
            />
          ) : null}
          {profileMode === 'subscription' ? (
            <SubscriptionScreen expiresAt={subscriptionExpiresAt} isActive={showSubscription} onBack={onGoBack} />
          ) : null}
          {profileMode === 'myMusic' ? (
            <MyMusicScreen
              authToken={authToken}
              initialPlaylistId={playlistIdToEdit}
              onBack={onGoBack}
              onInitialPlaylistOpened={onPlaylistEditorOpened}
              onNotify={onNotify}
              onRefreshProfile={onRefreshProfile}
              onSave={onSaveProfile}
              profile={profile}
            />
          ) : null}
          {profileMode === 'myCommunities' ? (
            <MyCommunitiesScreen
              onBack={onGoBack}
              onCreateCommunity={onOpenCreateCommunity}
              onCreateEvent={onOpenCreateEvent}
              onEditCommunity={async (username) => {
                try {
                  await onOpenPublicPage(username);
                  onOpenEditCommunity();
                } catch (error) {
                  onNotify(error instanceof Error ? error.message : 'Не удалось открыть редактирование сообщества', 'error');
                }
              }}
              onOpenCommunityCabinet={async (username) => {
                try {
                  await onOpenPublicPage(username);
                  onOpenCommunityCabinet();
                } catch (error) {
                  onNotify(error instanceof Error ? error.message : 'Не удалось открыть кабинет сообщества', 'error');
                }
              }}
              onNotify={onNotify}
              onOpenPublicPage={onOpenPublicPage}
            />
          ) : null}
          {profileMode === 'communityCabinet' && activePublicPage ? (
            <CommunityCabinetScreen authToken={authToken} isOwner={activePublicPage.ownerId === ownAccountId} onBack={onGoBack} onNotify={onNotify} page={activePublicPage} />
          ) : null}
          {profileMode === 'createCommunity' ? (
            <CreateCommunityScreen
              onBack={onGoBack}
              onCreate={onCreateCommunity}
              onNotify={onNotify}
            />
          ) : null}
          {profileMode === 'createEvent' ? (
            <CreateEventScreen
              adminMode={accountRole === 'ADMIN' && adminMode}
              authToken={authToken}
              onBack={onGoBack}
              onCreate={(data) => onCreateEvent(data, { adminMode: accountRole === 'ADMIN' && adminMode })}
              onNotify={onNotify}
              ownAccountId={ownAccountId}
            />
          ) : null}
          {profileMode === 'editCommunity' && activePublicPage ? (
            <PublicPageEditScreen
              authToken={authToken}
              canEditUsername={activePublicPage.ownerId === ownAccountId}
              onAddPartnerPage={(data) => onAddPartnerPage(activePublicPage.username, data)}
              onAddTeamMember={(data) => onAddTeamMember(activePublicPage.username, data)}
              onBack={onCloseEditCommunity}
              onNotify={onNotify}
              onOpenProfile={onOpenProfile}
              onOpenPublicPage={onOpenPublicPage}
              onRemovePartnerPage={(partnerId) => onRemovePartnerPage(activePublicPage.username, partnerId)}
              onRemoveTeamMember={(accountUsername) => onRemoveTeamMember(activePublicPage.username, accountUsername)}
              onSave={(data, options) => onSaveCommunity(activePublicPage.username, data, options)}
              page={activePublicPage}
            />
          ) : null}
          {profileMode === 'publicPage' && activePublicPage ? (
            <PublicPageScreen
              activeContentTab={publicPageContentTab}
              adminMode={accountRole === 'ADMIN' && adminMode}
              isGlobalAdmin={accountRole === 'ADMIN'}
              authToken={authToken}
              canGoBack={canGoBack}
              onBack={onGoBack}
              onOpenMenu={onOpenMenu}
              onOpenMessages={openMessagesFromHeader}
              onOpenNotifications={onOpenNotifications}
              onOpenCreateEvent={onOpenCreateEvent}
              onOpenCommunityCabinet={onOpenCommunityCabinet}
              onOpenEditCommunity={onOpenEditCommunity}
              onOpenMention={onOpenMention}
              onOpenProfile={onOpenProfile}
              onOpenPost={onOpenPost}
              onContentTabChange={onPublicPageContentTabChange}
              focusPostId={null}
              onTogglePublicPageFollow={onTogglePublicPageFollow}
              onToggleEventParticipation={onToggleEventParticipation}
              onToggleFavorite={onToggleFavoritePublicPage}
              onAddTeamMember={onAddTeamMember}
              onAddPartnerPage={onAddPartnerPage}
              onNotify={onNotify}
              onOpenPublicPage={onOpenPublicPage}
              onBlockPublicPage={onBlockPublicPage}
              onReportPublicPage={onReportPublicPage}
              onRemoveTeamMember={onRemoveTeamMember}
              onRemovePartnerPage={onRemovePartnerPage}
              ownAccountId={ownAccountId}
              page={activePublicPage}
              isRefreshing={isRefreshingPublicPage}
              onRefresh={onRefreshPublicPage}
            />
          ) : null}
          {profileMode === 'notifications' ? (
            <NotificationsScreen authToken={authToken} onBack={onGoBack} onNotify={onNotify} onOpenChat={onOpenChat} onOpenEditProfile={onOpenEdit} onOpenEvent={onOpenEvent} onOpenMenu={onOpenMenu} onOpenMessages={openMessagesFromHeader} onOpenProfile={onOpenProfile} onOpenPublicPage={onOpenPublicPage} />
          ) : null}
          {profileMode === 'notFound' ? <EntityNotFoundScreen onBack={onGoBack} /> : null}
          {profileMode === 'messages' ? (
            <MessagesScreen
              accountId={ownAccountId}
              controller={messagingSurfaceController}
              onActivity={() => void refreshNotificationBadge({ force: true })}
              onBack={onGoBack}
              onOpenChat={onOpenChat}
              ownUsername={ownUsername}
            />
          ) : null}
          {profileMode === 'chat' && activeChat ? (
            <ChatScreen
              accountId={ownAccountId}
              controller={messagingSurfaceController}
              onActivity={() => void refreshNotificationBadge({ force: true })}
              onBack={onGoBack}
              onOpenEvent={onOpenEvent}
              onOpenMessageSecurity={onShowMessageSecurity}
              onOpenProfile={onOpenProfile}
              onOpenPublicPage={onOpenPublicPage}
              partnerUsername={activeChat}
            />
          ) : null}
          {activePostId ? (
            <PostThreadScreen
              authToken={authToken}
              onBack={onGoBack}
              onNotify={onNotify}
              onOpenMenu={onOpenMenu}
              onOpenMessages={onOpenMessages}
              onOpenNotifications={onOpenNotifications}
              onOpenPost={onOpenPost}
              onOpenProfile={onOpenProfile}
              onOpenPublicPage={onOpenPublicPage}
              postId={activePostId}
            />
          ) : null}
        </View>
        <GlobalMiniPlayer bottomNavigationHeight={bottomNavigationHeight} hasBottomNavigation={profileMode !== 'chat'} onOpenProfile={onOpenProfile} onOpenPublicPage={onOpenPublicPage} />
        {profileMode !== 'chat' ? <BottomNavigation activeTab={activeTab} onChangeTab={onChangeTab} onHeightChange={setBottomNavigationHeight} /> : null}
        {isSideMenuOpen ? (
          <Pressable accessibilityRole="button" onPress={onCloseSideMenu} style={styles.drawerCloseLayer} />
        ) : null}
        </SafeAreaView>
      </Animated.View>
    </View>
    </GlobalAudioProvider>
  );
}

