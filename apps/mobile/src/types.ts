export type ProfileEvent = {
  id: string;
  organizerPageId: string;
  organizerPage: {
    id: string;
    username: string;
    name: string;
  };
  title: string;
  type: string;
  typeLabel: string;
  startsAt: string;
  endsAt: string;
  about: string | null;
  countryName: string;
  cityName: string;
  venueName: string;
  venuePageId: string | null;
  venueUsername: string | null;
  venueAddress: string;
  posterUrl: string | null;
  posterOriginalUrl?: string | null;
  goingCount: number;
  watchingCount: number;
  myParticipationStatus: EventParticipationStatus | null;
};

export type BandcampReleaseSnapshot = {
  title: string;
  artist: string;
  artworkUrl: string | null;
  externalUrl: string;
  releaseDate?: string | null;
  tracks: Array<{ id: string; title: string; artist: string; artworkUrl: string | null; previewUrl: string | null; externalUrl: string; durationSeconds: number | null }>;
};

export type MusicReleaseParticipant =
  | { entityType: 'account' | 'community'; id: string; username: string; name: string; avatarUrl: string | null; isVerified: boolean }
  | { entityType: 'text'; name: string };

export type ProfileMusicTrack = {
  id: string;
  provider: 'apple' | 'yandex' | 'soundcloud' | 'bandcamp' | 'youtube';
  title: string;
  artist: string;
  artworkUrl: string | null;
  previewUrl: string;
  externalUrl: string;
  startSeconds: number;
  clipDurationSeconds: number;
  durationSeconds: number | null;
  previewDurationSeconds: number;
  isPrimary: boolean;
  genres?: string[];
  participants?: MusicReleaseParticipant[];
  releaseId?: string | null;
  labelName?: string | null;
  labelUsername?: string | null;
  releaseDate?: string | null;
  addedAt?: string | null;
  releaseMetadata?: BandcampReleaseSnapshot | null;
  embedUrl?: string | null;
  entityType?: 'track' | 'album' | null;
};

export type PostMusicAttachment = {
  kind: 'track';
  track: AppleMusicTrack;
  startSeconds: number;
  clipDurationSeconds: number;
} | {
  kind: 'soundcloud' | 'bandcamp' | 'youtube';
  url: string;
  title?: string;
  artist?: string;
  artworkUrl?: string | null;
  releaseMetadata?: BandcampReleaseSnapshot | null;
} | {
  kind: 'uploaded';
  trackId: string;
  title: string;
  artist: string | null;
  artworkUrl: string | null;
};

export type ConnectPhoto = { imageKey: string; imageUrl: string };

export type Profile = {
  id: string;
  createdAt: string;
  username: string;
  name: string;
  countryName: string;
  countryCode?: string;
  cityName: string;
  cityId: string | null;
  about: string;
  avatarUrl: string | null;
  avatarOriginalUrl?: string | null;
  avatarKey: string | null;
  trackTitle: string | null;
  trackArtist: string | null;
  trackArtworkUrl: string | null;
  trackPreviewUrl: string | null;
  trackExternalUrl: string | null;
  trackProvider: string | null;
  trackStartSeconds: number;
  trackClipDurationSeconds: number;
  trackDurationSeconds: number | null;
  trackPreviewDurationSeconds: number;
  sharePlaybackActivity: boolean;
  currentPlayback: ProfilePlaybackActivity | null;
  musicTracks: ProfileMusicTrack[];
  artistReleases: PublicPageAudioRelease[];
  uploadedMusicTracks: PublicUploadedMusicTrack[];
  soundcloudMusicUrl: string | null;
  bandcampMusicUrl: string | null;
  bandcampMusicEmbedUrl: string | null;
  musicGenres: string[];
  bandcampUrl: string | null;
  soundcloudUrl: string | null;
  spotifyUrl: string | null;
  instagramUrl: string | null;
  threadsUrl: string | null;
  telegramUrl: string | null;
  youtubeUrl: string | null;
  letterboxdUrl: string | null;
  followersCount: number;
  followingCount: number;
  isFollowing: boolean;
  followStatus: 'ACTIVE' | 'PENDING' | null;
  isPrivate: boolean;
  messagePrivacy: ApiMessagePrivacy;
  readReceiptsPrivacy: ApiMessagePrivacy;
  invisibleMode: boolean;
  showSavedMusicOnProfile: boolean;
  showUploadedMusicOnProfile: boolean;
  showBirthYear: boolean;
  connectEnabled: boolean;
  connectGoals: ConnectGoal[];
  connectInterests: string[];
  connectPhotos: ConnectPhoto[];
  connectAbout: string;
  connectFaceVerified?: boolean;
  gender: Gender | null;
  isInformational: boolean;
  canManageInformationalProfile?: boolean;
  isVerified: boolean;
  upcoming: ProfileEvent[];
  planned: ProfileEvent[];
  pastUpcoming: ProfileEvent[];
  pastPlanned: ProfileEvent[];
  favoriteLocations: FavoriteLocation[];
};

export type ProfilePlaybackActivity = {
  id: string;
  title: string;
  artist: string | null;
  artworkUrl: string | null;
  previewUrl: string;
  externalUrl: string | null;
  provider: 'soundcloud' | 'bandcamp' | 'youtube' | 'volna' | 'apple' | 'yandex';
  startSeconds: number;
  clipDurationSeconds: number;
  isLiveStream: boolean;
  radioStationName: string | null;
};

export type FavoriteLocation = { id: string; username: string; name: string; cityName: string; countryName: string; avatarUrl: string | null; type: string };

export type Account = {
  id: string;
  username: string;
  name: string;
  avatarUrl: string | null;
  countryName: string;
  cityName: string;
  cityId: string | null;
  messagePrivacy: ApiMessagePrivacy;
  readReceiptsPrivacy: ApiMessagePrivacy;
  invisibleMode: boolean;
  showSavedMusicOnProfile: boolean;
  showUploadedMusicOnProfile: boolean;
  showBirthYear: boolean;
  connectEnabled: boolean;
  connectGoals: ConnectGoal[];
  connectInterests: string[];
  gender: Gender | null;
  role: 'USER' | 'MODERATOR' | 'ADMIN';
  mustChangePassword: boolean;
  isVerified: boolean;
  profileType: 'REGULAR' | 'SUBSCRIBER';
  subscriptionExpiresAt: string | null;
};

export type Session = {
  token: string;
  account: Account;
};

export type AppTab = 'feed' | 'events' | 'locations' | 'community' | 'music' | 'messages' | 'profile';
export type ProfileMode =
  | 'view'
  | 'edit'
  | 'editAdminProfile'
  | 'settings'
  | 'security'
  | 'messageSecurity'
  | 'subscription'
  | 'notifications'
  | 'moderation'
  | 'admin'
  | 'messages'
  | 'chat'
  | 'myCommunities'
  | 'myMusic'
  | 'createCommunity'
  | 'createEvent'
  | 'editCommunity'
  | 'communityCabinet'
  | 'publicPage'
  | 'notFound'
  | 'ownProfile';
export type ProfileContentTab = 'events' | 'music' | 'locations' | 'feed' | 'photos';
export type PublicPageContentTab = 'events' | 'music' | 'team' | 'partners' | 'products' | 'feed' | 'photos';
export type PublicPageListTab = 'locations' | 'organizations';
export type MessagePrivacy = 'everyone' | 'following' | 'nobody';
export type ApiMessagePrivacy = 'EVERYONE' | 'FOLLOWING' | 'NOBODY';
export type ConnectGoal = 'ANY' | 'COLLABORATION' | 'FRIENDSHIP' | 'DATING' | 'VOLUNTEERS' | 'EMPLOYEES';
export type Gender = 'MALE' | 'FEMALE' | 'OTHER';
export type NavigationState = {
  activeTab: AppTab;
  profileMode: ProfileMode;
  profile: Profile | null;
  profileContentTab: ProfileContentTab;
  publicPage: PublicPageDetail | null;
  publicPageContentTab: PublicPageContentTab;
  chatUsername: string | null;
  postId: string | null;
  eventId: string | null;
  browserPath: string | null;
};

export type CursorPage<T> = { items: T[]; nextCursor: string | null };
export type ToastMessage = {
  id: number;
  message: string;
  type: 'success' | 'error';
};
export type PublicAccount = Pick<
  Profile,
  | 'id'
  | 'username'
  | 'name'
  | 'countryName'
  | 'cityName'
  | 'cityId'
  | 'about'
  | 'isPrivate'
  | 'connectEnabled'
  | 'connectGoals'
  | 'connectInterests'
  | 'connectPhotos'
  | 'connectAbout'
  | 'avatarUrl'
  | 'followersCount'
  | 'followingCount'
  | 'trackTitle'
  | 'trackArtist'
  | 'trackArtworkUrl'
  | 'trackArtworkUrl'
  | 'trackPreviewUrl'
  | 'trackExternalUrl'
  | 'trackProvider'
  | 'trackStartSeconds'
  | 'trackClipDurationSeconds'
  | 'musicGenres'
  | 'invisibleMode'
  | 'isInformational'
  | 'isVerified'
> & {
  age: number | null;
  viewerConnectLiked?: boolean;
  connectRankPrimary?: number;
  connectRankSecondary?: number;
  connectDistanceKm?: number | null;
};
export type AvatarCropAsset = {
  uri: string;
  width: number;
  height: number;
  mimeType: string;
};
export type PublicPage = {
  id: string;
  username: string;
  ownerId: string | null;
  owner?: Pick<Profile, 'id' | 'username' | 'name' | 'avatarUrl' | 'isVerified'> | null;
  moderationStatus?: 'PENDING' | 'APPROVED' | 'REJECTED';
  type: string;
  typeLabel: string;
  locationCategories?: string[];
  name: string;
  countryName: string;
  cityName: string;
  cityId: string | null;
  address: string | null;
  contactPhone: string | null;
  websiteUrl: string | null;
  radioStreamUrl: string | null;
  musicLabelName: string | null;
  musicLabelGenres: string[];
  trackTitle: string | null;
  trackArtist: string | null;
  trackArtworkUrl: string | null;
  trackPreviewUrl: string | null;
  trackExternalUrl: string | null;
  trackProvider: string | null;
  trackStartSeconds: number;
  trackClipDurationSeconds: number;
  trackDurationSeconds: number | null;
  trackPreviewDurationSeconds: number;
  bandcampUrl: string | null;
  soundcloudUrl: string | null;
  spotifyUrl: string | null;
  instagramUrl: string | null;
  threadsUrl: string | null;
  telegramUrl: string | null;
  youtubeUrl: string | null;
  letterboxdUrl: string | null;
  about: string;
  avatarUrl: string | null;
  avatarOriginalUrl?: string | null;
  avatarKey?: string | null;
  isPrivate: boolean;
  followersCount: number;
  isFollowing: boolean;
  isFavorite: boolean;
  followStatus: 'ACTIVE' | 'PENDING' | null;
  connectEnabled: boolean;
  connectGoals: ConnectGoal[];
  connectAbout: string;
  connectPhotos: ConnectPhoto[];
  connectImageUrl: string | null;
  connectImageKey?: string | null;
  isVerified: boolean;
  managementPermissions?: PublicPagePermission[];
  connectRankPrimary?: number;
  connectRankSecondary?: number;
  connectDistanceKm?: number | null;
};
export type PublicPagePermission =
  | 'PROFILE_EDIT'
  | 'CONNECT_MANAGE'
  | 'PUBLICATIONS_MANAGE'
  | 'MEDIA_MANAGE'
  | 'MUSIC_MANAGE'
  | 'EVENTS_MANAGE'
  | 'PRODUCTS_MANAGE'
  | 'TEAM_MANAGE'
  | 'PARTNERS_MANAGE'
  | 'MEMBERSHIP_MANAGE'
  | 'TELEGRAM_FEED_MANAGE'
  | 'NOTIFICATIONS_VIEW'
  | 'MESSAGES_MANAGE'
  | 'ADMINISTRATORS_MANAGE';
export type PublicPageTeamMember = {
  id: string;
  roleTitle: string | null;
  account: Pick<Profile, 'id' | 'username' | 'name' | 'countryName' | 'cityName' | 'about' | 'avatarUrl'>;
};
export type PublicPageDetail = PublicPage & {
  upcomingEventsCount: number;
  audioReleasesCount: number;
  labelledReleasesCount?: number;
  teamCount: number;
  partnersCount: number;
  productsCount: number;
  team: PublicPageTeamMember[];
  partners: PartnerReference[];
  products: PublicPageProduct[];
  audioReleases: PublicPageAudioRelease[];
  administrators: Array<{ id: string; permissions: PublicPagePermission[]; account: Pick<Profile, 'id' | 'username' | 'name' | 'avatarUrl'> }>;
  myPermissions: PublicPagePermission[];
};
export type PublicPageProduct = {
  id: string;
  name: string;
  description: string | null;
  priceLabel: string | null;
  currency: 'RUB' | 'USD' | 'EUR';
  imageUrl: string | null;
  imageKey: string | null;
  imageUrls: string[];
  imageKeys: string[];
  orderUrl: string | null;
  isAvailable: boolean;
  sortOrder: number;
};
export type PublicPageAudioRelease = {
  id: string;
  provider: 'soundcloud' | 'bandcamp' | 'youtube';
  releaseUrl: string;
  embedUrl: string | null;
  genres: string[];
  participants?: MusicReleaseParticipant[];
  releaseDate: string;
  createdAt: string;
  labelName?: string | null;
  labelPage?: {
    id: string;
    username: string;
    name: string;
    musicLabelName: string | null;
  } | null;
  metadata: BandcampReleaseSnapshot | { title: string; artist: string; artworkUrl: string | null; externalUrl: string };
};
export type PublicPageTypeOption = {
  value: string;
  label: string;
  locationCategories?: Array<{ value: string; label: string }>;
};
export type PublicPageTypeGroup = {
  title: string;
  values: string[];
};
export type CreateCommunityInput = {
  avatarLocalUri?: string;
  username: string;
  name: string;
  type: string;
  countryName: string;
  countryCode?: string;
  cityName: string;
  cityId: string;
  address?: string;
  contactPhone?: string;
  websiteUrl?: string;
  radioStreamUrl?: string | null;
  musicLabelName?: string | null;
  musicLabelGenres?: string[];
  trackTitle?: string | null;
  trackArtist?: string | null;
  trackArtworkUrl?: string | null;
  trackPreviewUrl?: string | null;
  trackExternalUrl?: string | null;
  trackProvider?: string | null;
  trackStartSeconds?: number;
  trackClipDurationSeconds?: number;
  trackDurationSeconds?: number | null;
  trackPreviewDurationSeconds?: number;
  bandcampUrl?: string;
  soundcloudUrl?: string;
  spotifyUrl?: string;
  instagramUrl?: string;
  threadsUrl?: string;
  telegramUrl?: string;
  youtubeUrl?: string;
  letterboxdUrl?: string;
  about: string;
  isPrivate: boolean;
};
export type EventTypeOption = {
  value: string;
  label: string;
};
export type EventParticipationStatus = 'GOING' | 'WATCHING';
export type EventSummary = {
  id: string;
  organizerPageId: string;
  organizerPage: {
    id: string;
    username: string;
    name: string;
  };
  title: string;
  type: string;
  typeLabel: string;
  startsAt: string;
  endsAt: string;
  scheduleStages: string[];
  about: string | null;
  ticketUrl: string | null;
  admissionPrice: string | null;
  posterUrl: string | null;
  posterOriginalUrl?: string | null;
  countryName: string;
  cityName: string;
  venueName: string;
  venuePageId: string | null;
  venueUsername: string | null;
  venueAddress: string;
  goingCount: number;
  watchingCount: number;
  postsCount: number;
  myParticipationStatus: EventParticipationStatus | null;
  lineup: Array<{
    id: string;
    accountId: string | null;
    accountUsername: string | null;
    displayName: string;
    stageName: string | null;
    startsAt: string | null;
    endsAt: string | null;
  }>;
  partners: Array<{
    id: string;
    username: string | null;
    name: string;
    avatarUrl: string | null;
    typeLabel: string | null;
    cityName: string | null;
  }>;
};
export type EventArtistDraft = {
  id: string;
  accountUsername: string | null;
  displayName: string;
  query: string;
  stageName: string;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
};
export type CreateEventInput = {
  posterLocalUri: string;
  posterThumbnailLocalUri?: string;
  organizerPageId: string;
  venuePageId?: string;
  venueName: string;
  venueAddress: string;
  title: string;
  type: string;
  startsAt: string;
  endsAt: string;
  about?: string;
  ticketUrl?: string;
  admissionPrice?: string;
  hasTimetable: boolean;
  scheduleStages: string[];
  lineup: Array<{
    accountUsername?: string;
    displayName: string;
    stageName?: string;
    startsAt?: string;
    endsAt?: string;
  }>;
};
export type UpdateCommunityInput = CreateCommunityInput & {
  avatarUrl?: string | null;
  avatarKey?: string | null;
  connectEnabled: boolean;
  connectGoals: ConnectGoal[];
  connectAbout: string;
  connectPhotos?: ConnectPhoto[];
  connectImageUrl?: string | null;
  connectImageKey?: string | null;
  locationCategories: string[];
};
export type TeamMemberInput = {
  username: string;
  roleTitle: string;
};
export type PartnerPageInput = {
  value: string;
};
export type PartnerReference = {
  id: string;
  username: string | null;
  name: string;
  avatarUrl: string | null;
  typeLabel: string | null;
  cityName: string | null;
};
export type ProfileUpdate = Partial<Pick<
  Profile,
  | 'username'
  | 'name'
  | 'countryName'
  | 'cityName'
  | 'cityId'
  | 'cityId'
  | 'about'
  | 'connectEnabled'
  | 'connectGoals'
  | 'connectInterests'
  | 'connectPhotos'
  | 'connectAbout'
  | 'gender'
  | 'trackTitle'
  | 'trackArtist'
  | 'trackArtworkUrl'
  | 'trackPreviewUrl'
  | 'trackExternalUrl'
  | 'trackProvider'
  | 'trackStartSeconds'
  | 'trackClipDurationSeconds'
  | 'trackDurationSeconds'
  | 'trackPreviewDurationSeconds'
  | 'sharePlaybackActivity'
  | 'musicTracks'
  | 'soundcloudMusicUrl'
  | 'bandcampMusicUrl'
  | 'musicGenres'
  | 'bandcampUrl'
  | 'soundcloudUrl'
  | 'spotifyUrl'
  | 'instagramUrl'
  | 'threadsUrl'
  | 'telegramUrl'
  | 'youtubeUrl'
  | 'letterboxdUrl'
>> & { countryCode?: string; primaryUploadedMusicTrackId?: string | null };

export type UploadedMusicTrack = {
  id: string;
  title: string;
  artist: string | null;
  originalFilename: string;
  sourceMimeType: string;
  sourceCodec: string | null;
  sourceBitrateKbps: number | null;
  durationSeconds: number;
  requestedQuality: 'MP3_128' | 'AAC_128' | 'AAC_256';
  outputCodec: string | null;
  outputBitrateKbps: number | null;
  publicUrl: string | null;
  artworkUrl: string | null;
  genres: string[];
  participants: MusicReleaseParticipant[];
  releaseDate: string | null;
  status: 'PROCESSING' | 'READY' | 'FAILED';
  errorMessage: string | null;
  createdAt: string;
};

export type PublicUploadedMusicTrack = Pick<
  UploadedMusicTrack,
  'id' | 'title' | 'artist' | 'durationSeconds' | 'publicUrl' | 'artworkUrl' | 'genres' | 'participants' | 'releaseDate' | 'outputCodec' | 'outputBitrateKbps' | 'createdAt'
>;
export type AppleMusicTrack = {
  id: string;
  title: string;
  artist: string;
  album: string;
  artworkUrl: string | null;
  previewUrl: string;
  externalUrl: string;
  provider: 'apple' | 'yandex' | 'youtube';
  durationSeconds: number | null;
  previewDurationSeconds: number;
};
export type PostAuthor = { entityType: 'account' | 'community'; id: string; username: string; name: string; avatarUrl: string | null; isVerified: boolean };
export type PostPoll = {
  id: string;
  question: string;
  isAnonymous: boolean;
  allowsMultiple: boolean;
  totalVoters: number;
  viewerOptionIds: string[];
  options: Array<{ id: string; text: string; position: number; votesCount: number }>;
};
export type AppPost = {
  id: string;
  text: string;
  author: PostAuthor;
  images: Array<{ id: string; imageUrl: string; imageKey: string; position: number }>;
  trackId: string | null;
  trackProvider: 'apple' | 'yandex' | 'soundcloud' | 'bandcamp' | 'youtube' | 'volna' | null;
  trackTitle: string | null;
  trackArtist: string | null;
  trackAlbum: string | null;
  trackArtworkUrl: string | null;
  trackPreviewUrl: string | null;
  trackExternalUrl: string | null;
  trackStartSeconds: number;
  trackClipDurationSeconds: number;
  trackPreviewDurationSeconds: number;
  soundcloudMusicUrl: string | null;
  bandcampMusicUrl: string | null;
  bandcampMusicEmbedUrl: string | null;
  spotifyMusicUrl: string | null;
  spotifyMusicEmbedUrl: string | null;
  spotifyMusicType: 'track' | 'album' | null;
  youtubeVideoId: string | null;
  youtubeStartSeconds: number;
  audioReleaseId: string | null;
  audioRelease: PublicPageAudioRelease | null;
  musicAttachments: PostMusicAttachment[];
  telegramEmbed: { channelUsername: string; messageId: string; url: string } | null;
  telegramAttachment: { kind: 'VIDEO' | 'AUDIO' | 'VOICE' | 'ANIMATION' | 'DOCUMENT'; title: string | null; mimeType: string | null; size: string | null; duration: number | null } | null;
  likesCount: number;
  repostsCount: number;
  sharesCount: number;
  commentsCount: number;
  interactionAudience: 'EVERYONE' | 'FOLLOWERS';
  canReply: boolean;
  canRepost: boolean;
  viewerLiked: boolean;
  isDeleted: false;
  canDelete: boolean;
  originalPost: QuotedPost | null;
  poll: PostPoll | null;
  createdAt: string;
};
export type PostComment = {
  id: string;
  postId: string;
  parentId: string | null;
  replyToUsername: string | null;
  text: string;
  imageKey: string | null;
  imageUrl: string | null;
  youtubeVideoId: string | null;
  youtubeStartSeconds: number;
  musicAttachments: PostMusicAttachment[];
  author: PostAuthor;
  likesCount: number;
  repliesCount: number;
  viewerLiked: boolean;
  canDelete: boolean;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
};
export type QuotedPost =
  | (Omit<AppPost, 'originalPost' | 'viewerLiked' | 'likesCount' | 'repostsCount' | 'sharesCount' | 'canDelete'> & { isDeleted: false })
  | { id: string; isDeleted: true; createdAt: string; updatedAt?: string };
export type SocialLinkKind = 'bandcamp' | 'instagram' | 'letterboxd' | 'soundcloud' | 'telegram' | 'threads' | 'youtube';

