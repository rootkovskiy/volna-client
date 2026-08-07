import { Platform } from 'react-native';
import { apiFetch, apiUrl, readApiError } from './api/client';

function toUint8Array(value: string) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = globalThis.atob(base64);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

export function isInstalledPwa() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return false;
  return window.matchMedia('(display-mode: standalone)').matches || Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);
}

export function webPushSupport() {
  return Platform.OS === 'web' && typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
}

export async function syncWebPushSubscription() {
  if (!webPushSupport() || Notification.permission !== 'granted') return false;
  const registration = await navigator.serviceWorker.ready;
  const keyResponse = await apiFetch(`${apiUrl}/notifications/push/public-key`);
  if (!keyResponse.ok) throw new Error(await readApiError(keyResponse, 'Не удалось получить ключ уведомлений'));
  const { publicKey } = await keyResponse.json() as { publicKey: string | null };
  if (!publicKey) throw new Error('Push-уведомления временно не настроены');
  const existing = await registration.pushManager.getSubscription();
  const subscription = existing ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toUint8Array(publicKey) });
  const json = subscription.toJSON();
  const response = await apiFetch(`${apiUrl}/notifications/push/subscriptions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys, userAgent: navigator.userAgent }),
  });
  if (!response.ok) throw new Error(await readApiError(response, 'Не удалось включить push-уведомления'));
  return true;
}

export async function requestWebPushPermission() {
  if (!webPushSupport()) throw new Error('Push-уведомления не поддерживаются этим браузером');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission;
  await syncWebPushSubscription();
  return permission;
}

export async function removeWebPushSubscription() {
  if (!webPushSupport()) return;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;
  await apiFetch(`${apiUrl}/notifications/push/subscriptions`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: subscription.endpoint }) }).catch(() => undefined);
  await subscription.unsubscribe().catch(() => false);
}

export function currentWebPushPermission(): NotificationPermission | 'unsupported' {
  return webPushSupport() ? Notification.permission : 'unsupported';
}
