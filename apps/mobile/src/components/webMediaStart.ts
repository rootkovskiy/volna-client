/** Start inside the original gesture; restore position only after metadata exists. */
export function playWebMediaFromGesture(media: HTMLAudioElement, position: number | null, isCurrent: () => boolean, timeoutMs = 15_000): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let sought = false;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      media.removeEventListener('loadedmetadata', seek);
      media.removeEventListener('emptied', interrupted);
      media.removeEventListener('error', failed);
      if (error) { if (isCurrent()) media.pause(); reject(error); } else resolve();
    };
    const interrupted = () => { const error = new Error('Playback superseded'); error.name = 'AbortError'; finish(error); };
    const failed = () => finish(new Error('Браузер не смог прочитать аудиофайл'));
    const seek = () => {
      if (settled || sought) return;
      if (!isCurrent()) { interrupted(); return; }
      if (position === null || !Number.isFinite(position) || media.readyState < 1) return;
      try {
        const target = Math.max(0, Number.isFinite(media.duration) && media.duration > 0 ? Math.min(position, media.duration) : position);
        if (media.currentTime !== target) media.currentTime = target;
        sought = true;
      } catch (error) { finish(error); }
    };
    const timeout = setTimeout(() => finish(new Error('Не удалось запустить аудиофайл. Нажмите воспроизведение ещё раз.')), timeoutMs);
    media.addEventListener('loadedmetadata', seek, { once: true });
    media.addEventListener('emptied', interrupted, { once: true });
    media.addEventListener('error', failed, { once: true });
    if (!isCurrent()) { interrupted(); return; }
    // No seek/network/metadata await before this call: Safari's activation belongs to the tap.
    try {
      const playback = media.play();
      seek();
      void playback.then(() => { seek(); finish(); }, finish);
    } catch (error) { finish(error); }
  });
}
