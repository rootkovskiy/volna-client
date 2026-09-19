import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

export type WebVisualViewportFrame = {
  bottomInset: number;
  height?: number;
  keyboardVisible: boolean;
  offsetTop: number;
  pageTop: number;
};

const initialFrame: WebVisualViewportFrame = { bottomInset: 0, keyboardVisible: false, offsetTop: 0, pageTop: 0 };

function hasFocusedEditor() {
  if (typeof document === 'undefined') return false;
  const element = document.activeElement as HTMLElement | null;
  return Boolean(element && (element.isContentEditable || element.tagName === 'TEXTAREA'
    || (element.tagName === 'INPUT' && !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'file', 'color', 'hidden'].includes((element as HTMLInputElement).type))));
}

export function useWebVisualViewport(isActive = true) {
  const [frame, setFrame] = useState<WebVisualViewportFrame>(initialFrame);

  useEffect(() => {
    if (Platform.OS !== 'web' || !isActive || typeof window === 'undefined' || !window.visualViewport) {
      setFrame(initialFrame);
      return;
    }

    const viewport = window.visualViewport;
    let restingHeight = viewport.height;
    let wasKeyboardVisible = false;
    const update = () => {
      const height = Math.round(viewport.height);
      const offsetTop = Math.max(0, Math.round(viewport.offsetTop));
      const pageTop = Math.max(0, Math.round(Number.isFinite(viewport.pageTop) ? viewport.pageTop : window.scrollY + viewport.offsetTop));
      const bottomInset = Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop));
      const focused = hasFocusedEditor();
      // Some PWA keyboards shrink innerHeight along with the visual viewport,
      // leaving bottomInset at zero. Retain the pre-focus height through blur
      // until the keyboard has finished closing.
      const keyboardVisible = bottomInset > 80 || ((focused || wasKeyboardVisible) && restingHeight - height > 80);
      if (!keyboardVisible && (!focused || height > restingHeight)) restingHeight = height;
      wasKeyboardVisible = keyboardVisible;
      setFrame((current) => current.height === height
        && current.offsetTop === offsetTop
        && current.pageTop === pageTop
        && current.bottomInset === bottomInset
        && current.keyboardVisible === keyboardVisible
        ? current
        : { bottomInset, height, keyboardVisible, offsetTop, pageTop });
    };
    const orientationChanged = () => { restingHeight = viewport.height; wasKeyboardVisible = false; update(); };

    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update);
    window.addEventListener('focusin', update);
    window.addEventListener('focusout', update);
    window.addEventListener('orientationchange', orientationChanged);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update);
      window.removeEventListener('focusin', update);
      window.removeEventListener('focusout', update);
      window.removeEventListener('orientationchange', orientationChanged);
    };
  }, [isActive]);

  return frame;
}
