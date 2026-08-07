import { SearchX } from 'lucide-react-native';
import { Text, View } from 'react-native';
import { ScreenTopBar } from '../components/navigation';
import { styles } from '../styles';

export function EntityNotFoundScreen({ onBack }: { onBack: () => void }) {
  return (
    <>
      <ScreenTopBar canGoBack onBack={onBack} title="Не найдено" />
      <View style={styles.entityNotFoundScreen}>
        <SearchX color="#6f7b86" size={34} strokeWidth={1.8} />
        <Text style={styles.emptyProfileTabTitle}>Профиль или сообщество не найдено</Text>
        <Text style={styles.emptyProfileTabText}>Возможно, username изменили или страница была удалена.</Text>
      </View>
    </>
  );
}
