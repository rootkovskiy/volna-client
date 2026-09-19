import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, View, type StyleProp, type ViewStyle } from 'react-native';
import { useReducedMotion } from '@volna/messaging-client/ui-motion';

export function ContentTabIndicator({ children, index, count, style }: { children: ReactNode; index: number; count: number; style?: StyleProp<ViewStyle> }) {
  const [width, setWidth] = useState(0);
  const position = useRef(new Animated.Value(Math.max(0, index))).current;
  const reduced = useReducedMotion();
  const geometry = useRef({ width, count });
  useLayoutEffect(() => {
    const resized = geometry.current.width !== width || geometry.current.count !== count;
    geometry.current = { width, count };
    const animation = Animated.timing(position, { toValue: Math.max(0, index), duration: reduced || resized ? 0 : 220, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [index, count, width, reduced, position]);
  return <View accessibilityRole="tablist" onLayout={event => setWidth(event.nativeEvent.layout.width)} style={style}>
    {children}
    {width > 0 && count > 0 && index >= 0 ? <Animated.View pointerEvents="none" style={{ position: 'absolute', bottom: 0, left: 0, height: 3, width: width / count, backgroundColor: '#111', transform: [{ translateX: Animated.multiply(position, width / count) }] }} /> : null}
  </View>;
}
