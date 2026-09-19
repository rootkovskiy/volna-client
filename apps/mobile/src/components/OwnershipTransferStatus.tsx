import { useEffect, useMemo, useState } from 'react';
import { Text } from 'react-native';
import { styles } from '../styles';

export type OwnershipTransfer = {
  id: string;
  status: 'PENDING' | 'ACCEPTED' | 'CANCELLED' | 'EXPIRED';
  expiresAt: string;
  serverNow: string;
  community: { id: string; username: string; name: string };
  fromOwner: { id: string; username: string; name: string };
  toOwner: { id: string; username: string; name: string };
};

// The API remains authoritative. Monotonic elapsed time keeps a local clock change
// from extending the displayed deadline; polling also resynchronizes after sleep.
export function useOwnershipDeadline(transfer: OwnershipTransfer | null) {
  const anchor = useMemo(() => ({ at: performance.now(), remaining: transfer ? Math.max(0, Date.parse(transfer.expiresAt) - Date.parse(transfer.serverNow)) : 0 }), [transfer?.id, transfer?.expiresAt, transfer?.serverNow]);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!transfer || transfer.status !== 'PENDING') return;
    const timer = setInterval(() => setTick(value => value + 1), 1000);
    return () => clearInterval(timer);
  }, [transfer?.id, transfer?.status]);
  void tick;
  const seconds = Math.max(0, Math.ceil((anchor.remaining - (performance.now() - anchor.at)) / 1000));
  const pending = transfer?.status === 'PENDING' && seconds > 0;
  return { pending, label: `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}` };
}

export function OwnershipTransferStatus({ transfer, pending, label }: { transfer: OwnershipTransfer; pending: boolean; label: string }) {
  return <Text style={styles.settingsHint}>{pending ? `Осталось на подтверждение: ${label}` : transfer.status === 'ACCEPTED' ? 'Владение принято' : transfer.status === 'CANCELLED' ? 'Передача отменена' : 'Срок истёк — передача отменена'}</Text>;
}
