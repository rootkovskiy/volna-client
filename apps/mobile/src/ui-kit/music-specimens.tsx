import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link2, Pause, Play, Search } from 'lucide-react-native';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { CatalogPaginationFooter } from '../components/CatalogPaginationFooter';
import { useCatalogPagination } from '../components/useCatalogPagination';
import { AppImage } from '../components/AppImage';
import { BottomNavigation } from '../components/navigation';
import type { AppTab } from '../types';
import { GlobalAudioControlsContext, GlobalAudioProgressContext, GlobalMiniPlayer, ExpandedBottomControls, ExpandedReleaseMetadata, MarqueeTrackTitle, localStyles as playerStyles, type GlobalAudioControlsContextValue, type GlobalTrack } from '../components/GlobalAudioPlayer';
import { MusicDownloadControl } from '../components/MusicDownloadButton';
import { PrimaryTrackPreviewCard } from '../components/PrimaryTrackPreviewCard';
import { PlaylistEditorSurface } from '../components/PlaylistEditorSurface';
import { CompactTrackScrubber } from '../components/CompactTrackScrubber';
import { CompactPlaylistTrackList } from '../components/CompactPlaylistTrackList';
import { styles as s } from '../styles';
import { RadioScheduleList } from '../components/RadioSchedule';
import { Action, Stack, Label, Row, covers, genres, noop, type Specimen, type DemoProps } from './demo-shared';

function Player({ notify, full = false, radio = false, navigation = false, renderEditor }: DemoProps & { full?: boolean; radio?: boolean; navigation?: boolean; renderEditor?: (audio: GlobalAudioControlsContextValue, track: GlobalTrack) => ReactNode }) {
  const [activeTab, setActiveTab] = useState<AppTab>('music');
  const [playing, setPlaying] = useState(false); const [saved, setSaved] = useState(false); const [closed, setClosed] = useState(false);
  const [progress, setProgress] = useState(.35); const [index, setIndex] = useState(0); const [shuffle, setShuffle] = useState(false); const [repeat, setRepeat] = useState(false);
  // The presentation contexts contain no engine, URL, session, persistence or API client.
  const track: GlobalTrack = { id: `ui-kit-${index}`, title: radio ? 'Демонстрационная радиостанция' : ['Ночной маршрут — длинное название композиции', 'Тёплый свет', 'После дождя'][index], artist: radio ? 'Прямой эфир' : 'Демонстрационный исполнитель', artworkUrl: covers[index], previewUrl: '', provider: 'bandcamp', isLiveStream: radio, collectionTitle: 'Демонстрационный альбом', genres, releaseDate: '2026-01-01' };
  const next = async () => { setIndex(i => (i + 1) % 3); setProgress(0); }; const previous = async () => { setIndex(i => (i + 2) % 3); setProgress(0); };
  const audio: GlobalAudioControlsContextValue = {
    activeTrack: closed ? null : track, isExpanded: false, setExpanded: () => notify('Полный плеер показан в отдельном образце'), isPlaying: playing, isAudioLoading: false, soundcloudDiagnostic: null,
    play: async () => setPlaying(true), pause: () => setPlaying(false), close: () => setClosed(true), seek: async value => setProgress(value),
    hasPreviousTrack: !radio, hasNextTrack: !radio, playPrevious: previous, playNext: next, hasPreviousCollection: false, hasNextCollection: false,
    previousCollectionTrack: null, nextCollectionTrack: null, previousCollectionArtworkUrl: null, nextCollectionArtworkUrl: null,
    playPreviousCollection: previous, playNextCollection: next, isShuffleEnabled: shuffle, isRepeatEnabled: repeat, toggleShuffle: () => setShuffle(!shuffle), toggleRepeat: () => setRepeat(!repeat),
    setActiveQueue: noop, primeTrack: noop, canSaveToMyMusic: !radio, isSavedToMyMusic: saved, isSavingToMyMusic: false, toggleMyMusic: async () => setSaved(!saved),
    canSaveRadio: radio, isSavedRadio: saved, isSavingRadio: false, toggleFavoriteRadio: async () => setSaved(!saved), selectOutputDevice: async () => notify('Системный выбор устройства вывода'), openReleaseShare: () => notify('Поделиться релизом'), notify, isTrackPlaying: id => id === track.id && playing,
  };
  return <GlobalAudioControlsContext.Provider value={audio}><GlobalAudioProgressContext.Provider value={{ durationSeconds: radio ? 0 : 240, positionSeconds: radio ? 0 : progress * 240, progress: radio ? 0 : progress }}>{renderEditor ? renderEditor(audio, track) : <Stack>{full ? <View style={{ backgroundColor: '#f3f5f7', padding: 16, gap: 16 }}><AppImage source={{ uri: covers[index] }} style={[playerStyles.expandedArtwork, { width: '100%', aspectRatio: 1 }]} /><View><MarqueeTrackTitle title={track.title} /><Text style={playerStyles.expandedArtist}>{track.artist}</Text><ExpandedReleaseMetadata track={track} /></View><ExpandedBottomControls audio={audio} track={track} /></View> : <View style={{ minHeight: 82 }}><GlobalMiniPlayer placement="inline" hasBottomNavigation={false} /></View>}{navigation ? <BottomNavigation activeTab={activeTab} onChangeTab={setActiveTab} /> : null}{closed ? <Action secondary onPress={() => setClosed(false)}>Вернуть плеер</Action> : null}<Text style={playerStyles.expandedHeaderTrackPositionText}>Управление меняет только пример; звук не воспроизводится.</Text></Stack>}</GlobalAudioProgressContext.Provider></GlobalAudioControlsContext.Provider>;
}
function CatalogPaginationDemo() {
  const [rows, setRows] = useState([0, 1, 2, 3]);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const failNext = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const load = () => {
    if (timer.current || page >= 5) return;
    setLoading(true); setError('');
    timer.current = setTimeout(() => {
      timer.current = null; setLoading(false);
      if (failNext.current) { failNext.current = false; setError('Не удалось загрузить музыку'); return; }
      // One fictional intermediate page has no new rows, just like filtered candidates.
      if (page !== 1) setRows(current => [...current, ...Array.from({ length: 4 }, (_, i) => current.length + i)]);
      setPage(current => current + 1);
    }, 500);
  };
  const pagination = useCatalogPagination({ cursor: page < 5 ? String(page + 1) : null, loading, enabled: true, error: Boolean(error), rowCount: rows.length, resetKey: 'demo', onLoadMore: load });
  return <Stack>
    <Action secondary onPress={() => { failNext.current = true; }}>Ошибка следующей страницы</Action>
    <View style={{ height: 320 }}><FlatList data={rows} keyExtractor={item => String(item)}
      onLayout={pagination.onLayout} onContentSizeChange={pagination.onContentSizeChange} onScroll={pagination.onScroll} onEndReached={pagination.onEndReached} scrollEventThrottle={32}
      renderItem={({ item }) => <View style={s.trackCard}><View style={s.trackCardCopy}><Text style={s.trackCardTitle}>Демонстрационный релиз {item + 1}</Text><Text style={s.trackCardArtist}>Исполнитель · {new Date(Date.UTC(2030, 8, 27 - item)).toLocaleDateString('ru-RU', { timeZone: 'UTC' })}</Text></View></View>}
      ListFooterComponent={<CatalogPaginationFooter loading={loading} error={error} hasMore={page < 5} onContinue={pagination.continue} />} />
    </View>
    <Text style={s.trackCardArtist}>Релизы идут от новых к старым по дате выпуска. Прокрутите список: страницы дополняются автоматически, ошибка сохраняет строки. Данные и задержка демонстрационные, без сетевых запросов.</Text>
  </Stack>;
}
function TrackStates() {
  const [playing, setPlaying] = useState(false); const [position, setPosition] = useState(.25);
  return <Stack><PrimaryTrackPreviewCard title="Главный трек" artist="Демонстрационный исполнитель" artworkUrl={covers[0]} isPlaying={playing} onToggle={() => setPlaying(!playing)}><CompactTrackScrubber progress={position} onChange={setPosition} onChangeEnd={setPosition} /><Text>Старт композиции с {Math.round(position * 240)} с</Text></PrimaryTrackPreviewCard><PrimaryTrackPreviewCard title="Загрузка аудио" artist={null} artworkUrl={null} isLoading /><PrimaryTrackPreviewCard title="Недоступная композиция" artist="Исполнитель" artworkUrl={covers[1]} unavailableLabel="Трек недоступен" /></Stack>;
}
function PrimaryTrackEditorDemo() {
  const [mode, setMode] = useState<'search' | 'link'>('search');
  const [removed, setRemoved] = useState(false);
  const [unavailable, setUnavailable] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(.25);
  const [query, setQuery] = useState('');
  return <Stack>
    <Row><Action secondary onPress={() => { setUnavailable(!unavailable); setPlaying(false); }}>Сменить доступность</Action><Action secondary onPress={() => setRemoved(false)}>Вернуть трек</Action></Row>
    <View>
      {!removed ? <View style={s.primaryTrackSelectedPreview}><PrimaryTrackPreviewCard
        title="Ночной маршрут" artist="Демонстрационный исполнитель" artworkUrl={covers[0]}
        unavailableLabel={unavailable ? 'Трек недоступен' : null} isPlaying={playing}
        onToggle={() => setPlaying(!playing)} onRemove={() => { setRemoved(true); setPlaying(false); }}
      ><CompactTrackScrubber progress={position} onChange={setPosition} onChangeEnd={setPosition} /><Text style={s.primaryTrackFragmentStartLabel}>Старт композиции с {Math.round(position * 240)} с</Text></PrimaryTrackPreviewCard></View> : null}
      <View accessibilityRole="tablist" style={s.primaryTrackModeTabs}>{([{ value: 'search', label: 'Поиск по названию' }, { value: 'link', label: 'Ссылка' }] as const).map(tab => <Pressable key={tab.value} accessibilityRole="tab" accessibilityState={{ selected: mode === tab.value }} aria-selected={mode === tab.value} onPress={() => { setMode(tab.value); setQuery(''); }} style={s.primaryTrackModeTab}><Text style={[s.primaryTrackModeTabText, mode === tab.value && s.primaryTrackModeTabTextActive]}>{tab.label}</Text>{mode === tab.value ? <View style={s.activeTabIndicator} /> : null}</Pressable>)}</View>
      <View style={s.primaryTrackSearchControls}><View style={s.primaryTrackInputGroup}><View style={mode === 'search' ? s.primaryTrackSearchInputRow : s.primaryTrackExternalInputRow}>{mode === 'search' ? <Search color="#6f7b86" size={19} /> : <Link2 color="#6f7b86" size={19} />}<TextInput accessibilityLabel="Выбор главного трека — пример" placeholder={mode === 'search' ? 'Название трека или исполнитель' : 'Ссылка на музыку'} value={query} onChangeText={setQuery} style={s.primaryTrackSearchInput} /></View><Text style={s.primaryTrackInputHint}>Демонстрационный ввод без запроса к музыкальному сервису.</Text></View></View>
    </View>
    <Label>Фрагмент редактора на общих стилях: выбранный трек над вкладками, удаление внутри карточки. Действия меняют только пример.</Label>
  </Stack>;
}
function Downloads({ notify }: DemoProps) {
  const [progress, setProgress] = useState(.42);
  return <Stack><Row><View><MusicDownloadControl onPress={() => notify('Начало скачивания — пример')} /><Label>Доступен</Label></View><View><MusicDownloadControl busy onPress={() => notify('Отмена — пример')} /><Label>Ожидание</Label></View><View><MusicDownloadControl busy progress={progress} onPress={() => setProgress(0)} /><Label>{Math.round(progress * 100)}%</Label></View><View><MusicDownloadControl saved disabled onPress={noop} /><Label>Скачан</Label></View></Row><CompactTrackScrubber progress={progress} onChange={setProgress} onChangeEnd={setProgress} /><Text>На устройстве этот индикатор показывает полученные байты. Здесь положение задаётся вручную.</Text></Stack>;
}
function Queue() {
  const [selected, setSelected] = useState(-1);
  return <CompactPlaylistTrackList itemCount={7}>{Array.from({ length: 7 }, (_, i) => <Pressable key={i} accessibilityRole="button" accessibilityLabel={`${selected === i ? 'Остановить' : 'Прослушать'} трек ${i + 1}`} onPress={() => setSelected(selected === i ? -1 : i)} style={s.bandcampTrackRow}><Text style={s.bandcampTrackNumber}>{i + 1}</Text><Text numberOfLines={1} style={[s.bandcampTrackTitle, selected === i && s.bandcampTrackTitleActive]}>{['Ночной маршрут', 'Тёплый свет', 'После дождя'][i % 3]}</Text></Pressable>)}</CompactPlaylistTrackList>;
}
function PlaylistEditorDemo({ notify }: DemoProps) {
  const [name, setName] = useState('Ночной маршрут');
  const [removed, setRemoved] = useState(false);
  const [error, setError] = useState(false);
  const [customCover, setCustomCover] = useState(true);
  return <Stack><Row><Action secondary onPress={() => setError(!error)}>Ошибка сохранения</Action><Action secondary onPress={() => setRemoved(false)}>Вернуть трек</Action></Row><View style={{ height: 560 }}><Player notify={notify} renderEditor={(audio, track) => <PlaylistEditorSurface
    name={name} onChangeName={setName} artworkUrl={customCover ? covers[0] : null} hasCustomArtwork={customCover}
    onChooseArtwork={() => setCustomCover(true)} onRemoveArtwork={() => setCustomCover(false)}
    error={error ? 'Не удалось сохранить плейлист. Попробуйте ещё раз.' : null}
    onCancel={() => notify('Возврат в плейлист')} onSave={() => error ? notify('Исправьте ошибку и повторите сохранение') : notify('Плейлист сохранён — пример')}
    onDelete={() => notify('В приложении открывается общее окно подтверждения удаления')}
    onRemoveTrack={() => setRemoved(true)}
    tracks={removed ? [] : [{ key: track.id, title: track.title, player: <Pressable accessibilityRole="button" accessibilityLabel={audio.isPlaying ? 'Приостановить трек' : 'Прослушать трек'} onPress={() => audio.isPlaying ? audio.pause() : void audio.play(track)} style={s.trackCard}>
      <AppImage source={{ uri: track.artworkUrl! }} style={s.trackCardArtwork} /><View style={s.trackCardCopy}><Text numberOfLines={1} style={s.trackCardTitle}>{track.title}</Text><Text numberOfLines={1} style={s.trackCardArtist}>{track.artist}</Text></View><View style={s.trackCardIcon}>{audio.isPlaying ? <Pause color="#fff" size={16} /> : <Play color="#fff" size={16} />}</View>
    </Pressable> }]}
    footer={audio.activeTrack ? <GlobalMiniPlayer placement="inline" hasBottomNavigation={false} /> : undefined}
  />} /></View><Label>Общий редактор и мини-плеер; карточка трека — композиция общих стилей. Данные и управление демонстрационные, без звука и сохранения.</Label></Stack>;
}

export const musicSpecimens: Specimen[] = [
  { id: 'music-pagination', category: 'Музыка', title: 'Подгрузка каталога', description: 'Релизы по дате выпуска, продолжение при прокрутке, пустая промежуточная страница и повтор после ошибки.', source: 'useCatalogPagination / CatalogPaginationFooter / styles.trackCard', render: () => <CatalogPaginationDemo /> },
  { id: 'music-primary-editor', category: 'Музыка', title: 'Главный трек: расположение в редакторе', description: 'Превью над поиском и ссылкой. Отдельная иконка удаления справа, в том числе у недоступного трека.', source: 'PrimaryTrackPreviewCard / styles.primaryTrackSelectedPreview / styles.primaryTrackModeTabs', render: () => <PrimaryTrackEditorDemo /> },
  { id: 'playlist-editor', category: 'Музыка', title: 'Редактор плейлиста', description: 'Общая шапка, обложка и поле названия; воспроизведение отдельно от удаления. Нижний плеер и ошибка сохранения.', source: 'PlaylistEditorSurface / GlobalMiniPlayer / styles.trackCard*', render: p => <PlaylistEditorDemo {...p} /> },
  { id: 'radio-schedule', category: 'Музыка', title: 'Программа радиостанции', description: 'Группировка по дням, время эфира, название передачи и ведущий.', source: 'RadioScheduleList', render: () => <RadioScheduleList items={[{ id: 'demo-radio', title: 'Музыка после полуночи', hostName: 'Алекс', startsAt: '2030-09-21T17:00:00Z', endsAt: '2030-09-21T19:00:00Z', sourceUrl: null }]} /> },
  { id: 'music-mini', category: 'Музыка', title: 'Мини-плеер', description: 'Пауза, следующий трек, сохранение, закрытие и бегущий заголовок. Переключение разделов сохраняет состояние плеера; пример работает без звука.', source: 'GlobalMiniPlayer / BottomNavigation / local presentation contexts', render: p => <Player {...p} navigation /> },
  { id: 'music-full', category: 'Музыка', title: 'Элементы полного плеера', description: 'Обложка, метаданные, перемотка и транспорт. Это фрагмент: шапка, карусель обложек и действия библиотеки здесь не показаны.', source: 'ExpandedBottomControls / MarqueeTrackTitle / ExpandedReleaseMetadata / GlobalAudioPlayer styles', render: p => <Player {...p} full /> },
  { id: 'music-radio', category: 'Музыка', title: 'Радио в мини-плеере', description: 'Прямой эфир и добавление станции в избранное, без подключения к трансляции.', source: 'GlobalMiniPlayer isLiveStream', render: p => <Player {...p} radio /> },
  { id: 'music-preview-states', category: 'Музыка', title: 'Главный трек: все состояния', description: 'Play, pause, загрузка, недоступный источник и выбор начала фрагмента.', source: 'PrimaryTrackPreviewCard / CompactTrackScrubber', render: () => <TrackStates /> },
  { id: 'music-download', category: 'Музыка', title: 'Скачивание на устройство', description: 'Стрелка, ожидание размера, кольцо байтового прогресса, отмена и сохранённый файл.', source: 'MusicDownloadControl / DownloadProgressRing', render: p => <Downloads {...p} /> },
  { id: 'music-queue', category: 'Музыка', title: 'Компактный список треков релиза', description: 'Номер, название и активный трек. Четыре строки и часть пятой, прокрутка и градиенты по краям.', source: 'CompactPlaylistTrackList / styles.bandcampTrack*', render: () => <Queue /> },
];
