import { MessagingShareTargets } from '@volna/messaging-client/react-native-messages';
import type { MessagingAttachment } from '@volna/messaging-client/messaging-surface-controller';
import { FilePlus2 } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { messagingSurfaceController } from '../messaging/secureMessaging';
import { AppSheetModal } from './AppSheetModal';
import type { GlobalTrackQueueItem } from './GlobalAudioPlayer';

function trackAttachment(track: GlobalTrackQueueItem): MessagingAttachment {
  const provider = track.provider ?? 'volna';
  const externalUrl = track.sourceTrackUrl || track.externalUrl || undefined;
  return {
    kind: 'music',
    provider,
    id: track.id.replace(/^(apple|yandex|uploaded):/, ''),
    title: track.title,
    artist: track.artist ?? 'Неизвестный исполнитель',
    metadata: {
      ...(track.artworkUrl ? { artworkUrl: track.artworkUrl } : {}),
      ...(track.previewUrl ? { previewUrl: track.previewUrl } : {}),
      ...(externalUrl ? { externalUrl } : {}),
      ...(track.collectionTitle ? { collectionTitle: track.collectionTitle } : {}),
      ...(track.genres?.length ? { genres: track.genres } : {}),
    },
  };
}

export function ReleaseShareModal({ isVisible, onAddToPost, onClose, onNotify, track }: {
  isVisible: boolean;
  onAddToPost: (track: GlobalTrackQueueItem) => void;
  onClose: () => void;
  onNotify: (message: string, type?: 'success' | 'error') => void;
  track: GlobalTrackQueueItem | null;
}) {
  return <AppSheetModal isVisible={isVisible} onClose={onClose} title="Поделиться">
    <Pressable accessibilityRole="button" disabled={!track} onPress={() => track && onAddToPost(track)} style={localStyles.postAction}>
      <View style={localStyles.postActionIcon}><FilePlus2 color="#111" size={23} strokeWidth={1.9} /></View>
      <View style={localStyles.actionCopy}><Text style={localStyles.actionTitle}>Добавить в пост</Text><Text style={localStyles.actionHint}>Открыть редактор публикации с треком</Text></View>
    </Pressable>
    {track ? <MessagingShareTargets
      controller={messagingSurfaceController}
      draft={{ attachment: trackAttachment(track) }}
      enabled={isVisible}
      onError={(message) => onNotify(message, 'error')}
      onSent={(username) => { onClose(); onNotify(`Трек отправлен @${username}`, 'success'); }}
    /> : null}
  </AppSheetModal>;
}

const localStyles = StyleSheet.create({
  postAction: { minHeight: 64, borderRadius: 14, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff' },
  postActionIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f3f5f7' },
  actionCopy: { flex: 1 },
  actionTitle: { color: '#111', fontSize: 15, lineHeight: 20, fontWeight: '600' },
  actionHint: { marginTop: 2, color: '#6f7b86', fontSize: 12, lineHeight: 16 },
});
