import { ScreenTopBarEnvironment } from '@volna/messaging-client/screen-top-bar';
import { useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { getNotificationBadgeSnapshot, retainNotificationBadgeSync, subscribeNotificationBadge } from '../notifications/badgeStore';
import { triggerLightHaptic } from '../utils/haptics';
export { ScreenTopBar } from '@volna/messaging-client/screen-top-bar';
export function AppTopBarProvider({ children }: { children: ReactNode }) {
  const { count, messageCount } = useSyncExternalStore(subscribeNotificationBadge, getNotificationBadgeSnapshot, getNotificationBadgeSnapshot);
  useEffect(() => retainNotificationBadgeSync(), []);
  const value = useMemo(() => ({ notificationCount: count, messageCount, onActionFeedback: triggerLightHaptic }), [count, messageCount]);
  return <ScreenTopBarEnvironment.Provider value={value}>{children}</ScreenTopBarEnvironment.Provider>;
}
