import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { io } from 'socket.io-client';
import { subscribeEncryptedActivity } from '@volna/messaging-client/messaging-surface-controller';
import { apiUrl, getApiSessionToken } from '../api/client';
import { messagingSurfaceController } from '../messaging/secureMessaging';
import { refreshNotificationBadge } from './badgeStore';
import { publishNotificationUpdates } from './liveUpdates';
import { notificationSurfaceVisible } from './liveUpdates';

type Presented = { data: Record<string, unknown>; close(): Promise<void> | void };
type Visibility = { clearedBefore: string | null; deletedMessageIds: string[]; hasDeletions: boolean };
const safeId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{8,80}$/.test(value);

// Only opaque notification descriptors cross this adapter, never chat content.
export async function reconcileChatNotifications(accountId: string, items: Presented[], check: (threadId: string, ids: string[]) => Promise<Visibility>, active: () => boolean) {
  const groups = new Map<string, Presented[]>();
  for (const item of items) {
    if (item.data.type !== 'chat' || item.data.recipientId !== accountId || !safeId(item.data.threadId)) continue;
    const group = groups.get(item.data.threadId) ?? [];
    group.push(item); groups.set(item.data.threadId, group);
  }
  for (const [threadId, group] of groups) {
    for (let start = 0; start < group.length && active(); start += 500) {
      const batch = group.slice(start, start + 500);
      // Failed checks preserve notifications, and the next resume/reconnect retries.
      const state = await check(threadId, batch.flatMap(item => safeId(item.data.messageId) ? [item.data.messageId] : []));
      const deleted = new Set(state.deletedMessageIds);
      for (const item of batch) {
        if (!active()) return;
        const stamp = typeof item.data.createdAt === 'string' ? Date.parse(item.data.createdAt) : NaN;
        const hidden = deleted.has(String(item.data.messageId))
          || (state.clearedBefore !== null && (!Number.isFinite(stamp) || stamp <= Date.parse(state.clearedBefore)))
          || (!safeId(item.data.messageId) && state.hasDeletions);
        if (hidden) await item.close();
      }
    }
  }
}

export function useChatNotificationCleanup(accountId: string) {
  useEffect(() => {
    if (!accountId) return;
    let active = true, running = false, again = false;
    let socket: ReturnType<typeof io> | undefined;
    let releaseEncryptedActivity: (() => void) | undefined;
    let nativeSubscription: { remove(): void } | undefined;
    let presenceTimer: ReturnType<typeof setInterval> | undefined;
    const reportPresence = () => { if (active && socket?.connected) socket.emit('presence_active', { active: notificationSurfaceVisible() }); };
    const refresh = async () => {
      if (!active) return;
      if (running) { again = true; return; }
      running = true;
      try {
        do {
          again = false;
          let items: Presented[] = [];
          if (Platform.OS === 'web') {
            const registration = await navigator.serviceWorker?.getRegistration();
            if (registration) items = (await registration.getNotifications()).map(n => ({ data: n.data ?? {}, close: () => n.close() }));
          } else {
            const notifications = await import('expo-notifications');
            items = (await notifications.getPresentedNotificationsAsync()).map(n => ({ data: n.request.content.data,
              close: () => notifications.dismissNotificationAsync(n.request.identifier) }));
          }
          if (!active) return;
          await reconcileChatNotifications(accountId, items, messagingSurfaceController.checkNotificationVisibility, () => active);
        } while (active && again);
      } catch { /* retain on transient failure; retry on the next activity */ }
      finally { running = false; }
    };
    const activity = () => { if (active) void refreshNotificationBadge({ force: true }); };
    const notificationChanged = () => { if (active) { activity(); publishNotificationUpdates(accountId); } };
    const invalidate = () => { if (active) { void refresh(); notificationChanged(); } };
    const state = AppState.addEventListener('change', value => { reportPresence(); if (value === 'active') invalidate(); });
    const visible = () => { reportPresence(); if (document.visibilityState === 'visible') invalidate(); };
    const push = (event: MessageEvent) => { if (event.data?.type === 'volna:notification') invalidate(); };
    if (Platform.OS === 'web') {
      window.addEventListener('focus', invalidate);
      window.addEventListener('online', invalidate);
      document.addEventListener('visibilitychange', visible);
      navigator.serviceWorker?.addEventListener('message', push);
    } else {
      void import('expo-notifications').then(n => { if (active) nativeSubscription = n.addNotificationReceivedListener(invalidate); }).catch(() => undefined);
    }
    void Promise.resolve(getApiSessionToken()).then(token => {
      if (!active) return;
      socket = io(`${apiUrl}/chat`, { transports: ['websocket'], auth: token ? { token } : {}, withCredentials: true });
      socket.on('chat_visibility_updated', invalidate);
      socket.on('thread_updated', activity);
      socket.on('notification_updated', notificationChanged);
      socket.on('notifications_resync', invalidate);
      releaseEncryptedActivity = subscribeEncryptedActivity(socket, activity);
      socket.on('connect', invalidate);
      socket.on('session_ready', invalidate);
      socket.on('session_ready', reportPresence);
      presenceTimer = setInterval(() => { if (notificationSurfaceVisible()) reportPresence(); }, 25_000);
    }).catch(() => undefined);
    void refresh();
    return () => {
      if (socket?.connected) socket.emit('presence_active', { active: false });
      active = false; releaseEncryptedActivity?.(); clearInterval(presenceTimer); socket?.disconnect(); state.remove(); nativeSubscription?.remove();
      if (Platform.OS === 'web') {
        window.removeEventListener('focus', invalidate); window.removeEventListener('online', invalidate);
        document.removeEventListener('visibilitychange', visible); navigator.serviceWorker?.removeEventListener('message', push);
      }
    };
  }, [accountId]);
}
