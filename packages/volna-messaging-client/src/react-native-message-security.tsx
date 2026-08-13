import * as Clipboard from 'expo-clipboard';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import {
  Camera,
  Check,
  ChevronLeft,
  Copy,
  KeyRound,
  Laptop,
  QrCode,
  ShieldCheck,
  Smartphone,
  Trash2,
} from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import {
  type SecureMessagingClient,
} from './secure-messaging-client.mjs';

type MessageSecurityCapabilities = {
  deviceTransferEnabled: boolean;
  membershipRekeyEnabled: boolean;
};

type MessageSecurityClientHandle = {
  client: SecureMessagingClient;
};

export type MessageSecurityScreenProps = {
  accountId: string;
  getClient: (accountId: string) => Promise<MessageSecurityClientHandle>;
  loadCapabilities: () => Promise<MessageSecurityCapabilities>;
  onBack: () => void;
  onNotify: (message: string, type?: 'success' | 'error') => void;
};

type DeviceItem = {
  id: string;
  displayName: string;
  platform: 'ios' | 'android' | 'web';
  status: 'PENDING_TRANSPARENCY' | 'ACTIVE' | 'REVOKED';
  registeredAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
};

type ScreenPhase =
  | 'loading'
  | 'disabled'
  | 'setup'
  | 'transparency'
  | 'overview'
  | 'incoming'
  | 'scanner'
  | 'source-code'
  | 'source-progress'
  | 'recovery'
  | 'recovery-created'
  | 'completed';

const statusText: Record<string, string> = {
  'waiting-source': 'Откройте этот экран на старом устройстве и отсканируйте QR‑код.',
  'confirm-code': 'Сравните код на обоих устройствах. Он должен совпадать полностью.',
  registered: 'Ключи и история перенесены. Подключаем устройство к защищённым чатам…',
  'waiting-membership': 'Старое устройство добавляет новое к защищённым чатам…',
  rekeying: 'Обновляем ключи чатов и исключаем старое устройство…',
  completed: 'Перенос завершён. Новые сообщения защищённых чатов доступны только актуальным устройствам.',
};

function formatDeviceDate(value: string) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return 'дата неизвестна';
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }).format(parsed);
}

function DeviceIcon({ platform }: { platform: DeviceItem['platform'] }) {
  return platform === 'web'
    ? <Laptop color="#111" size={22} strokeWidth={1.8} />
    : <Smartphone color="#111" size={22} strokeWidth={1.8} />;
}

export function MessageSecurityScreen({
  accountId,
  getClient,
  loadCapabilities,
  onBack,
  onNotify,
}: MessageSecurityScreenProps) {
  const [phase, setPhase] = useState<ScreenPhase>('loading');
  const [isBusy, setIsBusy] = useState(false);
  const [devices, setDevices] = useState<DeviceItem[]>([]);
  const [currentDeviceId, setCurrentDeviceId] = useState('');
  const [identityFingerprint, setIdentityFingerprint] = useState<string | null>(null);
  const [qrPayload, setQrPayload] = useState('');
  const [manualQrPayload, setManualQrPayload] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [transferId, setTransferId] = useState('');
  const [transferStatus, setTransferStatus] = useState('waiting-source');
  const [recoverySecret, setRecoverySecret] = useState('');
  const [recoveryInput, setRecoveryInput] = useState('');
  const [retireOldDevice, setRetireOldDevice] = useState(true);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const scanLockedRef = useRef(false);
  const pollLockedRef = useRef(false);
  const lastPollErrorRef = useRef('');

  const loadDevices = useCallback(async () => {
    const { client } = await getClient(accountId);
    const value = await client.getDeviceSecurityState() as {
      currentDeviceId?: unknown;
      identityFingerprint?: unknown;
      devices?: unknown;
    };
    setCurrentDeviceId(typeof value.currentDeviceId === 'string' ? value.currentDeviceId : '');
    setIdentityFingerprint(typeof value.identityFingerprint === 'string' ? value.identityFingerprint : null);
    setDevices(Array.isArray(value.devices) ? value.devices as DeviceItem[] : []);
  }, [accountId, getClient]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const capabilities = await loadCapabilities();
        if (!active) return;
        if (!capabilities.deviceTransferEnabled || !capabilities.membershipRekeyEnabled) {
          setPhase('disabled');
          return;
        }
        const { client } = await getClient(accountId);
        if (!active) return;
        const localStatus = client.getLocalSecurityStatus() as { status?: unknown };
        const status = typeof localStatus.status === 'string' ? localStatus.status : 'needs-setup';
        if (status === 'ready') {
          await loadDevices();
          const pendingRecoverySecret = client.getPendingRecoverySecretForDisplay();
          if (active && typeof pendingRecoverySecret === 'string') {
            setRecoverySecret(pendingRecoverySecret);
            setPhase('recovery-created');
            return;
          }
          const pending = client.getPendingDeviceTransfers() as {
            outgoing?: Array<{ transferId?: unknown; phase?: unknown; verificationCode?: unknown }>;
          };
          const outgoing = Array.isArray(pending.outgoing) ? pending.outgoing[0] : undefined;
          if (active && outgoing && typeof outgoing.transferId === 'string') {
            setTransferId(outgoing.transferId);
            if (typeof outgoing.verificationCode === 'string') setVerificationCode(outgoing.verificationCode);
            setTransferStatus(typeof outgoing.phase === 'string' ? outgoing.phase : 'waiting-target-registration');
            setPhase(outgoing.phase === 'confirm-code' ? 'source-code' : 'source-progress');
          } else if (active) setPhase('overview');
        } else if (status === 'registration-pending') {
          setPhase('transparency');
          const result = await client.setupDevice() as { recoverySecret?: unknown };
          if (!active) return;
          if (typeof result.recoverySecret === 'string') {
            setRecoverySecret(result.recoverySecret);
            setPhase('recovery-created');
          } else {
            await loadDevices();
            if (active) setPhase('overview');
          }
        } else if (status === 'transfer-pending') {
          const { client } = await getClient(accountId);
          const transfer = await client.startIncomingDeviceTransfer() as { qrPayload?: unknown; transferId?: unknown };
          if (!active) return;
          if (typeof transfer.qrPayload === 'string') setQrPayload(transfer.qrPayload);
          if (typeof transfer.transferId === 'string') setTransferId(transfer.transferId);
          setPhase('incoming');
        } else {
          setPhase('setup');
        }
      } catch (error) {
        if (!active) return;
        onNotify(error instanceof Error ? error.message : 'Не удалось открыть безопасность сообщений', 'error');
        setPhase('setup');
      }
    })();
    return () => { active = false; };
  }, [accountId, getClient, loadCapabilities, loadDevices, onNotify]);

  const startIncoming = async () => {
    setIsBusy(true);
    try {
      const { client } = await getClient(accountId);
      const value = await client.startIncomingDeviceTransfer() as {
        qrPayload?: unknown;
        session?: { id?: unknown };
        transferId?: unknown;
      };
      if (typeof value.qrPayload !== 'string') throw new Error('Не удалось создать QR‑код переноса');
      setQrPayload(value.qrPayload);
      const id = typeof value.session?.id === 'string'
        ? value.session.id
        : typeof value.transferId === 'string' ? value.transferId : '';
      setTransferId(id);
      setTransferStatus('waiting-source');
      setPhase('incoming');
    } catch (error) {
      onNotify(error instanceof Error ? error.message : 'Не удалось начать перенос', 'error');
    } finally {
      setIsBusy(false);
    }
  };

  useEffect(() => {
    if (phase !== 'incoming' || !qrPayload) return;
    let active = true;
    const poll = async () => {
      if (pollLockedRef.current) return;
      pollLockedRef.current = true;
      try {
        const { client } = await getClient(accountId);
        const value = await client.pollIncomingDeviceTransfer() as {
          status?: unknown;
          verificationCode?: unknown;
          transferId?: unknown;
        };
        if (!active) return;
        const status = typeof value.status === 'string' ? value.status : 'waiting-source';
        lastPollErrorRef.current = '';
        setTransferStatus(status);
        if (typeof value.verificationCode === 'string') setVerificationCode(value.verificationCode);
        if (typeof value.transferId === 'string') setTransferId(value.transferId);
        if (status === 'completed') {
          await loadDevices();
          if (active) setPhase('completed');
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Перенос прерван';
        if (active && lastPollErrorRef.current !== message) {
          lastPollErrorRef.current = message;
          onNotify(message, 'error');
        }
      } finally {
        pollLockedRef.current = false;
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 2_000);
    return () => { active = false; clearInterval(timer); };
  }, [accountId, getClient, loadDevices, onNotify, phase, qrPayload]);

  const openScanner = async () => {
    const result = cameraPermission?.granted ? cameraPermission : await requestCameraPermission();
    if (!result.granted) {
      onNotify('Разрешите доступ к камере или вставьте код вручную', 'error');
      return;
    }
    scanLockedRef.current = false;
    setPhase('scanner');
  };

  const acceptQr = async (value: string) => {
    const normalized = value.trim();
    if (!normalized.startsWith('volna://device-transfer/')) {
      onNotify('Это не код переноса VOLNA', 'error');
      scanLockedRef.current = false;
      return;
    }
    setIsBusy(true);
    try {
      const { client } = await getClient(accountId);
      const started = await client.startOutgoingDeviceTransfer(normalized, {
        retireSourceDevice: retireOldDevice,
      }) as { transferId?: unknown; verificationCode?: unknown };
      if (typeof started.transferId !== 'string' || typeof started.verificationCode !== 'string') {
        throw new Error('Не удалось связать устройства');
      }
      setTransferId(started.transferId);
      setVerificationCode(started.verificationCode);
      setPhase('source-code');
    } catch (error) {
      onNotify(error instanceof Error ? error.message : 'Не удалось прочитать код переноса', 'error');
      scanLockedRef.current = false;
    } finally {
      setIsBusy(false);
    }
  };

  const onBarcodeScanned = ({ data }: BarcodeScanningResult) => {
    if (scanLockedRef.current) return;
    scanLockedRef.current = true;
    void acceptQr(data);
  };

  const approveSource = async () => {
    if (!transferId) return;
    setIsBusy(true);
    setPhase('source-progress');
    try {
      const { client } = await getClient(accountId);
      await client.approveOutgoingDeviceTransfer(transferId);
      setTransferStatus('waiting-target-registration');
    } catch (error) {
      setPhase('source-code');
      onNotify(error instanceof Error ? error.message : 'Не удалось передать историю', 'error');
    } finally {
      setIsBusy(false);
    }
  };

  useEffect(() => {
    if (phase !== 'source-progress' || !transferId || isBusy) return;
    let active = true;
    const poll = async () => {
      if (pollLockedRef.current) return;
      pollLockedRef.current = true;
      try {
        const { client } = await getClient(accountId);
        const value = await client.continueOutgoingDeviceTransfer(transferId) as { status?: unknown };
        if (!active) return;
        const status = typeof value.status === 'string' ? value.status : 'waiting-target-registration';
        lastPollErrorRef.current = '';
        setTransferStatus(status);
        if (status === 'completed') {
          await loadDevices();
          if (active) setPhase('completed');
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Не удалось продолжить перенос';
        if (active && lastPollErrorRef.current !== message) {
          lastPollErrorRef.current = message;
          onNotify(message, 'error');
        }
      } finally {
        pollLockedRef.current = false;
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 2_500);
    return () => { active = false; clearInterval(timer); };
  }, [accountId, getClient, isBusy, loadDevices, onNotify, phase, transferId]);

  const setupDevice = async (secret?: string) => {
    setIsBusy(true);
    setPhase('transparency');
    try {
      const { client } = await getClient(accountId);
      const result = await client.setupDevice(secret ? { recoverySecret: secret.trim() } : undefined) as {
        status?: unknown;
        recoverySecret?: unknown;
      };
      if (result.status === 'recovery-required') {
        setPhase('recovery');
        return;
      }
      if (typeof result.recoverySecret === 'string') {
        setRecoverySecret(result.recoverySecret);
        setPhase('recovery-created');
      } else {
        await loadDevices();
        setPhase('overview');
      }
    } catch (error) {
      onNotify(error instanceof Error ? error.message : 'Не удалось настроить защищённые сообщения', 'error');
      setPhase(secret ? 'recovery' : 'setup');
    } finally {
      setIsBusy(false);
    }
  };

  const acknowledgeRecoverySecret = async () => {
    setIsBusy(true);
    try {
      const { client } = await getClient(accountId);
      await client.acknowledgeRecoverySecretSaved();
      setRecoverySecret('');
      await loadDevices();
      setPhase('overview');
    } catch (error) {
      onNotify(error instanceof Error ? error.message : 'Не удалось подтвердить сохранение ключа', 'error');
    } finally {
      setIsBusy(false);
    }
  };

  const cancelIncoming = async () => {
    setIsBusy(true);
    try {
      const { client } = await getClient(accountId);
      await client.cancelIncomingDeviceTransfer();
      setQrPayload('');
      setVerificationCode('');
      setTransferId('');
      setTransferStatus('waiting-source');
      setPhase('setup');
      onNotify('Перенос отменён', 'success');
    } catch (error) {
      onNotify(error instanceof Error ? error.message : 'Не удалось отменить перенос', 'error');
    } finally {
      setIsBusy(false);
    }
  };

  const cancelOutgoing = async () => {
    if (!transferId) return;
    setIsBusy(true);
    try {
      const { client } = await getClient(accountId);
      await client.cancelOutgoingDeviceTransfer(transferId);
      setVerificationCode('');
      setTransferId('');
      setTransferStatus('waiting-source');
      setPhase('overview');
      onNotify('Перенос отменён', 'success');
    } catch (error) {
      onNotify(error instanceof Error ? error.message : 'Не удалось отменить перенос', 'error');
    } finally {
      setIsBusy(false);
    }
  };

  const revokeDevice = (device: DeviceItem) => {
    Alert.alert(
      'Отключить устройство?',
      `Устройство «${device.displayName}» больше не сможет читать новые сообщения. Ключи всех чатов будут обновлены.`,
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Отключить',
          style: 'destructive',
          onPress: () => void (async () => {
            setIsBusy(true);
            try {
              const { client } = await getClient(accountId);
              await client.revokeLinkedDevice(device.id);
              await loadDevices();
              onNotify('Устройство отключено, ключи чатов обновлены', 'success');
            } catch (error) {
              onNotify(error instanceof Error ? error.message : 'Не удалось отключить устройство', 'error');
            } finally {
              setIsBusy(false);
            }
          })(),
        },
      ],
    );
  };

  const header = (
    <View style={localStyles.header}>
      <Pressable accessibilityLabel="Назад" hitSlop={8} onPress={onBack} style={localStyles.iconButton}>
        <ChevronLeft color="#111" size={29} strokeWidth={2.1} />
      </Pressable>
      <Text style={localStyles.headerTitle}>Защищённые сообщения</Text>
    </View>
  );

  if (phase === 'loading') {
    return <View style={localStyles.screen}>{header}<View style={localStyles.center}><ActivityIndicator color="#111" size="large" /></View></View>;
  }

  if (phase === 'disabled') {
    return (
      <View style={localStyles.screen}>
        {header}
        <View style={localStyles.centerCopy}>
          <ShieldCheck color="#111" size={42} strokeWidth={1.5} />
          <Text style={localStyles.heroTitle}>Защита готовится к включению</Text>
          <Text style={localStyles.heroText}>Клиентская криптография и перенос устройств уже отделены в открытый модуль. До завершения независимой проверки сервер не разрешает включить незавершённый режим.</Text>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={localStyles.screen}>
      {header}
      <ScrollView contentContainerStyle={localStyles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {phase === 'setup' ? (
          <>
            <View style={localStyles.heroCard}>
              <ShieldCheck color="#111" size={34} strokeWidth={1.6} />
              <Text style={localStyles.heroTitle}>Ключи остаются на ваших устройствах</Text>
              <Text style={localStyles.heroText}>В чатах с E2EE VOLNA хранит только зашифрованные пакеты. Для первого устройства создайте ключ восстановления; для существующей защиты перенесите данные со старого устройства.</Text>
            </View>
            <Pressable disabled={isBusy} onPress={() => void setupDevice()} style={localStyles.primaryButton}>
              {isBusy ? <ActivityIndicator color="#fff" /> : <Text style={localStyles.primaryButtonText}>Настроить первое устройство</Text>}
            </Pressable>
            <Pressable disabled={isBusy} onPress={() => void startIncoming()} style={localStyles.secondaryButton}>
              <QrCode color="#111" size={21} />
              <Text style={localStyles.secondaryButtonText}>Это новое устройство</Text>
            </Pressable>
            <Pressable disabled={isBusy} onPress={() => setPhase('recovery')} style={localStyles.linkButton}>
              <Text style={localStyles.linkText}>Восстановить по ключу</Text>
            </Pressable>
          </>
        ) : null}

        {phase === 'transparency' ? (
          <View accessibilityLiveRegion="polite" style={localStyles.transferCard}>
            <ActivityIndicator color="#111" size="large" />
            <Text style={localStyles.heroTitle}>Подтверждаем устройство</Text>
            <Text style={localStyles.heroText}>Публикуем ключ в прозрачном журнале и ждём подписи минимум двух из трёх независимых witness‑операторов. Обычно это занимает несколько секунд.</Text>
            <Text style={localStyles.statusHint}>Если кворум временно недоступен, устройство не получит доступ к защищённым чатам. Уже активные устройства продолжат работать.</Text>
          </View>
        ) : null}

        {phase === 'overview' ? (
          <>
            <View style={localStyles.heroCard}>
              <View style={localStyles.successIcon}><Check color="#fff" size={20} strokeWidth={2.5} /></View>
              <Text style={localStyles.heroTitle}>Устройство готово к защищённым чатам</Text>
              <Text style={localStyles.heroText}>Каждое устройство имеет отдельный ключ. В чатах с E2EE добавление и отзыв устройства меняют эпоху ключей; старые обычные сообщения автоматически защищёнными не становятся.</Text>
              {Platform.OS === 'web' ? <Text style={localStyles.webWarning}>Веб‑версия защищает от чтения базы и сервера, но владелец сайта технически может подменить будущую загрузку JavaScript. Самая сильная проверяемая гарантия будет у подписанного приложения.</Text> : null}
              {identityFingerprint ? <Text selectable style={localStyles.fingerprint}>ID ключа: {identityFingerprint.slice(0, 16)}…</Text> : null}
            </View>
            <Text style={localStyles.sectionTitle}>Ваши устройства</Text>
            <View style={localStyles.card}>
              {devices.map((device, index) => (
                <View key={device.id} style={[localStyles.deviceRow, index > 0 && localStyles.rowBorder]}>
                  <View style={localStyles.deviceIcon}><DeviceIcon platform={device.platform} /></View>
                  <View style={localStyles.deviceCopy}>
                    <Text style={localStyles.deviceName}>{device.displayName}{device.id === currentDeviceId ? ' · это устройство' : ''}</Text>
                    <Text style={localStyles.deviceMeta}>{device.status === 'ACTIVE' ? `Добавлено ${formatDeviceDate(device.registeredAt)}` : device.status === 'PENDING_TRANSPARENCY' ? 'Подтверждается независимыми операторами' : 'Отключено'}</Text>
                  </View>
                  {device.status === 'ACTIVE' && device.id !== currentDeviceId ? (
                    <Pressable accessibilityLabel={`Отключить ${device.displayName}`} hitSlop={8} onPress={() => revokeDevice(device)} style={localStyles.smallIconButton}>
                      <Trash2 color="#b42318" size={19} />
                    </Pressable>
                  ) : null}
                </View>
              ))}
            </View>
            <Text style={localStyles.sectionTitle}>Перенос</Text>
            <View style={localStyles.card}>
              <Text style={localStyles.cardTitle}>На старом устройстве</Text>
              <Text style={localStyles.cardText}>Сначала откройте этот же раздел на новом устройстве и выберите «Это новое устройство».</Text>
              <Pressable onPress={() => void openScanner()} style={localStyles.primaryButton}>
                <Camera color="#fff" size={20} />
                <Text style={localStyles.primaryButtonText}>Сканировать QR нового устройства</Text>
              </Pressable>
              <Pressable onPress={() => setPhase('scanner')} style={localStyles.linkButton}>
                <Text style={localStyles.linkText}>Вставить код вручную</Text>
              </Pressable>
            </View>
          </>
        ) : null}

        {phase === 'incoming' ? (
          <View style={localStyles.transferCard}>
            <Text style={localStyles.heroTitle}>Покажите код старому устройству</Text>
            <Text style={localStyles.heroText}>{statusText[transferStatus] ?? 'Продолжаем безопасный перенос…'}</Text>
            <View style={localStyles.qrFrame}><QRCode backgroundColor="#fff" color="#000" quietZone={8} size={230} value={qrPayload} /></View>
            <Pressable onPress={() => void Clipboard.setStringAsync(qrPayload)} style={localStyles.secondaryButton}>
              <Copy color="#111" size={19} />
              <Text style={localStyles.secondaryButtonText}>Скопировать код</Text>
            </Pressable>
            <Text style={localStyles.clipboardWarning}>При копировании секрет переноса временно попадает в системный буфер. QR‑сканирование безопаснее.</Text>
            {verificationCode ? <View style={localStyles.codeCard}><Text style={localStyles.codeLabel}>Код проверки</Text><Text selectable style={localStyles.code}>{verificationCode}</Text></View> : null}
            {transferStatus !== 'waiting-source' ? <ActivityIndicator color="#111" style={localStyles.progress} /> : null}
            {transferStatus === 'waiting-source' || transferStatus === 'confirm-code' ? (
              <Pressable disabled={isBusy} onPress={() => void cancelIncoming()} style={localStyles.linkButton}><Text style={localStyles.dangerLink}>Отменить перенос</Text></Pressable>
            ) : null}
          </View>
        ) : null}

        {phase === 'scanner' ? (
          <View style={localStyles.transferCard}>
            <Text style={localStyles.heroTitle}>Сканируйте код нового устройства</Text>
            {cameraPermission?.granted ? (
              <CameraView
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={onBarcodeScanned}
                style={localStyles.camera}
              />
            ) : (
              <Pressable onPress={() => void openScanner()} style={localStyles.primaryButton}>
                <Camera color="#fff" size={20} />
                <Text style={localStyles.primaryButtonText}>Разрешить камеру</Text>
              </Pressable>
            )}
            <Text style={localStyles.orText}>или вставьте код</Text>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              multiline
              onChangeText={setManualQrPayload}
              placeholder="volna://device-transfer/…"
              placeholderTextColor="#98a3ae"
              style={localStyles.codeInput}
              value={manualQrPayload}
            />
            <View style={localStyles.toggleRow}>
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: retireOldDevice }}
                hitSlop={10}
                onPress={() => setRetireOldDevice((value) => !value)}
                style={[localStyles.checkbox, retireOldDevice && localStyles.checkboxChecked]}
              >{retireOldDevice ? <Check color="#fff" size={16} /> : null}</Pressable>
              <Text style={localStyles.toggleText}>Отключить старое устройство после успешного переноса</Text>
            </View>
            <Pressable disabled={!manualQrPayload.trim() || isBusy} onPress={() => void acceptQr(manualQrPayload)} style={[localStyles.primaryButton, (!manualQrPayload.trim() || isBusy) && localStyles.disabled]}>
              {isBusy ? <ActivityIndicator color="#fff" /> : <Text style={localStyles.primaryButtonText}>Продолжить</Text>}
            </Pressable>
          </View>
        ) : null}

        {phase === 'source-code' ? (
          <View style={localStyles.transferCard}>
            <ShieldCheck color="#111" size={38} strokeWidth={1.5} />
            <Text style={localStyles.heroTitle}>Сравните код</Text>
            <Text style={localStyles.heroText}>Код должен быть одинаковым на старом и новом устройствах. Если отличается — отмените перенос.</Text>
            <Text selectable style={localStyles.code}>{verificationCode}</Text>
            <Pressable disabled={isBusy} onPress={() => void approveSource()} style={localStyles.primaryButton}>
              {isBusy ? <ActivityIndicator color="#fff" /> : <Text style={localStyles.primaryButtonText}>Коды совпадают</Text>}
            </Pressable>
            <Pressable disabled={isBusy} onPress={() => void cancelOutgoing()} style={localStyles.linkButton}><Text style={localStyles.dangerLink}>Отменить перенос</Text></Pressable>
          </View>
        ) : null}

        {phase === 'source-progress' ? (
          <View style={localStyles.centerCopy}>
            <ActivityIndicator color="#111" size="large" />
            <Text style={localStyles.heroTitle}>Переносим зашифрованную историю</Text>
            <Text style={localStyles.heroText}>{statusText[transferStatus] ?? 'Новое устройство регистрирует собственные ключи…'}</Text>
          </View>
        ) : null}

        {phase === 'recovery' ? (
          <View style={localStyles.transferCard}>
            <KeyRound color="#111" size={36} strokeWidth={1.6} />
            <Text style={localStyles.heroTitle}>Ключ восстановления</Text>
            <Text style={localStyles.heroText}>Он подтверждает новое устройство, но сам по себе не возвращает историю. Историю можно получить только со старого устройства или из будущей зашифрованной резервной копии.</Text>
            <Text style={localStyles.webWarning}>Если старое устройство потеряно, после восстановления сразу отключите его в списке. До MLS‑обновления оно всё ещё является участником прежних чатов.</Text>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setRecoveryInput}
              placeholder="Вставьте ключ"
              placeholderTextColor="#98a3ae"
              secureTextEntry
              style={localStyles.singleInput}
              value={recoveryInput}
            />
            <Pressable disabled={!recoveryInput.trim() || isBusy} onPress={() => void setupDevice(recoveryInput)} style={[localStyles.primaryButton, (!recoveryInput.trim() || isBusy) && localStyles.disabled]}>
              {isBusy ? <ActivityIndicator color="#fff" /> : <Text style={localStyles.primaryButtonText}>Восстановить устройство</Text>}
            </Pressable>
          </View>
        ) : null}

        {phase === 'recovery-created' ? (
          <View style={localStyles.transferCard}>
            <KeyRound color="#111" size={36} strokeWidth={1.6} />
            <Text style={localStyles.heroTitle}>Сохраните ключ сейчас</Text>
            <Text style={localStyles.heroText}>VOLNA не хранит этот ключ и не сможет показать его повторно. Сохраните его в менеджере паролей.</Text>
            <Text selectable style={localStyles.recoveryCode}>{recoverySecret}</Text>
            <Pressable onPress={() => void Clipboard.setStringAsync(recoverySecret)} style={localStyles.secondaryButton}>
              <Copy color="#111" size={19} />
              <Text style={localStyles.secondaryButtonText}>Скопировать</Text>
            </Pressable>
            <Text style={localStyles.clipboardWarning}>После сохранения очистите системный буфер обмена: этот ключ позволяет авторизовать новое устройство.</Text>
            <Pressable disabled={isBusy} onPress={() => void acknowledgeRecoverySecret()} style={[localStyles.primaryButton, isBusy && localStyles.disabled]}>
              {isBusy ? <ActivityIndicator color="#fff" /> : <Text style={localStyles.primaryButtonText}>Я сохранил ключ</Text>}
            </Pressable>
          </View>
        ) : null}

        {phase === 'completed' ? (
          <View style={localStyles.centerCopy}>
            <View style={localStyles.successLarge}><Check color="#fff" size={30} strokeWidth={2.5} /></View>
            <Text style={localStyles.heroTitle}>Готово</Text>
            <Text style={localStyles.heroText}>История перенесена по одноразовому зашифрованному каналу, а для новых сообщений устройство получило отдельный MLS‑ключ.</Text>
            <Pressable onPress={() => setPhase('overview')} style={localStyles.primaryButton}><Text style={localStyles.primaryButtonText}>К устройствам</Text></Pressable>
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const localStyles = StyleSheet.create({
  screen: { backgroundColor: '#f3f5f7', flex: 1 },
  header: { alignItems: 'center', backgroundColor: '#fff', borderBottomColor: '#d7dee5', borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', minHeight: 52, paddingHorizontal: 8 },
  iconButton: { alignItems: 'center', height: 44, justifyContent: 'center', width: 44 },
  headerTitle: { color: '#111', fontSize: 16, fontWeight: '600' },
  content: { alignSelf: 'center', gap: 8, maxWidth: 620, padding: 16, paddingBottom: 48, width: '100%' },
  center: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  centerCopy: { alignItems: 'center', gap: 12, justifyContent: 'center', minHeight: 360, paddingHorizontal: 22 },
  heroCard: { alignItems: 'flex-start', backgroundColor: '#fff', borderRadius: 8, gap: 8, padding: 16 },
  transferCard: { alignItems: 'center', backgroundColor: '#fff', borderRadius: 8, gap: 12, padding: 16 },
  heroTitle: { color: '#111', fontSize: 18, fontWeight: '600', lineHeight: 24, textAlign: 'center' },
  heroText: { color: '#53606c', fontSize: 14, lineHeight: 21, textAlign: 'center' },
  statusHint: { color: '#6f7b86', fontSize: 12, lineHeight: 17, textAlign: 'center' },
  fingerprint: { color: '#606c78', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 12, marginTop: 3 },
  webWarning: { alignSelf: 'stretch', backgroundColor: '#f3f5f7', borderRadius: 8, color: '#53606c', fontSize: 12, lineHeight: 17, padding: 12, textAlign: 'left' },
  sectionTitle: { color: '#111', fontSize: 16, fontWeight: '600', lineHeight: 20, marginTop: 16 },
  card: { backgroundColor: '#fff', borderRadius: 8, overflow: 'hidden', padding: 16 },
  cardTitle: { color: '#111', fontSize: 16, fontWeight: '600', lineHeight: 22 },
  cardText: { color: '#606c78', fontSize: 14, lineHeight: 20, marginBottom: 14, marginTop: 6 },
  primaryButton: { alignItems: 'center', alignSelf: 'stretch', backgroundColor: '#111', borderRadius: 22, flexDirection: 'row', gap: 8, justifyContent: 'center', minHeight: 44, paddingBottom: 2, paddingHorizontal: 18 },
  primaryButtonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  secondaryButton: { alignItems: 'center', alignSelf: 'stretch', backgroundColor: '#f3f5f7', borderRadius: 22, flexDirection: 'row', gap: 8, justifyContent: 'center', minHeight: 44, paddingBottom: 2, paddingHorizontal: 18 },
  secondaryButtonText: { color: '#111', fontSize: 15, fontWeight: '600' },
  linkButton: { alignItems: 'center', justifyContent: 'center', minHeight: 44, paddingHorizontal: 12 },
  linkText: { color: '#218bdc', fontSize: 14, fontWeight: '600' },
  dangerLink: { color: '#b42318', fontSize: 14, fontWeight: '600' },
  disabled: { opacity: 0.7 },
  successIcon: { alignItems: 'center', backgroundColor: '#34c759', borderRadius: 18, height: 36, justifyContent: 'center', width: 36 },
  successLarge: { alignItems: 'center', backgroundColor: '#34c759', borderRadius: 30, height: 60, justifyContent: 'center', width: 60 },
  deviceRow: { alignItems: 'center', flexDirection: 'row', minHeight: 68, paddingVertical: 8 },
  rowBorder: { borderTopColor: '#d7dee5', borderTopWidth: StyleSheet.hairlineWidth },
  deviceIcon: { alignItems: 'center', backgroundColor: '#f3f5f7', borderRadius: 19, height: 38, justifyContent: 'center', width: 38 },
  deviceCopy: { flex: 1, marginHorizontal: 12 },
  deviceName: { color: '#111', fontSize: 15, fontWeight: '600' },
  deviceMeta: { color: '#6f7b86', fontSize: 12, marginTop: 4 },
  smallIconButton: { alignItems: 'center', height: 44, justifyContent: 'center', width: 44 },
  qrFrame: { backgroundColor: '#fff', borderColor: '#d7dee5', borderRadius: 8, borderWidth: 1, padding: 12 },
  codeCard: { alignItems: 'center', alignSelf: 'stretch', backgroundColor: '#f3f5f7', borderRadius: 8, gap: 5, padding: 14 },
  codeLabel: { color: '#6f7b86', fontSize: 12, fontWeight: '600', textTransform: 'uppercase' },
  code: { color: '#111', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 31, fontWeight: '800', letterSpacing: 3, textAlign: 'center' },
  progress: { marginTop: 4 },
  clipboardWarning: { color: '#6f7b86', fontSize: 12, lineHeight: 17, textAlign: 'center' },
  camera: { alignSelf: 'stretch', aspectRatio: 1, borderRadius: 8, overflow: 'hidden' },
  orText: { color: '#6f7b86', fontSize: 13 },
  codeInput: { alignSelf: 'stretch', backgroundColor: '#f3f5f7', borderRadius: 8, color: '#111', fontSize: 16, minHeight: 118, padding: 16, textAlignVertical: 'top' },
  singleInput: { alignSelf: 'stretch', backgroundColor: '#f3f5f7', borderRadius: 8, color: '#111', fontSize: 16, minHeight: 44, paddingBottom: 2, paddingHorizontal: 16, paddingTop: 0, textAlignVertical: 'center' },
  toggleRow: { alignItems: 'center', alignSelf: 'stretch', flexDirection: 'row', gap: 10 },
  checkbox: { alignItems: 'center', borderColor: '#b9c3cd', borderRadius: 6, borderWidth: 1.5, height: 24, justifyContent: 'center', width: 24 },
  checkboxChecked: { backgroundColor: '#111', borderColor: '#111' },
  toggleText: { color: '#46515c', flex: 1, fontSize: 14, lineHeight: 19 },
  recoveryCode: { alignSelf: 'stretch', backgroundColor: '#f3f5f7', borderRadius: 8, color: '#111', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 15, lineHeight: 22, padding: 14, textAlign: 'center' },
});
