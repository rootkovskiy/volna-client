import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { ImagePlus, ListChecks, Music2, Settings, X } from 'lucide-react-native';
import { AppImage } from '../components/AppImage';
import { PostCard, PostCommentCard, PostPollCard, PostActionsPopover, QuotedPostCard } from '../components/PostFeed';
import { EventCard } from '../screens/EventScreens';
import { styles as s } from '../styles';
import type { AppPost, PostComment, ProfileEvent } from '../types';
import { Action, Stack, Label, Row, covers, noop, type DemoProps, type Specimen } from './demo-shared';

const author = { id: 'ui-kit-author', entityType: 'account' as const, name: 'Алекс', username: 'example', avatarUrl: null, isVerified: true };
const post: AppPost = {
  id: 'ui-kit-post', text: 'В субботу слушаем пластинки, обсуждаем музыку и знакомимся. @example собирает подборку для вечера.', author,
  images: [], trackId: null, trackProvider: null, trackTitle: null, trackArtist: null, trackAlbum: null, trackArtworkUrl: null,
  trackPreviewUrl: null, trackExternalUrl: null, trackStartSeconds: 0, trackClipDurationSeconds: 30, trackPreviewDurationSeconds: 30,
  soundcloudMusicUrl: null, bandcampMusicUrl: null, bandcampMusicEmbedUrl: null, spotifyMusicUrl: null, spotifyMusicEmbedUrl: null,
  spotifyMusicType: null, youtubeVideoId: null, youtubeStartSeconds: 0, audioReleaseId: null, audioRelease: null, musicAttachments: [],
  telegramEmbed: null, telegramAttachment: null, likesCount: 12, repostsCount: 2, sharesCount: 1, commentsCount: 3,
  interactionAudience: 'EVERYONE', canReply: true, canRepost: true, viewerLiked: false, isDeleted: false, canDelete: true,
  originalPost: null, poll: null, createdAt: '2026-09-16T12:00:00Z',
};
const event: ProfileEvent = {
  id: 'ui-kit-event', organizerPageId: null, organizerPage: null, title: 'Вечер независимой музыки', type: 'PARTY', typeLabel: 'Вечеринка',
  startsAt: '2030-09-21T17:00:00Z', endsAt: '2030-09-22T02:00:00Z', about: 'Музыка, встречи и новые знакомства.',
  countryName: 'Россия', cityName: 'Москва', venueName: 'Студия', venuePageId: null, venueUsername: null, venueAddress: 'Примерный переулок, 1',
  posterUrl: covers[0], goingCount: 24, watchingCount: 18, myParticipationStatus: null,
};
function Publication({ notify, images = false, thread = false }: DemoProps & { images?: boolean; thread?: boolean }) {
  const [liked, setLiked] = useState(false);
  const [publishedAt] = useState(() => new Date(Date.now() - 42_000).toISOString());
  const open = async () => notify('В приложении открывается страница автора');
  return <PostCard compact={!thread} thread={thread} post={{ ...post, createdAt: publishedAt, viewerLiked: liked, likesCount: 12 + Number(liked), images: images ? covers.map((imageUrl, position) => ({ id: `image-${position}`, imageKey: '', imageUrl, position })) : [] }} onLike={() => setLiked(!liked)} onComment={() => notify('Обсуждение публикации')} onOpenActions={() => notify('Действия с публикацией — отдельный образец ниже')} onOpenPost={open} onOpenProfile={open} onOpenPublicPage={open} onPollVote={noop} onRepost={() => notify('Открывается редактор репоста')} onSend={() => notify('Открывается выбор получателя')} />;
}
function Comments({ notify }: DemoProps) {
  const [liked, setLiked] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const comment: PostComment = { id: 'ui-kit-comment', postId: post.id, parentId: null, replyToUsername: null, text: 'Буду! Можно принести свои пластинки?', imageKey: null, imageUrl: null, youtubeVideoId: null, youtubeStartSeconds: 0, musicAttachments: [], author, likesCount: Number(liked), repliesCount: 1, viewerLiked: liked, canDelete: true, isDeleted: deleted, createdAt: post.createdAt, updatedAt: post.createdAt };
  const callbacks = { onDelete: () => setDeleted(true), onLike: () => setLiked(!liked), onOpenProfile: async () => notify('Профиль автора'), onOpenPublicPage: async () => notify('Страница сообщества'), onReply: () => notify('Ответ с упоминанием автора') };
  return <Stack><PostCommentCard comment={comment} {...callbacks} /><PostCommentCard comment={{ ...comment, id: 'reply', parentId: comment.id, replyToUsername: author.username, text: 'Конечно, приносите!', canDelete: false, isDeleted: false }} {...callbacks} />{deleted ? <Action secondary onPress={() => setDeleted(false)}>Сбросить пример</Action> : null}</Stack>;
}
function Poll() {
  const [selected, setSelected] = useState<string[]>([]);
  const [multiple, setMultiple] = useState(false);
  return <Stack><PostPollCard poll={{ id: 'ui-kit-poll', question: 'Что будем слушать?', isAnonymous: true, allowsMultiple: multiple, totalVoters: 8 + Number(selected.length > 0), viewerOptionIds: selected, options: ['House', 'Ambient', 'Jazz'].map((text, i) => ({ id: text, text, position: i, votesCount: [4, 3, 1][i] + Number(selected.includes(text)) })) }} onVote={id => setSelected(multiple ? selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id] : [id])} /><Action secondary onPress={() => { setMultiple(!multiple); setSelected([]); }}>{multiple ? 'Один ответ' : 'Несколько ответов'}</Action></Stack>;
}
function PostMenu({ notify }: DemoProps) {
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const [reasons, setReasons] = useState(false);
  return <><Pressable accessibilityRole="button" onPress={e => { setAnchor({ x: e.nativeEvent.pageX, y: e.nativeEvent.pageY }); setReasons(false); }} style={s.primaryAuthButton}><Text style={s.primaryAuthText}>Действия с публикацией</Text></Pressable><PostActionsPopover anchor={anchor ?? { x: 20, y: 100 }} canDelete isVisible={!!anchor} onClose={() => setAnchor(null)} onDelete={() => { setAnchor(null); notify('Пример удаления'); }} onReport={() => { setAnchor(null); notify('Пример жалобы'); }} onShowReasons={() => setReasons(true)} showReasons={reasons} /></>;
}
function Composer() {
  const [text, setText] = useState(''); const [images, setImages] = useState(false); const [error, setError] = useState(false);
  return <Stack><View style={s.postComposeHeader}><Pressable accessibilityRole="button" onPress={() => { setText(''); setImages(false); setError(false); }} style={s.postComposeCancel}><Text style={s.postComposeCancelText}>Отмена</Text></Pressable><Pressable accessibilityRole="button" disabled={!text && !images} onPress={() => setError(true)} style={[s.postComposePublish, !text && !images && s.postComposePublishDisabled]}><Text style={s.postComposePublishText}>Опубликовать</Text></Pressable></View>{error ? <Text style={s.postError}>Пример ошибки публикации. Черновик сохранён в этом образце.</Text> : null}<View style={s.postComposeAuthorHeader}><View style={s.postComposeAuthorAvatar}><Text style={s.postComposeAuthorInitial}>А</Text></View><View style={s.postComposeAuthorBody}><Text style={s.postAuthorName}>Алекс</Text><Text style={s.postAuthorUsername}>@example</Text></View></View><TextInput accessibilityLabel="Текст демонстрационной публикации" multiline maxLength={280} placeholder="Что нового?" value={text} onChangeText={setText} style={s.postComposeInput} />{images ? <View style={s.postComposerImages}>{covers.slice(0, 2).map(uri => <View key={uri} style={s.postComposerImageWrap}><AppImage source={{ uri }} style={s.postComposerImage} /></View>)}</View> : null}<View style={s.postComposeToolbar}>{[ImagePlus, Music2, ListChecks, Settings].map((Icon, i) => <Pressable key={i} accessibilityRole="button" accessibilityLabel={['Пример фотографий', 'Музыка', 'Опрос', 'Настройки публикации'][i]} onPress={() => i === 0 ? setImages(!images) : setError(true)} style={s.postComposeTool}><Icon color="#111" size={23} /></Pressable>)}<Text style={s.postComposeCounter}>{text.length}/280 · {images ? 2 : 0}/5</Text></View></Stack>;
}
function EventExample({ notify, past = false, compact = false }: DemoProps & { past?: boolean; compact?: boolean }) {
  const [participation, setParticipation] = useState<ProfileEvent['myParticipationStatus']>(null);
  return <EventCard compactList={compact} event={{ ...event, myParticipationStatus: participation, ...(past ? { posterUrl: null, startsAt: '2020-01-01T17:00:00Z', endsAt: '2020-01-01T22:00:00Z' } : {}) }} onOpen={() => notify('Страница события')} onSetParticipation={value => setParticipation(current => current === value ? null : value)} />;
}
export const contentSpecimens: Specimen[] = [
  { id: 'post', category: 'Лента', title: 'Публикация', description: 'Автор, время публикации в секундах с переходом к минутам, счётчики веса 500 и активный лайк.', source: 'PostFeed / PostCard', render: p => <Publication {...p} /> },
  { id: 'post-images', category: 'Лента', title: 'Фотографии публикации', description: 'Карусель и полноэкранный просмотр локальных изображений.', source: 'PostCard / PostImageCarousel', render: p => <Publication {...p} images /> },
  { id: 'post-thread', category: 'Лента', title: 'Обсуждение и ответы', description: 'Крупный автор публикации, вложенные ответы, лайк и удалённый ответ.', source: 'PostCard / PostCommentCard', render: p => <Stack><Publication {...p} thread /><Comments {...p} /></Stack> },
  { id: 'post-poll', category: 'Лента', title: 'Опрос', description: 'Один или несколько ответов, проценты и выбранный вариант.', source: 'PostPollCard', render: () => <Poll /> },
  { id: 'post-quote', category: 'Лента', title: 'Цитата и удалённая публикация', description: 'Возраст исходного поста вместо даты; удалённый оригинал без метаданных.', source: 'QuotedPostCard', render: p => <Stack>{[post, { id: 'deleted', isDeleted: true as const, createdAt: post.createdAt }].map(item => <QuotedPostCard key={item.id} post={item} onOpenProfile={async () => p.notify('Профиль')} onOpenPublicPage={async () => p.notify('Сообщество')} />)}</Stack> },
  { id: 'post-composer', category: 'Лента', title: 'Редактор публикации', description: 'Композиция общих стилей: текст, вложения, счётчики, недоступная кнопка и ошибка с сохранённым черновиком.', source: 'styles.postCompose* / PostFeed', render: () => <Composer /> },
  { id: 'post-actions', category: 'Лента', title: 'Меню публикации и жалоба', description: 'Меню у точки нажатия, удаление и причины жалобы.', source: 'PostActionsPopover', render: p => <PostMenu {...p} /> },
  { id: 'event-card', category: 'События', title: 'Карточка события', description: 'Афиша, дата, место, участники, «Пойду» и отслеживание.', source: 'EventCard / EventPoster / EventCounters', render: p => <EventExample {...p} /> },
  { id: 'event-compact', category: 'События', title: 'Компактное событие', description: 'Список событий в профиле или сообществе.', source: 'EventCard compactList', render: p => <EventExample {...p} compact /> },
  { id: 'event-past', category: 'События', title: 'Прошедшее событие', description: 'Недоступные действия участия и заглушка без афиши.', source: 'EventCard / EventPoster', render: p => <EventExample {...p} past /> },
];
