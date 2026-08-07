export type YouTubeAudioSnapshot = {
  duration: number;
  loading: boolean;
  playing: boolean;
  position: number;
};

export type YouTubeAudioEngineHandle = {
  load(videoId: string, startSeconds?: number, autoplay?: boolean): void;
  pause(): void;
  play(): void;
  seek(seconds: number, resume?: boolean): void;
  stop(): void;
};

export type YouTubeAudioEngineProps = {
  onEnded?: () => void;
  onError?: (message: string) => void;
  onStateChange?: (snapshot: YouTubeAudioSnapshot) => void;
};
