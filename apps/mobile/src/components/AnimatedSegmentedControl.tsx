import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, type StyleProp, type TextStyle, View, type ViewStyle } from 'react-native';
import { whiteControlShadow } from './controlStyles';

type SegmentValue = string | number | boolean | null;
type SegmentedControlOption<T extends SegmentValue> = {
  value: T;
  label: string;
  renderContent?: (active: boolean) => ReactNode;
};

export function AnimatedSegmentedControl<T extends SegmentValue>({
  options,
  value,
  onChange,
  containerStyle,
  textStyle,
  activeTextStyle,
  indicatorStyle,
  accessibilityLabel,
}: {
  options: ReadonlyArray<SegmentedControlOption<T>>;
  value: T;
  onChange: (value: T) => void;
  containerStyle?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  activeTextStyle?: StyleProp<TextStyle>;
  indicatorStyle?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const matchedIndex = options.findIndex((option) => option.value === value);
  const selectedIndex = Math.max(0, matchedIndex);
  const progress = useRef(new Animated.Value(selectedIndex)).current;
  const [width, setWidth] = useState(0);
  const segmentWidth = options.length > 0 ? Math.max(0, (width - 8) / options.length) : 0;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: selectedIndex,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [progress, selectedIndex]);

  return (
    <View accessibilityLabel={accessibilityLabel} accessibilityRole="tablist" onLayout={(event) => setWidth(event.nativeEvent.layout.width)} style={[localStyles.container, containerStyle]}>
      {segmentWidth > 0 && matchedIndex >= 0 ? <Animated.View pointerEvents="none" style={[localStyles.indicator, indicatorStyle, {
        width: segmentWidth,
        transform: [{ translateX: progress.interpolate({ inputRange: [0, Math.max(1, options.length - 1)], outputRange: [0, segmentWidth * Math.max(1, options.length - 1)] }) }],
      }]} /> : null}
      {options.map((option) => {
        const active = option.value === value;
        return <Pressable accessibilityLabel={option.label} accessibilityRole="tab" accessibilityState={{ selected: active }} key={String(option.value)} onPress={() => onChange(option.value)} style={localStyles.item}>
          {option.renderContent
            ? option.renderContent(active)
            : <Text numberOfLines={1} style={[localStyles.text, textStyle, active && activeTextStyle, localStyles.labelTypography, active && localStyles.activeText]}>{option.label}</Text>}
        </Pressable>;
      })}
    </View>
  );
}

const localStyles = StyleSheet.create({
  container: { height: 44, borderRadius: 22, padding: 4, flexDirection: 'row', backgroundColor: '#f3f5f7' },
  indicator: {
    position: 'absolute',
    top: 4,
    bottom: 4,
    left: 4,
    borderRadius: 18,
    backgroundColor: '#fff',
    ...whiteControlShadow,
  },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 2, zIndex: 1 },
  text: { color: '#6f7b86' },
  activeText: { color: '#111', fontWeight: '500' },
  labelTypography: { fontSize: 14, lineHeight: 20, fontWeight: '400' },
});
