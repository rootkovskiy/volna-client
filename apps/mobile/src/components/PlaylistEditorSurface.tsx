import type { ReactNode } from 'react';
import { LoadingIndicator } from '@volna/messaging-client/loading';
import { Trash2 } from 'lucide-react-native';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useWebVisualViewport } from '../hooks/useWebVisualViewport';
import { styles } from '../styles';
import { PlaylistArtwork } from './PlaylistGrid';
import { ScreenTopBar } from './ScreenTopBar';

/** Shared editor presentation; transport, playback and the draft stay in the caller. */
export function PlaylistEditorSurface({ name, artworkUrl, hasCustomArtwork, tracks, saving = false, error, footer, bottomInset = 0, onCancel, onSave, onChangeName, onChooseArtwork, onRemoveArtwork, onRemoveTrack, onDelete }: {
  name: string; artworkUrl: string | null; hasCustomArtwork: boolean;
  tracks: readonly { key: string; title: string; player: ReactNode }[];
  saving?: boolean; error?: string | null; footer?: ReactNode; bottomInset?: number;
  onCancel: () => void; onSave: () => void; onChangeName: (name: string) => void;
  onChooseArtwork: () => void; onRemoveArtwork: () => void; onRemoveTrack: (key: string) => void; onDelete?: () => void;
}) {
  const viewport = useWebVisualViewport();
  const footerPadding = viewport.keyboardVisible ? 8 : Math.max(bottomInset, 10);
  return <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={editorStyles.screen}>
    <ScreenTopBar title="Плейлист" backLabel="Отмена" onBack={onCancel} trailingAction={
      <Pressable accessibilityRole="button" accessibilityLabel="Сохранить плейлист" disabled={saving || !name.trim()} onPress={onSave} style={[styles.telegramFeedPrimaryButton, (saving || !name.trim()) && styles.disabledButton]}>
        {saving ? <LoadingIndicator tone="inverse" size="small" /> : <Text style={styles.eventFilterApplyText}>Сохранить</Text>}
      </Pressable>
    } />
    <ScrollView style={editorStyles.scroll} contentContainerStyle={[editorStyles.content, { paddingBottom: footer && Platform.OS === 'web' ? 100 + viewport.bottomInset + footerPadding : 24 + bottomInset }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      {error ? <Text accessibilityRole="alert" style={styles.settingsError}>{error}</Text> : null}
      <View style={editorStyles.identity}>
        <View>
          <Pressable accessibilityRole="button" accessibilityLabel={hasCustomArtwork ? 'Заменить обложку плейлиста' : 'Добавить обложку плейлиста'} disabled={saving} onPress={onChooseArtwork}>
            <PlaylistArtwork playlist={{ artworkUrl }} style={editorStyles.artwork} />
          </Pressable>
          {hasCustomArtwork ? <Pressable accessibilityRole="button" accessibilityLabel="Удалить обложку плейлиста" disabled={saving} onPress={onRemoveArtwork} style={editorStyles.removeArtwork}><Trash2 color="#b3261e" size={19} /></Pressable> : null}
        </View>
        <View style={editorStyles.name}>
          <Text style={editorStyles.label}>Название плейлиста</Text>
          <TextInput accessibilityLabel="Название плейлиста" editable={!saving} maxLength={60} onChangeText={onChangeName} placeholder="Название" placeholderTextColor="#98a3ae" style={[styles.editInput, editorStyles.nameInput]} value={name} />
        </View>
      </View>
      <Text style={styles.editSectionTitle}>Треки</Text>
      {tracks.map(track => <View key={track.key} style={editorStyles.trackRow}>
        <View style={editorStyles.player}>{track.player}</View>
        <Pressable accessibilityRole="button" accessibilityLabel={`Убрать ${track.title} из плейлиста`} disabled={saving} onPress={() => onRemoveTrack(track.key)} style={editorStyles.removeTrack}><Trash2 color="#6f7b86" size={20} /></Pressable>
      </View>)}
      {!tracks.length ? <Text style={editorStyles.empty}>В плейлисте пока нет треков</Text> : null}
      {onDelete ? <View style={styles.communityAudioEditorDeleteSection}><Pressable accessibilityRole="button" disabled={saving} onPress={onDelete} style={[styles.communityAudioEditorDelete, editorStyles.deleteAction]}><Text style={styles.communityAudioEditorDeleteText}>Удалить плейлист</Text></Pressable></View> : null}
    </ScrollView>
    {footer ? <View style={[editorStyles.footer, { paddingBottom: footerPadding }, Platform.OS === 'web' && { position: 'absolute', left: 0, right: 0, bottom: viewport.keyboardVisible ? viewport.bottomInset : 0 }]}>{footer}</View> : null}
  </KeyboardAvoidingView>;
}

const editorStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f3f5f7' },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 18, paddingTop: 20, gap: 8 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  artwork: { width: 80, height: 80 },
  name: { flex: 1, minWidth: 0, gap: 6 },
  label: { color: '#6f7b86', fontSize: 12, lineHeight: 17 },
  nameInput: { borderWidth: 0 },
  removeArtwork: { position: 'absolute', right: -8, top: -8, width: 44, height: 44, borderRadius: 22, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  trackRow: { flexDirection: 'row', alignItems: 'center', borderRadius: 8, backgroundColor: '#fff', paddingLeft: 8 },
  player: { flex: 1, minWidth: 0 },
  removeTrack: { width: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  empty: { color: '#6f7b86', fontSize: 14, lineHeight: 20, textAlign: 'center', paddingVertical: 24 },
  deleteAction: { minHeight: 44 },
  footer: { flexShrink: 0, backgroundColor: '#f3f5f7' },
});
