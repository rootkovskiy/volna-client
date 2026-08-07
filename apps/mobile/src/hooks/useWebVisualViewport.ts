import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

export type WebVisualViewportFrame = {
  bottomInset: number;
  height?: number;
  keyboardVisible: boolean;
  offsetTop: number;
};

const initialFrame: WebVisualViewportFrame = { bottomInset: 0, keyboardVisible: false, offsetTop: 0 };

export function useWebVisualViewport(isActive = true) {
  const [frame, setFrame] = useState<WebVisualViewportFrame>(initialFrame);

  useEffect(() => {
    if (Platform.OS !== 'web' || !isActive || typeof window === 'undefined' || !window.visualViewport) {
      setFrame(initialFrame);
      return;
    }

    const viewport = window.visualViewport;
    const update = () => {
      const height = Math.round(viewport.height);
      const offsetTop = Math.max(0, Math.round(viewport.offsetTop));
      const bottomInset = Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop));
      const keyboardVisible = bottomInset > 80;
      setFrame((current) => current.height === height
        && current.offsetTop === offsetTop
        && current.bottomInset === bottomInset
        && current.keyboardVisible === keyboardVisible
        ? current
        : { bottomInset, height, keyboardVisible, offsetTop });
    };

    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    window.addEventListener('orientationchange', update);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
      window.removeEventListener('orientationchange', update);
    };
  }, [isActive]);

  return frame;
}
