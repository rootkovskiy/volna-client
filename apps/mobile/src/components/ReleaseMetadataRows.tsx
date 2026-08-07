import { Text, View } from 'react-native';
import { groupMusicGenreChips } from '../domain';
import { styles } from '../styles';

function formatTrackCount(count: number) {
  const mod100 = count % 100;
  const mod10 = count % 10;
  const suffix = mod100 >= 11 && mod100 <= 14
    ? 'треков'
    : mod10 === 1
      ? 'трек'
      : mod10 >= 2 && mod10 <= 4
        ? 'трека'
        : 'треков';
  return `${count} ${suffix}`;
}

export function ReleaseMetadataRows({
  artist,
  genres,
  provider,
  releaseDateLabel,
  showGenres = true,
  trackCount,
}: {
  artist?: string | null;
  genres: string[];
  provider: string;
  releaseDateLabel?: string | null;
  showGenres?: boolean;
  trackCount: number;
}) {
  const meta = [
    trackCount > 1 ? formatTrackCount(trackCount) : null,
    releaseDateLabel,
    provider,
  ].filter(Boolean).join(' · ');

  return <>
    {artist ? <Text numberOfLines={1} style={styles.bandcampReleaseArtist}>{artist}</Text> : null}
    {meta ? <Text numberOfLines={1} style={styles.bandcampReleaseMeta}>{meta}</Text> : null}
    {showGenres ? <ReleaseGenreChips genres={genres} /> : null}
  </>;
}

export function ReleaseGenreChips({ genres }: { genres: string[] }) {
  const genreGroups = groupMusicGenreChips(genres);
  const subgenres = genreGroups.flatMap((group) => group.subgenres.map((subgenre) => ({
    key: `${group.key}:${subgenre}`,
    subgenre,
  })));
  return subgenres.length ? <View style={styles.bandcampReleaseGenres}>
      {subgenres.map((item) => (
        <View key={item.key} style={styles.bandcampReleaseGenreTag}>
          <Text numberOfLines={1} style={[styles.bandcampReleaseGenreText, styles.bandcampReleaseGenreName]}>{item.subgenre}</Text>
        </View>
      ))}
    </View> : null;
}
