import { useEffect, useRef } from 'react';
import { Animated, Platform, RefreshControl, type RefreshControlProps } from 'react-native';
import { triggerLightHaptic } from '../utils/haptics';

const PULL_THRESHOLD = 72;
const MAX_PULL_OFFSET = 88;
const REFRESHING_PULL_OFFSET = 52;

type AppRefreshControlProps = RefreshControlProps & {
  webPullOffset?: Animated.Value;
};

function isAtTop(target: EventTarget | null) {
  if (!(target instanceof Element)) return true;
  if (target.closest('input, textarea, [role="dialog"]')) return false;
  let element: Element | null = target;
  while (element && element !== document.body) {
    const node = element as HTMLElement;
    const overflowY = window.getComputedStyle(node).overflowY;
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) return node.scrollTop <= 1;
    element = element.parentElement;
  }
  return window.scrollY <= 1;
}

export function AppRefreshControl({ webPullOffset, ...props }: AppRefreshControlProps) {
  const onRefreshRef = useRef(props.onRefresh);
  const refreshingRef = useRef(props.refreshing);
  const webPullOffsetRef = useRef(webPullOffset);
  onRefreshRef.current = props.onRefresh;
  refreshingRef.current = props.refreshing;
  webPullOffsetRef.current = webPullOffset;

  useEffect(() => {
    if (Platform.OS !== 'web' || props.refreshing || !webPullOffset) return;
    Animated.spring(webPullOffset, {
      toValue: 0,
      damping: 18,
      stiffness: 220,
      mass: 0.8,
      useNativeDriver: true,
    }).start();
  }, [props.refreshing, webPullOffset]);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    let startX = 0;
    let startY = 0;
    let distance = 0;
    let eligible = false;
    const settlePull = (toValue: number) => {
      const pullOffset = webPullOffsetRef.current;
      if (!pullOffset) return;
      Animated.spring(pullOffset, {
        toValue,
        damping: 18,
        stiffness: 220,
        mass: 0.8,
        useNativeDriver: true,
      }).start();
    };
    const reset = (settle = false) => {
      distance = 0;
      eligible = false;
      if (settle) settlePull(0);
    };
    const start = (event: TouchEvent) => {
      if (event.touches.length !== 1 || refreshingRef.current || !isAtTop(event.target)) return reset(true);
      startX = event.touches[0].clientX;
      startY = event.touches[0].clientY;
      eligible = true;
    };
    const move = (event: TouchEvent) => {
      if (!eligible || event.touches.length !== 1) return;
      const dx = event.touches[0].clientX - startX;
      const dy = event.touches[0].clientY - startY;
      if (dy <= 0 || Math.abs(dx) > dy) return reset(true);
      distance = dy;
      event.preventDefault();
      webPullOffsetRef.current?.setValue(Math.min(MAX_PULL_OFFSET, dy * 0.65));
    };
    const end = () => {
      const shouldRefresh = eligible && distance >= PULL_THRESHOLD && !refreshingRef.current;
      reset();
      settlePull(shouldRefresh ? REFRESHING_PULL_OFFSET : 0);
      if (shouldRefresh) {
        triggerLightHaptic();
        onRefreshRef.current?.();
      }
    };
    const cancel = () => reset(true);
    document.addEventListener('touchstart', start, { passive: true });
    document.addEventListener('touchmove', move, { passive: false });
    document.addEventListener('touchend', end, { passive: true });
    document.addEventListener('touchcancel', cancel, { passive: true });
    return () => {
      document.removeEventListener('touchstart', start);
      document.removeEventListener('touchmove', move);
      document.removeEventListener('touchend', end);
      document.removeEventListener('touchcancel', cancel);
    };
  }, []);

  // ScrollView treats `refreshControl` as a structural child on every
  // platform. Returning null on web makes react-native-web keep the refresh
  // wrapper but drop the actual scroll content. Its RefreshControl web shim
  // is an inert View, while the touch listeners above provide pull-to-refresh.
  return <RefreshControl {...props} refreshing={Platform.OS === 'web' ? false : props.refreshing} onRefresh={() => { triggerLightHaptic(); props.onRefresh?.(); }} />;
}
