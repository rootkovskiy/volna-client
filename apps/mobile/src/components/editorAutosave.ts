export type AutosaveStatus = 'saved' | 'saving' | 'pending' | 'error';
export type EditorSave = () => Promise<boolean>;

/** One writer, with the latest committed draft replacing obsolete queued edits. */
export function createEditorAutosave(initialKey: string, onStatus: (status: AutosaveStatus) => void, delay = 800) {
  let key = initialKey, savedKey = initialKey;
  let save: EditorSave = async () => false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let flight: Promise<boolean> | null = null;
  let active = true;
  let status: AutosaveStatus = 'saved';
  const publish = (value: AutosaveStatus) => { status = value; if (active) onStatus(value); };
  const cancelTimer = () => { clearTimeout(timer); timer = undefined; };
  const flush = (): Promise<boolean> => {
    cancelTimer();
    if (!active) return Promise.resolve(false);
    if (flight) return flight;
    if (key === savedKey) { publish('saved'); return Promise.resolve(true); }
    // Defer the writer until flight has been assigned, including synchronous validation failures.
    flight = Promise.resolve().then(async () => {
      while (active && key !== savedKey) {
        const attemptKey = key, attemptSave = save;
        publish('saving');
        try {
          if (!await attemptSave()) { publish('pending'); return false; }
        } catch { publish('error'); return false; }
        if (!active) return false;
        savedKey = attemptKey;
        // Uploaded media normalization and parent server responses must commit before the next snapshot.
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
      if (!active) return false;
      publish('saved');
      return true;
    }).finally(() => { flight = null; });
    return flight;
  };
  return {
    update(nextKey: string, nextSave: EditorSave, readinessChanged = false) {
      save = nextSave;
      if (nextKey === key && !readinessChanged) return;
      key = nextKey;
      cancelTimer();
      if (flight) { publish('saving'); return; }
      publish(key === savedKey ? 'saved' : 'pending');
      if (active && key !== savedKey) timer = setTimeout(() => { void flush(); }, delay);
    },
    flush,
    isDirty: () => key !== savedKey || flight !== null,
    status: () => status,
    activate() { active = true; },
    dispose() { active = false; cancelTimer(); },
  };
}

export function createEditorNavigationGuard() {
  let blocker: (() => Promise<boolean>) | null = null;
  let navigating = false;
  return {
    hasEditor: () => blocker !== null,
    register(next: () => Promise<boolean>) {
      blocker = next;
      return () => { if (blocker === next) blocker = null; };
    },
    async run(action: () => void | Promise<void>) {
      if (!blocker) { await action(); return; }
      if (navigating) return;
      navigating = true;
      const owner = blocker;
      try {
        if (!await owner()) return;
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        if (blocker !== owner) return; // Logout, account change or forced unmount won.
        await action();
      } finally { navigating = false; }
    },
  };
}
