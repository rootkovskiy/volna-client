import FontAwesome6 from '@expo/vector-icons/FontAwesome6';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, Disc3, EllipsisVertical, Flag, GripVertical, Heart, Images, Info, Link2, List, MapPin, MessageSquare, Pause, Pencil, Play, Plus, Radio, Search, Share2, ShieldBan, ShieldCheck, UsersRound, Volume2, X } from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, Animated, AppState, Easing, Keyboard, KeyboardAvoidingView, LayoutAnimation, Linking, Modal, PanResponder, Platform, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View, type ImageStyle } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppImage as Image } from '../components/AppImage';
import { apiFetch as fetch, apiUrl, readApiError, remoteSearchDebounceMs } from '../api/client';
import { buildMusicGenreValue, clamp, connectInterestGroups, connectInterestLabels, connectInterestLimit, connectPhotoThumbnail, countryOptions, formatCityName, formatCountryCity, getAvatarInitial, groupMusicGenreChips, isMusicSubgenreValue, musicArtworkThumbnail, musicGenreLimit, musicGenreSearchText, musicSubgenreDisplayName, musicTaxonomy, normalizeBandcampEmbedInput, normalizeMusicGenres, normalizeSocialLink, normalizeUsernameInput, profilePreviewPlayers, publicPageTypeLabels, russianPlural, uploadAvatarAsset, uploadConnectPhotoAsset, validateDisplayName } from '../domain';
import { ScreenTopBar } from '../components/navigation';
import { VolnaSwitch } from '../components/VolnaSwitch';
import { emitPlaybackVisibilityChanged } from '../components/playbackActivityEvents';
import { PostFeed, usePostAvailability } from '../components/PostFeed';
import { FollowListModal, MutualFollowersSummary } from '../components/FollowListModal';
import { MentionText } from '../components/MentionText';
import { LocationPickerModal, type LocationSelection } from '../components/LocationPickerModal';
import { AppRefreshControl } from '../components/AppRefreshControl';
import { EditorAutosaveStatus } from '../components/EditorAutosaveStatus';
import { AvatarEditButton } from '../components/AvatarEditButton';
import { MarqueeTrackTitle, type GlobalTrack, type GlobalTrackQueueItem, useGlobalAudioControls } from '../components/GlobalAudioPlayer';
import { bandcampPlaybackUrl, buildPlayableQueue, getBandcampRelease, getSoundcloudRelease, peekBandcampRelease, type SoundcloudReleaseSnapshot } from '../music/musicRuntime';
import { AppSheetModal } from '../components/AppSheetModal';
import { SelectionPickerModal, type SelectionPickerOption } from '../components/SelectionPickerModal';
import { recordClientRender } from '../monitoring/clientTelemetry';
import { EntityShareModal } from '../components/EntityShareModal';
import { AnimatedSegmentedControl } from '../components/AnimatedSegmentedControl';
import { VerifiedName } from '../components/VerifiedBadge';
import { CompactTrackScrubber } from '../components/CompactTrackScrubber';
import { AudioReleaseAttachmentCard } from '../components/AudioReleaseAttachmentCard';
import { ExpandableReleaseTrackList } from '../components/ExpandableReleaseTrackList';
import { boundedPlaybackQueue, normalizeMusicTrackTitle, normalizeYouTubeTrackMetadata, uploadedTrackPlayerId } from '../components/audioPlayerCore';
import { YouTubeAudioEngine } from '../components/YouTubeAudioEngine';
import { ReleaseMetadataRows } from '../components/ReleaseMetadataRows';
import { subscribeMusicLibraryChanged } from '../components/musicLibraryEvents';
import { AnimatedMusicLibraryRow } from '../components/AnimatedMusicLibraryRow';
import type { YouTubeAudioEngineHandle, YouTubeAudioSnapshot } from '../components/YouTubeAudioEngine.types';
import { getProfileTextViolation } from '@volna/content-policy';
import { getForegroundLocationAccess, requestForegroundLocationAccess } from '../location/foregroundLocation';
import { normalizeExternalHttpsUrl } from '../security/externalUrls.mjs';
import { openExternalHttpsUrl } from '../security/openExternalUrl';
import { EventSection } from './EventScreens';
import { styles } from '../styles';
import type { AppleMusicTrack, AppPost, AvatarCropAsset, BandcampReleaseSnapshot, ConnectGoal, ConnectPhoto, EventParticipationStatus, EventSummary, Gender, Profile, ProfileContentTab, ProfileEvent, ProfileMusicTrack, ProfilePlaybackActivity, ProfileUpdate, PublicPageAudioRelease, PublicUploadedMusicTrack, QuotedPost, SocialLinkKind, ToastMessage } from '../types';

const profileContentPageSize = 10;
const connectPhotoAspectRatio = 9 / 16;
const connectPhotoOutputWidth = 1080;
const connectPhotoOutputHeight = 1920;
const profileRegistrationDateFormatter = new Intl.DateTimeFormat('ru-RU', {
  month: 'long',
  year: 'numeric',
});

function formatProfileRegistrationDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : profileRegistrationDateFormatter.format(date);
}

export function ProfileScreen({
  activeContentTab,
  adminMode = false,
  authToken,
  canGoBack,
  isLoading,
  isRefreshing,
  onBack,
  onBlock,
  onContentTabChange,
  onOpenChat,
  onOpenEdit,
  onOpenAdminProfileEdit,
  onOpenEvent,
  onOpenMenu,
  onOpenMessages,
  onOpenMention,
  onOpenNotifications,
  onOpenPublicPage,
  onOpenProfile,
  onOpenPost,
  focusPostId,
  onNotify,
  onRefresh,
  onReport,
  onSave,
  onToggleFollow,
  onToggleEventParticipation,
  ownUsername,
  profile,
}: {
  activeContentTab: ProfileContentTab;
  adminMode?: boolean;
  authToken: string;
  canGoBack: boolean;
  isLoading: boolean;
  isRefreshing: boolean;
  onBack: () => void;
  onBlock: (username: string) => Promise<void>;
  onContentTabChange: (tab: ProfileContentTab) => void;
  onOpenChat: (username: string) => Promise<void>;
  onOpenEdit: () => void;
  onOpenAdminProfileEdit: () => void;
  onOpenEvent: (eventId: string) => void;
  onOpenMenu: () => void;
  onOpenMessages: () => void;
  onOpenMention: (username: string) => Promise<void>;
  onOpenNotifications: () => void;
  onOpenPublicPage: (username: string) => Promise<void>;
  onOpenProfile: (username: string) => Promise<void>;
  onOpenPost: (post: AppPost | QuotedPost) => Promise<void>;
  focusPostId: string | null;
  onNotify: (message: string, type?: ToastMessage['type']) => void;
  onRefresh: () => void;
  onReport: (username: string, reason: 'SPAM' | 'HARASSMENT' | 'IMPERSONATION' | 'ILLEGAL_CONTENT' | 'OTHER') => Promise<void>;
  onSave: (data: ProfileUpdate, options?: { stayOnScreen?: boolean }) => Promise<void>;
  onToggleFollow: (username: string, followStatus: Profile['followStatus']) => Promise<void>;
  onToggleEventParticipation: (eventId: string, status: EventParticipationStatus | null) => Promise<EventSummary>;
  ownUsername: string;
  profile: Profile;
}) {
  const registrationDate = formatProfileRegistrationDate(profile.createdAt);
  const isOwnProfile = profile.username === ownUsername;
  const globalAudio = useGlobalAudioControls();
  const [displayedMusicTracks, setDisplayedMusicTracks] = useState<ProfileMusicTrack[]>(
    () => profile.musicTracks ?? [],
  );
  const [enteringMusicTrackIds, setEnteringMusicTrackIds] = useState<string[]>([]);
  const [leavingMusicTrackIds, setLeavingMusicTrackIds] = useState<string[]>([]);
  const musicEntranceTimers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const [isLiked, setIsLiked] = useState(false);
  const selectContentTab = (tab: ProfileContentTab) => {
    onContentTabChange(tab);
    if (Platform.OS === 'web' && typeof window !== 'undefined') window.history.replaceState({}, '', `/${profile.username}${tab === 'feed' ? '' : `?tab=${encodeURIComponent(tab)}`}`);
  };
  const [showPastEvents, setShowPastEvents] = useState(false);
  const [isAvatarModalOpen, setIsAvatarModalOpen] = useState(false);
  const [isFollowSaving, setIsFollowSaving] = useState(false);
  const [isSafetyMenuOpen, setIsSafetyMenuOpen] = useState(false);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [isInformationNoticeOpen, setIsInformationNoticeOpen] = useState(false);
  const [followList, setFollowList] = useState<'mutual' | 'followers' | 'following' | null>(null);
  const [isVerified, setIsVerified] = useState(profile.isVerified);
  const [isVerificationSaving, setIsVerificationSaving] = useState(false);
  const canManageProfile = adminMode && !isOwnProfile;

  const [isMusicDragging, setIsMusicDragging] = useState(false);
  const [visibleContentItemCount, setVisibleContentItemCount] = useState(profileContentPageSize);
  const [livePlayback, setLivePlayback] = useState<ProfilePlaybackActivity | null>(profile.currentPlayback ?? null);
  const lastContentLoadHeight = useRef(0);
  useEffect(() => setIsVerified(profile.isVerified), [profile.id, profile.isVerified]);
  useEffect(() => {
    setVisibleContentItemCount(profileContentPageSize);
    lastContentLoadHeight.current = 0;
  }, [activeContentTab, profile.id]);
  useEffect(() => {
    let cancelled = false;
    setLivePlayback(profile.currentPlayback ?? null);
    const refresh = async () => {
      try {
        const response = await fetch(`${apiUrl}/profiles/${encodeURIComponent(profile.username)}/playback`);
        if (!response.ok) return;
        const result = await response.json() as { playback?: ProfilePlaybackActivity | null };
        if (!cancelled) setLivePlayback(result.playback ?? null);
      } catch {
        // A transient network failure must not erase the last confirmed state.
      }
    };
    void refresh();
    const interval = setInterval(() => { void refresh(); }, 5_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [profile.currentPlayback, profile.username]);
  const updateVerification = async (nextValue: boolean) => {
    setIsVerificationSaving(true);
    try {
      const response = await fetch(`${apiUrl}/profiles/${encodeURIComponent(profile.username)}/verification`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ isVerified: nextValue }),
      });
      if (!response.ok) throw new Error(await readApiError(response, 'Не удалось изменить статус аккаунта'));
      setIsVerified(nextValue);
      onNotify(nextValue ? 'Аккаунт подтверждён' : 'Подтверждение аккаунта снято', 'success');
    } catch (error) {
      onNotify(error instanceof Error ? error.message : 'Не удалось изменить статус аккаунта', 'error');
    } finally {
      setIsVerificationSaving(false);
    }
  };
  const updateEventParticipation = async (event: ProfileEvent, status: EventParticipationStatus) => {
    const nextStatus = event.myParticipationStatus === status ? null : status;
    await onToggleEventParticipation(event.id, nextStatus);
    onRefresh();
  };
  const ownLivePlayback = useMemo<ProfilePlaybackActivity | null>(() => {
    const track = globalAudio.activeTrack;
    if (!isOwnProfile || !profile.sharePlaybackActivity || !globalAudio.isPlaying || !track?.title?.trim() || !track.previewUrl?.trim()) {
      return null;
    }
    return {
      id: track.id,
      title: track.title,
      artist: track.artist ?? null,
      artworkUrl: track.artworkUrl ?? null,
      previewUrl: track.previewUrl,
      externalUrl: track.externalUrl ?? null,
      provider: track.provider ?? 'volna',
      startSeconds: track.startSeconds ?? 0,
      clipDurationSeconds: track.clipDurationSeconds ?? 30,
      isLiveStream: track.isLiveStream === true,
      radioStationName: track.isLiveStream ? track.radioStationName?.trim() || null : null,
    };
  }, [globalAudio.activeTrack, globalAudio.isPlaying, isOwnProfile, profile.sharePlaybackActivity]);
  // The owner already has the authoritative player state locally. Render it
  // immediately instead of waiting for the heartbeat round-trip and the next
  // profile polling tick. Other visitors continue to receive the same state
  // from the server endpoint.
  const displayedPlayback = ownLivePlayback ?? livePlayback;
  const canPreviewAvatar = Boolean(profile.avatarUrl);
  const locationLabel = formatCountryCity(profile.countryName, profile.cityName);
  const hasTrackPill = Boolean(displayedPlayback?.title?.trim() && displayedPlayback.previewUrl?.trim())
    || Boolean(profile.trackTitle?.trim() && profile.trackPreviewUrl?.trim());
  const headerTrackDisplay = useMemo(() => {
    const rawTitle = profile.trackTitle?.trim() ?? '';
    if (profile.trackProvider !== 'uploaded') {
      return { artist: profile.trackArtist, title: rawTitle };
    }
    const separatorIndex = rawTitle.indexOf(' - ');
    if (separatorIndex <= 0 || separatorIndex >= rawTitle.length - 3) {
      return { artist: null, title: rawTitle };
    }
    return {
      artist: rawTitle.slice(0, separatorIndex).trim(),
      title: rawTitle.slice(separatorIndex + 3).trim(),
    };
  }, [profile.trackArtist, profile.trackProvider, profile.trackTitle]);
  const headerTrack = displayedPlayback
    ? {
        artist: displayedPlayback.isLiveStream ? null : displayedPlayback.artist,
        artworkUrl: displayedPlayback.artworkUrl,
        clipDurationSeconds: displayedPlayback.clipDurationSeconds,
        prefix: 'Сейчас слушает: ',
        previewUrl: displayedPlayback.previewUrl,
        provider: displayedPlayback.provider,
        startSeconds: displayedPlayback.startSeconds,
        title: displayedPlayback.isLiveStream
          ? displayedPlayback.radioStationName?.trim() || displayedPlayback.title
          : displayedPlayback.title,
      }
    : {
        artist: headerTrackDisplay.artist,
        artworkUrl: profile.trackArtworkUrl,
        clipDurationSeconds: profile.trackClipDurationSeconds,
        prefix: '',
        previewUrl: profile.trackPreviewUrl,
        provider: profile.trackProvider,
        startSeconds: profile.trackStartSeconds,
        title: headerTrackDisplay.title,
      };
  const hasEvents = [...profile.upcoming, ...profile.planned, ...profile.pastUpcoming, ...profile.pastPlanned].length > 0;
  const hasPastEvents = profile.pastUpcoming.length > 0 || profile.pastPlanned.length > 0;
  const hasMusic = Boolean(profile.artistReleases?.length || displayedMusicTracks.length || profile.uploadedMusicTracks?.length || profile.trackTitle?.trim() || profile.soundcloudMusicUrl?.trim() || profile.bandcampMusicEmbedUrl?.trim());
  const hasFavoriteLocations = profile.favoriteLocations.length > 0;
  const hasPosts = usePostAvailability('account', profile.username);
  const visibleContentTabs = useMemo(() => [
    ...(isOwnProfile || hasPosts ? [{ label: 'Публикации', value: 'feed' as const, icon: List }] : []),
    ...(isOwnProfile ? [{ label: 'Медиа', value: 'photos' as const, icon: Images }] : []),
    ...(hasEvents ? [{ label: 'События', value: 'events' as const, icon: CalendarDays }] : []),
    ...(hasMusic ? [{ label: 'Музыка', value: 'music' as const, icon: Disc3 }] : []),
    ...(hasFavoriteLocations ? [{ label: 'Любимые локации и сообщества', value: 'locations' as const, icon: UsersRound }] : []),
  ], [hasEvents, hasMusic, hasFavoriteLocations, hasPosts, isOwnProfile]);

  useEffect(() => {
    if (!visibleContentTabs.some((tab) => tab.value === activeContentTab)) {
      onContentTabChange(visibleContentTabs[0]?.value ?? 'feed');
    }
  }, [activeContentTab, onContentTabChange, visibleContentTabs]);
  useEffect(() => {
    setDisplayedMusicTracks(profile.musicTracks ?? []);
  }, [profile.musicTracks]);
  useEffect(() => () => {
    musicEntranceTimers.current.forEach(clearTimeout);
    musicEntranceTimers.current.clear();
  }, []);
  useEffect(() => {
    if (!isOwnProfile || activeContentTab !== 'music') return undefined;
    return subscribeMusicLibraryChanged((change) => {
      if (change.type === 'collection-track-added') {
        setDisplayedMusicTracks((current) => {
          const duplicateIndex = current.findIndex((track) => track.id === change.track.id);
          if (duplicateIndex < 0) return [change.track, ...current];
          const next = [...current];
          next[duplicateIndex] = change.track;
          return next;
        });
        setEnteringMusicTrackIds((current) => current.includes(change.track.id) ? current : [...current, change.track.id]);
        const timer = setTimeout(() => {
          musicEntranceTimers.current.delete(timer);
          setEnteringMusicTrackIds((current) => current.filter((id) => id !== change.track.id));
        }, 180);
        musicEntranceTimers.current.add(timer);
        onRefresh();
      } else if (change.type === 'collection-track-removed') {
        setLeavingMusicTrackIds((current) => current.includes(change.track.id) ? current : [...current, change.track.id]);
      }
    });
  }, [activeContentTab, isOwnProfile, onRefresh]);
  const finishMusicTrackRemoval = useCallback((trackId: string) => {
    setDisplayedMusicTracks((current) => current.filter((track) => track.id !== trackId));
    setLeavingMusicTrackIds((current) => current.filter((id) => id !== trackId));
    onRefresh();
  }, [onRefresh]);
  const hasSocialLinks = [
    profile.bandcampUrl,
    profile.soundcloudUrl,
    profile.instagramUrl,
    profile.threadsUrl,
    profile.telegramUrl,
    profile.youtubeUrl,
    profile.letterboxdUrl,
  ].some(Boolean);
  const visibleUpcoming = profile.upcoming.slice(0, visibleContentItemCount);
  const remainingAfterUpcoming = Math.max(0, visibleContentItemCount - visibleUpcoming.length);
  const visiblePlanned = profile.planned.slice(0, remainingAfterUpcoming);
  const remainingAfterFuture = Math.max(0, remainingAfterUpcoming - visiblePlanned.length);
  const visiblePastUpcoming = showPastEvents ? profile.pastUpcoming.slice(0, remainingAfterFuture) : [];
  const remainingAfterPastUpcoming = Math.max(0, remainingAfterFuture - visiblePastUpcoming.length);
  const visiblePastPlanned = showPastEvents ? profile.pastPlanned.slice(0, remainingAfterPastUpcoming) : [];
  const futureEventCount = profile.upcoming.length + profile.planned.length;

  return (
    <>
      <ScreenTopBar
        canGoBack={canGoBack}
        onBack={onBack}
        onOpenMenu={onOpenMenu}
        onOpenMessages={onOpenMessages}
        onOpenNotifications={onOpenNotifications}
        title={isOwnProfile ? 'Профиль' : 'Коннект'}
      />

      <ScrollView
        alwaysBounceVertical
        contentContainerStyle={styles.content}
        onScroll={({ nativeEvent }) => {
          if (!['feed', 'events', 'music', 'locations'].includes(activeContentTab)) return;
          const isNearBottom = nativeEvent.contentOffset.y + nativeEvent.layoutMeasurement.height >= nativeEvent.contentSize.height - 320;
          const hasListGrown = lastContentLoadHeight.current === 0 || nativeEvent.contentSize.height >= lastContentLoadHeight.current + 120;
          if (!isNearBottom || !hasListGrown) return;
          lastContentLoadHeight.current = nativeEvent.contentSize.height;
          setVisibleContentItemCount((current) => current + profileContentPageSize);
        }}
        refreshControl={<AppRefreshControl refreshing={isRefreshing} tintColor="#111" onRefresh={onRefresh} />}
        scrollEventThrottle={100}
        scrollEnabled={Platform.OS === 'web' || !isMusicDragging}
        showsVerticalScrollIndicator={false}
        style={styles.screenScroll}
      >
        {hasTrackPill ? (
          <View style={[styles.profileTrackBar, styles.profileTrackBarScrollable]}>
            {headerTrack.provider && headerTrack.previewUrl && ['apple', 'yandex', 'soundcloud', 'bandcamp', 'youtube', 'uploaded', 'volna'].includes(headerTrack.provider) ? <PrimaryTrackInlinePreview
              artist={headerTrack.artist}
              artworkUrl={headerTrack.artworkUrl}
              autoPlay={false}
              clipDurationSeconds={headerTrack.clipDurationSeconds}
              prefix={headerTrack.prefix}
              previewUrl={headerTrack.previewUrl}
              provider={headerTrack.provider}
              startSeconds={headerTrack.startSeconds}
              title={headerTrack.title}
              variant="header"
            /> : null}
          </View>
        ) : null}

        {canManageProfile ? (
          <View style={styles.informationProfileManagementCard}>
            <View style={styles.informationProfileManagementCopy}>
              <Text style={styles.settingsLabel}>
                {profile.isInformational ? 'Управление информационным профилем' : 'Управление профилем'}
              </Text>
              <Text style={styles.settingsHint}>Редактирование аккаунта администратором</Text>
            </View>
            <Pressable accessibilityRole="button" onPress={onOpenAdminProfileEdit} style={styles.informationProfileManagementButton}>
              <Pencil color="#fff" size={17} strokeWidth={2} />
              <Text style={styles.informationProfileManagementButtonText}>Редактировать</Text>
            </Pressable>
          </View>
        ) : null}

        {profile.isInformational ? (
          <View style={[styles.informationPageBanner, styles.informationProfileBanner]}>
            <Pressable
              accessibilityHint="Открывает пояснение о статусе профиля"
              accessibilityRole="button"
              onPress={() => setIsInformationNoticeOpen(true)}
              style={styles.informationPageBannerHeader}
            >
              <Text style={styles.informationPageBannerText}>Информационный профиль</Text>
              <Info color="#53606c" size={15} strokeWidth={2} />
            </Pressable>
          </View>
        ) : null}

        <View style={styles.heroRow}>
          <Pressable
            accessibilityRole={canPreviewAvatar ? 'imagebutton' : 'image'}
            disabled={!canPreviewAvatar}
            onPress={canPreviewAvatar ? () => setIsAvatarModalOpen(true) : undefined}
            style={styles.avatarWrap}
          >
            {profile.avatarUrl ? (
              <Image source={{ uri: profile.avatarUrl }} style={styles.avatar} resizeMode="cover" />
            ) : (
              <View style={[styles.avatar, styles.avatarPlaceholder]}>
                <Text style={styles.avatarPlaceholderText}>{getAvatarInitial(profile.name)}</Text>
              </View>
            )}
            {isOwnProfile && !profile.invisibleMode ? <View style={styles.onlineBadge} /> : null}
          </Pressable>

          <View style={styles.identity}>
            <VerifiedName isVerified={isVerified} name={profile.name} style={styles.name} />
            <Text style={styles.username}>@{profile.username}</Text>
            {hasSocialLinks ? (
              <View style={styles.profileSocialIcons}>
                <SocialIcon url={profile.bandcampUrl} icon="bandcamp" />
                <SocialIcon url={profile.soundcloudUrl} icon="soundcloud" />
                <SocialIcon url={profile.instagramUrl} icon="instagram" />
                <SocialIcon url={profile.threadsUrl} icon="threads" />
                <SocialIcon url={profile.telegramUrl} icon="telegram" />
                <SocialIcon url={profile.youtubeUrl} icon="youtube" />
                <SocialIcon url={profile.letterboxdUrl} icon="letterboxd" />
              </View>
            ) : null}
            <View style={styles.followCountersRow}>
              <Pressable accessibilityRole="button" onPress={() => setFollowList('followers')} style={styles.followCounterButton}><Text style={styles.followCounterText}><Text style={styles.counterNumber}>{profile.followersCount}</Text> {russianPlural(profile.followersCount, 'подписчик', 'подписчика', 'подписчиков')}</Text></Pressable>
              {!profile.isInformational ? (
                <>
                  <Text style={styles.followCounterSeparator}>·</Text>
                  <Pressable accessibilityRole="button" onPress={() => setFollowList('following')} style={styles.followCounterButton}><Text style={styles.followCounterText}><Text style={styles.counterNumber}>{profile.followingCount}</Text> {russianPlural(profile.followingCount, 'подписка', 'подписки', 'подписок')}</Text></Pressable>
                </>
              ) : null}
            </View>
          </View>
        </View>

        {locationLabel ? (
          <View style={styles.locationRow}>
            <MapPin size={15} color="#111" strokeWidth={1.8} />
            <Text style={styles.locationText}>{locationLabel}</Text>
          </View>
        ) : null}

        <MentionText onOpenMention={onOpenMention} style={styles.about}>{profile.about}</MentionText>
        {registrationDate && !profile.isInformational ? (
          <Text style={styles.profileRegistrationDate}>Регистрация: {registrationDate}</Text>
        ) : null}
        {!isOwnProfile ? <MutualFollowersSummary endpoint={`/profiles/${encodeURIComponent(profile.username)}/mutual-followers`} onPress={() => setFollowList('mutual')} /> : null}

        {adminMode ? (
          <View style={[styles.settingsCard, { alignItems: 'center', flexDirection: 'row' }]}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={styles.settingsLabel}>Подтвержденный аккаунт</Text>
              <Text style={{ color: '#6f7b86', fontSize: 14, lineHeight: 19, marginTop: 3 }}>Галочка будет отображаться рядом с именем во всех разделах VOLNA.</Text>
            </View>
            <VolnaSwitch disabled={isVerificationSaving} value={isVerified} onValueChange={(value) => void updateVerification(value)} />
          </View>
        ) : null}

        <View style={styles.profileActionRow}>
          {isOwnProfile ? (
            <Pressable onPress={onOpenEdit} style={[styles.editProfileButton, styles.profilePrimaryAction]}>
              <Text style={styles.editProfileText}>Редактировать</Text>
            </Pressable>
          ) : (
            <>
              <Pressable
                disabled={isFollowSaving}
                onPress={async () => {
                  setIsFollowSaving(true);
                  try {
                    await onToggleFollow(profile.username, profile.followStatus);
                  } catch (error) {
                    onNotify(error instanceof Error ? error.message : 'Не удалось обновить подписку', 'error');
                  } finally {
                    setIsFollowSaving(false);
                  }
                }}
                style={[
                  styles.followButton,
                  styles.profilePrimaryAction,
                  profile.followStatus && styles.followButtonSecondary,
                  isFollowSaving && styles.disabledButton,
                ]}
              >
                <Text numberOfLines={1} style={[styles.followText, profile.followStatus && styles.followTextSecondary]}>
                  {profile.isFollowing
                      ? 'Отписаться'
                      : profile.followStatus === 'PENDING'
                        ? 'Заявка отправлена'
                        : 'Подписаться'}
                </Text>
              </Pressable>
              <Pressable accessibilityLabel="Поделиться профилем" accessibilityRole="button" onPress={() => setIsShareOpen(true)} style={styles.messageButton}>
                <Share2 size={21} color="#111" strokeWidth={1.8} />
              </Pressable>
              <Pressable onPress={() => setIsSafetyMenuOpen(true)} style={styles.messageButton}>
                <EllipsisVertical size={22} color="#111" strokeWidth={1.9} />
              </Pressable>
              {!profile.isInformational ? <Pressable onPress={() => void onOpenChat(profile.username)} style={styles.messageButton}>
                <MessageSquare size={22} color="#111" strokeWidth={1.9} />
              </Pressable> : null}
              {profile.connectEnabled ? (
                <Pressable
                  accessibilityState={{ selected: isLiked }}
                  onPress={() => setIsLiked((value) => !value)}
                  style={[styles.likeButton, isLiked && styles.likeButtonActive]}
                >
                  <Heart color={isLiked ? '#fff' : '#111'} fill={isLiked ? '#ff3b5c' : 'transparent'} size={22} strokeWidth={2} />
                </Pressable>
              ) : null}
            </>
          )}
        </View>

        {visibleContentTabs.length ? <View style={styles.tabs}>
          {visibleContentTabs.map((tab) => {
            const isActive = activeContentTab === tab.value;
            const Icon = tab.icon;

            return (
              <Pressable
                accessibilityLabel={tab.label}
                accessibilityRole="tab"
                accessibilityState={{ selected: isActive }}
                key={tab.value}
                onPress={() => selectContentTab(tab.value)}
                style={[styles.profileTabButton, isActive && styles.activeTab]}
              >
                <Icon color={isActive ? '#111' : '#6f7b86'} size={22} strokeWidth={isActive ? 2.1 : 1.8} />
                {isActive ? <View pointerEvents="none" style={styles.activeTabIndicator} /> : null}
              </Pressable>
            );
          })}
        </View> : null}

        {isLoading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color="#111" />
          </View>
        ) : null}

        {activeContentTab === 'events' ? (
          <>
            <EventSection title="Ближайшие выступления" events={visibleUpcoming} onOpenEvent={onOpenEvent} onOpenPublicPage={onOpenPublicPage} onSetParticipation={(event, status) => void updateEventParticipation(event, status).catch((error) => onNotify(error instanceof Error ? error.message : 'Не удалось обновить событие', 'error'))} />
            <EventSection title="Планирует посетить" events={visiblePlanned} onOpenEvent={onOpenEvent} onOpenPublicPage={onOpenPublicPage} onSetParticipation={(event, status) => void updateEventParticipation(event, status).catch((error) => onNotify(error instanceof Error ? error.message : 'Не удалось обновить событие', 'error'))} />
            {showPastEvents ? (
              <>
                <EventSection title="Прошедшие выступления" events={visiblePastUpcoming} onOpenEvent={onOpenEvent} onOpenPublicPage={onOpenPublicPage} onSetParticipation={(event, status) => void updateEventParticipation(event, status).catch((error) => onNotify(error instanceof Error ? error.message : 'Не удалось обновить событие', 'error'))} />
                <EventSection title="Посещал" events={visiblePastPlanned} onOpenEvent={onOpenEvent} onOpenPublicPage={onOpenPublicPage} onSetParticipation={(event, status) => void updateEventParticipation(event, status).catch((error) => onNotify(error instanceof Error ? error.message : 'Не удалось обновить событие', 'error'))} />
              </>
            ) : null}
            {hasPastEvents && visibleContentItemCount >= futureEventCount ? (
              <View style={styles.profileEventsArchiveAction}>
                <Pressable accessibilityRole="link" onPress={() => setShowPastEvents((value) => !value)} style={styles.profileEventsArchiveLink}>
                  <Text style={styles.profileEventsArchiveLinkText}>{showPastEvents ? 'Скрыть прошедшие' : 'Показать прошедшие'}</Text>
                </Pressable>
              </View>
            ) : null}
          </>
        ) : null}
        {activeContentTab === 'music' ? (
          <MusicSection
            artistReleases={profile.artistReleases ?? []}
            bandcampUrl={profile.bandcampMusicEmbedUrl}
            canReorder={isOwnProfile}
            maxItems={visibleContentItemCount}
            onDragStateChange={setIsMusicDragging}
            onNotify={onNotify}
            onReorder={async (musicTracks) => onSave({ musicTracks }, { stayOnScreen: true })}
            enteringTrackIds={enteringMusicTrackIds}
            leavingTrackIds={leavingMusicTrackIds}
            onTrackLeaveComplete={finishMusicTrackRemoval}
            ownerId={profile.id}
            ownerName={profile.name}
            ownerUsername={profile.username}
            uploadedTracks={profile.uploadedMusicTracks ?? []}
            tracks={displayedMusicTracks}
            soundcloudUrl={profile.soundcloudMusicUrl}
          />
        ) : null}
        {activeContentTab === 'locations' ? <FavoriteLocationsSection locations={profile.favoriteLocations} maxItems={visibleContentItemCount} onOpenPublicPage={onOpenPublicPage} /> : null}
        {activeContentTab === 'feed' ? <PostFeed authToken={authToken} authorType="account" canCreate={isOwnProfile} composerAuthor={{ avatarUrl: profile.avatarUrl, isVerified: profile.isVerified, name: profile.name, username: profile.username }} CropModal={AvatarCropModal} focusPostId={focusPostId} maxItems={visibleContentItemCount} onNotify={onNotify} onOpenPost={onOpenPost} onOpenProfile={onOpenProfile} onOpenPublicPage={onOpenPublicPage} username={profile.username} /> : null}
        {isOwnProfile && activeContentTab === 'photos' ? (
          <View style={styles.emptyProfileTab}>
            <Images color="#111" size={29} strokeWidth={1.8} />
            <Text style={styles.emptyProfileTabTitle}>Медиа появятся здесь</Text>
            <Text style={styles.emptyProfileTabText}>Здесь будут фотографии и другие медиа пользователя.</Text>
          </View>
        ) : null}
      </ScrollView>
      <AvatarPreviewModal
        imageUrl={profile.avatarOriginalUrl ?? profile.avatarUrl}
        isVisible={canPreviewAvatar && isAvatarModalOpen}
        name={profile.name}
        onClose={() => setIsAvatarModalOpen(false)}
      />
      <FollowListModal
        initialTab={followList ?? 'followers'}
        isVisible={followList !== null}
        onClose={() => setFollowList(null)}
        onOpenProfile={onOpenProfile}
        tabs={[
          ...(!isOwnProfile ? [{ key: 'mutual', label: 'Общие', endpoint: `/profiles/${encodeURIComponent(profile.username)}/mutual-followers` }] : []),
          { key: 'followers', label: `${profile.followersCount} ${russianPlural(profile.followersCount, 'подписчик', 'подписчика', 'подписчиков')}`, endpoint: `/profiles/${encodeURIComponent(profile.username)}/followers` },
          { key: 'following', label: `${profile.isInformational ? 0 : profile.followingCount} ${russianPlural(profile.isInformational ? 0 : profile.followingCount, 'подписка', 'подписки', 'подписок')}`, endpoint: `/profiles/${encodeURIComponent(profile.username)}/following` },
        ]}
        title={`@${profile.username}`}
      />
      <EntityShareModal authToken={authToken} chatAccountId={profile.id} chatSnapshot={{ avatarUrl: profile.avatarUrl, isVerified: profile.isVerified, name: profile.name, subtitle: 'Профиль', username: profile.username }} isVisible={!isOwnProfile && isShareOpen} onClose={() => setIsShareOpen(false)} onNotify={onNotify} repost={{ previewTitle: profile.name, previewMeta: `@${profile.username} · Профиль` }} shareText={`${profile.name} (@${profile.username}) в VOLNA\nhttps://volna.social/${encodeURIComponent(profile.username)}`} shareTitle={profile.name} shareUrl={`https://volna.social/${encodeURIComponent(profile.username)}`} subjectLabel="Профиль" />
      <AppSheetModal
        contentContainerStyle={styles.informationPageNoticeContent}
        isVisible={isInformationNoticeOpen}
        onClose={() => setIsInformationNoticeOpen(false)}
        title="Об информационном профиле"
      >
        <Text style={styles.informationPageNoticeText}>Эта страница создана администрацией VOLNA в информационных целях и не является официальным профилем указанного артиста.</Text>
        <Text style={styles.informationPageNoticeText}>Размещённые сведения собраны из открытых источников.</Text>
        <Text style={styles.informationPageNoticeText}>Если вы являетесь этим артистом или его уполномоченным представителем, пожалуйста, свяжитесь с нами.</Text>
      </AppSheetModal>
      <ProfileSafetyModal
        isVisible={!isOwnProfile && isSafetyMenuOpen}
        onBlock={async () => {
          setIsSafetyMenuOpen(false);
          await onBlock(profile.username);
        }}
        onClose={() => setIsSafetyMenuOpen(false)}
        onNotify={onNotify}
        onReport={async (reason) => {
          setIsSafetyMenuOpen(false);
          await onReport(profile.username, reason);
        }}
      />
    </>
  );
}

export function ProfileSafetyModal({
  isVisible,
  onBlock,
  onClose,
  onNotify,
  onReport,
  targetKind = 'profile',
}: {
  isVisible: boolean;
  onBlock: () => Promise<void>;
  onClose: () => void;
  onNotify: (message: string, type?: ToastMessage['type']) => void;
  onReport: (reason: 'SPAM' | 'HARASSMENT' | 'IMPERSONATION' | 'ILLEGAL_CONTENT' | 'OTHER') => Promise<void>;
  targetKind?: 'profile' | 'community';
}) {
  const reasons = [
    { label: 'Спам', value: 'SPAM' as const },
    { label: 'Оскорбления или преследование', value: 'HARASSMENT' as const },
    { label: 'Выдаёт себя за другого', value: 'IMPERSONATION' as const },
    { label: 'Незаконный контент', value: 'ILLEGAL_CONTENT' as const },
    { label: 'Другое', value: 'OTHER' as const },
  ];
  const [showReasons, setShowReasons] = useState(false);
  useEffect(() => { if (!isVisible) setShowReasons(false); }, [isVisible]);
  const run = async (operation: () => Promise<void>) => {
    try {
      await operation();
    } catch (error) {
      onNotify(error instanceof Error ? error.message : 'Не удалось выполнить действие', 'error');
    }
  };
  return (
    <AppSheetModal
      isVisible={isVisible}
      onClose={onClose}
      title={showReasons ? 'Причина жалобы' : targetKind === 'community' ? 'Действия с сообществом' : 'Действия с профилем'}
    >
          {showReasons ? reasons.map((reason) => (
            <Pressable key={reason.value} onPress={() => void run(() => onReport(reason.value))} style={styles.safetyAction}>
              <Text style={styles.safetyActionText}>{reason.label}</Text>
            </Pressable>
          )) : (
            <>
              <Pressable onPress={() => setShowReasons(true)} style={styles.safetyAction}>
                <Flag size={20} color="#111" /><Text style={styles.safetyActionText}>Пожаловаться</Text>
              </Pressable>
              <Pressable onPress={() => Alert.alert(
                targetKind === 'community' ? 'Заблокировать сообщество?' : 'Заблокировать профиль?',
                targetKind === 'community'
                  ? 'Сообщество исчезнет из каталога и ваших подписок.'
                  : 'Вы больше не будете видеть друг друга, а взаимные подписки удалятся.', [
                { text: 'Отмена', style: 'cancel' },
                { text: 'Заблокировать', style: 'destructive', onPress: () => void run(onBlock) },
              ])} style={styles.safetyAction}>
                <ShieldBan size={20} color="#d82c2c" /><Text style={[styles.safetyActionText, styles.safetyDangerText]}>Заблокировать</Text>
              </Pressable>
            </>
          )}
    </AppSheetModal>
  );
}

type TrackPlayerController = {
  isPlaying: () => boolean;
  pause: () => void;
  playFrom: (seconds: number) => Promise<void>;
};

export function PrimaryTrackInlinePreview({
  artist,
  artworkUrl,
  autoPlay = true,
  clipDurationSeconds,
  previewUrl,
  prefix = '',
  provider,
  startSeconds,
  title,
  variant,
}: {
  artist: string | null;
  artworkUrl?: string | null;
  autoPlay?: boolean;
  clipDurationSeconds: number;
  previewUrl: string;
  prefix?: string;
  provider?: string | null;
  startSeconds: number;
  title: string;
  variant: 'header' | 'connect';
}) {
  const playerId = useId();
  const resolvedPreviewUrl = previewUrl.startsWith('/') ? `${apiUrl}${previewUrl}` : previewUrl;
  const player = useAudioPlayer(null, { updateInterval: 100 });
  const status = useAudioPlayerStatus(player);
  const globalAudio = useGlobalAudioControls();
  const globalAudioRef = useRef(globalAudio);
  globalAudioRef.current = globalAudio;
  const suspendedGlobalTrackRef = useRef<GlobalTrack | null>(null);
  const loadedUrlRef = useRef<string | null>(null);
  const youtubeEngineRef = useRef<YouTubeAudioEngineHandle | null>(null);
  const youtubeLoadedIdRef = useRef<string | null>(null);
  const [youtubeSnapshot, setYoutubeSnapshot] = useState<YouTubeAudioSnapshot>({ duration: 0, loading: false, playing: false, position: 0 });
  const [isYoutubeStarting, setIsYoutubeStarting] = useState(false);
  const normalizedProvider: GlobalTrack['provider'] | undefined = provider === 'uploaded'
    ? 'volna'
    : provider === 'apple' || provider === 'yandex' || provider === 'soundcloud' || provider === 'bandcamp' || provider === 'youtube' || provider === 'volna'
      ? provider
      : undefined;
  const displayMetadata = normalizedProvider === 'youtube'
    ? normalizeYouTubeTrackMetadata(title, artist)
    : { artist: artist?.trim() || '', title: normalizeMusicTrackTitle(normalizedProvider, title) };
  const displayTitle = displayMetadata.title;
  const compactArtworkUrl = musicArtworkThumbnail(artworkUrl, normalizedProvider);
  const artistName = displayMetadata.artist;
  const youtubeVideoId = normalizedProvider === 'youtube'
    ? resolvedPreviewUrl.match(/^youtube:([\w-]{11})$/)?.[1] ?? resolvedPreviewUrl.match(/[?&]v=([\w-]{11})/)?.[1] ?? null
    : null;
  const isPlaying = normalizedProvider === 'youtube' ? youtubeSnapshot.playing : Boolean(status.playing);

  const pause = useCallback(() => {
    if (normalizedProvider === 'youtube') {
      setIsYoutubeStarting(false);
      youtubeEngineRef.current?.pause();
    }
    else player.pause();
  }, [normalizedProvider, player]);
  const play = useCallback(async () => {
    const global = globalAudioRef.current;
    if (variant === 'connect' && !suspendedGlobalTrackRef.current && global.isPlaying && global.activeTrack) {
      suspendedGlobalTrackRef.current = global.activeTrack;
    }
    if (global.isPlaying) global.pause();
    profilePreviewPlayers.forEach((pauseOther, id) => { if (id !== playerId) pauseOther(); });
    if (normalizedProvider === 'youtube') {
      if (!youtubeVideoId) throw new Error('Некорректная ссылка YouTube');
      setIsYoutubeStarting(true);
      if (youtubeLoadedIdRef.current !== youtubeVideoId) {
        youtubeLoadedIdRef.current = youtubeVideoId;
        youtubeEngineRef.current?.load(youtubeVideoId, startSeconds, true);
      } else {
        youtubeEngineRef.current?.play();
      }
      return;
    }
    if (loadedUrlRef.current !== resolvedPreviewUrl) {
      player.replace(resolvedPreviewUrl);
      loadedUrlRef.current = resolvedPreviewUrl;
    }
    await player.seekTo(startSeconds);
    player.play();
  }, [normalizedProvider, player, playerId, resolvedPreviewUrl, startSeconds, variant, youtubeVideoId]);

  useEffect(() => {
    profilePreviewPlayers.set(playerId, pause);
    return () => {
      profilePreviewPlayers.delete(playerId);
      player.pause();
      youtubeEngineRef.current?.stop();
      const suspendedTrack = suspendedGlobalTrackRef.current;
      suspendedGlobalTrackRef.current = null;
      const global = globalAudioRef.current;
      if (variant === 'connect' && suspendedTrack && !global.isPlaying && global.activeTrack?.id === suspendedTrack.id) {
        void global.play(suspendedTrack).catch(() => undefined);
      }
    };
  }, [pause, player, playerId, variant]);

  useEffect(() => {
    if (autoPlay) void play().catch(pause);
    return () => player.pause();
  }, [autoPlay, pause, play, player]);

  useEffect(() => {
    if (globalAudio.activeTrack?.id.startsWith('profile-header:')) globalAudio.close();
  }, [globalAudio.activeTrack?.id]);

  useEffect(() => {
    if (youtubeSnapshot.playing) setIsYoutubeStarting(false);
  }, [youtubeSnapshot.playing]);

  useEffect(() => {
    if (!isPlaying) return;
    const current = normalizedProvider === 'youtube' ? youtubeSnapshot.position : Number(status.currentTime ?? 0);
    if (current < startSeconds + clipDurationSeconds - 0.04) return;
    if (normalizedProvider === 'youtube') {
      youtubeEngineRef.current?.pause();
      youtubeEngineRef.current?.seek(startSeconds, false);
    } else {
      player.pause();
    }
  }, [clipDurationSeconds, isPlaying, normalizedProvider, player, startSeconds, status.currentTime, youtubeSnapshot.position]);

  const toggle = () => {
    if (normalizedProvider === 'youtube' && (isYoutubeStarting || youtubeSnapshot.loading)) return;
    if (isPlaying) pause();
    else void play().catch(pause);
  };

  const isYoutubeLoading = normalizedProvider === 'youtube' && (isYoutubeStarting || youtubeSnapshot.loading);
  const youtubeEngine = youtubeVideoId ? <YouTubeAudioEngine onError={() => setIsYoutubeStarting(false)} onStateChange={setYoutubeSnapshot} ref={youtubeEngineRef} /> : null;
  const displayTrackLabel = artistName ? `${artistName} — ${displayTitle}` : displayTitle;

  if (variant === 'connect') {
    return <><Pressable accessibilityLabel={`${isPlaying ? 'Остановить' : 'Прослушать'} ${displayTrackLabel}`} accessibilityRole="button" onPress={toggle} style={styles.connectTrackButton}>
      {compactArtworkUrl ? <Image source={{ uri: compactArtworkUrl }} style={styles.connectTrackArtwork} /> : null}
      <View style={styles.connectTrackIcon}>{isYoutubeLoading ? <ActivityIndicator color="#fff" size="small" style={styles.profileTrackLoadingIndicator} /> : isPlaying ? <Pause size={14} color="#fff" strokeWidth={2} /> : <Volume2 size={14} color="#fff" strokeWidth={2} />}</View>
      <View style={styles.connectTrackText}>
        <MarqueeTrackTitle connect emphasizeTitle={Boolean(artistName)} plainSuffix={artistName ? ` — ${displayTitle}` : ''} title={artistName || displayTitle} />
      </View>
    </Pressable>{youtubeEngine}</>;
  }

  return <><Pressable accessibilityLabel={`${isPlaying ? 'Остановить' : 'Прослушать'} ${displayTitle}`} accessibilityRole="button" onPress={toggle} style={styles.profileTrackButton}>
    {isYoutubeLoading ? <ActivityIndicator color="#111" size="small" style={styles.profileTrackLoadingIndicator} /> : isPlaying ? <Pause size={14} color="#111" strokeWidth={2} /> : <Volume2 size={14} color="#111" strokeWidth={2} />}
    <View style={styles.profileTrackText}>
      <MarqueeTrackTitle emphasisPrefix={prefix} emphasizeTitle={Boolean(artistName)} plainSuffix={artistName ? ` — ${displayTitle}` : ''} profile title={artistName || displayTitle} />
    </View>
  </Pressable>{youtubeEngine}</>;
}

function PrimaryTrackEditorPreview({
  artist,
  artworkUrl,
  clipDurationSeconds,
  durationSeconds,
  onStartSecondsChange,
  previewUrl,
  provider,
  startSeconds,
  title,
}: {
  artist: string | null;
  artworkUrl: string | null;
  clipDurationSeconds: number;
  durationSeconds: number | null;
  onStartSecondsChange: (seconds: number) => void;
  previewUrl: string;
  provider: GlobalTrack['provider'];
  startSeconds: number;
  title: string;
}) {
  const playerId = useId();
  const resolvedPreviewUrl = previewUrl.startsWith('/') ? `${apiUrl}${previewUrl}` : previewUrl;
  const player = useAudioPlayer(null, { updateInterval: 100 });
  const status = useAudioPlayerStatus(player);
  const globalAudio = useGlobalAudioControls();
  const loadedUrlRef = useRef<string | null>(null);
  const youtubeEngineRef = useRef<YouTubeAudioEngineHandle | null>(null);
  const youtubeLoadedIdRef = useRef<string | null>(null);
  const [youtubeSnapshot, setYoutubeSnapshot] = useState<YouTubeAudioSnapshot>({ duration: 0, loading: false, playing: false, position: 0 });
  const youtubeVideoId = provider === 'youtube'
    ? resolvedPreviewUrl.match(/^youtube:([\w-]{11})$/)?.[1] ?? resolvedPreviewUrl.match(/[?&]v=([\w-]{11})/)?.[1] ?? null
    : null;
  const displayMetadata = provider === 'youtube'
    ? normalizeYouTubeTrackMetadata(title, artist)
    : { artist: artist?.trim() || '', title: normalizeMusicTrackTitle(provider, title) };
  const displayTitle = displayMetadata.title;
  const compactArtworkUrl = musicArtworkThumbnail(artworkUrl, provider);
  const isPlaying = provider === 'youtube' ? youtubeSnapshot.playing : Boolean(status.playing);
  const isLoading = provider === 'youtube' && youtubeSnapshot.loading;
  const observedDurationSeconds = provider === 'youtube' ? youtubeSnapshot.duration : Number(status.duration ?? 0);
  const selectableDurationSeconds = Math.max(1, observedDurationSeconds > 0
    ? observedDurationSeconds
    : durationSeconds && durationSeconds > 0 ? durationSeconds : clipDurationSeconds || 30);
  const selectedStartSeconds = Math.min(selectableDurationSeconds, Math.max(0, startSeconds));

  const pause = useCallback(() => {
    if (provider === 'youtube') youtubeEngineRef.current?.pause();
    else player.pause();
  }, [player, provider]);

  const playFrom = useCallback(async (seconds: number) => {
    if (globalAudio.isPlaying) globalAudio.pause();
    profilePreviewPlayers.forEach((pauseOther, id) => { if (id !== playerId) pauseOther(); });
    if (provider === 'youtube') {
      if (!youtubeVideoId) throw new Error('Некорректная ссылка YouTube');
      if (youtubeLoadedIdRef.current !== youtubeVideoId) {
        youtubeLoadedIdRef.current = youtubeVideoId;
        youtubeEngineRef.current?.load(youtubeVideoId, seconds, true);
      } else {
        youtubeEngineRef.current?.seek(seconds, true);
      }
      return;
    }
    if (loadedUrlRef.current !== resolvedPreviewUrl) {
      player.replace(resolvedPreviewUrl);
      loadedUrlRef.current = resolvedPreviewUrl;
    }
    await player.seekTo(seconds);
    player.play();
  }, [globalAudio, player, playerId, provider, resolvedPreviewUrl, youtubeVideoId]);

  useEffect(() => {
    profilePreviewPlayers.set(playerId, pause);
    return () => {
      profilePreviewPlayers.delete(playerId);
      player.pause();
      youtubeEngineRef.current?.stop();
    };
  }, [pause, player, playerId]);

  useEffect(() => {
    pause();
    loadedUrlRef.current = null;
    youtubeLoadedIdRef.current = null;
    setYoutubeSnapshot({ duration: 0, loading: false, playing: false, position: 0 });
  }, [pause, resolvedPreviewUrl]);

  const updateSelectedStart = (nextProgress: number) => {
    const nextSeconds = Math.round(Math.max(0, Math.min(1, nextProgress)) * selectableDurationSeconds * 100) / 100;
    onStartSecondsChange(nextSeconds);
    return nextSeconds;
  };

  return <>
    <View style={styles.primaryTrackFragmentPlayer}>
      <Pressable accessibilityLabel={`${isPlaying ? 'Остановить' : 'Прослушать'} ${displayTitle}`} accessibilityRole="button" onPress={() => { if (isPlaying) pause(); else void playFrom(selectedStartSeconds).catch(pause); }} style={styles.primaryTrackFragmentArtworkWrap}>
        {compactArtworkUrl ? <Image source={{ uri: compactArtworkUrl }} style={styles.primaryTrackFragmentArtwork} /> : <View style={[styles.primaryTrackFragmentArtwork, styles.primaryTrackFragmentArtworkPlaceholder]}><Disc3 color="#6f7b86" size={20} /></View>}
        <View style={styles.primaryTrackFragmentArtworkControl}>{isLoading ? <ActivityIndicator color="#fff" size="small" /> : isPlaying ? <Pause color="#fff" size={17} strokeWidth={2.4} /> : <Play color="#fff" fill="#fff" size={16} strokeWidth={2.2} />}</View>
      </Pressable>
      <View style={styles.primaryTrackFragmentPlayerCopy}>
        <Text numberOfLines={1} style={styles.primaryTrackFragmentPlayerTitle}>{displayTitle}</Text>
        {displayMetadata.artist ? <Text numberOfLines={1} style={styles.primaryTrackFragmentPlayerArtist}>{displayMetadata.artist}</Text> : null}
        <CompactTrackScrubber
          accessibilityValueText={`Старт композиции с ${formatUploadedTrackTime(selectedStartSeconds)}`}
          onChange={updateSelectedStart}
          onChangeEnd={(nextProgress) => { const nextSeconds = updateSelectedStart(nextProgress); void playFrom(nextSeconds).catch(pause); }}
          onInteractionStart={pause}
          progress={selectedStartSeconds / selectableDurationSeconds}
        />
        <Text style={styles.primaryTrackFragmentStartLabel}>Старт композиции с {formatUploadedTrackTime(selectedStartSeconds)}</Text>
      </View>
    </View>
    {youtubeVideoId ? <YouTubeAudioEngine onStateChange={setYoutubeSnapshot} ref={youtubeEngineRef} /> : null}
  </>;
}

export const TrackPlayerPill = forwardRef<TrackPlayerController, {
  autoPlay?: boolean;
  artist: string | null;
  artworkFallback?: ReactNode;
  artworkUrl?: string | null;
  clipDurationSeconds?: number;
  collectionTitle?: string | null;
  collectionId?: string | null;
  externalUrl: string | null;
  genres?: string[];
  isLiveStream?: boolean;
  isRadioFavorite?: boolean;
  labelName?: string | null;
  labelUsername?: string | null;
  onDetailsPress?: () => void;
  onPlaybackError?: (error: unknown) => void;
  participants?: ProfileMusicTrack['participants'];
  playerTrackId?: string;
  leadingLabel?: string;
  previewUrl: string | null;
  provider?: GlobalTrack['provider'];
  queue?: GlobalTrackQueueItem[];
  queueIndex?: number;
  queueWindowResolver?: (target: GlobalTrackQueueItem) => GlobalTrackQueueItem[];
  radioPageUsername?: string;
  radioStationName?: string;
  releaseDateLabel?: string | null;
  releaseId?: string;
  startSeconds?: number;
  title: string | null;
  variant?: 'pill' | 'card' | 'release-card' | 'header' | 'editor' | 'connect' | 'control' | 'playlist';
}>(function TrackPlayerPill({
  autoPlay = false,
  artist,
  artworkFallback = null,
  artworkUrl = null,
  clipDurationSeconds,
  collectionTitle = null,
  collectionId = null,
  externalUrl,
  genres = [],
  isLiveStream = false,
  isRadioFavorite = false,
  labelName = null,
  labelUsername = null,
  onDetailsPress,
  onPlaybackError,
  participants = [],
  playerTrackId,
  leadingLabel,
  previewUrl,
  provider,
  queue,
  queueIndex,
  queueWindowResolver,
  radioPageUsername,
  radioStationName,
  releaseDateLabel = null,
  releaseId,
  startSeconds = 0,
  title,
  variant = 'pill',
}, ref) {
  const renderMetricId = useId();
  recordClientRender('TrackPlayerPill', renderMetricId);
  const resolvedPreviewUrl = previewUrl?.startsWith('/') ? `${apiUrl}${previewUrl}` : previewUrl;
  const globalAudio = useGlobalAudioControls();
  const globalAudioRef = useRef(globalAudio);
  globalAudioRef.current = globalAudio;
  const playbackStartSeconds = startSeconds;
  const playbackClipDurationSeconds = isLiveStream ? undefined : clipDurationSeconds ?? 30;
  const fallbackTrackId = `track:${resolvedPreviewUrl ?? externalUrl ?? title ?? ''}:${playbackStartSeconds}:${playbackClipDurationSeconds ?? 'full'}`;
  const queuedTrack = typeof queueIndex === 'number' && queueIndex >= 0 ? queue?.[queueIndex] : undefined;
  const trackId = playerTrackId ?? queuedTrack?.id ?? fallbackTrackId;
  const isPlaying = globalAudio.isTrackPlaying(trackId);
  const isLoading = globalAudio.activeTrack?.id === trackId && globalAudio.isAudioLoading;
  const displayMetadata = provider === 'youtube'
    ? normalizeYouTubeTrackMetadata(title ?? '', artist)
    : { artist: artist?.trim() || '', title: normalizeMusicTrackTitle(provider, title ?? '') };
  const artistName = displayMetadata.artist;
  const displayTitle = displayMetadata.title;
  const compactArtworkUrl = musicArtworkThumbnail(artworkUrl, provider);
  const trackDescriptor: GlobalTrack = {
    id: trackId,
    title: displayTitle,
    artist: artistName,
    artworkUrl,
    previewUrl: resolvedPreviewUrl ?? '',
    externalUrl,
    provider,
    queue,
    queueIndex,
    queueWindowResolver,
    startSeconds: playbackStartSeconds,
    clipDurationSeconds: playbackClipDurationSeconds,
    collectionTitle,
    collectionId,
    genres,
    releaseId,
    labelName,
    labelUsername,
    participants,
    isLiveStream,
    radioPageUsername,
    radioStationName,
    isRadioFavorite,
  };
  const pauseSafely = () => {
    if (globalAudio.activeTrack?.id === trackId) globalAudio.pause();
  };

  const playFrom = async (seconds: number) => {
    if (!resolvedPreviewUrl || !displayTitle) return;
    const effectiveQueue = queueWindowResolver?.(trackDescriptor) ?? queue;
    const effectiveQueueIndex = effectiveQueue?.findIndex((item) => item.id === trackId) ?? -1;
    await globalAudio.play({
      ...trackDescriptor,
      queue: effectiveQueue && effectiveQueue.length > 1 ? effectiveQueue : undefined,
      queueIndex: effectiveQueueIndex >= 0 ? effectiveQueueIndex : undefined,
    }, seconds);
  };

  useEffect(() => {
    if (!autoPlay || !resolvedPreviewUrl || !displayTitle || globalAudio.activeTrack?.id === trackId) return;
    void playFrom(playbackStartSeconds).catch(() => {
      // Some web browsers may reject audible autoplay; the visible play button remains available.
    });
  }, [autoPlay, displayTitle, resolvedPreviewUrl]);

  useEffect(() => {
    if (variant !== 'header') return undefined;
    return () => {
      const audio = globalAudioRef.current;
      if (audio.activeTrack?.id === trackId) audio.close();
    };
  }, [trackId, variant]);

  useImperativeHandle(ref, () => ({
    isPlaying: () => isPlaying,
    pause: pauseSafely,
    playFrom,
  }), [isPlaying, trackId, resolvedPreviewUrl]);

  const togglePlayback = async () => {
    if (!previewUrl) {
      void openExternalHttpsUrl(externalUrl);
      return;
    }
    if (isPlaying) {
      pauseSafely();
      return;
    }
    try {
      if (globalAudio.activeTrack?.id === trackId) await globalAudio.play(globalAudio.activeTrack);
      else await playFrom(playbackStartSeconds);
    } catch (error) {
      onPlaybackError?.(error);
    }
  };

  if (!displayTitle) {
    return null;
  }

  if (variant === 'control') {
    return (
      <Pressable
        accessibilityLabel={`${isPlaying ? 'Остановить' : 'Прослушать'} выбранный фрагмент ${displayTitle}`}
        accessibilityRole="button"
        onPress={() => { void togglePlayback(); }}
        style={styles.previewRangePlayButton}
      >
        {isPlaying ? <Pause color="#fff" size={13} strokeWidth={2.2} /> : <Play color="#fff" fill="#fff" size={12} strokeWidth={2.2} />}
      </Pressable>
    );
  }

  if (variant === 'playlist') {
    if (!previewUrl) {
      return (
        <View style={styles.bandcampTrackRow}>
          {leadingLabel ? <Text style={styles.bandcampTrackNumber}>{leadingLabel}</Text> : null}
          <Text numberOfLines={1} style={styles.bandcampTrackTitle}>{displayTitle}</Text>
        </View>
      );
    }
    return (
      <Pressable
        accessibilityLabel={`${isPlaying ? 'Остановить' : 'Прослушать'} ${displayTitle}`}
        accessibilityRole="button"
        onPress={() => { void togglePlayback(); }}
        style={styles.bandcampTrackRow}
      >
        {leadingLabel ? <Text style={styles.bandcampTrackNumber}>{leadingLabel}</Text> : null}
        <Text numberOfLines={1} style={[styles.bandcampTrackTitle, isPlaying && styles.bandcampTrackTitleActive]}>{displayTitle}</Text>
      </Pressable>
    );
  }

  if (!previewUrl) {
    return null;
  }

  if (variant === 'release-card') {
    const providerLabel = provider === 'soundcloud'
      ? 'SoundCloud'
      : provider === 'bandcamp'
        ? 'Bandcamp'
        : provider === 'youtube'
          ? 'YouTube'
          : provider === 'apple'
            ? 'Apple Music'
            : provider === 'yandex'
              ? 'Яндекс Музыка'
              : 'VOLNA';
    return (
      <Pressable
        accessibilityLabel={`${isPlaying ? 'Остановить' : 'Воспроизвести'} ${displayTitle}`}
        accessibilityRole="button"
        onPress={() => { void togglePlayback(); }}
        style={styles.artistReleaseTrackCard}
      >
        {compactArtworkUrl
          ? <Image source={{ uri: compactArtworkUrl }} style={styles.communityAudioReleaseArtwork} />
          : <View style={[styles.bandcampReleaseArtworkFallback, styles.communityAudioReleaseArtwork]}><Text style={styles.audioArtworkFallbackNote}>♪</Text></View>}
        <View style={styles.trackCardCopy}>
          <Text numberOfLines={1} style={styles.bandcampReleaseTitle}>{displayTitle}</Text>
          <ReleaseMetadataRows artist={artistName} genres={genres} provider={providerLabel} releaseDateLabel={releaseDateLabel} trackCount={1} />
        </View>
        <View style={styles.trackCardIcon}>
          {isPlaying ? <Pause color="#fff" size={13} strokeWidth={2} /> : <Play color="#fff" size={12} fill="#fff" />}
        </View>
      </Pressable>
    );
  }

  if (variant === 'card') {
    const artwork = compactArtworkUrl
      ? <Image source={{ uri: compactArtworkUrl }} style={styles.trackCardArtwork} />
      : <View style={[styles.trackCardArtwork, styles.trackCardArtworkFallback]}>{artworkFallback ?? <Text style={styles.audioArtworkFallbackNote}>♪</Text>}</View>;
    const playbackIcon = isLoading
      ? <ActivityIndicator color="#fff" size="small" />
      : isPlaying
        ? <Pause color="#fff" size={13} strokeWidth={2} />
        : <Play color="#fff" size={12} fill="#fff" />;
    if (onDetailsPress) {
      return (
        <View style={styles.trackCard}>
          <Pressable accessibilityLabel={`Открыть ${displayTitle}`} accessibilityRole="button" onPress={onDetailsPress} style={styles.trackCardDetails}>
            {artwork}
            <View style={styles.trackCardCopy}>
              <Text numberOfLines={1} style={styles.trackCardTitle}>{displayTitle}</Text>
              {artist || releaseDateLabel ? <Text numberOfLines={1} style={styles.trackCardArtist}>{[artist, releaseDateLabel].filter(Boolean).join(' · ')}</Text> : null}
            </View>
          </Pressable>
          <Pressable
            accessibilityLabel={isLoading ? 'Аудиопоток загружается' : isPlaying ? `Остановить ${displayTitle}` : `Воспроизвести ${displayTitle}`}
            accessibilityRole="button"
            disabled={isLoading}
            onPress={() => { void togglePlayback(); }}
            style={styles.trackCardIcon}
          >
            {playbackIcon}
          </Pressable>
        </View>
      );
    }
    return (
      <Pressable accessibilityLabel={`${isPlaying ? 'Остановить' : 'Воспроизвести'} ${displayTitle}`} accessibilityRole="button" disabled={isLoading} onPress={() => { void togglePlayback(); }} style={styles.trackCard}>
        {artwork}
        <View style={styles.trackCardCopy}>
          <Text numberOfLines={1} style={styles.trackCardTitle}>{displayTitle}</Text>
          {artist || releaseDateLabel ? <Text numberOfLines={1} style={styles.trackCardArtist}>{[artist, releaseDateLabel].filter(Boolean).join(' · ')}</Text> : null}
        </View>
        <View style={styles.trackCardIcon}>
          {playbackIcon}
        </View>
      </Pressable>
    );
  }

  if (variant === 'editor') {
    return (
      <Pressable accessibilityLabel={`${isPlaying ? 'Остановить' : 'Прослушать'} ${displayTitle}`} accessibilityRole="button" onPress={() => { void togglePlayback(); }} style={styles.selectedTrackPlayback}>
        {compactArtworkUrl ? <Image source={{ uri: compactArtworkUrl }} style={styles.selectedTrackArtwork} /> : null}
        <View style={styles.selectedTrackCopy}>
          <Text numberOfLines={1} style={styles.selectedTrackTitle}>{displayTitle}</Text>
          {artist ? <Text numberOfLines={1} style={styles.selectedTrackArtist}>{artist}</Text> : null}
        </View>
        <View style={styles.selectedTrackIcon}>
          {isPlaying ? <Pause color="#fff" size={13} strokeWidth={2} /> : <Play color="#fff" size={12} fill="#fff" />}
        </View>
      </Pressable>
    );
  }

  if (variant === 'header') {
    return (
      <Pressable onPress={() => { void togglePlayback(); }} style={styles.profileTrackButton}>
        {compactArtworkUrl ? <Image source={{ uri: compactArtworkUrl }} style={styles.trackHeaderArtwork} /> : null}
        {isPlaying ? <Pause size={14} color="#111" strokeWidth={2} /> : <Volume2 size={14} color="#111" strokeWidth={2} />}
        <Text style={styles.profileTrackText}>
          {artistName ? <Text style={styles.trackArtistText}>{artistName} </Text> : null}
          <Text style={styles.trackTitleText}>{displayTitle}</Text>
        </Text>
      </Pressable>
    );
  }

  if (variant === 'connect') {
    const displayTrackLabel = artistName ? `${artistName} — ${displayTitle}` : displayTitle;
    return (
      <Pressable accessibilityLabel={`${isPlaying ? 'Остановить' : 'Прослушать'} ${displayTrackLabel}`} accessibilityRole="button" onPress={() => { void togglePlayback(); }} style={styles.connectTrackButton}>
        {compactArtworkUrl ? <Image source={{ uri: compactArtworkUrl }} style={styles.connectTrackArtwork} /> : null}
        <View style={styles.connectTrackIcon}>
          {isPlaying ? <Pause size={14} color="#fff" strokeWidth={2} /> : <Volume2 size={14} color="#fff" strokeWidth={2} />}
        </View>
        <View style={styles.connectTrackText}>
          <MarqueeTrackTitle connect emphasizeTitle={Boolean(artistName)} plainSuffix={artistName ? ` — ${displayTitle}` : ''} title={artistName || displayTitle} />
        </View>
      </Pressable>
    );
  }

  return (
    <Pressable onPress={() => { void togglePlayback(); }} style={styles.trackPill}>
      {compactArtworkUrl ? <Image source={{ uri: compactArtworkUrl }} style={styles.trackPillArtwork} /> : null}
      {isPlaying ? <Pause size={14} color="#111" strokeWidth={2} /> : <Volume2 size={14} color="#111" strokeWidth={2} />}
      <Text numberOfLines={1} style={styles.trackText}>
        {artistName ? <Text style={styles.trackArtistText}>{artistName} </Text> : null}
        <Text style={styles.trackTitleText}>{displayTitle}</Text>
      </Text>
    </Pressable>
  );
});

export function SocialIcon({
  compact = false,
  icon,
  inverted = false,
  url,
}: {
  compact?: boolean;
  icon: 'bandcamp' | 'instagram' | 'letterboxd' | 'soundcloud' | 'telegram' | 'threads' | 'youtube';
  inverted?: boolean;
  url: string | null;
}) {
  const safeUrl = normalizeExternalHttpsUrl(url);
  if (!safeUrl) {
    return null;
  }

  const open = () => {
    void openExternalHttpsUrl(safeUrl);
  };

  const labels: Record<typeof icon, string> = {
    bandcamp: 'Bandcamp',
    instagram: 'Instagram',
    letterboxd: 'Letterboxd',
    soundcloud: 'SoundCloud',
    telegram: 'Telegram',
    threads: 'Threads',
    youtube: 'YouTube',
  };

  return (
    <Pressable accessibilityLabel={`Открыть ${labels[icon]}`} accessibilityRole="link" onPress={open} style={[styles.socialIconButton, compact && styles.connectSocialIconButton]}>
      <FontAwesome6 color={inverted ? '#fff' : '#111'} iconStyle="brand" name={icon} size={24} />
    </Pressable>
  );
}
export function SocialLinkInput({
  kind,
  onChangeText,
  placeholder,
  value,
  withSpacing = true,
}: {
  kind: SocialLinkKind;
  onChangeText: (value: string) => void;
  placeholder: string;
  value: string;
  withSpacing?: boolean;
}) {
  return (
    <View style={[styles.socialLinkInput, withSpacing && styles.socialLinkInputSpacing]}>
      <View style={styles.socialLinkInputIcon}>
        <FontAwesome6 color="#111" iconStyle="brand" name={kind} size={18} />
      </View>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#8e99a4"
        style={styles.socialLinkTextInput}
        value={value}
      />
    </View>
  );
}

function ReorderableFavoriteTrack({ children, count, enabled, gapAfter, gapBefore, index, layoutCorrection, onDragEnd, onDragPreview, onDragStart, onMove }: {
  children: ReactNode;
  count: number;
  enabled: boolean;
  gapAfter: number;
  gapBefore: number;
  index: number;
  layoutCorrection: number;
  onDragEnd: () => void;
  onDragPreview: (fromIndex: number, toIndex: number) => void;
  onDragStart: (index: number, height: number) => void;
  onMove: (fromIndex: number, toIndex: number) => void;
}) {
  const translateY = useRef(new Animated.Value(0)).current;
  const beforeGapHeight = useRef(new Animated.Value(0)).current;
  const afterGapHeight = useRef(new Animated.Value(0)).current;
  const sourceCollapse = useRef(new Animated.Value(0)).current;
  const sourceSpacing = useRef(new Animated.Value(8)).current;
  const animatedLayoutCorrection = useRef(new Animated.Value(0)).current;
  const [isDragging, setIsDragging] = useState(false);
  const isDraggingRef = useRef(false);
  const hasResponder = useRef(false);
  const measuredHeight = useRef(72);
  const isDragArmed = useRef(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const removeWebListeners = useRef<(() => void) | null>(null);
  const clearLongPressTimer = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
  };
  const finishDrag = () => {
    clearLongPressTimer();
    isDragArmed.current = false;
    isDraggingRef.current = false;
    hasResponder.current = false;
    Animated.parallel([
      Animated.spring(translateY, { damping: 20, stiffness: 260, toValue: 0, useNativeDriver: true }),
      Animated.spring(sourceCollapse, { damping: 24, stiffness: 280, toValue: 0, useNativeDriver: false }),
      Animated.spring(sourceSpacing, { damping: 24, stiffness: 280, toValue: 8, useNativeDriver: false }),
    ]).start(() => setIsDragging(false));
    onDragEnd();
  };
  const activateDrag = () => {
    isDragArmed.current = true;
    isDraggingRef.current = true;
    setIsDragging(true);
    onDragStart(index, measuredHeight.current);
    Animated.parallel([
      Animated.spring(sourceCollapse, { damping: 24, stiffness: 280, toValue: -measuredHeight.current, useNativeDriver: false }),
      Animated.spring(sourceSpacing, { damping: 24, stiffness: 280, toValue: 0, useNativeDriver: false }),
    ]).start();
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };
  const completeDrag = (dy: number) => {
    clearLongPressTimer();
    isDragArmed.current = false;
    hasResponder.current = false;
    const targetIndex = Math.max(0, Math.min(count - 1, index + Math.round(dy / 76)));
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    if (targetIndex !== index) {
      void Haptics.selectionAsync();
      onMove(index, targetIndex);
      translateY.setValue(0);
      animatedLayoutCorrection.setValue(0);
      sourceCollapse.setValue(0);
      sourceSpacing.setValue(8);
      isDraggingRef.current = false;
      setIsDragging(false);
      onDragEnd();
      return;
    }
    finishDrag();
  };
  const startWebTouch = (event: { nativeEvent: { pageY?: number; touches?: ArrayLike<{ pageY: number }> } }) => {
    if (!enabled || Platform.OS !== 'web') return;
    removeWebListeners.current?.();
    clearLongPressTimer();
    const startY = event.nativeEvent.touches?.[0]?.pageY ?? event.nativeEvent.pageY ?? 0;
    let lastDy = 0;
    longPressTimer.current = setTimeout(activateDrag, 1000);
    const move = (touchEvent: TouchEvent) => {
      const pageY = touchEvent.touches[0]?.pageY;
      if (!Number.isFinite(pageY)) return;
      if (!isDragArmed.current) {
        if (Math.abs(pageY - startY) > 8) clearLongPressTimer();
        return;
      }
      touchEvent.preventDefault();
      lastDy = pageY - startY;
      translateY.setValue(lastDy);
      onDragPreview(index, Math.max(0, Math.min(count - 1, index + Math.round(lastDy / 76))));
    };
    const cleanup = () => {
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', end);
      window.removeEventListener('touchcancel', cancel);
      removeWebListeners.current = null;
    };
    const end = () => {
      cleanup();
      if (isDragArmed.current) completeDrag(lastDy);
      else clearLongPressTimer();
    };
    const cancel = () => {
      cleanup();
      finishDrag();
    };
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('touchend', end);
    window.addEventListener('touchcancel', cancel);
    removeWebListeners.current = cleanup;
  };
  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onStartShouldSetPanResponderCapture: () => {
      if (!enabled) return false;
      clearLongPressTimer();
      longPressTimer.current = setTimeout(activateDrag, 1000);
      return false;
    },
    onMoveShouldSetPanResponder: (_, gesture) => {
      if (!isDragArmed.current && Math.abs(gesture.dy) > 8) clearLongPressTimer();
      return isDragArmed.current && Math.abs(gesture.dy) > 2;
    },
    onMoveShouldSetPanResponderCapture: (_, gesture) => {
      if (!isDragArmed.current && Math.abs(gesture.dy) > 8) clearLongPressTimer();
      return isDragArmed.current && Math.abs(gesture.dy) > 2;
    },
    onPanResponderGrant: () => {
      hasResponder.current = true;
      clearLongPressTimer();
    },
    onPanResponderMove: (_, gesture) => {
      translateY.setValue(gesture.dy);
      onDragPreview(index, Math.max(0, Math.min(count - 1, index + Math.round(gesture.dy / 76))));
    },
    onPanResponderRelease: (_, gesture) => {
      completeDrag(gesture.dy);
    },
    onPanResponderTerminate: () => {
      finishDrag();
    },
    onPanResponderTerminationRequest: () => false,
  }), [count, enabled, index, onDragEnd, onDragPreview, onDragStart, onMove, translateY]);
  useEffect(() => () => {
    clearLongPressTimer();
    removeWebListeners.current?.();
  }, []);
  useEffect(() => {
    Animated.spring(beforeGapHeight, { damping: 24, stiffness: 280, toValue: gapBefore, useNativeDriver: false }).start();
  }, [beforeGapHeight, gapBefore]);
  useEffect(() => {
    Animated.spring(afterGapHeight, { damping: 24, stiffness: 280, toValue: gapAfter, useNativeDriver: false }).start();
  }, [afterGapHeight, gapAfter]);
  useEffect(() => {
    Animated.spring(animatedLayoutCorrection, { damping: 24, stiffness: 280, toValue: layoutCorrection, useNativeDriver: true }).start();
  }, [animatedLayoutCorrection, layoutCorrection]);

  return <>
  <Animated.View pointerEvents="none" style={{ height: beforeGapHeight }} />
  <Animated.View
    accessibilityHint={enabled ? 'Удерживайте и перемещайте вверх или вниз, чтобы изменить порядок' : undefined}
    onLayout={(event) => { measuredHeight.current = event.nativeEvent.layout.height; }}
    {...(Platform.OS === 'web' ? { onTouchStart: startWebTouch } : {
      onTouchCancel: finishDrag,
      onTouchEnd: () => {
      clearLongPressTimer();
      if (!hasResponder.current && isDraggingRef.current) finishDrag();
      },
    })}
    style={[
      isDragging && styles.favoriteMusicTrackDragging,
      { marginBottom: sourceCollapse, transform: [{ translateY: Animated.add(translateY, animatedLayoutCorrection) }, { scale: isDragging ? 1.018 : 1 }] },
    ]}
    {...(Platform.OS === 'web' ? {} : panResponder.panHandlers)}
  ><View style={styles.favoriteMusicTrackBody}>{children}</View></Animated.View>
  <Animated.View pointerEvents="none" style={[styles.favoriteMusicTrackSpacing, { height: sourceSpacing }]} />
  <Animated.View pointerEvents="none" style={{ height: afterGapHeight }} />
  </>;
}

function MusicSection({
  artistReleases,
  bandcampUrl,
  canReorder,
  enteringTrackIds,
  leavingTrackIds,
  maxItems,
  onDragStateChange,
  onNotify,
  onReorder,
  onTrackLeaveComplete,
  ownerId,
  ownerName,
  ownerUsername,
  soundcloudUrl,
  tracks,
  uploadedTracks,
}: {
  artistReleases: PublicPageAudioRelease[];
  bandcampUrl: string | null;
  canReorder: boolean;
  enteringTrackIds: string[];
  leavingTrackIds: string[];
  maxItems: number;
  onDragStateChange: (isDragging: boolean) => void;
  onNotify: (message: string, type?: ToastMessage['type']) => void;
  onReorder: (tracks: ProfileMusicTrack[]) => Promise<void>;
  onTrackLeaveComplete: (trackId: string) => void;
  ownerId: string;
  ownerName: string;
  ownerUsername: string;
  soundcloudUrl: string | null;
  tracks: ProfileMusicTrack[];
  uploadedTracks: PublicUploadedMusicTrack[];
}) {
  const globalAudio = useGlobalAudioControls();
  const [trackOrder, setTrackOrder] = useState(() => ({ source: tracks, ordered: tracks }));
  const [dragPreview, setDragPreview] = useState<{ from: number; to: number; height: number } | null>(null);
  const hasUnifiedSoundcloud = tracks.some((track) => track.provider === 'soundcloud');
  const hasUnifiedBandcamp = tracks.some((track) => track.provider === 'bandcamp');
  const legacySoundcloudUrl = hasUnifiedSoundcloud ? null : soundcloudUrl;
  const legacyBandcampUrl = hasUnifiedBandcamp ? null : bandcampUrl;
  const legacySoundcloudTrack = useMemo<ProfileMusicTrack | null>(() => legacySoundcloudUrl ? ({
    id: `legacy-soundcloud:${ownerId}:${legacySoundcloudUrl}`,
    provider: 'soundcloud',
    title: 'SoundCloud',
    artist: ownerName,
    artworkUrl: null,
    previewUrl: legacySoundcloudUrl,
    externalUrl: legacySoundcloudUrl,
    startSeconds: 0,
    clipDurationSeconds: 30,
    durationSeconds: null,
    previewDurationSeconds: 30,
    isPrimary: false,
  }) : null, [legacySoundcloudUrl, ownerId, ownerName]);
  const hasBandcamp = Boolean(legacyBandcampUrl?.trim());
  useEffect(() => {
    if (trackOrder.source === tracks) return;
    setTrackOrder({ source: tracks, ordered: tracks });
  }, [trackOrder.source, tracks]);
  // Render a newly loaded collection immediately. Synchronizing it only in
  // the effect leaves an empty frame below the already visible section title.
  const orderedTracks = canReorder
    ? trackOrder.source === tracks ? trackOrder.ordered : tracks
    : tracks;
  const isOwnerParticipant = useCallback((participants: ProfileMusicTrack['participants'] | PublicUploadedMusicTrack['participants']) => (
    (participants ?? []).some((participant) => (
      participant.entityType === 'account'
      && (participant.id === ownerId || participant.username.toLowerCase() === ownerUsername.toLowerCase())
    ))
  ), [ownerId, ownerUsername]);
  const artistReleaseIds = useMemo(() => new Set(artistReleases.map((release) => release.id)), [artistReleases]);
  const artistUploadedTracks = useMemo(
    () => uploadedTracks.filter((track) => isOwnerParticipant(track.participants)),
    [isOwnerParticipant, uploadedTracks],
  );
  const generalUploadedTracks = useMemo(
    () => uploadedTracks.filter((track) => !isOwnerParticipant(track.participants)),
    [isOwnerParticipant, uploadedTracks],
  );
  const artistTracks = orderedTracks.filter((track) => (
    isOwnerParticipant(track.participants)
    && !(track.releaseId && artistReleaseIds.has(track.releaseId))
  ));
  const generalTracks = orderedTracks.filter((track) => !isOwnerParticipant(track.participants));
  const visibleArtistReleases = artistReleases.slice(0, maxItems);
  const remainingAfterArtistReleases = Math.max(0, maxItems - visibleArtistReleases.length);
  const visibleArtistUploadedTracks = artistUploadedTracks.slice(0, remainingAfterArtistReleases);
  const remainingAfterArtistUploads = Math.max(0, remainingAfterArtistReleases - visibleArtistUploadedTracks.length);
  const visibleArtistTracks = artistTracks.slice(0, remainingAfterArtistUploads);
  const remainingAfterArtistTracks = Math.max(0, remainingAfterArtistUploads - visibleArtistTracks.length);
  const visibleGeneralUploadedTracks = generalUploadedTracks.slice(0, remainingAfterArtistTracks);
  const remainingAfterGeneralUploads = Math.max(0, remainingAfterArtistTracks - visibleGeneralUploadedTracks.length);
  const visibleGeneralTracks = generalTracks.slice(0, remainingAfterGeneralUploads);
  const buildUploadedQueue = (items: PublicUploadedMusicTrack[]): GlobalTrackQueueItem[] => items.flatMap((track) => track.publicUrl ? [{
    id: uploadedTrackPlayerId(track.id),
    title: track.title,
    artist: track.artist?.trim() || ownerName,
    artworkUrl: track.artworkUrl,
    previewUrl: `${apiUrl}/my-music/stream/${encodeURIComponent(track.id)}`,
    provider: 'volna' as const,
    startSeconds: 0,
    clipDurationSeconds: track.durationSeconds,
  }] : []);
  const artistMusicQueue = [
    ...artistReleases.flatMap((release) => buildPlayableQueue(release)),
    ...buildUploadedQueue(artistUploadedTracks),
    ...buildFavoriteMusicQueue(artistTracks),
  ];
  const generalMusicQueue = [
    ...buildUploadedQueue(generalUploadedTracks),
    ...buildFavoriteMusicQueue(generalTracks),
    ...buildFavoriteMusicQueue(legacySoundcloudTrack ? [legacySoundcloudTrack] : []),
  ];
  const artistMusicQueueRef = useRef(artistMusicQueue);
  const generalMusicQueueRef = useRef(generalMusicQueue);
  artistMusicQueueRef.current = artistMusicQueue;
  generalMusicQueueRef.current = generalMusicQueue;
  const resolveArtistMusicQueue = useCallback(
    (target: GlobalTrackQueueItem) => boundedPlaybackQueue(artistMusicQueueRef.current, target),
    [],
  );
  const resolveGeneralMusicQueue = useCallback(
    (target: GlobalTrackQueueItem) => boundedPlaybackQueue(generalMusicQueueRef.current, target),
    [],
  );
  const artistMusicQueueSignature = artistMusicQueue.map((item) => item.id).join('\n');
  const generalMusicQueueSignature = generalMusicQueue.map((item) => item.id).join('\n');
  useEffect(() => {
    const activeTrack = globalAudio.activeTrack;
    if (!activeTrack) return;
    const artistQueueContainsTrack = artistMusicQueueRef.current.some((item) => item.id === activeTrack.id);
    const generalQueueContainsTrack = generalMusicQueueRef.current.some((item) => item.id === activeTrack.id);
    if (artistQueueContainsTrack) {
      const nextQueue = resolveArtistMusicQueue(activeTrack);
      if (nextQueue.length) globalAudio.setActiveQueue(nextQueue, resolveArtistMusicQueue);
    } else if (generalQueueContainsTrack) {
      const nextQueue = resolveGeneralMusicQueue(activeTrack);
      if (nextQueue.length) globalAudio.setActiveQueue(nextQueue, resolveGeneralMusicQueue);
    }
  }, [
    artistMusicQueueSignature,
    generalMusicQueueSignature,
    globalAudio.activeTrack?.id,
    globalAudio.setActiveQueue,
    resolveArtistMusicQueue,
    resolveGeneralMusicQueue,
  ]);
  const remainingAfterGeneralTracks = Math.max(0, remainingAfterGeneralUploads - visibleGeneralTracks.length);
  const showLegacySoundcloud = Boolean(legacySoundcloudUrl && remainingAfterGeneralTracks > 0);
  const showLegacyBandcamp = Boolean(legacyBandcampUrl && remainingAfterGeneralTracks > (showLegacySoundcloud ? 1 : 0));
  const hasArtistMusic = Boolean(artistReleases.length || artistUploadedTracks.length || artistTracks.length);
  const hasGeneralMusic = Boolean(generalUploadedTracks.length || generalTracks.length || legacySoundcloudUrl || hasBandcamp);

  return (
    <View
      {...(Platform.OS === 'web' ? { onContextMenu: (event: { preventDefault: () => void }) => event.preventDefault() } : {})}
      style={[
        styles.musicSection,
        Platform.OS === 'web' ? styles.musicSectionNonSelectable as never : null,
      ]}
    >
      {visibleArtistReleases.length || visibleArtistUploadedTracks.length || visibleArtistTracks.length ? (
        <View style={styles.uploadedMusicSection}>
          <Text style={[styles.musicSectionTitle, styles.artistMusicSectionTitle]}>
            <Text style={styles.sectionSlash}>/ </Text>
            Треки и релизы артиста
          </Text>
          {visibleArtistReleases.map((release) => {
            const releaseTarget = buildPlayableQueue(release)[0];
            const profileQueue = releaseTarget ? resolveArtistMusicQueue(releaseTarget) : undefined;
            const releaseDateLabel = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(release.releaseDate));
            return (
              <AudioReleaseAttachmentCard
                communityLayout
                key={release.id}
                profileQueue={profileQueue}
                queueWindowResolver={resolveArtistMusicQueue}
                release={release}
                releaseDateLabel={releaseDateLabel}
              />
            );
          })}
          {visibleArtistUploadedTracks.map((track) => <UploadedMusicPlayerCard expanded key={track.id} ownerName={ownerName} queue={artistMusicQueue} queueWindowResolver={resolveArtistMusicQueue} track={track} />)}
          {visibleArtistTracks.map((track) => (
            <AnimatedMusicLibraryRow
              entering={enteringTrackIds.includes(track.id)}
              key={`${track.provider}:${track.id}`}
              leaving={leavingTrackIds.includes(track.id)}
              onLeaveComplete={() => onTrackLeaveComplete(track.id)}
            >
              <ProfileMusicPlayerItem artistLayout profileQueue={artistMusicQueue} queueWindowResolver={resolveArtistMusicQueue} showGenres track={track} />
            </AnimatedMusicLibraryRow>
          ))}
        </View>
      ) : null}
      {visibleGeneralUploadedTracks.length || visibleGeneralTracks.length || showLegacySoundcloud || showLegacyBandcamp ? (
        <Text style={styles.musicSectionTitle}>
          <Text style={styles.sectionSlash}>/ </Text>
          Вся музыка
        </Text>
      ) : null}
      {visibleGeneralUploadedTracks.map((track) => <UploadedMusicPlayerCard key={track.id} ownerName={ownerName} queue={generalMusicQueue} queueWindowResolver={resolveGeneralMusicQueue} track={track} />)}
      {visibleGeneralTracks.map((track, index) => (
        <AnimatedMusicLibraryRow
          entering={enteringTrackIds.includes(track.id)}
          key={`${track.provider}:${track.id}`}
          leaving={leavingTrackIds.includes(track.id)}
          onLeaveComplete={() => onTrackLeaveComplete(track.id)}
        >
          <ReorderableFavoriteTrack
            count={visibleGeneralTracks.length}
            enabled={canReorder}
            gapAfter={dragPreview?.to === index && dragPreview.to >= dragPreview.from ? dragPreview.height + 8 : 0}
            gapBefore={dragPreview?.to === index && dragPreview.to < dragPreview.from ? dragPreview.height + 8 : 0}
            index={index}
            layoutCorrection={dragPreview?.from === index && dragPreview.to < dragPreview.from ? -(dragPreview.height + 8) : 0}
            onDragEnd={() => { setDragPreview(null); onDragStateChange(false); }}
            onDragPreview={(from, to) => setDragPreview((current) => current && current.from === from && current.to === to ? current : { from, to, height: current?.height ?? 72 })}
            onDragStart={(from, height) => { setDragPreview({ from, to: from, height }); onDragStateChange(true); }}
            onMove={(fromIndex, toIndex) => {
              if (fromIndex === toIndex) return;
              const previous = [...orderedTracks];
              const reorderedGeneralTracks = [...generalTracks];
              const [moved] = reorderedGeneralTracks.splice(fromIndex, 1);
              reorderedGeneralTracks.splice(toIndex, 0, moved);
              let generalIndex = 0;
              const next = orderedTracks.map((item) => (
                isOwnerParticipant(item.participants)
                  ? item
                  : reorderedGeneralTracks[generalIndex++]
              ));
              setTrackOrder({ source: tracks, ordered: next });
              void onReorder(next).catch((error) => {
                setTrackOrder({ source: tracks, ordered: previous });
                onNotify(error instanceof Error ? error.message : 'Не удалось сохранить порядок треков', 'error');
              });
            }}
          >
            <ProfileMusicPlayerItem profileQueue={generalMusicQueue} queueWindowResolver={resolveGeneralMusicQueue} showGenres={false} track={track} />
          </ReorderableFavoriteTrack>
        </AnimatedMusicLibraryRow>
      ))}
      {showLegacySoundcloud && legacySoundcloudUrl && legacySoundcloudTrack ? (
        <SoundcloudPlaylistCard
          fallbackTrack={legacySoundcloudTrack}
          playlistUrl={legacySoundcloudUrl}
          profileQueue={generalMusicQueue}
          queueWindowResolver={resolveGeneralMusicQueue}
        />
      ) : null}
      {showLegacyBandcamp && legacyBandcampUrl ? (
        <BandcampReleaseCard profileSpacing releaseUrl={profileBandcampReleaseUrl(legacyBandcampUrl)} />
      ) : null}
      {!hasArtistMusic && !hasGeneralMusic ? (
        <View style={styles.emptyProfileTab}>
          <Disc3 color="#7d8894" size={28} strokeWidth={2} />
          <Text style={styles.emptyProfileTabTitle}>Музыка пока не добавлена</Text>
          {canReorder ? <Text style={styles.emptyProfileTabText}>В редактировании профиля можно добавить Apple Music, Яндекс Музыку, SoundCloud, Bandcamp или YouTube.</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

function FavoriteLocationsSection({
  locations,
  maxItems,
  onOpenPublicPage,
}: {
  locations: Profile['favoriteLocations'];
  maxItems: number;
  onOpenPublicPage: (username: string) => Promise<void>;
}) {
  const organizationTypes = new Set(['CLOTHING_BRAND', 'MUSIC_LABEL', 'MUSIC_BAND', 'MUSIC_DUO', 'PODCAST', 'RADIO_STATION', 'BOOKING_AGENCY', 'PROMO_GROUP', 'CREATIVE_COLLECTIVE']);
  const favoriteLocations = locations.filter((location) => !organizationTypes.has(location.type));
  const favoriteCommunities = locations.filter((location) => organizationTypes.has(location.type));
  const visibleFavoriteLocations = favoriteLocations.slice(0, maxItems);
  const visibleFavoriteCommunities = favoriteCommunities.slice(0, Math.max(0, maxItems - visibleFavoriteLocations.length));

  const renderRows = (items: Profile['favoriteLocations']) => items.map((location) => {
    const locationLabel = location.cityName || location.countryName;
    return (
      <Pressable
        accessibilityLabel={`Открыть сообщество ${location.name}`}
        accessibilityRole="link"
        key={location.id}
        onPress={() => void onOpenPublicPage(location.username)}
        style={({ pressed }) => [styles.favoriteLocationRow, pressed && styles.favoriteLocationRowPressed]}
      >
        {location.avatarUrl ? (
          <Image source={{ uri: location.avatarUrl }} style={styles.favoriteLocationIcon} resizeMode="cover" />
        ) : (
          <View style={styles.favoriteLocationIcon}>
            <Text style={styles.favoriteLocationAvatarText}>{getAvatarInitial(location.name)}</Text>
          </View>
        )}
        <View style={styles.favoriteLocationCopy}>
          <Text style={styles.favoriteLocationTitle}>{location.name}</Text>
          <Text style={styles.favoriteLocationUsername}>@{location.username}</Text>
          <Text style={styles.publicPageType}>{publicPageTypeLabels[location.type] || location.type}</Text>
          <Text
            accessibilityElementsHidden={!locationLabel}
            importantForAccessibility={locationLabel ? 'auto' : 'no-hide-descendants'}
            style={[styles.favoriteLocationMeta, !locationLabel && styles.favoriteLocationMetaPlaceholder]}
          >
            {locationLabel || '\u00a0'}
          </Text>
        </View>
        <ChevronRight color="#7d8894" size={18} strokeWidth={1.8} />
      </Pressable>
    );
  });

  return (
    <View style={styles.locationsSection}>
      {visibleFavoriteLocations.length ? (
        <View style={styles.favoriteLocationsGroup}>
          <Text style={[styles.musicSectionTitle, styles.favoriteLocationsTitle]}>
            <Text style={styles.sectionSlash}>/ </Text>
            Любимые локации
          </Text>
          {renderRows(visibleFavoriteLocations)}
        </View>
      ) : null}
      {visibleFavoriteCommunities.length ? (
        <View style={[styles.favoriteLocationsGroup, visibleFavoriteLocations.length ? styles.favoriteCommunityGroup : undefined]}>
          <Text style={[styles.musicSectionTitle, styles.favoriteLocationsTitle]}>
            <Text style={styles.sectionSlash}>/ </Text>
            Любимые сообщества
          </Text>
          {renderRows(visibleFavoriteCommunities)}
        </View>
      ) : null}
    </View>
  );
}

function formatUploadedTrackTime(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(safeSeconds / 60)}:${String(safeSeconds % 60).padStart(2, '0')}`;
}

export function UploadedMusicPlayerCard({ expanded = false, ownerName, queue, queueWindowResolver, track }: { expanded?: boolean; ownerName: string; queue: GlobalTrackQueueItem[]; queueWindowResolver?: GlobalTrack['queueWindowResolver']; track: PublicUploadedMusicTrack }) {
  const globalAudio = useGlobalAudioControls();
  const trackId = uploadedTrackPlayerId(track.id);
  const isPlaying = globalAudio.isTrackPlaying(trackId);
  const releaseDateLabel = track.releaseDate
    ? new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(track.releaseDate))
    : null;
  if (expanded && track.publicUrl) {
    return <TrackPlayerPill
      artist={track.artist?.trim() || ownerName}
      artworkUrl={track.artworkUrl}
      clipDurationSeconds={track.durationSeconds}
      externalUrl={track.publicUrl}
      genres={track.genres}
      previewUrl={`${apiUrl}/my-music/stream/${encodeURIComponent(track.id)}`}
      provider="volna"
      queue={queue.length > 1 ? queue : undefined}
      queueIndex={queue.findIndex((item) => item.id === trackId)}
      queueWindowResolver={queueWindowResolver}
      releaseDateLabel={releaseDateLabel}
      title={track.title}
      variant="release-card"
    />;
  }

  const togglePlayback = async () => {
    if (!track.publicUrl) return;
    if (isPlaying) {
      globalAudio.pause();
      return;
    }
    const descriptor: GlobalTrackQueueItem = {
      id: trackId,
      title: track.title,
      artist: track.artist?.trim() || ownerName,
      artworkUrl: track.artworkUrl,
      previewUrl: `${apiUrl}/my-music/stream/${encodeURIComponent(track.id)}`,
      provider: 'volna',
      startSeconds: 0,
      clipDurationSeconds: track.durationSeconds,
    };
    const effectiveQueue = queueWindowResolver?.(descriptor) ?? queue;
    const queueIndex = effectiveQueue.findIndex((item) => item.id === trackId);
    try {
      await globalAudio.play({ ...descriptor, queue: effectiveQueue.length > 1 ? effectiveQueue : undefined, queueIndex: queueIndex >= 0 ? queueIndex : undefined, queueWindowResolver });
    } catch {
      Alert.alert('Плеер', 'Не удалось воспроизвести загруженный трек');
    }
  };

  return (
    <Pressable
      accessibilityLabel={`${isPlaying ? 'Остановить' : 'Воспроизвести'} ${track.title}`}
      accessibilityRole="button"
      onPress={() => { void togglePlayback(); }}
      style={styles.trackCard}
    >
      {track.artworkUrl ? <Image source={{ uri: track.artworkUrl }} style={styles.uploadedTrackArtwork} /> : <View style={styles.uploadedTrackArtwork}><Text style={styles.audioArtworkFallbackNote}>♪</Text></View>}
      <View style={styles.trackCardCopy}>
        <Text numberOfLines={1} style={styles.trackCardTitle}>{track.title}</Text>
        <Text numberOfLines={1} style={styles.trackCardArtist}>{[track.artist?.trim() || ownerName, releaseDateLabel].filter(Boolean).join(' · ')}</Text>
      </View>
      <View style={styles.trackCardIcon}>
        {isPlaying ? <Pause color="#fff" size={13} strokeWidth={2} /> : <Play color="#fff" size={12} fill="#fff" />}
      </View>
    </Pressable>
  );
}

function profileMusicTrackId(previewUrl: string | null, externalUrl: string | null, title: string | null, startSeconds: number, clipDurationSeconds: number) {
  return `track:${previewUrl ?? externalUrl ?? title ?? ''}:${startSeconds}:${clipDurationSeconds}`;
}

export function buildFavoriteMusicQueue(tracks: ProfileMusicTrack[]): GlobalTrackQueueItem[] {
  return tracks.flatMap((track) => {
    if (track.provider === 'bandcamp' && track.releaseMetadata) {
      return track.releaseMetadata.tracks.flatMap((releaseTrack) => releaseTrack.previewUrl ? [{
        id: `bandcamp:${track.releaseMetadata!.externalUrl}:${releaseTrack.id}`,
        title: releaseTrack.title,
        artist: track.releaseMetadata!.artist,
        artworkUrl: releaseTrack.artworkUrl || track.releaseMetadata!.artworkUrl,
        previewUrl: `${apiUrl}/music/bandcamp/stream?url=${encodeURIComponent(track.releaseMetadata!.externalUrl)}&trackId=${encodeURIComponent(releaseTrack.id)}`,
        externalUrl: releaseTrack.externalUrl || track.releaseMetadata!.externalUrl,
        provider: 'bandcamp' as const,
        collectionTitle: track.releaseMetadata!.title,
        collectionId: track.releaseMetadata!.externalUrl,
        genres: track.genres ?? [],
        releaseId: track.releaseId ?? undefined,
        labelName: track.labelName ?? null,
        labelUsername: track.labelUsername ?? null,
        participants: track.participants ?? [],
        startSeconds: 0,
        clipDurationSeconds: releaseTrack.durationSeconds ?? 30,
      }] : []);
    }
    const previewUrl = track.provider === 'soundcloud' ? track.externalUrl : track.previewUrl;
    if (!previewUrl) return [];
    const clipDurationSeconds = track.provider === 'soundcloud' ? track.durationSeconds ?? track.clipDurationSeconds : track.clipDurationSeconds;
    return [{
      id: profileMusicTrackId(previewUrl, track.externalUrl, track.title, track.startSeconds, clipDurationSeconds),
      title: track.title,
      artist: track.artist,
      artworkUrl: track.artworkUrl,
      previewUrl,
      externalUrl: track.externalUrl,
      provider: track.provider,
      genres: track.genres ?? [],
      releaseId: track.releaseId ?? undefined,
      labelName: track.labelName ?? null,
      labelUsername: track.labelUsername ?? null,
      participants: track.participants ?? [],
      startSeconds: track.startSeconds,
      clipDurationSeconds,
    }];
  });
}

function ExternalProfileMusicItem({ artistLayout = false, profileQueue, queueWindowResolver, showGenres, track }: { artistLayout?: boolean; profileQueue: GlobalTrackQueueItem[]; queueWindowResolver?: GlobalTrack['queueWindowResolver']; showGenres: boolean; track: ProfileMusicTrack }) {
  const displayedGenres = showGenres ? track.genres ?? [] : [];
  const releaseDateLabel = track.releaseDate
    ? new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(track.releaseDate))
    : undefined;
  if (track.provider === 'bandcamp') {
    return <BandcampReleaseCard expandedLayout={artistLayout} genres={displayedGenres} profileQueue={profileQueue} profileSpacing queueWindowResolver={queueWindowResolver} releaseDateLabel={releaseDateLabel} releaseId={track.releaseId ?? undefined} releaseSnapshot={track.releaseMetadata} releaseUrl={track.externalUrl} />;
  }
  if (track.provider === 'soundcloud' && isSoundcloudPlaylistUrl(track.externalUrl)) {
    return <SoundcloudPlaylistCard expandedLayout={artistLayout} fallbackTrack={track} playlistUrl={track.externalUrl} profileQueue={profileQueue} queueWindowResolver={queueWindowResolver} />;
  }
  const previewUrl = track.provider === 'youtube' ? track.previewUrl : track.externalUrl;
  const clipDurationSeconds = track.durationSeconds ?? track.clipDurationSeconds;
  const id = profileMusicTrackId(previewUrl, track.externalUrl, track.title, track.startSeconds ?? 0, clipDurationSeconds);
  return <TrackPlayerPill artist={track.artist} artworkUrl={track.artworkUrl} clipDurationSeconds={track.durationSeconds ?? track.clipDurationSeconds} externalUrl={track.externalUrl} genres={displayedGenres} labelName={track.labelName} labelUsername={track.labelUsername} previewUrl={track.provider === 'youtube' ? track.previewUrl : track.externalUrl} provider={track.provider} queue={profileQueue.length > 1 ? profileQueue : undefined} queueIndex={profileQueue.findIndex((item) => item.id === id)} queueWindowResolver={queueWindowResolver} releaseDateLabel={releaseDateLabel} releaseId={track.releaseId ?? undefined} startSeconds={track.startSeconds ?? 0} title={track.title} variant={artistLayout ? 'release-card' : 'card'} />;
}

export function ProfileMusicPlayerItem({ artistLayout = false, profileQueue, queueWindowResolver, showGenres = true, track }: { artistLayout?: boolean; profileQueue: GlobalTrackQueueItem[]; queueWindowResolver?: GlobalTrack['queueWindowResolver']; showGenres?: boolean; track: ProfileMusicTrack }) {
  return track.provider === 'apple' || track.provider === 'yandex' ? (
    <TrackPlayerPill
      artist={track.artist}
      artworkUrl={track.artworkUrl}
      clipDurationSeconds={track.clipDurationSeconds}
      externalUrl={track.externalUrl}
      genres={showGenres ? track.genres ?? [] : []}
      previewUrl={track.previewUrl}
      provider={track.provider}
      queue={profileQueue.length > 1 ? profileQueue : undefined}
      queueIndex={profileQueue.findIndex((item) => item.id === profileMusicTrackId(track.previewUrl, track.externalUrl, track.title, track.startSeconds, track.clipDurationSeconds))}
      queueWindowResolver={queueWindowResolver}
      releaseDateLabel={track.releaseDate ? new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(track.releaseDate)) : null}
      startSeconds={track.startSeconds}
      title={track.title}
      variant={artistLayout ? 'release-card' : 'card'}
    />
  ) : <ExternalProfileMusicItem artistLayout={artistLayout} profileQueue={profileQueue} queueWindowResolver={queueWindowResolver} showGenres={showGenres} track={track} />;
}

function isSoundcloudPlaylistUrl(value: string) {
  try {
    return new URL(value).pathname.toLowerCase().includes('/sets/');
  } catch {
    return false;
  }
}

function SoundcloudPlaylistCard({ expandedLayout = false, fallbackTrack, playlistUrl, profileQueue, queueWindowResolver }: { expandedLayout?: boolean; fallbackTrack: ProfileMusicTrack; playlistUrl: string; profileQueue: GlobalTrackQueueItem[]; queueWindowResolver?: GlobalTrack['queueWindowResolver'] }) {
  recordClientRender('SoundcloudPlaylistCard');
  const globalAudio = useGlobalAudioControls();
  const [isActivated, setIsActivated] = useState(false);
  const [shouldPlayWhenReady, setShouldPlayWhenReady] = useState(false);
  const [release, setRelease] = useState<SoundcloudReleaseSnapshot | null>(null);
  const [error, setError] = useState('');
  const releaseDateLabel = fallbackTrack.releaseDate
    ? new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(fallbackTrack.releaseDate))
    : null;

  useEffect(() => {
    if (!isActivated) return;
    let active = true;
    setError('');
    void getSoundcloudRelease(playlistUrl)
      .then((result) => {
        if (!active) return;
        setRelease(result);
        if (!result.tracks.length) setError('Не удалось получить треки плейлиста');
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Не удалось загрузить плейлист SoundCloud');
      });
    return () => { active = false; };
  }, [isActivated, playlistUrl]);

  const playableQueue: GlobalTrackQueueItem[] = (release?.tracks ?? []).map((track, index) => ({
    id: `soundcloud-playlist:${playlistUrl}:${index}:${track.externalUrl}`,
    title: track.title,
    artist: track.artist || release?.artist || fallbackTrack.artist,
    artworkUrl: track.artworkUrl || release?.artworkUrl || fallbackTrack.artworkUrl,
    previewUrl: track.externalUrl,
    externalUrl: track.externalUrl,
    provider: 'soundcloud',
    collectionTitle: release?.title || fallbackTrack.title,
    collectionId: playlistUrl,
    sourceTrackUrl: track.externalUrl,
    genres: fallbackTrack.genres ?? [],
    releaseId: fallbackTrack.releaseId ?? undefined,
    labelName: fallbackTrack.labelName,
    labelUsername: fallbackTrack.labelUsername,
    participants: fallbackTrack.participants,
    startSeconds: 0,
    clipDurationSeconds: track.durationSeconds ?? undefined,
  }));
  const profilePlaceholder = profileQueue.find((item) => item.provider === 'soundcloud' && item.externalUrl === playlistUrl);
  const baseQueue = profilePlaceholder ? queueWindowResolver?.(profilePlaceholder) ?? profileQueue : profileQueue;
  const originalQueueIndex = baseQueue.findIndex((item) => item.provider === 'soundcloud' && item.externalUrl === playlistUrl);
  const effectiveQueue = originalQueueIndex >= 0
    ? [...baseQueue.slice(0, originalQueueIndex), ...playableQueue, ...baseQueue.slice(originalQueueIndex + 1)]
    : playableQueue;
  const effectiveQueueSignature = effectiveQueue.map((item) => item.id).join('\n');
  useEffect(() => {
    if (!playableQueue.length || effectiveQueue.length < 2) return;
    const activeId = globalAudio.activeTrack?.id;
    if (!activeId || (!baseQueue.some((item) => item.id === activeId) && !playableQueue.some((item) => item.id === activeId))) return;
    globalAudio.setActiveQueue(effectiveQueue, queueWindowResolver);
  }, [effectiveQueueSignature, globalAudio.activeTrack?.id, globalAudio.setActiveQueue, queueWindowResolver]);
  const activePlaylistTrack = playableQueue.find((item) => (
    item.id === globalAudio.activeTrack?.id
    || (
      globalAudio.activeTrack?.provider === 'soundcloud'
      && (
        globalAudio.activeTrack.collectionId === playlistUrl
        || item.externalUrl === globalAudio.activeTrack.externalUrl
        || item.sourceTrackUrl === globalAudio.activeTrack.sourceTrackUrl
      )
    )
  ));
  const isPlaylistActive = Boolean(activePlaylistTrack);
  const isPlaylistPlaying = isPlaylistActive && globalAudio.isPlaying;
  const togglePlaylist = async () => {
    if (activePlaylistTrack && globalAudio.activeTrack) {
      if (globalAudio.isPlaying) globalAudio.pause();
      else await globalAudio.play(globalAudio.activeTrack);
      return;
    }
    const first = playableQueue[0];
    if (!first) {
      setShouldPlayWhenReady(true);
      setIsActivated(true);
      return;
    }
    const queueIndex = effectiveQueue.findIndex((item) => item.id === first.id);
    await globalAudio.play({ ...first, queue: effectiveQueue.length > 1 ? effectiveQueue : undefined, queueIndex, queueWindowResolver });
  };
  useEffect(() => {
    if (!shouldPlayWhenReady || !playableQueue.length) return;
    setShouldPlayWhenReady(false);
    const first = playableQueue[0];
    const queueIndex = effectiveQueue.findIndex((item) => item.id === first.id);
    void globalAudio.play({ ...first, queue: effectiveQueue.length > 1 ? effectiveQueue : undefined, queueIndex, queueWindowResolver });
  }, [effectiveQueueSignature, playableQueue.length, shouldPlayWhenReady]);

  return <View style={[styles.bandcampReleaseCard, styles.bandcampReleaseCardProfile]}>
    <View style={[styles.bandcampReleaseHeader, expandedLayout && styles.communityAudioReleaseHeader]}>
      <Pressable accessibilityLabel={isPlaylistPlaying ? `Поставить ${fallbackTrack.title} на паузу` : `Воспроизвести ${fallbackTrack.title}`} accessibilityRole="button" onPress={() => void togglePlaylist()} style={[styles.bandcampReleaseHeaderLink, expandedLayout && styles.communityAudioReleaseHeaderLink]}>
        {fallbackTrack.artworkUrl ? <Image resizeMode="cover" source={{ uri: musicArtworkThumbnail(fallbackTrack.artworkUrl, 'soundcloud') ?? fallbackTrack.artworkUrl }} style={[styles.bandcampReleaseArtwork, expandedLayout && styles.communityAudioReleaseArtwork]} /> : <View style={[styles.bandcampReleaseArtworkFallback, expandedLayout && styles.communityAudioReleaseArtwork]}><Radio color="#111" size={24} strokeWidth={1.8} /></View>}
        <View style={styles.bandcampReleaseCopy}><Text numberOfLines={1} style={styles.bandcampReleaseTitle}>{release?.title || fallbackTrack.title}</Text><ReleaseMetadataRows artist={release?.artist || fallbackTrack.artist} genres={fallbackTrack.genres ?? []} provider="SoundCloud" releaseDateLabel={releaseDateLabel} showGenres={expandedLayout} trackCount={playableQueue.length} /></View>
      </Pressable>
      <Pressable accessibilityLabel={isPlaylistPlaying ? 'Поставить плейлист на паузу' : 'Воспроизвести плейлист'} accessibilityRole="button" disabled={isActivated && !playableQueue.length && !error} onPress={() => void togglePlaylist()} style={styles.bandcampTrackPlayButton}>
        {isActivated && !playableQueue.length && !error ? <ActivityIndicator color="#fff" size="small" /> : isPlaylistPlaying ? <Pause color="#fff" size={13} strokeWidth={2} /> : <Play color="#fff" fill="#fff" size={12} strokeWidth={2} />}
      </Pressable>
    </View>
    {error ? <Pressable accessibilityRole="link" onPress={() => void openExternalHttpsUrl(playlistUrl)} style={styles.soundcloudPlaylistError}><Text style={styles.soundcloudFallbackText}>{error}. Открыть в SoundCloud.</Text></Pressable> : null}
    {playableQueue.length ? (
      <ExpandableReleaseTrackList expanded={isPlaylistActive} itemCount={playableQueue.length}>
          {playableQueue.map((track, index) => <TrackPlayerPill artist={track.artist} artworkUrl={track.artworkUrl} clipDurationSeconds={track.clipDurationSeconds} collectionId={playlistUrl} collectionTitle={release?.title || fallbackTrack.title} externalUrl={track.externalUrl ?? playlistUrl} key={track.id} leadingLabel={`${index + 1}`} previewUrl={track.previewUrl} provider="soundcloud" queue={effectiveQueue.length > 1 ? effectiveQueue : undefined} queueIndex={effectiveQueue.findIndex((item) => item.id === track.id)} queueWindowResolver={queueWindowResolver} startSeconds={0} title={track.title} variant="playlist" />)}
      </ExpandableReleaseTrackList>
    ) : null}
  </View>;
}

type BandcampRelease = BandcampReleaseSnapshot;

export function bandcampReleaseQueue(release: BandcampReleaseSnapshot, genres: string[] = [], releaseId?: string): GlobalTrackQueueItem[] {
  return buildPlayableQueue({ id: releaseId, releaseUrl: release.externalUrl, genres, metadata: release });
}

function profileBandcampReleaseUrl(value: string) {
  // Legacy profiles may still contain the embed URL. Its album/track id cannot
  // reliably reconstruct the artist URL, so keep the original value only when
  // it is already a public release link.
  try {
    const parsed = new URL(value);
    return /^\/(album|track)\//i.test(parsed.pathname) ? value : '';
  } catch {
    return '';
  }
}

export function BandcampReleaseCard({ expandedLayout = false, flushTop = false, genres = [], onEdit, profileQueue, profileSpacing = false, queueWindowResolver, releaseDateLabel, releaseId, releaseSnapshot, releaseUrl }: { expandedLayout?: boolean; flushTop?: boolean; genres?: string[]; onEdit?: () => void; profileQueue?: GlobalTrackQueueItem[]; profileSpacing?: boolean; queueWindowResolver?: (target: GlobalTrackQueueItem) => GlobalTrackQueueItem[]; releaseDateLabel?: string; releaseId?: string; releaseSnapshot?: BandcampReleaseSnapshot | null; releaseUrl: string }) {
  recordClientRender('BandcampReleaseCard');
  const globalAudio = useGlobalAudioControls();
  const [release, setRelease] = useState<BandcampRelease | null>(() => releaseSnapshot ?? peekBandcampRelease(releaseUrl));
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const cached = peekBandcampRelease(releaseUrl);
    setRelease(cached ?? releaseSnapshot ?? null);
    setError('');
    if (!releaseUrl) {
      setError('Не удалось определить ссылку релиза Bandcamp');
      return () => { active = false; };
    }
    if (cached) return () => { active = false; };
    void getBandcampRelease(releaseUrl)
      .then((result) => { if (active) setRelease(result); })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'Не удалось загрузить релиз Bandcamp'); });
    return () => { active = false; };
  }, [releaseSnapshot, releaseUrl]);

  if (error) {
    return (
      <Pressable accessibilityRole="link" onPress={() => void openExternalHttpsUrl(releaseUrl)} style={[styles.soundcloudFallback, profileSpacing && styles.bandcampReleaseCardProfile]}>
        <Radio color="#111" size={24} strokeWidth={2} />
        <View style={styles.soundcloudFallbackCopy}>
          <Text style={styles.soundcloudFallbackTitle}>Bandcamp</Text>
          <Text style={styles.soundcloudFallbackText}>{error}. Открыть релиз в браузере.</Text>
        </View>
      </Pressable>
    );
  }

  if (!release) {
    return <View style={[styles.bandcampReleaseLoading, profileSpacing && styles.bandcampReleaseCardProfile]}><ActivityIndicator color="#6f7b86" /><Text style={styles.soundcloudFallbackText}>Загружаем релиз Bandcamp…</Text></View>;
  }

  const releaseQueueMetadata = profileQueue?.find((item) => item.releaseId === releaseId);
  const playableQueue = bandcampReleaseQueue(release, genres, releaseId).map((item) => ({
    ...item,
    labelName: releaseQueueMetadata?.labelName ?? item.labelName ?? null,
    labelUsername: releaseQueueMetadata?.labelUsername ?? item.labelUsername ?? null,
    participants: releaseQueueMetadata?.participants ?? item.participants ?? [],
  }));
  const matchingCollection = (item: GlobalTrackQueueItem) => item.provider === 'bandcamp'
    && item.collectionId === release.externalUrl;
  const firstReleaseIndex = profileQueue?.findIndex(matchingCollection) ?? -1;
  const effectiveQueue = profileQueue?.length && firstReleaseIndex >= 0
    ? [
        ...profileQueue.slice(0, firstReleaseIndex),
        ...playableQueue,
        ...profileQueue.slice(firstReleaseIndex).filter((item) => !matchingCollection(item)),
      ]
    : profileQueue?.length ? profileQueue : playableQueue;
  const isReleaseActive = Boolean(globalAudio.activeTrack && matchingCollection(globalAudio.activeTrack));
  const activeReleaseTrack = playableQueue.find((item) => item.id === globalAudio.activeTrack?.id);
  const isReleasePlaying = isReleaseActive && globalAudio.isPlaying;
  const toggleReleasePlayback = async () => {
    if (isReleasePlaying) {
      globalAudio.pause();
      return;
    }
    if (activeReleaseTrack && globalAudio.activeTrack) {
      await globalAudio.play(globalAudio.activeTrack);
      return;
    }
    const firstTrack = playableQueue[0];
    if (!firstTrack) return;
    const playbackQueue = queueWindowResolver?.(firstTrack) ?? effectiveQueue;
    const queueIndex = playbackQueue.findIndex((item) => item.id === firstTrack.id);
    await globalAudio.play({ ...firstTrack, queue: playbackQueue.length > 1 ? playbackQueue : undefined, queueIndex: queueIndex >= 0 ? queueIndex : undefined, queueWindowResolver });
  };

  return (
    <View style={[styles.bandcampReleaseCard, flushTop && styles.bandcampReleaseCardFlushTop, profileSpacing && styles.bandcampReleaseCardProfile]}>
      <View style={[styles.bandcampReleaseHeader, profileSpacing && styles.bandcampReleaseHeaderProfile, expandedLayout && styles.communityAudioReleaseHeader]}>
        <Pressable accessibilityLabel={isReleasePlaying ? `Поставить ${release.title} на паузу` : `Воспроизвести ${release.title}`} accessibilityRole="button" onPress={() => void toggleReleasePlayback()} style={[styles.bandcampReleaseHeaderLink, expandedLayout && styles.communityAudioReleaseHeaderLink]}>
          {release.artworkUrl ? <Image resizeMode="cover" source={{ uri: musicArtworkThumbnail(release.artworkUrl, 'bandcamp') ?? release.artworkUrl }} style={[styles.bandcampReleaseArtwork, expandedLayout && styles.communityAudioReleaseArtwork]} /> : <View style={[styles.bandcampReleaseArtworkFallback, expandedLayout && styles.communityAudioReleaseArtwork]}><Text style={styles.audioArtworkFallbackNote}>♪</Text></View>}
          <View style={styles.bandcampReleaseCopy}>
            <Text numberOfLines={1} style={styles.bandcampReleaseTitle}>{release.title}</Text>
            <ReleaseMetadataRows artist={release.artist} genres={genres} provider="Bandcamp" releaseDateLabel={releaseDateLabel ?? (release.releaseDate ? new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(release.releaseDate)) : null)} showGenres={expandedLayout} trackCount={release.tracks.length} />
          </View>
        </Pressable>
        {playableQueue.length ? <Pressable accessibilityLabel={isReleasePlaying ? 'Поставить релиз на паузу' : 'Воспроизвести релиз'} accessibilityRole="button" onPress={() => void toggleReleasePlayback()} style={styles.bandcampTrackPlayButton}>{isReleasePlaying ? <Pause color="#fff" size={13} strokeWidth={2} /> : <Play color="#fff" fill="#fff" size={12} strokeWidth={2} />}</Pressable> : null}
        {onEdit ? <Pressable accessibilityLabel="Редактировать релиз" hitSlop={6} onPress={onEdit} style={styles.bandcampReleaseRemoveButton}><Pencil color="#6f7b86" size={17} strokeWidth={1.9} /></Pressable> : null}
      </View>
      {release.tracks.length > 1 ? (
        <ExpandableReleaseTrackList expanded={isReleaseActive} itemCount={release.tracks.length}>
          {release.tracks.map((track, index) => (
            <TrackPlayerPill
              artist={release.artist}
              artworkUrl={release.artworkUrl}
              clipDurationSeconds={track.durationSeconds ?? 30}
              collectionTitle={release.title}
              collectionId={release.externalUrl}
              externalUrl={track.externalUrl || release.externalUrl}
              genres={genres}
              key={track.id}
              leadingLabel={`${index + 1}`}
              previewUrl={`${apiUrl}/music/bandcamp/stream?url=${encodeURIComponent(release.externalUrl)}&trackId=${encodeURIComponent(track.id)}`}
              provider="bandcamp"
              queue={effectiveQueue.length > 1 ? effectiveQueue : undefined}
              queueIndex={effectiveQueue.length > 1 ? effectiveQueue.findIndex((item) => item.id === `bandcamp:${release.externalUrl}:${track.id}`) : undefined}
              queueWindowResolver={queueWindowResolver}
              releaseId={releaseId}
              startSeconds={0}
              title={track.title}
              variant="playlist"
            />
          ))}
        </ExpandableReleaseTrackList>
      ) : null}
    </View>
  );
}

export function AvatarPreviewModal({
  imageUrl,
  isVisible,
  name,
  onClose,
}: {
  imageUrl: string | null;
  isVisible: boolean;
  name: string;
  onClose: () => void;
}) {
  const { height, width } = useWindowDimensions();
  const [intrinsicSize, setIntrinsicSize] = useState<{ height: number; width: number } | null>(null);
  const translateY = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (isVisible) translateY.setValue(0);
  }, [isVisible, translateY]);
  useEffect(() => {
    setIntrinsicSize(null);
    if (!isVisible || !imageUrl) return;
    let isCurrent = true;
    Image.getSize(
      imageUrl,
      (imageWidth, imageHeight) => {
        if (isCurrent && imageWidth > 0 && imageHeight > 0) {
          setIntrinsicSize({ height: imageHeight, width: imageWidth });
        }
      },
      () => undefined,
    );
    return () => {
      isCurrent = false;
    };
  }, [imageUrl, isVisible]);
  const previewSize = useMemo(() => {
    if (!intrinsicSize) return null;
    const availableHeight = Math.max(1, height - 96);
    const scale = Math.min(1, width / intrinsicSize.width, availableHeight / intrinsicSize.height);
    return {
      height: Math.round(intrinsicSize.height * scale),
      width: Math.round(intrinsicSize.width * scale),
    };
  }, [height, intrinsicSize, width]);
  const resetPosition = () => {
    Animated.spring(translateY, {
      friction: 8,
      tension: 80,
      toValue: 0,
      useNativeDriver: true,
    }).start();
  };
  const closeWithSwipe = () => {
    Animated.timing(translateY, {
      duration: 180,
      easing: Easing.in(Easing.cubic),
      toValue: height,
      useNativeDriver: true,
    }).start(onClose);
  };
  const swipeResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, gesture) => gesture.dy > 6 && gesture.dy > Math.abs(gesture.dx) * 1.1,
    onPanResponderMove: (_, gesture) => translateY.setValue(Math.max(0, gesture.dy)),
    onPanResponderRelease: (_, gesture) => {
      const shouldClose = gesture.dy > Math.abs(gesture.dx) * 1.1
        && (gesture.dy >= 80 || (gesture.dy >= 36 && gesture.vy >= 0.75));
      if (shouldClose) closeWithSwipe();
      else resetPosition();
    },
    onPanResponderTerminate: resetPosition,
  });

  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={isVisible}>
      <View style={styles.avatarPreviewLayer}>
        <Pressable onPress={onClose} style={styles.avatarPreviewBackdrop} />
        <Animated.View {...swipeResponder.panHandlers} style={{ flex: 1, transform: [{ translateY }] }}>
          <SafeAreaView style={styles.avatarPreviewSafeArea}>
            <View style={styles.avatarPreviewHeader}>
              <Pressable accessibilityLabel="Закрыть просмотр аватарки" onPress={onClose} style={styles.avatarPreviewClose}>
                <X color="#fff" size={26} strokeWidth={2.2} />
              </Pressable>
            </View>
            <View style={[styles.avatarPreviewImageWrap, previewSize]}>
              {imageUrl && previewSize ? (
                <Image source={{ uri: imageUrl }} style={styles.avatarPreviewImage} resizeMode="cover" />
              ) : imageUrl ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <View style={[styles.avatarPreviewImage, styles.avatarPreviewPlaceholder]}>
                  <Text style={styles.avatarPreviewPlaceholderText}>{getAvatarInitial(name)}</Text>
                </View>
              )}
            </View>
          </SafeAreaView>
        </Animated.View>
      </View>
    </Modal>
  );
}
export function EditProfileScreen({
  administrativeTarget = false,
  authToken,
  onBack,
  onNotify,
  onSave,
  profile,
}: {
  administrativeTarget?: boolean;
  authToken: string;
  onBack: () => void;
  onNotify: (message: string, type?: ToastMessage['type']) => void;
  onSave: (data: ProfileUpdate, options?: { stayOnScreen?: boolean }) => Promise<void>;
  profile: Profile;
}) {
  const safeAreaInsets = useSafeAreaInsets();
  const [username, setUsername] = useState(profile.username);
  const [name, setName] = useState(profile.name);
  const [countryName, setCountryName] = useState(profile.countryName || '');
  const [cityName, setCityName] = useState(formatCityName(profile.countryName, profile.cityName));
  const [cityId, setCityId] = useState(profile.cityId ?? '');
  const [countryCode, setCountryCode] = useState('');
  const [about, setAbout] = useState(profile.about);
  const [connectEnabled, setConnectEnabled] = useState(profile.connectEnabled ?? false);
  const [connectSwitchRejectionKey, setConnectSwitchRejectionKey] = useState(0);
  const [connectGoals, setConnectGoals] = useState<ConnectGoal[]>(profile.connectGoals?.length ? profile.connectGoals : ['ANY']);
  const [connectInterests, setConnectInterests] = useState<string[]>(profile.connectInterests ?? []);
  const [connectPhotos, setConnectPhotos] = useState<ConnectPhoto[]>(profile.connectPhotos ?? []);
  const [connectAbout, setConnectAbout] = useState(profile.connectAbout ?? '');
  const [connectFaceVerified, setConnectFaceVerified] = useState(profile.connectFaceVerified ?? false);
  const [isConnectFaceVerifying, setIsConnectFaceVerifying] = useState(false);
  const [connectLocationPermission, setConnectLocationPermission] = useState<{ canAskAgain: boolean; granted: boolean } | null>(administrativeTarget ? { canAskAgain: false, granted: true } : null);
  const [isRequestingConnectLocation, setIsRequestingConnectLocation] = useState(false);
  const [connectPhotoCrop, setConnectPhotoCrop] = useState<{ asset: AvatarCropAsset; index: number } | null>(null);
  const [gender, setGender] = useState<Gender | null>(profile.gender === 'OTHER' ? null : profile.gender ?? null);
  const [trackTitle, setTrackTitle] = useState(profile.trackTitle ?? '');
  const [trackArtist, setTrackArtist] = useState(profile.trackArtist ?? '');
  const [trackArtworkUrl, setTrackArtworkUrl] = useState(profile.trackArtworkUrl ?? '');
  const [trackPreviewUrl, setTrackPreviewUrl] = useState(profile.trackPreviewUrl ?? '');
  const [trackExternalUrl, setTrackExternalUrl] = useState(profile.trackExternalUrl ?? '');
  const [trackProvider, setTrackProvider] = useState(profile.trackProvider ?? '');
  const [trackStartSeconds, setTrackStartSeconds] = useState(profile.trackStartSeconds ?? 0);
  const [trackClipDurationSeconds, setTrackClipDurationSeconds] = useState(profile.trackClipDurationSeconds ?? 30);
  const [trackDurationSeconds, setTrackDurationSeconds] = useState<number | null>(profile.trackDurationSeconds ?? null);
  const [trackPreviewDurationSeconds, setTrackPreviewDurationSeconds] = useState(profile.trackPreviewDurationSeconds ?? 30);
  const [sharePlaybackActivity, setSharePlaybackActivity] = useState(
    profile.invisibleMode ? false : profile.sharePlaybackActivity ?? false,
  );
  const [primaryUploadedTrackId, setPrimaryUploadedTrackId] = useState<string | null>(() => (
    profile.trackProvider === 'uploaded'
      ? profile.uploadedMusicTracks?.find((track) => track.publicUrl === profile.trackPreviewUrl)?.id ?? null
      : null
  ));
  const [soundcloudMusicUrl, setSoundcloudMusicUrl] = useState(profile.soundcloudMusicUrl ?? '');
  const [bandcampMusicUrl, setBandcampMusicUrl] = useState(profile.bandcampMusicUrl ?? '');
  const [musicGenres, setMusicGenres] = useState((profile.musicGenres ?? []).filter(isMusicSubgenreValue));
  const [avatarUrl, setAvatarUrl] = useState(profile.avatarUrl);
  const [avatarKey, setAvatarKey] = useState(profile.avatarKey ?? null);
  const [avatarCropAsset, setAvatarCropAsset] = useState<AvatarCropAsset | null>(null);
  const [bandcampUrl, setBandcampUrl] = useState(profile.bandcampUrl ?? '');
  const [soundcloudUrl, setSoundcloudUrl] = useState(profile.soundcloudUrl ?? '');
  const [instagramUrl, setInstagramUrl] = useState(profile.instagramUrl ?? '');
  const [threadsUrl, setThreadsUrl] = useState(profile.threadsUrl ?? '');
  const [telegramUrl, setTelegramUrl] = useState(profile.telegramUrl ?? '');
  const [youtubeUrl, setYoutubeUrl] = useState(profile.youtubeUrl ?? '');
  const [letterboxdUrl, setLetterboxdUrl] = useState(profile.letterboxdUrl ?? '');
  const [usernameState, setUsernameState] = useState<'checking' | 'invalid' | 'taken' | 'available'>('available');
  const [isLocationPickerOpen, setIsLocationPickerOpen] = useState(false);
  const [countrySearch, setCountrySearch] = useState('');
  const [autoSaveStatus, setAutoSaveStatus] = useState<'saved' | 'saving' | 'pending' | 'error'>('saved');
  const [verificationRequestStatus, setVerificationRequestStatus] = useState<'PENDING' | 'APPROVED' | 'REJECTED' | null>(profile.isVerified ? 'APPROVED' : null);
  const [isVerificationRequestLoading, setIsVerificationRequestLoading] = useState(false);
  const didInitializeAutoSave = useRef(false);
  const autoSaveQueue = useRef<Promise<void>>(Promise.resolve());
  const [yandexStatus, setYandexStatus] = useState<{ connected: boolean; login: string | null; tracksCount: number; lastSyncedAt: string | null } | null>(null);
  const [appleStatus, setAppleStatus] = useState<{ configured: boolean; connected: boolean; storefront: string | null; tracksCount: number; lastSyncedAt: string | null } | null>(null);
  const [isAppleBusy, setIsAppleBusy] = useState(false);
  const [yandexAttempt, setYandexAttempt] = useState<{ userCode: string; verificationUrl: string } | null>(null);

  useEffect(() => {
    if (administrativeTarget) return;
    let cancelled = false;
    const refreshPermission = () => {
      void getForegroundLocationAccess().then((permission) => {
        if (cancelled) return;
        setConnectLocationPermission(permission);
      }).catch(() => {
        if (cancelled) return;
        setConnectLocationPermission({ canAskAgain: true, granted: false });
      });
    };
    refreshPermission();
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshPermission();
    });
    return () => {
      cancelled = true;
      appStateSubscription.remove();
    };
  }, [administrativeTarget]);

  const requestConnectLocationPermission = async () => {
    if (isRequestingConnectLocation || administrativeTarget) return;
    if (connectLocationPermission && !connectLocationPermission.canAskAgain && Platform.OS !== 'web') {
      await Linking.openSettings();
      return;
    }
    setIsRequestingConnectLocation(true);
    try {
      const permission = await requestForegroundLocationAccess();
      setConnectLocationPermission(permission);
      if (!permission.granted) {
        notifyError(permission.canAskAgain
          ? 'Разрешите доступ к геопозиции, чтобы включить Коннект'
          : 'Разрешение заблокировано. Включите геопозицию для VOLNA в настройках устройства или браузера');
      }
    } catch {
      notifyError('Не удалось запросить доступ к геопозиции');
    } finally {
      setIsRequestingConnectLocation(false);
    }
  };
  const [isYandexBusy, setIsYandexBusy] = useState(false);
  useEffect(() => {
    if (administrativeTarget) return;
    let active = true;
    void fetch(`${apiUrl}/profiles/me/verification-request`, {
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
  }, [administrativeTarget, authToken, profile.id, profile.isVerified]);

  const submitVerificationRequest = async () => {
    if (isVerificationRequestLoading || verificationRequestStatus === 'PENDING' || profile.isVerified) return;
    setIsVerificationRequestLoading(true);
    try {
      const response = await fetch(`${apiUrl}/profiles/me/verification-request`, {
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
  const filteredCountries = useMemo(() => {
    const normalizedSearch = countrySearch.trim().toLowerCase();

    if (!normalizedSearch) {
      return countryOptions;
    }

    return countryOptions.filter((country) => country.toLowerCase().startsWith(normalizedSearch));
  }, [countrySearch]);
  const primaryFavoriteTrack: ProfileMusicTrack | null = trackTitle && trackPreviewUrl && trackProvider !== 'uploaded' ? {
    id: `profile-primary:${trackProvider}:${trackExternalUrl || trackPreviewUrl}`,
    provider: trackProvider as ProfileMusicTrack['provider'],
    title: trackTitle,
    artist: trackArtist,
    artworkUrl: trackArtworkUrl || null,
    previewUrl: trackPreviewUrl,
    externalUrl: trackExternalUrl,
    startSeconds: trackStartSeconds,
    clipDurationSeconds: trackClipDurationSeconds,
    durationSeconds: trackDurationSeconds,
    previewDurationSeconds: trackPreviewDurationSeconds,
    isPrimary: true,
  } : null;
  const primaryUploadedTrack = primaryUploadedTrackId
    ? (profile.uploadedMusicTracks ?? []).find((track) => track.id === primaryUploadedTrackId) ?? null
    : null;
  const primaryTrackStartSelectionDuration = primaryUploadedTrack?.durationSeconds
    ?? (primaryFavoriteTrack
      ? (primaryFavoriteTrack.provider === 'apple' || primaryFavoriteTrack.provider === 'yandex'
        ? primaryFavoriteTrack.previewDurationSeconds
        : primaryFavoriteTrack.durationSeconds ?? primaryFavoriteTrack.previewDurationSeconds)
      : trackPreviewDurationSeconds);
  const selectPrimaryCatalogTrack = (track: AppleMusicTrack) => {
    const previewDurationSeconds = Number.isFinite(track.previewDurationSeconds) ? track.previewDurationSeconds : 30;
    setPrimaryUploadedTrackId(null);
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
  const selectPrimaryExternalTrack = (track: { provider: 'soundcloud' | 'bandcamp' | 'youtube'; title: string; artist: string; artworkUrl: string | null; externalUrl: string; previewUrl?: string | null; durationSeconds?: number | null; previewDurationSeconds?: number }) => {
    const availableDuration = track.durationSeconds ?? track.previewDurationSeconds ?? 30;
    const selected: ProfileMusicTrack = {
      id: `external-${Date.now()}`,
      provider: track.provider,
      title: track.title,
      artist: track.artist,
      artworkUrl: track.artworkUrl,
      previewUrl: track.previewUrl || track.externalUrl,
      externalUrl: track.externalUrl,
      startSeconds: 0,
      clipDurationSeconds: Math.min(30, availableDuration),
      durationSeconds: track.durationSeconds ?? null,
      previewDurationSeconds: track.previewDurationSeconds ?? availableDuration,
      isPrimary: true,
    };
    setPrimaryUploadedTrackId(null);
    setTrackTitle(selected.title);
    setTrackArtist(selected.artist);
    setTrackArtworkUrl(selected.artworkUrl ?? '');
    setTrackPreviewUrl(selected.previewUrl);
    setTrackExternalUrl(selected.externalUrl);
    setTrackProvider(selected.provider);
    setTrackStartSeconds(selected.startSeconds);
    setTrackClipDurationSeconds(selected.clipDurationSeconds);
    setTrackDurationSeconds(selected.durationSeconds);
    setTrackPreviewDurationSeconds(selected.previewDurationSeconds);
  };
  const removePrimaryTrack = () => {
    setPrimaryUploadedTrackId(null);
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

  const verifyConnectFace = async () => {
    if (!connectPhotos.length) {
      notifyError('Сначала добавьте фотографию в Коннекте');
      return;
    }
    setIsConnectFaceVerifying(true);
    try {
      if (Platform.OS !== 'web') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) throw new Error('Разрешите VOLNA доступ к камере');
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        cameraType: ImagePicker.CameraType.front,
        allowsEditing: false,
        base64: false,
        quality: 0.85,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset?.uri) throw new Error('Не удалось получить снимок с камеры');
      const normalized = await manipulateAsync(
        asset.uri,
        asset.width > 1280 ? [{ resize: { width: 1280 } }] : [],
        { base64: true, compress: 0.78, format: SaveFormat.JPEG },
      );
      if (!normalized.base64) throw new Error('Не удалось подготовить снимок с камеры');
      const response = await fetch(`${apiUrl}/profiles/connect/face-verification`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // CPU face detection may need to inspect all five Connect photos.
          // Keep this request aligned with the verifier/Gunicorn budget instead
          // of aborting through the shared client's ordinary 15-second limit.
          'x-volna-timeout-ms': '85000',
        },
        body: JSON.stringify({ selfie: `data:image/jpeg;base64,${normalized.base64}` }),
      });
      if (response.status === 429) {
        throw new Error('Слишком много попыток. Подождите несколько минут и попробуйте снова.');
      }
      if (!response.ok) throw new Error(await readApiError(response, 'Не удалось подтвердить личность'));
      setConnectFaceVerified(true);
      onNotify('Личность подтверждена', 'success');
    } catch (error) {
      notifyError(error instanceof Error ? error.message : 'Не удалось подтвердить личность');
    } finally {
      setIsConnectFaceVerifying(false);
    }
  };

  const loadYandexStatus = useCallback(async () => {
    if (administrativeTarget) return;
    const response = await fetch(`${apiUrl}/music/yandex/account/status`, { headers: { Authorization: `Bearer ${authToken}` } });
    if (response.ok) setYandexStatus(await response.json());
  }, [administrativeTarget, authToken]);

  useEffect(() => { void loadYandexStatus(); }, [loadYandexStatus]);
  const loadAppleStatus = useCallback(async () => {
    if (administrativeTarget) return;
    const response = await fetch(`${apiUrl}/music/apple/account/status`, { headers: { Authorization: `Bearer ${authToken}` } });
    if (response.ok) setAppleStatus(await response.json());
  }, [administrativeTarget, authToken]);
  useEffect(() => { void loadAppleStatus(); }, [loadAppleStatus]);

  const runAppleAction = async (action: 'connect' | 'sync' | 'disconnect') => {
    setIsAppleBusy(true);
    try {
      if (action === 'connect') {
        if (Platform.OS !== 'web') throw new Error('Подключение Apple Music на телефоне потребует dev build с MusicKit; сейчас подключите аккаунт в веб-версии');
        const configResponse = await fetch(`${apiUrl}/music/apple/account/config`);
        const config = await configResponse.json() as { configured?: boolean; developerToken?: string; appName?: string; build?: string; message?: string };
        if (!configResponse.ok || !config.configured || !config.developerToken) throw new Error(config.message || 'Apple Music ещё не настроена на сервере');
        const browserWindow = window as any;
        if (!browserWindow.MusicKit) {
          await new Promise<void>((resolve, reject) => { const script = document.createElement('script'); script.src = 'https://js-cdn.music.apple.com/musickit/v3/musickit.js'; script.onload = () => resolve(); script.onerror = () => reject(new Error('Не удалось загрузить MusicKit')); document.head.appendChild(script); });
        }
        browserWindow.MusicKit.configure({ developerToken: config.developerToken, app: { name: config.appName, build: config.build } });
        const musicUserToken = await browserWindow.MusicKit.getInstance().authorize();
        const response = await fetch(`${apiUrl}/music/apple/account/connect`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ musicUserToken }) });
        if (!response.ok) throw new Error((await response.json()).message || 'Не удалось подключить Apple Music');
      } else {
        const response = await fetch(`${apiUrl}/music/apple/account${action === 'sync' ? '/sync' : ''}`, { method: action === 'sync' ? 'POST' : 'DELETE' });
        if (!response.ok) throw new Error((await response.json()).message || 'Операция Apple Music не выполнена');
      }
      await loadAppleStatus(); onNotify(action === 'disconnect' ? 'Apple Music отключена' : 'Apple Music подключена');
    } catch (error) { onNotify(error instanceof Error ? error.message : 'Ошибка Apple Music', 'error'); }
    finally { setIsAppleBusy(false); }
  };

  const runYandexAction = async (action: 'connect' | 'poll' | 'sync' | 'disconnect') => {
    setIsYandexBusy(true);
    try {
      const response = await fetch(`${apiUrl}/music/yandex/account${action === 'disconnect' ? '' : `/${action}`}`, {
        method: action === 'disconnect' ? 'DELETE' : 'POST',
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Не удалось подключить Яндекс Музыку');
      if (action === 'connect') {
        setYandexAttempt(data);
      } else if (action === 'poll' && data.connected) {
        setYandexAttempt(null);
        onNotify('Яндекс Музыка подключена');
        await loadYandexStatus();
      } else if (action === 'poll' && data.pending) {
        onNotify('Подтвердите подключение на странице Яндекса', 'error');
      } else {
        if (action === 'disconnect') setYandexAttempt(null);
        await loadYandexStatus();
      }
    } catch (error) {
      onNotify(error instanceof Error ? error.message : 'Ошибка Яндекс Музыки', 'error');
    } finally {
      setIsYandexBusy(false);
    }
  };

  const copyYandexCode = async () => {
    if (!yandexAttempt?.userCode) return;
    try {
      await Clipboard.setStringAsync(yandexAttempt.userCode);
      onNotify('Код скопирован в буфер обмена');
    } catch {
      onNotify('Не удалось скопировать код', 'error');
    }
  };

  useEffect(() => {
    const normalizedUsername = username.trim().replace(/^@/, '').toLowerCase();

    if (!/^(?=.{3,20}$)(?=.*[a-z])[a-z0-9_]+$/.test(normalizedUsername)) {
      setUsernameState('invalid');
      return;
    }

    if (normalizedUsername === profile.username) {
      setUsernameState('available');
      return;
    }

    setUsernameState('checking');
    const timeout = setTimeout(() => {
      fetch(
        `${apiUrl}/auth/username-available?username=${encodeURIComponent(normalizedUsername)}&current=${encodeURIComponent(
          profile.username,
        )}`,
      )
        .then((response) => response.json() as Promise<{ available: boolean }>)
        .then((result) => setUsernameState(result.available ? 'available' : 'taken'))
        .catch(() => setUsernameState('invalid'));
    }, 350);

    return () => clearTimeout(timeout);
  }, [profile.username, username]);

  const notifyError = (message: string) => {
    onNotify(message, 'error');
  };

  const rejectConnectActivation = (message: string) => {
    notifyError(message);
    setConnectSwitchRejectionKey((current) => current + 1);
  };

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

  const pickConnectPhoto = async (index: number) => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Фото Коннекта', 'Нужно разрешение на выбор фото из галереи.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ allowsEditing: false, base64: false, mediaTypes: ['images'], quality: 1 });
    if (result.canceled) return;
    const asset = result.assets[0];
    setConnectPhotoCrop({ index, asset: { uri: asset.uri, width: asset.width || 1200, height: asset.height || 1200, mimeType: asset.mimeType || 'image/jpeg' } });
  };

  const submit = async () => {
    if (usernameState !== 'available') {
      setAutoSaveStatus('pending');
      return;
    }

    const nameError = validateDisplayName(name);
    if (nameError) {
      if (getProfileTextViolation(name)) notifyError(nameError);
      setAutoSaveStatus('pending');
      return;
    }

    const aboutViolation = getProfileTextViolation(about);
    if (aboutViolation) {
      setAutoSaveStatus('error');
      notifyError(aboutViolation === 'link'
        ? 'Описание профиля не должно содержать ссылки'
        : 'Описание профиля не должно содержать нецензурную лексику');
      return;
    }

    const connectAboutViolation = getProfileTextViolation(connectAbout);
    if (connectAboutViolation) {
      setAutoSaveStatus('error');
      notifyError(connectAboutViolation === 'link'
        ? 'Описание Коннекта не должно содержать ссылки'
        : 'Описание Коннекта не должно содержать нецензурную лексику');
      return;
    }

    const normalizedBandcampLink = normalizeSocialLink(bandcampUrl, 'bandcamp');
    const normalizedSoundcloudLink = normalizeSocialLink(soundcloudUrl, 'soundcloud');
    const normalizedInstagramLink = normalizeSocialLink(instagramUrl, 'instagram');
    const normalizedThreadsLink = normalizeSocialLink(threadsUrl, 'threads');
    const normalizedTelegramLink = normalizeSocialLink(telegramUrl, 'telegram');
    const normalizedYoutubeLink = normalizeSocialLink(youtubeUrl, 'youtube');
    const normalizedLetterboxdLink = normalizeSocialLink(letterboxdUrl, 'letterboxd');
    const urlError =
      normalizedBandcampLink.error ||
      normalizedSoundcloudLink.error ||
      normalizedInstagramLink.error ||
      normalizedThreadsLink.error ||
      normalizedTelegramLink.error ||
      normalizedYoutubeLink.error ||
      normalizedLetterboxdLink.error;

    if (urlError) {
      setAutoSaveStatus('pending');
      return;
    }

    if (about.length > 500) {
      setAutoSaveStatus('pending');
      return;
    }

    if (connectEnabled && !connectGoals.length) {
      setAutoSaveStatus('pending');
      return;
    }

    if (connectEnabled && !connectPhotos.length) {
      setAutoSaveStatus('pending');
      return;
    }

    setAutoSaveStatus('saving');

    try {
      let savedAvatarUrl = avatarUrl;
      let savedAvatarKey = avatarKey;
      if (avatarUrl && !/^https?:\/\//i.test(avatarUrl)) {
        const uploaded = await uploadAvatarAsset(avatarUrl, authToken, 'account', undefined, administrativeTarget ? profile.username : undefined);
        savedAvatarUrl = uploaded.avatarUrl;
        savedAvatarKey = uploaded.avatarKey;
        setAvatarUrl(savedAvatarUrl);
        setAvatarKey(savedAvatarKey);
      }
      const savedConnectPhotos: ConnectPhoto[] = [];
      let didUploadConnectPhoto = false;
      for (const photo of connectPhotos) {
        if (photo.imageKey) {
          savedConnectPhotos.push(photo);
        } else {
          savedConnectPhotos.push(await uploadConnectPhotoAsset(photo.imageUrl, authToken, administrativeTarget ? `account:${profile.username}` : 'account'));
          didUploadConnectPhoto = true;
        }
      }
      // Replacing an unchanged array retriggers the autosave effect forever.
      // Synchronize local state only when a local photo was actually uploaded.
      if (didUploadConnectPhoto) setConnectPhotos(savedConnectPhotos);
      const avatarChanged = savedAvatarUrl !== profile.avatarUrl || savedAvatarKey !== (profile.avatarKey ?? null);
      const normalizedTrackStartSeconds = Math.round(Number(trackStartSeconds) * 100) / 100;
      const normalizedTrackClipDurationSeconds = Math.round(Number(trackClipDurationSeconds) * 100) / 100;
      const normalizedTrackDurationSeconds = trackDurationSeconds == null
        ? null
        : Math.round(Number(trackDurationSeconds) * 100) / 100;
      const normalizedTrackPreviewDurationSeconds = Math.round(Number(trackPreviewDurationSeconds) * 100) / 100;
      await onSave({
        username: username.trim().replace(/^@/, '').toLowerCase(),
        name: name.trim(),
        countryName: countryName.trim(),
        cityName: cityName.trim(),
        cityId,
        countryCode,
        about,
        connectEnabled,
        connectGoals,
        connectInterests,
        connectPhotos: savedConnectPhotos,
        connectAbout,
        gender,
        trackTitle: primaryUploadedTrackId ? undefined : trackTitle,
        trackArtist: primaryUploadedTrackId ? undefined : trackArtist,
        trackArtworkUrl: primaryUploadedTrackId ? undefined : trackArtworkUrl,
        trackPreviewUrl: primaryUploadedTrackId ? undefined : trackPreviewUrl,
        trackExternalUrl: primaryUploadedTrackId ? undefined : trackExternalUrl,
        trackProvider: primaryUploadedTrackId ? undefined : trackProvider,
        trackStartSeconds: normalizedTrackStartSeconds,
        trackClipDurationSeconds: normalizedTrackClipDurationSeconds,
        trackDurationSeconds: normalizedTrackDurationSeconds,
        trackPreviewDurationSeconds: normalizedTrackPreviewDurationSeconds,
        sharePlaybackActivity,
        primaryUploadedMusicTrackId: primaryUploadedTrackId,
        soundcloudMusicUrl: '',
        bandcampMusicUrl: '',
        musicGenres: normalizeMusicGenres(musicGenres),
        ...(avatarChanged ? { avatarUrl: savedAvatarUrl, avatarKey: savedAvatarKey } : {}),
        bandcampUrl: normalizedBandcampLink.url,
        soundcloudUrl: normalizedSoundcloudLink.url,
        instagramUrl: normalizedInstagramLink.url,
        threadsUrl: normalizedThreadsLink.url,
        telegramUrl: normalizedTelegramLink.url,
        youtubeUrl: normalizedYoutubeLink.url,
        letterboxdUrl: normalizedLetterboxdLink.url,
      }, { stayOnScreen: true });
      emitPlaybackVisibilityChanged();
      setAutoSaveStatus('saved');
    } catch (saveError) {
      setAutoSaveStatus('error');
      notifyError(saveError instanceof Error ? saveError.message : 'Не удалось сохранить профиль');
    }
  };

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
    about, avatarKey, avatarUrl, bandcampUrl, cityId, connectEnabled, connectGoals, connectInterests,
    connectPhotos, connectAbout, countryCode, countryName, gender, instagramUrl, letterboxdUrl, musicGenres, name,
    primaryUploadedTrackId, sharePlaybackActivity, soundcloudUrl, telegramUrl, threadsUrl, trackArtist, trackArtworkUrl,
    trackClipDurationSeconds, trackDurationSeconds, trackExternalUrl, trackPreviewDurationSeconds,
    trackPreviewUrl, trackProvider, trackStartSeconds, trackTitle, username, usernameState, youtubeUrl,
  ]);

  useEffect(() => {
    if (!connectEnabled) return;
    const hasSelectedGender = gender === 'MALE' || gender === 'FEMALE';
    if (hasSelectedGender && connectGoals.length && connectPhotos.length) return;
    setConnectEnabled(false);
  }, [connectEnabled, connectGoals.length, connectPhotos.length, gender]);

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

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? safeAreaInsets.bottom : 0} style={styles.editShell}>
        <ScrollView contentContainerStyle={[styles.editContent, styles.editProfileContent]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.editIdentityRow}>
            <View style={styles.avatarEditRow}>
              <AvatarEditButton avatarUrl={avatarUrl} entityType="account" onPress={pickAvatar} />
            </View>

            <View style={[styles.editFieldGroup, styles.editorBorderlessSurface]}>
              <View style={styles.editFieldRow}>
                <Text style={styles.usernamePrefix}>@</Text>
                <TextInput
                  autoCapitalize="none"
                  autoCorrect={false}
                  maxLength={20}
                  onChangeText={(value) => setUsername(normalizeUsernameInput(value, 20))}
                  placeholder="Username"
                  placeholderTextColor="#98a3ae"
                  style={[styles.editGroupInput, styles.editGroupUsernameInput]}
                  value={username}
                />
                <View style={styles.usernameStatusSlot}>
                  {usernameState === 'checking' ? <ActivityIndicator color="#7d8894" size="small" /> : null}
                  {usernameState === 'available' ? <Check color="#2fa84f" size={20} strokeWidth={2.4} /> : null}
                  {usernameState === 'taken' || usernameState === 'invalid' ? (
                    <X color="#c62828" size={19} strokeWidth={2.4} />
                  ) : null}
                </View>
              </View>
              <View style={styles.editFieldSeparator} />
              <TextInput
                maxLength={30}
                onChangeText={setName}
                placeholder="Имя"
                placeholderTextColor="#98a3ae"
                style={[styles.editGroupInput, styles.editGroupInputWithLeftPadding]}
                value={name}
              />
            </View>
          </View>

          <View style={[styles.connectGoalsBlock, styles.genderInlineBlock]}>
            <Text style={styles.editLocationLabel}>Пол</Text>
            <AnimatedSegmentedControl
              accessibilityLabel="Пол"
              containerStyle={styles.genderInlineOptions}
              onChange={(nextGender) => {
                setGender(nextGender);
                if (nextGender === null && connectEnabled) {
                  setConnectEnabled(false);
                  onNotify('Коннект отключён: для него необходимо указать свой пол', 'error');
                }
              }}
              options={([{ value: null, label: 'Не выбран' }, { value: 'MALE', label: 'Мужчина' }, { value: 'FEMALE', label: 'Женщина' }] as Array<{ value: Gender | null; label: string }>)}
              value={gender}
            />
          </View>

          <View style={styles.editLocationRow}>
            <Pressable onPress={() => setIsLocationPickerOpen(true)} style={[styles.editSelectInput, styles.editLocationField, styles.editorBorderlessSurface]}>
              <View style={styles.editLocationValueGroup}>
                <Text style={styles.editLocationLabel}>Местоположение</Text>
                <Text numberOfLines={1} style={[styles.editSelectText, !countryName && styles.editSelectPlaceholder]}>
                  {cityName ? `${countryName}, ${cityName}` : countryName || 'Не выбрано'}
                </Text>
              </View>
              <Text style={styles.editSelectChevron}>›</Text>
            </Pressable>
          </View>

          <View style={[styles.editAboutField, styles.editorBorderlessSurface]}>
            <Text style={styles.editLocationLabel}>О себе</Text>
            <TextInput multiline onChangeText={setAbout} style={styles.editAboutInput} textAlignVertical="top" value={about} />
          </View>

          <View style={styles.primaryTrackPickerBlock}>
              <View style={styles.primaryTrackPickerList}>
                <View style={[styles.primaryTrackPickerRow, styles.primaryTrackPickerRowActive]}>
                  {(primaryFavoriteTrack || primaryUploadedTrack) ? <>
                    {(primaryFavoriteTrack?.artworkUrl || primaryUploadedTrack?.artworkUrl) ? <Image source={{ uri: primaryFavoriteTrack?.artworkUrl || primaryUploadedTrack?.artworkUrl || '' }} style={styles.primaryTrackPickerArtwork} /> : <View style={styles.primaryTrackPickerArtworkPlaceholder}><Disc3 color="#111" size={18} /></View>}
                    <View style={styles.primaryTrackPickerCopy}>
                      <Text numberOfLines={1} style={styles.primaryTrackPickerTitle}>{primaryUploadedTrack?.title ?? primaryFavoriteTrack?.title}</Text>
                      <Text numberOfLines={1} style={styles.primaryTrackPickerMeta}>{primaryUploadedTrack ? `Мой трек · ${formatUploadedTrackTime(primaryUploadedTrack.durationSeconds)}` : primaryFavoriteTrack?.artist || 'Любимая музыка'}</Text>
                    </View>
                  </> : null}
                  <PrimaryTrackCatalogSearch
                    clipDurationSeconds={trackClipDurationSeconds}
                    durationSeconds={primaryTrackStartSelectionDuration}
                    onChangeStart={setTrackStartSeconds}
                    onDurationChange={setTrackDurationSeconds}
                    onRemove={removePrimaryTrack}
                    onSelect={selectPrimaryCatalogTrack}
                    onSelectExternal={selectPrimaryExternalTrack}
                    playback={(primaryUploadedTrack || primaryFavoriteTrack) ? {
                      artist: primaryUploadedTrack ? primaryUploadedTrack.artist?.trim() || profile.name : primaryFavoriteTrack?.artist ?? trackArtist,
                      artworkUrl: primaryUploadedTrack?.artworkUrl ?? primaryFavoriteTrack?.artworkUrl ?? trackArtworkUrl,
                      externalUrl: primaryUploadedTrack?.publicUrl ?? primaryFavoriteTrack?.externalUrl ?? trackExternalUrl,
                      previewUrl: primaryUploadedTrack ? `${apiUrl}/my-music/stream/${encodeURIComponent(primaryUploadedTrack.id)}` : primaryFavoriteTrack?.previewUrl ?? trackPreviewUrl,
                      title: primaryUploadedTrack?.title ?? primaryFavoriteTrack?.title ?? trackTitle,
                    } : null}
                    provider={primaryUploadedTrack ? 'uploaded' : primaryFavoriteTrack?.provider ?? 'apple'}
                    startSeconds={trackStartSeconds}
                  />
                </View>
              </View>
            </View>

          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: sharePlaybackActivity }}
            onPress={() => {
              if (!sharePlaybackActivity && profile.invisibleMode) {
                onNotify(
                  'Отключите режим невидимки, чтобы показывать, что вы сейчас слушаете',
                  'error',
                );
                return;
              }
              setSharePlaybackActivity((current) => !current);
            }}
            style={styles.profilePlaybackShareBlock}
          >
            <View style={[styles.communityAudioPublishCheckbox, sharePlaybackActivity && styles.communityAudioPublishCheckboxActive]}>
              {sharePlaybackActivity ? <Check color="#fff" size={15} strokeWidth={2.5} /> : null}
            </View>
            <Text style={styles.profilePlaybackShareText}>Показывать, что я сейчас слушаю</Text>
          </Pressable>

          <Text style={styles.editSectionTitle}>Коннект</Text>
          <ConnectPhotosEditor
            about={connectAbout}
            onAdd={(index) => { void pickConnectPhoto(index); }}
            onChangeAbout={setConnectAbout}
            onChange={(photos) => {
              setConnectFaceVerified(false);
              setConnectPhotos(photos);
              if (!photos.length && connectEnabled) setConnectEnabled(false);
            }}
            photos={connectPhotos}
          />
          {!administrativeTarget ? <View style={styles.connectFaceVerificationBlock}>
            <View style={styles.connectFaceVerificationCopy}>
              <View style={styles.connectFaceVerificationTitleRow}>
                <ShieldCheck color={connectFaceVerified ? '#20b863' : '#111'} size={20} strokeWidth={2} />
                <Text style={[styles.connectGoalsTitle, styles.connectInlineTitle]}>
                  {connectFaceVerified ? 'Личность подтверждена' : 'Подтверждение личности'}
                </Text>
              </View>
              <Text style={styles.connectPhotosHint}>
                Селфи с фронтальной камеры сравнивается с фотографиями Коннекта и удаляется сразу после проверки.
                Хотя бы на одной фотографии должно быть хорошо видно лицо. Нажимая «Подтвердить», вы соглашаетесь на его разовую обработку.
              </Text>
            </View>
            {!connectFaceVerified ? (
              <Pressable
                accessibilityLabel="Подтвердить лицо камерой"
                accessibilityRole="button"
                disabled={isConnectFaceVerifying}
                onPress={() => void verifyConnectFace()}
                style={styles.connectFaceVerificationButton}
              >
                {isConnectFaceVerifying
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.connectFaceVerificationButtonText}>Подтвердить</Text>}
              </Pressable>
            ) : null}
          </View> : null}
          <View style={styles.connectGoalsBlock}>
                <Text style={styles.connectGoalsTitle}>Цели взаимодействия</Text>
                <View style={styles.connectGoalChips}>
                {([
                  { value: 'ANY', label: 'Без конкретики' },
                  { value: 'COLLABORATION', label: 'Коллаборации' },
                  { value: 'FRIENDSHIP', label: 'Знакомства' },
                  { value: 'DATING', label: 'Романтика' },
                ] as Array<{ value: ConnectGoal; label: string }>).map((option) => {
                  const selected = connectGoals.includes(option.value);
                  return (
                    <Pressable
                      key={option.value}
                      onPress={() => {
                        if (option.value === 'ANY') {
                          setConnectGoals(selected ? [] : ['ANY']);
                          return;
                        }
                        const specific = connectGoals.filter((goal) => goal !== 'ANY');
                        const next = selected
                          ? specific.filter((goal) => goal !== option.value)
                          : [...specific, option.value];
                        setConnectGoals(next);
                      }}
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
          <ConnectInterestSelector onChange={setConnectInterests} selected={connectInterests} />
          <MusicGenreSelector selected={musicGenres} onChange={setMusicGenres} subgenresOnly />
          {!administrativeTarget ? (
            <View style={styles.connectLocationPermissionBlock}>
              <View style={styles.connectLocationPermissionTitleRow}>
                <MapPin color={connectLocationPermission?.granted ? '#20b863' : '#111'} size={20} strokeWidth={2} />
                <Text style={[styles.connectGoalsTitle, styles.connectInlineTitle]}>Геопозиция</Text>
              </View>
              <Text style={styles.settingsHint}>
                {connectLocationPermission?.granted
                  ? 'Доступ разрешён. Точные координаты не сохраняются и не передаются в профиль.'
                  : connectLocationPermission
                    ? connectLocationPermission.canAskAgain
                      ? 'Разрешите VOLNA доступ к геопозиции. Без него нельзя активировать «Я на Коннекте».'
                      : 'Доступ заблокирован. Разрешите геопозицию для VOLNA в настройках устройства или браузера.'
                    : 'Проверяем системное разрешение на геопозицию…'}
              </Text>
              {!connectLocationPermission?.granted && (connectLocationPermission?.canAskAgain || Platform.OS !== 'web') ? (
                <Pressable
                  accessibilityLabel={connectLocationPermission?.canAskAgain ? 'Разрешить доступ к геопозиции' : 'Открыть настройки геопозиции'}
                  accessibilityRole="button"
                  disabled={isRequestingConnectLocation || !connectLocationPermission}
                  onPress={() => void requestConnectLocationPermission()}
                  style={[styles.connectLocationPermissionButton, (isRequestingConnectLocation || !connectLocationPermission) && styles.connectLocationPermissionButtonDisabled]}
                >
                  {isRequestingConnectLocation
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={styles.connectLocationPermissionButtonText}>{connectLocationPermission?.canAskAgain ? 'Разрешить' : 'Открыть настройки'}</Text>}
                </Pressable>
              ) : null}
            </View>
          ) : null}
          <View style={styles.connectOptInBlock}>
            <View style={styles.connectOptInCopy}>
              <Text style={styles.settingsLabel}>Я на Коннекте!</Text>
              <Text style={styles.settingsHint}>
                Другие люди смогут найти вас для знакомств, совместных походов на события и творческих коллабораций.
              </Text>
            </View>
            <VolnaSwitch
              accessibilityLabel="Я на Коннекте!"
              onValueChange={(enabled) => {
                if (enabled && gender !== 'MALE' && gender !== 'FEMALE') {
                  rejectConnectActivation('Чтобы включить Коннект, укажите свой пол в профиле');
                  return;
                }
                if (enabled && !administrativeTarget && !connectLocationPermission?.granted) {
                  rejectConnectActivation('Сначала разрешите VOLNA доступ к геопозиции');
                  return;
                }
                if (enabled && !connectGoals.length) {
                  rejectConnectActivation('Чтобы включить Коннект, выберите хотя бы одну цель взаимодействия');
                  return;
                }
                if (enabled && !connectPhotos.length) {
                  rejectConnectActivation('Чтобы включить Коннект, добавьте хотя бы одну фотографию');
                  return;
                }
                setConnectEnabled(enabled);
              }}
              rejectionAnimationKey={connectSwitchRejectionKey}
              value={connectEnabled}
            />
          </View>

          <Text style={styles.editSectionTitle}>Ссылки</Text>
          <SocialLinkInput
            kind="bandcamp"
            onChangeText={setBandcampUrl}
            placeholder="Bandcamp"
            value={bandcampUrl}
            withSpacing={false}
          />
          <SocialLinkInput kind="soundcloud" onChangeText={setSoundcloudUrl} placeholder="SoundCloud" value={soundcloudUrl} />
          <SocialLinkInput kind="instagram" onChangeText={setInstagramUrl} placeholder="Instagram" value={instagramUrl} />
          <SocialLinkInput kind="threads" onChangeText={setThreadsUrl} placeholder="Threads" value={threadsUrl} />
          <SocialLinkInput kind="telegram" onChangeText={setTelegramUrl} placeholder="Telegram" value={telegramUrl} />
          <SocialLinkInput kind="youtube" onChangeText={setYoutubeUrl} placeholder="YouTube" value={youtubeUrl} />
          <SocialLinkInput kind="letterboxd" onChangeText={setLetterboxdUrl} placeholder="Letterboxd" value={letterboxdUrl} />

          {!administrativeTarget && !profile.isVerified ? <>
          <Text style={styles.editSectionTitle}>Подтверждённый профиль</Text>
          <View style={styles.profileVerificationRequestCard}>
            <Text style={styles.profileVerificationRequestTitle}>Получить галочку</Text>
            <Text style={styles.profileVerificationRequestText}>
              Подтверждённый профиль даёт возможность всему сообществу VOLNA Social видеть ваши публикации в общей ленте.
            </Text>
            <Pressable
              accessibilityLabel="Подать заявку на подтверждение профиля"
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
        </ScrollView>
      </KeyboardAvoidingView>
      <LocationPickerModal
        initialCountryName={countryName}
        isVisible={isLocationPickerOpen}
        onClose={() => setIsLocationPickerOpen(false)}
        onSelect={(location) => {
          setCountryName(location.countryName);
          setCityName(location.cityName);
          setCityId(location.cityId);
          setCountryCode(location.countryCode);
        }}
      />
      <AvatarCropModal
        asset={avatarCropAsset}
        onApply={setAvatarUrl}
        onClose={() => setAvatarCropAsset(null)}
      />
      <AvatarCropModal
        asset={connectPhotoCrop?.asset ?? null}
        cropShape="connect"
        label="Фото Коннекта"
        onApply={(uri) => {
          const index = connectPhotoCrop?.index ?? connectPhotos.length;
          setConnectFaceVerified(false);
          setConnectPhotos((current) => {
            const next = [...current];
            const item = { imageKey: '', imageUrl: uri };
            if (index >= next.length) next.push(item);
            else next[index] = item;
            return next.slice(0, 5);
          });
        }}
        onClose={() => setConnectPhotoCrop(null)}
      />
    </>
  );
}

export function ConnectPhotosEditor({
  about,
  hint = 'До 5 фото. Зажмите фотографию и переместите, чтобы изменить порядок.',
  onAdd,
  onChangeAbout,
  onChange,
  photos,
  title = 'Фото в Коннекте',
}: {
  about: string;
  hint?: string;
  onAdd: (index: number) => void;
  onChangeAbout: (value: string) => void;
  onChange: (photos: ConnectPhoto[]) => void;
  photos: ConnectPhoto[];
  title?: string;
}) {
  return <>
    <View style={[styles.connectPhotosBlock, styles.editSectionFirstCard]}>
      <Text style={styles.connectGoalsTitle}>{title}</Text>
      <Text style={styles.connectPhotosHint}>{hint}</Text>
      <View style={styles.connectPhotosRow}>
        {Array.from({ length: 5 }, (_, index) => {
          const photo = photos[index];
          return photo ? <ReorderableConnectPhoto
            count={photos.length}
            index={index}
            key={photo.imageKey || photo.imageUrl}
            onMove={(from, to) => {
              if (from === to) return;
              const next = [...photos];
              const [moved] = next.splice(from, 1);
              next.splice(to, 0, moved);
              onChange(next);
            }}
            onRemove={() => onChange(photos.filter((_, photoIndex) => photoIndex !== index))}
            photo={photo}
          /> : <Pressable accessibilityLabel={`Добавить фотографию ${index + 1}`} accessibilityRole="button" key={`empty-${index}`} onPress={() => onAdd(index)} style={styles.connectPhotoSlot}>
            <Plus color="#111" size={24} strokeWidth={1.8} />
          </Pressable>;
        })}
      </View>
    </View>
    <View style={[styles.editAboutField, styles.editorBorderlessSurface]}>
      <Text style={styles.editLocationLabel}>О себе</Text>
      <TextInput
        accessibilityLabel="О себе в Коннекте"
        maxLength={300}
        multiline
        onChangeText={onChangeAbout}
        placeholder="Расскажите о себе для карточки Коннекта"
        placeholderTextColor="#8e99a4"
        style={styles.editAboutInput}
        textAlignVertical="top"
        value={about}
      />
    </View>
  </>;
}

const protectedConnectPhotoWebProps = Platform.OS === 'web'
  ? {
      draggable: false,
      onContextMenu: (event: { preventDefault: () => void }) => event.preventDefault(),
    }
  : {};
const protectedConnectPhotoWebStyle = Platform.OS === 'web'
  ? ({
      pointerEvents: 'none',
      userSelect: 'none',
      WebkitUserDrag: 'none',
      WebkitTouchCallout: 'none',
    } as unknown as ImageStyle)
  : undefined;

function ReorderableConnectPhoto({ count, index, onMove, onRemove, photo }: { count: number; index: number; onMove: (from: number, to: number) => void; onRemove: () => void; photo: ConnectPhoto }) {
  const dragX = useRef(new Animated.Value(0)).current;
  const reorderX = useRef(new Animated.Value(0)).current;
  const [isDragging, setIsDragging] = useState(false);
  const slotWidthRef = useRef(0);
  const previousIndexRef = useRef(index);
  const startIndexRef = useRef(index);
  const currentIndexRef = useRef(index);
  const isDragArmedRef = useRef(false);
  const isPanActiveRef = useRef(false);
  const gestureOriginXRef = useRef(0);
  const latestGestureXRef = useRef(0);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearLongPressTimer = () => {
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  };
  const armDrag = () => {
    clearLongPressTimer();
    startIndexRef.current = index;
    currentIndexRef.current = index;
    isDragArmedRef.current = false;
    isPanActiveRef.current = false;
    gestureOriginXRef.current = 0;
    latestGestureXRef.current = 0;
    longPressTimerRef.current = setTimeout(() => {
      isDragArmedRef.current = true;
      gestureOriginXRef.current = latestGestureXRef.current;
      dragX.setValue(0);
      setIsDragging(true);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }, 450);
  };
  const finishUnclaimedTouch = () => {
    clearLongPressTimer();
    if (!isPanActiveRef.current) {
      isDragArmedRef.current = false;
      gestureOriginXRef.current = 0;
      latestGestureXRef.current = 0;
      setIsDragging(false);
    }
  };
  useEffect(() => () => clearLongPressTimer(), []);
  useEffect(() => {
    const previousIndex = previousIndexRef.current;
    previousIndexRef.current = index;
    if (previousIndex === index || isDragging || !slotWidthRef.current) return;
    reorderX.stopAnimation();
    reorderX.setValue((previousIndex - index) * (slotWidthRef.current + 7));
    Animated.spring(reorderX, { damping: 22, mass: 0.65, stiffness: 260, toValue: 0, useNativeDriver: true }).start();
  }, [index, isDragging, reorderX]);
  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, gesture) => {
      latestGestureXRef.current = gesture.dx;
      if (!isDragArmedRef.current && (Math.abs(gesture.dx) > 8 || Math.abs(gesture.dy) > 8)) clearLongPressTimer();
      return isDragArmedRef.current && Math.abs(gesture.dx - gestureOriginXRef.current) > 2;
    },
    onMoveShouldSetPanResponderCapture: (_, gesture) => {
      latestGestureXRef.current = gesture.dx;
      if (!isDragArmedRef.current && (Math.abs(gesture.dx) > 8 || Math.abs(gesture.dy) > 8)) clearLongPressTimer();
      return isDragArmedRef.current && Math.abs(gesture.dx - gestureOriginXRef.current) > 2;
    },
    onPanResponderGrant: (_, gesture) => {
      isPanActiveRef.current = true;
      gestureOriginXRef.current = gesture.dx;
      dragX.setValue(0);
      setIsDragging(true);
    },
    onPanResponderMove: (_, gesture) => {
      latestGestureXRef.current = gesture.dx;
      if (!isDragArmedRef.current) return;
      const effectiveDx = gesture.dx - gestureOriginXRef.current;
      const step = slotWidthRef.current + 7;
      const target = Math.max(0, Math.min(count - 1, startIndexRef.current + Math.round(effectiveDx / Math.max(1, step))));
      if (target !== currentIndexRef.current) {
        const previous = currentIndexRef.current;
        currentIndexRef.current = target;
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        onMove(previous, target);
        void Haptics.selectionAsync();
      }
      dragX.setValue(effectiveDx - (currentIndexRef.current - startIndexRef.current) * step);
    },
    onPanResponderRelease: () => {
      clearLongPressTimer();
      isPanActiveRef.current = false;
      isDragArmedRef.current = false;
      gestureOriginXRef.current = 0;
      latestGestureXRef.current = 0;
      Animated.spring(dragX, { damping: 20, mass: 0.7, stiffness: 260, toValue: 0, useNativeDriver: true }).start(() => setIsDragging(false));
    },
    onPanResponderTerminate: () => {
      clearLongPressTimer();
      isPanActiveRef.current = false;
      isDragArmedRef.current = false;
      gestureOriginXRef.current = 0;
      latestGestureXRef.current = 0;
      Animated.spring(dragX, { damping: 20, stiffness: 260, toValue: 0, useNativeDriver: true }).start(() => setIsDragging(false));
    },
    onPanResponderTerminationRequest: () => false,
  }), [count, dragX, index, onMove]);
  return (
    <Animated.View
      accessibilityLabel={`Зажмите и переместите фотографию ${index + 1}, чтобы изменить порядок`}
      accessibilityRole="adjustable"
      onLayout={(event) => { slotWidthRef.current = event.nativeEvent.layout.width; }}
      onTouchCancel={finishUnclaimedTouch}
      onTouchEnd={finishUnclaimedTouch}
      onTouchStart={armDrag}
      style={[styles.connectPhotoSlot, isDragging && styles.connectPhotoSlotDragging, { transform: [{ translateX: Animated.add(dragX, reorderX) }, { scale: isDragging ? 1.04 : 1 }] }]}
      {...panResponder.panHandlers}
    >
      <View style={styles.connectPhotoPreviewButton}>
        <Image
          {...protectedConnectPhotoWebProps}
          source={{ uri: connectPhotoThumbnail(photo.imageUrl) ?? photo.imageUrl }}
          style={[styles.connectPhotoImage, protectedConnectPhotoWebStyle]}
        />
      </View>
      <Pressable accessibilityLabel="Удалить фотографию" accessibilityRole="button" onPress={onRemove} style={styles.connectPhotoRemove}>
        <X color="#fff" size={13} strokeWidth={2.5} />
      </Pressable>
    </Animated.View>
  );
}

export function AvatarCropModal({
  asset,
  cropShape = 'circle',
  label = 'аватарку',
  onApply,
  onClose,
}: {
  asset: AvatarCropAsset | null;
  cropShape?: 'circle' | 'square' | 'poster' | 'connect' | 'category';
  label?: string;
  onApply: (uri: string) => void;
  onClose: () => void;
}) {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const safeAreaInsets = useSafeAreaInsets();
  const isPoster = cropShape === 'poster';
  const isConnectPhoto = cropShape === 'connect';
  const isCategoryCover = cropShape === 'category';
  const cropWidth = isPoster
    ? Math.min(windowWidth - 72, 300, (windowHeight - 250) / 1.414)
    : isConnectPhoto
      ? Math.min(windowWidth - 72, 320, (windowHeight - 260) * connectPhotoAspectRatio)
      : isCategoryCover
        ? Math.min(windowWidth - 72, 320, (windowHeight - 260) * 3 / 4)
      : Math.min(windowWidth - 48, 320);
  const cropHeight = isPoster ? cropWidth * 1.414 : isConnectPhoto ? cropWidth / connectPhotoAspectRatio : isCategoryCover ? cropWidth * 4 / 3 : cropWidth;
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isApplying, setIsApplying] = useState(false);
  const offsetRef = useRef(offset);
  const zoomRef = useRef(zoom);
  const gestureRef = useRef({
    offset: { x: 0, y: 0 },
    zoom: 1,
    distance: 0,
  });

  useEffect(() => {
    offsetRef.current = offset;
  }, [offset]);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    if (asset) {
      setZoom(1);
      setOffset({ x: 0, y: 0 });
      setIsApplying(false);
    }
  }, [asset?.uri]);

  const getImageLayout = useCallback((nextZoom = zoomRef.current) => {
    if (!asset) {
      return { width: cropWidth, height: cropHeight, scale: 1 };
    }

    const baseScale = Math.max(cropWidth / asset.width, cropHeight / asset.height);
    const scale = baseScale * nextZoom;

    return {
      width: asset.width * scale,
      height: asset.height * scale,
      scale,
    };
  }, [asset, cropHeight, cropWidth]);

  const clampCropOffset = useCallback((nextOffset: { x: number; y: number }, nextZoom = zoomRef.current) => {
    const layout = getImageLayout(nextZoom);
    const maxX = Math.max(0, (layout.width - cropWidth) / 2);
    const maxY = Math.max(0, (layout.height - cropHeight) / 2);

    return {
      x: clamp(nextOffset.x, -maxX, maxX),
      y: clamp(nextOffset.y, -maxY, maxY),
    };
  }, [cropHeight, cropWidth, getImageLayout]);

  const getTouchDistance = (touches: Array<{ pageX: number; pageY: number }>) => {
    if (touches.length < 2) {
      return 0;
    }

    const [first, second] = touches;
    return Math.hypot(first.pageX - second.pageX, first.pageY - second.pageY);
  };

  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: () => Boolean(asset),
    onStartShouldSetPanResponder: () => Boolean(asset),
    onPanResponderGrant: (event) => {
      gestureRef.current = {
        offset: offsetRef.current,
        zoom: zoomRef.current,
        distance: getTouchDistance(event.nativeEvent.touches),
      };
    },
    onPanResponderMove: (event, gestureState) => {
      const touches = event.nativeEvent.touches;

      if (touches.length >= 2) {
        const distance = getTouchDistance(touches);
        const startDistance = gestureRef.current.distance || distance || 1;
        const nextZoom = clamp(gestureRef.current.zoom * (distance / startDistance), 1, 4);
        setZoom(nextZoom);
        setOffset(clampCropOffset(offsetRef.current, nextZoom));
        return;
      }

      setOffset(clampCropOffset({
        x: gestureRef.current.offset.x + gestureState.dx,
        y: gestureRef.current.offset.y + gestureState.dy,
      }));
    },
  }), [asset, clampCropOffset]);

  if (!asset) {
    return null;
  }

  const layout = getImageLayout(zoom);

  const changeZoom = (delta: number) => {
    const nextZoom = clamp(zoom + delta, 1, 4);
    setZoom(nextZoom);
    setOffset((currentOffset) => clampCropOffset(currentOffset, nextZoom));
  };

  const applyCrop = async () => {
    setIsApplying(true);

    try {
      const cropX = clamp(((layout.width - cropWidth) / 2 - offset.x) / layout.scale, 0, asset.width);
      const cropY = clamp(((layout.height - cropHeight) / 2 - offset.y) / layout.scale, 0, asset.height);
      const sourceCropWidth = Math.min(cropWidth / layout.scale, asset.width - cropX);
      const sourceCropHeight = Math.min(cropHeight / layout.scale, asset.height - cropY);
      const result = await manipulateAsync(
        asset.uri,
        [
          {
            crop: {
              originX: Math.round(cropX),
              originY: Math.round(cropY),
              width: Math.max(1, Math.round(sourceCropWidth)),
              height: Math.max(1, Math.round(sourceCropHeight)),
            },
          },
          { resize: isPoster ? { width: 1080, height: 1527 } : isConnectPhoto ? { width: connectPhotoOutputWidth, height: connectPhotoOutputHeight } : isCategoryCover ? { width: 900, height: 1200 } : { width: 900, height: 900 } },
        ],
        {
          base64: false,
          compress: 0.82,
          format: SaveFormat.JPEG,
        },
      );

      onApply(result.uri);
      onClose();
    } catch {
      Alert.alert('Фото', `Не удалось подготовить ${label.toLowerCase()}. Попробуйте другое изображение.`);
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <Modal animationType="fade" transparent visible={Boolean(asset)} onRequestClose={onClose}>
      <View style={styles.avatarCropLayer}>
        <View style={[styles.avatarCropSafeArea, { paddingTop: safeAreaInsets.top + 14, paddingBottom: safeAreaInsets.bottom + 10 }]}>
          <View style={styles.avatarCropHeader}>
            <Pressable disabled={isApplying} onPress={onClose} style={styles.avatarCropHeaderButton}>
              <Text style={styles.avatarCropHeaderText}>Отмена</Text>
            </Pressable>
            <Pressable disabled={isApplying} onPress={applyCrop} style={styles.avatarCropHeaderButton}>
              <Text style={styles.avatarCropHeaderText}>Готово</Text>
            </Pressable>
          </View>

          <View style={styles.avatarCropBody}>
            <View
              style={[styles.avatarCropFrame, { width: cropWidth, height: cropHeight, borderRadius: cropShape === 'circle' ? cropWidth / 2 : isCategoryCover ? 8 : 22 }]}
              {...panResponder.panHandlers}
            >
              <Image
                source={{ uri: asset.uri }}
                style={[
                  styles.avatarCropImage,
                  {
                    width: layout.width,
                    height: layout.height,
                    transform: [{ translateX: offset.x }, { translateY: offset.y }],
                  },
                ]}
                resizeMode="cover"
              />
              <View pointerEvents="none" style={[styles.avatarCropCircle, { borderRadius: cropShape === 'circle' ? cropWidth / 2 : isCategoryCover ? 8 : 22 }]} />
            </View>

            <Text style={styles.avatarCropHint}>Двигайте фото и масштабируйте двумя пальцами</Text>

            <View style={styles.avatarCropZoomRow}>
              <Pressable onPress={() => changeZoom(-0.18)} style={styles.avatarCropZoomButton}>
                <Text style={styles.avatarCropZoomText}>−</Text>
              </Pressable>
              <View style={styles.avatarCropZoomTrack}>
                <View style={[styles.avatarCropZoomFill, { width: `${((zoom - 1) / 3) * 100}%` }]} />
              </View>
              <Pressable onPress={() => changeZoom(0.18)} style={styles.avatarCropZoomButton}>
                <Text style={styles.avatarCropZoomText}>+</Text>
              </Pressable>
            </View>

            {isApplying ? <ActivityIndicator color="#111" style={styles.avatarCropLoader} /> : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}

export type PrimaryExternalTrackCandidate = {
  id: string;
  provider: 'soundcloud' | 'bandcamp' | 'youtube';
  title: string;
  artist: string;
  artworkUrl: string | null;
  externalUrl: string;
  previewUrl: string;
  durationSeconds: number | null;
  previewDurationSeconds: number;
};

function primaryMusicUrlIdentity(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (host === 'youtu.be') {
      const videoId = url.pathname.split('/').filter(Boolean)[0];
      if (/^[\w-]{11}$/.test(videoId ?? '')) return `youtube:${videoId}`;
    }
    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
      const videoId = url.searchParams.get('v') ?? url.pathname.match(/^\/(?:shorts|embed)\/([\w-]{11})/)?.[1];
      if (/^[\w-]{11}$/.test(videoId ?? '')) return `youtube:${videoId}`;
    }
    return `${url.protocol}//${host}${url.pathname.replace(/\/$/, '')}`.toLowerCase();
  } catch {
    return trimmed.toLowerCase();
  }
}

export function PrimaryTrackCatalogSearch({ clipDurationSeconds, durationSeconds, onChangeStart, onDurationChange, onRemove, onSelect, onSelectExternal, playback, provider: selectedProvider, startSeconds }: {
  clipDurationSeconds: number;
  durationSeconds: number | null;
  onChangeStart: (seconds: number) => void;
  onDurationChange: (seconds: number) => void;
  onRemove: () => void;
  onSelect: (track: AppleMusicTrack) => void;
  onSelectExternal: (track: PrimaryExternalTrackCandidate) => void;
  playback: { artist: string | null; artworkUrl: string | null; externalUrl: string | null; previewUrl: string | null; title: string | null } | null;
  provider: 'apple' | 'yandex' | 'soundcloud' | 'bandcamp' | 'youtube' | 'uploaded';
  startSeconds: number;
}) {
  const safeAreaInsets = useSafeAreaInsets();
  const [inputMode, setInputMode] = useState<'search' | 'link'>('search');
  const [provider, setProvider] = useState<'apple' | 'yandex'>('apple');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AppleMusicTrack[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [externalUrl, setExternalUrl] = useState('');
  const [isResolvingExternal, setIsResolvingExternal] = useState(false);
  const [externalError, setExternalError] = useState<string | null>(null);
  const [externalTracks, setExternalTracks] = useState<PrimaryExternalTrackCandidate[]>([]);
  const [isExternalExpanded, setIsExternalExpanded] = useState(false);
  const [resolvedExternalUrl, setResolvedExternalUrl] = useState<string | null>(null);
  const externalResolveRequestRef = useRef(0);
  const externalUrlRef = useRef(externalUrl);
  externalUrlRef.current = externalUrl;
  const externalUrlIdentity = primaryMusicUrlIdentity(externalUrl);
  const isExternalUrlResolved = Boolean(externalUrlIdentity && (
    primaryMusicUrlIdentity(resolvedExternalUrl) === externalUrlIdentity
    || primaryMusicUrlIdentity(playback?.externalUrl) === externalUrlIdentity
  ));

  useEffect(() => {
    const term = query.trim();
    if (inputMode !== 'search' || term.length < 2) {
      setResults([]);
      setSearchError(null);
      setIsSearching(false);
      return;
    }
    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      setIsSearching(true);
      setSearchError(null);
      try {
        const response = await fetch(`${apiUrl}/music/${provider}/search?q=${encodeURIComponent(term)}`, { signal: controller.signal });
        const data = await response.json() as { message?: string; tracks?: Array<Record<string, unknown>> };
        if (!response.ok) throw new Error(data.message || 'Не удалось найти треки');
        const catalogTracks = data.tracks as unknown as AppleMusicTrack[];
        setResults(catalogTracks);
        if (!catalogTracks.length) setSearchError('Ничего не найдено');
      } catch (error) {
        if (!controller.signal.aborted) {
          setResults([]);
          setSearchError(error instanceof Error ? error.message : 'Не удалось найти треки');
        }
      } finally {
        if (!controller.signal.aborted) setIsSearching(false);
      }
    }, remoteSearchDebounceMs);
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [inputMode, provider, query]);

  useEffect(() => {
    if (!isSearchOpen || selectedProvider !== 'youtube' || !playback?.externalUrl) return;
    const controller = new AbortController();
    void fetch(`${apiUrl}/music/resolve?url=${encodeURIComponent(playback.externalUrl)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return null;
        return response.json() as Promise<{ kind?: string; track?: { durationSeconds?: number | null } }>;
      })
      .then((resolved) => {
        const seconds = resolved?.track?.durationSeconds;
        if (resolved?.kind === 'track' && Number.isFinite(seconds) && Number(seconds) > 0) onDurationChange(Number(seconds));
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [isSearchOpen, onDurationChange, playback?.externalUrl, selectedProvider]);

  const selectTrack = (track: AppleMusicTrack) => {
    onSelect(track);
    setQuery('');
    setResults([]);
  };

  const closeSearch = () => {
    Keyboard.dismiss();
    setIsSearchOpen(false);
    setQuery('');
    setResults([]);
    setExternalUrl('');
    setExternalError(null);
    setExternalTracks([]);
    setIsExternalExpanded(false);
    setResolvedExternalUrl(null);
  };

  const resolveExternalTrack = async (valueOverride?: string) => {
    const value = (valueOverride ?? externalUrlRef.current).trim();
    if (!value) return;
    const requestId = externalResolveRequestRef.current + 1;
    externalResolveRequestRef.current = requestId;
    const isCurrentRequest = () => externalResolveRequestRef.current === requestId && externalUrlRef.current.trim() === value;
    setIsResolvingExternal(true);
    setExternalError(null);
    setResolvedExternalUrl(null);
    try {
      const parsed = new URL(value);
      const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
      let candidates: PrimaryExternalTrackCandidate[] = [];
      if (host === 'soundcloud.com' || host === 'm.soundcloud.com' || host === 'on.soundcloud.com') {
        const response = await fetch(`${apiUrl}/music/soundcloud/release?url=${encodeURIComponent(value)}`);
        if (!response.ok) throw new Error(await readApiError(response, 'Не удалось загрузить SoundCloud'));
        const release = await response.json() as { tracks?: Array<{ id: string; title: string; artist: string; artworkUrl: string | null; externalUrl: string; durationSeconds: number | null }> };
        candidates = (release.tracks ?? []).map((track) => ({
          ...track,
          provider: 'soundcloud' as const,
          previewUrl: `/music/soundcloud/stream?url=${encodeURIComponent(track.externalUrl)}`,
          previewDurationSeconds: track.durationSeconds ?? 30,
        }));
      } else if (host === 'bandcamp.com' || host.endsWith('.bandcamp.com')) {
        const release = await getBandcampRelease(value);
        const normalizedInput = value.replace(/\/$/, '').toLowerCase();
        const requestedTrack = release.tracks.find((track) => track.externalUrl.replace(/\/$/, '').toLowerCase() === normalizedInput);
        candidates = (requestedTrack ? [requestedTrack] : release.tracks).map((track) => ({
          ...track,
          provider: 'bandcamp' as const,
          artworkUrl: track.artworkUrl ?? release.artworkUrl,
          previewUrl: bandcampPlaybackUrl(release.externalUrl, track.id),
          previewDurationSeconds: track.durationSeconds ?? 30,
        }));
      } else {
        const response = await fetch(`${apiUrl}/music/resolve?url=${encodeURIComponent(value)}`);
        if (!response.ok) throw new Error(await readApiError(response, 'Не удалось определить музыкальную ссылку'));
        const resolved = await response.json() as { kind: string; track?: AppleMusicTrack };
        if (resolved.kind !== 'track' || !resolved.track) throw new Error('Этот музыкальный сервис пока не поддерживается');
        if (!isCurrentRequest()) return;
        onSelect(resolved.track);
        setResolvedExternalUrl(value);
        setExternalTracks([]);
        setIsExternalExpanded(false);
        return;
      }
      if (!candidates.length) throw new Error('В релизе нет доступных треков');
      if (!isCurrentRequest()) return;
      setExternalTracks(candidates);
      setResolvedExternalUrl(value);
      setIsExternalExpanded(true);
      if (candidates.length === 1) onSelectExternal(candidates[0]);
    } catch (error) {
      if (isCurrentRequest()) setExternalError(error instanceof Error ? error.message : 'Не удалось определить трек');
    } finally {
      if (isCurrentRequest()) setIsResolvingExternal(false);
    }
  };

  useEffect(() => {
    const value = externalUrl.trim();
    if (inputMode !== 'link' || !value) {
      externalResolveRequestRef.current += 1;
      setIsResolvingExternal(false);
      return;
    }
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        externalResolveRequestRef.current += 1;
        setIsResolvingExternal(false);
        return;
      }
    } catch {
      externalResolveRequestRef.current += 1;
      setIsResolvingExternal(false);
      return;
    }
    const timeout = setTimeout(() => { void resolveExternalTrack(value); }, 500);
    return () => clearTimeout(timeout);
  }, [externalUrl, inputMode]);

  return <>
    {playback ? <Pressable accessibilityLabel="Редактировать трек профиля" accessibilityRole="button" hitSlop={8} onPress={() => setIsSearchOpen(true)} style={styles.primaryTrackEditButton}><Pencil color="#6f7b86" size={19} strokeWidth={1.9} /></Pressable> : <Pressable accessibilityLabel="Выбрать трек профиля" accessibilityRole="button" onPress={() => setIsSearchOpen(true)} style={styles.primaryTrackEmptyButton}><Disc3 color="#111" size={18} strokeWidth={1.9} /><Text style={styles.primaryTrackEmptyButtonText}>Выбрать трек профиля</Text></Pressable>}
    <Modal animationType="slide" onRequestClose={closeSearch} presentationStyle="fullScreen" visible={isSearchOpen}>
      <View style={[styles.primaryTrackSearchScreen, { paddingTop: safeAreaInsets.top, paddingBottom: safeAreaInsets.bottom }]}>
        <View style={styles.primaryTrackSearchHeader}>
          <Pressable accessibilityRole="button" onPress={closeSearch} style={styles.primaryTrackSearchCancel}><Text style={styles.primaryTrackSearchCancelText}>Готово</Text></Pressable>
          <Text style={styles.primaryTrackSearchTitle}>Главный трек</Text>
          <View style={styles.primaryTrackSearchHeaderSpacer} />
        </View>
        <View accessibilityRole="tablist" style={styles.primaryTrackModeTabs}>{([{ value: 'search', label: 'Поиск по названию' }, { value: 'link', label: 'Ссылка' }] as const).map((tab) => { const active = inputMode === tab.value; return <Pressable accessibilityRole="tab" accessibilityState={{ selected: active }} key={tab.value} onPress={() => { setInputMode(tab.value); setSearchError(null); setExternalError(null); Keyboard.dismiss(); }} style={styles.primaryTrackModeTab}><Text style={[styles.primaryTrackModeTabText, active && styles.primaryTrackModeTabTextActive]}>{tab.label}</Text>{active ? <View pointerEvents="none" style={styles.activeTabIndicator} /> : null}</Pressable>; })}</View>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.primaryTrackSearchKeyboardView}>
          <View style={styles.primaryTrackSearchControls}>
            {inputMode === 'search' ? <><AnimatedSegmentedControl accessibilityLabel="Музыкальный сервис" containerStyle={styles.primaryTrackProviderSwitch} onChange={(value) => { setProvider(value); setQuery(''); setResults([]); }} options={([{ value: 'apple', label: 'Apple Music' }, { value: 'yandex', label: 'Я.Музыка' }] as const)} value={provider} /><View style={styles.primaryTrackInputGroup}><View style={styles.primaryTrackSearchInputRow}><Search color="#6f7b86" size={19} strokeWidth={1.9} /><TextInput autoCapitalize="none" autoCorrect={false} autoFocus onChangeText={setQuery} placeholder="Название трека или исполнитель" placeholderTextColor="#8e99a4" returnKeyType="search" style={styles.primaryTrackSearchInput} value={query} /></View><Text style={styles.primaryTrackInputHint}>Поиск по каталогу выбранного музыкального сервиса.</Text></View></> : <View style={styles.primaryTrackInputGroup}><View style={styles.primaryTrackExternalInputRow}><Link2 color="#6f7b86" size={19} strokeWidth={1.9} /><TextInput autoCapitalize="none" autoCorrect={false} autoFocus keyboardType="url" onChangeText={(value) => { setExternalUrl(value); setExternalError(null); setExternalTracks([]); setIsExternalExpanded(false); setResolvedExternalUrl(null); }} onSubmitEditing={() => void resolveExternalTrack()} placeholder="Ссылка на музыку" placeholderTextColor="#8e99a4" returnKeyType="done" style={styles.primaryTrackSearchInput} value={externalUrl} /><Pressable accessibilityLabel={isExternalUrlResolved ? 'Музыкальная ссылка подтверждена' : 'Проверить музыкальную ссылку'} accessibilityRole="button" accessibilityState={{ disabled: !externalUrl.trim() || isResolvingExternal }} disabled={!externalUrl.trim() || isResolvingExternal} onPress={() => externalTracks.length ? setIsExternalExpanded((current) => !current) : void resolveExternalTrack()} style={[styles.primaryTrackExternalAdd, isExternalUrlResolved && styles.primaryTrackExternalAddActive, (!externalUrl.trim() || isResolvingExternal) && styles.primaryTrackExternalAddDisabled]}>{isResolvingExternal ? <ActivityIndicator color="#fff" size="small" /> : <ChevronDown color={isExternalUrlResolved ? '#111' : '#fff'} size={20} strokeWidth={2.2} style={{ transform: [{ rotate: isExternalExpanded ? '180deg' : '0deg' }] }} />}</Pressable></View><Text style={styles.primaryTrackInputHint}>Поддерживаются ссылки Apple Music, Яндекс Музыки, SoundCloud, Bandcamp и YouTube.</Text></View>}
            {externalError ? <Text style={styles.primaryTrackExternalError}>{externalError}</Text> : null}
          </View>
          <ScrollView contentContainerStyle={styles.primaryTrackSearchResults} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" onScrollBeginDrag={() => Keyboard.dismiss()} showsHorizontalScrollIndicator={false} showsVerticalScrollIndicator={false}>
            {isExternalExpanded && externalTracks.length ? <View style={styles.primaryTrackExternalList}>{externalTracks.map((track, index) => {
              const selected = selectedProvider === track.provider && playback?.externalUrl === track.externalUrl;
              return <Pressable accessibilityRole="radio" accessibilityState={{ checked: selected }} key={`${track.provider}:${track.id}`} onPress={() => onSelectExternal(track)} style={styles.primaryTrackExternalTrackRow}>
                {track.artworkUrl ? <Image source={{ uri: track.artworkUrl }} style={styles.primaryTrackExternalArtwork} /> : <View style={styles.primaryTrackExternalArtworkPlaceholder}><Disc3 color="#6f7b86" size={18} /></View>}
                <Text style={styles.primaryTrackExternalIndex}>{index + 1}</Text>
                <View style={styles.primaryTrackExternalTrackCopy}><Text numberOfLines={1} style={styles.primaryTrackExternalTrackTitle}>{track.title}</Text><Text numberOfLines={1} style={styles.primaryTrackExternalTrackArtist}>{track.artist}</Text></View>
                <View style={[styles.primaryTrackExternalRadio, selected && styles.primaryTrackExternalRadioSelected]}>{selected ? <Check color="#fff" size={14} strokeWidth={2.5} /> : null}</View>
              </Pressable>;
            })}</View> : null}
            <AppleMusicSearchResults error={searchError} isSearching={isSearching} onSelect={selectTrack} results={results} />
            {playback ? <View style={styles.primaryTrackRangeEditor}>
              <View style={styles.primaryTrackRangeSelectedTrack}><PrimaryTrackEditorPreview artist={playback.artist} artworkUrl={playback.artworkUrl} clipDurationSeconds={clipDurationSeconds} durationSeconds={durationSeconds} onStartSecondsChange={onChangeStart} previewUrl={playback.previewUrl ?? ''} provider={selectedProvider === 'uploaded' ? 'volna' : selectedProvider} startSeconds={startSeconds} title={playback.title ?? ''} /></View>
            </View> : null}
            {playback ? <View style={styles.primaryTrackRemoveSection}><Pressable accessibilityRole="button" onPress={() => { onRemove(); closeSearch(); }} style={styles.primaryTrackRemoveButton}><Text style={styles.primaryTrackRemoveText}>Убрать трек из профиля</Text></Pressable></View> : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  </>;
}

export function AppleMusicSelector({
  allowPrimarySelection = true,
  onChange,
  onNotify,
  surface = 'plain',
  tracks,
}: {
  allowPrimarySelection?: boolean;
  onChange: (tracks: ProfileMusicTrack[]) => void;
  onNotify: (message: string, type?: ToastMessage['type']) => void;
  surface?: 'plain' | 'filled';
  tracks: ProfileMusicTrack[];
}) {
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editorTrackKey, setEditorTrackKey] = useState<string | null>(null);
  const [provider, setProvider] = useState<ProfileMusicTrack['provider']>('apple');
  const [isProviderMenuOpen, setIsProviderMenuOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AppleMusicTrack[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isResolvingExternal, setIsResolvingExternal] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const editorTrack = tracks.find((track) => `${track.provider}:${track.id}` === editorTrackKey) ?? null;
  const selectedTrack: AppleMusicTrack | null = editorTrack && (editorTrack.provider === 'apple' || editorTrack.provider === 'yandex') ? {
    id: editorTrack.id,
    title: editorTrack.title,
    artist: editorTrack.artist,
    album: '',
    artworkUrl: editorTrack.artworkUrl,
    previewUrl: editorTrack.previewUrl,
    externalUrl: editorTrack.externalUrl,
    provider: editorTrack.provider,
    durationSeconds: editorTrack.durationSeconds,
    previewDurationSeconds: editorTrack.previewDurationSeconds,
  } : null;

  useEffect(() => {
    const term = query.trim();

    if (provider === 'soundcloud' || provider === 'bandcamp' || provider === 'youtube') {
      setResults([]);
      setSearchError(null);
      setIsSearching(false);
      return;
    }

    if (term.length < 2) {
      setResults([]);
      setSearchError(null);
      setIsSearching(false);
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      setIsSearching(true);
      setSearchError(null);

      try {
        const response = await fetch(`${apiUrl}/music/${provider}/search?q=${encodeURIComponent(term)}`, {
          signal: controller.signal,
        });
        const data = (await response.json()) as { message?: string; tracks?: AppleMusicTrack[] };

        if (!response.ok) {
          throw new Error(data.message || 'Не удалось найти треки');
        }

        setResults(data.tracks ?? []);
      } catch (error) {
        if (!controller.signal.aborted) {
          setResults([]);
          setSearchError(error instanceof Error ? error.message : 'Не удалось найти треки');
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsSearching(false);
        }
      }
    }, remoteSearchDebounceMs);

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [provider, query]);

  const toProfileTrack = (track: AppleMusicTrack, isPrimary: boolean): ProfileMusicTrack => {
    const previewDurationSeconds = Number.isFinite(track.previewDurationSeconds) ? track.previewDurationSeconds : 30;
    return {
      id: track.id,
      provider: track.provider,
      title: track.title,
      artist: track.artist,
      artworkUrl: track.artworkUrl,
      previewUrl: track.previewUrl,
      externalUrl: track.externalUrl,
      startSeconds: 0,
      clipDurationSeconds: Math.min(30, previewDurationSeconds),
      durationSeconds: Number.isFinite(track.durationSeconds) ? track.durationSeconds : null,
      previewDurationSeconds,
      isPrimary,
    };
  };

  const addTrack = (track: AppleMusicTrack) => {
    const key = `${track.provider}:${track.id}`;
    if (tracks.some((item) => `${item.provider}:${item.id}` === key)) {
      onNotify('Этот трек уже добавлен', 'error');
      return;
    }
    const next = [...tracks, toProfileTrack(track, !tracks.some((item) => item.isPrimary))];
    onChange(next);
    setEditorTrackKey(key);
    setQuery('');
    setResults([]);
    setIsEditorOpen(true);
  };

  const resolveExternalTrack = async (trackProvider: 'soundcloud' | 'bandcamp' | 'youtube', externalUrl: string): Promise<Partial<ProfileMusicTrack>> => {
    if (trackProvider === 'youtube') {
      const response = await fetch(`${apiUrl}/music/resolve?url=${encodeURIComponent(externalUrl)}`);
      const data = await response.json() as { message?: string; kind?: string; track?: AppleMusicTrack };
      if (!response.ok || data.kind !== 'track' || !data.track) throw new Error(data.message || 'Не удалось получить данные YouTube');
      return { ...data.track, externalUrl: data.track.externalUrl, previewUrl: data.track.previewUrl };
    }
    const endpoint = trackProvider === 'soundcloud' ? 'soundcloud/track' : 'bandcamp/release';
    const response = await fetch(`${apiUrl}/music/${endpoint}?url=${encodeURIComponent(externalUrl)}`);
    const data = await response.json() as { message?: string; title?: string; artist?: string; artworkUrl?: string | null; externalUrl?: string; url?: string; embedUrl?: string; entityType?: 'track' | 'album' };
    if (!response.ok || !data.title || !data.artist) throw new Error(data.message || 'Не удалось получить данные релиза');
    return { title: data.title, artist: data.artist, artworkUrl: data.artworkUrl ?? null, externalUrl: data.externalUrl || data.url || externalUrl, embedUrl: data.embedUrl, entityType: data.entityType };
  };

  useEffect(() => {
    const stale = tracks.filter((track) =>
      (track.provider === 'soundcloud' && track.title === 'SoundCloud')
      || (track.provider === 'bandcamp' && track.title === 'Bandcamp'));
    if (!stale.length) return;
    let cancelled = false;
    void Promise.all(stale.map(async (track) => ({ key: `${track.provider}:${track.id}`, changes: await resolveExternalTrack(track.provider as 'soundcloud' | 'bandcamp', track.externalUrl) })))
      .then((resolved) => {
        if (cancelled) return;
        const changes = new Map(resolved.map((item) => [item.key, item.changes]));
        onChange(tracks.map((track) => ({ ...track, ...(changes.get(`${track.provider}:${track.id}`) ?? {}) })));
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [tracks, onChange]);

  const addExternalTrack = async () => {
    const rawUrl = query.trim();
    const normalized = provider === 'soundcloud'
      ? normalizeSocialLink(rawUrl, 'soundcloud')
      : provider === 'bandcamp' ? normalizeBandcampEmbedInput(rawUrl) : { url: rawUrl, error: /^https?:\/\//i.test(rawUrl) ? null : 'invalid' };
    if (normalized.error || !normalized.url) {
      onNotify(provider === 'soundcloud' ? 'Укажите корректную ссылку SoundCloud' : provider === 'bandcamp' ? 'Укажите корректную ссылку Bandcamp' : 'Укажите корректную ссылку YouTube', 'error');
      return;
    }
    const externalUrl = normalized.url;
    if (tracks.some((track) => track.provider === provider && track.externalUrl.toLowerCase() === externalUrl.toLowerCase())) {
      onNotify('Эта ссылка уже добавлена', 'error');
      return;
    }
    setIsResolvingExternal(true);
    try {
      const metadata = await resolveExternalTrack(provider as 'soundcloud' | 'bandcamp' | 'youtube', externalUrl);
      onChange([...tracks, {
      id: `external-${provider}-${Date.now()}`,
      provider,
      title: metadata.title ?? 'Без названия',
      artist: metadata.artist ?? '',
      artworkUrl: metadata.artworkUrl ?? null,
      previewUrl: externalUrl,
      externalUrl: metadata.externalUrl ?? externalUrl,
      startSeconds: 0,
      clipDurationSeconds: 30,
      durationSeconds: null,
      previewDurationSeconds: 30,
      isPrimary: !tracks.some((item) => item.isPrimary),
      embedUrl: metadata.embedUrl ?? null,
      entityType: metadata.entityType ?? null,
      }]);
      setQuery('');
    } catch (error) {
      onNotify(error instanceof Error ? error.message : 'Не удалось получить данные релиза', 'error');
    } finally {
      setIsResolvingExternal(false);
    }
  };

  const replaceEditorTrack = (track: AppleMusicTrack) => {
    if (!editorTrack) return addTrack(track);
    const nextKey = `${track.provider}:${track.id}`;
    if (tracks.some((item) => `${item.provider}:${item.id}` === nextKey && `${item.provider}:${item.id}` !== editorTrackKey)) {
      onNotify('Этот трек уже добавлен', 'error');
      return;
    }
    onChange(tracks.map((item) => `${item.provider}:${item.id}` === editorTrackKey ? toProfileTrack(track, item.isPrimary) : item));
    setEditorTrackKey(nextKey);
    setQuery('');
    setResults([]);
  };

  const removeTrack = (key: string) => {
    const removed = tracks.find((track) => `${track.provider}:${track.id}` === key);
    const remaining = tracks.filter((track) => `${track.provider}:${track.id}` !== key);
    const nextPrimary = remaining[0];
    onChange(removed?.isPrimary && nextPrimary
      ? remaining.map((track) => ({ ...track, isPrimary: track === nextPrimary }))
      : remaining);
    if (key === editorTrackKey) {
      setIsEditorOpen(false);
      setEditorTrackKey(null);
    }
  };

  const makePrimary = (key: string) => onChange(tracks.map((track) => ({
    ...track,
    isPrimary: `${track.provider}:${track.id}` === key,
  })));

  const moveTrack = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    const next = [...tracks];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    onChange(next);
  };

  return (
    <View style={[styles.appleMusicBox, isProviderMenuOpen && styles.appleMusicBoxMenuOpen]}>
      <View style={styles.musicCollectionHeader}>
        <Text style={styles.musicCollectionTitle}>Треки</Text>
        <Text style={styles.musicCollectionCount}>{tracks.length}</Text>
      </View>
      {tracks.map((track, index) => {
        const key = `${track.provider}:${track.id}`;
        return (
          <ReorderableMusicTrackRow
            count={tracks.length}
            filled={surface === 'filled'}
            index={index}
            key={key}
            showPrimaryAction={allowPrimarySelection}
            onMakePrimary={() => makePrimary(key)}
            onMove={moveTrack}
            onOpen={() => {
              if (track.provider === 'soundcloud' || track.provider === 'bandcamp' || track.provider === 'youtube') {
                void openExternalHttpsUrl(track.externalUrl);
                return;
              }
              setEditorTrackKey(key);
              setProvider(track.provider);
              setIsEditorOpen(true);
            }}
            onRemove={() => removeTrack(key)}
            track={track}
          />
        );
      })}

      <>
          <View style={[styles.musicSearchBox, surface === 'filled' && styles.musicSearchBoxFilled]}>
            {provider === 'apple' || provider === 'yandex' ? <Search color="#8e99a4" size={19} strokeWidth={1.9} /> : <Link2 color="#8e99a4" size={19} strokeWidth={1.9} />}
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setQuery}
              onSubmitEditing={provider === 'soundcloud' || provider === 'bandcamp' || provider === 'youtube' ? () => void addExternalTrack() : undefined}
              placeholder={provider === 'soundcloud' ? 'Ссылка SoundCloud' : provider === 'bandcamp' ? 'Ссылка Bandcamp' : provider === 'youtube' ? 'Ссылка YouTube' : 'Название трека'}
              placeholderTextColor="#8e99a4"
              style={styles.musicSearchInput}
              value={query}
            />
            <Pressable
              accessibilityLabel="Выбрать музыкальный сервис"
              accessibilityRole="button"
              onPress={() => setIsProviderMenuOpen((value) => !value)}
              style={styles.musicSearchProviderButton}
            >
              <Text numberOfLines={1} style={styles.musicSearchProviderText}>{provider === 'apple' ? 'Apple' : provider === 'yandex' ? 'Яндекс' : provider === 'soundcloud' ? 'SoundCloud' : provider === 'bandcamp' ? 'Bandcamp' : 'YouTube'}</Text>
              <ChevronDown color="#606c78" size={15} strokeWidth={2.2} />
            </Pressable>
          </View>

          {(provider === 'soundcloud' || provider === 'bandcamp' || provider === 'youtube') && query.trim() ? (
            <Pressable disabled={isResolvingExternal} onPress={() => void addExternalTrack()} style={[styles.yandexPrimaryButton, styles.musicAddLinkButton]}>
              {isResolvingExternal ? <ActivityIndicator color="#fff" /> : <Text style={styles.yandexPrimaryButtonText}>Добавить ссылку</Text>}
            </Pressable>
          ) : null}

          {provider === 'apple' || provider === 'yandex' ? <AppleMusicSearchResults
            error={searchError}
            isSearching={isSearching}
            onSelect={addTrack}
            results={results}
          /> : null}
      </>

      <AppleMusicEditorModal
        clipDurationSeconds={editorTrack?.clipDurationSeconds ?? 30}
        isVisible={isEditorOpen}
        onChangeQuery={setQuery}
        onClear={() => { if (editorTrackKey) removeTrack(editorTrackKey); }}
        onClose={() => { setIsEditorOpen(false); setEditorTrackKey(null); setQuery(''); setResults([]); }}
        onSelect={replaceEditorTrack}
        query={query}
        searchError={searchError}
        isSearching={isSearching}
        results={results}
        selectedTrack={selectedTrack}
        startSeconds={editorTrack?.startSeconds ?? 0}
        provider={provider === 'yandex' ? 'yandex' : 'apple'}
      />
      <AppSheetModal isVisible={isProviderMenuOpen} onClose={() => setIsProviderMenuOpen(false)} title="Музыкальный сервис">
        {(['apple', 'yandex', 'soundcloud', 'bandcamp', 'youtube'] as const).map((item) => {
          const isSelected = provider === item;
          return <Pressable accessibilityRole="button" accessibilityState={{ selected: isSelected }} key={item} onPress={() => { setProvider(item); setQuery(''); setResults([]); setIsProviderMenuOpen(false); }} style={[styles.musicProviderSheetOption, isSelected && styles.musicProviderSheetOptionActive]}><Text style={[styles.musicProviderSheetText, isSelected && styles.musicProviderSheetTextActive]}>{item === 'apple' ? 'Apple Music' : item === 'yandex' ? 'Яндекс Музыка' : item === 'soundcloud' ? 'SoundCloud' : item === 'bandcamp' ? 'Bandcamp' : 'YouTube'}</Text>{isSelected ? <Check color="#fff" size={19} strokeWidth={2.2} /> : null}</Pressable>;
        })}
      </AppSheetModal>
    </View>
  );
}

function AppleMusicSearchResults({
  error,
  isSearching,
  onSelect,
  results,
}: {
  error: string | null;
  isSearching: boolean;
  onSelect: (track: AppleMusicTrack) => void;
  results: AppleMusicTrack[];
}) {
  return (
    <>
      {isSearching ? (
        <View style={styles.appleMusicSearchState}>
          <ActivityIndicator color="#111" />
        </View>
      ) : null}
      {error ? <Text style={styles.appleMusicError}>{error}</Text> : null}
      {results.length ? (
        <View style={styles.appleMusicResults}>
          {results.map((track) => (
            <Pressable key={`${track.provider}:${track.id}`} onPress={() => onSelect(track)} style={styles.appleMusicResultRow}>
              {track.artworkUrl ? (
                <Image source={{ uri: musicArtworkThumbnail(track.artworkUrl, track.provider) ?? track.artworkUrl }} style={styles.appleMusicArtwork} />
              ) : (
                <View style={[styles.appleMusicArtwork, styles.appleMusicArtworkPlaceholder]}>
                  <Disc3 color="#6f7b86" size={20} strokeWidth={2} />
                </View>
              )}
              <View style={styles.appleMusicResultCopy}>
                <Text numberOfLines={1} style={styles.appleMusicResultTitle}>{track.title}</Text>
                <Text numberOfLines={1} style={styles.appleMusicResultArtist}>{track.artist}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}
    </>
  );
}

function AppleMusicEditorModal({
  clipDurationSeconds,
  isSearching,
  isVisible,
  onChangeQuery,
  onClear,
  onClose,
  onSelect,
  query,
  results,
  searchError,
  selectedTrack,
  startSeconds,
  provider,
}: {
  clipDurationSeconds: number;
  isSearching: boolean;
  isVisible: boolean;
  onChangeQuery: (value: string) => void;
  onClear: () => void;
  onClose: () => void;
  onSelect: (track: AppleMusicTrack) => void;
  query: string;
  results: AppleMusicTrack[];
  searchError: string | null;
  selectedTrack: AppleMusicTrack | null;
  startSeconds: number;
  provider: 'apple' | 'yandex';
}) {
  const previewPlayerRef = useRef<TrackPlayerController>(null);

  const stopPreview = () => {
    previewPlayerRef.current?.pause();
  };

  const closeEditor = () => {
    stopPreview();
    onClose();
  };

  const clearTrack = () => {
    stopPreview();
    onClear();
  };

  const selectTrack = (track: AppleMusicTrack) => {
    stopPreview();
    onSelect(track);
  };

  return (
    <AppSheetModal isVisible={isVisible} onClose={closeEditor} title={provider === 'apple' ? 'Apple Music' : 'Яндекс Музыка'}>
          {selectedTrack ? (
            <View style={[styles.selectedTrackBox, styles.appleMusicEditorSelectedTrack]}>
              <TrackPlayerPill
                artist={selectedTrack.artist}
                artworkUrl={selectedTrack.artworkUrl}
                clipDurationSeconds={clipDurationSeconds}
                externalUrl={selectedTrack.externalUrl}
                previewUrl={selectedTrack.previewUrl}
                ref={previewPlayerRef}
                startSeconds={startSeconds}
                title={selectedTrack.title}
                variant="editor"
              />
              <Pressable onPress={clearTrack} style={styles.selectedTrackClear}>
                <X color="#6f7b86" size={18} strokeWidth={2.2} />
              </Pressable>
            </View>
          ) : null}

          <View style={styles.countrySearchField}>
            <Search color="#98a3ae" size={19} strokeWidth={1.9} />
            <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={onChangeQuery}
            placeholder={`Найти другой трек ${provider === 'apple' ? 'Apple Music' : 'Яндекс Музыки'}`}
            placeholderTextColor="#8e99a4"
            style={styles.editInput}
            value={query}
            />
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <AppleMusicSearchResults
              error={searchError}
              isSearching={isSearching}
              onSelect={selectTrack}
              results={results}
            />
          </ScrollView>
    </AppSheetModal>
  );
}

function ReorderableMusicTrackRow({
  count,
  filled,
  index,
  onMakePrimary,
  onMove,
  onOpen,
  onRemove,
  showPrimaryAction,
  track,
}: {
  count: number;
  filled: boolean;
  index: number;
  onMakePrimary: () => void;
  onMove: (fromIndex: number, toIndex: number) => void;
  onOpen: () => void;
  onRemove: () => void;
  showPrimaryAction: boolean;
  track: ProfileMusicTrack;
}) {
  const dragY = useRef(new Animated.Value(0)).current;
  const [isDragging, setIsDragging] = useState(false);
  const isDragArmed = useRef(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rowStep = 66;
  const clearLongPressTimer = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
  };
  const armDrag = () => {
    clearLongPressTimer();
    longPressTimer.current = setTimeout(() => {
      isDragArmed.current = true;
      setIsDragging(true);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }, 1000);
  };
  useEffect(() => () => clearLongPressTimer(), []);
  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onStartShouldSetPanResponderCapture: () => {
      armDrag();
      return false;
    },
    onMoveShouldSetPanResponder: (_, gesture) => {
      if (!isDragArmed.current && Math.abs(gesture.dy) > 8) clearLongPressTimer();
      return isDragArmed.current && Math.abs(gesture.dy) > 2;
    },
    onMoveShouldSetPanResponderCapture: (_, gesture) => {
      if (!isDragArmed.current && Math.abs(gesture.dy) > 8) clearLongPressTimer();
      return isDragArmed.current && Math.abs(gesture.dy) > 2;
    },
    onPanResponderGrant: () => {
      clearLongPressTimer();
      setIsDragging(true);
    },
    onPanResponderMove: (_, gesture) => {
      dragY.setValue(gesture.dy);
    },
    onPanResponderRelease: (_, gesture) => {
      const targetIndex = Math.max(0, Math.min(count - 1, index + Math.round(gesture.dy / rowStep)));
      isDragArmed.current = false;
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      Animated.spring(dragY, { damping: 20, mass: 0.7, stiffness: 260, toValue: 0, useNativeDriver: true }).start(() => setIsDragging(false));
      if (targetIndex !== index) {
        void Haptics.selectionAsync();
        onMove(index, targetIndex);
      }
    },
    onPanResponderTerminate: () => {
      clearLongPressTimer();
      isDragArmed.current = false;
      Animated.spring(dragY, { damping: 20, stiffness: 260, toValue: 0, useNativeDriver: true }).start(() => setIsDragging(false));
    },
    onPanResponderTerminationRequest: () => false,
  }), [count, dragY, index, onMove]);

  return (
    <Animated.View
      onTouchEnd={clearLongPressTimer}
      onTouchCancel={clearLongPressTimer}
      {...panResponder.panHandlers}
      style={[
      styles.musicCollectionRow,
      filled && styles.musicCollectionRowFilled,
      isDragging && styles.musicCollectionRowDragging,
      { transform: [{ translateY: dragY }, { scale: isDragging ? 1.018 : 1 }] },
    ]}>
      <View accessibilityLabel={`Удерживайте и перемещайте трек ${track.title}`} accessibilityRole="adjustable" style={styles.musicDragHandle}>
        <GripVertical color="#7d8894" size={19} strokeWidth={2} />
      </View>
      <Pressable onPress={onOpen} style={styles.musicCollectionTrackButton}>
        <View style={styles.selectedTrackIcon}><Play color="#fff" size={12} fill="#fff" /></View>
        <View style={styles.selectedTrackCopy}>
          <Text numberOfLines={1} style={styles.selectedTrackTitle}>{track.title}</Text>
          <Text numberOfLines={1} style={styles.selectedTrackArtist}>{track.artist} · {track.provider === 'apple' ? 'Apple Music' : track.provider === 'yandex' ? 'Яндекс Музыка' : track.provider === 'soundcloud' ? 'SoundCloud' : 'Bandcamp'}</Text>
        </View>
      </Pressable>
      {showPrimaryAction && (track.provider === 'apple' || track.provider === 'yandex') ? <Pressable onPress={onMakePrimary} style={[styles.musicPrimaryButton, track.isPrimary && styles.musicPrimaryButtonActive]}>
        <Text style={[styles.musicPrimaryButtonText, track.isPrimary && styles.musicPrimaryButtonTextActive]}>{track.isPrimary ? 'Главный' : 'Выбрать'}</Text>
      </Pressable> : null}
      <Pressable accessibilityLabel="Удалить трек" onPress={onRemove} style={styles.selectedTrackClear}><X color="#6f7b86" size={18} strokeWidth={2.2} /></Pressable>
    </Animated.View>
  );
}

export function ConnectInterestSelector({ filterCard = false, onChange, selected }: {
  filterCard?: boolean;
  onChange: (interests: string[]) => void;
  selected: string[];
}) {
  const [isVisible, setIsVisible] = useState(false);
  const [categoryIndex, setCategoryIndex] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const normalizedSearch = search.trim().toLocaleLowerCase('ru-RU');
  const activeCategory = categoryIndex === null ? null : connectInterestGroups[categoryIndex] ?? null;

  const toggle = (value: string) => {
    if (selected.includes(value)) {
      onChange(selected.filter((interest) => interest !== value));
      return;
    }
    if (selected.length >= connectInterestLimit) {
      Alert.alert('Интересы', `Можно выбрать до ${connectInterestLimit} интересов.`);
      return;
    }
    onChange([...selected, value]);
  };

  const closePicker = () => {
    setIsVisible(false);
    setCategoryIndex(null);
    setSearch('');
  };

  const pickerOptions: SelectionPickerOption[] = normalizedSearch
    ? connectInterestGroups.flatMap((group) => group.items
        .filter(([value, label]) => `${value} ${label}`.toLocaleLowerCase('ru-RU').includes(normalizedSearch))
        .map(([value, label]) => ({
          key: value,
          title: label,
          meta: group.title,
          selected: selected.includes(value),
          onPress: () => toggle(value),
        })))
    : activeCategory
      ? activeCategory.items.map(([value, label]) => ({
          key: value,
          title: label,
          selected: selected.includes(value),
          onPress: () => toggle(value),
        }))
      : connectInterestGroups.map((group, index) => ({
          key: group.title,
          title: group.title,
          meta: `${group.items.length} вариантов`,
          navigates: true,
          onPress: () => {
            setCategoryIndex(index);
            setSearch('');
          },
        }));

  return (
    <>
      <View style={[styles.connectInterestsBlock, filterCard && styles.connectFilterPickerCard]}>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setCategoryIndex(null);
            setSearch('');
            setIsVisible(true);
          }}
          style={styles.connectInterestsHeader}
        >
          <View>
            <Text style={[styles.connectGoalsTitle, filterCard && styles.connectFilterPickerTitle]}>Интересы</Text>
            <Text style={[styles.connectPhotosHint, filterCard && styles.connectFilterPickerHint, filterCard && !selected.length && styles.connectFilterPickerEmptyHint]}>{selected.length ? `Выбрано: ${selected.length} из ${connectInterestLimit}` : `Выберите до ${connectInterestLimit} творческих интересов`}</Text>
          </View>
          <ChevronRight color="#7d8894" size={20} strokeWidth={1.8} />
        </Pressable>
        {selected.length ? <View style={styles.connectInterestSelected}>
          {selected.map((interest) => <Pressable key={interest} onPress={() => toggle(interest)} style={[styles.connectInterestSelectedChip, filterCard && styles.connectFilterSelectedChip]}>
            <Text style={[styles.connectInterestSelectedText, filterCard && styles.connectFilterSelectedText]}>{connectInterestLabels[interest] ?? interest}</Text>
            <X color={filterCard ? '#111' : '#6f7b86'} size={14} strokeWidth={2.1} />
          </Pressable>)}
        </View> : null}
      </View>
      <SelectionPickerModal
        backLabel={!normalizedSearch && activeCategory ? 'Все категории' : undefined}
        emptyText="Ничего не найдено"
        isVisible={isVisible}
        onBack={!normalizedSearch && activeCategory ? () => {
          setCategoryIndex(null);
          setSearch('');
        } : undefined}
        onChangeSearch={setSearch}
        onClose={closePicker}
        options={pickerOptions}
        search={search}
        searchPlaceholder="Найти интерес"
        subtitle={`Выбрано: ${selected.length} из ${connectInterestLimit}`}
        title="Интересы"
      />
    </>
  );
}

export function MusicGenreSelector({
  editorCard = false,
  editorWhiteCard = false,
  filterCard = false,
  maxSelected = musicGenreLimit,
  onChange,
  selected,
  subgenresOnly = false,
  title = 'Жанры музыки',
  primarySelectionCount,
}: {
  editorCard?: boolean;
  editorWhiteCard?: boolean;
  filterCard?: boolean;
  maxSelected?: number;
  onChange: (genres: string[]) => void;
  primarySelectionCount?: number;
  selected: string[];
  subgenresOnly?: boolean;
  title?: string;
}) {
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [categoryIndex, setCategoryIndex] = useState<number | null>(null);
  const [genreIndex, setGenreIndex] = useState<number | null>(null);
  const [genreSearch, setGenreSearch] = useState('');
  const activeCategory = musicTaxonomy[categoryIndex ?? 0] ?? musicTaxonomy[0];
  const activeGenre = activeCategory.genres[genreIndex ?? 0] ?? activeCategory.genres[0];
  const normalizedGenreSearch = genreSearch.trim().toLocaleLowerCase('ru-RU').replace(/[\s\-_/]+/g, '');
  const genreSearchResults = useMemo(() => {
    if (!normalizedGenreSearch) return [];

    return musicTaxonomy.flatMap((category) => category.genres.flatMap((genre) => {
      const context = `${genre.name} · ${category.category}`;
      const options: Array<{ context: string; title: string; value: string }> = genre.subgenres.map((subgenre) => ({
        context,
        title: musicSubgenreDisplayName(buildMusicGenreValue(category.category, genre.name, subgenre)),
        value: buildMusicGenreValue(category.category, genre.name, subgenre),
      }));

      if (!subgenresOnly) {
        options.unshift({
          context: category.category,
          title: genre.name,
          value: buildMusicGenreValue(category.category, genre.name),
        });
      }

      return options.filter((option) => `${musicGenreSearchText(option.value)} ${option.title} ${option.context}`
        .toLocaleLowerCase('ru-RU')
        .replace(/[\s\-_/]+/g, '')
        .includes(normalizedGenreSearch));
    }));
  }, [normalizedGenreSearch, subgenresOnly]);

  const toggleGenre = (value: string) => {
    if (selected.includes(value)) {
      onChange(selected.filter((genre) => genre !== value));
      return;
    }

    if (selected.length >= maxSelected) {
      Alert.alert(title, `Можно выбрать до ${maxSelected} жанров.`);
      return;
    }

    onChange([...selected, value]);
  };

  const chooseCategory = (index: number) => {
    setCategoryIndex(index);
    setGenreIndex(null);
  };
  const closePicker = () => {
    setIsPickerOpen(false);
    setGenreSearch('');
  };
  const selectedGroups = useMemo(() => groupMusicGenreChips(selected), [selected]);
  const pickerOptions: SelectionPickerOption[] = normalizedGenreSearch
    ? genreSearchResults.map((option) => ({
        key: option.value,
        title: option.title,
        meta: option.context,
        selected: selected.includes(option.value),
        onPress: () => toggleGenre(option.value),
      }))
    : categoryIndex === null
      ? musicTaxonomy.map((item, index) => ({
          key: item.category,
          title: item.category,
          meta: `${item.genres.length} жанров`,
          navigates: true,
          onPress: () => chooseCategory(index),
        }))
      : genreIndex === null
        ? activeCategory.genres.map((genre, index) => ({
            key: genre.name,
            title: genre.name,
            meta: `${genre.subgenres.length} поджанров`,
            navigates: true,
            onPress: () => setGenreIndex(index),
          }))
        : [
            ...(!subgenresOnly ? [{
              key: buildMusicGenreValue(activeCategory.category, activeGenre.name),
              title: `Весь ${activeGenre.name}`,
              selected: selected.includes(buildMusicGenreValue(activeCategory.category, activeGenre.name)),
              onPress: () => toggleGenre(buildMusicGenreValue(activeCategory.category, activeGenre.name)),
            }] : []),
            ...activeGenre.subgenres.map((subgenre) => {
              const value = buildMusicGenreValue(activeCategory.category, activeGenre.name, subgenre);
              return {
                key: value,
                title: musicSubgenreDisplayName(value),
                selected: selected.includes(value),
                onPress: () => toggleGenre(value),
              };
            }),
          ];
  const pickerBackLabel = !normalizedGenreSearch && categoryIndex !== null
    ? genreIndex !== null ? activeGenre.name : activeCategory.category
    : undefined;

  return (
    <>
      <View
        style={[
          styles.connectInterestsBlock,
          editorCard && styles.communityAudioFieldCard,
          editorWhiteCard && styles.musicGenreEditorWhiteCard,
          filterCard && styles.connectFilterPickerCard,
        ]}
      >
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setGenreSearch('');
            setIsPickerOpen(true);
          }}
          style={styles.connectInterestsHeader}
        >
          <View>
            <Text style={[styles.connectGoalsTitle, filterCard && styles.connectFilterPickerTitle]}>{title}</Text>
            <Text style={[styles.connectPhotosHint, filterCard && styles.connectFilterPickerHint, filterCard && !selected.length && styles.connectFilterPickerEmptyHint]}>
              {`Выбрано: ${selected.length} из ${maxSelected}`}
            </Text>
            {primarySelectionCount ? <Text style={styles.musicGenrePriorityHint}>Первые {primarySelectionCount} выбранных жанра будут считаться основными</Text> : null}
          </View>
          <ChevronRight color="#7d8894" size={20} strokeWidth={1.8} />
        </Pressable>

        {selected.length ? (
          <View style={styles.connectInterestSelected}>
            {subgenresOnly
              ? selected.map((value) => (
                  <Pressable
                    key={value}
                    onPress={() => onChange(selected.filter((genre) => genre !== value))}
                    style={[styles.connectInterestSelectedChip, filterCard && styles.connectFilterSelectedChip]}
                  >
                    <Text style={[styles.connectInterestSelectedText, filterCard && styles.connectFilterSelectedText]}>{musicSubgenreDisplayName(value)}</Text>
                    <X color={filterCard ? '#111' : '#6f7b86'} size={14} strokeWidth={2.1} />
                  </Pressable>
                ))
              : selectedGroups.map((group) => (
                  <Pressable
                    key={group.key}
                    onPress={() => onChange(selected.filter((genre) => !group.values.includes(genre)))}
                    style={[styles.connectInterestSelectedChip, filterCard && styles.connectFilterSelectedChip]}
                  >
                    <Text style={[styles.connectInterestSelectedText, filterCard && styles.connectFilterSelectedText]}>
                      <Text style={styles.tagGenreText}>{group.genre}</Text>
                      {group.subgenres.length ? (
                        <Text style={styles.tagSubgenreText}> {group.subgenres.join(', ')}</Text>
                      ) : null}
                    </Text>
                    <X color={filterCard ? '#111' : '#6f7b86'} size={14} strokeWidth={2.1} />
                  </Pressable>
                ))}
          </View>
        ) : null}
      </View>

      <SelectionPickerModal
        backLabel={pickerBackLabel}
        emptyText="Ничего не найдено"
        isVisible={isPickerOpen}
        onBack={pickerBackLabel ? () => genreIndex !== null ? setGenreIndex(null) : setCategoryIndex(null) : undefined}
        onChangeSearch={setGenreSearch}
        onClose={closePicker}
        options={pickerOptions}
        search={genreSearch}
        searchPlaceholder="Найти жанр или поджанр"
        subtitle={`${selected.length} / ${maxSelected}`}
        title={title}
      />
    </>
  );
}

