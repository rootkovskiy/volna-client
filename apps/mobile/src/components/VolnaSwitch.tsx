import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import { whiteControlShadow } from './controlStyles';

export function VolnaSwitch({
  accessibilityLabel,
  disabled = false,
  onValueChange,
  rejectionAnimationKey,
  surfaceTone = 'white',
  value,
}: {
  accessibilityLabel?: string;
  disabled?: boolean;
  onValueChange: (value: boolean) => void;
  rejectionAnimationKey?: number;
  surfaceTone?: 'neutral' | 'white';
  value: boolean;
}) {
  const progress = useRef(new Animated.Value(value ? 1 : 0)).current;
  const previousRejectionAnimationKey = useRef(rejectionAnimationKey);

  useEffect(() => {
    Animated.timing(progress, {
      toValue: value ? 1 : 0,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [progress, value]);

  useEffect(() => {
    if (rejectionAnimationKey === undefined || previousRejectionAnimationKey.current === rejectionAnimationKey) return;
    previousRejectionAnimationKey.current = rejectionAnimationKey;
    progress.stopAnimation();
    Animated.sequence([
      Animated.timing(progress, {
        toValue: value ? 0 : 1,
        duration: 90,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(progress, {
        toValue: value ? 1 : 0,
        duration: 180,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [progress, rejectionAnimationKey, value]);

  return (
    <View style={[
      styles.track,
      surfaceTone === 'neutral' ? styles.trackOnNeutral : styles.trackOnWhite,
      disabled && styles.disabled,
    ]}>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.enabledTrack,
          { opacity: progress },
        ]}
      />
      <Pressable accessibilityLabel={accessibilityLabel} accessibilityRole="switch" accessibilityState={{ checked: value, disabled }} disabled={disabled} hitSlop={8} onPress={() => onValueChange(!value)} style={styles.pressable}>
        <Animated.View style={[styles.thumb, { transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [0, 16] }) }] }]} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    width: 40,
    height: 24,
    borderRadius: 12,
    position: 'relative',
  },
  trackOnNeutral: { backgroundColor: '#fff' },
  trackOnWhite: { backgroundColor: '#f3f5f7' },
  enabledTrack: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 12,
    backgroundColor: '#111',
  },
  pressable: { flex: 1, padding: 2, justifyContent: 'center' },
  thumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#fff',
    ...whiteControlShadow,
  },
  disabled: { opacity: 0.5 },
});
