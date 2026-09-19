import { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, StyleSheet, View, type ViewProps, type ViewStyle } from 'react-native';
import { useReducedMotion } from './ui-motion';
import { loadingTokens } from './loading-tokens';

export { loadingTokens } from './loading-tokens';

export type LoadingIndicatorProps = ViewProps & {
  size?: 'small' | 'large' | number;
  tone?: 'default' | 'inverse' | 'danger';
  animating?: boolean;
};

/** One indeterminate indicator for screens, actions, media and public messaging. */
export function LoadingIndicator({ size = 'small', tone = 'default', animating = true, style, accessibilityLabel = 'Загрузка', ...props }: LoadingIndicatorProps) {
  const color = tone === 'inverse' ? loadingTokens.inverseColor : tone === 'danger' ? loadingTokens.dangerColor : loadingTokens.color;
  const reducedMotion = useReducedMotion();
  const rotation = useRef(new Animated.Value(0)).current;
  const diameter = typeof size === 'number' ? size : loadingTokens[size];
  useEffect(() => {
    rotation.setValue(0);
    if (Platform.OS === 'web' || reducedMotion || !animating) return;
    const animation = Animated.loop(Animated.timing(rotation, {
      toValue: 1, duration: loadingTokens.durationMs, easing: Easing.linear,
      useNativeDriver: true, isInteraction: false,
    }));
    animation.start();
    return () => animation.stop();
  }, [animating, reducedMotion, rotation]);

  if (!animating) return null;
  const circle: ViewStyle = { width: diameter, height: diameter, borderRadius: diameter / 2, borderWidth: loadingTokens.strokeWidth, borderColor: color };
  const motion = reducedMotion ? undefined : Platform.OS === 'web' ? styles.rotation : {
    transform: [{ rotate: rotation.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }],
  };
  return <View accessibilityRole="progressbar" accessibilityLabel={accessibilityLabel} accessibilityState={{ busy: true }} {...props} style={[styles.container, style]}>
    <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: diameter, height: diameter }}>
      <View style={[circle, styles.track]} />
      <Animated.View style={[circle, { borderLeftColor: 'transparent' }, motion]} />
    </View>
  </View>;
}

// Browser compositor owns the loop: no JavaScript timer or per-frame React render.
const webRotation = {
  animationKeyframes: [{ '0%': { transform: 'rotate(0deg)' }, '100%': { transform: 'rotate(360deg)' } }],
  animationDuration: `${loadingTokens.durationMs}ms`, animationTimingFunction: 'linear', animationIterationCount: 'infinite',
} as ViewStyle;
const styles = StyleSheet.create({
  rotation: webRotation,
  container: { alignItems: 'center', justifyContent: 'center' },
  track: { position: 'absolute', opacity: loadingTokens.trackOpacity },
});
