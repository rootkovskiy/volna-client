import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { recordApiDuration, recordClientGetCacheRequest } from '../monitoring/clientTelemetry';
import { isSameOriginUrl } from '../security/externalUrls.mjs';

const configuredApiUrl = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '');
const localWebHostname =
  Platform.OS === 'web' && typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname)
    ? window.location.hostname
    : null;

export const apiUrl = localWebHostname ? `http://${localWebHostname}:43101` : configuredApiUrl || 'http://localhost:43101';
export const remoteSearchDebounceMs = 1_000;
const rawFetch = globalThis.fetch.bind(globalThis);
const sessionTokenStorageKey = 'volna.sessionToken';
const legacySessionTokenStorageKey = 'soyuz.sessionToken';
let unauthorizedHandler: (() => void) | null = null;
let maintenanceHandler: (() => void) | null = null;
let errorHandler: ((message: string) => void) | null = null;
let lastReportedError = { message: '', time: 0 };
let nativeSessionToken = '';
let apiCacheGeneration = 0;
const clientInstanceId = `${Platform.OS}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const apiGetCache = new Map<string, ApiCacheEntry>();
const apiGetRequests = new Map<string, Promise<ApiResponseSnapshot>>();
const maxApiCacheEntries = 80;
const maxApiCacheBytes = 2 * 1024 * 1024;
let apiGetCacheBytes = 0;

type ApiResponseSnapshot = {
  body: string;
  headers: [string, string][];
  status: number;
  statusText: string;
};

type ApiCacheEntry = ApiResponseSnapshot & {
  byteSize: number;
  expiresAt: number;
  staleUntil: number;
};

type ApiCachePolicy = {
  staleMs: number;
  ttlMs: number;
};

function clearApiGetCache() {
  apiCacheGeneration += 1;
  apiGetCache.clear();
  apiGetRequests.clear();
  apiGetCacheBytes = 0;
}

export function apiCacheMonitoringSnapshot() {
  return {
    byteSize: apiGetCacheBytes,
    entries: apiGetCache.size,
    generation: apiCacheGeneration,
    inFlight: apiGetRequests.size,
  };
}

function apiCachePolicy(urlValue: string): ApiCachePolicy | null {
  let url: URL;
  try {
    url = new URL(urlValue);
  } catch {
    return null;
  }
  const path = url.pathname.replace(/^\/api(?=\/)/, '');
  const hasCursor = url.searchParams.has('cursor');
  if (
    path === '/locations/countries'
    || path === '/locations/cities'
    || path === '/public-pages/types'
    || path === '/public-pages/location-types'
    || path === '/events/types'
    || path === '/category-covers'
  ) {
    return { ttlMs: 60 * 60_000, staleMs: 24 * 60 * 60_000 };
  }
  if (path === '/events/category-counts' || path === '/public-pages/location-category-counts') {
    return { ttlMs: 60_000, staleMs: 5 * 60_000 };
  }
  if (/^\/profiles\/[^/]+$/.test(path) || /^\/public-pages\/[^/]+$/.test(path) || /^\/events\/[^/]+$/.test(path)) {
    return { ttlMs: 30_000, staleMs: 2 * 60_000 };
  }
  if (path === '/public-pages/owned/mine') {
    return { ttlMs: 60_000, staleMs: 5 * 60_000 };
  }
  if ((path === '/posts/feed' || path === '/posts' || path === '/public-pages' || path === '/events') && !hasCursor) {
    return { ttlMs: 12_000, staleMs: 45_000 };
  }
  if (path === '/search' && (url.searchParams.get('q')?.trim().length ?? 0) >= 3) {
    return { ttlMs: 30_000, staleMs: 2 * 60_000 };
  }
  if (path === '/music/apple/account/status' || path === '/music/yandex/account/status') {
    return { ttlMs: 60_000, staleMs: 5 * 60_000 };
  }
  return null;
}

function responseFromSnapshot(snapshot: ApiResponseSnapshot) {
  return new Response(snapshot.body, {
    status: snapshot.status,
    statusText: snapshot.statusText,
    headers: snapshot.headers,
  });
}

function touchApiCacheEntry(key: string, entry: ApiCacheEntry) {
  apiGetCache.delete(key);
  apiGetCache.set(key, entry);
}

function trimApiGetCache() {
  while (apiGetCache.size > maxApiCacheEntries || apiGetCacheBytes > maxApiCacheBytes) {
    const oldest = apiGetCache.entries().next().value as [string, ApiCacheEntry] | undefined;
    if (!oldest) break;
    apiGetCache.delete(oldest[0]);
    apiGetCacheBytes = Math.max(0, apiGetCacheBytes - oldest[1].byteSize);
  }
}

function storeApiCacheEntry(key: string, snapshot: ApiResponseSnapshot, policy: ApiCachePolicy) {
  const previous = apiGetCache.get(key);
  if (previous) apiGetCacheBytes -= previous.byteSize;
  const byteSize = snapshot.body.length * 2;
  const now = Date.now();
  const entry: ApiCacheEntry = {
    ...snapshot,
    byteSize,
    expiresAt: now + policy.ttlMs,
    staleUntil: now + policy.ttlMs + policy.staleMs,
  };
  apiGetCache.set(key, entry);
  apiGetCacheBytes += byteSize;
  trimApiGetCache();
}

function localizedFetchError(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  if (/string did not match the expected pattern/i.test(message)) {
    return new Error('Не удалось сформировать запрос к серверу. Обновите приложение и попробуйте снова');
  }
  if (error instanceof TypeError || /network request failed|failed to fetch|load failed/i.test(message)) {
    return new Error('Не удалось подключиться к серверу. Проверьте интернет-соединение');
  }
  return error;
}

export const baseFetch: typeof globalThis.fetch = async (input, init) => {
  try {
    return await rawFetch(input, init);
  } catch (error) {
    throw localizedFetchError(error);
  }
};

export function setApiSessionToken(token: string) {
  const nextToken = Platform.OS === 'web' ? '' : token.trim();
  if (nativeSessionToken !== nextToken) clearApiGetCache();
  nativeSessionToken = nextToken;
}

export function getApiSessionToken() {
  return nativeSessionToken || undefined;
}

export function setApiUnauthorizedHandler(handler: (() => void) | null) {
  unauthorizedHandler = handler;
}

export function triggerApiUnauthorized() {
  unauthorizedHandler?.();
}

export function setApiMaintenanceHandler(handler: (() => void) | null) {
  maintenanceHandler = handler;
}

export function setApiErrorHandler(handler: ((message: string) => void) | null) {
  errorHandler = handler;
}

export function reportApiError(message: string) {
  const normalized = message.trim();
  if (!normalized) return;
  const now = Date.now();
  if (lastReportedError.message === normalized && now - lastReportedError.time < 1_500) return;
  lastReportedError = { message: normalized, time: now };
  errorHandler?.(normalized);
}

function apiStatusErrorMessage(status: number) {
  if (status === 502 || status === 503 || status === 504) {
    return 'Сервер VOLNA временно недоступен. Попробуйте ещё раз через несколько секунд';
  }
  return `Не удалось выполнить запрос (${status})`;
}

async function performApiFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const startedAt = performance.now();
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const headers = new Headers();
  const appendHeader = (key: string, value: string) => {
    if (Platform.OS === 'web' && key.toLowerCase() === 'authorization') return;
    headers.set(key, value);
  };
  if (init.headers instanceof Headers) init.headers.forEach((value, key) => appendHeader(key, value));
  else if (Array.isArray(init.headers)) init.headers.forEach(([key, value]) => appendHeader(key, value));
  else Object.entries(init.headers ?? {}).forEach(([key, value]) => appendHeader(key, String(value)));
  const timeoutOverride = Number(headers.get('x-volna-timeout-ms') || 0);
  headers.delete('x-volna-timeout-ms');
  headers.set('x-client-platform', Platform.OS);
  headers.set('x-volna-client', clientInstanceId);
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const screen = window.location.pathname.split('/').filter(Boolean)[0] || 'home';
    headers.set('x-volna-screen', screen.slice(0, 40));
  }
  if (Platform.OS !== 'web' && nativeSessionToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${nativeSessionToken}`);
  }
  if (headers.get('Authorization')?.trim().toLowerCase() === 'bearer') headers.delete('Authorization');
  const timeoutController = new AbortController();
  const upstreamSignal = init.signal;
  const abortFromUpstream = () => timeoutController.abort();
  if (upstreamSignal?.aborted) abortFromUpstream();
  else upstreamSignal?.addEventListener('abort', abortFromUpstream, { once: true });
  const timeoutId = setTimeout(
    () => timeoutController.abort(),
    Number.isFinite(timeoutOverride) && timeoutOverride >= 1_000 ? Math.min(timeoutOverride, 10 * 60_000) : 15_000,
  );
  let response: Response;
  try {
    response = await baseFetch(input, {
      ...init,
      credentials: Platform.OS === 'web' ? 'include' : init.credentials,
      headers,
      signal: timeoutController.signal,
    });
  } catch (error) {
    const normalized = error instanceof Error && error.name === 'AbortError'
      ? new Error('Сервер не ответил вовремя. Попробуйте ещё раз')
      : localizedFetchError(error);
    if (normalized instanceof Error) reportApiError(normalized.message);
    throw normalized;
  } finally {
    clearTimeout(timeoutId);
    upstreamSignal?.removeEventListener('abort', abortFromUpstream);
  }
  const isAuthenticationAttempt = url.includes('/auth/login') || url.includes('/auth/register');
  // `/auth/me` is the passive startup probe. A 401 there means there is no
  // restorable session, not that a currently active session has just expired.
  const isSessionRestoreProbe = url.includes('/auth/me');
  recordApiDuration(url, performance.now() - startedAt, response.status, response.headers.get('x-volna-route'), init.method ?? (input instanceof Request ? input.method : 'GET'));
  if (response.status === 503 && response.headers.get('x-volna-maintenance') === '1') maintenanceHandler?.();
  if (response.status === 401 && !isAuthenticationAttempt && !isSessionRestoreProbe) triggerApiUnauthorized();
  if (!response.ok && !isSessionRestoreProbe && !(response.status === 503 && response.headers.get('x-volna-maintenance') === '1')) {
    void response.clone().json()
      .then((payload: { message?: string | string[] }) => {
        const message = Array.isArray(payload?.message) ? payload.message[0] : payload?.message;
        reportApiError(message || apiStatusErrorMessage(response.status));
      })
      .catch(() => reportApiError(apiStatusErrorMessage(response.status)));
  }
  return response;
}

async function snapshotApiResponse(response: Response): Promise<ApiResponseSnapshot> {
  const headers: [string, string][] = [];
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() !== 'set-cookie') headers.push([key, value]);
  });
  return {
    body: await response.text(),
    headers,
    status: response.status,
    statusText: response.statusText,
  };
}

export const apiFetch: typeof globalThis.fetch = async (input, init: RequestInit = {}) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  if (!isSameOriginUrl(url, apiUrl)) {
    try {
      return await baseFetch(input, init);
    } catch (error) {
      throw localizedFetchError(error);
    }
  }

  const method = (init.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
  const cachePolicy = method === 'GET' && !init.body && !headers.has('range') && init.cache !== 'no-store'
    ? apiCachePolicy(url)
    : null;

  if (!cachePolicy) {
    const response = await performApiFetch(input, init);
    if (method !== 'GET' && response.ok) clearApiGetCache();
    return response;
  }

  const cacheKey = `${apiCacheGeneration}:${url}`;
  const cached = apiGetCache.get(cacheKey);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    recordClientGetCacheRequest('hit');
    touchApiCacheEntry(cacheKey, cached);
    return responseFromSnapshot(cached);
  }

  const refresh = async () => {
    const response = await performApiFetch(input, init);
    const contentType = response.headers.get('content-type') ?? '';
    if (!response.ok || !contentType.toLowerCase().includes('application/json')) return snapshotApiResponse(response);
    const snapshot = await snapshotApiResponse(response);
    storeApiCacheEntry(cacheKey, snapshot, cachePolicy);
    return snapshot;
  };

  if (cached && cached.staleUntil > now) {
    recordClientGetCacheRequest('stale');
    touchApiCacheEntry(cacheKey, cached);
    if (!apiGetRequests.has(cacheKey)) {
      const request = refresh().finally(() => apiGetRequests.delete(cacheKey));
      apiGetRequests.set(cacheKey, request);
      void request.catch(() => undefined);
    }
    return responseFromSnapshot(cached);
  }

  // A caller-owned AbortSignal must keep its normal cancellation semantics,
  // so only ordinary screen loads share one in-flight network request.
  if (init.signal) {
    recordClientGetCacheRequest('miss');
    return responseFromSnapshot(await refresh());
  }
  const existing = apiGetRequests.get(cacheKey);
  if (existing) {
    recordClientGetCacheRequest('coalesced');
    return responseFromSnapshot(await existing);
  }
  recordClientGetCacheRequest('miss');
  const request = refresh().finally(() => apiGetRequests.delete(cacheKey));
  apiGetRequests.set(cacheKey, request);
  return responseFromSnapshot(await request);
};

export async function readApiError(response: Response, fallback: string) {
  let message = fallback;
  try {
    const payload = (await response.json()) as { message?: string | string[] };
    message = (Array.isArray(payload.message) ? payload.message[0] : payload.message) || fallback;
  } catch {}
  reportApiError(message);
  return message;
}

export async function getStoredSessionToken() {
  if (Platform.OS === 'web') return '';
  const current = await SecureStore.getItemAsync(sessionTokenStorageKey).catch(() => null);
  if (current) return current;
  const legacy = await SecureStore.getItemAsync(legacySessionTokenStorageKey).catch(() => null);
  if (legacy) {
    await SecureStore.setItemAsync(sessionTokenStorageKey, legacy).catch(() => undefined);
    await SecureStore.deleteItemAsync(legacySessionTokenStorageKey).catch(() => undefined);
  }
  return legacy;
}

export async function setStoredSessionToken(token: string) {
  if (Platform.OS === 'web' || !token) return;
  await SecureStore.setItemAsync(sessionTokenStorageKey, token);
}

export async function clearStoredSessionToken() {
  if (Platform.OS === 'web') return;
  await SecureStore.deleteItemAsync(sessionTokenStorageKey).catch(() => undefined);
  await SecureStore.deleteItemAsync(legacySessionTokenStorageKey).catch(() => undefined);
}
