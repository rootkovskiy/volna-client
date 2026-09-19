import { AppState, Platform } from 'react-native';
import { apiFetch, apiUrl } from '../api/client';

type NotificationBadgeSnapshot = {
  messageCount: number;
  appBadgeCount: number;
  count: number;
};

let snapshot: NotificationBadgeSnapshot = { appBadgeCount: 0, count: 0, messageCount: 0 };
let epoch = 0;
let refreshQueued = false;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let retryDelay = 2_000;
let lastLoadedAt = 0;
let pendingRequest: Promise<void> | null = null;
let listenerUsers = 0;
let stopGlobalListeners: (() => void) | null = null;
const subscribers = new Set<() => void>();
let nativeBadgeWork = Promise.resolve();

function applySystemBadge(value: number) {
  if (Platform.OS !== 'web') {
    nativeBadgeWork = nativeBadgeWork.then(async () => {
      const notifications = await import('expo-notifications');
      await notifications.setBadgeCountAsync(snapshot.appBadgeCount);
    }).catch(() => undefined);
    return;
  }
  if (typeof navigator === 'undefined') return;
  if (value > 0 && 'setAppBadge' in navigator) void navigator.setAppBadge(value).catch(() => undefined);
  else if ('clearAppBadge' in navigator) void navigator.clearAppBadge().catch(() => undefined);
}

function publish(next: NotificationBadgeSnapshot) {
  snapshot = {
    messageCount: Math.max(0, Math.round(next.messageCount)),
    count: Math.max(0, Math.round(next.count)),
    appBadgeCount: Math.max(0, Math.round(next.appBadgeCount)),
  };
  applySystemBadge(snapshot.appBadgeCount);
  subscribers.forEach((subscriber) => subscriber());
}

export function getNotificationBadgeSnapshot() {
  return snapshot;
}

export function subscribeNotificationBadge(subscriber: () => void) {
  subscribers.add(subscriber);
  return () => subscribers.delete(subscriber);
}

export function clearNotificationBadge() {
  epoch++;
  clearTimeout(retryTimer);
  retryDelay = 2_000;
  pendingRequest = null;
  refreshQueued = false;
  lastLoadedAt = 0;
  publish({ count: 0, appBadgeCount: 0, messageCount: 0 });
}

export function markNotificationsRead() {
  publish({
    messageCount: snapshot.messageCount,
    count: 0,
    appBadgeCount: Math.max(0, snapshot.appBadgeCount - snapshot.count),
  });
}

export function refreshNotificationBadge(options?: { force?: boolean }) {
  const now = Date.now();
  if (!options?.force && now - lastLoadedAt < 10_000) return pendingRequest ?? Promise.resolve();
  if (pendingRequest) { if (options?.force) refreshQueued = true; return pendingRequest; }
  clearTimeout(retryTimer);
  const requestEpoch = epoch;
  const work = apiFetch(`${apiUrl}/notifications/unread-count`, { cache: 'no-store' })
    .then(async (response) => {
      if (!response.ok) throw new Error('Badge refresh failed');
      const result = await response.json() as { count?: number; appBadgeCount?: number };
      if (requestEpoch !== epoch) return;
      lastLoadedAt = Date.now();
      retryDelay = 2_000;
      publish({
        messageCount: Math.max(0, (result.appBadgeCount ?? result.count ?? 0) - (result.count ?? 0)),
        count: result.count ?? 0,
        appBadgeCount: result.appBadgeCount ?? result.count ?? 0,
      });
    })
    .catch(() => {
      if (requestEpoch !== epoch) return;
      retryTimer = setTimeout(() => {
        const visible = Platform.OS === 'web' ? typeof document !== 'undefined' && document.visibilityState === 'visible' : AppState.currentState === 'active';
        if (visible && requestEpoch === epoch) void refreshNotificationBadge({ force: true });
      }, retryDelay);
      retryDelay = Math.min(30_000, retryDelay * 2);
    })
    .finally(() => {
      if (pendingRequest !== work) return;
      pendingRequest = null;
      if (refreshQueued) { refreshQueued = false; void refreshNotificationBadge({ force: true }); }
    });
  pendingRequest = work;
  return work;
}

function installGlobalListeners() {
  const removers: Array<() => void> = [];
  const appStateSubscription = AppState.addEventListener('change', (state) => {
    if (state === 'active') void refreshNotificationBadge({ force: true });
  });
  removers.push(() => appStateSubscription.remove());

  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const refresh = () => void refreshNotificationBadge({ force: true });
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    const onServiceWorkerMessage = (event: MessageEvent<{ type?: string }>) => {
      if (event.data?.type === 'volna:notification') refresh();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisibilityChange);
    navigator.serviceWorker?.addEventListener('message', onServiceWorkerMessage);
    removers.push(() => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      navigator.serviceWorker?.removeEventListener('message', onServiceWorkerMessage);
    });
  } else {
    let active = true;
    let subscription: { remove: () => void } | null = null;
    void import('expo-notifications').then((Notifications) => {
      if (!active) return;
      subscription = Notifications.addNotificationReceivedListener(() => {
        void refreshNotificationBadge({ force: true });
      });
    }).catch(() => undefined);
    removers.push(() => {
      active = false;
      subscription?.remove();
    });
  }

  return () => removers.forEach((remove) => remove());
}

export function retainNotificationBadgeSync() {
  listenerUsers += 1;
  if (!stopGlobalListeners) stopGlobalListeners = installGlobalListeners();
  void refreshNotificationBadge();
  return () => {
    listenerUsers = Math.max(0, listenerUsers - 1);
    if (listenerUsers === 0) {
      stopGlobalListeners?.();
      stopGlobalListeners = null;
    }
  };
}
