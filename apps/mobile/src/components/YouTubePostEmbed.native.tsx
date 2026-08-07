import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { styles } from '../styles';
import { normalizeYouTubeVideoId } from '../security/externalUrls.mjs';

export function YouTubePostEmbed({ startSeconds = 0, videoId }: { startSeconds?: number; videoId: string }) {
  const [isReady, setIsReady] = useState(false);
  const safeVideoId = normalizeYouTubeVideoId(videoId);
  const safeStartSeconds = Number.isFinite(startSeconds) ? Math.min(86_400, Math.max(0, Math.floor(startSeconds))) : 0;
  if (!safeVideoId) return null;
  const uri = `https://www.youtube-nocookie.com/embed/${safeVideoId}?playsinline=1&rel=0&iv_load_policy=3${safeStartSeconds > 0 ? `&start=${safeStartSeconds}` : ''}`;
  return <View style={styles.youtubePostEmbed}>
    {!isReady ? <View pointerEvents="none" style={styles.youtubePostLoading}><ActivityIndicator color="#6f7b86" /></View> : null}
    <WebView
      allowsFullscreenVideo
      javaScriptEnabled
      onLoadEnd={() => setIsReady(true)}
      originWhitelist={['https://www.youtube-nocookie.com']}
      source={{ uri }}
      style={[styles.youtubePostFrame, !isReady && styles.youtubePostFrameLoading]}
    />
  </View>;
}
