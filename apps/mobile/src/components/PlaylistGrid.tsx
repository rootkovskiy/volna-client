import { ListMusic } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { AppImage } from './AppImage';

type PlaylistCover = { artworkUrl?: string | null; artworkThumbnailUrl?: string | null };
type PlaylistTile = PlaylistCover & { id: string; name: string };

export function PlaylistArtwork({ playlist, style }: { playlist: PlaylistCover; style?: StyleProp<ViewStyle> }) {
  const uri = playlist.artworkThumbnailUrl || playlist.artworkUrl;
  return <View style={[playlistGridStyles.artwork, style]}>
    {uri ? <AppImage source={{ uri }} style={StyleSheet.absoluteFill} /> : <ListMusic color="#6f7b86" size={32} strokeWidth={1.6} />}
  </View>;
}

/** Three equal columns, including the final incomplete row, on Web and native. */
export function PlaylistGrid({ playlists, onOpen }: { playlists: readonly PlaylistTile[]; onOpen: (id: string) => void }) {
  return <View style={playlistGridStyles.grid}>
    {Array.from({ length: Math.ceil(playlists.length / 3) }, (_, row) => <View key={row} style={playlistGridStyles.row}>
      {Array.from({ length: 3 }, (_, column) => {
        const playlist = playlists[row * 3 + column];
        return playlist ? <Pressable key={playlist.id} accessibilityRole="button" accessibilityLabel={`Открыть плейлист ${playlist.name}`} onPress={() => onOpen(playlist.id)} style={playlistGridStyles.tile}>
          <PlaylistArtwork playlist={playlist} />
          <Text numberOfLines={2} style={playlistGridStyles.title}>{playlist.name}</Text>
        </Pressable> : <View key={`empty-${column}`} style={playlistGridStyles.tile} />;
      })}
    </View>)}
  </View>;
}

export const playlistGridStyles = StyleSheet.create({
  grid: { gap: 16 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  tile: { flex: 1, minWidth: 0 },
  artwork: { width: '100%', aspectRatio: 1, borderRadius: 8, overflow: 'hidden', backgroundColor: '#f3f5f7', alignItems: 'center', justifyContent: 'center' },
  title: { marginTop: 7, minHeight: 38, color: '#111', fontSize: 14, lineHeight: 19, fontWeight: '600' },
});
