import { createContext, useContext, useMemo, useRef, type ReactNode } from 'react';

type Snapshot = { value: unknown; savedAt: number };
const Context = createContext<Map<string, Snapshot> | null>(null);
const maxSnapshots = 24;
const maxAgeMs = 5 * 60 * 1000;

/** Short-lived, account-scoped catalog rows so returning to a screen has image URLs immediately. */
export function CatalogSnapshotProvider({ children }: { children: ReactNode }) {
  const snapshots = useRef(new Map<string, Snapshot>()).current;
  return <Context.Provider value={snapshots}>{children}</Context.Provider>;
}

export function useCatalogSnapshot<T>(key: string) {
  const snapshots = useContext(Context);
  return useMemo(() => ({
    read(): T | null {
      const entry = snapshots?.get(key);
      if (!entry) return null;
      if (Date.now() - entry.savedAt > maxAgeMs) {
        snapshots?.delete(key);
        return null;
      }
      return entry.value as T;
    },
    write(value: T) {
      if (!snapshots) return;
      snapshots.delete(key);
      snapshots.set(key, { value, savedAt: Date.now() });
      if (snapshots.size > maxSnapshots) snapshots.delete(snapshots.keys().next().value!);
    },
  }), [key, snapshots]);
}
