import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { ChevronLeft } from 'lucide-react-native';
import { styles } from '../styles';

export function CatalogInnerHeader({
  backLabel,
  onBack,
  title,
  trailingAction,
}: {
  backLabel: string;
  onBack: () => void;
  title: string;
  trailingAction?: ReactNode;
}) {
  return (
    <View style={styles.eventCategoryOpenHeader}>
      <Pressable accessibilityLabel={backLabel} accessibilityRole="button" onPress={onBack} style={styles.eventCategoryBackButton}>
        <ChevronLeft color="#111" size={24} strokeWidth={1.8} />
      </Pressable>
      <Text numberOfLines={1} style={styles.eventCategoryOpenTitle}>{title}</Text>
      <View style={styles.eventCategoryHeaderTrailing}>{trailingAction}</View>
    </View>
  );
}
