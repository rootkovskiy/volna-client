export const connectLocationRefreshMs = 5 * 60_000;
export const connectLocationForegroundIntervalMs = 10 * 60_000;
export const connectLocationFixMaxAgeMs = 60_000;
const retryDelayMs = 30_000;

export type ConnectLocationSession = { accountId: string; token: string; enabled: boolean };
export type ConnectLocationFix = { latitude: number; longitude: number; timestamp: number };
type Dependencies = {
  now: () => number;
  isForeground: () => boolean;
  readSuccess: (accountId: string) => Promise<number | null>;
  writeSuccess: (accountId: string, timestamp: number | null) => Promise<void>;
  hasPermission: () => Promise<boolean>;
  locate: (signal: AbortSignal) => Promise<ConnectLocationFix>;
  publish: (session: ConnectLocationSession, fix: ConnectLocationFix, signal: AbortSignal) => Promise<boolean>;
};

/** One account-bound operation shared by startup, resume and the Connect catalog. */
export function createConnectLocationSync(deps: Dependencies) {
  let session: ConnectLocationSession | null = null;
  let generation = 0;
  let pending: { controller: AbortController; promise: Promise<void> } | null = null;
  let lastAttempt: number | null = null;
  let success: number | null = null;
  let storageWrites = Promise.resolve();

  function persist(accountId: string, timestamp: number | null) {
    // Serialize clear/write with reads, including fast disable/re-enable.
    storageWrites = storageWrites.then(() => deps.writeSuccess(accountId, timestamp)).catch(() => undefined);
    return storageWrites;
  }

  function cancel() {
    generation += 1;
    pending?.controller.abort();
    pending = null;
    lastAttempt = null;
  }

  function configure(next: ConnectLocationSession | null) {
    cancel();
    session = next;
    success = null;
    if (next && !next.enabled) void persist(next.accountId, null);
  }

  function refresh(accountId?: string): Promise<void> {
    const owner = session;
    if (!owner?.enabled || (accountId && owner.accountId !== accountId) || !deps.isForeground()) return Promise.resolve();
    if (pending) return pending.promise;
    const controller = new AbortController();
    const epoch = generation;
    const current = () => epoch === generation && !controller.signal.aborted && deps.isForeground();
    const operation = { controller, promise: Promise.resolve() };
    pending = operation;
    operation.promise = (async () => {
      try {
        await storageWrites;
        const stored = await deps.readSuccess(owner.accountId).catch(() => null);
        if (!current()) return;
        const now = deps.now();
        const latest = Math.max(success ?? 0, stored ?? 0);
        // Future/invalid device timestamps must not suppress refresh indefinitely.
        if (Number.isFinite(latest) && latest > 0 && latest <= now && now - latest <= connectLocationRefreshMs) return;
        if (lastAttempt !== null && now >= lastAttempt && now - lastAttempt < retryDelayMs) return;
        lastAttempt = now;
        if (!await deps.hasPermission() || !current()) return;
        const fix = await deps.locate(controller.signal);
        if (!current()) return;
        const age = deps.now() - fix.timestamp;
        if (!Number.isFinite(age) || age < -30_000 || age > connectLocationFixMaxAgeMs
          || !Number.isFinite(fix.latitude) || Math.abs(fix.latitude) > 90
          || !Number.isFinite(fix.longitude) || Math.abs(fix.longitude) > 180) return;
        if (!await deps.publish(owner, fix, controller.signal) || !current()) return;
        // Only an acknowledged fresh fix advances the successful-fix clock.
        success = fix.timestamp;
        await persist(owner.accountId, fix.timestamp);
      } catch {
        // Permission, GPS and network failures retain the last real server fix.
      } finally {
        if (pending === operation) pending = null;
      }
    })();
    return operation.promise;
  }

  return { configure, refresh, cancel };
}
