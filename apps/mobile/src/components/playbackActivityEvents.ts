const playbackVisibilityListeners = new Set<() => void>();

export function emitPlaybackVisibilityChanged() {
  playbackVisibilityListeners.forEach((listener) => listener());
}

export function subscribePlaybackVisibilityChanged(listener: () => void) {
  playbackVisibilityListeners.add(listener);
  return () => {
    playbackVisibilityListeners.delete(listener);
  };
}
