import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, View, type StyleProp, type ViewStyle } from 'react-native';

export function useReducedMotion() {
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

/** Only small disclosures; never wrap an entire scrolling list in a height animation. */
export function MotionDisclosure({ visible, children, onClosed }: { visible: boolean; children: ReactNode; onClosed?: () => void }) {
  const reduced = useReducedMotion();
  const progress = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const [height, setHeight] = useState(0);
  const [mounted, setMounted] = useState(visible);
  const retained = useRef(children);
  const generation = useRef(0);
  const closed = useRef(onClosed);
  closed.current = onClosed;
  if (visible) retained.current = children;
  useLayoutEffect(() => {
    const current = ++generation.current;
    if (visible) setMounted(true);
    const animation = Animated.timing(progress, { toValue: visible ? 1 : 0, duration: reduced ? 0 : 180, easing: Easing.out(Easing.cubic), useNativeDriver: false });
    animation.start(({ finished }) => {
      if (finished && current === generation.current && !visible) { retained.current = null; setMounted(false); closed.current?.(); }
    });
    return () => { generation.current++; animation.stop(); };
  }, [visible, reduced, progress]);
  if (!mounted && !visible) return null;
  return <Animated.View pointerEvents={visible ? 'auto' : 'none'} accessibilityElementsHidden={!visible} importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'} style={{ overflow: 'hidden', opacity: progress, height: height ? progress.interpolate({ inputRange: [0, 1], outputRange: [0, height] }) : 0 }}>
    <View onLayout={event => setHeight(event.nativeEvent.layout.height)}>{visible ? children : retained.current}</View>
  </Animated.View>;
}

/** Incoming content only: no duplicate interactive screens and no delayed navigation. */
export function MotionSurface({ children, identity, direction = 0, enabled = true, style }: { children: ReactNode; identity: string; direction?: number; enabled?: boolean; style?: StyleProp<ViewStyle> }) {
  const reduced = useReducedMotion();
  const progress = useRef(new Animated.Value(1)).current;
  const previous = useRef(identity);
  const [running, setRunning] = useState(false);
  const [travel, setTravel] = useState(0);
  useLayoutEffect(() => {
    const changed = previous.current !== identity;
    previous.current = identity;
    progress.stopAnimation();
    if (!changed || reduced || !enabled) { progress.setValue(1); setRunning(false); return; }
    setRunning(true);
    setTravel(direction * 14);
    progress.setValue(0);
    const animation = Animated.timing(progress, { toValue: 1, duration: direction ? 200 : 150, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    animation.start(({ finished }) => { if (finished) setRunning(false); });
    return () => animation.stop();
  }, [identity, reduced, progress]);
  // A resting web ancestor must have no transform, including translateX(0): Safari caret positioning.
  return <Animated.View style={[style, running ? { opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0.72, 1] }), ...(travel && !reduced ? { transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [travel, 0] }) }] } : {}) } : null]}>{children}</Animated.View>;
}
