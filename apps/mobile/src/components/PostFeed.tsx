import { Check, ChevronDown, Circle, CornerUpLeft, EllipsisVertical, ExternalLink, FileText, Flag, Headphones, Heart, ImagePlus, ListChecks, MessageCircle, Music2, Paperclip, Pause, Play, Plus, Repeat2, Send, Settings, Square, Trash2, Video, X } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppImage as Image } from './AppImage';
import { apiFetch, apiUrl, remoteSearchDebounceMs, reportApiError } from '../api/client';
import { getAvatarInitial, postImageThumbnail, uploadPostImageAsset } from '../domain';
import type { AppPost, PostComment as PostCommentItem, PostMusicAttachment, PublicPage, PublicPageAudioRelease, QuotedPost } from '../types';
import { styles } from '../styles';
import { MusicPickerModal } from './AppleMusicPickerModal';
import { AppSheetModal } from './AppSheetModal';
import { VolnaSwitch } from './VolnaSwitch';
import { VerifiedName } from './VerifiedBadge';
import { useGlobalAudioControls, type GlobalTrackQueueItem, type TrackComposerRequest } from './GlobalAudioPlayer';
import { useWebVisualViewport } from '../hooks/useWebVisualViewport';
import { TelegramPostEmbed } from './TelegramPostEmbed';
import { YouTubePostEmbed } from './YouTubePostEmbed';
import { getBandcampRelease } from '../music/musicRuntime';
import { AudioReleaseAttachmentCard, BandcampReleaseUrlCard } from './AudioReleaseAttachmentCard';
import { EntityShareModal } from './EntityShareModal';
import { ScreenTopBar } from './ScreenTopBar';
import { normalizeExternalHttpsUrl } from '../security/externalUrls.mjs';
import { openExternalHttpsUrl } from '../security/openExternalUrl';

type RepostDestination = { type: 'account' } | { type: 'community'; username: string };
type YouTubeAttachment = { url: string; videoId: string; startSeconds: number };

function sortComments(items: PostCommentItem[], sort: 'popular' | 'recent') {
  return [...items].sort((left, right) => sort === 'popular'
    ? right.likesCount - left.likesCount || new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime() || right.id.localeCompare(left.id)
    : new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime() || right.id.localeCompare(left.id));
}

function parseYoutubeTimestamp(value: string | null) {
  if (!value) return 0;
  if (/^\d+$/.test(value)) return Math.max(0, Number(value));
  const match = value.toLowerCase().match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  return match ? Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0) : 0;
}

function parseYoutubeUrl(value: string): YouTubeAttachment | null {
  try {
    const normalized = /^https?:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`;
    const url = new URL(normalized);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    let videoId = '';
    if (host === 'youtu.be') videoId = url.pathname.split('/').filter(Boolean)[0] ?? '';
    else if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
      if (url.pathname === '/watch') videoId = url.searchParams.get('v') ?? '';
      else {
        const [kind, id] = url.pathname.split('/').filter(Boolean);
        if (kind === 'embed' || kind === 'shorts' || kind === 'live') videoId = id ?? '';
      }
    }
    if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) return null;
    return { url: normalized, videoId, startSeconds: Math.min(parseYoutubeTimestamp(url.searchParams.get('t') ?? url.searchParams.get('start')), 86_400) };
  } catch { return null; }
}

function useValidatedYoutubeAttachment(value: string, enabled: boolean) {
  const [attachment, setAttachment] = useState<YouTubeAttachment | null>(null);
  const [status, setStatus] = useState<'idle' | 'checking' | 'valid' | 'invalid'>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setAttachment(null);
    setStatus('idle');
    setError(null);
    if (!enabled || !value.trim()) return;

    const controller = new AbortController();
    let current = true;
    const timer = setTimeout(() => {
      const parsed = parseYoutubeUrl(value);
      if (!parsed) {
        if (current) {
          setStatus('invalid');
          setError('Укажите корректную ссылку на видео YouTube');
        }
        return;
      }
      setStatus('checking');
      void apiFetch(`${apiUrl}/music/youtube/validate?url=${encodeURIComponent(value.trim())}`, { signal: controller.signal })
        .then(async (response) => {
          const payload = await response.json().catch(() => null) as { videoId?: string; message?: string } | null;
          if (!response.ok || payload?.videoId !== parsed.videoId) throw new Error(payload?.message || 'Видео не найдено или недоступно');
          if (!current) return;
          setAttachment(parsed);
          setStatus('valid');
          setError(null);
        })
        .catch((reason: unknown) => {
          if (!current || (reason as { name?: string }).name === 'AbortError') return;
          setAttachment(null);
          setStatus('invalid');
          setError(reason instanceof Error ? reason.message : 'Видео не найдено или недоступно');
        });
    }, 450);

    return () => {
      current = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [enabled, value]);

  return { attachment, error, status };
}

export function PostThreadScreen({ authToken, onBack, onNotify, onOpenMenu, onOpenMessages, onOpenNotifications, onOpenPost, onOpenProfile, onOpenPublicPage, postId }: {
  authToken: string;
  onBack: () => void;
  onNotify: (message: string, type?: 'success' | 'error') => void;
  onOpenMenu: () => void;
  onOpenMessages: () => void;
  onOpenNotifications: () => void;
  onOpenPost?: (post: AppPost | QuotedPost) => Promise<void>;
  onOpenProfile: (username: string) => Promise<void>;
  onOpenPublicPage: (username: string) => Promise<void>;
  postId: string;
}) {
  return <View style={styles.postThreadScreen}>
    <ScreenTopBar canGoBack onBack={onBack} onOpenMenu={onOpenMenu} onOpenMessages={onOpenMessages} onOpenNotifications={onOpenNotifications} title="Ветка" />
    <PostFeed authToken={authToken} authorType="account" canCreate={false} focusPostId={postId} onNotify={onNotify} onOpenPost={onOpenPost} onOpenProfile={onOpenProfile} onOpenPublicPage={onOpenPublicPage} threadLayout username="" />
  </View>;
}

export function usePostAvailability(authorType: 'account' | 'community', username: string) {
  const [hasPosts, setHasPosts] = useState(false);
  useEffect(() => {
    let active = true;
    void apiFetch(`${apiUrl}/posts?authorType=${authorType}&username=${encodeURIComponent(username)}&pageSize=1`)
      .then(async (response) => response.ok ? response.json() as Promise<AppPost[]> : [])
      .then((posts) => { if (active) setHasPosts(posts.length > 0); })
      .catch(() => { if (active) setHasPosts(false); });
    return () => { active = false; };
  }, [authorType, username]);
  return hasPosts;
}

export function PostFeed({
  authToken,
  authorType,
  canCreate,
  composerAuthor,
  composerOpenRequest = 0,
  composerRequest,
  eventId,
  emptyMessage,
  feed = false,
  feedMode = 'for-you',
  focusPostId,
  hideComposerTrigger = false,
  maxItems = 10,
  onComposerOpenRequestHandled,
  onLoadingChange,
  onNotify,
  onOpenPost,
  onOpenProfile,
  onOpenPublicPage,
  refreshKey = 0,
  threadLayout = false,
  username,
}: {
  authToken: string;
  authorType: 'account' | 'community';
  canCreate: boolean;
  composerAuthor?: { avatarUrl?: string | null; isVerified?: boolean; name: string; username?: string };
  composerOpenRequest?: number;
  composerRequest?: TrackComposerRequest | null;
  CropModal?: unknown;
  emptyMessage?: string;
  eventId?: string;
  feed?: boolean;
  feedMode?: 'for-you' | 'following';
  focusPostId?: string | null;
  hideComposerTrigger?: boolean;
  maxItems?: number;
  onComposerOpenRequestHandled?: () => void;
  onLoadingChange?: (loading: boolean) => void;
  onNotify?: (message: string, type?: 'success' | 'error') => void;
  onOpenPost?: (post: AppPost | QuotedPost) => Promise<void>;
  onOpenProfile: (username: string) => Promise<void>;
  onOpenPublicPage: (username: string) => Promise<void>;
  refreshKey?: number;
  threadLayout?: boolean;
  username: string;
}) {
  const safeAreaInsets = useSafeAreaInsets();
  const globalAudio = useGlobalAudioControls();
  const [posts, setPosts] = useState<AppPost[]>([]);
  const [text, setText] = useState('');
  const [composerTextHeight, setComposerTextHeight] = useState(21);
  const [images, setImages] = useState<string[]>([]);
  const [music, setMusic] = useState<PostMusicAttachment[]>([]);
  const [youtube, setYoutube] = useState<YouTubeAttachment | null>(null);
  const [audioRelease, setAudioRelease] = useState<PublicPageAudioRelease | null>(null);
  const [youtubeInput, setYoutubeInput] = useState('');
  const [youtubeError, setYoutubeError] = useState<string | null>(null);
  const [isYoutubeOpen, setIsYoutubeOpen] = useState(false);
  const [mentionSuggestions, setMentionSuggestions] = useState<Array<{ entityType: 'account' | 'community'; id: string; username: string; name: string; avatarUrl: string | null }>>([]);
  const [isMusicOpen, setIsMusicOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const isLoadingMoreRef = useRef(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const composerViewport = useWebVisualViewport(isComposerOpen);
  const [repostTarget, setRepostTarget] = useState<AppPost | null>(null);
  const [ownedPages, setOwnedPages] = useState<PublicPage[]>([]);
  const [repostAccountAuthor, setRepostAccountAuthor] = useState<{ avatarUrl: string | null; name: string; username: string } | null>(null);
  const [repostDestination, setRepostDestination] = useState<RepostDestination>({ type: 'account' });
  const [isRepostDestinationOpen, setIsRepostDestinationOpen] = useState(false);
  const [reportTarget, setReportTarget] = useState<AppPost | null>(null);
  const [directShareTarget, setDirectShareTarget] = useState<AppPost | null>(null);
  const [postActionsAnchor, setPostActionsAnchor] = useState({ x: 0, y: 0 });
  const [showReportReasons, setShowReportReasons] = useState(false);
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState<string[]>([]);
  const [pollAnonymous, setPollAnonymous] = useState(false);
  const [pollMultiple, setPollMultiple] = useState(false);
  const [isPollEditorOpen, setIsPollEditorOpen] = useState(false);
  const [pollDraftQuestion, setPollDraftQuestion] = useState('');
  const [pollDraftOptions, setPollDraftOptions] = useState<string[]>(['', '']);
  const [pollDraftAnonymous, setPollDraftAnonymous] = useState(false);
  const [pollDraftMultiple, setPollDraftMultiple] = useState(false);
  const [interactionAudience, setInteractionAudience] = useState<'EVERYONE' | 'FOLLOWERS'>('EVERYONE');
  const [isPostParametersOpen, setIsPostParametersOpen] = useState(false);
  const [comments, setComments] = useState<PostCommentItem[]>([]);
  const [commentTotalCount, setCommentTotalCount] = useState(0);
  const [commentText, setCommentText] = useState('');
  const [commentImageUri, setCommentImageUri] = useState<string | null>(null);
  const [commentYoutube, setCommentYoutube] = useState<YouTubeAttachment | null>(null);
  const [commentYoutubeInput, setCommentYoutubeInput] = useState('');
  const [commentMusic, setCommentMusic] = useState<PostMusicAttachment[]>([]);
  const [commentPages, setCommentPages] = useState<PublicPage[]>([]);
  const [commentAccountAuthor, setCommentAccountAuthor] = useState<{ avatarUrl: string | null; isVerified: boolean; name: string; username: string } | null>(null);
  const [commentDestination, setCommentDestination] = useState<RepostDestination>({ type: 'account' });
  const [isCommentDestinationOpen, setIsCommentDestinationOpen] = useState(false);
  const [isCommentAttachmentOpen, setIsCommentAttachmentOpen] = useState(false);
  const [isCommentYoutubeOpen, setIsCommentYoutubeOpen] = useState(false);
  const [isCommentMusicOpen, setIsCommentMusicOpen] = useState(false);
  const notifyOperationalError = useCallback((message: string) => {
    if (onNotify) onNotify(message, 'error');
    else reportApiError(message);
  }, [onNotify]);
  const [commentCursor, setCommentCursor] = useState<string | null>(null);
  const [commentSort, setCommentSort] = useState<'popular' | 'recent'>('popular');
  const [isCommentSortOpen, setIsCommentSortOpen] = useState(false);
  const [replyTarget, setReplyTarget] = useState<PostCommentItem | null>(null);
  const [isCommentsLoading, setIsCommentsLoading] = useState(false);
  const [isCommentSaving, setIsCommentSaving] = useState(false);
  const youtubeValidation = useValidatedYoutubeAttachment(youtubeInput, isYoutubeOpen);
  const commentYoutubeValidation = useValidatedYoutubeAttachment(commentYoutubeInput, isCommentYoutubeOpen);
  const pendingLikes = useRef(new Set<string>());
  const pendingCommentLikes = useRef(new Set<string>());
  const pendingPolls = useRef(new Set<string>());
  const hasValidPoll = pollOptions.length >= 2 && pollQuestion.trim().length > 0 && pollOptions.every((option) => option.trim().length > 0);
  const canPublish = Boolean(text.trim() || music.length || youtube || audioRelease || images.length || repostTarget || hasValidPoll);
  const selectedRepostPage = repostDestination.type === 'community' ? ownedPages.find((page) => page.username === repostDestination.username) : null;
  const selectedCommentPage = commentDestination.type === 'community' ? commentPages.find((page) => page.username === commentDestination.username) : null;
  const activeComposerAuthor = selectedRepostPage
      ? { avatarUrl: selectedRepostPage.avatarUrl, isVerified: selectedRepostPage.isVerified, name: selectedRepostPage.name, username: selectedRepostPage.username }
    : repostTarget
      ? repostAccountAuthor ? { ...repostAccountAuthor, isVerified: false } : { avatarUrl: null, isVerified: false, name: 'Личный профиль', username }
      : composerAuthor ?? posts[0]?.author ?? { avatarUrl: null, name: username, username };
  const composerPoll = hasValidPoll ? {
    id: 'composer-preview',
    question: pollQuestion.trim(),
    isAnonymous: pollAnonymous,
    allowsMultiple: pollMultiple,
    totalVoters: 0,
    viewerOptionIds: [],
    options: pollOptions.map((option, index) => ({ id: `composer-option-${index}`, text: option.trim(), position: index, votesCount: 0 })),
  } : null;

  const openPollEditor = () => {
    setPollDraftQuestion(pollQuestion);
    setPollDraftOptions(pollOptions.length ? pollOptions : ['', '']);
    setPollDraftAnonymous(pollAnonymous);
    setPollDraftMultiple(pollMultiple);
    setIsPollEditorOpen(true);
    Keyboard.dismiss();
  };

  const savePollDraft = () => {
    if (!pollDraftQuestion.trim() || pollDraftOptions.length < 2 || pollDraftOptions.some((option) => !option.trim())) return;
    setPollQuestion(pollDraftQuestion.trim());
    setPollOptions(pollDraftOptions.map((option) => option.trim()));
    setPollAnonymous(pollDraftAnonymous);
    setPollMultiple(pollDraftMultiple);
    setIsPollEditorOpen(false);
  };

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    onLoadingChange?.(true);
    const url = focusPostId
      ? `${apiUrl}/posts/${focusPostId}`
      : feed
        ? `${apiUrl}/posts/feed?pageSize=10&paginated=1&mode=${feedMode}`
        : `${apiUrl}/posts?authorType=${authorType}&username=${encodeURIComponent(username)}&pageSize=10&paginated=1${eventId ? `&eventId=${encodeURIComponent(eventId)}` : ''}`;
    void apiFetch(url).then(async (response) => {
      if (!response.ok) throw new Error('Не удалось загрузить публикации');
      const result = await response.json() as AppPost | { items: AppPost[]; nextCursor: string | null };
      if (active) {
        if ('items' in result) {
          setPosts(result.items);
          setNextCursor(result.nextCursor);
        } else {
          setPosts([result]);
          setNextCursor(null);
        }
      }
    }).catch((reason) => { if (active) notifyOperationalError(reason instanceof Error ? reason.message : 'Ошибка загрузки'); }).finally(() => {
      if (active) {
        setIsLoading(false);
        onLoadingChange?.(false);
      }
    });
    return () => { active = false; };
  }, [authorType, eventId, feed, feedMode, focusPostId, onLoadingChange, refreshKey, username]);

  useEffect(() => {
    if (focusPostId || isLoading || isLoadingMoreRef.current || !nextCursor || posts.length >= maxItems) return;
    let active = true;
    isLoadingMoreRef.current = true;
    setIsLoadingMore(true);
    const baseUrl = feed
      ? `${apiUrl}/posts/feed?pageSize=10&paginated=1&mode=${feedMode}`
      : `${apiUrl}/posts?authorType=${authorType}&username=${encodeURIComponent(username)}&pageSize=10&paginated=1${eventId ? `&eventId=${encodeURIComponent(eventId)}` : ''}`;
    void apiFetch(`${baseUrl}&cursor=${encodeURIComponent(nextCursor)}`).then(async (response) => {
      if (!response.ok) throw new Error('Не удалось догрузить публикации');
      return response.json() as Promise<{ items: AppPost[]; nextCursor: string | null }>;
    }).then((result) => {
      if (!active) return;
      setPosts((current) => [...current, ...result.items.filter((item) => !current.some((existing) => existing.id === item.id))]);
      setNextCursor(result.nextCursor);
    }).catch((reason) => { if (active) notifyOperationalError(reason instanceof Error ? reason.message : 'Ошибка загрузки'); }).finally(() => { isLoadingMoreRef.current = false; if (active) setIsLoadingMore(false); });
    return () => { active = false; };
  }, [authorType, eventId, feed, feedMode, focusPostId, isLoading, maxItems, nextCursor, posts.length, username]);

  useEffect(() => {
    if (!composerRequest) return;
    const track = composerRequest.track;
    if (track.releaseId) {
      let active = true;
      setMusic([]);
      void apiFetch(`${apiUrl}/public-pages/audio-releases/${encodeURIComponent(track.releaseId)}`)
        .then(async (response) => {
          if (!response.ok) throw new Error('Не удалось загрузить релиз');
          return response.json() as Promise<PublicPageAudioRelease>;
        })
        .then((release) => { if (active) setAudioRelease(release); })
        .catch((reason) => { if (active) notifyOperationalError(reason instanceof Error ? reason.message : 'Не удалось загрузить релиз'); });
      setIsComposerOpen(true);
      return () => { active = false; };
    }
    if (track.provider === 'bandcamp' && track.collectionId) {
      let active = true;
      setMusic([]);
      void getBandcampRelease(track.collectionId)
        .then((metadata) => {
          if (!active) return;
          setAudioRelease({ id: `external:${metadata.externalUrl}`, provider: 'bandcamp', releaseUrl: metadata.externalUrl, embedUrl: null, genres: track.genres ?? [], releaseDate: '', createdAt: '', metadata });
        })
        .catch((reason) => { if (active) notifyOperationalError(reason instanceof Error ? reason.message : 'Не удалось загрузить релиз'); });
      setIsComposerOpen(true);
      return () => { active = false; };
    }
    setAudioRelease(null);
    if (track.provider === 'apple' || track.provider === 'yandex' || track.provider === 'youtube') {
      const availableDuration = track.clipDurationSeconds ?? 30;
      setMusic([{ kind: 'track', track: { id: track.id.replace(/^(apple|yandex|youtube):/, ''), provider: track.provider, title: track.title, artist: track.artist ?? '', album: track.collectionTitle ?? '', artworkUrl: track.artworkUrl ?? null, previewUrl: track.previewUrl, externalUrl: track.externalUrl ?? '', durationSeconds: availableDuration, previewDurationSeconds: availableDuration }, startSeconds: track.startSeconds ?? 0, clipDurationSeconds: track.provider === 'youtube' ? availableDuration : Math.min(30, availableDuration) }]);
    } else if (track.provider === 'soundcloud' || track.provider === 'bandcamp') {
      const url = track.sourceTrackUrl || track.externalUrl;
      if (url) setMusic([{ kind: track.provider, url }]);
    } else if (track.provider === 'volna') {
      setMusic([{ kind: 'uploaded', trackId: track.id.replace(/^uploaded:/, ''), title: track.title, artist: track.artist, artworkUrl: track.artworkUrl ?? null }]);
    }
    setIsComposerOpen(true);
  }, [composerRequest]);

  useEffect(() => {
    if (!canCreate || composerOpenRequest <= 0) return;
    setIsComposerOpen(true);
    onComposerOpenRequestHandled?.();
  }, [canCreate, composerOpenRequest, onComposerOpenRequestHandled]);

  useEffect(() => {
    if (!focusPostId) {
      setComments([]);
      setCommentTotalCount(0);
      setCommentCursor(null);
      setReplyTarget(null);
      setCommentText('');
      setCommentPages([]);
      setCommentAccountAuthor(null);
      setCommentDestination({ type: 'account' });
      setIsCommentDestinationOpen(false);
      return;
    }
    let active = true;
    setIsCommentsLoading(true);
    void apiFetch(`${apiUrl}/posts/${focusPostId}/comments?sort=${commentSort}`)
      .then(async (response) => {
        if (!response.ok) throw new Error('Не удалось загрузить обсуждение');
        return response.json() as Promise<{ items: PostCommentItem[]; nextCursor: string | null; totalCount: number }>;
      })
      .then((result) => {
        if (!active) return;
        setComments(result.items);
        setCommentCursor(result.nextCursor);
        setCommentTotalCount(result.totalCount);
        setPosts((current) => current.map((post) => post.id === focusPostId ? { ...post, commentsCount: result.totalCount } : post));
      })
      .catch((reason) => { if (active) notifyOperationalError(reason instanceof Error ? reason.message : 'Не удалось загрузить обсуждение'); })
      .finally(() => { if (active) setIsCommentsLoading(false); });
    return () => { active = false; };
  }, [commentSort, focusPostId]);

  useEffect(() => {
    if (!focusPostId) return;
    let active = true;
    void Promise.all([
      apiFetch(`${apiUrl}/public-pages/owned/mine`).then(async (response) => response.ok ? response.json() as Promise<PublicPage[]> : []),
      apiFetch(`${apiUrl}/auth/me`).then(async (response): Promise<{ account?: { avatarUrl?: string | null; isVerified?: boolean; name?: string; username?: string } }> => response.ok ? response.json() : {}),
    ]).then(([pages, me]) => {
      if (!active) return;
      setCommentPages(pages.filter((page) => page.managementPermissions?.includes('PUBLICATIONS_MANAGE') && page.moderationStatus === 'APPROVED'));
      const account = me.account;
      setCommentAccountAuthor(account?.name && account.username ? { avatarUrl: account.avatarUrl ?? null, isVerified: Boolean(account.isVerified), name: account.name, username: account.username } : null);
    }).catch(() => {
      if (!active) return;
      setCommentPages([]);
      setCommentAccountAuthor(null);
    });
    return () => { active = false; };
  }, [focusPostId]);

  useEffect(() => {
    if (!repostTarget) {
      setOwnedPages([]);
      setRepostAccountAuthor(null);
      setRepostDestination({ type: 'account' });
      setIsRepostDestinationOpen(false);
      return;
    }
    let active = true;
    void Promise.all([
      apiFetch(`${apiUrl}/public-pages/owned/mine`).then(async (response) => response.ok ? response.json() as Promise<PublicPage[]> : []),
      apiFetch(`${apiUrl}/auth/me`).then(async (response): Promise<{ account?: { avatarUrl?: string | null; name?: string; username?: string } }> => response.ok ? response.json() : {}),
    ]).then(([pages, me]) => {
      if (!active) return;
      setOwnedPages(pages);
      const account = me.account;
      setRepostAccountAuthor(account?.name && account.username ? { avatarUrl: account.avatarUrl ?? null, name: account.name, username: account.username } : null);
    }).catch(() => {
      if (!active) return;
      setOwnedPages([]);
      setRepostAccountAuthor(null);
    });
    return () => { active = false; };
  }, [repostTarget]);

  useEffect(() => {
    const match = text.match(/(?:^|\s)@([a-z0-9_]{3,30})$/i);
    if (!match) { setMentionSuggestions([]); return; }
    const timer = setTimeout(() => {
      void apiFetch(`${apiUrl}/search?q=${encodeURIComponent(match[1])}`).then(async (response) => response.ok ? response.json() : null).then((result) => {
        if (!result) return;
        setMentionSuggestions([
          ...(result.accounts ?? []).map((item: { id: string; username: string; name: string; avatarUrl?: string | null }) => ({ entityType: 'account' as const, ...item, avatarUrl: item.avatarUrl ?? null })),
          ...(result.communities ?? []).map((item: { id: string; username: string; name: string; avatarUrl?: string | null }) => ({ entityType: 'community' as const, ...item, avatarUrl: item.avatarUrl ?? null })),
        ].slice(0, 6));
      });
    }, remoteSearchDebounceMs);
    return () => clearTimeout(timer);
  }, [text]);

  const pickImage = async () => {
    if (images.length >= 5 || youtube) return;
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Фото', 'Разрешите VOLNA доступ к фотографиям в настройках iPhone.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        orderedSelection: true,
        selectionLimit: 5 - images.length,
        quality: 1,
      });
      if (!result.canceled && result.assets.length) {
        const prepared = [] as string[];
        for (const asset of result.assets.slice(0, 5 - images.length)) {
          const longestSide = Math.max(asset.width, asset.height);
          const resize = longestSide > 2160
            ? asset.width >= asset.height ? { width: 2160 } : { height: 2160 }
            : null;
          const optimized = await manipulateAsync(asset.uri, resize ? [{ resize }] : [], { compress: 0.8, format: SaveFormat.JPEG });
          prepared.push(optimized.uri);
        }
        setImages((current) => [...current, ...prepared].slice(0, 5));
      }
    } catch {
      Alert.alert('Фото', 'Не удалось открыть галерею. Попробуйте ещё раз.');
    }
  };

  const publish = async () => {
    if (!canPublish) return;
    setIsSaving(true);
    try {
      const primaryMusic = music[0];
      const uploaded = [] as Array<{ imageKey: string; imageUrl: string }>;
      for (const uri of images) uploaded.push(await uploadPostImageAsset(uri, authToken));
      const response = await apiFetch(`${apiUrl}/posts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ authorType: repostTarget ? repostDestination.type : authorType, authorUsername: repostTarget ? repostDestination.type === 'community' ? repostDestination.username : undefined : username, eventId: repostTarget ? undefined : eventId, text: text.trim(), interactionAudience, musicAttachments: music, audioReleaseId: audioRelease && !audioRelease.id.startsWith('external:') ? audioRelease.id : undefined, trackId: primaryMusic?.kind === 'track' ? primaryMusic.track.id : undefined, trackProvider: primaryMusic?.kind === 'track' ? primaryMusic.track.provider : undefined, uploadedTrackId: primaryMusic?.kind === 'uploaded' ? primaryMusic.trackId : undefined, trackStartSeconds: primaryMusic?.kind === 'track' ? primaryMusic.startSeconds : undefined, trackClipDurationSeconds: primaryMusic?.kind === 'track' ? primaryMusic.clipDurationSeconds : undefined, soundcloudMusicUrl: primaryMusic?.kind === 'soundcloud' ? primaryMusic.url : undefined, bandcampMusicUrl: audioRelease?.id.startsWith('external:') ? audioRelease.releaseUrl : primaryMusic?.kind === 'bandcamp' ? primaryMusic.url : undefined, youtubeUrl: youtube?.url, imageKeys: uploaded.map((item) => item.imageKey), originalPostId: repostTarget?.id, poll: hasValidPoll ? { question: pollQuestion.trim(), options: pollOptions.map((option) => option.trim()), isAnonymous: pollAnonymous, allowsMultiple: pollMultiple } : undefined }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { message?: string | string[] } | null;
        throw new Error(Array.isArray(payload?.message) ? payload.message[0] : payload?.message || 'Не удалось опубликовать запись');
      }
      const created = await response.json() as AppPost;
      if (!repostTarget) setPosts((current) => [created, ...current]);
      else {
        const destinationMatchesCurrentFeed = !eventId
          && created.author.entityType === authorType
          && created.author.username.toLowerCase() === username.replace(/^@/, '').toLowerCase();
        setPosts((current) => {
          const withUpdatedCounter = current.map((post) => post.id === repostTarget.id
            ? { ...post, repostsCount: post.repostsCount + 1 }
            : post);
          return destinationMatchesCurrentFeed ? [created, ...withUpdatedCounter] : withUpdatedCounter;
        });
      }
      setText(''); setComposerTextHeight(21); setImages([]); setMusic([]); setYoutube(null); setAudioRelease(null); setYoutubeInput(''); setYoutubeError(null); setPollQuestion(''); setPollOptions([]); setPollAnonymous(false); setPollMultiple(false); setInteractionAudience('EVERYONE');
      setRepostTarget(null);
      setIsComposerOpen(false);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Не удалось опубликовать запись';
      notifyOperationalError(message);
    } finally { setIsSaving(false); }
  };

  const closeComposer = () => {
    setIsComposerOpen(false);
    setRepostTarget(null);
    setRepostDestination({ type: 'account' });
    setAudioRelease(null);
    setIsRepostDestinationOpen(false);
  };

  const toggleLike = async (postId: string) => {
    if (pendingLikes.current.has(postId)) return;
    const previous = posts.find((post) => post.id === postId);
    if (!previous) return;
    pendingLikes.current.add(postId);
    setPosts((current) => current.map((post) => post.id === postId ? { ...post, viewerLiked: !post.viewerLiked, likesCount: Math.max(0, post.likesCount + (post.viewerLiked ? -1 : 1)) } : post));
    try {
      const response = await apiFetch(`${apiUrl}/posts/${postId}/like`, { method: 'POST' });
      if (!response.ok) throw new Error('Не удалось поставить лайк');
      const result = await response.json() as { liked: boolean; likesCount: number };
      setPosts((current) => current.map((post) => post.id === postId ? { ...post, viewerLiked: result.liked, likesCount: result.likesCount } : post));
    } catch {
      setPosts((current) => current.map((post) => post.id === postId ? previous : post));
      notifyOperationalError('Не удалось обновить лайк');
    } finally { pendingLikes.current.delete(postId); }
  };

  const votePoll = async (post: AppPost, optionId: string) => {
    if (!post.poll || pendingPolls.current.has(post.id)) return;
    const selected = post.poll.viewerOptionIds;
    const next = post.poll.allowsMultiple
      ? selected.includes(optionId) ? selected.filter((id) => id !== optionId) : [...selected, optionId]
      : [optionId];
    if (!next.length) return;
    pendingPolls.current.add(post.id);
    try {
      const response = await apiFetch(`${apiUrl}/posts/${post.id}/poll-vote`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ optionIds: next }) });
      if (!response.ok) throw new Error('Не удалось сохранить голос');
      const poll = await response.json() as AppPost['poll'];
      setPosts((current) => current.map((item) => item.id === post.id ? { ...item, poll } : item));
    } catch (reason) {
      notifyOperationalError(reason instanceof Error ? reason.message : 'Не удалось сохранить голос');
    } finally { pendingPolls.current.delete(post.id); }
  };

  const closePostActions = () => {
    setReportTarget(null);
    setShowReportReasons(false);
  };

  const reportPost = async (reason: 'SPAM' | 'HARASSMENT' | 'IMPERSONATION' | 'ILLEGAL_CONTENT' | 'OTHER') => {
    if (!reportTarget) return;
    try {
      const response = await apiFetch(`${apiUrl}/safety/reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetType: 'POST', targetId: reportTarget.id, reason }),
      });
      if (!response.ok) throw new Error('Не удалось отправить жалобу');
      const payload = await response.json() as { alreadyReported?: boolean };
      closePostActions();
      onNotify?.(payload.alreadyReported ? 'Вы уже отправили жалобу' : 'Жалоба отправлена', 'success');
    } catch (reasonError) {
      notifyOperationalError(reasonError instanceof Error ? reasonError.message : 'Не удалось отправить жалобу');
    }
  };

  const deletePost = () => {
    if (!reportTarget?.canDelete) return;
    const target = reportTarget;
    const performDelete = async () => {
      try {
        const response = await apiFetch(`${apiUrl}/posts/${target.id}`, { method: 'DELETE' });
        if (!response.ok) {
          const payload = await response.json().catch(() => null) as { message?: string } | null;
          throw new Error(payload?.message ?? 'Не удалось удалить публикацию');
        }
        setPosts((current) => current.filter((item) => item.id !== target.id));
        closePostActions();
      } catch (reasonError) {
        closePostActions();
        notifyOperationalError(reasonError instanceof Error ? reasonError.message : 'Не удалось удалить публикацию');
      }
    };

    if (Platform.OS === 'web') {
      const confirmed = typeof window !== 'undefined' && window.confirm(
        'Удалить публикацию?\n\nПубликация исчезнет из ленты. В существующих репостах будет указано, что оригинал удалён.',
      );
      if (confirmed) void performDelete();
      return;
    }

    Alert.alert(
      'Удалить публикацию?',
      'Публикация исчезнет из ленты. В существующих репостах будет указано, что оригинал удалён.',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Удалить',
          style: 'destructive',
          onPress: () => void performDelete(),
        },
      ],
    );
  };

  const attachYoutube = () => {
    if (images.length) {
      setYoutubeError('Сначала удалите прикреплённые изображения');
      return;
    }
    if (!youtubeValidation.attachment) {
      setYoutubeError(youtubeValidation.error || 'Дождитесь проверки видео');
      return;
    }
    setYoutube(youtubeValidation.attachment);
    setYoutubeError(null);
    setIsYoutubeOpen(false);
    Keyboard.dismiss();
  };

  const publishComment = async () => {
    if (!focusPostId || (!commentText.trim() && !commentImageUri && !commentYoutube && !commentMusic.length) || isCommentSaving) return;
    setIsCommentSaving(true);
    try {
      const uploadedImage = commentImageUri ? await uploadPostImageAsset(commentImageUri, authToken) : null;
      const response = await apiFetch(`${apiUrl}/posts/${focusPostId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          authorType: commentDestination.type,
          authorUsername: commentDestination.type === 'community' ? commentDestination.username : undefined,
          text: commentText.trim(),
          parentId: replyTarget?.id,
          imageKey: uploadedImage?.imageKey,
          youtubeUrl: commentYoutube?.url,
          musicAttachments: commentMusic,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { message?: string | string[] } | null;
        throw new Error(Array.isArray(payload?.message) ? payload.message[0] : payload?.message || 'Не удалось отправить ответ');
      }
      const created = await response.json() as PostCommentItem;
      setComments((current) => sortComments([...current, created], commentSort));
      setCommentTotalCount((current) => current + 1);
      setPosts((current) => current.map((post) => post.id === focusPostId ? { ...post, commentsCount: post.commentsCount + 1 } : post));
      setCommentText('');
      setCommentImageUri(null);
      setCommentYoutube(null);
      setCommentYoutubeInput('');
      setCommentMusic([]);
      setReplyTarget(null);
      Keyboard.dismiss();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Не удалось отправить ответ';
      notifyOperationalError(message);
    } finally {
      setIsCommentSaving(false);
    }
  };

  const pickCommentImage = async () => {
    setIsCommentAttachmentOpen(false);
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: false, quality: 1 });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const longestSide = Math.max(asset.width, asset.height);
    const resize = longestSide > 2160 ? asset.width >= asset.height ? { width: 2160 } : { height: 2160 } : null;
    const optimized = await manipulateAsync(asset.uri, resize ? [{ resize }] : [], { compress: 0.8, format: SaveFormat.JPEG });
    setCommentYoutube(null);
    setCommentMusic([]);
    setCommentImageUri(optimized.uri);
  };

  const attachCommentYoutube = () => {
    if (!commentYoutubeValidation.attachment) return;
    setCommentImageUri(null);
    setCommentMusic([]);
    setCommentYoutube(commentYoutubeValidation.attachment);
    setIsCommentYoutubeOpen(false);
  };

  const loadMoreComments = async () => {
    if (!focusPostId || !commentCursor || isCommentsLoading) return;
    setIsCommentsLoading(true);
    try {
      const response = await apiFetch(`${apiUrl}/posts/${focusPostId}/comments?sort=${commentSort}&cursor=${encodeURIComponent(commentCursor)}`);
      if (!response.ok) throw new Error('Не удалось загрузить ответы');
      const result = await response.json() as { items: PostCommentItem[]; nextCursor: string | null };
      setComments((current) => [...current, ...result.items.filter((item) => !current.some((existing) => existing.id === item.id))]);
      setCommentCursor(result.nextCursor);
    } catch (reason) {
      notifyOperationalError(reason instanceof Error ? reason.message : 'Не удалось загрузить ответы');
    } finally {
      setIsCommentsLoading(false);
    }
  };

  const toggleCommentLike = async (commentId: string) => {
    if (!focusPostId || pendingCommentLikes.current.has(commentId)) return;
    const previous = comments.find((comment) => comment.id === commentId);
    if (!previous || previous.isDeleted) return;
    pendingCommentLikes.current.add(commentId);
    setComments((current) => sortComments(current.map((comment) => comment.id === commentId ? { ...comment, viewerLiked: !comment.viewerLiked, likesCount: Math.max(0, comment.likesCount + (comment.viewerLiked ? -1 : 1)) } : comment), commentSort));
    try {
      const response = await apiFetch(`${apiUrl}/posts/${focusPostId}/comments/${commentId}/like`, { method: 'POST' });
      if (!response.ok) throw new Error('Не удалось обновить лайк');
      const result = await response.json() as { liked: boolean; likesCount: number };
      setComments((current) => sortComments(current.map((comment) => comment.id === commentId ? { ...comment, viewerLiked: result.liked, likesCount: result.likesCount } : comment), commentSort));
    } catch {
      setComments((current) => current.map((comment) => comment.id === commentId ? previous : comment));
      notifyOperationalError('Не удалось обновить лайк');
    } finally {
      pendingCommentLikes.current.delete(commentId);
    }
  };

  const deleteComment = async (comment: PostCommentItem) => {
    if (!focusPostId || !comment.canDelete) return;
    try {
      const response = await apiFetch(`${apiUrl}/posts/${focusPostId}/comments/${comment.id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Не удалось удалить ответ');
      setComments((current) => current.map((item) => item.id === comment.id ? { ...item, isDeleted: true, text: '', likesCount: 0 } : item));
      setCommentTotalCount((current) => Math.max(0, current - 1));
      setPosts((current) => current.map((post) => post.id === focusPostId ? { ...post, commentsCount: Math.max(0, post.commentsCount - 1) } : post));
    } catch (reason) {
      notifyOperationalError(reason instanceof Error ? reason.message : 'Не удалось удалить ответ');
    }
  };

  const FeedBody = threadLayout ? ScrollView : View;

  return (
    <View style={[styles.postFeed, authorType === 'community' && styles.communityPostFeed, threadLayout && styles.postThreadFeed]}>
      <FeedBody style={threadLayout ? styles.postThreadFeedScroll : undefined}>
      <View style={threadLayout ? styles.postThreadFeedContent : undefined}>
      {canCreate && !hideComposerTrigger && !isComposerOpen ? (
        <Pressable accessibilityRole="button" onPress={() => setIsComposerOpen(true)} style={[styles.postComposerTrigger, styles.postComposerFeedTrigger]}>
          <Plus color="#111" size={20} strokeWidth={2} />
          <Text style={styles.postComposerTriggerText}>Новая публикация</Text>
        </Pressable>
      ) : null}
      {(canCreate || repostTarget || composerRequest) ? <Modal animationType="slide" onRequestClose={closeComposer} presentationStyle="fullScreen" visible={isComposerOpen}>
        <View style={[
          styles.postComposeScreen,
          { paddingTop: safeAreaInsets.top, paddingBottom: composerViewport.keyboardVisible ? 0 : safeAreaInsets.bottom },
        ]}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.postComposeKeyboardView}>
            <View style={styles.postComposeHeader}>
              <Pressable accessibilityRole="button" onPress={closeComposer} style={styles.postComposeCancel}><Text style={styles.postComposeCancelText}>Отмена</Text></Pressable>
              <Pressable accessibilityRole="button" disabled={isSaving || !canPublish} onPress={() => void publish()} style={[styles.postComposePublish, (isSaving || !canPublish) && styles.postComposePublishDisabled]}>{isSaving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.postComposePublishText}>Опубликовать</Text>}</Pressable>
            </View>
            <ScrollView contentContainerStyle={[styles.postComposeContent, Platform.OS === 'web' && { paddingBottom: 90 }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              {repostTarget && ownedPages.length ? <View style={styles.postRepostDestination}>
                <Text style={styles.postRepostDestinationLabel}>Куда репостнуть</Text>
                <Pressable accessibilityLabel="Выбрать, куда репостнуть" accessibilityRole="button" onPress={() => { Keyboard.dismiss(); setIsRepostDestinationOpen((current) => !current); }} style={styles.postRepostDestinationInput}>
                  <View style={styles.postRepostDestinationIcon}>{repostDestination.type === 'account' ? repostAccountAuthor?.avatarUrl ? <Image source={{ uri: repostAccountAuthor.avatarUrl }} style={styles.postRepostDestinationAvatar} /> : <Text style={styles.postRepostDestinationInitial}>{getAvatarInitial(repostAccountAuthor?.name ?? '')}</Text> : ownedPages.find((page) => page.username === repostDestination.username)?.avatarUrl ? <Image source={{ uri: ownedPages.find((page) => page.username === repostDestination.username)!.avatarUrl! }} style={styles.postRepostDestinationAvatar} /> : <Text style={styles.postRepostDestinationInitial}>{getAvatarInitial(ownedPages.find((page) => page.username === repostDestination.username)?.name ?? '')}</Text>}</View>
                  <View style={styles.postTrackCopy}><Text numberOfLines={1} style={styles.postRepostDestinationName}>{repostDestination.type === 'account' ? 'Личный профиль' : ownedPages.find((page) => page.username === repostDestination.username)?.name}</Text>{repostDestination.type === 'community' ? <Text numberOfLines={1} style={styles.postRepostDestinationUsername}>@{repostDestination.username}</Text> : null}</View>
                  <ChevronDown color="#6f7b86" size={20} strokeWidth={1.9} />
                </Pressable>
                {isRepostDestinationOpen ? <View style={styles.postRepostDestinationOptions}>
                  <Pressable accessibilityRole="button" onPress={() => { setRepostDestination({ type: 'account' }); setIsRepostDestinationOpen(false); }} style={styles.postRepostDestinationOption}><View style={styles.postRepostDestinationIcon}>{repostAccountAuthor?.avatarUrl ? <Image source={{ uri: repostAccountAuthor.avatarUrl }} style={styles.postRepostDestinationAvatar} /> : <Text style={styles.postRepostDestinationInitial}>{getAvatarInitial(repostAccountAuthor?.name ?? '')}</Text>}</View><Text style={styles.postRepostDestinationOptionText}>Личный профиль</Text>{repostDestination.type === 'account' ? <Check color="#198f45" size={20} strokeWidth={2.2} /> : null}</Pressable>
                  {ownedPages.map((page) => <Pressable accessibilityLabel={`Репостнуть в сообщество ${page.name}`} accessibilityRole="button" key={page.id} onPress={() => { setRepostDestination({ type: 'community', username: page.username }); setIsRepostDestinationOpen(false); }} style={styles.postRepostDestinationOption}>{page.avatarUrl ? <Image source={{ uri: page.avatarUrl }} style={styles.postRepostDestinationIcon} /> : <View style={styles.postRepostDestinationIcon}><Text style={styles.postRepostDestinationInitial}>{getAvatarInitial(page.name)}</Text></View>}<View style={styles.postTrackCopy}><Text numberOfLines={1} style={styles.postRepostDestinationOptionText}>{page.name}</Text><Text numberOfLines={1} style={styles.postRepostDestinationUsername}>@{page.username}</Text></View>{repostDestination.type === 'community' && repostDestination.username === page.username ? <Check color="#198f45" size={20} strokeWidth={2.2} /> : null}</Pressable>)}
                </View> : null}
              </View> : null}
              <View style={styles.postComposeAuthorLayout}>
                <View style={styles.postComposeAuthorHeader}>
                  {activeComposerAuthor.avatarUrl ? <Image source={{ uri: activeComposerAuthor.avatarUrl }} style={styles.postComposeAuthorAvatar} /> : <View style={styles.postComposeAuthorAvatar}><Text style={styles.postComposeAuthorInitial}>{getAvatarInitial(activeComposerAuthor.name)}</Text></View>}
                  <View style={styles.postComposeAuthorBody}>
                    <VerifiedName badgeSize={13} isVerified={Boolean(activeComposerAuthor.isVerified)} name={activeComposerAuthor.name} style={styles.postAuthorName} />
                    <Text numberOfLines={1} style={styles.postAuthorUsername}>@{activeComposerAuthor.username ?? username}</Text>
                  </View>
                </View>
                  <TextInput autoFocus maxLength={280} multiline onChangeText={(value) => { setText(value); if (!value) setComposerTextHeight(21); }} onContentSizeChange={({ nativeEvent }) => setComposerTextHeight(Math.max(21, Math.ceil(nativeEvent.contentSize.height)))} placeholder="Что нового?" placeholderTextColor="#7d8894" scrollEnabled={false} style={[styles.postComposeInput, { height: composerTextHeight }]} textAlignVertical="top" value={text} />
                  {images.length ? <View style={styles.postComposerImages}>{images.map((uri, index) => <View key={`${uri}-${index}`} style={[styles.postComposerImageWrap, images.length === 1 && styles.postComposerImageWrapSingle]}><Image source={{ uri }} style={styles.postComposerImage} /><Pressable accessibilityLabel="Удалить изображение" hitSlop={6} onPress={() => setImages((current) => current.filter((_, itemIndex) => itemIndex !== index))} style={[styles.postComposerRemoveButton, styles.postRemoveMedia]}><X color="#6f7b86" size={17} strokeWidth={1.9} /></Pressable></View>)}</View> : null}
                  {youtube ? <View style={styles.postSelectedVideo}><Video color="#111" size={22} strokeWidth={1.8} /><View style={styles.postTrackCopy}><Text numberOfLines={1} style={styles.postTrackTitle}>YouTube</Text><Text numberOfLines={1} style={styles.postTrackArtist}>{youtube.url}</Text></View><Pressable accessibilityLabel="Убрать видео" hitSlop={6} onPress={() => { setYoutube(null); setYoutubeInput(''); }} style={styles.postComposerRemoveButton}><X color="#6f7b86" size={17} strokeWidth={1.9} /></Pressable></View> : null}
                  {audioRelease ? <AudioReleaseAttachmentCard onRemove={() => setAudioRelease(null)} release={audioRelease} /> : null}
                  {music.map((item, index) => item.kind === 'bandcamp' && item.releaseMetadata
                    ? <AudioReleaseAttachmentCard key={`${item.kind}:${item.url}:${index}`} onRemove={() => setMusic((current) => current.filter((_, itemIndex) => itemIndex !== index))} release={{ id: `external:${item.releaseMetadata.externalUrl}`, provider: 'bandcamp', releaseUrl: item.releaseMetadata.externalUrl, embedUrl: null, genres: [], releaseDate: '', createdAt: '', metadata: item.releaseMetadata }} />
                    : <ComposerMusicAttachment key={`${item.kind}:${index}`} music={item} onRemove={() => setMusic((current) => current.filter((_, itemIndex) => itemIndex !== index))} queueItems={music} queuePosition={index} queueScope="composer" />)}
                  {composerPoll ? <Pressable accessibilityHint="Откроются настройки опроса" accessibilityLabel="Редактировать опрос" accessibilityRole="button" onPress={openPollEditor}><PostPollCard poll={composerPoll} /></Pressable> : null}
                  {mentionSuggestions.length ? <View style={styles.postMentionSuggestions}>{mentionSuggestions.map((item) => <Pressable key={`${item.entityType}:${item.id}`} onPress={() => { setText((current) => current.replace(/@([a-z0-9_]{3,30})$/i, `@${item.username} `)); setMentionSuggestions([]); }} style={styles.postMentionSuggestion}>{item.avatarUrl ? <Image source={{ uri: item.avatarUrl }} style={styles.postMentionAvatar} /> : <View style={styles.postMentionAvatar}><Text style={styles.postMentionAvatarText}>{getAvatarInitial(item.name)}</Text></View>}<View style={styles.postTrackCopy}><Text style={styles.postAuthorName}>{item.name}</Text><Text style={styles.postAuthorUsername}>@{item.username} · {item.entityType === 'account' ? 'Профиль' : 'Сообщество'}</Text></View></Pressable>)}</View> : null}
                  {repostTarget ? <QuotedPostCard onOpenPost={onOpenPost} onOpenProfile={onOpenProfile} onOpenPublicPage={onOpenPublicPage} post={repostTarget} /> : null}
              </View>
            </ScrollView>
            <View style={[
              styles.postComposeToolbar,
              Platform.OS === 'web' && {
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: composerViewport.keyboardVisible ? composerViewport.bottomInset : 0,
                zIndex: 10,
              },
            ]}>
              <Pressable accessibilityLabel="Добавить изображения" accessibilityState={{ disabled: images.length >= 5 || Boolean(youtube) }} disabled={images.length >= 5 || Boolean(youtube)} onPress={() => void pickImage()} style={[styles.postComposeTool, (images.length >= 5 || Boolean(youtube)) && styles.postComposeToolDisabled]}><ImagePlus color={images.length >= 5 || youtube ? '#98a3ae' : '#111'} size={23} /></Pressable>
              <Pressable accessibilityLabel="Добавить видео YouTube" accessibilityState={{ disabled: Boolean(images.length) }} disabled={Boolean(images.length)} onPress={() => { setYoutubeInput(youtube?.url ?? ''); setYoutubeError(null); setIsYoutubeOpen(true); requestAnimationFrame(() => Keyboard.dismiss()); }} style={[styles.postComposeTool, images.length > 0 && styles.postComposeToolDisabled]}><Video color={images.length ? '#98a3ae' : '#111'} size={23} /></Pressable>
              <Pressable accessibilityLabel="Добавить музыку" accessibilityState={{ disabled: music.length + (audioRelease ? 1 : 0) >= 5 }} disabled={music.length + (audioRelease ? 1 : 0) >= 5} onPress={() => { setIsMusicOpen(true); requestAnimationFrame(() => Keyboard.dismiss()); }} style={[styles.postComposeTool, music.length + (audioRelease ? 1 : 0) >= 5 && styles.postComposeToolDisabled]}><Music2 color={music.length + (audioRelease ? 1 : 0) >= 5 ? '#98a3ae' : '#111'} size={23} /></Pressable>
              <Pressable accessibilityLabel={composerPoll ? 'Редактировать опрос' : 'Добавить опрос'} onPress={openPollEditor} style={styles.postComposeTool}><ListChecks color="#111" size={22} /></Pressable>
              <Pressable accessibilityLabel={`Параметры публикации: ${interactionAudience === 'FOLLOWERS' ? 'только подписчики' : 'кто угодно'}`} accessibilityRole="button" onPress={() => { Keyboard.dismiss(); setIsPostParametersOpen(true); }} style={styles.postComposeTool}><Settings color="#111" size={22} strokeWidth={1.9} /></Pressable>
              <Text style={styles.postComposeCounter}>{text.length}/280 · {music.length + (audioRelease ? 1 : 0)}/5</Text>
            </View>
          </KeyboardAvoidingView>
          <MusicPickerModal isVisible={isMusicOpen} onClose={() => setIsMusicOpen(false)} onSelect={(selected) => { setMusic((current) => current.length + (audioRelease ? 1 : 0) >= 5 ? current : [...current, selected]); setIsMusicOpen(false); }} />
          <AppSheetModal isVisible={isYoutubeOpen} onClose={() => setIsYoutubeOpen(false)} title="Добавить видео">
            <Text style={styles.youtubePickerHint}>Вставьте ссылку на видео YouTube</Text>
            <View style={styles.youtubePickerInputRow}>
              <TextInput
                accessibilityLabel="Ссылка на видео YouTube"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                onChangeText={(value) => { setYoutubeInput(value); if (youtubeError) setYoutubeError(null); }}
                onSubmitEditing={() => { if (youtubeValidation.status === 'valid') attachYoutube(); }}
                placeholder="youtube.com или youtu.be"
                placeholderTextColor="#8e99a4"
                returnKeyType="done"
                style={styles.youtubePickerInput}
                value={youtubeInput}
              />
              <Pressable accessibilityLabel={youtubeValidation.status === 'checking' ? 'Проверяем видео' : 'Прикрепить видео'} accessibilityRole="button" accessibilityState={{ disabled: youtubeValidation.status !== 'valid', busy: youtubeValidation.status === 'checking' }} disabled={youtubeValidation.status !== 'valid'} onPress={attachYoutube} style={[styles.youtubePickerSubmit, youtubeValidation.status !== 'valid' && styles.youtubePickerSubmitDisabled]}>{youtubeValidation.status === 'checking' ? <ActivityIndicator color="#fff" size="small" /> : <Check color="#fff" size={21} strokeWidth={2.2} />}</Pressable>
            </View>
            {youtubeError || youtubeValidation.error ? <Text style={styles.youtubePickerError}>{youtubeError || youtubeValidation.error}</Text> : null}
          </AppSheetModal>
          <AppSheetModal isVisible={isPollEditorOpen} onClose={() => setIsPollEditorOpen(false)} title={composerPoll ? 'Редактировать опрос' : 'Добавить опрос'}>
            <View style={styles.postPollModalEditor}>
              <TextInput autoFocus maxLength={200} onChangeText={setPollDraftQuestion} placeholder="Вопрос" placeholderTextColor="#98a3ae" style={styles.postPollQuestionInput} value={pollDraftQuestion} />
              {pollDraftOptions.map((option, index) => <View key={index} style={styles.postPollOptionEditorRow}>{pollDraftMultiple ? <Square color="#6f7b86" size={20} strokeWidth={1.8} /> : <Circle color="#6f7b86" size={20} strokeWidth={1.8} />}<TextInput maxLength={100} onChangeText={(value) => setPollDraftOptions((current) => current.map((item, itemIndex) => itemIndex === index ? value : item))} placeholder={`Вариант ${index + 1}`} placeholderTextColor="#98a3ae" style={styles.postPollOptionInput} value={option} />{pollDraftOptions.length > 2 ? <Pressable accessibilityLabel={`Удалить вариант ${index + 1}`} hitSlop={8} onPress={() => setPollDraftOptions((current) => current.filter((_, itemIndex) => itemIndex !== index))}><X color="#6f7b86" size={18} /></Pressable> : null}</View>)}
              {pollDraftOptions.length < 20 ? <Pressable accessibilityRole="button" onPress={() => setPollDraftOptions((current) => [...current, ''])} style={styles.postPollAddOption}><Plus color="#111" size={18} /><Text style={styles.postPollAddOptionText}>Добавить вариант</Text><Text style={styles.postPollLimit}>{pollDraftOptions.length}/20</Text></Pressable> : null}
              <View style={styles.postPollSetting}><View style={styles.postPollSettingCopy}><Text style={styles.postPollSettingTitle}>Анонимный опрос</Text><Text style={styles.postPollSettingHint}>Имена проголосовавших не показываются.</Text></View><VolnaSwitch accessibilityLabel="Анонимный опрос" onValueChange={setPollDraftAnonymous} value={pollDraftAnonymous} /></View>
              <View style={styles.postPollSetting}><View style={styles.postPollSettingCopy}><Text style={styles.postPollSettingTitle}>Несколько ответов</Text><Text style={styles.postPollSettingHint}>Можно выбрать больше одного варианта.</Text></View><VolnaSwitch accessibilityLabel="Несколько ответов" onValueChange={setPollDraftMultiple} value={pollDraftMultiple} /></View>
              <Pressable accessibilityRole="button" disabled={!pollDraftQuestion.trim() || pollDraftOptions.length < 2 || pollDraftOptions.some((option) => !option.trim())} onPress={savePollDraft} style={[styles.postPollModalSubmit, (!pollDraftQuestion.trim() || pollDraftOptions.length < 2 || pollDraftOptions.some((option) => !option.trim())) && styles.postComposePublishDisabled]}><Text style={styles.postComposePublishText}>{composerPoll ? 'Сохранить' : 'Добавить опрос'}</Text></Pressable>
              {composerPoll ? <Pressable accessibilityRole="button" onPress={() => { setPollQuestion(''); setPollOptions([]); setPollAnonymous(false); setPollMultiple(false); setIsPollEditorOpen(false); }} style={styles.postPollModalDelete}><Text style={styles.postPollModalDeleteText}>Удалить опрос</Text></Pressable> : null}
            </View>
          </AppSheetModal>
          <AppSheetModal isVisible={isPostParametersOpen} onClose={() => setIsPostParametersOpen(false)} title="Параметры публикации">
            <Text style={styles.postParametersSheetHint}>Кто может отвечать и репостить</Text>
            <View style={styles.postParametersOptions}>
              {([{ value: 'EVERYONE', label: 'Кто угодно' }, { value: 'FOLLOWERS', label: 'Только подписчики' }] as const).map((option) => {
                const selected = interactionAudience === option.value;
                return <Pressable accessibilityRole="radio" accessibilityState={{ checked: selected }} key={option.value} onPress={() => { setInteractionAudience(option.value); setIsPostParametersOpen(false); }} style={[styles.postParametersOption, selected && styles.postParametersOptionSelected]}><Text style={[styles.postParametersOptionText, selected && styles.postParametersOptionTextSelected]}>{option.label}</Text>{selected ? <Check color="#fff" size={20} strokeWidth={2.2} /> : null}</Pressable>;
              })}
            </View>
          </AppSheetModal>
        </View>
      </Modal> : null}
      {posts.slice(0, maxItems).map((post, index, visiblePosts) => <PostCard compact={feed} key={post.id} onComment={() => { if (!focusPostId) void onOpenPost?.(post); }} onLike={() => void toggleLike(post.id)} onOpenActions={(anchor) => { setPostActionsAnchor(anchor); setReportTarget(post); }} onOpenPost={onOpenPost} onOpenProfile={onOpenProfile} onOpenPublicPage={onOpenPublicPage} onPollVote={(optionId) => void votePoll(post, optionId)} onRepost={() => { if (!post.canRepost) { Alert.alert('Репост недоступен', 'Автор разрешил репосты только подписчикам.'); return; } setRepostTarget(post); setIsComposerOpen(true); }} onSend={() => setDirectShareTarget(post)} post={post} separated={feed && index < visiblePosts.length - 1} thread={threadLayout} />)}
      {isLoading ? <View style={styles.loadingRow}><ActivityIndicator color="#111" /></View> : null}
      {isLoadingMore ? <View style={styles.loadingRow}><ActivityIndicator color="#111" /></View> : null}
      {focusPostId && !isLoading ? <View style={styles.postDiscussion}>
        <View style={styles.postDiscussionHeader}>
          <View style={styles.postCommentSortWrap}>
            <Pressable accessibilityLabel="Сортировка ответов" accessibilityRole="button" accessibilityState={{ expanded: isCommentSortOpen }} onPress={() => setIsCommentSortOpen((current) => !current)} style={styles.postCommentSortButton}>
              <Text style={styles.postCommentSortButtonText}>{commentSort === 'popular' ? 'Популярные' : 'Недавние'}</Text>
              <ChevronDown color="#6f7b86" size={15} strokeWidth={1.8} />
            </Pressable>
            {isCommentSortOpen ? <View accessibilityRole="menu" style={styles.postCommentSortMenu}>
              {([{ value: 'popular', label: 'Популярные' }, { value: 'recent', label: 'Недавние' }] as const).map((option) => <Pressable accessibilityRole="menuitem" key={option.value} onPress={() => { setCommentSort(option.value); setIsCommentSortOpen(false); }} style={styles.postCommentSortOption}><Text style={styles.postCommentSortOptionText}>{option.label}</Text>{commentSort === option.value ? <Check color="#111" size={18} strokeWidth={2} /> : null}</Pressable>)}
            </View> : null}
          </View>
          <View style={styles.postDiscussionCountWrap}><Text style={styles.postDiscussionTitle}>Ответы</Text><Text style={styles.postDiscussionCount}>{commentTotalCount}</Text></View>
        </View>
        {comments.length ? <View style={styles.postCommentList}>{comments.map((comment) => <PostCommentCard comment={comment} key={comment.id} onDelete={() => void deleteComment(comment)} onLike={() => void toggleCommentLike(comment.id)} onOpenProfile={onOpenProfile} onOpenPublicPage={onOpenPublicPage} onReply={() => { setReplyTarget(comment); }} />)}</View> : !isCommentsLoading ? <Text style={styles.postDiscussionEmpty}>Начните обсуждение первым</Text> : null}
        {commentCursor ? <Pressable accessibilityRole="button" disabled={isCommentsLoading} onPress={() => void loadMoreComments()} style={styles.postCommentsMore}><Text style={styles.postCommentsMoreText}>Показать ещё ответы</Text></Pressable> : null}
        {isCommentsLoading ? <View style={styles.loadingRow}><ActivityIndicator color="#111" /></View> : null}
      </View> : null}
      </View>
      </FeedBody>
      {focusPostId && !isLoading ? posts[0]?.canReply === false ? <Text style={styles.postInteractionRestricted}>Отвечать на эту публикацию могут только подписчики автора.</Text> : <View style={[styles.postCommentComposer, threadLayout && styles.postThreadCommentComposer, threadLayout && globalAudio.activeTrack && styles.postThreadCommentComposerWithPlayer]}>
          {replyTarget ? <View style={styles.postReplyTarget}><Text numberOfLines={1} style={styles.postReplyTargetText}>Ответ для @{replyTarget.author.username}</Text><Pressable accessibilityLabel="Отменить ответ" hitSlop={8} onPress={() => setReplyTarget(null)}><X color="#6f7b86" size={17} /></Pressable></View> : null}
          {commentImageUri ? <View style={styles.postCommentAttachmentPreview}><Image source={{ uri: commentImageUri }} style={styles.postCommentAttachmentImage} /><Pressable accessibilityLabel="Убрать изображение" hitSlop={6} onPress={() => setCommentImageUri(null)} style={[styles.postComposerRemoveButton, styles.postCommentAttachmentRemove]}><X color="#6f7b86" size={17} /></Pressable></View> : null}
          {commentYoutube ? <View style={styles.postCommentAttachmentPreview}><YouTubePostEmbed startSeconds={commentYoutube.startSeconds} videoId={commentYoutube.videoId} /><Pressable accessibilityLabel="Убрать видео" onPress={() => setCommentYoutube(null)} style={[styles.postComposerRemoveButton, styles.postCommentAttachmentRemove]}><X color="#6f7b86" size={17} /></Pressable></View> : null}
          {commentMusic.length ? <View style={styles.postCommentMusicList}>{commentMusic.map((item, index) => <ComposerMusicAttachment key={`${item.kind}-${index}`} music={item} onRemove={() => setCommentMusic((current) => current.filter((_, itemIndex) => itemIndex !== index))} />)}</View> : null}
          <View style={styles.postCommentComposerRow}>
            <Pressable accessibilityLabel={commentPages.length ? 'Выбрать автора комментария' : `Автор комментария: ${commentAccountAuthor?.name ?? username}`} accessibilityRole={commentPages.length ? 'button' : undefined} accessibilityState={{ disabled: !commentPages.length, expanded: commentPages.length ? isCommentDestinationOpen : undefined }} disabled={!commentPages.length} onPress={() => { Keyboard.dismiss(); setIsCommentDestinationOpen(true); }} style={styles.postCommentAuthorAvatarButton}>
              {(selectedCommentPage?.avatarUrl ?? commentAccountAuthor?.avatarUrl) ? <Image source={{ uri: selectedCommentPage?.avatarUrl ?? commentAccountAuthor?.avatarUrl ?? '' }} style={styles.postCommentAuthorAvatar} /> : <View style={styles.postCommentAuthorAvatar}><Text style={styles.postRepostDestinationInitial}>{getAvatarInitial(selectedCommentPage?.name ?? commentAccountAuthor?.name ?? username)}</Text></View>}
            </Pressable>
            <TextInput accessibilityLabel="Комментарий" maxLength={280} onChangeText={setCommentText} placeholder="Комментарий" placeholderTextColor="#7d8894" style={styles.postCommentInput} value={commentText} />
            <Pressable accessibilityLabel="Прикрепить вложение" onPress={() => setIsCommentAttachmentOpen(true)} style={styles.postCommentIconButton}><Paperclip color="#7d8894" size={21} strokeWidth={1.9} /></Pressable>
            <Pressable accessibilityLabel="Отправить ответ" accessibilityRole="button" disabled={(!commentText.trim() && !commentImageUri && !commentYoutube && !commentMusic.length) || isCommentSaving} onPress={() => void publishComment()} style={[styles.postCommentSend, ((!commentText.trim() && !commentImageUri && !commentYoutube && !commentMusic.length) || isCommentSaving) && styles.postCommentSendDisabled]}>{isCommentSaving ? <ActivityIndicator color="#111" size="small" /> : <Send color="#111" size={21} strokeWidth={2} />}</Pressable>
          </View>
        </View> : null}
      <AppSheetModal contentContainerStyle={styles.postCommentAuthorSheetContent} isVisible={isCommentDestinationOpen && commentPages.length > 0} onClose={() => setIsCommentDestinationOpen(false)} title="От чьего имени">
        <Pressable onPress={() => { setCommentDestination({ type: 'account' }); setIsCommentDestinationOpen(false); }} style={[styles.postRepostDestinationOption, styles.postCommentAuthorSheetOption]}>{commentAccountAuthor?.avatarUrl ? <Image source={{ uri: commentAccountAuthor.avatarUrl }} style={styles.postRepostDestinationAvatar} /> : <View style={styles.postRepostDestinationIcon}><Text style={styles.postRepostDestinationInitial}>{getAvatarInitial(commentAccountAuthor?.name ?? username)}</Text></View>}<View style={styles.postTrackCopy}><Text numberOfLines={1} style={styles.postRepostDestinationOptionText}>{commentAccountAuthor?.name ?? 'Личный профиль'}</Text><Text numberOfLines={1} style={styles.postRepostDestinationUsername}>@{commentAccountAuthor?.username ?? username}</Text></View>{commentDestination.type === 'account' ? <Check color="#198f45" size={20} strokeWidth={2.2} /> : null}</Pressable>
        {commentPages.map((page) => <Pressable key={page.id} onPress={() => { setCommentDestination({ type: 'community', username: page.username }); setIsCommentDestinationOpen(false); }} style={[styles.postRepostDestinationOption, styles.postCommentAuthorSheetOption]}>{page.avatarUrl ? <Image source={{ uri: page.avatarUrl }} style={styles.postRepostDestinationAvatar} /> : <View style={styles.postRepostDestinationIcon}><Text style={styles.postRepostDestinationInitial}>{getAvatarInitial(page.name)}</Text></View>}<View style={styles.postTrackCopy}><Text numberOfLines={1} style={styles.postRepostDestinationOptionText}>{page.name}</Text><Text numberOfLines={1} style={styles.postRepostDestinationUsername}>@{page.username}</Text></View>{commentDestination.type === 'community' && commentDestination.username === page.username ? <Check color="#198f45" size={20} strokeWidth={2.2} /> : null}</Pressable>)}
      </AppSheetModal>
      <AppSheetModal isVisible={isCommentAttachmentOpen} onClose={() => setIsCommentAttachmentOpen(false)} title="Прикрепить к ответу">
        <Pressable onPress={() => void pickCommentImage()} style={[styles.safetyAction, styles.eventShareAction]}><ImagePlus color="#111" size={21} /><Text style={styles.safetyActionText}>Изображение</Text></Pressable>
        <Pressable onPress={() => { setIsCommentAttachmentOpen(false); setCommentYoutubeInput(commentYoutube?.url ?? ''); setIsCommentYoutubeOpen(true); }} style={[styles.safetyAction, styles.eventShareAction]}><Video color="#111" size={21} /><Text style={styles.safetyActionText}>Видео YouTube</Text></Pressable>
        <Pressable disabled={commentMusic.length >= 3} onPress={() => { setIsCommentAttachmentOpen(false); setIsCommentMusicOpen(true); }} style={[styles.safetyAction, styles.eventShareAction, commentMusic.length >= 3 && styles.postComposeToolDisabled]}><Music2 color={commentMusic.length >= 3 ? '#98a3ae' : '#111'} size={21} /><Text style={styles.safetyActionText}>Музыка · {commentMusic.length}/3</Text></Pressable>
      </AppSheetModal>
      <AppSheetModal isVisible={isCommentYoutubeOpen} onClose={() => setIsCommentYoutubeOpen(false)} title="Добавить видео">
        <View style={styles.youtubePickerInputRow}><TextInput autoCapitalize="none" autoCorrect={false} keyboardType="url" onChangeText={setCommentYoutubeInput} onSubmitEditing={() => { if (commentYoutubeValidation.status === 'valid') attachCommentYoutube(); }} placeholder="youtube.com или youtu.be" placeholderTextColor="#8e99a4" style={styles.youtubePickerInput} value={commentYoutubeInput} /><Pressable accessibilityLabel={commentYoutubeValidation.status === 'checking' ? 'Проверяем видео' : 'Прикрепить видео'} accessibilityState={{ disabled: commentYoutubeValidation.status !== 'valid', busy: commentYoutubeValidation.status === 'checking' }} disabled={commentYoutubeValidation.status !== 'valid'} onPress={attachCommentYoutube} style={[styles.youtubePickerSubmit, commentYoutubeValidation.status !== 'valid' && styles.youtubePickerSubmitDisabled]}>{commentYoutubeValidation.status === 'checking' ? <ActivityIndicator color="#fff" size="small" /> : <Check color="#fff" size={21} />}</Pressable></View>
        {commentYoutubeValidation.error ? <Text style={styles.youtubePickerError}>{commentYoutubeValidation.error}</Text> : null}
      </AppSheetModal>
      <MusicPickerModal isVisible={isCommentMusicOpen} onClose={() => setIsCommentMusicOpen(false)} onSelect={(selected) => { setCommentImageUri(null); setCommentYoutube(null); setCommentMusic((current) => [...current, selected].slice(0, 3)); setIsCommentMusicOpen(false); }} />
      {!isLoading && !posts.length && !canCreate && emptyMessage ? <View style={styles.emptyProfileTab}><Text style={styles.emptyProfileTabTitle}>{emptyMessage}</Text></View> : null}
      <EntityShareModal authToken={authToken} chatPostId={directShareTarget?.id} isVisible={Boolean(directShareTarget)} onChatSent={(sharesCount) => setPosts((current) => current.map((post) => post.id === directShareTarget?.id ? { ...post, sharesCount } : post))} onClose={() => setDirectShareTarget(null)} onNotify={(message, type) => { if (type === 'error') notifyOperationalError(message); }} shareText={directShareTarget ? `https://volna.social/posts/${directShareTarget.id}` : ''} shareTitle="Публикация" shareUrl={directShareTarget ? `https://volna.social/posts/${directShareTarget.id}` : ''} subjectLabel="Публикация" />
      <PostActionsPopover anchor={postActionsAnchor} canDelete={Boolean(reportTarget?.canDelete)} isVisible={Boolean(reportTarget)} onClose={closePostActions} onDelete={deletePost} onReport={(reason) => void reportPost(reason)} showReasons={showReportReasons} onShowReasons={() => setShowReportReasons(true)} />
    </View>
  );
}

function PostCard({ post, compact = false, separated = false, thread = false, onComment, onLike, onOpenActions, onOpenPost, onOpenProfile, onOpenPublicPage, onPollVote, onRepost, onSend }: { post: AppPost; compact?: boolean; separated?: boolean; thread?: boolean; onComment: () => void; onLike: () => void; onOpenActions: (anchor: { x: number; y: number }) => void; onOpenPost?: (post: AppPost | QuotedPost) => Promise<void>; onOpenProfile: (username: string) => Promise<void>; onOpenPublicPage: (username: string) => Promise<void>; onPollVote: (optionId: string) => void; onRepost: () => void; onSend: () => void }) {
  const openAuthor = () => post.author.entityType === 'community'
    ? onOpenPublicPage(post.author.username)
    : onOpenProfile(post.author.username);
  const avatarStyle = [styles.postAuthorAvatar, thread && styles.postThreadAuthorAvatar];
  const avatar = <Pressable accessibilityLabel={`Открыть ${post.author.entityType === 'community' ? 'сообщество' : 'профиль'} ${post.author.name}`} accessibilityRole="link" onPress={() => void openAuthor()} style={thread ? undefined : styles.postAuthorAvatarLink}>{post.author.avatarUrl ? <Image source={{ uri: post.author.avatarUrl }} style={avatarStyle} /> : <View style={avatarStyle}><Text style={styles.postAuthorAvatarText}>{getAvatarInitial(post.author.name)}</Text></View>}</Pressable>;
  const identity = <View style={styles.postAuthorRow}><Pressable accessibilityLabel={`Открыть ${post.author.name}`} accessibilityRole="link" onPress={() => void openAuthor()} style={[styles.postAuthorIdentity, thread && styles.postThreadAuthorCopy]}><VerifiedName badgeSize={13} isVerified={post.author.isVerified} name={post.author.name} style={styles.postAuthorName} /><Text numberOfLines={1} style={styles.postAuthorUsername}>@{post.author.username} · {formatPostDate(post.createdAt)}</Text></Pressable><Pressable accessibilityLabel="Действия с публикацией" accessibilityRole="button" hitSlop={8} onPress={(event) => onOpenActions({ x: event.nativeEvent.pageX, y: event.nativeEvent.pageY })} style={styles.postMoreButton}><EllipsisVertical color="#6f7b86" size={19} strokeWidth={1.8} /></Pressable></View>;

  return <View style={[styles.postCard, compact && styles.feedPostCard, separated && styles.feedPostSeparator, thread && styles.postThreadCard]}>
    {thread ? <View style={styles.postThreadAuthorHeader}>{avatar}<View style={styles.postThreadAuthorIdentity}>{identity}</View></View> : avatar}
    <View style={styles.postBody}>
      {!thread ? identity : null}
      {post.text ? <MentionText onOpenPost={() => void onOpenPost?.(post)} onOpenProfile={onOpenProfile} onOpenPublicPage={onOpenPublicPage} text={post.text} /> : null}
      {post.images.length ? <PostImageCarousel images={post.images} /> : null}
      {post.youtubeVideoId ? <YouTubePostEmbed startSeconds={post.youtubeStartSeconds} videoId={post.youtubeVideoId} /> : null}
      {post.telegramAttachment && post.telegramEmbed ? <TelegramAttachmentCard attachment={post.telegramAttachment} embed={post.telegramEmbed} /> : null}
      {post.musicAttachments?.length ? <View style={styles.postMusicAttachmentList}>{post.musicAttachments.map((item, index) => <ComposerMusicAttachment key={`${item.kind}:${index}`} music={item} queueItems={post.musicAttachments} queuePosition={index} queueScope={`post:${post.id}`} />)}</View> : null}
      {!post.musicAttachments?.length && post.trackTitle && !(post.trackProvider === 'bandcamp' && post.bandcampMusicUrl) ? <PostTrack post={post} /> : null}
      {post.audioRelease ? <AudioReleaseAttachmentCard release={post.audioRelease} /> : null}
      {!post.musicAttachments?.length && post.trackProvider === 'bandcamp' && post.bandcampMusicUrl && !post.audioRelease ? <BandcampReleaseUrlCard releaseUrl={post.bandcampMusicUrl} /> : null}
      {!post.musicAttachments?.length && !post.trackTitle && (post.soundcloudMusicUrl || (post.bandcampMusicUrl && post.trackProvider !== 'bandcamp')) ? <PostExternalMusic post={post} /> : null}
      {post.poll ? <PostPollCard onVote={onPollVote} poll={post.poll} /> : null}
      {post.originalPost ? <QuotedPostCard onOpenPost={onOpenPost} onOpenProfile={onOpenProfile} onOpenPublicPage={onOpenPublicPage} post={post.originalPost} /> : null}
      <View style={styles.postActions}>
        <Pressable accessibilityLabel={post.viewerLiked ? 'Убрать лайк' : 'Поставить лайк'} accessibilityRole="button" onPress={onLike} style={styles.postAction}><Heart color={post.viewerLiked ? '#e53935' : '#6f7b86'} fill={post.viewerLiked ? '#e53935' : 'transparent'} size={19} strokeWidth={1.8} /><Text style={[styles.postActionCount, post.viewerLiked && styles.postActionCountLiked]}>{post.likesCount}</Text></Pressable>
        <Pressable accessibilityLabel="Открыть обсуждение" accessibilityRole="button" onPress={onComment} style={styles.postAction}><MessageCircle color="#6f7b86" size={19} strokeWidth={1.8} /><Text style={styles.postActionCount}>{post.commentsCount}</Text></Pressable>
        <Pressable accessibilityLabel="Сделать репост с комментарием" accessibilityRole="button" onPress={onRepost} style={styles.postAction}><Repeat2 color="#6f7b86" size={20} strokeWidth={1.8} /><Text style={styles.postActionCount}>{post.repostsCount}</Text></Pressable>
        <Pressable accessibilityLabel="Отправить публикацию в личные сообщения" accessibilityRole="button" onPress={onSend} style={styles.postAction}><Send color="#6f7b86" size={19} strokeWidth={1.8} /><Text style={styles.postActionCount}>{post.sharesCount}</Text></Pressable>
      </View>
    </View>
  </View>;
}

function PostCommentCard({ comment, onDelete, onLike, onOpenProfile, onOpenPublicPage, onReply }: { comment: PostCommentItem; onDelete: () => void; onLike: () => void; onOpenProfile: (username: string) => Promise<void>; onOpenPublicPage: (username: string) => Promise<void>; onReply: () => void }) {
  const openAuthor = () => comment.author.entityType === 'community'
    ? onOpenPublicPage(comment.author.username)
    : onOpenProfile(comment.author.username);
  return <View style={[styles.postCommentCard, comment.parentId && styles.postCommentCardNested]}>
    <Pressable accessibilityLabel={`Открыть профиль ${comment.author.name}`} onPress={() => void openAuthor()}>{comment.author.avatarUrl ? <Image source={{ uri: comment.author.avatarUrl }} style={styles.postCommentAvatar} /> : <View style={styles.postCommentAvatar}><Text style={styles.postAuthorAvatarText}>{getAvatarInitial(comment.author.name)}</Text></View>}</Pressable>
    <View style={styles.postCommentBody}>
      <View style={styles.postCommentAuthorRow}><Pressable onPress={() => void openAuthor()} style={styles.postCommentAuthorCopy}><VerifiedName badgeSize={12} isVerified={comment.author.isVerified} name={comment.author.name} style={styles.postAuthorName} /><Text style={styles.postAuthorUsername}>@{comment.author.username} · {formatPostDate(comment.createdAt)}</Text></Pressable>{comment.canDelete && !comment.isDeleted ? <Pressable accessibilityLabel="Удалить ответ" hitSlop={8} onPress={onDelete}><Trash2 color="#8e99a4" size={17} strokeWidth={1.8} /></Pressable> : null}</View>
      {comment.isDeleted ? <Text style={styles.postCommentDeleted}>Ответ удалён</Text> : comment.text ? <MentionText onOpenProfile={onOpenProfile} onOpenPublicPage={onOpenPublicPage} prefixUsername={comment.replyToUsername} text={comment.text} /> : null}
      {!comment.isDeleted && comment.imageUrl ? <Image source={{ uri: postImageThumbnail(comment.imageUrl) ?? comment.imageUrl }} style={styles.postCommentImage} /> : null}
      {!comment.isDeleted && comment.youtubeVideoId ? <YouTubePostEmbed startSeconds={comment.youtubeStartSeconds} videoId={comment.youtubeVideoId} /> : null}
      {!comment.isDeleted && comment.musicAttachments.length ? <View style={styles.postCommentMusicList}>{comment.musicAttachments.map((music, index) => <ComposerMusicAttachment key={`${music.kind}-${index}`} music={music} queueItems={comment.musicAttachments} queuePosition={index} queueScope={`comment:${comment.id}`} />)}</View> : null}
      {!comment.isDeleted ? <View style={styles.postCommentActions}><Pressable accessibilityLabel={comment.viewerLiked ? 'Убрать лайк с ответа' : 'Поставить лайк ответу'} accessibilityRole="button" onPress={onLike} style={styles.postCommentAction}><Heart color={comment.viewerLiked ? '#111' : '#6f7b86'} fill={comment.viewerLiked ? '#111' : 'transparent'} size={18} strokeWidth={1.8} />{comment.likesCount ? <Text style={styles.postActionCount}>{comment.likesCount}</Text> : null}</Pressable><Pressable accessibilityLabel="Ответить" accessibilityRole="button" onPress={onReply} style={styles.postCommentAction}><CornerUpLeft color="#6f7b86" size={18} strokeWidth={1.8} /><Text style={styles.postCommentReplyLabel}>Ответить</Text></Pressable></View> : null}
    </View>
  </View>;
}

function PostImageCarousel({ images }: { images: Array<{ id: string; imageUrl: string }> }) {
  const viewport = useWindowDimensions();
  const [width, setWidth] = useState(0);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const gap = 6;
  const itemWidth = images.length === 1 ? width : Math.round(width * 0.75);
  const snapInterval = itemWidth + gap;

  return <>
    <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)} style={styles.postImageCarouselViewport}>
      {width ? <ScrollView
        contentContainerStyle={styles.postImageCarouselContent}
        decelerationRate="fast"
        horizontal
        nestedScrollEnabled
        showsHorizontalScrollIndicator={false}
        snapToAlignment="start"
        snapToInterval={snapInterval}
      >
        {images.map((image, index) => <Pressable accessibilityLabel={`Открыть фотографию ${index + 1} из ${images.length}`} accessibilityRole="button" key={image.id} onPress={() => setPreviewIndex(index)} style={[styles.postImageCarouselItem, { width: itemWidth }]}><Image resizeMode="cover" source={{ uri: postImageThumbnail(image.imageUrl) ?? image.imageUrl }} style={styles.postImageCarouselImage} /></Pressable>)}
      </ScrollView> : null}
    </View>
    <Modal animationType="fade" onRequestClose={() => setPreviewIndex(null)} statusBarTranslucent transparent visible={previewIndex !== null}>
      <View style={styles.postImagePreviewBackdrop}>
        <Pressable accessibilityLabel="Закрыть просмотр фотографии" accessibilityRole="button" hitSlop={8} onPress={() => setPreviewIndex(null)} style={styles.postImagePreviewClose}><X color="#fff" size={29} strokeWidth={1.8} /></Pressable>
        <ScrollView
          contentOffset={{ x: (previewIndex ?? 0) * viewport.width, y: 0 }}
          horizontal
          onMomentumScrollEnd={(event) => setPreviewIndex(Math.max(0, Math.min(images.length - 1, Math.round(event.nativeEvent.contentOffset.x / viewport.width))))}
          pagingEnabled
          showsHorizontalScrollIndicator={false}
        >
          {images.map((image, index) => <View key={image.id} style={[styles.postImagePreviewPage, { width: viewport.width }]}><Image accessibilityLabel={`Фотография ${index + 1} из ${images.length}`} resizeMode="contain" source={{ uri: image.imageUrl }} style={styles.postImagePreviewImage} /></View>)}
        </ScrollView>
        {images.length > 1 && previewIndex !== null ? <View pointerEvents="none" style={styles.postImagePreviewCounter}><Text style={styles.postImagePreviewCounterText}>{previewIndex + 1}/{images.length}</Text></View> : null}
      </View>
    </Modal>
  </>;
}

function PostActionsPopover({ anchor, canDelete, isVisible, onClose, onDelete, onReport, onShowReasons, showReasons }: { anchor: { x: number; y: number }; canDelete: boolean; isVisible: boolean; onClose: () => void; onDelete: () => void; onReport: (reason: 'SPAM' | 'HARASSMENT' | 'IMPERSONATION' | 'ILLEGAL_CONTENT' | 'OTHER') => void; onShowReasons: () => void; showReasons: boolean }) {
  const viewport = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [isMounted, setIsMounted] = useState(isVisible);
  const [displayCanDelete, setDisplayCanDelete] = useState(canDelete);
  const [displayShowReasons, setDisplayShowReasons] = useState(showReasons);
  const visibility = useRef(new Animated.Value(0)).current;
  const reasons = [
    { label: 'Спам', value: 'SPAM' as const },
    { label: 'Оскорбления или преследование', value: 'HARASSMENT' as const },
    { label: 'Выдаёт себя за другого', value: 'IMPERSONATION' as const },
    { label: 'Незаконный контент', value: 'ILLEGAL_CONTENT' as const },
    { label: 'Другое', value: 'OTHER' as const },
  ];
  const menuWidth = Math.min(260, Math.max(230, viewport.width * 0.62), viewport.width - 24);
  const menuHeight = displayShowReasons ? 300 : displayCanDelete ? 100 : 50;
  const left = Math.max(12, Math.min(anchor.x - menuWidth + 22, viewport.width - menuWidth - 12));
  const top = Math.max(insets.top + 8, Math.min(anchor.y + 14, viewport.height - insets.bottom - menuHeight - 12));
  const frostedItemStyle = Platform.OS === 'web' ? ({
    backdropFilter: 'blur(18px) saturate(150%)',
    WebkitBackdropFilter: 'blur(18px) saturate(150%)',
  } as never) : null;

  useEffect(() => {
    if (!isVisible) return;
    setDisplayCanDelete(canDelete);
    setDisplayShowReasons(showReasons);
  }, [canDelete, isVisible, showReasons]);

  useEffect(() => {
    visibility.stopAnimation();
    if (isVisible) {
      setIsMounted(true);
      visibility.setValue(0);
      requestAnimationFrame(() => Animated.spring(visibility, {
        toValue: 1,
        damping: 18,
        mass: 0.65,
        overshootClamping: true,
        stiffness: 280,
        useNativeDriver: false,
      }).start());
      return;
    }
    Animated.spring(visibility, {
      toValue: 0,
      damping: 18,
      mass: 0.65,
      overshootClamping: true,
      stiffness: 280,
      useNativeDriver: false,
    }).start(({ finished }) => { if (finished) setIsMounted(false); });
  }, [isVisible, visibility]);

  return <Modal animationType="none" onRequestClose={onClose} statusBarTranslucent transparent visible={isMounted}>
    <View style={styles.postActionsPopoverLayer}>
      <Pressable accessibilityLabel="Закрыть меню публикации" onPress={onClose} style={styles.postActionsPopoverBackdrop} />
      <Animated.View accessibilityRole="menu" style={[
        styles.postActionsPopover,
        {
          height: visibility.interpolate({ inputRange: [0, 1], outputRange: [0, menuHeight] }),
          left,
          opacity: visibility.interpolate({ inputRange: [0, 0.08, 1], outputRange: [0, 1, 1] }),
          top,
          width: menuWidth,
        },
      ]}>
        {displayShowReasons ? <>
          <Pressable accessibilityRole="button" onPress={onClose} style={[styles.postActionsPopoverHeading, frostedItemStyle]}><Text style={styles.postActionsPopoverHeadingText}>Причина жалобы</Text><X color="#6f7b86" size={19} strokeWidth={1.9} /></Pressable>
          {reasons.map((reason, index) => <Pressable accessibilityRole="menuitem" key={reason.value} onPress={() => onReport(reason.value)} style={[styles.postActionsPopoverRow, frostedItemStyle, index === reasons.length - 1 && styles.postActionsPopoverRowLast]}><Text style={styles.postActionsPopoverText}>{reason.label}</Text><Flag color="#111" size={21} strokeWidth={1.8} /></Pressable>)}
        </> : <>
          {displayCanDelete ? <Pressable accessibilityRole="menuitem" onPress={onDelete} style={[styles.postActionsPopoverRow, frostedItemStyle]}><Text style={[styles.postActionsPopoverText, styles.safetyDangerText]}>Удалить публикацию</Text><Trash2 color="#e53935" size={21} strokeWidth={1.8} /></Pressable> : null}
          <Pressable accessibilityRole="menuitem" onPress={onShowReasons} style={[styles.postActionsPopoverRow, frostedItemStyle, styles.postActionsPopoverRowLast]}><Text style={styles.postActionsPopoverText}>Пожаловаться</Text><Flag color="#111" size={21} strokeWidth={1.8} /></Pressable>
        </>}
      </Animated.View>
    </View>
  </Modal>;
}

function QuotedPostCard({ post, onOpenPost, onOpenProfile, onOpenPublicPage }: { post: QuotedPost | AppPost; onOpenPost?: (post: AppPost | QuotedPost) => Promise<void>; onOpenProfile: (username: string) => Promise<void>; onOpenPublicPage: (username: string) => Promise<void> }) {
  if (post.isDeleted) return <View style={[styles.quotedPostCard, styles.quotedPostDeleted]}><Text style={styles.quotedPostDeletedText}>Публикация удалена</Text></View>;
  return <Pressable accessibilityLabel={`Открыть публикацию ${post.author.name}`} accessibilityRole="button" disabled={!onOpenPost} onPress={() => void onOpenPost?.(post)} style={styles.quotedPostCard}>
    <View style={styles.quotedPostAuthorRow}>{post.author.avatarUrl ? <Image source={{ uri: post.author.avatarUrl }} style={styles.quotedPostAvatar} /> : <View style={styles.quotedPostAvatar}><Text style={styles.postAuthorAvatarText}>{getAvatarInitial(post.author.name)}</Text></View>}<View style={styles.postTrackCopy}><VerifiedName badgeGap={6} badgeSize={13} isVerified={post.author.isVerified} name={post.author.name} style={styles.postAuthorName} /><Text numberOfLines={1} style={styles.postAuthorUsername}>@{post.author.username} · {formatPostDate(post.createdAt)}</Text></View></View>
    {post.text ? <MentionText onOpenProfile={onOpenProfile} onOpenPublicPage={onOpenPublicPage} text={post.text} /> : null}
    {post.images.length ? <Image source={{ uri: postImageThumbnail(post.images[0].imageUrl) ?? post.images[0].imageUrl }} style={styles.quotedPostImage} /> : null}
    {post.youtubeVideoId ? <YouTubePostEmbed startSeconds={post.youtubeStartSeconds} videoId={post.youtubeVideoId} /> : null}
    {post.telegramAttachment && post.telegramEmbed ? <TelegramAttachmentCard attachment={post.telegramAttachment} compact embed={post.telegramEmbed} /> : null}
    {post.audioRelease ? <AudioReleaseAttachmentCard release={post.audioRelease} /> : null}
    {post.musicAttachments?.length ? <View style={styles.postMusicAttachmentList}>{post.musicAttachments.map((item, index) => <ComposerMusicAttachment key={`${item.kind}:${index}`} music={item} queueItems={post.musicAttachments} queuePosition={index} queueScope={`quoted-post:${post.id}`} />)}</View> : null}
    {!post.musicAttachments?.length && post.trackTitle && !(post.trackProvider === 'bandcamp' && post.bandcampMusicUrl) ? <PostTrack post={post} /> : null}
    {!post.musicAttachments?.length && post.trackProvider === 'bandcamp' && post.bandcampMusicUrl && !post.audioRelease ? <BandcampReleaseUrlCard releaseUrl={post.bandcampMusicUrl} /> : null}
    {!post.musicAttachments?.length && !post.trackTitle && (post.soundcloudMusicUrl || (post.bandcampMusicUrl && post.trackProvider !== 'bandcamp')) ? <PostExternalMusic post={post} /> : null}
    {post.poll ? <PostPollCard poll={post.poll} /> : null}
  </Pressable>;
}

function TelegramAttachmentCard({ attachment, compact = false, embed }: { attachment: NonNullable<AppPost['telegramAttachment']>; compact?: boolean; embed: NonNullable<AppPost['telegramEmbed']> }) {
  const insets = useSafeAreaInsets();
  const [isOpen, setIsOpen] = useState(false);
  const isVideo = attachment.kind === 'VIDEO' || attachment.kind === 'ANIMATION';
  const isAudio = attachment.kind === 'AUDIO' || attachment.kind === 'VOICE';
  const Icon = isVideo ? Video : isAudio ? Headphones : FileText;
  const details = [formatTelegramFileSize(attachment.size), formatTelegramDuration(attachment.duration)].filter(Boolean).join(' · ');
  const externalTelegramUrl = normalizeExternalHttpsUrl(embed.url, ['t.me', 'telegram.me']);
  return <>
    <Pressable accessibilityHint="Откроется исходная публикация Telegram" accessibilityLabel={`Открыть ${attachment.title || 'вложение'} в Telegram`} accessibilityRole="button" onPress={() => setIsOpen(true)} style={[styles.telegramAttachmentCard, compact && styles.telegramAttachmentCardCompact]}>
      <View style={styles.telegramAttachmentIcon}><Icon color="#111" size={compact ? 20 : 24} strokeWidth={1.8} /></View>
      <View style={styles.telegramAttachmentCopy}><Text numberOfLines={1} style={styles.telegramAttachmentTitle}>{attachment.title || (isVideo ? 'Видео' : isAudio ? 'Аудио' : 'Файл')}</Text>{details ? <Text style={styles.telegramAttachmentMeta}>{details}</Text> : null}<Text style={styles.telegramAttachmentAction}>Открыть в Telegram</Text></View>
      <ExternalLink color="#6f7b86" size={19} strokeWidth={1.8} />
    </Pressable>
    <Modal animationType="slide" onRequestClose={() => setIsOpen(false)} statusBarTranslucent transparent visible={isOpen}>
      <View style={styles.telegramEmbedModalBackdrop}>
        <View style={[styles.telegramEmbedModal, { paddingTop: Math.max(12, insets.top) }]}>
          <View style={styles.telegramEmbedModalHeader}><Text style={styles.telegramEmbedModalTitle}>{attachment.title || 'Telegram'}</Text><Pressable accessibilityLabel="Закрыть Telegram" accessibilityRole="button" hitSlop={8} onPress={() => setIsOpen(false)} style={styles.telegramEmbedModalClose}><X color="#111" size={25} strokeWidth={1.9} /></Pressable></View>
          <ScrollView contentContainerStyle={styles.telegramEmbedModalContent} showsVerticalScrollIndicator={false}><TelegramPostEmbed {...embed} /></ScrollView>
          {externalTelegramUrl ? <Pressable accessibilityLabel="Открыть публикацию в приложении Telegram" accessibilityRole="link" onPress={() => void openExternalHttpsUrl(externalTelegramUrl, ['t.me', 'telegram.me'])} style={[styles.telegramEmbedOpenButton, { marginBottom: Math.max(12, insets.bottom) }]}><Text style={styles.telegramEmbedOpenButtonText}>Открыть в Telegram</Text><ExternalLink color="#fff" size={17} /></Pressable> : null}
        </View>
      </View>
    </Modal>
  </>;
}

function formatTelegramFileSize(value: string | null) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1000))} КБ`;
  return `${(bytes / 1_000_000).toFixed(bytes >= 10_000_000 ? 0 : 1).replace('.', ',')} МБ`;
}

function formatTelegramDuration(value: number | null) {
  if (!value || value <= 0) return '';
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function formatPostDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const now = new Date();
  const elapsedMs = now.getTime() - date.getTime();
  if (elapsedMs >= 0 && elapsedMs < 86_400_000) {
    const elapsedMinutes = Math.floor(elapsedMs / 60_000);
    if (elapsedMinutes < 1) return 'только что';
    if (elapsedMinutes < 60) return `${elapsedMinutes} мин`;
    return `${Math.floor(elapsedMinutes / 60)} ч`;
  }

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const postDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayDifference = Math.round((today.getTime() - postDay.getTime()) / 86_400_000);
  const time = new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);

  if (dayDifference === 0) return `сегодня в ${time}`;
  if (dayDifference === 1) return `вчера в ${time}`;

  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date).replace(',', '');
}

function PostPollCard({ poll, onVote }: { poll: NonNullable<AppPost['poll']>; onVote?: (optionId: string) => void }) {
  const totalVotes = poll.options.reduce((sum, option) => sum + option.votesCount, 0);
  return <View style={styles.postPollCard}>
    <Text style={styles.postPollQuestion}>{poll.question}</Text>
    <Text style={styles.postPollMeta}>{poll.isAnonymous ? 'Анонимный опрос' : 'Открытый опрос'} · {poll.allowsMultiple ? 'несколько ответов' : 'один ответ'}</Text>
    <View style={styles.postPollOptions}>{poll.options.map((option) => {
      const selected = poll.viewerOptionIds.includes(option.id);
      const percentage = totalVotes ? Math.round((option.votesCount / totalVotes) * 100) : 0;
      return <Pressable accessibilityLabel={`${option.text}, ${percentage}%`} accessibilityRole="button" disabled={!onVote} key={option.id} onPress={() => onVote?.(option.id)} style={[styles.postPollOption, selected && styles.postPollOptionSelected]}>
        <View style={styles.postPollOptionIcon}>{selected ? <Check color="#fff" size={14} strokeWidth={2.4} /> : poll.allowsMultiple ? <Square color="#6f7b86" size={19} strokeWidth={1.8} /> : <Circle color="#6f7b86" size={19} strokeWidth={1.8} />}</View>
        <Text style={[styles.postPollOptionText, selected && styles.postPollOptionTextSelected]}>{option.text}</Text>
        <Text style={[styles.postPollPercentage, selected && styles.postPollOptionTextSelected]}>{percentage}%</Text>
      </Pressable>;
    })}</View>
    <Text style={styles.postPollVoters}>{poll.totalVoters} {poll.totalVoters === 1 ? 'голос' : poll.totalVoters >= 2 && poll.totalVoters <= 4 ? 'голоса' : 'голосов'}</Text>
  </View>;
}

function MentionText({ text, prefixUsername, onOpenPost, onOpenProfile, onOpenPublicPage }: { text: string; prefixUsername?: string | null; onOpenPost?: () => void; onOpenProfile: (username: string) => Promise<void>; onOpenPublicPage: (username: string) => Promise<void> }) {
  const parts = text.split(/(@[a-z0-9_]{3,30})/gi);
  return <Text accessibilityRole={onOpenPost ? 'button' : undefined} onPress={onOpenPost} style={styles.postText}>{prefixUsername ? <Text onPress={(event) => { event.stopPropagation(); void onOpenProfile(prefixUsername); }} style={styles.postMention}>@{prefixUsername} </Text> : null}{parts.map((part, index) => part.startsWith('@') ? <Text key={index} onPress={(event) => { event.stopPropagation(); void onOpenProfile(part.slice(1)).catch(() => onOpenPublicPage(part.slice(1))); }} style={styles.postMention}>{part}</Text> : <Text key={index}>{part}</Text>)}</Text>;
}

function playablePostMusicAttachment(
  music: PostMusicAttachment,
  queueScope: string,
  sourceIndex: number,
): GlobalTrackQueueItem | null {
  const title = music.kind === 'track'
    ? music.track.title
    : music.kind === 'uploaded'
      ? music.title
      : music.title || (music.kind === 'soundcloud' ? 'SoundCloud' : 'Bandcamp');
  const artist = music.kind === 'track'
    ? music.track.artist
    : music.kind === 'uploaded'
      ? music.artist || 'VOLNA'
      : music.artist || (music.kind === 'soundcloud' ? 'SoundCloud' : 'Bandcamp');
  const artworkUrl = music.kind === 'track'
    ? music.track.artworkUrl
    : music.kind === 'uploaded'
      ? music.artworkUrl
      : music.artworkUrl;
  return music.kind === 'track'
    ? {
        id: `${queueScope}:${sourceIndex}:${music.track.provider}:${music.track.id}`,
        title,
        artist,
        artworkUrl,
        previewUrl: music.track.previewUrl.startsWith('/') ? `${apiUrl}${music.track.previewUrl}` : music.track.previewUrl,
        externalUrl: music.track.externalUrl,
        provider: music.track.provider,
        startSeconds: music.startSeconds,
        clipDurationSeconds: music.clipDurationSeconds,
      }
    : music.kind === 'uploaded'
      ? {
          id: `${queueScope}:${sourceIndex}:volna:${music.trackId}`,
          title,
          artist,
          artworkUrl,
          previewUrl: `${apiUrl}/my-music/stream/${encodeURIComponent(music.trackId)}`,
          provider: 'volna' as const,
        }
      : music.kind === 'soundcloud'
        ? {
            id: `${queueScope}:${sourceIndex}:soundcloud:${music.url}`,
            title,
            artist,
            artworkUrl,
            previewUrl: music.url,
            externalUrl: music.url,
            sourceTrackUrl: music.url,
            provider: 'soundcloud' as const,
          }
        : null;
}

function ComposerMusicAttachment({
  music,
  onRemove,
  queueItems,
  queuePosition = 0,
  queueScope = 'composer',
}: {
  music: PostMusicAttachment;
  onRemove?: () => void;
  queueItems?: PostMusicAttachment[];
  queuePosition?: number;
  queueScope?: string;
}) {
  const globalAudio = useGlobalAudioControls();
  const title = music.kind === 'track'
    ? music.track.title
    : music.kind === 'uploaded'
      ? music.title
      : music.title || (music.kind === 'soundcloud' ? 'SoundCloud' : 'Bandcamp');
  const artist = music.kind === 'track'
    ? music.track.artist
    : music.kind === 'uploaded'
      ? music.artist || 'VOLNA'
      : music.artist || (music.kind === 'soundcloud' ? 'SoundCloud' : 'Bandcamp');
  const artworkUrl = music.kind === 'track'
    ? music.track.artworkUrl
    : music.kind === 'uploaded'
      ? music.artworkUrl
      : music.artworkUrl;
  const playableTrack = playablePostMusicAttachment(music, queueScope, queuePosition);
  const playbackQueue = (queueItems ?? [music]).flatMap((item, index) => {
    const itemTrack = playablePostMusicAttachment(item, queueScope, queueItems ? index : queuePosition);
    return itemTrack ? [itemTrack] : [];
  });
  const playbackQueueIndex = playableTrack
    ? playbackQueue.findIndex((item) => item.id === playableTrack.id)
    : -1;
  const isPlaying = Boolean(playableTrack && globalAudio.isTrackPlaying(playableTrack.id));
  const toggle = () => {
    if (!playableTrack) return;
    if (isPlaying) {
      globalAudio.pause();
      return;
    }
    void globalAudio.play({
      ...playableTrack,
      queue: playbackQueue.length > 1 ? playbackQueue : undefined,
      queueIndex: playbackQueueIndex >= 0 ? playbackQueueIndex : undefined,
    });
  };

  return <View style={[styles.postTrack, styles.postComposerTrack]}>
    {artworkUrl
      ? <Image source={{ uri: artworkUrl }} style={styles.postTrackArtwork} />
      : <View style={[styles.postTrackArtwork, styles.postComposerTrackArtworkFallback]}><Music2 color="#6f7b86" size={19} strokeWidth={1.8} /></View>}
    <View style={styles.postTrackCopy}>
      <Text numberOfLines={1} style={styles.postTrackTitle}>{title}</Text>
      <Text numberOfLines={1} style={styles.postTrackArtist}>{artist}</Text>
    </View>
    {playableTrack ? <Pressable accessibilityLabel={isPlaying ? `Поставить ${title} на паузу` : `Воспроизвести ${title}`} accessibilityRole="button" onPress={toggle} style={styles.postTrackPlayButton}>
      {isPlaying ? <Pause color="#fff" size={13} /> : <Play color="#fff" fill="#fff" size={12} />}
    </Pressable> : null}
    {onRemove ? <Pressable accessibilityLabel="Убрать музыку" accessibilityRole="button" hitSlop={6} onPress={onRemove} style={styles.postComposerRemoveButton}>
      <X color="#6f7b86" size={17} strokeWidth={1.9} />
    </Pressable> : null}
  </View>;
}

function PostTrack({ post }: { post: AppPost | Exclude<QuotedPost, { isDeleted: true }> }) {
  const resolvedPreviewUrl = post.trackPreviewUrl?.startsWith('/') ? `${apiUrl}${post.trackPreviewUrl}` : post.trackPreviewUrl;
  const globalAudio = useGlobalAudioControls();
  const trackId = `post:${post.id}`;
  const isPlaying = globalAudio.isTrackPlaying(trackId);
  const toggle = async () => {
    if (!resolvedPreviewUrl || !post.trackTitle) return;
    if (isPlaying) { globalAudio.pause(); return; }
    await globalAudio.play({ id: trackId, title: post.trackTitle, artist: post.trackArtist, artworkUrl: post.trackArtworkUrl, previewUrl: resolvedPreviewUrl, externalUrl: post.trackExternalUrl, sourceTrackUrl: post.trackExternalUrl ?? undefined, provider: post.trackProvider ?? undefined, startSeconds: post.trackStartSeconds, clipDurationSeconds: post.trackClipDurationSeconds });
  };

  return <Pressable disabled={!resolvedPreviewUrl} onPress={() => void toggle()} style={styles.postTrack}>
    {post.trackArtworkUrl ? <Image source={{ uri: post.trackArtworkUrl }} style={styles.postTrackArtwork} /> : null}
    <View style={styles.postTrackCopy}><Text numberOfLines={1} style={styles.postTrackTitle}>{post.trackTitle}</Text><Text numberOfLines={1} style={styles.postTrackArtist}>{post.trackArtist}</Text></View>
    {resolvedPreviewUrl ? <View style={styles.postTrackPlayButton}>{isPlaying ? <Pause color="#fff" size={13} /> : <Play color="#fff" fill="#fff" size={12} />}</View> : null}
  </Pressable>;
}

function PostExternalMusic({ post }: { post: AppPost | Exclude<QuotedPost, { isDeleted: true }> }) {
  const url = post.soundcloudMusicUrl || post.bandcampMusicUrl;
  const safeUrl = normalizeExternalHttpsUrl(url);
  if (!safeUrl) return null;
  const provider = post.soundcloudMusicUrl ? 'SoundCloud' : 'Bandcamp';
  return <Pressable onPress={() => void openExternalHttpsUrl(safeUrl)} style={[styles.postTrack, styles.postExternalTrack]}>
    <Music2 color="#111" size={18} />
    <View style={styles.postTrackCopy}><Text numberOfLines={1} style={styles.postTrackTitle}>{provider}</Text><Text numberOfLines={1} style={styles.postTrackArtist}>Открыть источник</Text></View>
  </Pressable>;
}
