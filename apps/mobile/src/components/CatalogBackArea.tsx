import type { ReactNode } from 'react';
import { DrawerDismissArea } from './DrawerDismissArea';

/** Same action as the visible Back arrow; no route animation or new history. */
export function CatalogBackArea({ routeKey, enabled = true, onBack, children }: {
  routeKey: string | null;
  enabled?: boolean;
  onBack: () => void;
  children: ReactNode;
}) {
  return <DrawerDismissArea enabled={enabled && routeKey !== null} gestureKey={routeKey} onDismiss={onBack} style={{ flex: 1, minHeight: 0 }}>{children}</DrawerDismissArea>;
}
