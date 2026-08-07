import type { ReactNode } from 'react';
import { ActivityIndicator, Animated, Pressable, Text, TextInput, View, type ViewProps } from 'react-native';
import { Check, ChevronLeft, ChevronRight, Search } from 'lucide-react-native';
import { styles } from '../styles';
import { AppSheetModal } from './AppSheetModal';

export type SelectionPickerOption = {
  key: string;
  title: string;
  meta?: string;
  leading?: ReactNode;
  muted?: boolean;
  selected?: boolean;
  navigates?: boolean;
  onPress: () => void;
};

export function SelectionPickerModal({
  backLabel,
  bodyStyle,
  embedded = false,
  emptyText = 'Ничего не найдено',
  isLoading = false,
  isVisible,
  onBack,
  onChangeSearch,
  onClose,
  options,
  search,
  searchPlaceholder,
  subtitle,
  title,
}: {
  backLabel?: string;
  bodyStyle?: Animated.AnimatedProps<ViewProps>['style'];
  embedded?: boolean;
  emptyText?: string;
  isLoading?: boolean;
  isVisible: boolean;
  onBack?: () => void;
  onChangeSearch?: (value: string) => void;
  onClose: () => void;
  options: SelectionPickerOption[];
  search?: string;
  searchPlaceholder?: string;
  subtitle?: string;
  title: string;
}) {
  return (
    <AppSheetModal embedded={embedded} isVisible={isVisible} onClose={onClose} scroll subtitle={subtitle} title={title}>
      <Animated.View style={bodyStyle}>
        {searchPlaceholder !== undefined && onChangeSearch ? (
          <View style={styles.appSheetSearch}>
            <Search color="#98a3ae" size={19} strokeWidth={1.9} />
            <TextInput
              autoCapitalize="sentences"
              autoCorrect={false}
              onChangeText={onChangeSearch}
              placeholder={searchPlaceholder}
              placeholderTextColor="#98a3ae"
              style={styles.appSheetSearchInput}
              value={search ?? ''}
            />
          </View>
        ) : null}

        {backLabel && onBack ? (
          <Pressable accessibilityLabel={backLabel} accessibilityRole="button" onPress={onBack} style={styles.selectionPickerBack}>
            <ChevronLeft color="#111" size={18} strokeWidth={2} />
            <Text style={styles.selectionPickerBackText}>{backLabel}</Text>
          </Pressable>
        ) : null}

        {isLoading ? <ActivityIndicator color="#111" style={styles.selectionPickerLoading} /> : null}
        {!isLoading && options.length ? (
          <View accessibilityRole="list" style={styles.selectionPickerList}>
            {options.map((option) => (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: Boolean(option.selected) }}
                key={option.key}
                onPress={option.onPress}
                style={[
                  styles.selectionPickerRow,
                  !option.leading && !option.meta && !option.navigates && styles.selectionPickerRowCompact,
                ]}
              >
                {option.leading}
                <View style={styles.selectionPickerCopy}>
                  <Text style={[styles.selectionPickerTitle, option.muted && styles.selectionPickerTitleMuted]}>{option.title}</Text>
                  {option.meta ? <Text numberOfLines={1} style={styles.selectionPickerMeta}>{option.meta}</Text> : null}
                </View>
                {option.selected ? <Check color="#111" size={20} strokeWidth={2.1} /> : null}
                {!option.selected && option.navigates ? <ChevronRight color="#8e99a4" size={20} strokeWidth={1.8} /> : null}
              </Pressable>
            ))}
          </View>
        ) : null}
        {!isLoading && !options.length ? <Text style={styles.selectionPickerEmpty}>{emptyText}</Text> : null}
      </Animated.View>
    </AppSheetModal>
  );
}

export function CountryPickerModal({
  countries,
  isVisible,
  onChangeSearch,
  onClose,
  onSelect,
  search,
}: {
  countries: string[];
  isVisible: boolean;
  onChangeSearch: (value: string) => void;
  onClose: () => void;
  onSelect: (country: string) => void;
  search: string;
}) {
  const options: SelectionPickerOption[] = [
    { key: 'none', title: 'Не указывать', muted: true, onPress: () => onSelect('') },
    ...countries.map((country) => ({ key: country, title: country, onPress: () => onSelect(country) })),
  ];

  return (
    <SelectionPickerModal
      isVisible={isVisible}
      onChangeSearch={onChangeSearch}
      onClose={onClose}
      options={options}
      search={search}
      searchPlaceholder="Начните вводить страну"
      title="Страна"
    />
  );
}
