type ReviewTrack = { listenLaterItemId?: string; listenLaterTrackId?: string; reviewed?: boolean };

/** Account-session owned: coalesce end/next callbacks and ignore late acknowledgements after disposal. */
export function createListenLaterReviewReporter(options: {
  persist: (itemId: string, trackId: string) => Promise<boolean>;
  confirmed: (itemId: string, trackId: string) => void;
  failed: () => void;
}) {
  let disposed = false;
  const pending = new Map<string, Promise<void>>();
  const confirmed = new WeakSet<ReviewTrack>();
  return {
    mark(track: ReviewTrack | null | undefined): Promise<void> {
      const itemId = track?.listenLaterItemId;
      const trackId = track?.listenLaterTrackId;
      if (disposed || !itemId || !trackId || track.reviewed) return Promise.resolve();
      const key = JSON.stringify([itemId, trackId]);
      if (confirmed.has(track)) return Promise.resolve();
      const existing = pending.get(key);
      if (existing) return existing;
      const request = options.persist(itemId, trackId).then((saved) => {
        if (disposed || !saved) return; // Removed rows are not resurrected locally.
        confirmed.add(track);
        options.confirmed(itemId, trackId);
      }).catch(() => {
        if (!disposed) options.failed();
      }).finally(() => pending.delete(key));
      pending.set(key, request);
      return request;
    },
    dispose() { disposed = true; pending.clear(); },
  };
}
