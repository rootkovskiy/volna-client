import { LoadingIndicator } from './loading';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Check, ChevronLeft, ChevronRight, Copy, KeyRound, LockKeyhole, MonitorSmartphone, ShieldAlert, UserRound } from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import type { MatrixDeviceSecurity, MatrixRoomSecurity, MatrixVerificationState } from './matrix-engine';
import { base64UrlToBytes } from './mls-runtime.mjs';
import { isActiveMatrixVerification, matrixDeviceLabel, matrixOwnVerificationTargets, matrixSecurityOverview } from './matrix-security-presentation.mjs';

type Step = 'home' | 'devices' | 'partner' | 'recovery' | 'setup' | 'reset-recovery' | 'details';
type Props = {
  scope?: 'account' | 'conversation';
  initialStep?: Step;
  security: MatrixRoomSecurity | null;
  verification: MatrixVerificationState | null;
  busy: boolean;
  error: string | null;
  partnerName: string;
  recoveryKey: string;
  closeRequested: boolean;
  onRecoverySaved: () => void;
  onRecover: (key: string) => Promise<boolean>;
  onSetupRecovery: () => void;
  onResetRecovery: () => void;
  onStart: (device: MatrixDeviceSecurity) => void;
  onRetry: () => void;
  onClose: () => void;
  onStepChange: () => void;
  onAccept: () => void;
  onCancel: () => void;
  onConfirm: () => void;
  onMismatch: () => void;
  onStartSas: () => void;
  onGenerateQr: () => void;
  onScanQr: () => void;
};

function Action({ children, onPress, busy = false, disabled = false, secondary = false, onNeutral = false }: { children: string; onPress: () => void; busy?: boolean; disabled?: boolean; secondary?: boolean; onNeutral?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy || disabled, busy }} disabled={busy || disabled} onPress={onPress} style={({ pressed }) => [s.action, secondary ? s.secondary : s.primary, secondary && onNeutral && { backgroundColor: '#fff' }, (busy || disabled || pressed) && s.dim]}>
    {busy ? <LoadingIndicator tone={secondary ? 'default' : 'inverse'} size="small" /> : null}<Text style={[s.actionText, !secondary && s.white]}>{children}</Text>
  </Pressable>;
}

function Route({ title, hint, icon, onPress }: { title: string; hint?: string; icon?: ReactNode; onPress: () => void }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [s.route, pressed && s.dim]}>{icon}<View style={s.flex}><Text style={s.routeTitle}>{title}</Text>{hint ? <Text style={s.caption}>{hint}</Text> : null}</View><ChevronRight color="#7d8894" size={18} /></Pressable>;
}

function Heading({ title, description, icon }: { title: string; description: string; icon?: ReactNode }) {
  return <View style={s.heading}>{icon ? <View style={s.symbol}>{icon}</View> : null}<Text accessibilityRole="header" style={s.title}>{title}</Text><Text style={s.body}>{description}</Text></View>;
}

function Device({ device, devices, busy, onSelect, technical = false }: { device: MatrixDeviceSecurity; devices: MatrixDeviceSecurity[]; busy: boolean; onSelect?: () => void; technical?: boolean }) {
  return <View style={s.device}>
    <View style={s.deviceHeading}><MonitorSmartphone color="#53606c" size={22} /><View style={s.flex}><Text style={s.routeTitle}>{matrixDeviceLabel(device, devices)}</Text><Text style={s.caption}>{device.current ? 'Это устройство · ' : ''}{device.verified ? 'Подтверждено' : 'Не подтверждено'}</Text></View>{device.verified ? <Check color="#111" size={18} /> : null}</View>
    {onSelect ? <Action busy={busy} onPress={onSelect} secondary onNeutral>Сравнить код с этим устройством</Action> : null}
    {technical ? <><Text selectable style={s.code}>{device.deviceId}</Text><Text style={s.caption}>Ed25519 · {device.signedByOwner ? 'подписано владельцем' : 'не подписано владельцем'}</Text><Text selectable style={s.code}>{device.ed25519.match(/.{1,4}/g)?.join(' ') ?? device.ed25519}</Text><CopyAction value={device.ed25519} label="Скопировать отпечаток" /></> : null}
  </View>;
}

function CopyAction({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return <Pressable accessibilityRole="button" onPress={() => { void Clipboard.setStringAsync(value).then(() => setCopied(true)).catch(() => setCopied(false)); }} style={s.copy}><Copy color="#53606c" size={16} /><Text accessibilityLiveRegion="polite" style={s.caption}>{copied ? 'Скопировано' : label}</Text></Pressable>;
}

function Verification({ props, onDone }: { props: Props; onDone: () => void }) {
  const verification = props.verification!;
  const [confirmed, setConfirmed] = useState(false);
  const terminal = !isActiveMatrixVerification(verification);
  const own = props.security?.ownDevices.some((device) => device.userId === verification.otherUserId);
  const devices = own ? props.security?.ownDevices ?? [] : props.security?.partnerDevices ?? [];
  const target = devices.find((device) => device.deviceId === verification.otherDeviceId);
  const targetLabel = target ? matrixDeviceLabel(target, devices) : 'Другое устройство';
  const hasSas = verification.sasEmoji.length > 0 || Boolean(verification.sasDecimal);
  const qr = verification.qrCodeBase64 && !terminal && !hasSas ? base64UrlToBytes(verification.qrCodeBase64, 2048) : null;
  const confirm = () => { setConfirmed(true); props.onConfirm(); };
  useEffect(() => { if (props.error) setConfirmed(false); }, [props.error]);
  let title = verification.initiatedByMe ? 'Откройте второе устройство' : 'Вы начали эту проверку?';
  let description = verification.initiatedByMe ? (own ? 'Откройте на втором устройстве «Настройки и приватность → Защита сообщений». Примите запрос, чтобы сравнить код.' : 'Попросите собеседника открыть этот чат и принять запрос, чтобы сравнить код.') : 'Продолжайте, только если вы ожидаете этот запрос. Само нажатие ещё не подтверждает устройство: дальше нужно сравнить код.';
  if (verification.phase === 'ready') { title = 'Сравните два экрана'; description = 'Покажем одинаковый набор эмодзи на обоих устройствах. Сравните каждый символ слева направо.'; }
  if (verification.phase === 'started') { title = hasSas ? 'Все эмодзи совпадают?' : 'Готовим проверку'; description = hasSas ? 'Проверьте каждый символ и его порядок на обоих экранах. Если хотя бы один отличается, выберите «Не совпадают».' : 'Не закрывайте VOLNA на обоих устройствах.'; }
  if (qr) { title = 'Отсканируйте QR-код'; description = 'На втором устройстве выберите «Сканировать QR». Затем подтвердите, что сканировали именно этот код.'; }
  if (verification.qrNeedsConfirmation) { title = own ? 'Этот QR-код отсканировали вы?' : 'Собеседник отсканировал этот QR-код?'; description = own ? 'Подтвердите, только если вы сами сканировали код со своего экрана.' : 'Уточните у собеседника, что он сканировал именно этот код на выбранном устройстве. Без этого не подтверждайте проверку.'; }
  if (confirmed && !terminal) { title = 'Подтвердите на втором экране'; description = 'Ваше подтверждение отправлено. Проверка завершится после ответа второго устройства.'; }
  if (verification.phase === 'done') { title = 'Проверка завершена'; description = 'Устройства подтвердили совпадение кода. Можно вернуться к сообщениям.'; }
  if (verification.phase === 'cancelled') { title = 'Проверка не завершена'; description = 'Запрос отменён или время ожидания истекло. Устройство не было подтверждено этой проверкой. Начните заново, когда оба устройства будут рядом.'; }
  return <View style={s.stack}>
    <Text style={s.caption}>{own ? 'Ваше устройство' : props.partnerName} · {targetLabel}</Text>
    <Heading title={title} description={description} icon={verification.phase === 'done' ? <Check color="#111" size={26} /> : <MonitorSmartphone color="#111" size={26} />} />
    {!terminal && !confirmed ? <>
      {verification.phase === 'requested' && !verification.initiatedByMe ? <Action busy={props.busy} onPress={props.onAccept}>Да, продолжить</Action> : null}
      {verification.phase === 'ready' && !qr ? <><Action busy={props.busy} onPress={props.onStartSas}>Сравнить эмодзи</Action>{verification.qrSupported ? <><Action busy={props.busy} onPress={props.onGenerateQr} secondary>Показать QR-код</Action><Action busy={props.busy} onPress={props.onScanQr} secondary>Сканировать QR</Action></> : null}</> : null}
      {hasSas ? <>
        {verification.sasEmoji.length ? <View style={s.emojiGrid}>{verification.sasEmoji.map(([emoji, name], index) => <View accessibilityLabel={`${index + 1}. ${name}`} accessible key={`${index}:${emoji}`} style={s.emojiCell}><Text style={s.emojiGlyph}>{emoji}</Text><Text numberOfLines={2} style={s.emojiName}>{name}</Text></View>)}</View> : null}
        {verification.sasDecimal ? <View style={s.stack}><Text style={s.caption}>Или сравните эти числа</Text><Text selectable style={s.decimal}>{verification.sasDecimal.join('   ')}</Text></View> : null}
        <Action busy={props.busy} onPress={confirm}>Всё совпадает</Action><Action busy={props.busy} onPress={props.onMismatch} secondary>Не совпадает</Action>
      </> : null}
      {qr ? <View style={s.qr}><QRCode backgroundColor="#fff" color="#000" ecl="L" quietZone={8} size={220} value={[{ data: qr, mode: 'byte' }] as never} /></View> : null}
      {verification.qrNeedsConfirmation ? <><Action busy={props.busy} onPress={confirm}>{own ? 'Да, это я' : 'Да, собеседник подтвердил'}</Action><Action busy={props.busy} onPress={props.onMismatch} secondary>Нет, отменить</Action></> : null}
    </> : null}
    {!terminal && (confirmed || verification.phase === 'requested' && verification.initiatedByMe || verification.phase === 'started' && !hasSas && !qr && !verification.qrNeedsConfirmation) ? <View style={s.waiting}><LoadingIndicator /><Text style={s.caption}>Ожидаем второе устройство…</Text></View> : null}
    {terminal ? <Action onPress={onDone}>{verification.phase === 'done' ? 'Готово' : 'Вернуться и повторить'}</Action> : <Action busy={props.busy} onPress={props.onCancel} secondary>Отменить проверку</Action>}
  </View>;
}

export function MatrixSecurityFlow(props: Props) {
  const [step, setStep] = useState<Step>(props.initialStep ?? 'home');
  const [dismissedVerification, setDismissedVerification] = useState<string | null>(null);
  const [recoveryInput, setRecoveryInput] = useState('');
  const [recovered, setRecovered] = useState(false);
  const opacity = useRef(new Animated.Value(1)).current;
  const overview = matrixSecurityOverview(props.security, props.verification);
  const showingVerification = props.verification && props.verification.id !== dismissedVerification;
  const screenKey = props.recoveryKey ? 'save-key' : showingVerification ? `verification:${props.verification?.id}:${props.verification?.phase}` : step;
  const onStepChangeRef = useRef(props.onStepChange);
  onStepChangeRef.current = props.onStepChange;
  useEffect(() => {
    onStepChangeRef.current();
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (!active || reduced) return;
      opacity.setValue(0);
      Animated.timing(opacity, { toValue: 1, duration: 190, useNativeDriver: Platform.OS !== 'web' }).start();
    });
    return () => { active = false; opacity.stopAnimation(); opacity.setValue(1); };
  }, [screenKey, opacity]);
  const go = (next: Step) => { setStep(next); setRecovered(false); };
  // Keep a dismissed terminal request hidden until the engine supplies a new id.
  const start = (device: MatrixDeviceSecurity) => { props.onStart(device); };
  const security = props.security;
  const current = security?.ownDevices.find((device) => device.current);
  const needsCurrent = !current?.verified || !security?.crossSigningReady;
  const ownTargets = matrixOwnVerificationTargets(security);
  let body: ReactNode;
  if (props.recoveryKey) {
    body = <><Heading title="Сохраните ключ восстановления" description="Положите его в менеджер паролей. Он даёт доступ к защищённой переписке — не отправляйте его в чат и никому не сообщайте." icon={<KeyRound color="#111" size={26} />} /><View style={s.device}><Text selectable style={s.code}>{props.recoveryKey}</Text><CopyAction label="Скопировать ключ" value={props.recoveryKey} /></View><Text style={s.caption}>После подтверждения этот ключ больше не показывается. Буфер обмена может быть доступен другим приложениям.</Text>{props.closeRequested ? <Text accessibilityRole="alert" style={s.error}>Прежде чем закрыть окно, сохраните ключ и нажмите кнопку ниже.</Text> : null}<Action onPress={() => { props.onRecoverySaved(); go('home'); }}>Я сохранил ключ</Action></>;
  } else if (showingVerification) {
    body = <Verification key={props.verification!.id} props={props} onDone={() => { setDismissedVerification(props.verification!.id); go('home'); }} />;
  } else if (!security) {
    body = <><Heading title={props.error ? 'Не удалось проверить защиту' : 'Проверяем защиту'} description="Состояние устройств появится здесь после подключения." />{props.busy ? <LoadingIndicator /> : <Action onPress={props.onRetry}>Повторить</Action>}</>;
  } else if (step === 'home' && props.scope !== 'conversation') {
    body = <>
      <Heading title={overview.title} description={overview.description} icon={overview.kind === 'ready' ? <LockKeyhole color="#111" size={26} /> : <MonitorSmartphone color="#111" size={26} />} />
      {overview.action ? <Action busy={props.busy} onPress={() => overview.action === 'verification' ? setDismissedVerification(null) : go(overview.action! as Step)}>{overview.action === 'partner' ? 'Проверить собеседника' : overview.action === 'recovery' ? 'Настроить доступ' : overview.action === 'verification' ? 'Открыть запрос' : 'Подтвердить устройство'}</Action> : <Action onPress={props.onClose}>{props.scope === 'account' ? 'Вернуться в настройки' : 'Вернуться в чат'}</Action>}
      <View style={s.routes}><Route title="Ваши устройства" hint={`${security.ownDevices.length} · управление подтверждением`} icon={<MonitorSmartphone color="#53606c" size={22} />} onPress={() => go('devices')} /><Route title="Восстановление доступа" hint={security.secretStorageReady ? 'Ключ восстановления настроен' : 'При смене или потере устройства'} icon={<KeyRound color="#53606c" size={22} />} onPress={() => go('recovery')} />{props.scope !== 'account' ? <Route title="Проверить собеседника" hint={security.partnerIdentityVerified ? 'Личность подтверждена' : 'Сравнить код защиты с собеседником'} icon={<UserRound color="#53606c" size={22} />} onPress={() => go('partner')} /> : null}</View>
      <Route title="Технические сведения" onPress={() => go('details')} />
    </>;
  } else if (step === 'devices' || step === 'partner' || (step === 'home' && props.scope === 'conversation')) {
    const own = step === 'devices';
    const devices = own ? security.ownDevices : security.partnerDevices;
    body = <><Heading title={own ? 'Ваши устройства' : `Проверка с ${props.partnerName}`} description={own ? 'Выберите устройство, которое сейчас рядом с вами, и откройте на нём VOLNA. Название помогает найти устройство, но не заменяет сравнение кода.' : 'Договоритесь с собеседником о проверке — при встрече или по другому доверенному каналу. Сравните все символы на двух экранах.'} />
      {devices.map((device) => <Device key={`${device.userId}:${device.deviceId}`} device={device} devices={devices} busy={props.busy} onSelect={own ? ownTargets.includes(device) ? () => start(device) : undefined : () => start(device)} />)}
      {!devices.length ? <Text style={s.body}>{own ? 'Устройства пока недоступны. Обновите состояние.' : 'Пока нет доступного устройства собеседника. Попросите его открыть этот чат в VOLNA.'}</Text> : null}
      {own && needsCurrent && !ownTargets.length ? <Text style={s.body}>Нет другого устройства для сравнения кода. Используйте сохранённый ключ восстановления.</Text> : null}
      {own ? <Route title="Нет доступа к другому устройству" onPress={() => go('recovery')} /> : null}<Action busy={props.busy} onPress={props.onRetry} secondary>Обновить список</Action>
    </>;
  } else if (step === 'recovery' && security.recoveryKeyExists === false && !security.secretStorageReady) {
    body = <><Heading title="Сохраните доступ к переписке" description="Восстановление ещё не настроено. Создадим секретный ключ — он понадобится, если вы смените или потеряете устройство." icon={<KeyRound color="#111" size={26} />} /><Text style={s.body}>На следующем экране сохраните ключ в менеджер паролей. Никому его не сообщайте: он открывает доступ к защищённой переписке.</Text><Action busy={props.busy} onPress={props.onSetupRecovery}>Создать ключ восстановления</Action><Text style={s.caption}>Без ключа или другого подтверждённого устройства VOLNA не сможет вернуть доступ к старым сообщениям.</Text></>;
  } else if (step === 'recovery') {
    body = recovered ? <><Heading title="Ключ принят" description="Доступ восстановлен. История появится по мере загрузки, если её ключи были в резервной копии." icon={<Check color="#111" size={26} />} /><Action onPress={() => go('home')}>Готово</Action></> : <>
      <Heading title="Восстановление доступа" description={security.secretStorageReady ? 'Ключ восстановления уже настроен. Храните его вне VOLNA — он понадобится при смене или потере устройства.' : 'Введите ключ, который вы сохраняли при настройке защиты. Пароль от аккаунта здесь не подходит.'} icon={<KeyRound color="#111" size={26} />} />
      {!security.secretStorageReady ? <><Text accessibilityRole="header" style={s.routeTitle}>Ключ восстановления</Text><TextInput accessibilityLabel="Ключ восстановления" autoCapitalize="none" autoCorrect={false} multiline maxLength={512} onChangeText={setRecoveryInput} placeholder="Вставьте сохранённый ключ" placeholderTextColor="#98a3ae" style={s.input} value={recoveryInput} /><Text style={s.caption}>Вернутся только сообщения, для которых сохранились резервные ключи. VOLNA не сможет восстановить их без вашего ключа или подтверждённого устройства.</Text><Action busy={props.busy} disabled={recoveryInput.trim().length < 32} onPress={() => { void props.onRecover(recoveryInput).then((success) => { if (success) { setRecoveryInput(''); setRecovered(true); } }); }}>Восстановить доступ</Action>{security.recoveryKeyExists !== true ? <Route title="Настраиваю защиту впервые" hint="Создать и сохранить ключ восстановления" onPress={() => go('setup')} /> : <Text style={s.caption}>Ключ уже создавался. Если вы его потеряли, вернитесь на подтверждённое устройство. На подтверждённом устройстве можно заменить его на новый.</Text>}</> : <Text style={s.caption}>Ключ не показывается повторно. Восстановление доступно на новом устройстве; здесь можно продолжать переписку.</Text>}
      {security.recoveryKeyExists || security.secretStorageReady ? <Route title="Потеряли ключ?" hint="Заменить его на новый на подтверждённом устройстве" onPress={() => go('reset-recovery')} /> : null}
    </>;
  } else if (step === 'reset-recovery') {
    body = <><Heading title="Заменить ключ восстановления?" description="Создадим новый ключ вместо потерянного. Сохраните его на следующем экране." icon={<KeyRound color="#111" size={26} />} /><Text style={s.body}>Для последующего восстановления понадобится новый ключ. Уже доступная переписка и подтверждения устройств сохранятся. Сообщения, ключи от которых потеряны, эта замена не вернёт.</Text>{needsCurrent || !security.secretStorageReady ? <><Text style={s.caption}>Сначала подтвердите это устройство или откройте VOLNA на прежнем подтверждённом устройстве, где доступны ключи переписки.</Text><Action onPress={() => go('devices')}>Подтвердить устройство</Action></> : <Action busy={props.busy} onPress={props.onResetRecovery}>Заменить и создать новый ключ</Action>}<Action busy={props.busy} onPress={() => go('recovery')} secondary>Отмена</Action></>;
  } else if (step === 'setup') {
    body = <><Heading title="Сохраните доступ заранее" description="Создадим один секретный ключ для восстановления. На следующем экране сохраните его в менеджер паролей." icon={<KeyRound color="#111" size={26} />} /><Text style={s.body}>Это не сброс защиты. Если ключ уже создавался, используйте его или другое подтверждённое устройство.</Text><Action busy={props.busy} disabled={security.recoveryKeyExists === true || security.secretStorageReady} onPress={props.onSetupRecovery}>Создать ключ восстановления</Action><Action onPress={() => go('recovery')} secondary>У меня уже есть ключ</Action></>;
  } else {
    body = <><Heading title="Технические сведения" description="Это публичные отпечатки ключей, которые создаются для каждого устройства. Это не ключ восстановления. Они нужны только для диагностики и ручной сверки; просмотр или копирование не подтверждает устройство." /><Text style={s.body}>Подтверждение устройств: {security.crossSigningReady ? 'настроено' : 'требует настройки'}{ '\n' }Восстановление: {security.secretStorageReady ? 'настроено' : 'недоступно на этом устройстве'}</Text>{props.scope !== 'conversation' ? <><Text style={s.routeTitle}>Ваши устройства</Text>{security.ownDevices.map((device) => <Device key={device.deviceId} device={device} devices={security.ownDevices} busy={props.busy} technical />)}</> : null}{props.scope !== 'account' ? <><Text style={s.routeTitle}>Устройства собеседника</Text>{security.partnerDevices.map((device) => <Device key={device.deviceId} device={device} devices={security.partnerDevices} busy={props.busy} technical />)}</> : null}<Text selectable style={s.caption}>{security.cryptoVersion}</Text></>;
  }
  return <Animated.View style={[s.stack, { opacity }]}>
    {step !== 'home' && !props.recoveryKey && !showingVerification ? <Pressable accessibilityRole="button" onPress={() => go('home')} style={s.back}><ChevronLeft color="#53606c" size={20} /><Text style={s.caption}>Защита сообщений</Text></Pressable> : null}
    {security?.partnerIdentityChanged ? <View accessibilityRole="alert" style={s.warning}><ShieldAlert color="#b3261e" size={20} /><Text style={s.warningText}>Ключи собеседника изменились. Отправка заблокирована до новой проверки собеседника.</Text></View> : null}
    {props.error ? <Text accessibilityRole="alert" style={s.error}>{props.error}</Text> : null}
    {body}
    {Platform.OS === 'web' ? <Text style={s.trustNote}>В браузере защита зависит от кода, который загружает сайт. Проверенное подписанное приложение может давать более сильные гарантии.</Text> : null}
  </Animated.View>;
}

const s = StyleSheet.create({
  stack: { gap: 12 }, flex: { flex: 1, minWidth: 0 }, heading: { gap: 8, paddingBottom: 4 }, title: { color: '#111', fontSize: 18, lineHeight: 24, fontWeight: '600' }, body: { color: '#53606c', fontSize: 14, lineHeight: 21 }, caption: { color: '#6f7b86', fontSize: 13, lineHeight: 19 }, symbol: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#f3f5f7', alignItems: 'center', justifyContent: 'center', marginBottom: 4 }, action: { minHeight: 44, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 999, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' }, primary: { backgroundColor: '#111' }, secondary: { backgroundColor: '#f3f5f7' }, actionText: { color: '#111', fontSize: 14, lineHeight: 20, fontWeight: '600', textAlign: 'center', flexShrink: 1 }, white: { color: '#fff' }, dim: { opacity: 0.7 }, routes: { paddingTop: 8 }, route: { minHeight: 64, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12 }, routeTitle: { color: '#111', fontSize: 16, lineHeight: 22, fontWeight: '600' }, back: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 4 }, device: { padding: 16, borderRadius: 8, backgroundColor: '#f3f5f7', gap: 12 }, deviceHeading: { flexDirection: 'row', alignItems: 'center', gap: 12 }, code: { color: '#323a43', fontSize: 13, lineHeight: 21, fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', web: 'monospace' }) }, copy: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8 }, input: { minHeight: 96, padding: 16, borderRadius: 8, backgroundColor: '#f3f5f7', color: '#111', fontSize: 16, lineHeight: 24, textAlignVertical: 'top' }, warning: { padding: 12, backgroundColor: '#f3f5f7', borderRadius: 8, flexDirection: 'row', alignItems: 'flex-start', gap: 8 }, warningText: { flex: 1, color: '#b3261e', fontSize: 14, lineHeight: 20 }, error: { color: '#b3261e', fontSize: 14, lineHeight: 20 }, waiting: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10, padding: 12 }, emojiGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, paddingVertical: 12, backgroundColor: '#f3f5f7', borderRadius: 8 }, emojiCell: { width: 64, alignItems: 'center', gap: 4 }, emojiGlyph: { fontSize: 30, lineHeight: 38 }, emojiName: { color: '#53606c', fontSize: 11, lineHeight: 15, textAlign: 'center' }, decimal: { color: '#111', fontSize: 22, lineHeight: 30, fontWeight: '600', textAlign: 'center' }, qr: { alignItems: 'center', paddingVertical: 12 }, trustNote: { color: '#6f7b86', fontSize: 12, lineHeight: 18, marginTop: 8 },
});

export { Action as MatrixSecurityAction };
