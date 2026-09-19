import { Search, X } from 'lucide-react-native';
import { Platform, Pressable, StyleSheet, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';

type SearchFieldProps = Omit<TextInputProps, 'style' | 'multiline'> & {
  style?: StyleProp<ViewStyle>;
  onClear?: () => void;
};

/** Shared page-level search. Picker searches retain their outlined sheet style. */
export function SearchField({ style, onClear, ...inputProps }: SearchFieldProps) {
  return <View style={[searchFieldStyles.field, style]}>
    <Search color="#8e99a4" size={19} strokeWidth={1.9} />
    <TextInput
      autoCapitalize="none"
      autoCorrect={false}
      accessibilityLabel={inputProps.placeholder ?? 'Поиск'}
      {...inputProps}
      multiline={false}
      placeholderTextColor="#8e99a4"
      style={searchFieldStyles.input}
    />
    {onClear && inputProps.value ? <Pressable accessibilityRole="button" accessibilityLabel="Очистить поиск" onPress={onClear} style={searchFieldStyles.clear}>
      <X color="#8e99a4" size={17} />
    </Pressable> : null}
  </View>;
}

export const searchFieldStyles = StyleSheet.create({
  toolbar: { paddingHorizontal: 18, paddingTop: 16, paddingBottom: 12, backgroundColor: 'transparent' },
  field: { minHeight: 44, minWidth: 0, borderRadius: 22, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: '#f3f5f7' },
  input: {
    flex: 1, minWidth: 0, minHeight: 42, paddingHorizontal: 0, paddingBottom: 2,
    backgroundColor: 'transparent', color: '#111', fontSize: 16, fontWeight: '400',
    // The capsule owns the field surface; the nested Web input has no second frame.
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : null),
  },
  clear: { width: 44, height: 44, marginRight: -16, alignItems: 'center', justifyContent: 'center' },
});
