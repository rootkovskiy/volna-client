import { Check, X } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { AccessibilityInfo, Animated, Easing, PanResponder, Platform, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { styles } from '../styles';
import type { ToastMessage } from '../types';
import { createToastLifetime, isToastSwipeUp, shouldDismissToast } from './toastGesture';

type ToastProps = { onClose: () => void; toast: ToastMessage };

export function TopToast({ onClose, toast }: { onClose: (id: number) => void; toast: ToastMessage | null }) {
  if (!toast) return null;
  return Platform.OS === 'web'
    ? <WebTopToast key={toast.id} onClose={() => onClose(toast.id)} toast={toast} />
    : <NativeTopToast key={toast.id} onClose={() => onClose(toast.id)} toast={toast} />;
}

function ToastCard({ toast }: { toast: ToastMessage }) {
  return <View pointerEvents="none" style={[styles.topToastCard, { marginTop: 0, marginHorizontal: 0 }]}>
    <View style={[styles.topToastIcon, toast.type === 'error' && styles.topToastIconError]}>
      {toast.type === 'error'
        ? <X color="#c62828" size={15} strokeWidth={2.8} />
        : <Check color="#2fa84f" size={15} strokeWidth={2.8} />}
    </View>
    <Text style={styles.topToastText}>{toast.message}</Text>
  </View>;
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(() => Platform.OS === 'web' && typeof window !== 'undefined'
    ? window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false : true);
  useEffect(() => {
    if (Platform.OS === 'web') {
      const query = window.matchMedia?.('(prefers-reduced-motion: reduce)');
      const update = () => setReduced(query?.matches ?? false);
      query?.addEventListener('change', update);
      return () => query?.removeEventListener('change', update);
    }
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (active) setReduced(value); }).catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => { active = false; subscription.remove(); };
  }, []);
  return reduced;
}

function useToastLifetime(onExit: (swiped: boolean) => void, onClose: () => void) {
  const callbacks = useRef({ onExit, onClose });
  callbacks.current = { onExit, onClose };
  const lifetime = useRef<ReturnType<typeof createToastLifetime> | null>(null);
  useEffect(() => {
    // Create inside the effect so StrictMode's cleanup/replay gets a new lifetime.
    const current = createToastLifetime(swiped => callbacks.current.onExit(swiped), () => callbacks.current.onClose());
    lifetime.current = current;
    current.resume();
    return () => { current.dispose(); lifetime.current = null; };
  }, []);
  return lifetime;
}

function WebTopToast({ onClose, toast }: ToastProps) {
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const [visible, setVisible] = useState(false);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const card = useRef<HTMLDivElement>(null);
  const entryFrame = useRef<number | undefined>(undefined);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pointer = useRef<{ id: number; x: number; y: number; lastY: number; lastAt: number; velocity: number; dx: number; dy: number; accepted: boolean } | null>(null);
  const lifetime = useToastLifetime(swiped => {
    const current = lifetime.current;
    if (entryFrame.current !== undefined) window.cancelAnimationFrame(entryFrame.current);
    setDragging(false);
    if (swiped && !reduced) setOffset(-Math.max(24, (card.current?.getBoundingClientRect().bottom ?? 0) - offset + 24));
    setVisible(false);
    closeTimer.current = setTimeout(() => current?.finish(), reduced ? 0 : 160);
  }, onClose);

  useEffect(() => {
    entryFrame.current = window.requestAnimationFrame(() => setVisible(true));
    return () => { if (entryFrame.current !== undefined) window.cancelAnimationFrame(entryFrame.current); clearTimeout(closeTimer.current); };
  }, []);

  const cancelPointer = () => {
    const active = pointer.current;
    pointer.current = null;
    if (active && card.current?.hasPointerCapture?.(active.id)) card.current.releasePointerCapture(active.id);
    setDragging(false);
    if (!lifetime.current?.isClosing()) { setOffset(0); lifetime.current?.resume(); }
  };
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = pointer.current;
    if (!active || active.id !== event.pointerId || lifetime.current?.isClosing()) return;
    active.dx = event.clientX - active.x;
    active.dy = event.clientY - active.y;
    const elapsed = event.timeStamp - active.lastAt;
    if (elapsed > 0 && event.clientY !== active.lastY) {
      active.velocity = (event.clientY - active.lastY) / elapsed;
      active.lastY = event.clientY;
      active.lastAt = event.timeStamp;
    }
    active.accepted ||= isToastSwipeUp(active.dx, active.dy);
    if (active.accepted) {
      event.preventDefault();
      setDragging(true);
      setOffset(reduced ? 0 : Math.min(0, active.dy));
    }
  };

  if (typeof document === 'undefined') return null;
  return createPortal(<div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 2000, paddingTop: insets.top, pointerEvents: 'none' }}>
    <div ref={card} role="status" aria-live={toast.type === 'error' ? 'assertive' : 'polite'} aria-atomic="true"
      aria-label={toast.message} aria-keyshortcuts="Escape" tabIndex={0}
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); lifetime.current?.dismiss(); } }}
      onPointerDown={event => {
        if (pointer.current) { cancelPointer(); return; }
        if (!event.isPrimary || event.button !== 0 || lifetime.current?.isClosing()) return;
        event.stopPropagation();
        lifetime.current?.pause();
        pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY, lastY: event.clientY, lastAt: event.timeStamp, velocity: 0, dx: 0, dy: 0, accepted: false };
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={move}
      onPointerUp={event => {
        move(event);
        const active = pointer.current;
        if (!active || active.id !== event.pointerId) return;
        pointer.current = null;
        if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        setDragging(false);
        const velocity = event.timeStamp - active.lastAt <= 80 ? active.velocity : 0;
        if (active.accepted && shouldDismissToast(active.dx, active.dy, velocity)) lifetime.current?.dismiss(true);
        else { setOffset(0); lifetime.current?.resume(); }
      }}
      onPointerCancel={cancelPointer} onLostPointerCapture={cancelPointer}
      onDragStart={event => event.preventDefault()}
      style={{ margin: '10px 15px 0', pointerEvents: 'auto', touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none', borderRadius: 8,
        opacity: visible ? 1 : 0, transform: `translate3d(0, ${reduced ? 0 : offset + (visible ? 0 : -24)}px, 0)`,
        transitionProperty: 'opacity, transform', transitionDuration: reduced || dragging ? '0ms' : visible ? '180ms' : '150ms',
        transitionTimingFunction: visible ? 'cubic-bezier(0.22, 1, 0.36, 1)' : 'cubic-bezier(0.4, 0, 1, 1)', willChange: 'opacity, transform' }}>
      <ToastCard toast={toast} />
    </div>
  </div>, document.body);
}

function NativeTopToast({ onClose, toast }: ToastProps) {
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const visibility = useRef(new Animated.Value(0)).current;
  const dragY = useRef(new Animated.Value(0)).current;
  const height = useRef(52);
  const accepted = useRef(false);
  const cancelled = useRef(false);
  const lifetime = useToastLifetime(swiped => {
    const current = lifetime.current;
    Animated.parallel([
      Animated.timing(visibility, { toValue: 0, duration: reduced ? 0 : 150, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      ...(swiped ? [Animated.timing(dragY, { toValue: reduced ? 0 : -(insets.top + height.current + 34), duration: reduced ? 0 : 150, easing: Easing.in(Easing.cubic), useNativeDriver: true })] : []),
    ]).start(({ finished }) => { if (finished) current?.finish(); });
  }, onClose);
  const state = useRef({ reduced });
  state.current = { reduced };
  const reset = useCallback(() => {
    if (lifetime.current?.isClosing()) return;
    Animated.timing(dragY, { toValue: 0, duration: state.current.reduced ? 0 : 180, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    lifetime.current?.resume();
  }, [dragY, lifetime]);
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => !lifetime.current?.isClosing(),
    onPanResponderGrant: () => { accepted.current = false; cancelled.current = false; lifetime.current?.pause(); dragY.stopAnimation(); },
    onPanResponderStart: (_event, gesture) => {
      if (gesture.numberActiveTouches > 1) { cancelled.current = true; reset(); }
    },
    onPanResponderMove: (_event, gesture) => {
      if (gesture.numberActiveTouches !== 1) { cancelled.current = true; reset(); return; }
      if (cancelled.current || lifetime.current?.isClosing()) return;
      accepted.current ||= isToastSwipeUp(gesture.dx, gesture.dy);
      if (accepted.current) dragY.setValue(state.current.reduced ? 0 : Math.min(0, gesture.dy));
    },
    onPanResponderRelease: (_event, gesture) => {
      if (!cancelled.current && accepted.current && shouldDismissToast(gesture.dx, gesture.dy, gesture.vy)) lifetime.current?.dismiss(true);
      else reset();
    },
    onPanResponderTerminate: reset,
    onPanResponderTerminationRequest: () => true,
  }), [dragY, lifetime, reset]);
  useEffect(() => {
    Animated.timing(visibility, { toValue: 1, duration: 180, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    return () => { visibility.stopAnimation(); dragY.stopAnimation(); };
  }, [dragY, visibility]);

  return <View pointerEvents="box-none" style={[styles.topToastLayer, { paddingTop: insets.top }]}>
    <Animated.View {...responder.panHandlers} accessible accessibilityRole="alert"
      accessibilityLabel={toast.message} accessibilityHint="Смахните вверх, чтобы закрыть уведомление"
      accessibilityActions={[{ name: 'dismiss', label: 'Закрыть уведомление' }]}
      onAccessibilityAction={event => { if (event.nativeEvent.actionName === 'dismiss') lifetime.current?.dismiss(); }}
      onAccessibilityEscape={() => lifetime.current?.dismiss()}
      onLayout={event => { height.current = event.nativeEvent.layout.height; }}
      style={{ marginTop: 10, marginHorizontal: 15, opacity: visibility,
        transform: [{ translateY: reduced ? 0 : Animated.add(dragY, visibility.interpolate({ inputRange: [0, 1], outputRange: [-24, 0] })) }] }}>
      <ToastCard toast={toast} />
    </Animated.View>
  </View>;
}
