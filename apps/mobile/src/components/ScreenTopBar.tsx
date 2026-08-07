import { Bell, ChevronLeft, MessageSquare } from 'lucide-react-native';
import { useEffect, useSyncExternalStore } from 'react';
import { Pressable, Text, View } from 'react-native';
import {
  getNotificationBadgeSnapshot,
  markNotificationsRead,
  retainNotificationBadgeSync,
  subscribeNotificationBadge,
} from '../notifications/badgeStore';
import { styles } from '../styles';
import { triggerLightHaptic } from '../utils/haptics';

export function ScreenTopBar({
  canGoBack = false,
  onBack,
  onOpenMenu,
  onOpenMessages,
  onOpenNotifications,
  title,
}: {
  canGoBack?: boolean;
  onBack?: () => void;
  onOpenMenu?: () => void;
  onOpenMessages?: () => void;
  onOpenNotifications?: () => void;
  title: string;
}) {
  const { count: unreadCount } = useSyncExternalStore(
    subscribeNotificationBadge,
    getNotificationBadgeSnapshot,
    getNotificationBadgeSnapshot,
  );
  const notificationsEnabled = Boolean(onOpenNotifications);

  useEffect(() => {
    if (!notificationsEnabled) return;
    return retainNotificationBadgeSync();
  }, [notificationsEnabled]);

  return (
    <View style={styles.topBar}>
      <View style={styles.topBarLeft}>
        {canGoBack && onBack ? (
          <Pressable onPress={onBack} style={styles.topBarIconButton}>
            <ChevronLeft size={29} color="#090909" strokeWidth={2.1} />
          </Pressable>
        ) : null}
        <Text style={styles.topBarTitle}>{title}</Text>
      </View>
      {onOpenNotifications && onOpenMenu ? (
        <View style={styles.topBarActions}>
          <Pressable onPress={() => { markNotificationsRead(); onOpenNotifications(); }} style={styles.topBarIconButton}>
            <Bell size={27} color="#98a3ae" strokeWidth={2} />
            {unreadCount > 0 ? <View style={styles.notificationBadge}><Text style={styles.notificationBadgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text></View> : null}
          </Pressable>
          {onOpenMessages ? (
            <Pressable accessibilityLabel="Открыть сообщения" accessibilityRole="button" onPress={() => { triggerLightHaptic(); onOpenMessages(); }} style={styles.topBarIconButton}>
              <MessageSquare size={27} color="#98a3ae" strokeWidth={1.9} />
            </Pressable>
          ) : null}
          <Pressable accessibilityLabel="Открыть меню" accessibilityRole="button" onPress={() => { triggerLightHaptic(); onOpenMenu(); }} style={styles.topBarIconButton}>
            <View accessible={false} style={styles.topBarMenuIcon}>
              <View style={styles.topBarMenuIconLine} />
              <View style={styles.topBarMenuIconLine} />
            </View>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
