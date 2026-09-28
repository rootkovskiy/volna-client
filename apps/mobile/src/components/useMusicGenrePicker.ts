import { useMemo, useState } from 'react';
import { Alert } from 'react-native';
import { buildMusicGenreValue, musicGenreSearchText, musicSubgenreDisplayName, musicTaxonomy } from '../domain';
import type { SelectionPickerOption } from './SelectionPickerModal';
import { normalizeSearchText } from '../utils/searchNormalization';

/** Shared taxonomy navigation for standalone music fields and Interests → Music. */
export function useMusicGenrePicker({ selected, onChange, genreSearch, maxSelected, subgenresOnly = false, title = 'Музыкальные предпочтения' }: {
  selected: string[]; onChange: (genres: string[]) => void; genreSearch: string; maxSelected: number; subgenresOnly?: boolean; title?: string;
}) {
  const [categoryIndex, setCategoryIndex] = useState<number | null>(null);
  const [genreIndex, setGenreIndex] = useState<number | null>(null);
  const activeCategory = musicTaxonomy[categoryIndex ?? 0] ?? musicTaxonomy[0];
  const activeGenre = activeCategory.genres[genreIndex ?? 0] ?? activeCategory.genres[0];
  const normalizedGenreSearch = normalizeSearchText(genreSearch.trim()).replace(/[\s\-_/]+/g, '');
  const genreSearchResults = useMemo(() => {
    if (!normalizedGenreSearch) return [];

    return musicTaxonomy.flatMap((category) => category.genres.flatMap((genre) => {
      const context = `${genre.name} · ${category.category}`;
      const options: Array<{ context: string; title: string; value: string }> = genre.subgenres.map((subgenre) => ({
        context,
        title: musicSubgenreDisplayName(buildMusicGenreValue(category.category, genre.name, subgenre)),
        value: buildMusicGenreValue(category.category, genre.name, subgenre),
      }));

      if (!subgenresOnly) {
        options.unshift({
          context: category.category,
          title: genre.name,
          value: buildMusicGenreValue(category.category, genre.name),
        });
      }

      return options.filter((option) => normalizeSearchText(`${musicGenreSearchText(option.value)} ${option.title} ${option.context}`)
        .replace(/[\s\-_/]+/g, '').includes(normalizedGenreSearch));
    }));
  }, [normalizedGenreSearch, subgenresOnly]);

  const toggleGenre = (value: string) => {
    if (selected.includes(value)) {
      onChange(selected.filter((genre) => genre !== value));
      return;
    }

    if (selected.length >= maxSelected) {
      Alert.alert(title, `Можно выбрать до ${maxSelected} жанров.`);
      return;
    }

    onChange([...selected, value]);
  };

  const chooseCategory = (index: number) => {
    setCategoryIndex(index);
    setGenreIndex(null);
  };
  const pickerOptions: SelectionPickerOption[] = normalizedGenreSearch
    ? genreSearchResults.map((option) => ({
        key: option.value,
        title: option.title,
        meta: option.context,
        selected: selected.includes(option.value),
        onPress: () => toggleGenre(option.value),
      }))
    : categoryIndex === null
      ? musicTaxonomy.map((item, index) => ({
          key: item.category,
          title: item.category,
          meta: `${item.genres.length} жанров`,
          navigates: true,
          onPress: () => chooseCategory(index),
        }))
      : genreIndex === null
        ? activeCategory.genres.map((genre, index) => ({
            key: genre.name,
            title: genre.name,
            meta: `${genre.subgenres.length} поджанров`,
            navigates: true,
            onPress: () => setGenreIndex(index),
          }))
        : [
            ...(!subgenresOnly ? [{
              key: buildMusicGenreValue(activeCategory.category, activeGenre.name),
              title: `Весь ${activeGenre.name}`,
              selected: selected.includes(buildMusicGenreValue(activeCategory.category, activeGenre.name)),
              onPress: () => toggleGenre(buildMusicGenreValue(activeCategory.category, activeGenre.name)),
            }] : []),
            ...activeGenre.subgenres.map((subgenre) => {
              const value = buildMusicGenreValue(activeCategory.category, activeGenre.name, subgenre);
              return {
                key: value,
                title: musicSubgenreDisplayName(value),
                selected: selected.includes(value),
                onPress: () => toggleGenre(value),
              };
            }),
          ];
  const pickerBackLabel = !normalizedGenreSearch && categoryIndex !== null
    ? genreIndex !== null ? activeGenre.name : activeCategory.category
    : undefined;

  return {
    pickerOptions, pickerBackLabel, toggleGenre,
    isAtRoot: categoryIndex === null,
    onBack: () => genreIndex !== null ? setGenreIndex(null) : setCategoryIndex(null),
    reset: () => { setCategoryIndex(null); setGenreIndex(null); },
  };
}
