import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Pause, Pencil, Play, X } from 'lucide-react-native';
import { AppImage as Image } from './AppImage';
import type { BandcampReleaseSnapshot, PublicPageAudioRelease } from '../types';
import { musicArtworkThumbnail } from '../domain';
import { styles } from '../styles';
import { useEffect, useState } from 'react';
import { useGlobalAudioControls, type GlobalTrackQueueItem } from './GlobalAudioPlayer';
import { buildPlayableQueue, getBandcampRelease, getSoundcloudRelease, type SoundcloudReleaseSnapshot } from '../music/musicRuntime';
import { normalizeYouTubeTrackMetadata } from './audioPlayerCore';
import { ReleaseGenreChips, ReleaseMetadataRows } from './ReleaseMetadataRows';
import { ExpandableReleaseTrackList } from './ExpandableReleaseTrackList';

function releaseTracks(release: PublicPageAudioRelease): GlobalTrackQueueItem[] {
  return buildPlayableQueue(release);
}

export function AudioReleaseAttachmentCard({
  communityLayout = false,
  onEdit,
  onRemove,
  profileQueue,
  queueWindowResolver,
  release,
  releaseDateLabel,
}: {
  communityLayout?: boolean;
  onEdit?: () => void;
  onRemove?: () => void;
  profileQueue?: GlobalTrackQueueItem[];
  queueWindowResolver?: (target: GlobalTrackQueueItem) => GlobalTrackQueueItem[];
  release: PublicPageAudioRelease;
  releaseDateLabel?: string;
}) {
  const audio = useGlobalAudioControls();
  const storedMetadata = release.metadata as BandcampReleaseSnapshot;
  const [legacySoundcloudMetadata, setLegacySoundcloudMetadata] = useState<SoundcloudReleaseSnapshot | null>(null);
  useEffect(() => {
    if (release.provider !== 'soundcloud' || (Array.isArray(storedMetadata.tracks) && storedMetadata.tracks.length)) {
      setLegacySoundcloudMetadata(null);
      return;
    }
    let active = true;
    void getSoundcloudRelease(release.releaseUrl)
      .then((metadata) => { if (active) setLegacySoundcloudMetadata(metadata); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [release.provider, release.releaseUrl, storedMetadata.tracks]);
  const metadata = (legacySoundcloudMetadata ?? storedMetadata) as BandcampReleaseSnapshot;
  const metadataTracks = Array.isArray(metadata.tracks) ? metadata.tracks : [];
  const playableRelease = legacySoundcloudMetadata
    ? { ...release, metadata: legacySoundcloudMetadata as unknown as BandcampReleaseSnapshot }
    : release;
  const displayMetadata = release.provider === 'youtube' ? normalizeYouTubeTrackMetadata(metadata.title, metadata.artist) : { artist: metadata.artist, title: metadata.title };
  const providerLabel = release.provider === 'youtube' ? 'YouTube' : release.provider === 'soundcloud' ? 'SoundCloud' : 'Bandcamp';
  const tracks = releaseTracks(playableRelease);
  const first = tracks[0];
  const effectiveQueue = profileQueue?.length ? profileQueue : tracks;
  const active = Boolean(first && audio.activeTrack?.provider === release.provider && audio.activeTrack.collectionId === release.releaseUrl);
  const activeCardTrack = tracks.find((track) => track.id === audio.activeTrack?.id);
  const playing = active && audio.isPlaying;
  const toggle = () => {
    if (!first) return;
    if (playing) {
      audio.pause();
      return;
    }
    if (activeCardTrack && audio.activeTrack) {
      void audio.play(audio.activeTrack);
      return;
    }
    const queueIndex = effectiveQueue.findIndex((track) => track.id === first.id);
    void audio.play({
      ...first,
      queue: effectiveQueue,
      queueIndex: queueIndex >= 0 ? queueIndex : 0,
      queueWindowResolver,
    });
  };
  return <View style={styles.bandcampReleaseCard}>
    <View style={[styles.bandcampReleaseHeader, communityLayout && styles.communityAudioReleaseHeader]}>
      <Pressable accessibilityLabel={playing ? `Поставить ${displayMetadata.title} на паузу` : `Воспроизвести ${displayMetadata.title}`} accessibilityRole="button" disabled={!first} onPress={toggle} style={[styles.bandcampReleaseHeaderLink, communityLayout && styles.communityAudioReleaseHeaderLink]}>
        {metadata.artworkUrl ? <Image resizeMode="cover" source={{ uri: musicArtworkThumbnail(metadata.artworkUrl, release.provider) ?? metadata.artworkUrl }} style={[styles.bandcampReleaseArtwork, communityLayout && styles.communityAudioReleaseArtwork]} /> : <View style={[styles.bandcampReleaseArtworkFallback, communityLayout && styles.communityAudioReleaseArtwork]}><Text style={styles.audioArtworkFallbackNote}>♪</Text></View>}
        <View style={styles.bandcampReleaseCopy}>
          <Text numberOfLines={1} style={styles.bandcampReleaseTitle}>{displayMetadata.title}</Text>
          <ReleaseMetadataRows artist={displayMetadata.artist} genres={release.genres} provider={providerLabel} releaseDateLabel={releaseDateLabel} showGenres={communityLayout} trackCount={metadataTracks.length} />
        </View>
      </Pressable>
      {first ? <Pressable accessibilityLabel={playing ? 'Поставить релиз на паузу' : 'Воспроизвести релиз'} accessibilityRole="button" onPress={toggle} style={styles.bandcampTrackPlayButton}>{playing ? <Pause color="#fff" size={13} strokeWidth={2} /> : <Play color="#fff" fill="#fff" size={12} strokeWidth={2} />}</Pressable> : null}
      {onEdit ? <Pressable accessibilityLabel="Редактировать релиз" hitSlop={6} onPress={onEdit} style={styles.bandcampReleaseRemoveButton}><Pencil color="#6f7b86" size={17} strokeWidth={1.9} /></Pressable> : null}
      {onRemove ? <Pressable accessibilityLabel="Убрать релиз" hitSlop={6} onPress={onRemove} style={styles.postComposerRemoveButton}><X color="#6f7b86" size={17} strokeWidth={1.9} /></Pressable> : null}
    </View>
    {!communityLayout ? <ReleaseGenreChips genres={release.genres} /> : null}
    {metadataTracks.length > 1 ? <ExpandableReleaseTrackList expanded={active} itemCount={metadataTracks.length}>{metadataTracks.map((track, index) => {
      const playableIndex = tracks.findIndex((item) => item.title === track.title && item.externalUrl === (track.externalUrl ?? release.releaseUrl));
      const playableTrack = playableIndex >= 0 ? tracks[playableIndex] : null;
      const row = <><Text style={styles.bandcampTrackNumber}>{index + 1}</Text><Text numberOfLines={1} style={[styles.bandcampTrackTitle, playableTrack && audio.activeTrack?.id === playableTrack.id && styles.bandcampTrackTitleActive]}>{track.title}</Text></>;
      const effectiveQueueIndex = playableTrack ? effectiveQueue.findIndex((item) => item.id === playableTrack.id) : -1;
      return playableTrack ? <Pressable accessibilityLabel={`Прослушать ${track.title}`} accessibilityRole="button" key={track.id} onPress={() => void audio.play({ ...playableTrack, queue: effectiveQueue, queueIndex: effectiveQueueIndex >= 0 ? effectiveQueueIndex : playableIndex, queueWindowResolver })} style={styles.bandcampTrackRow}>{row}</Pressable> : <View key={track.id} style={styles.bandcampTrackRow}>{row}</View>;
    })}</ExpandableReleaseTrackList> : null}
  </View>;
}

export function BandcampReleaseUrlCard({ releaseUrl }: { releaseUrl: string }) {
  const [release, setRelease] = useState<PublicPageAudioRelease | null>(null);
  useEffect(() => {
    let active = true;
    void getBandcampRelease(releaseUrl)
      .then((metadata) => metadata ?? null)
      .then((metadata) => {
        if (!active || !metadata) return;
        setRelease({ id: `external:${metadata.externalUrl}`, provider: 'bandcamp', releaseUrl: metadata.externalUrl, embedUrl: null, genres: [], releaseDate: '', createdAt: '', metadata });
      });
    return () => { active = false; };
  }, [releaseUrl]);
  return release ? <AudioReleaseAttachmentCard release={release} /> : <View style={styles.bandcampReleaseLoading}><ActivityIndicator color="#6f7b86" /><Text style={styles.soundcloudFallbackText}>Загружаем релиз Bandcamp…</Text></View>;
}
