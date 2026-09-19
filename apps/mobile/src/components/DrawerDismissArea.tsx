import { createElement, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { PanResponder, Platform, View, type StyleProp, type ViewStyle } from 'react-native';

export function drawerSwipeIntent(dx: number, dy: number) {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 10) return 'pending';
  return dx > 0 && dx > Math.abs(dy) * 1.5 ? 'right' : 'rejected';
}
export function shouldDismissDrawer(dx: number, dy: number, velocityX: number) {
  return drawerSwipeIntent(dx, dy) === 'right' && (dx >= 56 || (dx >= 24 && velocityX >= 0.55));
}

/** Shared right-swipe recognizer. Navigation/animation stays with the caller. */
export function DrawerDismissArea({ enabled, onDismiss, children, style, gestureKey }: {
  enabled: boolean; onDismiss: () => void; children: ReactNode; style?: StyleProp<ViewStyle>; gestureKey?: string | null;
}) {
  const current = useRef({ enabled, onDismiss, gestureKey });
  current.current = { enabled, onDismiss, gestureKey };
  const startKey = useRef(gestureKey);
  const intent = useRef<ReturnType<typeof drawerSwipeIntent>>('pending');
  const pointer = useRef<{ id: number; x: number; y: number; at: number; target: HTMLElement } | null>(null);
  const suppressClickUntil = useRef(0);
  const resetPointer = () => {
    const previous = pointer.current;
    pointer.current = null;
    if (previous?.target.hasPointerCapture?.(previous.id)) previous.target.releasePointerCapture(previous.id);
  };
  useEffect(() => {
    intent.current = 'rejected';
    resetPointer();
    return () => { intent.current = 'rejected'; resetPointer(); };
  }, [enabled, gestureKey]);
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponderCapture: () => { startKey.current = current.current.gestureKey; intent.current = 'pending'; return false; },
    onMoveShouldSetPanResponderCapture: (_event, gesture) => {
      if (!current.current.enabled || startKey.current !== current.current.gestureKey || gesture.numberActiveTouches !== 1) { intent.current = 'rejected'; return false; }
      if (intent.current === 'pending') intent.current = drawerSwipeIntent(gesture.dx, gesture.dy);
      return intent.current === 'right';
    },
    onPanResponderRelease: (_event, gesture) => {
      const dismiss = current.current.enabled && startKey.current === current.current.gestureKey && intent.current === 'right' && shouldDismissDrawer(gesture.dx, gesture.dy, gesture.vx);
      intent.current = 'rejected';
      if (dismiss) current.current.onDismiss();
    },
    onPanResponderMove: (_event, gesture) => { if (gesture.numberActiveTouches !== 1) intent.current = 'rejected'; },
    onPanResponderTerminate: () => { intent.current = 'rejected'; },
    onPanResponderTerminationRequest: () => true,
  }), []);
  if (Platform.OS !== 'web') return <View style={style} {...responder.panHandlers}>{children}</View>;

  type Event = PointerEvent & { currentTarget: HTMLElement };
  return createElement('div', {
    style: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, position: 'relative', touchAction: enabled ? 'pan-y pinch-zoom' : 'auto' },
    onPointerDownCapture: (event: Event) => {
      // React portals bubble through this component but do not belong to its surface.
      if (!event.currentTarget.contains(event.target as Node)) return;
      if (!current.current.enabled || !event.isPrimary || event.button !== 0) { resetPointer(); return; }
      resetPointer();
      if ((event.target as HTMLElement).closest?.('input, textarea, select, [contenteditable="true"], [role="switch"], [role="slider"], [data-swipe-back="ignore"]')) return;
      startKey.current = current.current.gestureKey;
      intent.current = 'pending';
      pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY, at: event.timeStamp, target: event.currentTarget };
    },
    onPointerMoveCapture: (event: Event) => {
      const start = pointer.current;
      if (!start || start.id !== event.pointerId) return;
      if (!current.current.enabled || startKey.current !== current.current.gestureKey || event.defaultPrevented) { resetPointer(); return; }
      if (intent.current === 'pending') intent.current = drawerSwipeIntent(event.clientX - start.x, event.clientY - start.y);
      if (intent.current !== 'right') return;
      event.preventDefault();
      if (!start.target.hasPointerCapture(event.pointerId)) start.target.setPointerCapture(event.pointerId);
      suppressClickUntil.current = Date.now() + 500;
    },
    onPointerUpCapture: (event: Event) => {
      const start = pointer.current;
      if (!start || start.id !== event.pointerId) return;
      const dx = event.clientX - start.x, dy = event.clientY - start.y;
      const dismiss = intent.current === 'right' && shouldDismissDrawer(dx, dy, dx / Math.max(1, event.timeStamp - start.at));
      if (intent.current === 'right') { event.preventDefault(); suppressClickUntil.current = Date.now() + 500; }
      resetPointer();
      if (current.current.enabled && startKey.current === current.current.gestureKey && dismiss) current.current.onDismiss();
    },
    onPointerCancel: (event: Event) => { if (pointer.current?.id === event.pointerId) resetPointer(); },
    // Browser image drag can cancel Pointer Events before horizontal intent is
    // reached. Keep an artwork-origin swipe inside this surface's recognizer.
    onDragStartCapture: (event: DragEvent) => {
      if (current.current.enabled && pointer.current && intent.current !== 'rejected' && (event.target as HTMLElement).closest?.('img')) event.preventDefault();
    },
    // Touch starts with implicit capture on the child. Taking capture here emits
    // a bubbling lost event from that child; it must not cancel our new capture.
    onLostPointerCapture: (event: Event) => {
      if (pointer.current?.id === event.pointerId && event.target === pointer.current.target) resetPointer();
    },
    onClickCapture: (event: MouseEvent) => { if (event.detail !== 0 && Date.now() < suppressClickUntil.current) { event.preventDefault(); event.stopPropagation(); } },
  }, <View style={style}>{children}</View>);
}
