import { ChatPrivacyControls } from '../components/ChatPrivacyControls';
import type { MessagePrivacy } from '../types';
import { useEditorAutosave } from '../components/useEditorAutosave';
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Activity, Bell, Check, KeyRound, Lock, Mail, MapPin, MonitorSmartphone, Pencil, Shield, Users, X } from 'lucide-react-native';
import { AnimatedSegmentedControl } from '../components/AnimatedSegmentedControl';
import { VolnaSwitch } from '../components/VolnaSwitch';
import { ConnectProfileInterests } from '../components/ConnectProfileInterests';
import { ConnectLikeIcon } from '../components/ConnectLikeIcon';
import { ConnectAccountGridCard } from '../screens/CommunityScreens';
import { MetricCard, StatusRow } from '../screens/AdminPanelScreen';
import { OwnershipTransferStatus } from '../components/OwnershipTransferStatus';
import { EditorAutosaveStatus } from '../components/EditorAutosaveStatus';
import { SelectionPickerModal } from '../components/SelectionPickerModal';
import { eventReminderOptions } from '../screens/SettingsScreens';
import { AppSheetModal } from '@volna/messaging-client/app-sheet';
import { AppImage } from '../components/AppImage';
import { VerifiedName } from '../components/VerifiedBadge';
import { styles as s } from '../styles';
import { Action, Stack, Row, Label, demoProfile, covers, genres, type DemoProps, type Specimen } from './demo-shared';

function LocalForm({ fields, action = 'Сохранить', autosave = false, notify }: DemoProps & { fields: string[]; action?: string; autosave?: boolean }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [savedValues, setSavedValues] = useState<Record<string, string>>({});
  const [fail, setFail] = useState(false);
  const [yearPicker, setYearPicker] = useState(false);
  const { status, flush } = useEditorAutosave({
    scopeKey: 'fictional-form', draftKey: autosave ? JSON.stringify(values) : '', lifecycle: false,
    save: async () => {
      await new Promise<void>(resolve => setTimeout(resolve, 350));
      if (fail) { notify('Пример ошибки: введённые значения сохранены в редакторе'); throw new Error('Fictional save failure'); }
      setSavedValues(values); return true;
    },
    onInvalid: () => notify('Проверьте поля примера'),
  });
  return <Stack>
    {autosave ? <EditorAutosaveStatus status={status} /> : null}
    {fields.map(label => <View key={label}><Label>{label}</Label>{label === 'Год рождения'
      ? <Pressable accessibilityRole="button" accessibilityLabel="Выбрать год рождения — пример" style={s.authYearSelect} onPress={() => setYearPicker(true)}><Text style={s.authYearSelectText}>{values[label] || 'Год рождения'}</Text></Pressable>
      : <TextInput accessibilityLabel={label + ' — пример'} autoComplete="off" textContentType="none" secureTextEntry={/парол/i.test(label)} multiline={/О себе|Описание|Комментарий|Причина/.test(label)} placeholder={label} value={values[label] ?? ''} onChangeText={value => setValues(current => ({ ...current, [label]: value }))} style={[s.input, /О себе|Описание|Комментарий|Причина/.test(label) && { minHeight: 118, textAlignVertical: 'top' }]} />}</View>)}
    {!autosave ? <Action onPress={() => notify('Изменено только в UI Kit')}>{action}</Action> : <>
      <Text style={s.settingsHint}>Автосохранение после паузы 800 мс. Выход сразу запускает сохранение и ждёт подтверждения; ошибка оставляет введённые данные.</Text>
      <View style={s.settingsSwitchRow}><Text style={s.settingsLabel}>Ошибка сохранения — пример</Text><VolnaSwitch accessibilityLabel="Ошибка сохранения — пример" value={fail} onValueChange={setFail} /></View>
      <Action onPress={() => { void flush().then(ok => { if (ok) notify('Пример: редактор закрыт после сохранения'); }); }}>Выйти из редактора — пример</Action>
      <Text style={s.settingsHint}>Сохранено в примере: {Object.values(savedValues).filter(Boolean).join(' · ') || 'нет изменений'}. Только локальные данные.</Text>
    </>}
    <SelectionPickerModal isVisible={yearPicker} title="Год рождения" onClose={() => setYearPicker(false)} options={Array.from({ length: 83 }, (_, i) => String(new Date().getFullYear() - 18 - i)).map(year => ({ key: year, title: year, selected: values['Год рождения'] === year, onPress: () => { setValues({ ...values, 'Год рождения': year }); setYearPicker(false); } }))} />
  </Stack>;
}
function Privacy() {
  const [message, setMessage] = useState<MessagePrivacy>('friends');
  const [read, setRead] = useState<MessagePrivacy>('nobody');
  const [online, setOnline] = useState<MessagePrivacy>('friends');
  const [matches, setMatches] = useState(true);
  const [age, setAge] = useState('nobody');
  return <View style={s.settingsCard}>
    <ChatPrivacyControls messagePrivacy={message} readReceiptsPrivacy={read} onlinePrivacy={online} allowConnectMatchMessages={matches}
      onMessagePrivacyChange={setMessage} onReadReceiptsPrivacyChange={setRead} onOnlinePrivacyChange={setOnline} onConnectMatchMessagesChange={setMatches} />
    <View style={s.settingsDivider} />
    <Text style={s.settingsLabel}>Кто видит мой возраст в Коннекте</Text>
    <AnimatedSegmentedControl accessibilityLabel="Кто видит мой возраст в Коннекте" containerStyle={s.privacySegment}
      options={[{ label: 'Никто', value: 'nobody' }, { label: 'Все', value: 'everyone' }]} value={age} onChange={setAge} />
  </View>;
}
function Switches() {
  const [selected, setSelected] = useState<string[]>([]);
  return <Stack>{['Невидимый режим', 'Показывать сохранённую музыку', 'Показывать загруженную музыку', 'Показывать год рождения'].map(label => <View key={label} style={s.settingsSwitchRow}><View style={s.settingsSwitchCopy}><Text style={s.settingsLabel}>{label}</Text><Text style={s.settingsHint}>Изменение применяется только в этом примере</Text></View><VolnaSwitch value={selected.includes(label)} onValueChange={value => setSelected(value ? [...selected, label] : selected.filter(x => x !== label))} /></View>)}</Stack>;
}
function Delivery() {
  const [modes, setModes] = useState<Record<string, string>>({});
  return <Stack>{['Сообщения', 'Лайки и ответы', 'Новые подписчики', 'События'].map(label => <View key={label}><Text style={s.settingsLabel}>{label}</Text><AnimatedSegmentedControl value={modes[label] ?? 'Здесь'} onChange={value => setModes({ ...modes, [label]: value })} options={[{ value: 'Нет', label: 'Не получать', renderContent: () => <X size={18} color="#6f7b86" /> }, { value: 'Здесь', label: 'Здесь' }, { value: '+Push', label: '+Push' }]} /></View>)}</Stack>;
}
function Reminders() {
  const [selected, setSelected] = useState<number[]>([1440]);
  return <Stack><Text style={s.eventReminderOptionsLabel}>Когда напоминать</Text><View style={s.eventReminderOptionsGrid}>{eventReminderOptions.map(({ value, label }) => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: selected.includes(value) }} onPress={() => setSelected(selected.includes(value) ? selected.filter(x => x !== value) : [...selected, value])} style={[s.eventReminderOption, selected.includes(value) && s.eventReminderOptionActive]}><Text style={[s.eventReminderOptionText, selected.includes(value) && s.eventReminderOptionTextActive]}>{label}</Text></Pressable>)}</View></Stack>;
}
function NotificationRows({ notify }: DemoProps) {
  const [resolved, setResolved] = useState(false);
  return <Stack>{[{ name: 'Алекс', username: 'example', title: 'Новый ответ', body: 'Алекс ответил на вашу публикацию' }, { name: 'VOLNA', username: 'volna', title: 'Новый вход в аккаунт', body: 'Браузер · Windows' }].map(item => <Pressable key={item.title} accessibilityRole="button" onPress={() => notify('Открытие уведомления — пример')} style={s.followRequestRow}><View style={[s.followRequestAvatar, s.volnaNotificationAvatar]}><Text style={s.volnaNotificationAvatarText}>{item.name[0]}</Text></View><View style={s.notificationCopy}><View style={s.notificationSourceRow}><Text numberOfLines={1} style={s.notificationTitle}>{item.name}</Text><Text style={s.notificationSourceLink}>@{item.username}</Text></View><Text style={s.notificationTitle}>{item.title}</Text><Text style={s.notificationText}>{item.body}</Text><Text style={s.notificationTimestamp}>Сегодня, 12:40</Text></View></Pressable>)}{!resolved ? <View style={s.followRequestRow}><View style={s.followRequestAvatar}><Text style={s.followRequestAvatarText}>К</Text></View><View style={s.notificationCopy}><Text style={s.notificationTitle}>Кира</Text><Text style={s.notificationText}>@example_two хочет подписаться</Text><Text style={s.notificationTimestamp}>Сегодня, 11:30</Text><View style={s.followRequestActions}><Pressable accessibilityRole="button" style={s.followRequestApprove} onPress={() => setResolved(true)}><Text style={s.notificationActionText}>Подтвердить</Text></Pressable><Pressable accessibilityRole="button" style={s.followRequestReject} onPress={() => setResolved(true)}><Text style={s.followRequestRejectText}>Удалить</Text></Pressable></View></View></View> : <Action secondary onPress={() => setResolved(false)}>Вернуть запрос</Action>}</Stack>;
}
function Community({ notify }: DemoProps) {
  const [following, setFollowing] = useState(false);
  return <Stack><View style={s.publicPageHeroRow}><AppImage source={{ uri: covers[1] }} style={s.publicPageHeroAvatar} /><View style={s.publicPageHeroCopy}><VerifiedName isVerified name="Студия звука" style={s.publicPageHeroName} /><Text style={s.publicPageHeroUsername}>@example_studio</Text><Text style={s.publicPageHeroType}>Творческое пространство</Text></View></View><Text style={s.publicPageAbout}>Место для музыки, совместных проектов и небольших выставок.</Text><View style={s.publicPageContactRow}><MapPin size={20} color="#6f7b86" /><Text style={s.publicPageAddress}>Москва · Примерный переулок, 1</Text></View><View style={s.publicPageActionsRow}><Pressable accessibilityRole="button" onPress={() => setFollowing(!following)} style={[s.publicPageFollowButton, following && s.publicPageFollowButtonSecondary]}><Text style={[s.publicPageFollowText, following && s.publicPageFollowTextSecondary]}>{following ? 'Вы подписаны' : 'Подписаться'}</Text></Pressable><Pressable accessibilityRole="button" onPress={() => notify('Редактор сообщества')} style={[s.publicPageFollowButton, s.publicPageFollowButtonSecondary]}><Text style={s.publicPageFollowTextSecondary}>Кабинет</Text></Pressable></View></Stack>;
}
function ConnectCards({ notify }: DemoProps) {
  return <View style={{ flexDirection: 'row', gap: 8 }}>{[false, true].map((liked, i) => <ConnectAccountGridCard key={i} account={{ ...demoProfile, id: `ui-kit-person-${i}`, name: i ? 'Кира' : 'Алекс', age: 28, cityName: 'Москва', connectDistanceKm: 12, connectPhotos: [] }} onPress={() => notify('Полный профиль Коннекта')} showCommittedLike={liked} />)}</View>;
}
function ProfileHeader({ notify }: DemoProps) {
  return <Stack><View style={s.heroRow}><View style={s.avatarWrap}><View style={s.avatarPlaceholder}><Text style={s.avatarPlaceholderText}>А</Text></View></View><View style={{ flex: 1, minWidth: 0 }}><VerifiedName isVerified name="Алекс" style={s.name} /><Text style={s.username}>@example</Text><View style={s.followCountersRow}><Text style={s.followCounterText}><Text style={s.counterNumber}>128</Text> подписчиков</Text><Text style={s.followCounterSeparator}>·</Text><Text style={s.followCounterText}><Text style={s.counterNumber}>24</Text> подписки</Text></View></View></View><Text style={s.about}>Ищу музыку, интересные места и людей для совместных проектов.</Text><Text style={s.profileRegistrationDate}>Регистрация: сентябрь 2026 г.</Text><Pressable accessibilityRole="button" onPress={() => notify('Редактор профиля — отдельный образец')} style={s.editProfileButton}><Text style={s.editProfileText}>Редактировать</Text></Pressable></Stack>;
}
function ConnectIdentity() {
  const [liked, setLiked] = useState(false);
  return <View style={{ backgroundColor: '#111', padding: 18, gap: 10 }}><View style={s.connectProfileIdentityRow}><View style={s.connectProfileIdentityLink}><Text style={s.connectProfileName}>Алекс</Text><Text style={s.connectProfileUsername}>@example</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Лайк профилю" onPress={() => setLiked(!liked)} style={s.connectProfileLikeButton}><ConnectLikeIcon liked={liked} size={34} /></Pressable></View><Text style={s.connectProfileAbout}>Фотографирую, слушаю пластинки и ищу компанию на выставки.</Text><ConnectProfileInterests interests={['Кино', 'Фотография', 'Архитектура']} musicGenres={genres} /></View>;
}
function Ownership() {
  return <Stack>{(['PENDING', 'ACCEPTED', 'CANCELLED', 'EXPIRED'] as const).map(status => <OwnershipTransferStatus key={status} pending={status === 'PENDING'} label="42:15" transfer={{ id: status, status, expiresAt: '2030-01-01T13:00:00Z', serverNow: '2030-01-01T12:00:00Z', community: { id: 'demo', username: 'example', name: 'Студия звука' }, fromOwner: { id: 'one', username: 'example_one', name: 'Алекс' }, toOwner: { id: 'two', username: 'example_two', name: 'Кира' } }} />)}</Stack>;
}
function Confirm({ notify, title = 'Удалить данные?' }: DemoProps & { title?: string }) {
  const [open, setOpen] = useState(false);
  return <><Action secondary onPress={() => setOpen(true)}>Открыть подтверждение</Action><AppSheetModal isVisible={open} title={title} onClose={() => setOpen(false)} footer={<Row><Action secondary onPress={() => setOpen(false)}>Отмена</Action><Action onPress={() => { setOpen(false); notify('Подтверждено только в примере'); }}>Подтвердить</Action></Row>}><Text style={s.settingsHint}>Демонстрация подтверждения. Данные приложения останутся без изменений.</Text></AppSheetModal></>;
}
export const accountSpecimens: Specimen[] = [
  { id: 'profile-header', category: 'Профиль', title: 'Шапка личного профиля', description: 'Аватар, имя, верификация, счётчики, описание и редактирование.', source: 'ProfileScreens / styles.heroRow / VerifiedName', render: p => <ProfileHeader {...p} /> },
  { id: 'auth-login', category: 'Вход', title: 'Поля входа — фрагмент', description: 'Упрощённый пример полей, без полного экрана входа. Используйте вымышленные значения: пример не авторизует.', source: 'AuthScreen / styles.input / primaryAuthButton', render: p => <LocalForm {...p} fields={['Логин', 'Пароль — вымышленный']} action="Войти" /> },
  { id: 'auth-register', category: 'Вход', title: 'Поля регистрации — фрагмент', description: 'Имя, выбор года рождения и email. Последовательность регистрации и Telegram здесь не показаны.', source: 'AuthScreen / shared form styles', render: p => <LocalForm {...p} fields={['Имя', 'Год рождения', 'Email — вымышленный']} action="Продолжить" /> },
  { id: 'profile-edit', category: 'Профиль', title: 'Текстовые поля профиля — фрагмент', description: 'Имя, многострочное описание, ссылка и автосохранение. Это не весь редактор профиля.', source: 'ProfileScreens / useEditorAutosave / EditorAutosaveStatus / styles.input', render: p => <LocalForm {...p} autosave fields={['Имя', 'О себе', 'Ссылка на соцсеть']} /> },
  { id: 'connect-grid', category: 'Коннект', title: 'Профили в сетке Коннекта', description: 'Заглушка фото, имя, расстояние, активный лайк без обводки.', source: 'ConnectAccountGridCard / ConnectLikeIcon', render: p => <ConnectCards {...p} /> },
  { id: 'connect-identity', category: 'Коннект', title: 'Интересы в полном профиле', description: 'Описание, лайк и отдельная строка музыкальных жанров без группировки.', source: 'styles.connectProfile* / ConnectProfileInterests', render: () => <ConnectIdentity /> },
  { id: 'community-header', category: 'Сообщества', title: 'Страница сообщества', description: 'Аватар, тип, адрес, описание, подписка и переход в кабинет.', source: 'styles.publicPageHero* / VerifiedName / publicPageActionsRow', render: p => <Community {...p} /> },
  { id: 'community-edit', category: 'Сообщества', title: 'Текстовые поля сообщества — фрагмент', description: 'Поля и автосохранение редактора. Полный кабинет, права и создание сообщества требуют отдельных примеров.', source: 'CommunityScreens / useEditorAutosave / EditorAutosaveStatus / shared form styles', render: p => <LocalForm {...p} autosave fields={['Название', 'Описание', 'Адрес', 'Сайт']} /> },
  { id: 'ownership', category: 'Сообщества', title: 'Передача владения', description: 'Ожидание подтверждения, принято, отменено и истёкший срок.', source: 'OwnershipTransferStatus', render: () => <Ownership /> },
  { id: 'privacy', category: 'Настройки', title: 'Конфиденциальность', description: 'Друзья — взаимные подписки. Отдельное разрешение для совпадений в Коннекте. Выбор работает локально.', source: 'ChatPrivacyControls / AnimatedSegmentedControl / VolnaSwitch', render: () => <Privacy /> },
  { id: 'settings-visibility', category: 'Настройки', title: 'Видимость профиля и музыки', description: 'Невидимость, сохранённая/загруженная музыка и дата рождения.', source: 'VolnaSwitch / styles.settingsSwitch*', render: () => <Switches /> },
  { id: 'notification-settings', category: 'Уведомления', title: 'Каналы доставки', description: 'Не получать, «Здесь», «+Push» для каждого типа уведомления.', source: 'AnimatedSegmentedControl / SettingsScreens', render: () => <Delivery /> },
  { id: 'event-reminders', category: 'Уведомления', title: 'Напоминания о событиях', description: 'Несколько интервалов напоминания.', source: 'styles.eventReminder* / SettingsScreens', render: () => <Reminders /> },
  { id: 'notification-rows', category: 'Уведомления', title: 'Лента уведомлений', description: 'Ответ, новый вход и запрос на подписку с действиями. Композиция стилей уведомлений.', source: 'styles.notification* / followRequest*', render: p => <NotificationRows {...p} /> },
  { id: 'password-change', category: 'Настройки', title: 'Смена пароля', description: 'Поля безопасности и кнопка сохранения; реальные пароли вводить не нужно.', source: 'PasswordSecurityScreen / shared form styles', render: p => <LocalForm {...p} fields={['Текущий пароль — пример', 'Новый пароль — пример', 'Повтор пароля — пример']} /> },
  { id: 'session-revoke', category: 'Настройки', title: 'Завершение сеанса', description: 'Подтверждение чувствительного действия в общей панели.', source: 'AppSheetModal / SettingsScreens', render: p => <Confirm {...p} title="Завершить сеанс?" /> },
  { id: 'admin-metrics', category: 'Администрирование', title: 'Мониторинг: показатели', description: 'Обычная метрика и показатель, требующий внимания. Все числа демонстрационные.', source: 'AdminPanelScreen / MetricCard', render: () => <Stack><MetricCard icon={<Activity size={20} />} label="Запросы" value="16/мин" hint="Демонстрационные данные" /><MetricCard icon={<Shield size={20} />} label="Ошибки" value="2" hint="Пример предупреждения" alert /></Stack> },
  { id: 'admin-services', category: 'Администрирование', title: 'Мониторинг: сервисы', description: 'Работает, медленный ответ и неактивный сервис.', source: 'AdminPanelScreen / StatusRow', render: () => <Stack><StatusRow label="API" detail="Готов принимать запросы" latency={32} /><StatusRow label="Хранилище" detail="Пример задержки" latency={680} /><StatusRow label="Socket.IO" detail="Нет подключения" inactive /></Stack> },
  { id: 'moderation', category: 'Администрирование', title: 'Модерация и причина отклонения', description: 'Общая форма решения модератора без отправки запроса.', source: 'SettingsScreens / shared form styles', render: p => <LocalForm {...p} fields={['Причина отклонения', 'Комментарий']} action="Отклонить" /> },
];
