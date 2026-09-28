export type CatalogLocation = { cityId: string; cityName: string; countryCode: string; countryName: string };
export type CatalogScope = 'nearby' | 'communities';
export type CatalogChoices = Record<CatalogScope, CatalogLocation | null>;
export type CatalogLocationState = { choices: CatalogChoices; detectedCityId: string | null };

export const emptyCatalogLocationState = (): CatalogLocationState => ({
  choices: { nearby: null, communities: null },
  detectedCityId: null,
});

function validLocation(value: unknown): value is CatalogLocation {
  if (!value || typeof value !== 'object') return false;
  const location = value as Record<string, unknown>;
  return ['cityId', 'cityName', 'countryCode', 'countryName']
    .every((field) => typeof location[field] === 'string' && location[field].length <= 160);
}

export function parseCatalogLocationState(raw: string | null): CatalogLocationState {
  if (!raw) return emptyCatalogLocationState();
  try {
    const value = JSON.parse(raw) as Partial<CatalogLocationState> & { version?: number };
    if (value.version !== 1 || !value.choices || typeof value.choices !== 'object') return emptyCatalogLocationState();
    const nearby = value.choices.nearby;
    const communities = value.choices.communities;
    if (!(nearby === null || validLocation(nearby)) || !(communities === null || validLocation(communities))) {
      return emptyCatalogLocationState();
    }
    return {
      choices: { nearby, communities },
      detectedCityId: typeof value.detectedCityId === 'string' && value.detectedCityId.length <= 160
        ? value.detectedCityId : null,
    };
  } catch {
    return emptyCatalogLocationState();
  }
}

export function serializeCatalogLocationState(state: CatalogLocationState) {
  return JSON.stringify({ version: 1, ...state });
}

export function selectCatalogLocation(state: CatalogLocationState, scope: CatalogScope, location: CatalogLocation): CatalogLocationState {
  const { cityId, cityName, countryCode, countryName } = location;
  return { ...state, choices: { ...state.choices, [scope]: { cityId, cityName, countryCode, countryName } } };
}

/** A fresh city change replaces a city filter; country-only and "all" remain deliberate choices. */
export function applyDetectedCatalogCity(state: CatalogLocationState, city: CatalogLocation): CatalogLocationState {
  if (!city.cityId) return state;
  const previous = state.detectedCityId;
  const currentChoice = state.choices.nearby;
  const shouldSelect = currentChoice === null || (Boolean(currentChoice.cityId) && Boolean(previous) && previous !== city.cityId);
  return {
    detectedCityId: city.cityId,
    choices: shouldSelect ? { ...state.choices, nearby: city } : state.choices,
  };
}
