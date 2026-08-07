import { Text } from 'react-native';
import { styles } from '../styles';

export type EditorAutosaveState = 'saved' | 'saving' | 'pending' | 'error';

const autosaveLabels: Record<EditorAutosaveState, string> = {
  error: 'Ошибка сохранения',
  pending: 'Не сохранено',
  saved: 'Сохранено',
  saving: 'Сохраняется…',
};

export function EditorAutosaveStatus({ status }: { status: EditorAutosaveState }) {
  return (
    <Text
      accessibilityLiveRegion="polite"
      style={[styles.editProfileAutoSaveStatus, status === 'error' && styles.editProfileAutoSaveStatusError]}
    >
      {autosaveLabels[status]}
    </Text>
  );
}
