import { useCallback, useId, useState, type ReactNode } from 'react';
import { ScrollView, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { styles } from '../styles';

export function CompactPlaylistTrackList({ children, itemCount }: { children: ReactNode; itemCount: number }) {
  const gradientId = `compact-playlist-fade-${useId().replace(/:/g, '')}`;
  const topGradientId = `${gradientId}-top`;
  const bottomGradientId = `${gradientId}-bottom`;
  const [isAtStart, setIsAtStart] = useState(true);
  const [isAtEnd, setIsAtEnd] = useState(false);
  const hasOverflow = itemCount >= 5;

  const updateFadeVisibility = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const nextIsAtStart = contentOffset.y <= 2;
    const nextIsAtEnd = contentOffset.y + layoutMeasurement.height >= contentSize.height - 2;
    setIsAtStart((current) => current === nextIsAtStart ? current : nextIsAtStart);
    setIsAtEnd((current) => current === nextIsAtEnd ? current : nextIsAtEnd);
  }, []);

  return (
    <View style={styles.compactPlaylistFrame}>
      <ScrollView
        contentContainerStyle={styles.compactPlaylistContent}
        nestedScrollEnabled
        onScroll={hasOverflow ? updateFadeVisibility : undefined}
        scrollEventThrottle={64}
        showsVerticalScrollIndicator={false}
        style={styles.compactPlaylistViewport}
      >
        {children}
      </ScrollView>
      {hasOverflow && !isAtStart ? (
        <View pointerEvents="none" style={[styles.compactPlaylistFade, styles.compactPlaylistFadeTop]}>
          <Svg height="100%" width="100%">
            <Defs>
              <LinearGradient id={topGradientId} x1="0" x2="0" y1="0" y2="1">
                <Stop offset="0" stopColor="#fff" stopOpacity="1" />
                <Stop offset="1" stopColor="#fff" stopOpacity="0" />
              </LinearGradient>
            </Defs>
            <Rect fill={`url(#${topGradientId})`} height="100%" width="100%" />
          </Svg>
        </View>
      ) : null}
      {hasOverflow && !isAtEnd ? (
        <View pointerEvents="none" style={[styles.compactPlaylistFade, styles.compactPlaylistFadeBottom]}>
          <Svg height="100%" width="100%">
            <Defs>
              <LinearGradient id={bottomGradientId} x1="0" x2="0" y1="0" y2="1">
                <Stop offset="0" stopColor="#fff" stopOpacity="0" />
                <Stop offset="1" stopColor="#fff" stopOpacity="1" />
              </LinearGradient>
            </Defs>
            <Rect fill={`url(#${bottomGradientId})`} height="100%" width="100%" />
          </Svg>
        </View>
      ) : null}
    </View>
  );
}
