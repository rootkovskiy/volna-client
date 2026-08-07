import { Search } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { AppImage as Image } from './AppImage';
import { apiFetch, apiUrl, remoteSearchDebounceMs } from '../api/client';
import { getAvatarInitial } from '../domain';
import type { CursorPage } from '../types';
import { styles } from '../styles';
import { AppSheetModal } from './AppSheetModal';
import { VerifiedName } from './VerifiedBadge';

type FollowAccount = { id: string; username: string; name: string; avatarUrl: string | null; isVerified?: boolean };
type FollowPage = CursorPage<FollowAccount> & { totalCount?: number };

export type FollowListTab = { endpoint: string; key: string; label: string };

export function MutualFollowersSummary({ endpoint, onPress }: { endpoint: string; onPress: () => void }) {
  const [items, setItems] = useState<FollowAccount[]>([]);
  const [totalCount, setTotalCount] = useState(0);

  useEffect(() => {
    let active = true;
    void apiFetch(`${apiUrl}${endpoint}?pageSize=3`)
      .then(async (response) => response.ok ? response.json() as Promise<FollowPage> : null)
      .then((result) => { if (active && result) { setItems(result.items); setTotalCount(result.totalCount ?? result.items.length); } })
      .catch(() => { if (active) { setItems([]); setTotalCount(0); } });
    return () => { active = false; };
  }, [endpoint]);

  if (!totalCount || !items.length) return null;
  const preview = items.slice(0, 2).map((account) => `@${account.username}`).join(', ');
  const remaining = Math.max(0, totalCount - Math.min(2, items.length));

  return (
    <Pressable accessibilityLabel={`Общие подписки: ${totalCount}`} accessibilityRole="button" onPress={onPress} style={styles.mutualFollowersSummary}>
      <View style={styles.mutualFollowersAvatars}>
        {items.slice(0, 3).map((account, index) => account.avatarUrl ? (
          <Image key={account.id} source={{ uri: account.avatarUrl }} style={[styles.mutualFollowersAvatar, index > 0 && styles.mutualFollowersAvatarOverlap]} />
        ) : (
          <View key={account.id} style={[styles.mutualFollowersAvatar, index > 0 && styles.mutualFollowersAvatarOverlap]}><Text style={styles.mutualFollowersAvatarText}>{getAvatarInitial(account.name)}</Text></View>
        ))}
      </View>
      <Text numberOfLines={2} style={styles.mutualFollowersText}>Подписаны: <Text style={styles.mutualFollowersTextStrong}>{preview}</Text>{remaining ? ` и ещё ${remaining}` : ''}</Text>
    </Pressable>
  );
}

export function FollowListModal({ initialTab, isVisible, onClose, onOpenProfile, tabs, title }: {
  initialTab: string;
  isVisible: boolean;
  onClose: () => void;
  onOpenProfile: (username: string) => Promise<void>;
  tabs: FollowListTab[];
  title: string;
}) {
  const { height: windowHeight } = useWindowDimensions();
  const [activeTab, setActiveTab] = useState(initialTab);
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<FollowAccount[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endpoint = useMemo(() => tabs.find((tab) => tab.key === activeTab)?.endpoint ?? tabs[0]?.endpoint ?? '', [activeTab, tabs]);

  useEffect(() => { if (isVisible) setActiveTab(initialTab); }, [initialTab, isVisible]);
  useEffect(() => {
    if (!isVisible || !endpoint) return;
    let active = true;
    const timer = setTimeout(() => {
      setIsLoading(true); setError(null); setItems([]); setNextCursor(null);
      const search = query.trim() ? `&q=${encodeURIComponent(query.trim())}` : '';
      void apiFetch(`${apiUrl}${endpoint}?pageSize=10${search}`)
        .then(async (response) => { const payload = await response.json() as FollowPage | { message?: string }; if (!response.ok) throw new Error('message' in payload && payload.message ? payload.message : 'Не удалось загрузить список'); return payload as FollowPage; })
        .then((result) => { if (active) { setItems(result.items); setNextCursor(result.nextCursor); } })
        .catch((reason) => { if (active) { setError(reason instanceof Error ? reason.message : 'Не удалось загрузить список'); } })
        .finally(() => { if (active) setIsLoading(false); });
    }, query ? remoteSearchDebounceMs : 0);
    return () => { active = false; clearTimeout(timer); };
  }, [endpoint, isVisible, query]);

  const loadMore = useCallback(() => {
    if (!nextCursor || isLoading || isLoadingMore || !endpoint) return;
    setIsLoadingMore(true);
    const search = query.trim() ? `&q=${encodeURIComponent(query.trim())}` : '';
    void apiFetch(`${apiUrl}${endpoint}?pageSize=10&cursor=${encodeURIComponent(nextCursor)}${search}`)
      .then(async (response) => { if (!response.ok) throw new Error('Не удалось загрузить список'); return response.json() as Promise<FollowPage>; })
      .then((result) => { setItems((current) => [...current, ...result.items.filter((item) => !current.some((existing) => existing.id === item.id))]); setNextCursor(result.nextCursor); })
      .catch(() => undefined)
      .finally(() => setIsLoadingMore(false));
  }, [endpoint, isLoading, isLoadingMore, nextCursor, query]);

  useEffect(() => { if (!isVisible) { setQuery(''); setItems([]); setError(null); setNextCursor(null); } }, [isVisible]);
  const listHeight = isLoading || error || !items.length
    ? 176
    : Math.min(items.length, 6) * 68 + (nextCursor || isLoadingMore ? 34 : 0);
  const sheetBodyHeight = Math.min(560, windowHeight * 0.66, 106 + listHeight);

  return <AppSheetModal contentContainerStyle={[styles.followListSheetContent, { height: sheetBodyHeight }]} isVisible={isVisible} onClose={onClose} title={title}>
      <View accessibilityRole="tablist" style={styles.followListTabs}>{tabs.map((tab) => { const selected = activeTab === tab.key; return <Pressable accessibilityRole="tab" accessibilityState={{ selected }} key={tab.key} onPress={() => { setActiveTab(tab.key); setQuery(''); }} style={[styles.followListTab, selected && styles.followListTabActive]}><Text numberOfLines={1} style={[styles.followListTabText, selected && styles.followListTabTextActive]}>{tab.label}</Text></Pressable>; })}</View>
      <View style={styles.followListSearch}><Search color="#7d8894" size={18} /><TextInput autoCapitalize="none" autoCorrect={false} onChangeText={setQuery} placeholder="Поиск" placeholderTextColor="#8e99a4" style={styles.followListSearchInput} value={query} /></View>
      {isLoading ? <View style={styles.loadingRow}><ActivityIndicator color="#111" /></View> : error ? <View style={styles.emptyProfileTab}><Text style={styles.emptyProfileTabTitle}>{error}</Text></View> : <ScrollView keyboardShouldPersistTaps="handled" onScroll={({ nativeEvent }) => { if (nativeEvent.contentOffset.y + nativeEvent.layoutMeasurement.height >= nativeEvent.contentSize.height - 240) loadMore(); }} scrollEventThrottle={100} showsVerticalScrollIndicator={false} style={styles.followListScroll}>{items.map((account) => <Pressable key={account.id} onPress={() => { onClose(); void onOpenProfile(account.username); }} style={styles.followListRow}>{account.avatarUrl ? <Image source={{ uri: account.avatarUrl }} style={styles.followListAvatar} /> : <View style={styles.followListAvatar}><Text style={styles.followListAvatarText}>{getAvatarInitial(account.name)}</Text></View>}<View style={styles.followListCopy}><VerifiedName isVerified={account.isVerified} name={account.name} style={styles.followListName} /><Text numberOfLines={1} style={styles.followListUsername}>@{account.username}</Text></View></Pressable>)}{isLoadingMore ? <ActivityIndicator color="#111" style={{ marginVertical: 18 }} /> : null}</ScrollView>}
  </AppSheetModal>;
}
