import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LoadingIndicator } from '@volna/messaging-client/loading';
import { styles } from '../styles';

export function CatalogPaginationFooter({ loading, refreshing = false, error, hasMore, onContinue }: {
  loading: boolean; refreshing?: boolean; error: string; hasMore: boolean; onContinue: () => void;
}) {
  return <View style={catalogPaginationStyles.footer}>
    {loading ? (refreshing ? null : <LoadingIndicator />) : error ? <>
      <Text accessibilityRole="alert" style={catalogPaginationStyles.hint}>{error}</Text>
      <Pressable accessibilityRole="button" onPress={onContinue} style={styles.connectFilterButton}><Text style={styles.connectFilterButtonText}>Повторить</Text></Pressable>
    </> : hasMore ? <Pressable accessibilityRole="button" onPress={onContinue} style={styles.connectFilterButton}><Text style={styles.connectFilterButtonText}>Показать ещё</Text></Pressable> : null}
  </View>;
}

export const catalogPaginationStyles = StyleSheet.create({
  contentWithPlayer: { paddingBottom: 110 },
  footer: { paddingTop: 16, gap: 12, minHeight: 60, justifyContent: 'center' },
  hint: { color: '#6f7b86', fontSize: 14, lineHeight: 20 },
});
