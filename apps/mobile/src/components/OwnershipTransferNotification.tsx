import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { LoadingIndicator } from '@volna/messaging-client/loading';
import { apiFetch, apiUrl, readApiError } from '../api/client';
import { styles } from '../styles';
import { OwnershipTransferStatus, useOwnershipDeadline, type OwnershipTransfer } from './OwnershipTransferStatus';

export function OwnershipTransferNotification({ transfer: initial, onChanged }: { transfer: OwnershipTransfer; onChanged: () => void }) {
  const [transfer, setTransfer] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(true), running = useRef(false);
  useEffect(() => { setTransfer(initial); }, [initial]);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const deadline = useOwnershipDeadline(transfer);
  const accept = async () => {
    if (running.current || !deadline.pending) return;
    running.current = true; setBusy(true); setError(null);
    try {
      const response = await apiFetch(`${apiUrl}/public-pages/ownership-transfers/${encodeURIComponent(transfer.id)}/accept`, { method: 'POST' });
      if (!response.ok) throw new Error(await readApiError(response, 'Не удалось принять владение'));
      const result = await response.json() as { transfer: OwnershipTransfer };
      if (active.current) { setTransfer(result.transfer); onChanged(); }
    } catch (reason) { if (active.current) { setError(reason instanceof Error ? reason.message : 'Не удалось принять владение'); onChanged(); } }
    finally { running.current = false; if (active.current) setBusy(false); }
  };
  return <View style={styles.ownershipTransferActions}>
    <OwnershipTransferStatus transfer={transfer} {...deadline} />
    {deadline.pending ? <Pressable accessibilityRole="button" disabled={busy} onPress={event => { event.stopPropagation(); void accept(); }} style={[styles.publicPageTeamAddButton, busy && styles.disabledButton]}>{busy ? <LoadingIndicator tone="inverse" /> : <Text style={styles.publicPageTeamAddText}>Принять владение</Text>}</Pressable> : null}
    {error ? <Text accessibilityRole="alert" style={styles.ownershipTransferError}>{error}</Text> : null}
  </View>;
}
