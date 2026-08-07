import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
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
import { styles } from '../styles';
import { useWebVisualViewport } from '../hooks/useWebVisualViewport';
import { appSheetDesign } from './modalDesign';

export function AppSheetModal({
  children,
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
}: {
  children: ReactNode;
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
}) {
  const { height: windowHeight } = useWindowDimensions();
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

    if (isVisible) {
      setIsMounted(true);
      dragTranslateY.setValue(0);
      isDismissingByGesture.current = false;
      animationProgress.setValue(0);
      requestAnimationFrame(() => {
        Animated.timing(animationProgress, {
          duration: 240,
          easing: Easing.out(Easing.cubic),
          toValue: 1,
          useNativeDriver: Platform.OS !== 'web',
        }).start();
      });
      return;
    }

    if (!isMounted) return;
    Animated.timing(animationProgress, {
      duration: 200,
      easing: Easing.in(Easing.cubic),
      toValue: 0,
      useNativeDriver: Platform.OS !== 'web',
    }).start(({ finished }) => {
      if (finished) setIsMounted(false);
    });
  }, [animationProgress, dragTranslateY, isMounted, isVisible]);

  const restoreDraggedSheet = () => {
    isDismissingByGesture.current = false;
    Animated.spring(dragTranslateY, {
      damping: 24,
      mass: 0.8,
      stiffness: 280,
      toValue: 0,
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  };

  const sheetPanResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => (
      isVisibleRef.current
      && !isDismissingByGesture.current
      && gesture.dy > appSheetDesign.swipeActivationDistance
      && Math.abs(gesture.dy) > Math.abs(gesture.dx) * appSheetDesign.swipeVerticalIntentRatio
    ),
    onPanResponderGrant: () => {
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
  }), [dragTranslateY, windowHeight]);

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
      contentContainerStyle={[styles.appSheetContent, footer ? styles.appSheetContentWithFooter : null, contentContainerStyle]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      style={styles.appSheetScroll}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.appSheetContent, footer ? styles.appSheetContentWithFooter : null, contentContainerStyle]}>{children}</View>
  );

  const layer = (
    <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
        style={[
          styles.appSheetLayer,
          embedded && styles.appSheetEmbeddedLayer,
          Platform.OS === 'web' && visualViewport.keyboardVisible && { paddingBottom: visualViewport.bottomInset + appSheetDesign.viewportInset },
        ]}
      >
        <Animated.View
          pointerEvents={isVisible ? 'auto' : 'none'}
          style={[styles.appSheetBackdrop, { opacity: backdropOpacity }]}
        >
          <Pressable accessibilityLabel="Закрыть окно" accessibilityRole="button" onPress={onClose} style={styles.appSheetBackdropPressable} />
        </Animated.View>
        <Animated.View style={[
          styles.appSheetSurface,
          Platform.OS === 'web' && visualViewport.keyboardVisible && visualViewport.height
            ? { maxHeight: Math.max(240, visualViewport.height - appSheetDesign.viewportInset * 2) }
            : null,
          {
            transform: [{ translateY: sheetTranslateY }],
          },
        ]}>
          <View
            {...sheetPanResponder.panHandlers}
            style={[
              styles.appSheetHeader,
              subtitle ? styles.appSheetHeaderWithSubtitle : null,
              Platform.OS === 'web' ? ({ touchAction: 'none' } as ViewStyle) : null,
            ]}
          >
            <View style={styles.appSheetHeading}>
              <Text style={styles.appSheetTitle}>{title}</Text>
              {subtitle ? <Text style={styles.appSheetSubtitle}>{subtitle}</Text> : null}
            </View>
            {headerAction}
            <Pressable accessibilityLabel="Закрыть" accessibilityRole="button" hitSlop={8} onPress={onClose} style={styles.appSheetClose}>
              <X color="#111" size={appSheetDesign.closeIconSize} strokeWidth={2.2} />
            </Pressable>
          </View>
          {content}
          {footer ? <View style={[styles.appSheetFooter, footerContainerStyle]}>{footer}</View> : null}
        </Animated.View>
    </KeyboardAvoidingView>
  );

  if (embedded) return isMounted ? layer : null;

  return (
    <Modal animationType="none" onRequestClose={onClose} transparent visible={isMounted}>
      {layer}
    </Modal>
  );
}
