import { useEffect, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { Bell } from 'lucide-react-native';
import { currentWebPushPermission, isInstalledPwa, requestWebPushPermission, syncWebPushSubscription } from '../pushNotifications';
import { styles } from '../styles';
import { AppSheetModal } from './AppSheetModal';

export function PushPermissionPrompt({ onNotify }: { onNotify: (message: string, type?: 'success' | 'error') => void }) {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'web' || !isInstalledPwa()) return;
    const permission = currentWebPushPermission();
    if (permission === 'granted') void syncWebPushSubscription().catch(() => undefined);
    else if (permission !== 'unsupported') setVisible(true);
  }, []);

  const enable = async () => {
    setBusy(true);
    try {
      if (currentWebPushPermission() === 'denied') {
        onNotify('Откройте настройки сайта на iPhone и разрешите уведомления для VOLNA', 'error');
        setVisible(false);
        return;
      }
      const permission = await requestWebPushPermission();
      if (permission === 'granted') {
        setVisible(false);
        onNotify('Push-уведомления включены', 'success');
      } else {
        onNotify('Разрешение не выдано. Его можно включить в настройках браузера', 'error');
        setVisible(false);
      }
    } catch (error) {
      onNotify(error instanceof Error ? error.message : 'Не удалось включить уведомления', 'error');
    } finally {
      setBusy(false);
    }
  };

  return <AppSheetModal isVisible={visible} onClose={() => setVisible(false)} title="Уведомления">
    <View style={styles.pushPermissionIntro}>
      <Bell color="#111" size={28} />
      <Text style={styles.pushPermissionText}>Получать push-уведомления о новых подписчиках, лайках на ваших постах и других важных событиях внутри приложения.</Text>
    </View>
    <Pressable accessibilityState={{ disabled: busy }} disabled={busy} nativeID="push-permission-allow" onPress={() => void enable()} style={[styles.pushPermissionPrimary, busy && styles.disabledButton]}><Text style={styles.pushPermissionPrimaryText}>{busy ? 'Подключаем…' : 'Разрешить'}</Text></Pressable>
    <Pressable onPress={() => setVisible(false)} style={styles.pushPermissionSecondary}><Text style={styles.pushPermissionSecondaryText}>Не сейчас</Text></Pressable>
  </AppSheetModal>;
}
