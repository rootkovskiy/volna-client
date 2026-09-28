import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { apiFetch, apiUrl } from '../api/client';
import { nearestSelectableCity, type DetectableCity } from '../location/detectCity';
import { resolveForegroundLocation } from '../location/foregroundLocation';
import {
  applyDetectedCatalogCity, emptyCatalogLocationState, parseCatalogLocationState,
  selectCatalogLocation, serializeCatalogLocationState,
  type CatalogLocation, type CatalogLocationState, type CatalogScope,
} from './catalogLocationState';

export type { CatalogLocation } from './catalogLocationState';

const Context = createContext<{
  state: CatalogLocationState;
  select: (scope: CatalogScope, location: CatalogLocation) => void;
} | null>(null);

const storageKey = (accountId: string) => `volna:catalog-location:v1:${accountId}`;

/** Account-scoped geography, restored before catalog screens mount. No coordinates are persisted here. */
export function CatalogLocationProvider({ accountId, children, fallback = null }: {
  accountId?: string;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const [state, setState] = useState(emptyCatalogLocationState);
  const [ready, setReady] = useState(!accountId);
  const current = useRef(state);
  const manualRevision = useRef(0);
  const writeQueue = useRef(Promise.resolve());

  const persist = useCallback((next: CatalogLocationState) => {
    if (!accountId) return;
    writeQueue.current = writeQueue.current.catch(() => undefined)
      .then(() => AsyncStorage.setItem(storageKey(accountId), serializeCatalogLocationState(next)))
      .catch(() => undefined);
  }, [accountId]);

  const update = useCallback((next: CatalogLocationState) => {
    current.current = next;
    setState(next);
    persist(next);
  }, [persist]);

  const select = useCallback((scope: CatalogScope, location: CatalogLocation) => {
    manualRevision.current++;
    update(selectCatalogLocation(current.current, scope, location));
  }, [update]);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    void AsyncStorage.getItem(storageKey(accountId))
      .then((raw) => { if (!cancelled) { const restored = parseCatalogLocationState(raw); current.current = restored; setState(restored); } })
      .catch(() => undefined)
      .finally(() => { if (!cancelled) setReady(true); });
    return () => { cancelled = true; };
  }, [accountId]);

  useEffect(() => {
    if (!accountId || !ready) return;
    let cancelled = false;
    const revision = manualRevision.current;
    void (async () => {
      // A current foreground grant is required. Never prompt or use an old fix to infer travel.
      const position = await resolveForegroundLocation(-1);
      if (!position || cancelled) return;
      const response = await apiFetch(`${apiUrl}/locations/cities`, {
        headers: { 'x-volna-suppress-error-report': '1' },
      });
      if (!response.ok || cancelled) return;
      const cities = await response.json() as DetectableCity[];
      const city = nearestSelectableCity(position, cities);
      if (!city || cancelled || revision !== manualRevision.current) return;
      const detected = { cityId: city.id, cityName: city.name, countryCode: city.countryCode, countryName: city.country.name };
      const next = applyDetectedCatalogCity(current.current, detected);
      if (next.detectedCityId !== current.current.detectedCityId || next.choices !== current.current.choices) update(next);
    })().catch(() => undefined);
    return () => { cancelled = true; };
  }, [accountId, ready, update]);

  if (!ready) return fallback;
  return <Context.Provider value={{ state, select }}>{children}</Context.Provider>;
}

export function useCatalogLocation(scope: CatalogScope = 'nearby') {
  const context = useContext(Context);
  if (!context) throw new Error('CatalogLocationProvider is required');
  const { state, select } = context;
  const selectLocation = useCallback((location: CatalogLocation) => select(scope, location), [select, scope]);
  // null means no explicit choice yet; empty strings mean “all places”.
  return [state.choices[scope], selectLocation] as const;
}
