import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

/** Geometry only: the caller still owns the authenticated, bounded SDK request. */
export function useChatHistoryPagination(options: {
  enabled: boolean;
  revision: unknown;
  canLoad(): boolean;
  load(): void;
}) {
  const current = useRef(options);
  const metrics = useRef({ viewport: 0, content: -1, offset: 0, armed: false });
  const frame = useRef<number | null>(null);
  const mounted = useRef(false);
  const check = useCallback(() => {
    if (!mounted.current || frame.current !== null) return;
    // Let prepended rows and the reading anchor settle before using geometry.
    frame.current = requestAnimationFrame(() => {
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        const m = metrics.current;
        if (!mounted.current || !current.current.enabled || !current.current.canLoad()
          || m.viewport <= 0 || m.content < 0) return;
        if (m.content <= m.viewport + 1 || (m.armed && m.offset < 80)) current.current.load();
      });
    });
  }, []);
  useLayoutEffect(() => { current.current = options; });
  useEffect(() => {
    mounted.current = true;
    check();
    return () => {
      mounted.current = false;
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, [check]);
  useEffect(check, [check, options.enabled, options.revision]);
  return {
    check,
    isShort: () => metrics.current.viewport > 0 && metrics.current.content >= 0
      && metrics.current.content <= metrics.current.viewport + 1,
    reset: () => { metrics.current = { viewport: 0, content: -1, offset: 0, armed: false }; },
    onLayout: (height: number) => { metrics.current.viewport = height; check(); },
    onContentSizeChange: (height: number) => { metrics.current.content = height; check(); },
    onScroll: (offset: number, content: number, viewport: number) => {
      Object.assign(metrics.current, { offset, content, viewport });
      if (offset > 0) metrics.current.armed = true;
      check();
    },
    restoreOffset: (offset: number) => { metrics.current.offset = offset; check(); },
  };
}
