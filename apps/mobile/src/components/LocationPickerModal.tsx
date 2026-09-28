import { LoadingIndicator } from '@volna/messaging-client/loading';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing } from 'react-native';
import { LocateFixed, MapPin, RotateCcw } from 'lucide-react-native';
import { apiFetch as fetch, apiUrl, remoteSearchDebounceMs, reportApiError } from '../api/client';
import { SelectionPickerModal, type SelectionPickerOption } from './SelectionPickerModal';
import { detectCurrentCity } from '../location/detectCity';
import { normalizeSearchText, searchIncludes } from '../utils/searchNormalization';

export type LocationSelection = {
  cityId: string;
  cityName: string;
  countryCode: string;
  countryName: string;
  kind: 'none' | 'country' | 'city';
};

type CountryOption = { code: string; name: string };
type CityOption = { id: string; name: string; countryCode: string; country: { name: string } };

export function LocationPickerModal({
  initialCountryName,
  isVisible,
  onClose,
  onSelect,
}: {
  initialCountryName?: string;
  isVisible: boolean;
  onClose: () => void;
  onSelect: (location: LocationSelection) => void;
}) {
  const [countries, setCountries] = useState<CountryOption[]>([]);
  const [cities, setCities] = useState<CityOption[]>([]);
  const [country, setCountry] = useState<CountryOption | null>(null);
  const [query, setQuery] = useState('');
  const [countriesLoading, setCountriesLoading] = useState(false);
  const [citiesLoading, setCitiesLoading] = useState(false);
  const isLoading = country ? citiesLoading : countriesLoading;
  const [isDetecting, setIsDetecting] = useState(false);
  const [detectionError, setDetectionError] = useState('');
  const detection = useRef<AbortController | null>(null);
  const visible = useRef(isVisible);
  visible.current = isVisible;
  const levelGeneration = useRef(0);
  const levelOpacity = useRef(new Animated.Value(1)).current;
  const levelOffset = useRef(new Animated.Value(0)).current;

  const cancelDetection = () => {
    detection.current?.abort();
    detection.current = null;
    setIsDetecting(false);
  };
  const close = () => {
    levelGeneration.current++;
    cancelDetection();
    onClose();
  };

  const changeLevel = (nextCountry: CountryOption | null, direction: 1 | -1) => {
    cancelDetection();
    const generation = ++levelGeneration.current;
    Animated.parallel([
      Animated.timing(levelOpacity, { toValue: 0, duration: 90, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(levelOffset, { toValue: -direction * 10, duration: 90, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]).start(({ finished }) => {
      if (!finished || !visible.current || generation !== levelGeneration.current) return;
      setCountry(nextCountry);
      setQuery('');
      levelOffset.setValue(direction * 22);
      Animated.parallel([
        Animated.timing(levelOpacity, { toValue: 1, duration: 190, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(levelOffset, { toValue: 0, duration: 190, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]).start();
    });
  };

  useEffect(() => {
    if (!isVisible) return;
    setDetectionError('');
    setIsDetecting(false);
    const controller = new AbortController();
    levelOpacity.setValue(1);
    levelOffset.setValue(0);
    setCountry(null);
    setQuery('');
    setCountriesLoading(true);
    fetch(`${apiUrl}/locations/countries`, { signal: controller.signal, headers: { 'x-volna-suppress-error-report': '1' } })
      .then(async (response) => {
        if (!response.ok) throw new Error('Не удалось загрузить страны');
        const result = await response.json() as CountryOption[];
        if (!controller.signal.aborted) setCountries(result);
      })
      .catch((reason) => { if (!controller.signal.aborted) reportApiError(reason instanceof Error ? reason.message : 'Не удалось загрузить страны'); })
      .finally(() => { if (!controller.signal.aborted) setCountriesLoading(false); });
    return () => {
      controller.abort();
      detection.current?.abort();
      detection.current = null;
      levelGeneration.current++;
      levelOpacity.stopAnimation();
      levelOffset.stopAnimation();
    };
  }, [isVisible]);

  useEffect(() => {
    if (!isVisible || !country) {
      setCities([]);
      return;
    }
    const controller = new AbortController();
    setCitiesLoading(true);
    setCities([]);
    const timer = setTimeout(() => {
      setCitiesLoading(true);
      fetch(`${apiUrl}/locations/cities?countryCode=${country.code}&q=${encodeURIComponent(query.trim())}`, { signal: controller.signal, headers: { 'x-volna-suppress-error-report': '1' } })
        .then(async (response) => {
          if (!response.ok) throw new Error('Не удалось загрузить города');
          const result = await response.json() as CityOption[];
          if (!controller.signal.aborted) setCities(result);
        })
        .catch((reason) => {
          if (!controller.signal.aborted) reportApiError(reason instanceof Error ? reason.message : 'Не удалось загрузить города');
        })
        .finally(() => {
          if (!controller.signal.aborted) setCitiesLoading(false);
        });
    }, query ? remoteSearchDebounceMs : 0);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [country, isVisible, query]);

  const filteredCountries = useMemo(() => {
    const normalized = normalizeSearchText(query.trim());
    return normalized
      ? countries.filter((item) => searchIncludes(item.name, normalized))
      : countries;
  }, [countries, query]);

  const choose = (selection: LocationSelection) => {
    cancelDetection();
    onSelect(selection);
    close();
  };

  const detect = async () => {
    if (detection.current || !visible.current) return;
    const controller = new AbortController();
    detection.current = controller;
    setIsDetecting(true);
    setDetectionError('');
    try {
      const city = await detectCurrentCity(controller.signal);
      if (controller.signal.aborted || detection.current !== controller || !visible.current) return;
      choose({ kind: 'city', cityId: city.id, cityName: city.name, countryCode: city.countryCode, countryName: city.country.name });
    } catch (error) {
      if (!controller.signal.aborted && detection.current === controller && visible.current) {
        setDetectionError(error instanceof Error ? error.message : 'Не удалось определить город. Выберите его вручную');
      }
    } finally {
      controller.abort();
      if (detection.current === controller) { detection.current = null; setIsDetecting(false); }
    }
  };

  const options: SelectionPickerOption[] = country
    ? [
        {
          key: `country:${country.code}`,
          title: country.name,
          meta: 'Указать только страну',
          onPress: () => choose({
            kind: 'country',
            cityId: '',
            cityName: '',
            countryCode: country.code,
            countryName: country.name,
          }),
        },
        ...cities.map((city) => ({
          key: city.id,
          title: city.name,
          meta: city.country.name,
          leading: <MapPin color="#6f7b86" size={20} strokeWidth={1.8} />,
          onPress: () => choose({
            kind: 'city' as const,
            cityId: city.id,
            cityName: city.name,
            countryCode: city.countryCode,
            countryName: city.country.name,
          }),
        })),
      ]
    : [
        {
          key: 'none',
          title: 'Не выбрано',
          muted: true,
          leading: <RotateCcw color="#6f7b86" size={20} strokeWidth={1.8} />,
          onPress: () => choose({ kind: 'none', cityId: '', cityName: '', countryCode: '', countryName: '' }),
        },
        ...filteredCountries.map((item) => ({
          key: item.code,
          title: item.name,
          navigates: true,
          onPress: () => changeLevel(item, 1),
        })),
      ];

  return (
    <SelectionPickerModal
      backLabel={country ? 'Все страны' : undefined}
      bodyStyle={{ opacity: levelOpacity, transform: [{ translateX: levelOffset }] }}
      emptyText={country ? 'Город не найден' : 'Страна не найдена'}
      isLoading={isLoading}
      isVisible={isVisible}
      onBack={country ? () => changeLevel(null, -1) : undefined}
      onChangeSearch={(value) => { cancelDetection(); setQuery(value); }}
      onClose={close}
      options={options}
      topOptions={[{
        key: 'detect-city',
        title: isDetecting ? 'Определяем город…' : 'Определить город',
        meta: detectionError || 'Ближайший доступный город по геолокации',
        metaLines: 3,
        disabled: isDetecting,
        leading: isDetecting ? <LoadingIndicator size="small" /> : <LocateFixed color="#111" size={20} strokeWidth={1.8} />,
        onPress: () => { void detect(); },
      }]}
      search={query}
      searchPlaceholder={country ? 'Найти город' : 'Найти страну'}
      subtitle={country ? country.name : initialCountryName ? `Сейчас: ${initialCountryName}` : 'Можно выбрать страну или конкретный город'}
      title={country ? 'Выберите город' : 'Местоположение'}
    />
  );
}
