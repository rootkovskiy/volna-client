import { topBarStyles } from '@volna/messaging-client/screen-top-bar';
import { Trash2 } from 'lucide-react-native';
import { Pressable } from 'react-native';
import { styles } from '../styles';
import { CatalogInnerHeader } from './CatalogInnerHeader';

export function DownloadedMusicHeader({ onBack, onClear, hasDownloads, clearing = false }: {
  onBack: () => void;
  onClear: () => void;
  hasDownloads: boolean;
  clearing?: boolean;
}) {
  return <CatalogInnerHeader title="Скачанное" backLabel="Назад к категориям музыки" onBack={onBack}
    trailingAction={hasDownloads ? <Pressable
      accessibilityRole="button"
      accessibilityLabel="Удалить все скачанные треки"
      accessibilityState={{ disabled: clearing, busy: clearing }}
      disabled={clearing}
      onPress={onClear}
      style={[topBarStyles.iconButton, clearing && styles.disabledButton]}
    ><Trash2 color="#6f7b86" size={21} strokeWidth={1.8} /></Pressable> : undefined}
  />;
}
