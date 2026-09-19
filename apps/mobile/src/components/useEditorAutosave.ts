import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { createEditorAutosave, createEditorNavigationGuard, type AutosaveStatus, type EditorSave } from './editorAutosave';

export const EditorNavigationContext = createContext<ReturnType<typeof createEditorNavigationGuard> | null>(null);

/** Uses the latest navigation closure after saving updates the parent's profile/page. */
export function useEditorNavigationAction<Args extends unknown[]>(guard: ReturnType<typeof createEditorNavigationGuard>, action: (...args: Args) => void | Promise<void>) {
  const latest = useRef(action);
  useLayoutEffect(() => { latest.current = action; });
  return useCallback((...args: Args) => guard.run(() => latest.current(...args)), [guard]);
}

export function useEditorAutosave({ scopeKey, draftKey, readinessKey = '', save, onInvalid, lifecycle = true }: {
  scopeKey: string; draftKey: string; readinessKey?: string; save: EditorSave; onInvalid: () => void; lifecycle?: boolean;
}) {
  const [status, setStatus] = useState<AutosaveStatus>('saved');
  const guard = useContext(EditorNavigationContext);
  const coordinator = useMemo(() => createEditorAutosave(draftKey, setStatus), [scopeKey]);
  const readiness = useRef(readinessKey);
  const invalid = useRef(onInvalid);
  useLayoutEffect(() => {
    coordinator.activate();
    return () => coordinator.dispose();
  }, [coordinator]);
  useLayoutEffect(() => {
    invalid.current = onInvalid;
    coordinator.update(draftKey, save, readiness.current !== readinessKey);
    readiness.current = readinessKey;
  });
  const flush = useCallback(async () => {
    const ok = await coordinator.flush();
    if (!ok && coordinator.status() === 'pending') invalid.current();
    return ok;
  }, [coordinator]);
  useLayoutEffect(() => guard?.register(flush), [guard, flush]);
  useEffect(() => {
    if (!lifecycle) return;
    const flushBackground = () => { if (coordinator.isDirty()) void coordinator.flush(); };
    const subscription = AppState.addEventListener('change', state => { if (state !== 'active') flushBackground(); });
    if (Platform.OS !== 'web') return () => subscription.remove();
    const visibility = () => { if (document.visibilityState === 'hidden') flushBackground(); };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!coordinator.isDirty()) return;
      event.preventDefault(); event.returnValue = '';
    };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      subscription.remove();
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [coordinator, lifecycle]);
  return { status, flush };
}
