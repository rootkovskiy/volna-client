import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { createCatalogPaginationTrigger, type CatalogPaginationState } from './catalogPagination';

export function useCatalogPagination(state: CatalogPaginationState & { resetKey: string; onLoadMore: () => void | boolean }) {
  const trigger = useRef(createCatalogPaginationTrigger());
  const current = useRef(state);
  const frame = useRef<number | null>(null);
  const cancel = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  }, []);
  const check = useCallback(() => {
    if (frame.current !== null) return;
    // Let the appended rows and footer commit their new dimensions first.
    frame.current = requestAnimationFrame(() => {
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        if (trigger.current.take(current.current) && current.current.onLoadMore() === false) trigger.current.release();
      });
    });
  }, []);
  useLayoutEffect(() => { trigger.current.reset(); }, [state.resetKey]);
  useLayoutEffect(() => { current.current = state; });
  useEffect(() => { check(); return cancel; }, [check, cancel, state.cursor, state.loading, state.enabled, state.error, state.rowCount, state.resetKey]);
  return {
    onLayout: useCallback((event: LayoutChangeEvent) => { trigger.current.layout(event.nativeEvent.layout.height); check(); }, [check]),
    onContentSizeChange: useCallback((_width: number, height: number) => { trigger.current.content(height); check(); }, [check]),
    onScroll: useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, layoutMeasurement, contentSize } = event.nativeEvent;
      trigger.current.scroll(contentOffset.y, layoutMeasurement.height, contentSize.height); check();
    }, [check]),
    onEndReached: check,
    continue: useCallback(() => { trigger.current.continue(); current.current.onLoadMore(); }, []),
  };
}
