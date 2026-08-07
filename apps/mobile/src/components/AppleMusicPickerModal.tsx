import { Check, Disc3, Link2, Plus, Search } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { AppImage as Image } from './AppImage';
import { apiFetch as fetch, apiUrl, readApiError, remoteSearchDebounceMs, reportApiError } from '../api/client';
import { musicArtworkThumbnail } from '../domain';
import { styles } from '../styles';
import type { AppleMusicTrack, PostMusicAttachment, ProfileMusicTrack } from '../types';
import { AppSheetModal } from './AppSheetModal';

type ResolvedMusic =
  | { kind: 'track'; track: AppleMusicTrack }
  | { kind: 'soundcloud' | 'bandcamp'; url: string; title: string; artist: string; artworkUrl: string | null };

function attachmentDuration(track: Pick<ProfileMusicTrack, 'provider' | 'durationSeconds' | 'previewDurationSeconds'>) {
  const availableDuration = track.durationSeconds ?? track.previewDurationSeconds ?? 30;
  return track.provider === 'youtube'
    ? Math.max(1, availableDuration)
    : Math.max(10, Math.min(30, track.previewDurationSeconds || 30));
}

function attachmentFromProfileTrack(track: ProfileMusicTrack): PostMusicAttachment {
  if (track.provider === 'soundcloud' || track.provider === 'bandcamp') {
    return {
      kind: track.provider,
      url: track.externalUrl || track.previewUrl,
      title: track.title,
      artist: track.artist,
      artworkUrl: track.artworkUrl,
      releaseMetadata: track.provider === 'bandcamp' ? track.releaseMetadata ?? null : null,
    };
  }
  return {
    kind: 'track',
    track: {
      id: track.id,
      provider: track.provider,
      title: track.title,
      artist: track.artist,
      album: '',
      artworkUrl: track.artworkUrl,
      previewUrl: track.previewUrl,
      externalUrl: track.externalUrl,
      durationSeconds: track.durationSeconds,
      previewDurationSeconds: track.previewDurationSeconds,
    },
    startSeconds: track.startSeconds,
    clipDurationSeconds: track.provider === 'youtube' ? attachmentDuration(track) : track.clipDurationSeconds,
  };
}

function isSelected(value: PostMusicAttachment | null | undefined, track: ProfileMusicTrack) {
  if (value?.kind === 'track') return (track.provider === 'apple' || track.provider === 'yandex' || track.provider === 'youtube') && value.track.provider === track.provider && value.track.id === track.id;
  if (value?.kind === 'soundcloud' || value?.kind === 'bandcamp') return value.kind === track.provider && value.url === (track.externalUrl || track.previewUrl);
  return false;
}

export function MusicPickerModal({
  isVisible,
  onClose,
  onSelect,
  value,
}: {
  isVisible: boolean;
  onClose: () => void;
  onSelect: (attachment: PostMusicAttachment) => void;
  value?: PostMusicAttachment | null;
}) {
  const [url, setUrl] = useState('');
  const [tracks, setTracks] = useState<ProfileMusicTrack[]>([]);
  const [searchResults, setSearchResults] = useState<AppleMusicTrack[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isResolving, setIsResolving] = useState(false);
  const [isLoadingTracks, setIsLoadingTracks] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isVisible) return;
    setUrl('');
    setError(null);
    setIsLoadingTracks(true);
    let active = true;
    void fetch(`${apiUrl}/my-music`)
      .then(async (response) => {
        if (!response.ok) throw new Error(await readApiError(response, 'Не удалось загрузить вашу музыку'));
        return response.json() as Promise<{ profileTracks?: ProfileMusicTrack[] }>;
      })
      .then((result) => { if (active) setTracks(result.profileTracks ?? []); })
      .catch((reason) => { if (active) reportApiError(reason instanceof Error ? reason.message : 'Не удалось загрузить вашу музыку'); })
      .finally(() => { if (active) setIsLoadingTracks(false); });
    return () => { active = false; };
  }, [isVisible]);

  useEffect(() => {
    const term = url.trim();
    if (!isVisible || term.length < 2 || /^https?:\/\//i.test(term)) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }
    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      setIsSearching(true);
      setError(null);
      try {
        const providers = ['apple', 'yandex'] as const;
        const responses = await Promise.all(providers.map(async (provider) => {
          const response = await fetch(`${apiUrl}/music/${provider}/search?q=${encodeURIComponent(term)}`, { signal: controller.signal });
          if (!response.ok) return [];
          const result = await response.json() as { tracks?: AppleMusicTrack[] };
          return result.tracks ?? [];
        }));
        if (!controller.signal.aborted) {
          const combined = Array.from({ length: 4 }, (_, index) => responses.flatMap((items) => items[index] ? [items[index]] : [])).flat();
          setSearchResults(combined);
        }
      } catch (reason) {
        if (!controller.signal.aborted) reportApiError(reason instanceof Error ? reason.message : 'Не удалось найти треки');
      } finally {
        if (!controller.signal.aborted) setIsSearching(false);
      }
    }, remoteSearchDebounceMs);
    return () => { clearTimeout(timeout); controller.abort(); };
  }, [isVisible, url]);

  const close = () => {
    setUrl('');
    setSearchResults([]);
    setError(null);
    onClose();
  };

  const resolveUrl = async () => {
    const normalized = url.trim();
    if (!normalized || isResolving) return;
    setIsResolving(true);
    setError(null);
    try {
      const response = await fetch(`${apiUrl}/music/resolve?url=${encodeURIComponent(normalized)}`);
      if (!response.ok) throw new Error(await readApiError(response, 'Не удалось определить трек'));
      const resolved = await response.json() as ResolvedMusic;
      onSelect(resolved.kind === 'track'
        ? { kind: 'track', track: resolved.track, startSeconds: 0, clipDurationSeconds: attachmentDuration(resolved.track) }
        : { kind: resolved.kind, url: resolved.url, title: resolved.title, artist: resolved.artist, artworkUrl: resolved.artworkUrl });
      close();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось определить трек');
    } finally {
      setIsResolving(false);
    }
  };

  const chooseTrack = (track: ProfileMusicTrack) => {
    onSelect(attachmentFromProfileTrack(track));
    close();
  };

  const chooseSearchResult = (track: AppleMusicTrack) => {
    onSelect({ kind: 'track', track, startSeconds: 0, clipDurationSeconds: attachmentDuration(track) });
    close();
  };

  const isLink = /^https?:\/\//i.test(url.trim());

  return (
    <AppSheetModal isVisible={isVisible} onClose={close} scroll title="Прикрепить музыку">
      <View style={styles.postMusicLinkRow}>
        {isLink ? <Link2 color="#6f7b86" size={19} strokeWidth={1.9} /> : <Search color="#6f7b86" size={19} strokeWidth={1.9} />}
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
          keyboardType="default"
          onChangeText={(next) => { setUrl(next); setError(null); }}
          onSubmitEditing={() => { if (isLink) void resolveUrl(); }}
          placeholder="Ссылка или название трека"
          placeholderTextColor="#8e99a499f"
          returnKeyType="done"
          style={styles.postMusicLinkInput}
          value={url}
        />
        <Pressable accessibilityLabel="Добавить трек по ссылке" accessibilityRole="button" disabled={!isLink || isResolving} onPress={() => void resolveUrl()} style={[styles.postMusicLinkAdd, (!isLink || isResolving) && styles.postMusicLinkAddDisabled]}>
          {isResolving ? <ActivityIndicator color="#fff" size="small" /> : <Plus color="#fff" size={20} strokeWidth={2.2} />}
        </Pressable>
      </View>
      {isSearching ? <ActivityIndicator color="#111" style={styles.postMusicSearchLoader} /> : null}
      {searchResults.length ? <View style={styles.postMusicSearchResults}>{searchResults.map((track) => <Pressable accessibilityLabel={`Прикрепить ${track.title}`} accessibilityRole="button" key={`${track.provider}:${track.id}`} onPress={() => chooseSearchResult(track)} style={styles.postMusicSearchResultRow}>
        {track.artworkUrl ? <Image source={{ uri: musicArtworkThumbnail(track.artworkUrl, track.provider) ?? track.artworkUrl }} style={styles.postMusicLibraryArtwork} /> : <View style={[styles.postMusicLibraryArtwork, styles.appleMusicArtworkPlaceholder]}><Disc3 color="#6f7b86" size={20} strokeWidth={1.9} /></View>}
        <View style={styles.appleMusicResultCopy}><Text numberOfLines={1} style={styles.appleMusicResultTitle}>{track.title}</Text><Text numberOfLines={1} style={styles.appleMusicResultArtist}>{track.artist} · {track.provider === 'apple' ? 'Apple Music' : 'Яндекс Музыка'}</Text></View>
        <Plus color="#6f7b86" size={20} strokeWidth={1.9} />
      </Pressable>)}</View> : null}
      <Text style={styles.postMusicLinkHint}>YouTube, SoundCloud, Bandcamp, Apple Music или Яндекс Музыка</Text>
      {error ? <Text style={styles.appleMusicError}>{error}</Text> : null}

      <View style={styles.postMusicLibraryHeader}>
        <Text style={styles.postMusicLibraryTitle}>Мои треки</Text>
        <Text style={styles.postMusicLibraryCount}>{tracks.length}</Text>
      </View>
      {isLoadingTracks ? <ActivityIndicator color="#111" style={styles.appleMusicSearchState} /> : null}
      {!isLoadingTracks && !tracks.length ? <Text style={styles.postMusicLibraryEmpty}>Добавленные в профиль треки появятся здесь.</Text> : null}
      {tracks.length ? <View style={styles.postMusicLibraryList}>{tracks.map((track) => {
        const selected = isSelected(value, track);
        return <Pressable accessibilityLabel={`Прикрепить ${track.title}`} accessibilityRole="button" key={`${track.provider}:${track.id}`} onPress={() => chooseTrack(track)} style={styles.postMusicLibraryRow}>
          {track.artworkUrl ? <Image source={{ uri: musicArtworkThumbnail(track.artworkUrl, track.provider) ?? track.artworkUrl }} style={styles.postMusicLibraryArtwork} /> : <View style={[styles.postMusicLibraryArtwork, styles.appleMusicArtworkPlaceholder]}><Disc3 color="#6f7b86" size={20} strokeWidth={1.9} /></View>}
          <View style={styles.appleMusicResultCopy}><Text numberOfLines={1} style={styles.appleMusicResultTitle}>{track.title}</Text><Text numberOfLines={1} style={styles.appleMusicResultArtist}>{track.artist || (track.provider === 'soundcloud' ? 'SoundCloud' : track.provider === 'bandcamp' ? 'Bandcamp' : '')}</Text></View>
          {selected ? <View style={styles.postMusicSelectedMark}><Check color="#fff" size={15} strokeWidth={2.3} /></View> : <Plus color="#6f7b86" size={20} strokeWidth={1.9} />}
        </Pressable>;
      })}</View> : null}
    </AppSheetModal>
  );
}

export const AppleMusicPickerModal = MusicPickerModal;
