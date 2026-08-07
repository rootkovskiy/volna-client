import { createElement, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { styles } from '../styles';
import { normalizeYouTubeVideoId } from '../security/externalUrls.mjs';

export function YouTubePostEmbed({ startSeconds = 0, videoId }: { startSeconds?: number; videoId: string }) {
  const [isReady, setIsReady] = useState(false);
  const safeVideoId = normalizeYouTubeVideoId(videoId);
  const safeStartSeconds = Number.isFinite(startSeconds) ? Math.min(86_400, Math.max(0, Math.floor(startSeconds))) : 0;
  if (!safeVideoId) return null;
  const src = `https://www.youtube-nocookie.com/embed/${safeVideoId}?playsinline=1&rel=0&iv_load_policy=3${safeStartSeconds > 0 ? `&start=${safeStartSeconds}` : ''}`;
  const playerScale = 0.8;
  const virtualSize = `${100 / playerScale}%`;
  return <View style={styles.youtubePostEmbed}>
    {!isReady ? <View pointerEvents="none" style={styles.youtubePostLoading}><ActivityIndicator color="#6f7b86" /></View> : null}
    {createElement('iframe', {
      allow: 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share',
      allowFullScreen: true,
      frameBorder: '0',
      onLoad: () => setIsReady(true),
      referrerPolicy: 'strict-origin-when-cross-origin',
      src,
      style: {
        border: 0,
        display: 'block',
        height: virtualSize,
        left: 0,
        opacity: isReady ? 1 : 0,
        position: 'absolute',
        top: 0,
        transform: `scale(${playerScale})`,
        transformOrigin: 'top left',
        transition: 'opacity 180ms ease',
        width: virtualSize,
      },
      title: 'YouTube video player',
    })}
  </View>;
}
