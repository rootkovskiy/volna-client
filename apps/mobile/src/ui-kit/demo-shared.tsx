import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { styles as shared } from '../styles';
import type { Profile, ToastMessage } from '../types';

export const noop = () => {};
export type DemoProps = { notify: (message: string, type?: ToastMessage['type']) => void };
export type Specimen = { id: string; category: string; title: string; description: string; source: string; render: (props: DemoProps) => ReactNode };

export const cover = (color: string) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400"><rect width="400" height="400" fill="${color}"/><circle cx="200" cy="200" r="135" fill="#111"/><circle cx="200" cy="200" r="78" fill="${color}"/><circle cx="200" cy="200" r="7" fill="#fff"/><path d="M40 360H360M40 340H150" stroke="#111" stroke-width="4"/></svg>`)}`;
export const covers = [cover('#c7d6dd'), cover('#d5ceba'), cover('#d7dad0')];
export const genres = ['Electronic > House > Acid', 'Electronic > Techno > Dub'];
export const demoProfile: Profile = {
  id: 'ui-kit', username: 'demo', name: 'Алекс', createdAt: '2026-01-01T00:00:00Z', countryName: 'Россия', cityName: 'Москва', cityId: null,
  about: '', avatarUrl: null, avatarKey: null, trackTitle: null, trackArtist: null, trackArtworkUrl: null, trackPreviewUrl: null, trackExternalUrl: null, trackProvider: null,
  trackStartSeconds: 0, trackClipDurationSeconds: 30, trackDurationSeconds: null, trackPreviewDurationSeconds: 30, sharePlaybackActivity: false, currentPlayback: null,
  musicTracks: [], artistReleases: [], uploadedMusicTracks: [], soundcloudMusicUrl: null, bandcampMusicUrl: null, bandcampMusicEmbedUrl: null, musicGenres: [],
  bandcampUrl: null, soundcloudUrl: null, spotifyUrl: null, instagramUrl: null, threadsUrl: null, telegramUrl: null, youtubeUrl: null, letterboxdUrl: null,
  followersCount: 0, followingCount: 0, isFollowing: false, followStatus: null, isPrivate: false, messagePrivacy: 'EVERYONE', readReceiptsPrivacy: 'NOBODY', invisibleMode: false,
  showSavedMusicOnProfile: true, showUploadedMusicOnProfile: true, showBirthYear: false, connectEnabled: false, connectGoals: [], connectInterests: [], connectPhotos: [], connectAbout: '', gender: null,
  isInformational: false, isVerified: true, upcoming: [], planned: [], pastUpcoming: [], pastPlanned: [], favoriteLocations: [],
};

export function Action({ children, onPress, secondary = false, disabled = false }: { children: ReactNode; onPress: () => void; secondary?: boolean; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[shared.primaryAuthButton, { marginTop: 0, paddingHorizontal: 20 }, secondary && shared.primaryAuthButtonLogin, disabled && shared.disabledButton]}><Text style={[shared.primaryAuthText, secondary && shared.primaryAuthTextLogin]}>{children}</Text></Pressable>;
}
export function Stack({ children }: { children: ReactNode }) { return <View style={{ gap: 16 }}>{children}</View>; }
export function Label({ children }: { children: ReactNode }) { return <Text style={shared.settingsLabel}>{children}</Text>; }
export function Row({ children }: { children: ReactNode }) { return <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>{children}</View>; }

