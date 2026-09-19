import { useLayoutEffect, useState } from 'react';
import { Platform } from 'react-native';
import { useWebVisualViewport } from './web-visual-viewport';

type RootOwner = { users: number; position: string; priority: string };
const roots = new WeakMap<HTMLElement, RootOwner>();
type CanvasOwner = { users: number; restore: () => void };
const canvases = new WeakMap<Document, CanvasOwner>();

function retainChatCanvas(bottomColor: string) {
  let owner = canvases.get(document);
  if (!owner) {
    // iOS can expose the document canvas below the app's layout/safe area.
    // Paint it, rather than moving controls or enlarging the shared app shell.
    // Keep the upper canvas white for the translucent status bar.
    const restores = [document.documentElement, document.body].flatMap(element => {
      return [['background-color', bottomColor], ['background-image', `linear-gradient(#fff env(safe-area-inset-top, 0px), ${bottomColor} 0px)`]].map(([property, value]) => {
        const previous = element.style.getPropertyValue(property);
        const priority = element.style.getPropertyPriority(property);
        element.style.setProperty(property, value);
        const applied = element.style.getPropertyValue(property);
        return () => {
          if (element.style.getPropertyValue(property) !== applied || element.style.getPropertyPriority(property)) return;
          if (previous) element.style.setProperty(property, previous, priority);
          else element.style.removeProperty(property);
        };
      });
    });
    owner = { users: 0, restore: () => restores.forEach(restore => restore()) };
    canvases.set(document, owner);
  }
  owner.users++;
  return () => {
    if (--owner.users > 0) return;
    canvases.delete(document);
    owner.restore();
  };
}

/** Keep the iOS PWA input and native caret in the same document coordinate space. */
export function useWebChatViewport(bottomColor?: string) {
  const viewport = useWebVisualViewport();
  const [documentCoordinates, setDocumentCoordinates] = useState(false);
  const [appleStandalone, setAppleStandalone] = useState(false);
  useLayoutEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined' || typeof window === 'undefined') return;
    const navigator = window.navigator;
    const appleTouch = /iPhone|iPad|iPod/.test(navigator.userAgent)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const standalone = window.matchMedia?.('(display-mode: standalone)').matches
      || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
    setAppleStandalone(appleTouch && standalone);
    if (appleTouch && standalone && bottomColor) return retainChatCanvas(bottomColor);
  }, [bottomColor]);
  useLayoutEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined' || typeof window === 'undefined') return;
    const standalone = window.matchMedia?.('(display-mode: standalone)').matches
      || Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);
    if (!standalone) return;
    const root = document.getElementById('root');
    if (!root) return;
    let owner = roots.get(root);
    if (!owner) {
      if (window.getComputedStyle(root).position !== 'fixed') return;
      owner = { users: 0, position: root.style.getPropertyValue('position'), priority: root.style.getPropertyPriority('position') };
      roots.set(root, owner);
      // The standalone shell's inset/height/safe-area rules stay intact. Only
      // fixed positioning is released before any input can receive focus: iOS
      // may otherwise pan its fixed layer without updating the native caret.
      root.style.setProperty('position', 'absolute');
    }
    owner.users++;
    setDocumentCoordinates(true);
    return () => {
      if (--owner.users > 0) return;
      roots.delete(root);
      if (root.style.getPropertyValue('position') !== 'absolute') return;
      if (owner.position) root.style.setProperty('position', owner.position, owner.priority);
      else root.style.removeProperty('position');
    };
  }, []);
  // An absolute root moves with document scroll. offsetTop alone belongs to a
  // fixed layout viewport and would leave a gap equal to iOS's focus scroll.
  return {
    ...viewport,
    top: documentCoordinates ? viewport.pageTop : viewport.offsetTop,
    // Keep the complete capsule clear of iOS's keyboard accessory edge. This
    // is composer padding only; the viewport and home-indicator inset stay intact.
    keyboardPaddingBottom: appleStandalone ? 16 : 8,
  };
}
