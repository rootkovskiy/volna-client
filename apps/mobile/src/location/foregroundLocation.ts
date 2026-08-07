import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';

const foregroundLocationStorageKey = 'volna:foreground-location:v1';
const defaultCachedLocationMaxAgeMs = 24 * 60 * 60 * 1_000;

type StoredForegroundLocation = {
  grantedAt: number;
  latitude?: number;
  longitude?: number;
  positionRecordedAt?: number;
};

export type ForegroundLocationAccess = {
  canAskAgain: boolean;
  granted: boolean;
};

function isFiniteCoordinate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

async function readStoredForegroundLocation() {
  try {
    const raw = await AsyncStorage.getItem(foregroundLocationStorageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredForegroundLocation>;
    if (!Number.isFinite(parsed.grantedAt)) return null;
    return parsed as StoredForegroundLocation;
  } catch {
    return null;
  }
}

async function writeStoredForegroundLocation(value: StoredForegroundLocation) {
  await AsyncStorage.setItem(foregroundLocationStorageKey, JSON.stringify(value)).catch(() => undefined);
}

async function rememberGrantedLocation(position?: Location.LocationObject | null) {
  const current = await readStoredForegroundLocation();
  const now = Date.now();
  await writeStoredForegroundLocation({
    grantedAt: now,
    latitude: position?.coords.latitude ?? current?.latitude,
    longitude: position?.coords.longitude ?? current?.longitude,
    positionRecordedAt: position ? now : current?.positionRecordedAt,
  });
}

/**
 * WebKit may temporarily report `undetermined` again for an installed PWA.
 * A previous explicit grant is therefore retained device-locally, while an
 * explicit denial still wins immediately.
 */
export async function getForegroundLocationAccess(): Promise<ForegroundLocationAccess> {
  const [permission, remembered] = await Promise.all([
    Location.getForegroundPermissionsAsync(),
    readStoredForegroundLocation(),
  ]);
  if (permission.granted) {
    await rememberGrantedLocation();
    return { canAskAgain: permission.canAskAgain, granted: true };
  }
  if (permission.status === 'undetermined' && remembered) {
    return { canAskAgain: true, granted: true };
  }
  return { canAskAgain: permission.canAskAgain, granted: false };
}

export async function requestForegroundLocationAccess(): Promise<ForegroundLocationAccess> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) {
    return { canAskAgain: permission.canAskAgain, granted: false };
  }
  let position: Location.LocationObject | null = null;
  try {
    position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  } catch {
    // Persist the explicit grant even when the first position fix is unavailable.
  }
  await rememberGrantedLocation(position);
  return { canAskAgain: permission.canAskAgain, granted: true };
}

/**
 * Resolves a position without ever opening a permission prompt. Catalogs use
 * the last successful fix when iOS PWA permission state falls back to prompt.
 */
export async function resolveForegroundLocation(
  maxCacheAgeMs = defaultCachedLocationMaxAgeMs,
): Promise<{ latitude: number; longitude: number } | null> {
  const permission = await Location.getForegroundPermissionsAsync();
  if (permission.granted) {
    try {
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      await rememberGrantedLocation(position);
      return {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      };
    } catch {
      // A cached fix is still useful when GPS is temporarily unavailable.
    }
  }

  const cached = await readStoredForegroundLocation();
  if (
    !cached?.positionRecordedAt
    || Date.now() - cached.positionRecordedAt > maxCacheAgeMs
    || !isFiniteCoordinate(cached.latitude)
    || !isFiniteCoordinate(cached.longitude)
  ) {
    return null;
  }
  return { latitude: cached.latitude, longitude: cached.longitude };
}
