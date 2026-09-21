import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

export type CatalogLocation = { cityId: string; cityName: string; countryCode: string; countryName: string };
type CatalogScope = 'nearby' | 'communities';
type Choices = Record<CatalogScope, CatalogLocation | null>;
const Context = createContext<{
  choices: Choices;
  select: (scope: CatalogScope, location: CatalogLocation) => void;
} | null>(null);

/** Account-session choices, outside navigation resets. Never stores GPS or profile data. */
export function CatalogLocationProvider({ children }: { children: ReactNode }) {
  const [choices, setChoices] = useState<Choices>({ nearby: null, communities: null });
  const select = useCallback((scope: CatalogScope, location: CatalogLocation) => {
    // Keep only the geographic filter, even when an event-filter draft is supplied.
    const { cityId, cityName, countryCode, countryName } = location;
    setChoices(current => ({ ...current, [scope]: { cityId, cityName, countryCode, countryName } }));
  }, []);
  return <Context.Provider value={{ choices, select }}>{children}</Context.Provider>;
}

export function useCatalogLocation(scope: CatalogScope = 'nearby') {
  const context = useContext(Context);
  if (!context) throw new Error('CatalogLocationProvider is required');
  const { choices, select } = context;
  const selectLocation = useCallback((location: CatalogLocation) => select(scope, location), [select, scope]);
  // null means no explicit choice yet; an empty object of strings means “all places”.
  return [choices[scope], selectLocation] as const;
}
