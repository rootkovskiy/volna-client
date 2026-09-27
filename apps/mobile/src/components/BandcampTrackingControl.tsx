import { Check } from 'lucide-react-native';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { styles } from '../styles';

export const bandcampTrackingLabel = 'Отслеживать Bandcamp на новые релизы и автоматически добавлять';

/** Presentation only: profile autosave and the fictional UI Kit own their values. */
export function BandcampTrackingControl({ checked, disabled = false, onChange }: {
  checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void;
}) {
  return <View style={control.container}>
    <Pressable accessibilityRole="checkbox" accessibilityLabel={bandcampTrackingLabel}
      accessibilityState={{ checked, disabled }} aria-checked={checked} disabled={disabled}
      {...(Platform.OS === 'web' ? { onKeyDown: (event: { key: string; repeat: boolean; preventDefault: () => void }) => {
        if (event.key !== ' ' && event.key !== 'Spacebar') return;
        event.preventDefault();
        if (!disabled && !event.repeat) onChange(!checked);
      } } : {})}
      onPress={() => onChange(!checked)} style={[control.row, disabled && styles.disabledButton]}>
      <View style={[styles.authRulesCheckbox, checked && styles.authRulesCheckboxChecked]}>
        {checked ? <Check color="#fff" size={16} /> : null}
      </View>
      <Text style={styles.authRulesText}>{bandcampTrackingLabel}</Text>
    </Pressable>
    <Text style={styles.settingsHint}>{disabled
      ? 'Для изменения нужны права на редактирование профиля и управление музыкой.'
      : 'Проверка раз в сутки. Первый запуск запоминает текущий каталог; затем добавляются новые релизы.'}</Text>
  </View>;
}

const control = StyleSheet.create({
  container: { paddingHorizontal: 18, paddingBottom: 8, gap: 4 },
  row: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 12 },
});
