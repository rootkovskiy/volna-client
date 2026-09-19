import * as Location from 'expo-location';
import { Platform } from 'react-native';
import { apiFetch, apiUrl } from '../api/client';

type Coordinates = { latitude: number; longitude: number };
export type DetectableCity = {
  id: string; name: string; countryCode: string; country: { name: string };
  latitude: number | null; longitude: number | null;
};
const permissionMessage = 'Разрешите доступ к геолокации в настройках или выберите город вручную';
const timeoutMessage = 'Не удалось определить город вовремя. Повторите или выберите его вручную';

function validCoordinates(value: Coordinates) {
  return Number.isFinite(value.latitude) && Math.abs(value.latitude) <= 90
    && Number.isFinite(value.longitude) && Math.abs(value.longitude) <= 180;
}

/** Same 120 km vicinity as the existing catalogs; never substitute a distant supported city. */
export function nearestSelectableCity(position: Coordinates, cities: DetectableCity[]): DetectableCity | null {
  if (!validCoordinates(position)) return null;
  const radians = (degrees: number) => degrees * Math.PI / 180;
  let nearest: DetectableCity | null = null;
  let distanceLimit = 120;
  for (const city of cities) {
    if (city.latitude == null || city.longitude == null || !validCoordinates({ latitude: city.latitude, longitude: city.longitude })) continue;
    const a = Math.sin(radians(city.latitude - position.latitude) / 2) ** 2
      + Math.cos(radians(position.latitude)) * Math.cos(radians(city.latitude)) * Math.sin(radians(city.longitude - position.longitude) / 2) ** 2;
    const distance = 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, a))));
    if (distance <= distanceLimit) { nearest = city; distanceLimit = distance; }
  }
  return nearest;
}

/** Explicit gesture only. Fresh foreground fix; no persistent coordinates or background watcher. */
export function requestCityPosition(signal: AbortSignal): Promise<Coordinates> {
  return new Promise((resolve, reject) => {
    let finished = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: Error, position?: Coordinates) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      if (error) reject(error);
      else if (position && validCoordinates(position)) resolve(position);
      else reject(new Error('Не удалось получить местоположение. Выберите город вручную'));
    };
    const abort = () => finish(Object.assign(new Error('Запрос отменён'), { name: 'AbortError' }));
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => finish(new Error(timeoutMessage)), 20_000);
    if (Platform.OS === 'web') {
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        finish(new Error('Геолокация недоступна в этом браузере. Выберите город вручную'));
        return;
      }
      try {
        // Start synchronously from the click, including Safari/PWA permission prompts.
        navigator.geolocation.getCurrentPosition(
          position => finish(undefined, position.coords),
          error => finish(new Error(error.code === 1 ? permissionMessage : error.code === 3 ? timeoutMessage : 'Не удалось получить местоположение. Попробуйте ещё раз')),
          { enableHighAccuracy: false, maximumAge: 60_000, timeout: 15_000 },
        );
      } catch { finish(new Error('Геолокация недоступна. Выберите город вручную')); }
      return;
    }
    void (async () => {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (finished) return;
      if (!permission.granted) { finish(new Error(permissionMessage)); return; }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      finish(undefined, position.coords);
    })().catch(() => finish(new Error('Не удалось получить местоположение. Проверьте геолокацию устройства')));
  });
}

export async function detectCurrentCity(signal: AbortSignal): Promise<DetectableCity> {
  const [position, cities] = await Promise.all([
    requestCityPosition(signal),
    apiFetch(`${apiUrl}/locations/cities`, { signal, headers: { 'x-volna-suppress-error-report': '1' } })
      .then(async response => {
        if (!response.ok) throw new Error('Не удалось загрузить города. Попробуйте ещё раз');
        const cities = await response.json();
        if (!Array.isArray(cities)) throw new Error('Не удалось загрузить города. Попробуйте ещё раз');
        return cities as DetectableCity[];
      }),
  ]);
  if (signal.aborted) throw Object.assign(new Error('Запрос отменён'), { name: 'AbortError' });
  const city = nearestSelectableCity(position, cities);
  if (!city) throw new Error('Рядом нет города из справочника VOLNA. Выберите местоположение вручную');
  return city;
}
