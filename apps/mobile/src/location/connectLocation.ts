import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { Platform } from 'react-native';
import { isAppForeground } from '@volna/messaging-client/app-activity';
import { apiFetch, apiUrl } from '../api/client';
import { createConnectLocationSync, connectLocationFixMaxAgeMs, type ConnectLocationFix } from './connectLocationSync';

const storageKey = (accountId: string) => `volna:connect-location-success:v1:${accountId}`;
const positionTimeoutMs = 12_000;

/** Fresh one-shot fix. Native observation is removed on completion, abort or timeout. */
export function locateConnectPosition(signal: AbortSignal): Promise<ConnectLocationFix> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let subscription: Location.LocationSubscription | null = null;
    const finish = (fix?: ConnectLocationFix, error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      subscription?.remove();
      if (fix) resolve(fix);
      else reject(error ?? new Error('Location unavailable'));
    };
    const abort = () => finish(undefined, Object.assign(new Error('Location cancelled'), { name: 'AbortError' }));
    const timer = setTimeout(() => finish(), positionTimeoutMs);
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    const receive = (position: { coords: { latitude: number; longitude: number }; timestamp: number }) => {
      // Native can deliver its cached position first; wait for a fresh sample.
      const age = Date.now() - position.timestamp;
      if (!Number.isFinite(age) || age < -30_000 || age > connectLocationFixMaxAgeMs) return;
      finish({ latitude: position.coords.latitude, longitude: position.coords.longitude, timestamp: position.timestamp });
    };
    if (Platform.OS === 'web') {
      if (typeof navigator === 'undefined' || !navigator.geolocation) { finish(); return; }
      navigator.geolocation.getCurrentPosition(receive, () => finish(), {
        maximumAge: 0, timeout: positionTimeoutMs, enableHighAccuracy: false,
      });
    } else {
      void Location.watchPositionAsync({
        accuracy: Location.Accuracy.Balanced, mayShowUserSettingsDialog: false,
        timeInterval: 1_000, distanceInterval: 0,
      }, receive, () => finish()).then((watch) => {
        if (settled) watch.remove();
        else subscription = watch;
      }).catch(() => finish());
    }
  });
}

export const connectLocationSync = createConnectLocationSync({
  now: Date.now,
  isForeground: isAppForeground,
  readSuccess: async (accountId) => {
    const value = Number(await AsyncStorage.getItem(storageKey(accountId)));
    return Number.isFinite(value) && value > 0 ? value : null;
  },
  writeSuccess: (accountId, timestamp) => timestamp === null
    ? AsyncStorage.removeItem(storageKey(accountId))
    : AsyncStorage.setItem(storageKey(accountId), String(timestamp)),
  // Do not use remembered permission or request*Permissions in an automatic flow.
  hasPermission: async () => (await Location.getForegroundPermissionsAsync()).granted,
  locate: locateConnectPosition,
  publish: async (session, fix, signal) => {
    const response = await apiFetch(`${apiUrl}/profiles/connect-location`, {
      method: 'PATCH', signal,
      headers: {
        'Content-Type': 'application/json', 'x-volna-suppress-error-report': '1',
        ...(session.token ? { Authorization: `Bearer ${session.token}` } : {}),
      },
      body: JSON.stringify({
        accountId: session.accountId, latitude: fix.latitude, longitude: fix.longitude, observedAt: fix.timestamp,
      }),
    });
    return response.ok;
  },
});
