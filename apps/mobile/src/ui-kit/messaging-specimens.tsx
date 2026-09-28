import { useRef, useState, type ComponentProps } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Paperclip, Send, ShieldAlert } from 'lucide-react-native';
import { Avatar, ChatHistoryUnavailable, ChatHistoryPagination, useChatHistoryPagination, DraftAttachment, MessageRow, SearchResult, MatrixSecurityFlow, messagingStyles as s } from '@volna/messaging-client/react-native-messages';
import type { MessagingAttachment, MessagingMessage } from '@volna/messaging-client/messaging-surface-controller';
import { Action, Stack, Row, Label, noop, type Specimen, type DemoProps } from './demo-shared';

const attachment: MessagingAttachment = { kind: 'entity', entityType: 'event', id: 'ui-kit-event', snapshot: { title: 'Вечер независимой музыки', startsAt: '2030-09-21T17:00:00Z' } };
function HistoryPagination() {
  const [page, setPage] = useState(0);
  const [failed, setFailed] = useState(false);
  const busy = useRef(false);
  const load = () => {
    if (busy.current || page >= 3) return;
    busy.current = true;
    // The first page contains only fictional service events: no layout change.
    setPage(value => value + 1);
    setFailed(false);
    busy.current = false;
  };
  const pager = useChatHistoryPagination({ enabled: page < 3 && !failed, revision: page, canLoad: () => !busy.current, load });
  return <Stack>
    <Label>Короткая история заполняется автоматически, включая пустую промежуточную страницу.</Label>
    <ScrollView style={{ height: 160, flexGrow: 0 }} contentContainerStyle={s.messages}
      onLayout={({ nativeEvent }) => pager.onLayout(nativeEvent.layout.height)}
      onContentSizeChange={(_width, height) => pager.onContentSizeChange(height)}
      onScroll={({ nativeEvent: e }) => pager.onScroll(e.contentOffset.y, e.contentSize.height, e.layoutMeasurement.height)} scrollEventThrottle={32}>
      <ChatHistoryPagination busy={false} error={failed} onLoad={load} />
      {page >= 2 ? <Text>Привет! Увидимся вечером.</Text> : null}
      <Text>Договорились.</Text>
    </ScrollView>
    <Label>{page === 3 ? 'Начало истории: кнопки нет.' : `Пройдено страниц: ${page}`}</Label>
    <Action secondary onPress={() => { setPage(0); setFailed(false); }}>Повторить пример</Action>
    <Action secondary onPress={() => { setPage(0); setFailed(true); }}>Ошибка — пример</Action>
    <Label>Во время запроса — только индикатор, без кнопки.</Label>
    <View style={{ height: 44 }}><ChatHistoryPagination busy onLoad={noop} /></View>
  </Stack>;
}
function Dialogs({ notify }: DemoProps) {
  const [refreshing, setRefreshing] = useState(false);
  return <Stack><Action secondary onPress={() => setRefreshing(!refreshing)}>{refreshing ? 'Завершить обновление — пример' : 'Фоновое обновление — пример'}</Action><Label>{refreshing ? 'Неизменённое проверенное превью сохраняется во время фонового обновления. Близкие сигналы синхронизации дают одну повторную проверку.' : 'Заглушка нужна при первом получении ещё не проверенного превью.'}</Label>{[{ name: 'Алекс', preview: 'Встретимся у входа', count: 3, online: true }, { name: 'Кира', preview: 'Обновление сообщений…', count: 0, online: false }, { name: 'Студия', preview: 'Чат создан', count: 102, online: false }].map(item => <Pressable key={item.name} accessibilityRole="button" onPress={() => notify('Открытие диалога')} style={s.threadRow}><Avatar partner={{ name: item.name, avatarUrl: null }} online={item.online} /><View style={s.threadCopy}><View style={s.threadHeader}><View style={s.threadNameLine}><Text style={s.threadName}>{item.name}</Text><Text style={s.threadUsername}>@example</Text></View><Text style={s.threadTime}>14:18</Text></View><View style={s.threadMeta}><Text numberOfLines={1} style={s.threadPreview}>{item.preview}</Text>{item.count ? <View style={s.unreadBadge}><Text style={s.unreadText}>{item.count > 99 ? '99+' : item.count}</Text></View> : null}</View></View></Pressable>)}</Stack>;
}
function Composer() {
  const [draft, setDraft] = useState(''); const [attached, setAttached] = useState(false); const [failed, setFailed] = useState(false);
  return <Stack><View style={[s.composer, { padding: 12 }]}>{attached ? <DraftAttachment attachment={attachment} onRemove={() => setAttached(false)} /> : null}{failed ? <View style={s.syncErrorBanner}><Text style={s.syncErrorText}>Не удалось отправить. Черновик сохранён.</Text></View> : null}<View style={s.inputShell}><Pressable accessibilityRole="button" accessibilityLabel="Прикрепить пример события" onPress={() => setAttached(!attached)} style={s.composerIcon}><Paperclip color="#111" size={21} /></Pressable><TextInput accessibilityLabel="Сообщение — пример" placeholder="Сообщение" value={draft} onChangeText={setDraft} maxLength={1000} multiline={false} style={s.messageInput} />{draft || attached ? <Pressable accessibilityRole="button" accessibilityLabel="Пример ошибки отправки" onPress={() => setFailed(true)} style={s.composerIcon}><Send size={21} color="#111" /></Pressable> : null}</View></View>{failed ? <Action secondary onPress={() => setFailed(false)}>Сбросить ошибку</Action> : null}</Stack>;
}
function Attachments({ notify }: DemoProps) {
  const entries: MessagingAttachment[] = [attachment, { kind: 'entity', entityType: 'account', id: 'ui-kit-account', snapshot: { name: 'Алекс', username: 'example' } }, { kind: 'entity', entityType: 'publicPage', id: 'ui-kit-community', snapshot: { name: 'Студия звука', username: 'example_studio' } }];
  return <Stack>{entries.map((entry, i) => { const message: MessagingMessage = { id: `attachment-${i}`, threadId: 'ui-kit-thread', senderAccountId: 'peer', text: '', attachment: entry, createdAt: '2026-09-16T12:00:00Z', reactions: [], securityMode: 'e2ee' }; return <MessageRow key={i} accountId="me" interactive={false} message={message} onLongPress={noop} onOpenEvent={() => notify('Событие')} onOpenProfile={() => notify('Профиль')} onOpenPublicPage={() => notify('Сообщество')} onReact={noop} />; })}</Stack>;
}
function Security({ notify, initialStep = 'home', verify = false, qr = false }: DemoProps & { initialStep?: ComponentProps<typeof MatrixSecurityFlow>['initialStep']; verify?: boolean; qr?: boolean }) {
  const [done, setDone] = useState(false); const [error, setError] = useState<string | null>(null);
  const [qrStep, setQrStep] = useState<'ready' | 'show' | 'scanned' | 'cancelled'>('ready');
  const device = { userId: '@fictional:example.invalid', deviceId: 'DEMO-DEVICE', displayName: 'Браузер · пример', ed25519: 'DEMONSTRATION-NOT-A-REAL-FINGERPRINT', curve25519: '', current: true, verified: true, signedByOwner: true };
  return <Stack><Text style={s.blockedText}>Иллюстрация интерфейса. Ключи и устройства вымышлены; защита и проверка аккаунта не запускаются.</Text>{qr ? <Row><Action secondary onPress={() => { setDone(false); setQrStep('ready'); }}>Сначала — пример</Action><Action secondary onPress={() => setQrStep('scanned')}>QR отсканирован — пример</Action></Row> : null}<MatrixSecurityFlow key={qr ? `${qrStep}:${done}` : 'security'} scope={verify ? 'conversation' : 'account'} initialStep={initialStep} security={{ cryptoVersion: 'UI Kit', crossSigningReady: true, secretStorageReady: true, recoveryKeyExists: true, partnerIdentityVerified: false, partnerIdentityChanged: false, ownDevices: [device, { ...device, deviceId: 'DEMO-SECOND', current: false, verified: false, displayName: 'Телефон · пример' }], partnerDevices: [{ ...device, current: false, verified: false }], pendingVerifications: [] }} verification={verify ? { id: 'ui-kit-verification', phase: done ? 'done' : qr ? (qrStep === 'cancelled' ? 'cancelled' : qrStep === 'scanned' ? 'started' : 'ready') : 'started', initiatedByMe: true, otherUserId: device.userId, otherDeviceId: 'DEMO-SECOND', sasDecimal: qr ? null : [1234, 5678, 9012], sasEmoji: qr ? [] : [['🐶', 'Собака'], ['🌳', 'Дерево'], ['🚲', 'Велосипед'], ['🎵', 'Музыка'], ['☀️', 'Солнце'], ['🍎', 'Яблоко'], ['🚀', 'Ракета']], qrCodeBase64: qr && (qrStep === 'show' || qrStep === 'scanned') ? 'VU9MTkEgVUkuIFRoaXMgaXMgb25seSBhIGZpY3Rpb25hbCBVSSBLaXQgZXhhbXBsZS4' : null, qrSupported: qr, qrNeedsConfirmation: qr && qrStep === 'scanned' } : null} busy={false} error={error} partnerName="Демонстрационный собеседник" recoveryKey="" closeRequested={false} onRecoverySaved={() => notify('Подтверждение сохранения — пример')} onRecover={async () => { setError('Пример неверного ключа. Настоящие ключи сюда не вводите.'); return false; }} onSetupRecovery={() => notify('Создание ключа отключено в UI Kit')} onResetRecovery={() => notify('Замена ключа отключена в UI Kit')} onStart={() => notify('Отдельный пример сравнения кодов')} onRetry={() => setError(null)} onClose={() => notify('Закрытие экрана')} onStepChange={noop} onAccept={noop} onCancel={() => qr ? setQrStep('cancelled') : setError('Проверка отменена — пример')} onConfirm={() => setDone(true)} onMismatch={() => qr ? setQrStep('cancelled') : setError('Коды не совпали — пример')} onStartSas={noop} onGenerateQr={() => setQrStep('show')} onScanQr={() => notify('Камера не запускается в UI Kit')} /></Stack>;
}
export const messagingSpecimens: Specimen[] = [
  { id: 'chat-history-unavailable', category: 'Сообщения', title: 'Недоступная история после восстановления', description: 'Ключи отсутствуют или SDK не подтвердил исходного отправителя. Успешный импорт ключа не скрывает предупреждение. Только локальный пример.', source: 'ChatHistoryUnavailable', render: p => <ChatHistoryUnavailable onRecover={() => p.notify('Переход к восстановлению — только пример')} /> },
  { id: 'chat-history', category: 'Сообщения', title: 'Загрузка предыдущих сообщений', description: 'Общие Web/native-компонент и планировщик: автозаполнение короткого чата, загрузка при прокрутке вверх и повтор только после сбоя. Локальная композиция без сети и ключей.', source: 'ChatHistoryPagination / useChatHistoryPagination', render: () => <HistoryPagination /> },
  { id: 'chat-list', category: 'Сообщения', title: 'Список диалогов', description: 'Превью, время, онлайн, непрочитанные и объединение близких сигналов фонового обновления. Композиция публичных стилей.', source: 'messagingStyles.thread* / Avatar', render: p => <Dialogs {...p} /> },
  { id: 'chat-composer', category: 'Сообщения', title: 'Поле сообщения и черновик', description: 'Однострочная капсула, вложение и ошибка отправки без потери текста.', source: 'messagingStyles.inputShell / messageInput / DraftAttachment', render: () => <Composer /> },
  { id: 'chat-attachments', category: 'Сообщения', title: 'Карточки вложений', description: 'Событие, профиль и сообщество внутри сообщения.', source: 'MessageRow / AttachmentCard', render: p => <Attachments {...p} /> },
  { id: 'chat-recipient', category: 'Сообщения', title: 'Получатели и результаты поиска', description: 'Люди, сообщества и события в панели прикрепления.', source: 'SearchResult', render: p => <Stack>{(['account', 'community', 'event'] as const).map(kind => <SearchResult key={kind} kind={kind} item={{ id: kind, name: 'Демонстрационный результат', title: 'Вечер музыки', username: 'example', cityName: 'Москва' }} onPress={() => p.notify('Выбрано только в примере')} />)}</Stack> },
  { id: 'chat-unavailable', category: 'Сообщения', title: 'Недоступность и ошибка синхронизации', description: 'Нейтральное состояние без выдуманного содержимого истории.', source: 'messagingStyles.blocked* / syncError*', render: p => <Stack><View style={s.blocked}><ShieldAlert color="#111" size={34} /><Text style={s.blockedTitle}>Чат временно недоступен</Text><Text style={s.blockedText}>Не удалось загрузить сообщения на этом устройстве.</Text><Action secondary onPress={() => p.notify('Повторная попытка — пример')}>Повторить</Action></View><View style={s.syncErrorBanner}><Text style={s.syncErrorText}>Не удалось обновить сообщения</Text></View></Stack> },
  { id: 'security-overview', category: 'Безопасность чатов', title: 'Защищённые сообщения: обзор', description: 'Состояние устройства, собственные устройства, восстановление и диагностика.', source: 'MatrixSecurityFlow', render: p => <Security {...p} /> },
  { id: 'security-devices', category: 'Безопасность чатов', title: 'Собственные устройства', description: 'Текущее, подтверждённое и неподтверждённое устройства.', source: 'MatrixSecurityFlow / Device', render: p => <Security {...p} initialStep="devices" /> },
  { id: 'security-recovery', category: 'Безопасность чатов', title: 'Восстановление истории', description: 'Поле ключа, ошибка и повторная попытка. Только вымышленные значения.', source: 'MatrixSecurityFlow recovery', render: p => <Security {...p} initialStep="recovery" /> },
  { id: 'security-verification', category: 'Безопасность чатов', title: 'Сравнение кодов собеседников', description: 'Emoji, числа, совпадение, несовпадение и результат сравнения.', source: 'MatrixSecurityFlow / Verification', render: p => <Security {...p} verify /> },
  { id: 'security-qr', category: 'Безопасность чатов', title: 'Проверка устройства по QR', description: 'Выбор, показ, подтверждение сканирования и отмена. Код вымышленный; камера и криптография не запускаются.', source: 'MatrixSecurityFlow / Verification', render: p => <Security {...p} verify qr /> },
  { id: 'security-details', category: 'Безопасность чатов', title: 'Технические сведения', description: 'Идентификаторы устройств и демонстрационные отпечатки.', source: 'MatrixSecurityFlow details', render: p => <Security {...p} initialStep="details" /> },
];

