import { AppState, Platform } from 'react-native';

const listeners = new Map<string, Set<() => void>>();
export function notificationSurfaceVisible() {
  return Platform.OS === 'web' ? typeof document !== 'undefined' && document.visibilityState === 'visible'
    : AppState.currentState === 'active';
}
export function subscribeNotificationUpdates(accountId: string, callback: () => void) {
  const group = listeners.get(accountId) ?? new Set<() => void>();
  group.add(callback); listeners.set(accountId, group);
  return () => { group.delete(callback); if (!group.size) listeners.delete(accountId); };
}
export function publishNotificationUpdates(accountId: string) {
  listeners.get(accountId)?.forEach(callback => callback());
}

/** One refresh at a time, one queued invalidation, no hidden/unmounted commits. */
export function createNotificationRefresh<T>(options: {
  load: (signal: AbortSignal) => Promise<T>;
  commit: (value: T, signal: AbortSignal) => Promise<void>;
  onError: (error: unknown) => void;
  visible: () => boolean;
}) {
  const abort = new AbortController();
  let running = false, again = false, retryDelay = 2_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const refresh = async () => {
    if (abort.signal.aborted) return;
    clearTimeout(timer);
    if (running) { again = true; return; }
    if (!options.visible()) return;
    running = true;
    try {
      do {
        again = false;
        const value = await options.load(abort.signal);
        if (!abort.signal.aborted && options.visible() && !again) await options.commit(value, abort.signal);
        retryDelay = 2_000;
      } while (again && !abort.signal.aborted && options.visible());
    } catch (error) {
      if (!abort.signal.aborted) {
        options.onError(error);
        timer = setTimeout(() => { void refresh(); }, retryDelay);
        retryDelay = Math.min(30_000, retryDelay * 2);
      }
    } finally { running = false; }
  };
  return { refresh, dispose: () => { abort.abort(); clearTimeout(timer); } };
}
