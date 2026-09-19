import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { LoadingIndicator } from '@volna/messaging-client/loading';
import { apiFetch, apiUrl, readApiError } from '../api/client';
import { styles } from '../styles';
import { EntityUsernameLookup } from './EntityUsernameLookup';
import { OwnershipTransferStatus, useOwnershipDeadline, type OwnershipTransfer } from './OwnershipTransferStatus';

export function CommunityOwnershipSection({ pageUsername, onChanged, onLostOwnership }: { pageUsername: string; onChanged: () => void | Promise<void>; onLostOwnership: () => void }) {
  const [transfer, setTransfer] = useState<OwnershipTransfer | null>(null);
  const [username, setUsername] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(false), operation = useRef(false), revision = useRef(0);
  const callbacks = useRef({ onChanged, onLostOwnership });
  callbacks.current = { onChanged, onLostOwnership };
  const deadline = useOwnershipDeadline(transfer);
  const url = `${apiUrl}/public-pages/${encodeURIComponent(pageUsername)}/ownership-transfer`;
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const rev = ++revision.current;
    try {
      const response = await apiFetch(url, { signal });
      if (signal?.aborted || !active.current || revision.current !== rev) return;
      if (response.status === 403) { callbacks.current.onLostOwnership(); return; }
      if (!response.ok) throw new Error(await readApiError(response, 'Не удалось проверить передачу владения'));
      const result = await response.json() as { transfer: OwnershipTransfer | null };
      if (active.current && revision.current === rev) setTransfer(result.transfer);
    } catch (reason) { if (active.current && !signal?.aborted && rev === revision.current) setError(reason instanceof Error ? reason.message : 'Не удалось проверить передачу'); }
    finally { if (active.current && rev === revision.current) setLoading(false); }
  }, [url]);
  useEffect(() => {
    active.current = true;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => { if (!operation.current) await refresh(controller.signal); if (active.current) timer = setTimeout(poll, 15_000); };
    void poll();
    return () => { active.current = false; revision.current++; controller.abort(); clearTimeout(timer); };
  }, [refresh]);
  const submit = async (cancel = false) => {
    if (operation.current || (!cancel && (!selected || selected !== username))) return;
    operation.current = true; revision.current++; setBusy(true); setError(null);
    try {
      const response = await apiFetch(cancel ? `${url}/${encodeURIComponent(transfer!.id)}` : url, {
        method: cancel ? 'DELETE' : 'POST', headers: { 'Content-Type': 'application/json' },
        ...(cancel ? {} : { body: JSON.stringify({ username: selected }) }),
      });
      if (!response.ok) throw new Error(await readApiError(response, 'Не удалось изменить передачу владения'));
      const result = await response.json() as { transfer: OwnershipTransfer };
      if (!active.current) return;
      setTransfer(result.transfer); setUsername(''); setSelected(null);
      await callbacks.current.onChanged();
    } catch (reason) { if (active.current) { setError(reason instanceof Error ? reason.message : 'Не удалось изменить передачу'); await refresh(); } }
    finally { operation.current = false; if (active.current) setBusy(false); }
  };
  return <View style={styles.communityCabinetSection}>
    <Text style={[styles.editSectionTitle, styles.communityCabinetSectionTitle]}>Владелец сообщества</Text>
    <View style={[styles.publicPageTeamEditor, styles.communityAdministrationCard]}>
      {loading ? <LoadingIndicator /> : <>
        {transfer ? <><Text style={styles.settingsLabel}>Передача @{transfer.toOwner.username}</Text><OwnershipTransferStatus transfer={transfer} {...deadline} /></> : null}
        {deadline.pending ? <><Text style={styles.settingsHint}>До подтверждения вы остаётесь владельцем.</Text><Pressable accessibilityRole="button" disabled={busy} onPress={() => void submit(true)} style={styles.communityPermissionResetButton}>{busy ? <LoadingIndicator /> : <Text style={styles.communityPermissionResetText}>Отменить передачу</Text>}</Pressable></> : <>
          <Text style={styles.settingsHint}>Выберите новый аккаунт владельца. У него будет 1 час на подтверждение. После принятия вы потеряете управление сообществом. Права остальных администраторов сохранятся.</Text>
          <EntityUsernameLookup entityType="account" isMuted disabled={busy} value={username} placeholder="username нового владельца" onChange={value => { setUsername(value); setSelected(null); }} onSelect={account => setSelected(account.username)} />
          {selected === username && selected ? <Pressable accessibilityRole="button" disabled={busy} onPress={() => void submit()} style={[styles.publicPageTeamAddButton, busy && styles.disabledButton]}>{busy ? <LoadingIndicator tone="inverse" /> : <Text style={styles.publicPageTeamAddText}>Предложить передачу владения</Text>}</Pressable> : null}
        </>}
      </>}
      {error ? <><Text accessibilityRole="alert" style={styles.ownershipTransferError}>{error}</Text><Pressable accessibilityRole="button" disabled={busy} onPress={() => { setError(null); void refresh(); }}><Text style={styles.communityPermissionResetText}>Обновить</Text></Pressable></> : null}
    </View>
  </View>;
}
