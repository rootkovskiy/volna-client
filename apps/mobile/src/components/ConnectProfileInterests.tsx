import { Text, View } from 'react-native';
import { connectInterestLabels, groupMusicGenreChips } from '../domain';
import { styles } from '../styles';

/** Read-only Connect tags: interests first, individual music genres underneath. */
export function ConnectProfileInterests({ interests, musicGenres }: { interests: string[]; musicGenres: string[] }) {
  const interestLabels = interests.map((interest) => connectInterestLabels[interest] ?? interest).slice(0, 5);
  const genres = groupMusicGenreChips(musicGenres).flatMap((group) => (
    (group.subgenres.length ? group.subgenres : [group.genre]).map((label) => ({ key: `${group.key}:${label}`, label }))
  ));

  return <>
    {interestLabels.length ? (
      <View style={styles.connectProfileInterests}>
        {interestLabels.map((interest) => (
          <View key={interest} style={styles.connectProfileInterestChip}>
            <Text numberOfLines={1} style={styles.connectProfileInterestText}>{interest}</Text>
          </View>
        ))}
      </View>
    ) : null}
    {genres.length ? (
      <View style={styles.connectProfileInterests}>
        {genres.map((genre) => (
          <View key={genre.key} style={styles.connectProfileInterestChip}>
            <Text numberOfLines={1} style={styles.connectProfileInterestText}>{genre.label}</Text>
          </View>
        ))}
      </View>
    ) : null}
  </>;
}
