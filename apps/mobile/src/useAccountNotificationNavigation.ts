import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

// Native account notification taps use the same destinations as browser push links.
// A notification for a previous account must never open the current account's flow.
export function useAccountNotificationNavigation(accountId: string, onOpen: () => void, onNotifications: () => void) {
  const opened = useRef(new Set<string>());
  const callback = useRef({ onOpen, onNotifications });
  callback.current = { onOpen, onNotifications };
  useEffect(() => {
    if (Platform.OS === 'web') return;
    let active = true;
    let remove: (() => void) | undefined;
    void import('expo-notifications').then(async notifications => {
      if (!active) return;
      const handle = (response: import('expo-notifications').NotificationResponse | null) => {
        if (!active || !response || response.actionIdentifier !== notifications.DEFAULT_ACTION_IDENTIFIER) return;
        const request = response.notification.request;
        const data = request.content.data;
        if ((data.destination !== 'message-security' && data.destination !== 'notifications') || data.recipientId !== accountId || opened.current.has(request.identifier)) return;
        opened.current.add(request.identifier);
        if (opened.current.size > 32) opened.current.delete(opened.current.values().next().value!);
        if (data.destination === 'message-security') callback.current.onOpen();
        else callback.current.onNotifications();
      };
      const subscription = notifications.addNotificationResponseReceivedListener(handle);
      remove = () => subscription.remove();
      handle(await notifications.getLastNotificationResponseAsync());
    }).catch(() => undefined);
    return () => { active = false; remove?.(); };
  }, [accountId]);
}
