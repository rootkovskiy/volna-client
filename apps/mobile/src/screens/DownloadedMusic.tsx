import { LoadingIndicator } from '@volna/messaging-client/loading';
import { CircleAlert, Download, Pause, Play, Trash2, X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AppImage as Image } from '../components/AppImage';
import { AppSheetModal } from '../components/AppSheetModal';
import { DownloadedMusicHeader } from '../components/DownloadedMusicHeader';
import { supportsDeviceDownloads } from '../music/downloadDevice';
import { useGlobalAudioControls } from '../components/GlobalAudioPlayer';
import { ReleaseMetadataRows } from '../components/ReleaseMetadataRows';
import { styles as musicStyles } from '../styles';
import { cancelDeviceDownload, clearDeviceDownloads, deviceDownloadTrack, loadDeviceDownloads, removeDeviceDownload, repairDeviceDownloads, useDeviceDownloads } from '../music/deviceDownloads';

export function DownloadedMusic({ onBack }: { onBack: () => void }) {
  const downloads = useDeviceDownloads();
  const audio = useGlobalAudioControls();
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearError, setClearError] = useState('');
  useEffect(() => {
    if (!supportsDeviceDownloads() || !downloads.ready) return;
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 90_000);
    void repairDeviceDownloads(abort.signal).finally(() => clearTimeout(timeout));
    return () => { clearTimeout(timeout); abort.abort(); };
  }, [downloads.ready]);
  const queue = downloads.items.map(deviceDownloadTrack);
  const isEmpty = downloads.ready && !downloads.error && !downloads.items.length && !downloads.job;
  if (!supportsDeviceDownloads()) return null;
  const closeConfirmation = () => { if (!downloads.clearing) setConfirmClear(false); };
  const clear = async () => {
    if (downloads.clearing) return;
    setClearError('');
    // Release the current media element before removing its file/object URL.
    if (audio.activeTrack?.downloadKey) audio.close();
    try { await clearDeviceDownloads(); setConfirmClear(false); }
    catch (error) { setClearError(error instanceof Error ? error.message : 'Не удалось удалить скачанное. Повторите попытку.'); }
  };
  return <><DownloadedMusicHeader onBack={onBack} hasDownloads={downloads.items.length > 0} clearing={downloads.clearing}
    onClear={() => { setClearError(''); setConfirmClear(true); }} />
  <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
    {!downloads.ready ? <View style={styles.state}><LoadingIndicator /><Text style={styles.stateHint}>Открываем скачанное…</Text></View> : null}
    {downloads.error ? <View style={styles.state}>
      <View style={styles.stateIcon}><CircleAlert color="#6f7b86" size={28} strokeWidth={1.8} /></View>
      <Text style={styles.stateTitle}>Не удалось открыть скачанное</Text>
      <Text style={styles.stateHint}>{downloads.error}</Text>
      <Pressable accessibilityRole="button" onPress={() => void loadDeviceDownloads()} style={styles.retry}><Text style={styles.retryText}>Повторить</Text></Pressable>
    </View> : null}
    {downloads.job ? <View style={styles.row}><View style={styles.artwork}><Download color="#6f7b86" size={24} /></View><View style={styles.copy}><Text numberOfLines={1} style={styles.title}>{downloads.job.track.title}</Text><Text style={styles.hint}>Скачивание · {(downloads.job.progress.received / 1024 / 1024).toFixed(1)} МБ{downloads.job.progress.total ? ` из ${(downloads.job.progress.total / 1024 / 1024).toFixed(1)}` : ''}</Text></View><Pressable accessibilityLabel="Отменить скачивание" accessibilityRole="button" onPress={cancelDeviceDownload} style={styles.action}><X size={22} color="#111" /></Pressable></View> : null}
    {downloads.items.map((item, index) => {
      const track = queue[index]; const playing = audio.activeTrack?.downloadKey === item.key && audio.isPlaying;
      const loading = audio.activeTrack?.downloadKey === item.key && audio.isAudioLoading;
      const date = track.releaseDate ? new Date(track.releaseDate) : null;
      const releaseDateLabel = date && Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).format(date) : null;
      const play = () => { if (playing) audio.pause(); else void audio.play({ ...track, queue, queueIndex: index }).catch((error) => audio.notify(error.message, 'error')); };
      return <View key={item.key} style={styles.row}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Воспроизвести ${track.title}`} disabled={downloads.clearing} onPress={play} style={musicStyles.bandcampReleaseHeaderLink}>
          {track.artworkUrl ? <Image source={{ uri: track.artworkUrl }} style={musicStyles.bandcampReleaseArtwork} /> : <View style={musicStyles.bandcampReleaseArtworkFallback}><Text style={musicStyles.audioArtworkFallbackNote}>♪</Text></View>}
          <View style={musicStyles.bandcampReleaseCopy}><Text numberOfLines={1} style={musicStyles.bandcampReleaseTitle}>{track.title}</Text>
            <ReleaseMetadataRows artist={track.artist} genres={[]} provider={track.provider === 'bandcamp' ? 'Bandcamp' : track.provider === 'soundcloud' ? 'SoundCloud' : 'VOLNA'} releaseDateLabel={releaseDateLabel} showGenres={false} trackCount={1} />
          </View>
        </Pressable>
        <Pressable accessibilityLabel={playing ? `Пауза: ${track.title}` : `Слушать: ${track.title}`} accessibilityRole="button" disabled={downloads.clearing} style={styles.action} onPress={play}><View style={musicStyles.bandcampTrackPlayButton}>{loading ? <LoadingIndicator tone="inverse" size="small" /> : playing ? <Pause color="#fff" fill="#fff" size={13} /> : <Play color="#fff" fill="#fff" size={12} />}</View></Pressable>
        <Pressable accessibilityLabel={`Удалить с устройства: ${track.title}`} accessibilityHint={`${(item.bytes / 1024 / 1024).toFixed(1)} МБ. Трек останется в вашей музыке.`} accessibilityRole="button" disabled={downloads.clearing} style={styles.action} onPress={() => {
          // Stop before revoking a Blob URL/removing the exact playing file.
          if (audio.activeTrack?.downloadKey === item.key) audio.close();
          else if (audio.activeTrack?.queue?.some((entry) => entry.downloadKey === item.key)) audio.setActiveQueue(audio.activeTrack.queue.filter((entry) => entry.downloadKey !== item.key));
          void removeDeviceDownload(item.key).catch(() => audio.notify('Не удалось удалить локальный файл. Попробуйте ещё раз.', 'error'));
        }}><Trash2 size={20} color="#6f7b86" /></Pressable>
      </View>;
    })}
    {isEmpty ? <View style={styles.state}>
      <View style={styles.stateIcon}><Download color="#6f7b86" size={28} strokeWidth={1.8} /></View>
      <Text style={styles.stateTitle}>Пока нет скачанных треков</Text>
      <Text style={styles.stateHint}>Откройте полный плеер и нажмите значок скачивания рядом с плюсом.</Text>
      <Text style={styles.stateFootnote}>Копии сохраняются только на этом устройстве.</Text>
    </View> : null}
  </ScrollView>
    <AppSheetModal isVisible={confirmClear} onClose={closeConfirmation} title="Удалить всё скачанное?"
      subtitle="Удалятся локальные копии на этом устройстве. Треки в «Моей музыке» и плейлистах останутся. Текущая загрузка будет отменена."
      footer={<View style={musicStyles.eventFilterActions}>
        <Pressable accessibilityRole="button" disabled={downloads.clearing} onPress={closeConfirmation} style={musicStyles.eventFilterReset}><Text style={musicStyles.eventFilterResetText}>Отмена</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Удалить всё скачанное" accessibilityState={{ busy: downloads.clearing, disabled: downloads.clearing }} disabled={downloads.clearing} onPress={() => void clear()} style={[musicStyles.eventFilterApply, downloads.clearing && musicStyles.disabledButton]}>
          {downloads.clearing ? <LoadingIndicator tone="inverse" /> : <Text style={musicStyles.eventFilterApplyText}>Удалить всё</Text>}
        </Pressable>
      </View>}>
      {clearError ? <Text accessibilityRole="alert" style={musicStyles.settingsError}>{clearError}</Text> : null}
    </AppSheetModal>
  </>;
}
const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { width: '100%', maxWidth: 720, alignSelf: 'center', paddingHorizontal: 18, paddingTop: 20, gap: 8, paddingBottom: 120 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 0, minHeight: 46 },
  copy: { flex: 1, minWidth: 0, gap: 4 }, title: { fontSize: 16, lineHeight: 22, fontWeight: '600', color: '#111' }, hint: { color: '#6f7b86', fontSize: 13, lineHeight: 19 },
  action: { width: 44, height: 44, justifyContent: 'center', alignItems: 'center' }, artwork: { width: 48, height: 48, borderRadius: 6, backgroundColor: '#f3f5f7', alignItems: 'center', justifyContent: 'center' },
  playCircle: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' },
  state: { width: '100%', maxWidth: 320, alignSelf: 'center', alignItems: 'center', gap: 12, paddingTop: 48, paddingBottom: 24 },
  stateIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#f3f5f7', alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  stateTitle: { width: '100%', textAlign: 'center', fontSize: 18, lineHeight: 24, fontWeight: '600', color: '#111' },
  stateHint: { width: '100%', textAlign: 'center', fontSize: 14, lineHeight: 21, color: '#6f7b86' },
  stateFootnote: { width: '100%', textAlign: 'center', fontSize: 12, lineHeight: 18, color: '#6f7b86', marginTop: 4 },
  retry: { minHeight: 44, minWidth: 132, borderRadius: 22, paddingHorizontal: 20, marginTop: 8, backgroundColor: '#f3f5f7', alignItems: 'center', justifyContent: 'center' },
  retryText: { color: '#111', fontSize: 14, fontWeight: '600' },
});
