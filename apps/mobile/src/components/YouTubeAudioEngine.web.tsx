import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { createElement } from 'react';
import type { YouTubeAudioEngineHandle, YouTubeAudioEngineProps, YouTubeAudioSnapshot } from './YouTubeAudioEngine.types';
import { normalizeYouTubeVideoId } from '../security/externalUrls.mjs';

type PlayerState = -1 | 0 | 1 | 2 | 3 | 5;
type YouTubePlayer = {
  cueVideoById(options: { videoId: string; startSeconds: number }): void;
  destroy(): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): PlayerState;
  loadVideoById(options: { videoId: string; startSeconds: number }): void;
  pauseVideo(): void;
  playVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  stopVideo(): void;
};
type YouTubeApi = {
  Player: new (element: HTMLElement, options: Record<string, unknown>) => YouTubePlayer;
  PlayerState: { PLAYING: 1; PAUSED: 2 };
};

let apiPromise: Promise<YouTubeApi> | null = null;
function loadApi() {
  const youtubeWindow = window as typeof window & { YT?: YouTubeApi; onYouTubeIframeAPIReady?: () => void };
  if (youtubeWindow.YT?.Player) return Promise.resolve(youtubeWindow.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise<YouTubeApi>((resolve) => {
    const previous = youtubeWindow.onYouTubeIframeAPIReady;
    youtubeWindow.onYouTubeIframeAPIReady = () => { previous?.(); if (youtubeWindow.YT) resolve(youtubeWindow.YT); };
    if (!document.querySelector('script[data-volna-youtube-api]')) {
      const script = document.createElement('script');
      script.async = true;
      script.dataset.volnaYoutubeApi = 'true';
      script.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(script);
    }
  });
  return apiPromise;
}

export const YouTubeAudioEngine = forwardRef<YouTubeAudioEngineHandle, YouTubeAudioEngineProps>(function YouTubeAudioEngine({ onEnded, onError, onStateChange }, ref) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YouTubePlayer | null>(null);
  const readyRef = useRef(false);
  const videoIdRef = useRef('');
  const snapshotRef = useRef<YouTubeAudioSnapshot>({ duration: 0, loading: false, playing: false, position: 0 });
  const pendingRef = useRef<{ autoplay: boolean; start: number; videoId: string } | null>(null);
  const emit = (patch: Partial<YouTubeAudioSnapshot>) => {
    snapshotRef.current = { ...snapshotRef.current, ...patch };
    onStateChange?.(snapshotRef.current);
  };
  const applyLoad = (request: { autoplay: boolean; start: number; videoId: string }) => {
    const player = playerRef.current;
    if (!readyRef.current || !player) { pendingRef.current = request; return; }
    videoIdRef.current = request.videoId;
    emit({ duration: 0, loading: request.autoplay, playing: false, position: request.start });
    if (request.autoplay) player.loadVideoById({ videoId: request.videoId, startSeconds: request.start });
    else player.cueVideoById({ videoId: request.videoId, startSeconds: request.start });
  };

  useImperativeHandle(ref, () => ({
    load: (videoId, startSeconds = 0, autoplay = false) => {
      const safeVideoId = normalizeYouTubeVideoId(videoId);
      if (!safeVideoId) { onError?.('Некорректный идентификатор YouTube'); return; }
      const safeStartSeconds = Number.isFinite(startSeconds) ? Math.min(86_400, Math.max(0, startSeconds)) : 0;
      applyLoad({ autoplay, start: safeStartSeconds, videoId: safeVideoId });
    },
    pause: () => playerRef.current?.pauseVideo(),
    play: () => { emit({ loading: true }); playerRef.current?.playVideo(); },
    seek: (seconds, resume = false) => {
      const player = playerRef.current;
      if (!player) return;
      const target = Math.max(0, seconds);
      emit({ loading: resume, position: target });
      player.seekTo(target, true);
      if (resume) player.playVideo();
    },
    stop: () => { playerRef.current?.stopVideo(); emit({ duration: 0, loading: false, playing: false, position: 0 }); },
  }));

  useEffect(() => {
    let active = true;
    let timer = 0;
    const host = hostRef.current;
    const playerMount = document.createElement('div');
    host?.appendChild(playerMount);
    void loadApi().then((YT) => {
      if (!active || !host?.isConnected) return;
      playerRef.current = new YT.Player(playerMount, {
        height: '200', width: '200', playerVars: { autoplay: 0, controls: 0, disablekb: 1, playsinline: 1, rel: 0, origin: window.location.origin },
        events: {
          onReady: (event: { target: YouTubePlayer }) => {
            readyRef.current = true;
            emit({ duration: event.target.getDuration() || 0 });
            const pending = pendingRef.current; pendingRef.current = null;
            if (pending) applyLoad(pending);
          },
          onStateChange: (event: { data: PlayerState; target: YouTubePlayer }) => {
            const playing = event.data === 1;
            emit({ duration: event.target.getDuration() || snapshotRef.current.duration, loading: event.data === 3, playing, position: event.target.getCurrentTime() || snapshotRef.current.position });
            if (event.data === 0) onEnded?.();
          },
          onError: (event: { data: number }) => { emit({ loading: false, playing: false }); onError?.(`YouTube вернул ошибку ${event.data}`); },
        },
      });
      timer = window.setInterval(() => {
        const player = playerRef.current;
        if (!player || !readyRef.current) return;
        emit({ duration: player.getDuration() || snapshotRef.current.duration, position: player.getCurrentTime() || 0 });
      }, 250);
    }).catch(() => onError?.('Не удалось загрузить YouTube IFrame API'));
    return () => {
      active = false;
      if (timer) window.clearInterval(timer);
      playerRef.current?.destroy();
      playerRef.current = null;
      // The YouTube API replaces `playerMount` with an iframe. Keep that
      // mutation below a host owned by React so React never tries to remove a
      // node which the third-party API has already detached.
      host?.replaceChildren();
    };
  }, []);

  // YouTube suspends truly off-screen iframes on iOS. Keep it in the viewport,
  // visually transparent and behind the app while VOLNA owns the controls.
  return createElement('div', { 'aria-hidden': true, ref: hostRef, style: { height: 200, left: 0, opacity: 0.001, pointerEvents: 'none', position: 'fixed', top: 0, width: 200, zIndex: -1 } });
});
