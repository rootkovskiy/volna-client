import { Platform } from 'react-native';

export type ClientMetricName = 'CLS' | 'FCP' | 'INP' | 'LCP' | 'TTFB' | 'API_DURATION' | 'LONG_TASK' | 'JS_HEAP_USED_MB' | 'JS_HEAP_USAGE' | 'IMAGE_TRANSFER_BYTES' | 'SCRIPT_TRANSFER_BYTES' | 'RENDER_RATE' | 'REQUEST_BURST' | 'FRAME_TIME' | 'CLIENT_GET_CACHE_REQUEST';
type ClientMetric = {
  name: ClientMetricName;
  value: number;
  rating: 'good' | 'needs-improvement' | 'poor';
  screen: string;
  route?: string;
  status?: number;
};

const queue: ClientMetric[] = [];
let endpoint = '';
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const renderWindows = new Map<string, { count: number; startedAt: number; reportedAt: number }>();
const requestWindows = new Map<string, { count: number; startedAt: number; reportedAt: number }>();
const anomalyCooldownMs = 2 * 60_000;

const currentScreen = () => typeof window === 'undefined'
  ? 'unknown'
  : (window.location.pathname.split('/').filter(Boolean)[0] || 'home').slice(0, 40);

const scheduleFlush = () => {
  if (!endpoint || flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    const metrics = queue.splice(0, 20);
    if (!metrics.length) return;
    void globalThis.fetch(endpoint, {
      method: 'POST',
      credentials: 'include',
      keepalive: true,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ metrics }),
    }).catch(() => undefined);
    if (queue.length) scheduleFlush();
  }, 1_000);
};

export function recordClientMetric(metric: Omit<ClientMetric, 'screen'> & { screen?: string }) {
  if (Platform.OS !== 'web' || !Number.isFinite(metric.value) || metric.value < 0) return;
  queue.push({ ...metric, value: Number(metric.value.toFixed(2)), screen: metric.screen ?? currentScreen() });
  if (queue.length > 100) queue.splice(0, queue.length - 100);
  scheduleFlush();
}

const boundedRoute = (url: string, serverRoute?: string | null) => {
  if (serverRoute) return serverRoute.slice(0, 120);
  try {
    const pathname = new URL(url, window.location.origin).pathname
      .replace(/\/[0-9a-f]{20,}(?=\/|$)/gi, '/:id')
      .replace(/\/\d+(?=\/|$)/g, '/:id');
    return pathname.slice(0, 120) || '/';
  } catch {
    return 'unknown';
  }
};

function recordRequestBurst(method: string, route: string) {
  if (!endpoint || route === '/metrics/client') return;
  const now = performance.now();
  const key = `${method.toUpperCase()}:${route}`;
  const current = requestWindows.get(key) ?? { count: 0, startedAt: now, reportedAt: -anomalyCooldownMs };
  if (now - current.startedAt > 10_000) {
    current.count = 0;
    current.startedAt = now;
  }
  current.count += 1;
  const elapsedSeconds = Math.max(1, (now - current.startedAt) / 1_000);
  const threshold = method.toUpperCase() === 'GET' ? 8 : 4;
  if (current.count >= threshold && now - current.reportedAt >= anomalyCooldownMs) {
    const callsPerTenSeconds = current.count / elapsedSeconds * 10;
    recordClientMetric({ name: 'REQUEST_BURST', value: callsPerTenSeconds, rating: callsPerTenSeconds >= threshold * 2 ? 'poor' : 'needs-improvement', route: key });
    current.reportedAt = now;
  }
  requestWindows.set(key, current);
}

export function recordApiDuration(url: string, durationMs: number, status: number, serverRoute?: string | null, method = 'GET') {
  if (!endpoint) return;
  const route = boundedRoute(url, serverRoute);
  recordRequestBurst(method, route);
  const rating = durationMs <= 500 ? 'good' : durationMs <= 1_500 ? 'needs-improvement' : 'poor';
  recordClientMetric({ name: 'API_DURATION', value: durationMs, rating, route, status });
}

export function recordClientGetCacheRequest(result: 'miss' | 'hit' | 'coalesced' | 'stale') {
  const value = { miss: 0, hit: 1, coalesced: 2, stale: 3 }[result];
  recordClientMetric({ name: 'CLIENT_GET_CACHE_REQUEST', value, rating: result === 'miss' ? 'needs-improvement' : 'good' });
}

/** Cheap render-loop detector for known high-cardinality UI components. */
export function recordClientRender(component: string, instance?: string) {
  if (Platform.OS !== 'web' || !endpoint) return;
  const now = performance.now();
  const route = component.slice(0, 120);
  // Aggregating every mounted row under one key turns a large list's healthy
  // initial paint into a fake rerender storm. Callers may provide their stable
  // React instance id so only repeated renders of the same row are counted.
  const key = instance ? `${route}:${instance}`.slice(0, 240) : route;
  const current = renderWindows.get(key) ?? { count: 0, startedAt: now, reportedAt: -anomalyCooldownMs };
  if (now - current.startedAt > 3_000) {
    current.count = 0;
    current.startedAt = now;
  }
  current.count += 1;
  const elapsedMs = Math.max(250, now - current.startedAt);
  const rendersPerSecond = current.count / elapsedMs * 1_000;
  if (current.count >= 80 && rendersPerSecond >= 40 && now - current.reportedAt >= anomalyCooldownMs) {
    recordClientMetric({ name: 'RENDER_RATE', value: rendersPerSecond, rating: rendersPerSecond >= 100 ? 'poor' : 'needs-improvement', route });
    current.reportedAt = now;
  }
  renderWindows.set(key, current);
}

export function startClientTelemetry(apiUrl: string) {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || endpoint) return;
  endpoint = `${apiUrl}/metrics/client`;
  void import('web-vitals').then(({ onCLS, onFCP, onINP, onLCP, onTTFB }) => {
    const report = (metric: { name: string; value: number; rating: 'good' | 'needs-improvement' | 'poor' }) => {
      if (['CLS', 'FCP', 'INP', 'LCP', 'TTFB'].includes(metric.name)) {
        recordClientMetric({ name: metric.name as ClientMetricName, value: metric.value, rating: metric.rating });
      }
    };
    onCLS(report); onFCP(report); onINP(report); onLCP(report); onTTFB(report);
  }).catch(() => undefined);
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration < 100) continue;
        const rating = entry.duration <= 100 ? 'good' : entry.duration <= 200 ? 'needs-improvement' : 'poor';
        recordClientMetric({ name: 'LONG_TASK', value: entry.duration, rating });
      }
    });
    observer.observe({ type: 'longtask', buffered: true });
  } catch { /* Long Tasks are not supported in every PWA browser. */ }
  const sampleHeap = () => {
    if (document.visibilityState !== 'visible') return;
    const memory = (performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
    if (!memory?.jsHeapSizeLimit) return;
    const usedMb = memory.usedJSHeapSize / 1024 / 1024;
    const usage = memory.usedJSHeapSize / memory.jsHeapSizeLimit * 100;
    recordClientMetric({ name: 'JS_HEAP_USED_MB', value: usedMb, rating: usedMb <= 128 ? 'good' : usedMb <= 256 ? 'needs-improvement' : 'poor' });
    recordClientMetric({ name: 'JS_HEAP_USAGE', value: usage, rating: usage <= 60 ? 'good' : usage <= 80 ? 'needs-improvement' : 'poor' });
  };
  sampleHeap();
  window.setInterval(sampleHeap, 60_000);
  const seenResources = new Set<string>();
  const recordResource = (entry: PerformanceResourceTiming) => {
    const key = `${entry.name}:${entry.startTime}`;
    if (seenResources.has(key)) return;
    seenResources.add(key);
    if (seenResources.size > 2_000) seenResources.clear();
    const bytes = entry.encodedBodySize || entry.transferSize;
    if (!bytes) return;
    if (entry.initiatorType === 'img') recordClientMetric({ name: 'IMAGE_TRANSFER_BYTES', value: bytes, rating: bytes <= 250 * 1024 ? 'good' : bytes <= 750 * 1024 ? 'needs-improvement' : 'poor' });
    if (entry.initiatorType === 'script' && !__DEV__) recordClientMetric({ name: 'SCRIPT_TRANSFER_BYTES', value: bytes, rating: bytes <= 1024 * 1024 ? 'good' : bytes <= 3 * 1024 * 1024 ? 'needs-improvement' : 'poor' });
  };
  performance.getEntriesByType('resource').forEach((entry) => recordResource(entry as PerformanceResourceTiming));
  try {
    const resourceObserver = new PerformanceObserver((list) => list.getEntries().forEach((entry) => recordResource(entry as PerformanceResourceTiming)));
    resourceObserver.observe({ type: 'resource', buffered: true });
  } catch { /* Resource Timing is optional in embedded web views. */ }

  let frameCount = 0;
  let frameWindowStartedAt = performance.now();
  let previousFrameAt = frameWindowStartedAt;
  let lastFrameActivityAt = frameWindowStartedAt;
  const markFrameActivity = () => {
    lastFrameActivityAt = performance.now();
  };
  window.addEventListener('pointerdown', markFrameActivity, { passive: true });
  window.addEventListener('touchstart', markFrameActivity, { passive: true });
  window.addEventListener('keydown', markFrameActivity, { passive: true });
  window.addEventListener('scroll', markFrameActivity, { passive: true });
  const sampleFrames = (now: number) => {
    const frameGap = now - previousFrameAt;
    previousFrameAt = now;
    const isInteractive = now - lastFrameActivityAt <= 5_000;
    if (document.visibilityState !== 'visible' || !document.hasFocus() || !isInteractive || frameGap > 250) {
      frameCount = 0;
      frameWindowStartedAt = now;
      window.requestAnimationFrame(sampleFrames);
      return;
    }
    frameCount += 1;
    const elapsed = now - frameWindowStartedAt;
    if (elapsed >= 5_000) {
      const fps = frameCount / elapsed * 1_000;
      if (fps < 45) {
        const frameTime = 1_000 / Math.max(1, fps);
        recordClientMetric({ name: 'FRAME_TIME', value: frameTime, rating: fps < 30 ? 'poor' : 'needs-improvement' });
      }
      frameCount = 0;
      frameWindowStartedAt = now;
    }
    window.requestAnimationFrame(sampleFrames);
  };
  window.requestAnimationFrame(sampleFrames);
}
