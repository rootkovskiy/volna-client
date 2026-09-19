import { useEffect, useLayoutEffect } from 'react';
import { isAppForeground, subscribeAppActivity } from '@volna/messaging-client/app-activity';
import { connectLocationSync } from './connectLocation';
import { connectLocationForegroundIntervalMs } from './connectLocationSync';

export function useConnectLocationSync(accountId: string | null, token: string, enabled: boolean) {
  // Establish/cancel the account binding before descendant catalog effects run.
  useLayoutEffect(() => {
    connectLocationSync.configure(accountId ? { accountId, token, enabled } : null);
    return () => connectLocationSync.configure(null);
  }, [accountId, token, enabled]);

  useEffect(() => {
    if (!accountId || !enabled) return;
    const onActivity = () => {
      if (isAppForeground()) void connectLocationSync.refresh(accountId);
      else connectLocationSync.cancel();
    };
    const unsubscribe = subscribeAppActivity(onActivity);
    // Long foreground sessions also refresh, without any background GPS task.
    const timer = setInterval(onActivity, connectLocationForegroundIntervalMs);
    onActivity();
    return () => { unsubscribe(); clearInterval(timer); };
  }, [accountId, token, enabled]);
}
