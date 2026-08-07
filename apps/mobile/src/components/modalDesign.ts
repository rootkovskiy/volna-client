/**
 * Single source of truth for ordinary VOLNA bottom sheets.
 *
 * Change these tokens (and AppSheetModal when structural behavior changes)
 * instead of introducing screen-specific modal geometry.
 */
export const modalBackdropColor = 'rgba(0,0,0,0.64)' as const;

export const appSheetDesign = {
  backdropColor: modalBackdropColor,
  surfaceColor: '#fff',
  surfaceRadius: 12,
  viewportInset: 0,
  desktopMaxWidth: 600,
  maxHeight: '88%' as const,
  headerMinHeight: 64,
  headerLeftInset: 20,
  headerRightInset: 16,
  headerTopInset: 10,
  headerBottomInset: 8,
  headerWithSubtitleTopInset: 18,
  headerWithSubtitleBottomInset: 12,
  bodyHorizontalInset: 16,
  bodyBottomInset: 22,
  closeSize: 44,
  closeIconSize: 23,
  swipeActivationDistance: 7,
  swipeVerticalIntentRatio: 1.15,
  swipeDismissDistanceRatio: 0.12,
  swipeDismissMinDistance: 72,
  swipeDismissMaxDistance: 120,
  swipeDismissVelocity: 0.75,
  swipeFlingMinDistance: 24,
  swipeDismissDuration: 180,
  swipeBackdropFadeDistanceRatio: 0.55,
  swipeCloseFallbackDelay: 80,
  controlHeight: 44,
  cardRadius: 8,
  primaryGap: 0,
} as const;
