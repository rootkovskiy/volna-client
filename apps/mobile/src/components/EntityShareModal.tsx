import { MessagingShareTargets } from '@volna/messaging-client/react-native-messages';
import type { MessagingAttachment } from '@volna/messaging-client/messaging-surface-controller';
import { Check, ChevronDown, ExternalLink, MessageSquare, Repeat2 } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Share as NativeShare, Text, TextInput, View } from 'react-native';
import { AppImage as Image } from './AppImage';
import { apiFetch as fetch, apiUrl, readApiError } from '../api/client';
import { messagingSurfaceController } from '../messaging/secureMessaging';
import { styles } from '../styles';
import type { PublicPage, ToastMessage } from '../types';
import { AppSheetModal } from './AppSheetModal';

type RepostConfig = {
  previewTitle: string;
  previewMeta: string;
};

type RepostDestination = { type: 'account' } | { type: 'community'; username: string };

export function EntityShareModal({
  authToken,
  isVisible,
  onClose,
  onNotify,
  repost,
  shareText,
  shareTitle,
  shareUrl,
  subjectLabel,
  chatEventId,
  chatAccountId,
  chatPublicPageId,
  chatPostId,
  chatSnapshot,
  onChatSent,
}: {
  authToken: string;
  isVisible: boolean;
  onClose: () => void;
  onNotify: (message: string, type?: ToastMessage['type']) => void;
  repost?: RepostConfig;
  shareText: string;
  shareTitle: string;
  shareUrl: string;
  subjectLabel: string;
  chatEventId?: string;
  chatAccountId?: string;
  chatPublicPageId?: string;
  chatPostId?: string;
  chatSnapshot?: Record<string, string | boolean | null | undefined>;
  onChatSent?: (sharesCount: number) => void;
}) {
  const [mode, setMode] = useState<'actions' | 'chat' | 'repost'>('actions');
  const [comment, setComment] = useState('');
  const [isWorking, setIsWorking] = useState(false);
  const [ownedPages, setOwnedPages] = useState<PublicPage[]>([]);
  const [accountAuthor, setAccountAuthor] = useState<{ avatarUrl: string | null; name: string } | null>(null);
  const [repostDestination, setRepostDestination] = useState<RepostDestination>({ type: 'account' });
  const [isDestinationOpen, setIsDestinationOpen] = useState(false);

  useEffect(() => {
    if (!isVisible || mode !== 'repost') return;
    let active = true;
    void Promise.all([
      fetch(`${apiUrl}/public-pages/owned/mine`, { headers: { Authorization: `Bearer ${authToken}` } }).then(async (response) => response.ok ? response.json() as Promise<PublicPage[]> : []),
      fetch(`${apiUrl}/auth/me`, { headers: { Authorization: `Bearer ${authToken}` } }).then(async (response): Promise<{ account?: { avatarUrl?: string | null; name?: string } }> => response.ok ? response.json() : {}),
    ]).then(([pages, me]) => {
      if (!active) return;
      setOwnedPages(pages);
      setAccountAuthor(me.account?.name ? { avatarUrl: me.account.avatarUrl ?? null, name: me.account.name } : null);
    }).catch(() => {
      if (!active) return;
      setOwnedPages([]);
      setAccountAuthor(null);
    });
    return () => { active = false; };
  }, [authToken, isVisible, mode]);

  useEffect(() => {
    if (!isVisible) {
      setMode('actions');
      setComment('');
      setOwnedPages([]);
      setRepostDestination({ type: 'account' });
      setIsDestinationOpen(false);
    }
  }, [isVisible]);

  const chatAttachment: MessagingAttachment | undefined = chatEventId
    ? { kind: 'entity', entityType: 'event', id: chatEventId, snapshot: chatSnapshot ?? { title: shareTitle } }
    : chatAccountId
      ? { kind: 'entity', entityType: 'account', id: chatAccountId, snapshot: chatSnapshot ?? { name: shareTitle } }
      : chatPublicPageId
        ? { kind: 'entity', entityType: 'publicPage', id: chatPublicPageId, snapshot: chatSnapshot ?? { name: shareTitle } }
        : undefined;

  const handleChatSent = (username: string) => {
    if (chatPostId) {
      void fetch(`${apiUrl}/posts/${encodeURIComponent(chatPostId)}/share`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
      }).then(async (response) => {
        if (!response.ok) return;
        const count = await response.json() as { sharesCount?: number };
        if (typeof count.sharesCount === 'number') onChatSent?.(count.sharesCount);
      }).catch(() => undefined);
    }
    onClose();
    onNotify(`${subjectLabel} отправлен @${username}`);
  };

  const publishRepost = async () => {
    if (!repost) return;
    setIsWorking(true);
    try {
      const response = await fetch(`${apiUrl}/posts`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          authorType: repostDestination.type,
          authorUsername: repostDestination.type === 'community' ? repostDestination.username : undefined,
          text: [comment.trim(), shareText].filter(Boolean).join('\n\n'),
          imageKeys: [],
        }),
      });
      if (!response.ok) throw new Error(await readApiError(response, 'Не удалось сделать репост'));
      onClose();
      const destinationPage = repostDestination.type === 'community' ? ownedPages.find((page) => page.username === repostDestination.username) : null;
      onNotify(destinationPage ? `Репост опубликован в сообществе «${destinationPage.name}»` : 'Репост опубликован в личном профиле');
    } catch (error) {
      onNotify(error instanceof Error ? error.message : 'Не удалось сделать репост', 'error');
    } finally {
      setIsWorking(false);
    }
  };

  return <AppSheetModal
    isVisible={isVisible}
    onClose={onClose}
    title={mode === 'chat' ? 'Отправить в чат' : mode === 'repost' ? `Репост: ${shareTitle}` : 'Поделиться'}
  >
        {mode === 'actions' ? <>
          <Pressable onPress={() => setMode('chat')} style={[styles.safetyAction, styles.eventShareAction]}><MessageSquare color="#111" size={20} /><Text style={styles.safetyActionText}>Отправить в личный чат</Text></Pressable>
          {repost ? <Pressable onPress={() => setMode('repost')} style={[styles.safetyAction, styles.eventShareAction]}><Repeat2 color="#111" size={20} /><Text style={styles.safetyActionText}>Репостнуть</Text></Pressable> : null}
          <Pressable onPress={() => void NativeShare.share({ title: shareTitle, message: shareText, url: shareUrl })} style={[styles.safetyAction, styles.eventShareAction]}><ExternalLink color="#111" size={20} /><Text style={styles.safetyActionText}>Другие приложения</Text></Pressable>
        </> : null}
        {mode === 'chat' ? <MessagingShareTargets
          controller={messagingSurfaceController}
          draft={chatAttachment ? { attachment: chatAttachment } : { text: shareText }}
          enabled={isVisible}
          onError={(message) => onNotify(message, 'error')}
          onSent={handleChatSent}
        /> : null}
        {mode === 'repost' && repost ? <>
          {ownedPages.length ? <View style={styles.entityRepostDestination}>
            <Text style={styles.postRepostDestinationLabel}>Опубликовать от имени</Text>
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: isDestinationOpen }} onPress={() => setIsDestinationOpen((value) => !value)} style={[styles.postRepostDestinationInput, styles.entityRepostDestinationInput]}>
              {repostDestination.type === 'account' ? accountAuthor?.avatarUrl ? <Image source={{ uri: accountAuthor.avatarUrl }} style={styles.postRepostDestinationAvatar} /> : <View style={styles.postRepostDestinationIcon}><Text style={styles.postRepostDestinationInitial}>{accountAuthor?.name.slice(0, 1) ?? '?'}</Text></View> : ownedPages.find((page) => page.username === repostDestination.username)?.avatarUrl ? <Image source={{ uri: ownedPages.find((page) => page.username === repostDestination.username)!.avatarUrl! }} style={styles.postRepostDestinationAvatar} /> : <View style={styles.postRepostDestinationIcon}><Text style={styles.postRepostDestinationInitial}>{ownedPages.find((page) => page.username === repostDestination.username)?.name.slice(0, 1) ?? '?'}</Text></View>}
              <View style={styles.entityRepostDestinationCopy}><Text numberOfLines={1} style={styles.postRepostDestinationName}>{repostDestination.type === 'account' ? 'Личный профиль' : ownedPages.find((page) => page.username === repostDestination.username)?.name}</Text>{repostDestination.type === 'community' ? <Text numberOfLines={1} style={styles.postRepostDestinationUsername}>@{repostDestination.username}</Text> : null}</View>
              <ChevronDown color="#6f7b86" size={20} strokeWidth={1.9} />
            </Pressable>
            {isDestinationOpen ? <ScrollView style={styles.entityRepostDestinationOptions}>
              <Pressable onPress={() => { setRepostDestination({ type: 'account' }); setIsDestinationOpen(false); }} style={styles.postRepostDestinationOption}>{accountAuthor?.avatarUrl ? <Image source={{ uri: accountAuthor.avatarUrl }} style={styles.postRepostDestinationAvatar} /> : <View style={styles.postRepostDestinationIcon}><Text style={styles.postRepostDestinationInitial}>{accountAuthor?.name.slice(0, 1) ?? '?'}</Text></View>}<Text style={styles.entityRepostDestinationCopy}>Личный профиль</Text>{repostDestination.type === 'account' ? <Check color="#198f45" size={20} strokeWidth={2.2} /> : null}</Pressable>
              {ownedPages.map((page) => <Pressable key={page.id} onPress={() => { setRepostDestination({ type: 'community', username: page.username }); setIsDestinationOpen(false); }} style={styles.postRepostDestinationOption}>{page.avatarUrl ? <Image source={{ uri: page.avatarUrl }} style={styles.postRepostDestinationAvatar} /> : <View style={styles.postRepostDestinationIcon}><Text style={styles.postRepostDestinationInitial}>{page.name.slice(0, 1)}</Text></View>}<View style={styles.entityRepostDestinationCopy}><Text numberOfLines={1} style={styles.postRepostDestinationOptionText}>{page.name}</Text><Text numberOfLines={1} style={styles.postRepostDestinationUsername}>@{page.username}</Text></View>{repostDestination.type === 'community' && repostDestination.username === page.username ? <Check color="#198f45" size={20} strokeWidth={2.2} /> : null}</Pressable>)}
            </ScrollView> : null}
          </View> : null}
          <TextInput maxLength={280} multiline onChangeText={setComment} placeholder="Добавить комментарий" placeholderTextColor="#8e99a4" style={styles.eventShareComment} value={comment} />
          <Text style={styles.entityRepostCounter}>{comment.length}/280</Text>
          <View style={styles.eventSharePreview}><Text style={styles.eventSharePreviewTitle}>{repost.previewTitle}</Text><Text style={styles.eventSharePreviewMeta}>{repost.previewMeta}</Text></View>
          <Pressable disabled={isWorking} onPress={() => void publishRepost()} style={styles.eventShareSubmit}><Text style={styles.eventShareSubmitText}>{isWorking ? 'Публикуем…' : 'Репостнуть'}</Text></Pressable>
        </> : null}
  </AppSheetModal>;
}
