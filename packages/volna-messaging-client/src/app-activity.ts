import { AppState, Platform } from 'react-native';

export function isAppForeground() {
  return Platform.OS === 'web' ? typeof document !== 'undefined' && document.visibilityState === 'visible' : AppState.currentState === 'active';
}
export function subscribeAppActivity(callback: () => void) {
  const native = AppState.addEventListener('change', callback);
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.addEventListener('focus', callback);
    window.addEventListener('online', callback);
    document.addEventListener('visibilitychange', callback);
  }
  return () => {
    native.remove();
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.removeEventListener('focus', callback);
      window.removeEventListener('online', callback);
      document.removeEventListener('visibilitychange', callback);
    }
  };
}
