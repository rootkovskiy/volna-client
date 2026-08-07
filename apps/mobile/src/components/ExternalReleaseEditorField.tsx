import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Keyboard, Pressable, Text, TextInput, View } from 'react-native';
import { ChevronDown, Disc3, Link2 } from 'lucide-react-native';
import { AppImage as Image } from './AppImage';
import { normalizeYouTubeTrackMetadata } from './audioPlayerCore';
import { styles } from '../styles';

export type ExternalReleasePreview = {
  provider: 'bandcamp' | 'soundcloud' | 'youtube';
  metadata: {
    title: string;
    artist?: string | null;
    artworkUrl?: string | null;
    tracks?: Array<{
      id?: string;
      title: string;
      artist?: string | null;
    }>;
  };
};

export function ExternalReleaseEditorField({
  error,
  hint,
  isResolving,
  onChangeText,
  onResolve,
  preview,
  surface = 'outlined',
  value,
}: {
  error?: string | null;
  hint: string;
  isResolving: boolean;
  onChangeText: (value: string) => void;
  onResolve: () => void;
  preview: ExternalReleasePreview | null;
  surface?: 'grouped' | 'outlined';
  value: string;
}) {
  return (
    <View style={styles.primaryTrackInputGroup}>
      <View style={[
        styles.primaryTrackExternalInputRow,
        surface === 'grouped' && styles.primaryTrackExternalInputRowGrouped,
      ]}>
        <Link2 color="#6f7b86" size={19} strokeWidth={1.9} />
        <TextInput
          accessibilityLabel="Ссылка на релиз"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          onChangeText={onChangeText}
          onSubmitEditing={onResolve}
          placeholder="Ссылка на релиз"
          placeholderTextColor="#8e99a4"
          returnKeyType="done"
          style={styles.primaryTrackSearchInput}
          value={value}
        />
        <Pressable
          accessibilityLabel={preview ? 'Ссылка на релиз подтверждена' : 'Проверить ссылку на релиз'}
          accessibilityRole="button"
          accessibilityState={{ disabled: !value.trim() || isResolving, busy: isResolving }}
          disabled={!value.trim() || isResolving}
          onPress={() => preview ? Keyboard.dismiss() : onResolve()}
          style={[
            styles.primaryTrackExternalAdd,
            preview && styles.primaryTrackExternalAddActive,
            (!value.trim() || isResolving) && styles.primaryTrackExternalAddDisabled,
          ]}
        >
          {isResolving
            ? <ActivityIndicator color="#fff" size="small" />
            : <ChevronDown color={preview ? '#111' : '#fff'} size={20} strokeWidth={2.2} />}
        </Pressable>
      </View>
      <Text style={styles.primaryTrackInputHint}>{hint}</Text>
      {error ? <Text style={styles.primaryTrackExternalError}>{error}</Text> : null}
      <ExternalReleasePreviewTransition release={preview} />
    </View>
  );
}

function ExternalReleasePreviewCard({ release }: { release: ExternalReleasePreview }) {
  const metadata = release.metadata;
  const displayMetadata = release.provider === 'youtube'
    ? normalizeYouTubeTrackMetadata(metadata.title, metadata.artist ?? '')
    : { artist: metadata.artist ?? '', title: metadata.title };
  const tracks = Array.isArray(metadata.tracks) ? metadata.tracks : [];
  const provider = release.provider === 'bandcamp' ? 'Bandcamp' : release.provider === 'youtube' ? 'YouTube' : 'SoundCloud';

  return (
    <View style={styles.communityAudioEditorPreview}>
      <View style={styles.communityAudioEditorPreviewHeader}>
        {metadata.artworkUrl
          ? <Image source={{ uri: metadata.artworkUrl }} style={styles.communityAudioEditorPreviewArtwork} />
          : <View style={styles.communityAudioEditorPreviewArtworkFallback}><Disc3 color="#6f7b86" size={28} /></View>}
        <View style={styles.communityAudioEditorPreviewCopy}>
          <Text numberOfLines={2} style={styles.communityAudioEditorPreviewTitle}>{displayMetadata.title}</Text>
          <Text numberOfLines={1} style={styles.communityAudioEditorPreviewMeta}>
            {displayMetadata.artist ? `${displayMetadata.artist} · ` : ''}{provider}
          </Text>
        </View>
      </View>
      {tracks.length ? (
        <View style={styles.communityAudioEditorTrackList}>
          {tracks.map((track, index) => (
            <View key={track.id || `${track.title}-${index}`} style={styles.communityAudioEditorTrackRow}>
              <Text style={styles.communityAudioEditorTrackNumber}>{index + 1}</Text>
              <Text numberOfLines={2} style={styles.communityAudioEditorTrackTitle}>{track.title}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function ExternalReleasePreviewTransition({ release }: { release: ExternalReleasePreview | null }) {
  const [renderedRelease, setRenderedRelease] = useState(release);
  const [contentHeight, setContentHeight] = useState(0);
  const progress = useRef(new Animated.Value(release ? 1 : 0)).current;

  useEffect(() => {
    progress.stopAnimation();
    if (release) {
      setRenderedRelease(release);
      requestAnimationFrame(() => Animated.timing(progress, {
        toValue: 1,
        duration: 260,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }).start());
      return;
    }
    Animated.timing(progress, {
      toValue: 0,
      duration: 220,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (finished) setRenderedRelease(null);
    });
  }, [progress, release]);

  return (
    <Animated.View
      pointerEvents={release ? 'auto' : 'none'}
      style={{
        height: progress.interpolate({ inputRange: [0, 1], outputRange: [0, contentHeight] }),
        opacity: progress,
        overflow: 'hidden',
      }}
    >
      {renderedRelease ? (
        <View onLayout={(event) => setContentHeight(event.nativeEvent.layout.height)} style={styles.communityAudioEditorPreviewTransitionContent}>
          <ExternalReleasePreviewCard release={renderedRelease} />
        </View>
      ) : null}
    </Animated.View>
  );
}
