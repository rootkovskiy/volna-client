import { createElement, useCallback, useMemo, useRef, useState } from 'react';
import { PanResponder, Platform, View } from 'react-native';
import { styles } from '../styles';

export function CompactTrackScrubber({
  accessibilityValueText,
  onChange,
  onChangeEnd,
  onInteractionStart,
  progress,
}: {
  accessibilityValueText?: string;
  onChange: (progress: number) => void;
  onChangeEnd: (progress: number) => void;
  onInteractionStart?: () => void;
  progress: number;
}) {
  const widthRef = useRef(1);
  const startXRef = useRef(0);
  const pointerIdRef = useRef<number | null>(null);
  const latestProgressRef = useRef(progress);
  const [dragProgress, setDragProgress] = useState<number | null>(null);
  const update = useCallback((x: number, commit = false) => {
    const next = Math.max(0, Math.min(1, x / widthRef.current));
    latestProgressRef.current = next;
    setDragProgress(commit ? null : next);
    onChange(next);
    if (commit) onChangeEnd(next);
    return next;
  }, [onChange, onChangeEnd]);
  const adjustFromKeyboard = useCallback((delta: number) => {
    const next = Math.max(0, Math.min(1, latestProgressRef.current + delta));
    latestProgressRef.current = next;
    onChange(next);
    onChangeEnd(next);
  }, [onChange, onChangeEnd]);
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (event) => { onInteractionStart?.(); startXRef.current = event.nativeEvent.locationX; update(startXRef.current); },
    onPanResponderMove: (_event, gesture) => update(startXRef.current + gesture.dx),
    onPanResponderRelease: (_event, gesture) => update(startXRef.current + gesture.dx, true),
    onPanResponderTerminate: () => { setDragProgress(null); onChangeEnd(latestProgressRef.current); },
    onPanResponderTerminationRequest: () => false,
  }), [onChangeEnd, onInteractionStart, update]);
  const displayed = dragProgress ?? Math.max(0, Math.min(1, progress));
  latestProgressRef.current = displayed;
  return <View
    {...(Platform.OS === 'web' ? {} : responder.panHandlers)}
    accessibilityActions={[{ name: 'decrement', label: 'Раньше' }, { name: 'increment', label: 'Позже' }]}
    accessibilityLabel="Выбрать момент начала композиции"
    accessibilityRole="adjustable"
    accessibilityValue={{ max: 100, min: 0, now: Math.round(displayed * 100), text: accessibilityValueText }}
    onAccessibilityAction={(event) => adjustFromKeyboard(event.nativeEvent.actionName === 'increment' ? 0.01 : -0.01)}
    onLayout={(event) => { widthRef.current = Math.max(1, event.nativeEvent.layout.width); }}
    style={styles.primaryTrackFragmentProgressHitbox}
  >
    <View pointerEvents="none" style={styles.primaryTrackFragmentProgressTrack}><View style={[styles.primaryTrackFragmentProgressFill, { width: `${displayed * 100}%` }]} /></View>
    <View pointerEvents="none" style={[styles.primaryTrackFragmentProgressThumb, { left: `${displayed * 100}%` }]} />
    {Platform.OS === 'web' ? createElement('div', {
      'aria-label': 'Выбрать момент начала композиции', 'aria-valuemax': 100, 'aria-valuemin': 0, 'aria-valuenow': Math.round(displayed * 100), 'aria-valuetext': accessibilityValueText, role: 'slider', tabIndex: 0,
      onKeyDown: (event: KeyboardEvent) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault(); adjustFromKeyboard(event.key === 'ArrowRight' ? 0.01 : -0.01);
      },
      onPointerDown: (event: PointerEvent & { currentTarget: HTMLElement }) => {
        event.preventDefault(); event.stopPropagation(); onInteractionStart?.(); pointerIdRef.current = event.pointerId; event.currentTarget.setPointerCapture?.(event.pointerId);
        const rect = event.currentTarget.getBoundingClientRect(); widthRef.current = Math.max(1, rect.width); update(event.clientX - rect.left);
      },
      onPointerMove: (event: PointerEvent & { currentTarget: HTMLElement }) => {
        if (pointerIdRef.current !== event.pointerId) return;
        event.preventDefault(); event.stopPropagation(); const rect = event.currentTarget.getBoundingClientRect(); update(event.clientX - rect.left);
      },
      onPointerUp: (event: PointerEvent & { currentTarget: HTMLElement }) => {
        if (pointerIdRef.current !== event.pointerId) return;
        event.preventDefault(); event.stopPropagation(); const rect = event.currentTarget.getBoundingClientRect(); update(event.clientX - rect.left, true); pointerIdRef.current = null;
      },
      onPointerCancel: (event: PointerEvent) => {
        if (pointerIdRef.current !== event.pointerId) return;
        pointerIdRef.current = null; setDragProgress(null); onChangeEnd(latestProgressRef.current);
      },
      style: { cursor: 'pointer', height: '100%', inset: 0, position: 'absolute', touchAction: 'none', userSelect: 'none', width: '100%', zIndex: 2 },
    }) : null}
  </View>;
}
