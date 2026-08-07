import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, View } from 'react-native';

export const AnimatedMusicLibraryRow = memo(function AnimatedMusicLibraryRow({
  children,
  entering = false,
  leaving = false,
  onLeaveComplete,
}: {
  children: ReactNode;
  entering?: boolean;
  leaving?: boolean;
  onLeaveComplete?: () => void;
}) {
  const visibility = useRef(new Animated.Value(entering ? 0 : 1)).current;
  const collapse = useRef(new Animated.Value(1)).current;
  const [measuredHeight, setMeasuredHeight] = useState(0);
  const leaveCompleted = useRef(false);
  const onLeaveCompleteRef = useRef(onLeaveComplete);
  onLeaveCompleteRef.current = onLeaveComplete;

  useEffect(() => {
    if (!entering || leaving) return;
    Animated.timing(visibility, {
      duration: 160,
      easing: Easing.out(Easing.cubic),
      toValue: 1,
      useNativeDriver: true,
    }).start();
  }, [entering, leaving, visibility]);

  useEffect(() => {
    if (!leaving || leaveCompleted.current) return;
    visibility.stopAnimation();
    Animated.timing(visibility, {
      duration: 130,
      easing: Easing.out(Easing.quad),
      toValue: 0,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) return;
      Animated.timing(collapse, {
        duration: 120,
        easing: Easing.inOut(Easing.cubic),
        toValue: 0,
        useNativeDriver: false,
      }).start(({ finished: collapsed }) => {
        if (!collapsed || leaveCompleted.current) return;
        leaveCompleted.current = true;
        onLeaveCompleteRef.current?.();
      });
    });
  }, [collapse, leaving, visibility]);

  const animatedHeight = measuredHeight > 0
    ? collapse.interpolate({ inputRange: [0, 1], outputRange: [0, measuredHeight] })
    : undefined;

  return (
    <Animated.View
      style={[
        {
          opacity: visibility,
          transform: [{
            translateY: visibility.interpolate({ inputRange: [0, 1], outputRange: [-4, 0] }),
          }],
        },
        leaving && animatedHeight ? { height: animatedHeight, overflow: 'hidden' } : null,
      ]}
    >
      <View onLayout={({ nativeEvent }) => {
        const nextHeight = nativeEvent.layout.height;
        if (!leaving && nextHeight > 0 && nextHeight !== measuredHeight) setMeasuredHeight(nextHeight);
      }}>
        {children}
      </View>
    </Animated.View>
  );
});
