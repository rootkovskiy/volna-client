import { Pressable, Text, View } from 'react-native';
import { styles } from '../styles';

/** Equal-width peer tabs shared by the Event and Music catalogs. */
export function CatalogTabs<T extends string>({ tabs, value, onChange }: {
  tabs: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return <View accessibilityRole="tablist" style={styles.eventCatalogTabs}>
    {tabs.map((tab) => <Pressable accessibilityRole="tab" accessibilityState={{ selected: value === tab.value }} aria-selected={value === tab.value}
      key={tab.value} onPress={() => onChange(tab.value)} style={styles.eventCatalogTab}>
      <Text style={[styles.eventCatalogTabText, value === tab.value && styles.eventCatalogTabTextActive]}>{tab.label}</Text>
      {value === tab.value ? <View pointerEvents="none" style={styles.activeTabIndicator} /> : null}
    </Pressable>)}
  </View>;
}
