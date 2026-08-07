import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing } from 'react-native';
import { MapPin, RotateCcw } from 'lucide-react-native';
import { apiUrl, remoteSearchDebounceMs, reportApiError } from '../api/client';
import { SelectionPickerModal, type SelectionPickerOption } from './SelectionPickerModal';

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
  const [isLoading, setIsLoading] = useState(false);
  const levelOpacity = useRef(new Animated.Value(1)).current;
  const levelOffset = useRef(new Animated.Value(0)).current;

  const changeLevel = (nextCountry: CountryOption | null, direction: 1 | -1) => {
    Animated.parallel([
      Animated.timing(levelOpacity, { toValue: 0, duration: 90, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(levelOffset, { toValue: -direction * 10, duration: 90, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]).start(() => {
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
    levelOpacity.setValue(1);
    levelOffset.setValue(0);
    setCountry(null);
    setQuery('');
    setIsLoading(true);
    fetch(`${apiUrl}/locations/countries`)
      .then(async (response) => {
        if (!response.ok) throw new Error('Не удалось загрузить страны');
        setCountries(await response.json() as CountryOption[]);
      })
      .catch((reason) => reportApiError(reason instanceof Error ? reason.message : 'Не удалось загрузить страны'))
      .finally(() => setIsLoading(false));
  }, [isVisible]);

  useEffect(() => {
    if (!isVisible || !country) {
      setCities([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setIsLoading(true);
      fetch(`${apiUrl}/locations/cities?countryCode=${country.code}&q=${encodeURIComponent(query.trim())}`, { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error('Не удалось загрузить города');
          setCities(await response.json() as CityOption[]);
        })
        .catch((reason) => {
          if (!controller.signal.aborted) reportApiError(reason instanceof Error ? reason.message : 'Не удалось загрузить города');
        })
        .finally(() => {
          if (!controller.signal.aborted) setIsLoading(false);
        });
    }, query ? remoteSearchDebounceMs : 0);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [country, isVisible, query]);

  const filteredCountries = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('ru');
    return normalized
      ? countries.filter((item) => item.name.toLocaleLowerCase('ru').includes(normalized))
      : countries;
  }, [countries, query]);

  const choose = (selection: LocationSelection) => {
    onSelect(selection);
    onClose();
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
      onChangeSearch={setQuery}
      onClose={onClose}
      options={options}
      search={query}
      searchPlaceholder={country ? 'Найти город' : 'Найти страну'}
      subtitle={country ? country.name : initialCountryName ? `Сейчас: ${initialCountryName}` : 'Можно выбрать страну или конкретный город'}
      title={country ? 'Выберите город' : 'Местоположение'}
    />
  );
}
