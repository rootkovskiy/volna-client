import { Bell, ChevronLeft, MessageSquare } from 'lucide-react-native';
import { createContext, useContext, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

// The host supplies state and platform feedback; this public UI owns no session.
export const ScreenTopBarEnvironment = createContext({ notificationCount: 0, messageCount: 0, onActionFeedback: () => {} });
export type ScreenTopBarProps = {
  title?: string; subtitle?: string; children?: ReactNode; canGoBack?: boolean; onBack?: () => void;
  backLabel?: string; onOpenNotifications?: () => void; onOpenMessages?: () => void;
  onOpenMenu?: () => void; trailingAction?: ReactNode; centered?: boolean;
};
export function ScreenTopBar({ title, subtitle, children, canGoBack = true, onBack, backLabel = 'Назад', onOpenNotifications, onOpenMessages, onOpenMenu, trailingAction, centered = false }: ScreenTopBarProps) {
  const environment = useContext(ScreenTopBarEnvironment);
  const count = Math.max(0, Math.floor(environment.notificationCount));
  const messageCount = Math.max(0, Math.floor(environment.messageCount || 0));
  const back = canGoBack && onBack ? <Pressable accessibilityRole="button" accessibilityLabel={backLabel} onPress={onBack} style={topBarStyles.backButton}><ChevronLeft size={29} color="#111" strokeWidth={2.1} /></Pressable> : null;
  const identity = children ?? (subtitle ? <View style={topBarStyles.titleGroup}>
    <Text accessibilityRole="header" numberOfLines={1} style={[topBarStyles.title, centered && topBarStyles.centeredText]}>{title}</Text>
    <Text numberOfLines={1} style={[topBarStyles.subtitle, centered && topBarStyles.centeredText]}>{subtitle}</Text>
  </View> : <Text accessibilityRole="header" numberOfLines={1} style={[topBarStyles.title, centered && topBarStyles.centeredTitle]}>{title}</Text>);
  const actions = <View style={[topBarStyles.actions, centered && topBarStyles.balancingSlot]}>
    {onOpenNotifications ? <Pressable accessibilityRole="button" accessibilityLabel={`Открыть уведомления${count ? `, непрочитанных: ${count}` : ''}`} onPress={() => { environment.onActionFeedback(); onOpenNotifications(); }} style={topBarStyles.iconButton}>
      <Bell size={27} color="#98a3ae" strokeWidth={2} />
      {count > 0 ? <View pointerEvents="none" style={topBarStyles.badge}><Text style={topBarStyles.badgeText}>{count > 99 ? '99+' : count}</Text></View> : null}
    </Pressable> : null}
    {onOpenMessages ? <Pressable accessibilityRole="button" accessibilityLabel={`Открыть сообщения${messageCount ? `, непрочитанных: ${messageCount}` : ''}`} onPress={() => { environment.onActionFeedback(); onOpenMessages(); }} style={topBarStyles.iconButton}><MessageSquare size={27} color="#98a3ae" strokeWidth={1.9} />{messageCount > 0 ? <View pointerEvents="none" style={topBarStyles.badge}><Text style={topBarStyles.badgeText}>{messageCount > 99 ? '99+' : messageCount}</Text></View> : null}</Pressable> : null}
    {onOpenMenu ? <Pressable accessibilityRole="button" accessibilityLabel="Открыть меню" onPress={() => { environment.onActionFeedback(); onOpenMenu(); }} style={topBarStyles.iconButton}><View accessible={false} style={topBarStyles.menuIcon}><View style={topBarStyles.menuLine} /><View style={topBarStyles.menuLine} /></View></Pressable> : null}
    {trailingAction}
  </View>;
  return <View style={topBarStyles.bar}>{centered ? <><View style={[topBarStyles.balancingSlot, topBarStyles.leadingSlot]}>{back}</View>{identity}{actions}</> : <><View style={topBarStyles.left}>{back}{identity}</View>{actions}</>}</View>;
}
const iconButton = { width: 44, height: 44, flexShrink: 0, alignItems: 'center', justifyContent: 'center' } as const;
export const topBarStyles = StyleSheet.create({
  bar: { height: 52, flexShrink: 0, backgroundColor: '#fff', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#d7dee5', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18 },
  left: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flexShrink: 1, color: '#111', fontSize: 16, lineHeight: 21, fontWeight: '600' },
  titleGroup: { flex: 1, minWidth: 0 },
  subtitle: { color: '#6f7b86', fontSize: 12, lineHeight: 17 },
  centeredText: { textAlign: 'center' },
  actions: { flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: 4 },
  iconButton,
  // Align the visible chevron with the content gutter, keeping its 44px target
  // and the balanced title slots. Avoid resting transforms (Safari inputs).
  backButton: { ...iconButton, marginLeft: -16 },
  leadingSlot: { alignItems: 'flex-start' },
  menuIcon: { width: 27, height: 16, justifyContent: 'space-between', paddingVertical: 2 },
  menuLine: { width: 27, height: 2, borderRadius: 2, backgroundColor: '#98a3ae' },
  badge: { position: 'absolute', top: 2, right: 1, minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: '#111' },
  badgeText: { color: '#fff', fontSize: 10, lineHeight: 12, fontWeight: '700' },
  balancingSlot: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  centeredTitle: { flex: 1, textAlign: 'center' },
});
