import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Easing } from 'react-native';

const EXPANDED_HEIGHT = 125;

export function AnimatedReleaseTrackList({ children, expanded }: { children: ReactNode; expanded: boolean }) {
  const progress = useRef(new Animated.Value(expanded ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: expanded ? 1 : 0,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [expanded, progress]);

  return (
    <Animated.View
      pointerEvents={expanded ? 'auto' : 'none'}
      style={{
        maxHeight: progress.interpolate({ inputRange: [0, 1], outputRange: [0, EXPANDED_HEIGHT] }),
        opacity: progress,
        overflow: 'hidden',
      }}
    >
      {children}
    </Animated.View>
  );
}
