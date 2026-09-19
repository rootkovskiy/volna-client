import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AppImage } from './AppImage';

export function MusicCategoryTile({ artworkUrl, label, onPress }: { artworkUrl: string | null; label: string; onPress: () => void }) {
  const hasArtwork = Boolean(artworkUrl?.trim());
  return <Pressable accessibilityLabel={label} accessibilityRole="button" onPress={onPress} style={musicCategoryStyles.tile}>
    {hasArtwork ? <>
      <AppImage accessibilityIgnoresInvertColors source={{ uri: artworkUrl! }} style={musicCategoryStyles.artwork} />
      <View pointerEvents="none" style={musicCategoryStyles.artworkShade} />
    </> : null}
    <Text style={[musicCategoryStyles.title, hasArtwork && musicCategoryStyles.titleOnArtwork]}>{label}</Text>
  </Pressable>;
}

export const musicCategoryStyles = StyleSheet.create({
  row: { marginTop: 0, flexDirection: 'row', gap: 14 },
  slot: { flex: 1, aspectRatio: 1.08 },
  tile: { width: '100%', height: '100%', borderRadius: 6, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, backgroundColor: '#f3f5f7', overflow: 'hidden' },
  artwork: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  artworkShade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0, 0, 0, 0.32)' },
  title: { color: '#111', fontSize: 14, lineHeight: 20, fontWeight: '500', textAlign: 'center' },
  titleOnArtwork: { color: '#fff', fontWeight: '600', textShadowColor: 'rgba(0, 0, 0, 0.55)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
});
