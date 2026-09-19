import { createContext, useCallback, useContext, useRef, useState, useLayoutEffect, type ReactNode, type Dispatch, type SetStateAction } from 'react';
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

// Session memory only. Never holds hydrated entities, media, credentials or chat content.
const Context = createContext<Map<string, unknown> | null>(null);
export function ScreenContinuityProvider({ children }: { children: ReactNode }) {
  const values = useRef(new Map<string, unknown>()).current;
  return <Context.Provider value={values}>{children}</Context.Provider>;
}
function remember(values: Map<string, unknown> | null, key: string, value: unknown) {
  if (!values) return;
  values.delete(key);
  values.set(key, value);
  if (values.size > 80) values.delete(values.keys().next().value!);
}
export function useScreenChoice<T>(key: string, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const values = useContext(Context);
  const read = () => values?.has(key) ? values.get(key) as T : typeof initial === 'function' ? (initial as () => T)() : initial;
  const [state, setState] = useState(() => ({ key, value: read() }));
  const value = state.key === key ? state.value : read();
  if (state.key !== key) setState({ key, value });
  useLayoutEffect(() => remember(values, key, value), [values, key, value]);
  const setValue: Dispatch<SetStateAction<T>> = useCallback(update => setState(current => ({ key, value: typeof update === 'function' ? (update as (previous: T) => T)(current.key === key ? current.value : read()) : update })), [key, values]);
  return [value, setValue];
}
type ScrollTarget = { scrollTo?: (options: { y: number; animated: boolean }) => void; scrollToOffset?: (options: { offset: number; animated: boolean }) => void };
export function useScreenScroll(key: string, options: { loading?: boolean; canLoadMore?: boolean; loadMore?: () => void } = {}) {
  const values = useContext(Context);
  const ref = useRef<ScrollTarget | null>(null);
  const saved = useRef({ key, target: Number(values?.get(key) ?? 0), restoring: true, viewport: 0, height: 0, requestedHeight: -1 });
  if (saved.current.key !== key) saved.current = { key, target: Number(values?.get(key) ?? 0), restoring: true, viewport: 0, height: 0, requestedHeight: -1 };
  const restore = () => {
    const state = saved.current;
    if (!state.restoring || !ref.current || !state.viewport || !state.height || options.loading) return;
    const max = Math.max(0, state.height - state.viewport);
    const y = Math.min(state.target, max);
    ref.current.scrollTo?.({ y, animated: false });
    ref.current.scrollToOffset?.({ offset: y, animated: false });
    if (max >= state.target) { state.restoring = false; return; }
    if (options.canLoadMore && state.requestedHeight !== state.height) {
      state.requestedHeight = state.height;
      options.loadMore?.();
    }
  };
  useLayoutEffect(restore, [key, options.loading, options.canLoadMore]);
  return {
    ref: (node: ScrollTarget | null) => { ref.current = node; },
    onLayout: (event: LayoutChangeEvent) => { saved.current.viewport = event.nativeEvent.layout.height; restore(); },
    onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, layoutMeasurement } = event.nativeEvent;
      saved.current.viewport = layoutMeasurement.height;
      if (!saved.current.restoring) remember(values, key, contentOffset.y);
    },
    onScrollBeginDrag: () => { saved.current.restoring = false; },
    onContentSizeChange: (_width: number, height: number) => {
      saved.current.height = height;
      restore();
    },
  };
}
