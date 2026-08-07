import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

export function triggerLightHaptic() {
  if (Platform.OS === 'web') {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(10);
    return;
  }
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
}
