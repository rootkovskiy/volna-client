import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useReducedMotion } from './ui-motion';
import {
  Animated,
  StyleSheet,
  Easing,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { X } from 'lucide-react-native';

import { useWebVisualViewport } from './web-visual-viewport';
import { appSheetDesign } from './sheet-design';
import { TouchActionSelectionStyles } from './touch-action-selection';

export function AppSheetModal({
  children,
  bodyRef,
  contentContainerStyle,
  embedded = false,
  footer,
  footerContainerStyle,
  headerAction,
  isVisible,
  onClose,
  scroll = false,
  subtitle,
  title,
  touchActionMenu = false,
}: {
  children: ReactNode;
  bodyRef?: RefObject<ScrollView | null>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  embedded?: boolean;
  footer?: ReactNode;
  footerContainerStyle?: StyleProp<ViewStyle>;
  headerAction?: ReactNode;
  isVisible: boolean;
  onClose: () => void;
  scroll?: boolean;
  subtitle?: string;
  title: string;
  touchActionMenu?: boolean;
}) {
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const reduced = useReducedMotion();
  const [isAnimating, setIsAnimating] = useState(isVisible);
  const [isDragging, setIsDragging] = useState(false);
  const [isMounted, setIsMounted] = useState(isVisible);
  const animationProgress = useRef(new Animated.Value(0)).current;
  const dragTranslateY = useRef(new Animated.Value(0)).current;
  const isDismissingByGesture = useRef(false);
  const isVisibleRef = useRef(isVisible);
  const onCloseRef = useRef(onClose);
  const visualViewport = useWebVisualViewport(isVisible);
  isVisibleRef.current = isVisible;
  onCloseRef.current = onClose;

  useEffect(() => {
    animationProgress.stopAnimation();
    let frame: number | undefined;
    if (reduced) {
      animationProgress.setValue(isVisible ? 1 : 0);
      dragTranslateY.setValue(0);
      setIsMounted(isVisible);
      setIsAnimating(false);
      return;
    }

    if (isVisible) {
      setIsMounted(true);
      dragTranslateY.setValue(0);
      isDismissingByGesture.current = false;
      animationProgress.setValue(0);
      setIsAnimating(true);
      frame = requestAnimationFrame(() => {
        Animated.timing(animationProgress, {
          duration: 240,
          easing: Easing.out(Easing.cubic),
          toValue: 1,
          useNativeDriver: Platform.OS !== 'web',
        }).start(({ finished }) => { if (finished) setIsAnimating(false); });
      });
      return () => { if (frame !== undefined) cancelAnimationFrame(frame); animationProgress.stopAnimation(); };
    }

    if (!isMounted) return;
    setIsAnimating(true);
    Animated.timing(animationProgress, {
      duration: 200,
      easing: Easing.in(Easing.cubic),
      toValue: 0,
      useNativeDriver: Platform.OS !== 'web',
    }).start(({ finished }) => {
      if (finished) { setIsMounted(false); setIsAnimating(false); }
    });
    return () => animationProgress.stopAnimation();
  }, [animationProgress, dragTranslateY, isVisible, reduced]);

  const restoreDraggedSheet = () => {
    isDismissingByGesture.current = false;
    if (reduced) { dragTranslateY.setValue(0); setIsDragging(false); return; }
    Animated.spring(dragTranslateY, {
      damping: 24,
      mass: 0.8,
      stiffness: 280,
      toValue: 0,
      useNativeDriver: Platform.OS !== 'web',
    }).start(({ finished }) => { if (finished) setIsDragging(false); });
  };

  const sheetPanResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => (
      isVisibleRef.current
      && !isDismissingByGesture.current
      && gesture.dy > appSheetDesign.swipeActivationDistance
      && Math.abs(gesture.dy) > Math.abs(gesture.dx) * appSheetDesign.swipeVerticalIntentRatio
    ),
    onPanResponderGrant: () => {
      setIsDragging(true);
      Keyboard.dismiss();
      dragTranslateY.stopAnimation();
    },
    onPanResponderMove: (_event, gesture) => {
      dragTranslateY.setValue(Math.max(0, gesture.dy));
    },
    onPanResponderRelease: (_event, gesture) => {
      const dismissDistance = Math.min(
        appSheetDesign.swipeDismissMaxDistance,
        Math.max(appSheetDesign.swipeDismissMinDistance, windowHeight * appSheetDesign.swipeDismissDistanceRatio),
      );
      const shouldDismiss = gesture.dy >= dismissDistance
        || (gesture.dy >= appSheetDesign.swipeFlingMinDistance && gesture.vy >= appSheetDesign.swipeDismissVelocity);

      if (!shouldDismiss) {
        restoreDraggedSheet();
        return;
      }

      isDismissingByGesture.current = true;
      if (reduced) { onCloseRef.current(); dragTranslateY.setValue(0); setIsDragging(false); return; }
      Animated.timing(dragTranslateY, {
        duration: appSheetDesign.swipeDismissDuration,
        easing: Easing.in(Easing.cubic),
        toValue: windowHeight,
        useNativeDriver: Platform.OS !== 'web',
      }).start(({ finished }) => {
        if (!finished) {
          restoreDraggedSheet();
          return;
        }

        onCloseRef.current();
        setTimeout(() => {
          if (isVisibleRef.current) restoreDraggedSheet();
        }, appSheetDesign.swipeCloseFallbackDelay);
      });
    },
    onPanResponderTerminate: restoreDraggedSheet,
    onPanResponderTerminationRequest: () => false,
  }), [dragTranslateY, windowHeight, reduced]);

  const baseTranslateY = animationProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [windowHeight, 0],
  });
  const sheetTranslateY = Animated.add(baseTranslateY, dragTranslateY);
  const dragBackdropProgress = dragTranslateY.interpolate({
    extrapolate: 'clamp',
    inputRange: [0, Math.max(1, windowHeight * appSheetDesign.swipeBackdropFadeDistanceRatio)],
    outputRange: [1, 0],
  });
  const backdropOpacity = Animated.multiply(animationProgress, dragBackdropProgress);

  const content = scroll ? (
    <ScrollView
      ref={bodyRef}
      contentContainerStyle={[sheetStyles.appSheetContent, footer ? sheetStyles.appSheetContentWithFooter : null, contentContainerStyle]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      style={sheetStyles.appSheetScroll}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[sheetStyles.appSheetContent, footer ? sheetStyles.appSheetContentWithFooter : null, contentContainerStyle]}>{children}</View>
  );

  const layer = (
    <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
        style={[
          sheetStyles.appSheetLayer,
          embedded && sheetStyles.appSheetEmbeddedLayer,
          Platform.OS === 'web' && visualViewport.keyboardVisible && { paddingBottom: visualViewport.bottomInset + appSheetDesign.viewportInset },
        ]}
      >
        <Animated.View
          pointerEvents={isVisible ? 'auto' : 'none'}
          style={[sheetStyles.appSheetBackdrop, { opacity: backdropOpacity }]}
        >
          <Pressable accessibilityLabel="Закрыть окно" accessibilityRole="button" onPress={onClose} style={sheetStyles.appSheetBackdropPressable} />
        </Animated.View>
        {touchActionMenu ? <TouchActionSelectionStyles /> : null}
        <Animated.View {...(Platform.OS === 'web' && touchActionMenu ? { dataSet: { 'volna-touch-action': 'true' } } : {})} pointerEvents={isVisible ? 'auto' : 'none'} style={[
          sheetStyles.appSheetSurface,
          { maxWidth: windowWidth < appSheetDesign.desktopBreakpoint ? '100%' : appSheetDesign.desktopMaxWidth },
          Platform.OS === 'web' && visualViewport.keyboardVisible && visualViewport.height
            ? { maxHeight: Math.max(0, visualViewport.height - appSheetDesign.viewportInset * 2) }
            : null,
          (Platform.OS !== 'web' || isAnimating || isDragging) ? {
            transform: [{ translateY: sheetTranslateY }],
          } : null,
        ]}>
          <View
            {...sheetPanResponder.panHandlers}
            style={[
              sheetStyles.appSheetHeader,
              subtitle ? sheetStyles.appSheetHeaderWithSubtitle : null,
              Platform.OS === 'web' ? ({ touchAction: 'none' } as ViewStyle) : null,
            ]}
          >
            <View style={sheetStyles.appSheetHeading}>
              <Text style={sheetStyles.appSheetTitle}>{title}</Text>
              {subtitle ? <Text style={sheetStyles.appSheetSubtitle}>{subtitle}</Text> : null}
            </View>
            {headerAction}
            <Pressable accessibilityLabel="Закрыть" accessibilityRole="button" hitSlop={8} onPress={onClose} style={sheetStyles.appSheetClose}>
              <X color="#111" size={appSheetDesign.closeIconSize} strokeWidth={2.2} />
            </Pressable>
          </View>
          {content}
          {footer ? <View style={[sheetStyles.appSheetFooter, footerContainerStyle]}>{footer}</View> : null}
        </Animated.View>
    </KeyboardAvoidingView>
  );

  if (embedded) return isMounted ? layer : null;

  return (
    <Modal animationType="none" onRequestClose={onClose} presentationStyle="overFullScreen" transparent visible={isMounted}>
      {layer}
    </Modal>
  );
}

const sheetStyles = StyleSheet.create({
  appSheetLayer: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: appSheetDesign.viewportInset,
    paddingBottom: appSheetDesign.viewportInset,
  },
  appSheetEmbeddedLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 20,
  },
  appSheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: appSheetDesign.backdropColor,
  },
  appSheetBackdropPressable: {
    flex: 1,
  },
  appSheetSurface: {
    width: '100%',
    maxWidth: appSheetDesign.desktopMaxWidth,
    maxHeight: appSheetDesign.maxHeight,
    alignSelf: 'center',
    overflow: 'hidden',
    borderTopLeftRadius: appSheetDesign.surfaceRadius,
    borderTopRightRadius: appSheetDesign.surfaceRadius,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    backgroundColor: appSheetDesign.surfaceColor,
  },
  appSheetHeader: {
    minHeight: appSheetDesign.headerMinHeight,
    paddingLeft: appSheetDesign.headerLeftInset,
    paddingRight: appSheetDesign.headerRightInset,
    paddingTop: appSheetDesign.headerTopInset,
    paddingBottom: appSheetDesign.headerBottomInset,
    flexDirection: 'row',
    alignItems: 'center',
    gap: appSheetDesign.primaryGap,
  },
  appSheetHeaderWithSubtitle: {
    paddingTop: appSheetDesign.headerWithSubtitleTopInset,
    paddingBottom: appSheetDesign.headerWithSubtitleBottomInset,
  },
  appSheetHeading: {
    flex: 1,
    minWidth: 0,
  },
  appSheetTitle: {
    color: '#111',
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '600',
  },
  appSheetSubtitle: {
    marginTop: 1,
    color: '#6f7b86',
    fontSize: 13,
    lineHeight: 18,
  },
  appSheetClose: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  appSheetContent: {
    paddingHorizontal: appSheetDesign.bodyHorizontalInset,
    paddingBottom: appSheetDesign.bodyBottomInset,
    gap: appSheetDesign.primaryGap,
  },
  appSheetContentWithFooter: {
    paddingBottom: 0,
  },
  appSheetFooter: {
    paddingHorizontal: appSheetDesign.bodyHorizontalInset,
    paddingTop: appSheetDesign.primaryGap,
    paddingBottom: appSheetDesign.bodyBottomInset,
  },
  appSheetScroll: { flexShrink: 1 },
});
