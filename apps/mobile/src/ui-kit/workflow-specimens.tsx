import { useRef, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Bell, CalendarDays, ChevronRight, Copy, MapPin, Plus, Search, ShieldAlert, Trash2, X } from 'lucide-react-native';
import { AppSheetModal } from '@volna/messaging-client/app-sheet';
import { LoadingIndicator } from '@volna/messaging-client/loading';
import { EventScheduleTable, buildScheduleTimeline } from '../screens/EventScreens';
import { TimePickerModal } from '../screens/CreateEventScreen';
import { AppImage } from '../components/AppImage';
import { CalendarPickerModal } from '../components/CalendarPickerModal';
import { SelectionPickerModal } from '../components/SelectionPickerModal';
import { CatalogLocationProvider, useCatalogLocation } from '../components/CatalogLocationProvider';
import { CatalogTabs } from '../components/CatalogTabs';
import { ScreenContinuityProvider, useScreenScroll } from '../components/ScreenContinuity';
import { EntityShareActions } from '../components/EntityShareModal';
import { styles as s } from '../styles';
import { searchIncludes } from '../utils/searchNormalization';
import { Action, Stack, Label, Row, covers, noop, type DemoProps, type Specimen } from './demo-shared';

function Schedule({ notify }: DemoProps) {
  const [three, setThree] = useState(false);
  const stages = three ? ['Зал', 'Двор', 'Студия'] : ['Зал', 'Двор'];
  const timeline = buildScheduleTimeline(stages.flatMap((stageName, stage) => [0, 1].map(i => ({ id: `${stage}-${i}`, accountId: null, accountUsername: null, displayName: ['Алекс', 'Кира', 'Дуэт'][stage], stageName, startsAt: `2030-09-21T${18 + i}:00:00Z`, endsAt: `2030-09-21T${19 + i}:00:00Z` }))), stages);
  return <Stack><EventScheduleTable timeline={timeline} horizontalScrollRequest={null} onHorizontalInteractionStart={noop} onHorizontalOffsetChange={noop} onOpenProfile={async () => notify('Исполнитель')} /><Action secondary onPress={() => setThree(!three)}>{three ? 'Две сцены' : 'Три сцены: горизонтальная шкала'}</Action></Stack>;
}
function Time() {
  const [value, setValue] = useState('20:00'); const [open, setOpen] = useState(false);
  return <><Action secondary onPress={() => setOpen(true)}>Начало: {value}</Action><TimePickerModal value={value} isVisible={open} onClose={() => setOpen(false)} onSelect={next => { setValue(next); setOpen(false); }} /></>;
}
function EventFilters({ notify }: DemoProps) {
  const [open, setOpen] = useState(false);
  const [dateTarget, setDateTarget] = useState<'from' | 'to' | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [types, setTypes] = useState<string[]>(['Концерт']);
  const [venue, setVenue] = useState('');
  const reset = () => { setFrom(''); setTo(''); setTypes([]); setVenue(''); };
  return <>
    <Action secondary onPress={() => setOpen(true)}>Открыть фильтры событий</Action>
    <AppSheetModal isVisible={open} onClose={() => setOpen(false)} scroll title="Фильтры событий" contentContainerStyle={s.eventFilterContent} footerContainerStyle={s.eventFilterFooter}
      footer={<View style={s.eventFilterActions}><Pressable accessibilityRole="button" onPress={reset} style={s.eventFilterReset}><Text style={s.eventFilterResetText}>Сбросить</Text></Pressable><Pressable accessibilityRole="button" onPress={() => { setOpen(false); notify('Фильтры применены только в примере'); }} style={s.eventFilterApply}><Text style={s.eventFilterApplyText}>Показать</Text></Pressable></View>}>
      <View style={s.eventFilterSection}>
        <Text style={s.eventFilterSectionTitle}>Даты</Text>
        <View style={s.eventFilterDates}>
          <Pressable accessibilityLabel={`Дата от: ${from || 'не выбрана'}`} accessibilityRole="button" onPress={() => setDateTarget('from')} style={s.eventFilterDateButton}><CalendarDays color="#6f7b86" size={18} /><Text style={[s.eventFilterDateText, !from && s.eventFilterDatePlaceholder]}>{from || 'От'}</Text></Pressable>
          <Pressable accessibilityLabel={`Дата до: ${to || 'не выбрана'}`} accessibilityRole="button" onPress={() => setDateTarget('to')} style={s.eventFilterDateButton}><CalendarDays color="#6f7b86" size={18} /><Text style={[s.eventFilterDateText, !to && s.eventFilterDatePlaceholder]}>{to || 'До'}</Text></Pressable>
        </View>
      </View>
      <View style={s.eventFilterSection}>
        <Text style={s.eventFilterSectionTitle}>Типы событий</Text>
        <View style={s.eventFilterChips}>{['Концерт', 'Гиг', 'Вечеринка', 'Фестиваль', 'Музыкальный джем'].map(type => { const selected = types.includes(type); return <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: selected }} key={type} onPress={() => setTypes(current => selected ? current.filter(value => value !== type) : [...current, type])} style={[s.eventFilterChip, selected && s.eventFilterChipActive]}><Text style={[s.eventFilterChipText, selected && s.eventFilterChipTextActive]}>{type}</Text></Pressable>; })}</View>
      </View>
      <View style={s.eventFilterSection}>
        <Text style={s.eventFilterSectionTitle}>Локация</Text>
        <View style={s.eventFilterVenueInput}><Search color="#6f7b86" size={19} /><TextInput accessibilityLabel="Найти локацию — пример" autoCorrect={false} onChangeText={setVenue} placeholder="Найти локацию в городе Москва" placeholderTextColor="#98a3ae" style={s.eventFilterVenueText} value={venue} />{venue ? <Pressable accessibilityLabel="Очистить локацию" accessibilityRole="button" onPress={() => setVenue('')} style={s.eventFilterVenueClear}><X color="#6f7b86" size={20} /></Pressable> : null}</View>
      </View>
    </AppSheetModal>
    <CalendarPickerModal isVisible={dateTarget !== null} minDate={new Date(1970, 0, 1)} onClose={() => setDateTarget(null)} onSelect={value => { if (dateTarget === 'from') setFrom(value); else setTo(value); setDateTarget(null); }} selectedValue={dateTarget === 'from' ? from : to} title={dateTarget === 'from' ? 'Дата от' : 'Дата до'} />
  </>;
}
function Team({ notify }: DemoProps) {
  return <Stack>{['Организатор', 'Редактор', 'Партнёр'].map((role, i) => <View key={role} style={s.publicPageTeamRow}><View style={s.publicPageTeamAvatar}><Text style={s.publicPageTeamAvatarText}>{['А', 'К', 'С'][i]}</Text></View><View style={s.publicPageTeamCopy}><Text style={s.publicPageTeamName}>{['Алекс', 'Кира', 'Студия звука'][i]}</Text><Text style={s.publicPageTeamUsername}>@example_{i}</Text><Text style={s.publicPageTeamRole}>{role}</Text></View><Pressable accessibilityRole="button" accessibilityLabel={`Удалить ${role}`} onPress={() => notify('Пример удаления участника')} style={s.publicPageTeamRemove}><X size={18} color="#111" /></Pressable></View>)}</Stack>;
}
function Products({ notify }: DemoProps) {
  return <View style={s.publicPageProductGrid}>{covers.slice(0, 2).map((uri, i) => <Pressable key={uri} accessibilityRole="button" onPress={() => notify('Карточка товара')} style={s.publicPageProductCard}><AppImage source={{ uri }} style={s.publicPageProductImage} /><View style={s.publicPageProductCopy}><Text style={s.publicPageProductName}>{i ? 'Плакат' : 'Пластинка'}</Text><Text style={s.publicPageProductPrice}>{i ? '1 000 ₽' : '2 500 ₽'}</Text><Text style={s.publicPageProductDescription}>Демонстрационный товар</Text></View></Pressable>)}</View>;
}
function Invite() {
  const [code, setCode] = useState(''); const input = useRef<TextInput>(null);
  return <Stack><Pressable accessibilityRole="button" accessibilityLabel="Введите демонстрационный инвайт" onPress={() => input.current?.focus()} style={s.authInviteSlots}>{Array.from({ length: 6 }, (_, i) => <View key={i} style={[s.authInviteSlot, code.length === i && s.authInviteSlotActive]}><Text style={s.authInviteCharacter}>{code[i] ?? ''}</Text></View>)}<TextInput ref={input} accessibilityLabel="Демонстрационный инвайт-код" value={code} autoComplete="off" autoCapitalize="characters" autoCorrect={false} caretHidden maxLength={6} onChangeText={value => setCode(value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} style={s.authInviteHiddenInput} /></Pressable><Text style={s.settingsHint}>{code.length === 6 ? 'Код заполнен. Проверка на сервере здесь не выполняется.' : 'Введите шесть символов'}</Text></Stack>;
}
function City(props: DemoProps) {
  const [tab, setTab] = useState<'events' | 'locations'>('events');
  return <CatalogLocationProvider><Stack><CatalogTabs value={tab} onChange={setTab} tabs={[{ value: 'events', label: 'События' }, { value: 'locations', label: 'Локации' }]} /><CityPicker key={tab} {...props} /></Stack></CatalogLocationProvider>;
}
function CityPicker({ notify }: DemoProps) {
  const [open, setOpen] = useState(false);
  const [location, selectLocation] = useCatalogLocation();
  const city = location?.cityName ?? 'Екатеринбург';
  const setCity = (value: string) => selectLocation({ cityId: value === 'Москва' ? 'ru-moscow' : 'ru-saint-petersburg', cityName: value, countryCode: 'RU', countryName: 'Россия' });
  const [level, setLevel] = useState<'country' | 'city'>('country'); const [search, setSearch] = useState('');
  return <Stack><Action secondary onPress={() => { setLevel('country'); setSearch(''); setOpen(true); }}>{city}</Action><SelectionPickerModal title={level === 'country' ? 'Страна' : 'Город'} isVisible={open} onClose={() => setOpen(false)} search={search} onChangeSearch={setSearch} searchPlaceholder={level === 'country' ? 'Поиск страны' : 'Поиск города'} backLabel={level === 'city' ? 'К странам' : undefined} onBack={level === 'city' ? () => { setLevel('country'); setSearch(''); } : undefined} topOptions={[{ key: 'detect', title: 'Определить город', meta: 'Ближайший доступный город по геолокации', leading: <MapPin size={20} color="#111" />, onPress: () => notify('Геолокация в UI Kit не запрашивается') }]} options={(level === 'country' ? ['Россия'] : ['Москва', 'Санкт-Петербург']).filter(value => searchIncludes(value, search)).map(value => ({ key: value, title: value, selected: level === 'city' && city === value, navigates: level === 'country', onPress: () => { if (level === 'country') { setLevel('city'); setSearch(''); } else { setCity(value); setOpen(false); } } }))} /></Stack>;
}
function Push({ notify }: DemoProps) {
  const [open, setOpen] = useState(false);
  return <><Action secondary onPress={() => setOpen(true)}>Разрешение push</Action><AppSheetModal isVisible={open} onClose={() => setOpen(false)} title="Уведомления"><View style={s.pushPermissionIntro}><Bell color="#111" size={28} /><Text style={s.pushPermissionText}>Получать push-уведомления о новых подписчиках, лайках на ваших постах и других важных событиях внутри приложения.</Text></View><Pressable accessibilityRole="button" style={s.pushPermissionPrimary} onPress={() => { setOpen(false); notify('Системный запрос отключён в UI Kit'); }}><Text style={s.pushPermissionPrimaryText}>Разрешить</Text></Pressable><Pressable accessibilityRole="button" onPress={() => setOpen(false)} style={s.pushPermissionSecondary}><Text style={s.pushPermissionSecondaryText}>Не сейчас</Text></Pressable></AppSheetModal></>;
}
function ListStates({ notify }: DemoProps) {
  const [state, setState] = useState(0);
  return <Stack><View style={s.emptyProfileTab}>{state === 0 ? <LoadingIndicator /> : state === 1 ? <><Text style={s.emptyProfileTabTitle}>Здесь пока ничего нет</Text><Text style={s.emptyProfileTabText}>Добавьте первую запись или измените фильтры.</Text></> : <><ShieldAlert color="#111" size={28} /><Text style={s.emptyProfileTabTitle}>Не удалось загрузить</Text><Text style={s.emptyProfileTabText}>Проверьте соединение и повторите попытку.</Text><Action secondary onPress={() => { setState(0); notify('Повторная загрузка — пример'); }}>Повторить</Action></>}</View><Action secondary onPress={() => setState((state + 1) % 3)}>Следующее состояние</Action></Stack>;
}
function CatalogScrollExample() {
  const [category, setCategory] = useState<'music' | 'cinema'>('music');
  const [extra, setExtra] = useState(false);
  const scroll = useScreenScroll(`ui-kit:catalog-scroll:${category}`);
  const rows = Array.from({ length: extra ? 18 : 12 }, (_, index) => index + 1);
  return <Stack>
    <CatalogTabs value={category} onChange={setCategory} tabs={[{ value: 'music', label: 'Музыка' }, { value: 'cinema', label: 'Кино' }]} />
    <ScrollView ref={scroll.ref} onLayout={scroll.onLayout} onContentSizeChange={scroll.onContentSizeChange} onScroll={scroll.onScroll} onScrollBeginDrag={scroll.onScrollBeginDrag} onTouchStart={scroll.onTouchStart} scrollEventThrottle={16} style={{ height: 260 }}>
      {rows.map(index => <View key={index} style={s.publicPageTeamRow}><Text style={s.publicPageTeamName}>{category === 'music' ? 'Музыкальное' : 'Кинопоказ'} событие {index}</Text></View>)}
    </ScrollView>
    <Action secondary onPress={() => setExtra(!extra)}>{extra ? 'Убрать добавленные строки' : 'Добавить строки после прокрутки'}</Action>
  </Stack>;
}
function CatalogScroll() { return <ScreenContinuityProvider><CatalogScrollExample /></ScreenContinuityProvider>; }
function Share({ notify }: DemoProps) {
  const [open, setOpen] = useState(false);
  return <><Action secondary onPress={() => setOpen(true)}>Поделиться</Action><AppSheetModal title="Поделиться" isVisible={open} onClose={() => setOpen(false)}><EntityShareActions onChat={() => notify('Выбор получателя показан в разделе «Сообщения»')} onRepost={() => notify('Открытие редактора репоста — пример')} onExternal={() => notify('Системная панель здесь не вызывается')} /></AppSheetModal></>;
}
export const workflowSpecimens: Specimen[] = [
  { id: 'event-schedule', category: 'События', title: 'Расписание и сцены', description: 'Две сцены с вертикальным временем и три сцены с горизонтальной прокруткой.', source: 'EventScheduleTable / buildScheduleTimeline', render: p => <Schedule {...p} /> },
  { id: 'event-time', category: 'События', title: 'Выбор времени', description: 'Часы и минуты с шагом пять минут.', source: 'TimePickerModal', render: () => <Time /> },
  { id: 'event-filters', category: 'События', title: 'Фильтры событий', description: 'Поля дат, типы, поиск локации и закреплённые действия. Композиция общих стилей с локальными вымышленными значениями.', source: 'AppSheetModal / CalendarPickerModal / styles.eventFilter*', render: p => <EventFilters {...p} /> },
  { id: 'community-team', category: 'Сообщества', title: 'Команда и партнёры', description: 'Люди, роли, сообщества и удаление участника. Общие стили списка команды.', source: 'styles.publicPageTeam*', render: p => <Team {...p} /> },
  { id: 'community-products', category: 'Сообщества', title: 'Товары сообщества', description: 'Плитки с изображением, названием, ценой и описанием.', source: 'styles.publicPageProduct*', render: p => <Products {...p} /> },
  { id: 'auth-invite', category: 'Вход', title: 'Шестизначный инвайт', description: 'Пустые, активные и заполненные позиции кода.', source: 'styles.authInvite*', render: () => <Invite /> },
  { id: 'location', category: 'Выбор', title: 'Город и определение местоположения', description: 'Выбранный город сохраняется между событиями и локациями. В приложении выбор восстанавливается для аккаунта после перезапуска; новый город по GPS применяется только при реальном изменении города. Пример показывает локальное переключение вкладок без хранилища, GPS и изменения профиля.', source: 'SelectionPickerModal / CatalogLocationProvider', render: p => <City {...p} /> },
  { id: 'push-permission', category: 'Уведомления', title: 'Предложение включить push', description: 'Панель приложения перед системным запросом разрешения.', source: 'AppSheetModal / styles.pushPermission*', render: p => <Push {...p} /> },
  { id: 'lists-states', category: 'Состояния', title: 'Загрузка, пустой список и ошибка', description: 'Общий набор состояний ленты, каталогов, музыки и сообществ.', source: 'LoadingIndicator / styles.emptyProfileTab*', render: p => <ListStates {...p} /> },
  { id: 'catalog-scroll', category: 'Состояния', title: 'Прокрутка каталога', description: 'Локальная композиция с настоящим useScreenScroll: начните прокрутку сразу, затем добавьте строки. Список остаётся на месте; смена категории прокручивает к началу.', source: 'ScreenContinuityProvider / useScreenScroll / shared team-row styles', render: () => <CatalogScroll /> },
  { id: 'share', category: 'Навигация', title: 'Поделиться объектом', description: 'Настоящие действия EntityShareModal: личный чат, репост и другие приложения. Музыкальное окно отправки отличается и этим примером не покрывается.', source: 'AppSheetModal / EntityShareActions', render: p => <Share {...p} /> },
];
