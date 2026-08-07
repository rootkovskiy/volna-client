import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';

export default function RootLayout() {
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof screen === 'undefined') return;
    const orientation = screen.orientation as ScreenOrientation & {
      lock?: (value: 'portrait') => Promise<void>;
    };
    void orientation.lock?.('portrait').catch(() => {
      // iOS Home Screen web apps can ignore orientation locking; manifest remains the fallback.
    });
  }, []);

  return <Stack screenOptions={{ headerShown: false, animation: 'fade', orientation: 'portrait' }} />;
}
