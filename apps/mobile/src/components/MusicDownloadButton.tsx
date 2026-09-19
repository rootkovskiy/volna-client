import { LoadingIndicator, loadingTokens } from '@volna/messaging-client/loading';
import { Check, Download } from 'lucide-react-native';
import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { cancelAnimation, Easing, ReduceMotion, useAnimatedProps, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Rect } from 'react-native-svg';
import { cancelDeviceDownload, downloadableTrack, downloadIdentity, startDeviceDownload, useDeviceDownloads } from '../music/deviceDownloads';
import type { DownloadTrack } from '../music/downloadTypes';
import { supportsDeviceDownloads } from '../music/downloadDevice';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const circumference = 2 * Math.PI * loadingTokens.progressRadius;

function DownloadProgressRing({ progress }: { progress: number }) {
  const fill = useSharedValue(0);
  useEffect(() => {
    // Retarget from the current frame, without predicting bytes not yet received.
    fill.value = withTiming(progress, { duration: loadingTokens.progressDurationMs, easing: Easing.out(Easing.quad), reduceMotion: ReduceMotion.System });
    return () => cancelAnimation(fill);
  }, [fill, progress]);
  const animatedProps = useAnimatedProps(() => ({ strokeDashoffset: circumference * (1 - fill.value) }), [fill]);
  return <Svg width={loadingTokens.progressSize} height={loadingTokens.progressSize} viewBox="0 0 24 24">
    <Circle cx={12} cy={12} r={loadingTokens.progressRadius} stroke={loadingTokens.progressTrack} strokeWidth={loadingTokens.strokeWidth} fill="none" />
    <AnimatedCircle cx={12} cy={12} r={loadingTokens.progressRadius} stroke={loadingTokens.color} strokeWidth={loadingTokens.strokeWidth} strokeLinecap="round" fill="none" strokeDasharray={`${circumference}`} animatedProps={animatedProps} rotation={-90} origin="12,12" />
    <Rect x={9} y={9} width={6} height={6} rx={1} fill={loadingTokens.color} />
  </Svg>;
}

export function MusicDownloadButton({ track, notify }: { track: DownloadTrack; notify: (message: string, type?: 'success' | 'error') => void }) {
  const downloads = useDeviceDownloads();
  if (!supportsDeviceDownloads() || !downloadableTrack(track)) return null;
  const key = downloadIdentity(track);
  const saved = downloads.items.some((item) => item.key === key);
  const job = downloads.job?.key === key ? downloads.job : null;
  const progress = job?.progress.total ? Math.max(0, Math.min(0.99, job.progress.received / job.progress.total)) : null;
  return <MusicDownloadControl saved={saved} busy={!!job} disabled={saved || !downloads.ready || downloads.clearing} progress={progress} progressKey={key} onPress={() => { if (job) cancelDeviceDownload(); else void startDeviceDownload(track).catch((error) => notify(error.message, 'error')); }} />;
}

/** Shared rendering; the caller owns device storage, permissions and transfers. */
export function MusicDownloadControl({ saved = false, busy = false, disabled = false, progress = null, progressKey, onPress }: { saved?: boolean; busy?: boolean; disabled?: boolean; progress?: number | null; progressKey?: string; onPress: () => void }) {
  const percent = progress === null ? null : Math.floor(progress * 100);
  return <Pressable
    accessibilityRole="button" accessibilityLabel={busy ? 'Отменить скачивание трека' : saved ? 'Скачано на это устройство' : 'Скачать на это устройство'}
    accessibilityState={{ disabled, busy }} disabled={disabled}
    accessibilityValue={busy ? percent === null ? { text: 'Скачивание' } : { min: 0, max: 100, now: percent, text: `${percent}%` } : undefined}
    onPress={onPress}
    style={styles.button}
  >{busy ? <View style={styles.progress}>
    {progress === null ? <LoadingIndicator size={loadingTokens.progressSize} /> : <DownloadProgressRing key={progressKey} progress={progress} />}
  </View>
    : saved ? <View><Download color="#6f7b86" size={24} /><Check color="#111" size={12} style={styles.check} /></View> : <Download color="#111" size={24} strokeWidth={1.9} />}</Pressable>;
}
const styles = StyleSheet.create({
  button: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  progress: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' }, check: { position: 'absolute', right: -7, bottom: -3, backgroundColor: '#f3f5f7' },
});
