import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Disc3, Info, Pause, Play, Trash2 } from 'lucide-react-native';
import { LoadingIndicator } from '@volna/messaging-client/loading';
import { AppImage } from './AppImage';
import { styles } from '../styles';

/** Presentation shared by the primary-track editor and the UI Kit. */
export function PrimaryTrackPreviewCard({ artist, artworkUrl, children, isLoading = false, isPlaying = false, onRemove, onToggle, title, unavailableLabel }: {
  artist: string | null;
  artworkUrl: string | null;
  children?: ReactNode;
  isLoading?: boolean;
  isPlaying?: boolean;
  onRemove?: () => void;
  onToggle?: () => void;
  title: string;
  unavailableLabel?: string | null;
}) {
  return <View style={styles.primaryTrackFragmentPlayer}>
    <Pressable
      accessibilityLabel={`${unavailableLabel || (isPlaying ? 'Остановить' : 'Прослушать')} ${title}`}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(unavailableLabel) }}
      disabled={Boolean(unavailableLabel)}
      onPress={onToggle}
      style={styles.primaryTrackFragmentArtworkWrap}
    >
      {artworkUrl ? <AppImage source={{ uri: artworkUrl }} style={styles.primaryTrackFragmentArtwork} /> : <View style={[styles.primaryTrackFragmentArtwork, styles.primaryTrackFragmentArtworkPlaceholder]}><Disc3 color="#6f7b86" size={20} /></View>}
      <View style={styles.primaryTrackFragmentArtworkControl}>{unavailableLabel ? <Info color="#fff" size={18} /> : isLoading ? <LoadingIndicator tone="inverse" size="small" /> : isPlaying ? <Pause color="#fff" fill="#fff" size={17} strokeWidth={2.4} /> : <Play color="#fff" fill="#fff" size={16} strokeWidth={2.2} />}</View>
    </Pressable>
    <View style={styles.primaryTrackFragmentPlayerCopy}>
      <Text numberOfLines={1} style={styles.primaryTrackFragmentPlayerTitle}>{title}</Text>
      {artist ? <Text numberOfLines={1} style={styles.primaryTrackFragmentPlayerArtist}>{artist}</Text> : null}
      {unavailableLabel ? <Text style={styles.primaryTrackFragmentStartLabel}>{unavailableLabel}</Text> : children}
    </View>
    {onRemove ? <Pressable accessibilityLabel={`Убрать главный трек: ${title}`} accessibilityRole="button" onPress={onRemove} style={styles.primaryTrackFragmentRemove}>
      <Trash2 color="#6f7b86" size={19} strokeWidth={1.9} />
    </Pressable> : null}
  </View>;
}
