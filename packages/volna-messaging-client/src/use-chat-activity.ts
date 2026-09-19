import { useEffect, useRef, useState } from 'react';
import { isAppForeground, subscribeAppActivity } from './app-activity';
import type { MessagingSurfaceController } from './messaging-surface-controller.mjs';
import type { ChatActivity } from './chat-activity.mjs';

// Ephemeral, mounted-chat-only state: never retained with previews or on disk.
export function useChatActivity(controller: MessagingSurfaceController, accountId: string, threadIds: string[], revision: number) {
  const [state, setState] = useState<Record<string, ChatActivity>>({});
  const [clock, setClock] = useState(Date.now());
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const key = [...new Set(threadIds)].sort().join(',');
  useEffect(() => {
    const abort = new AbortController();
    let running = false, again = false;
    const ids = key ? key.split(',') : [];
    setState({});
    const refresh = async () => {
      if (!isAppForeground() || abort.signal.aborted || !ids.length) return;
      if (running) { again = true; return; }
      running = true;
      try {
        do {
          again = false;
          const next: Record<string, ChatActivity> = {};
          for (let start = 0; start < ids.length; start += 100) Object.assign(next,
            await controller.loadChatActivity(accountId, ids.slice(start, start + 100), abort.signal));
          if (!abort.signal.aborted && isAppForeground() && !again) { setState(next); setClock(Date.now()); }
        } while (again && !abort.signal.aborted && isAppForeground());
      } catch { if (!abort.signal.aborted) setState({}); }
      finally { running = false; }
    };
    refreshRef.current = refresh;
    void refresh();
    const interval = setInterval(() => { if (isAppForeground()) { setClock(Date.now()); void refresh(); } }, 30_000);
    const unsubscribe = subscribeAppActivity(() => { if (isAppForeground()) void refresh(); else setState({}); });
    return () => { abort.abort(); clearInterval(interval); unsubscribe(); };
  }, [controller, accountId, key]);
  useEffect(() => { void refreshRef.current(); }, [revision]);
  return { state, clock };
}

