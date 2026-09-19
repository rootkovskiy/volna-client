import { useEffect, useRef, useState } from 'react';
import { BackHandler, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { matrixQrPayload } from './matrix-qr-payload.mjs';
import { ScreenTopBar } from './screen-top-bar';
import { MatrixSecurityFlow, MatrixSecurityAction } from './matrix-security-flow';
import { matrixSecurityErrorMessage, selectMatrixVerification } from './matrix-security-presentation.mjs';
import type { MatrixMessagingManager, MatrixRoomSecurity, MatrixVerificationState } from './matrix-engine';

export function MatrixAccountSecurityScreen({ accountId, manager, onBack }: { accountId: string; manager: MatrixMessagingManager; onBack: () => void }) {
  const [security, setSecurity] = useState<MatrixRoomSecurity | null>(null);
  const [verification, setVerification] = useState<MatrixVerificationState | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const scanned = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recoveryKey, setRecoveryKey] = useState('');
  const [closeRequested, setCloseRequested] = useState(false);
  const [scan, setScan] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const active = useRef(true), running = useRef(false), revision = useRef(0);
  const readRunning = useRef(false), readPaused = useRef(false);
  const scroll = useRef<ScrollView>(null);
  const refresh = async () => {
    if (readRunning.current) return;
    readRunning.current = true;
    const current = ++revision.current;
    try {
      const next = await manager.getAccountSecurity(accountId);
      if (!active.current || current !== revision.current) return;
      readPaused.current = false;
      setSecurity(next); setVerification(old => selectMatrixVerification(next, old)); setReadError(null);
    } catch (reason) {
      if (active.current && current === revision.current) {
        readPaused.current = true;
        setReadError(matrixSecurityErrorMessage(reason));
      }
    } finally { readRunning.current = false; }
  };
  useEffect(() => {
    active.current = true; readPaused.current = false;
    let disposed = false, timer: ReturnType<typeof setTimeout>;
    const poll = async () => { if (!running.current && !readPaused.current) await refresh(); if (!disposed) timer = setTimeout(poll, 1500); };
    void poll();
    return () => { disposed = true; active.current = false; revision.current++; clearTimeout(timer); };
  }, [accountId, manager]);
  const action = async (operation: () => Promise<unknown>) => {
    if (running.current) return false;
    running.current = true; revision.current++; setBusy(true); setError(null);
    try {
      const result = await operation();
      if (!active.current) return false;
      if (result && typeof result === 'object' && 'recoveryKey' in result) setRecoveryKey(String(result.recoveryKey));
      if (result && typeof result === 'object' && 'phase' in result) setVerification(result as MatrixVerificationState);
      await refresh(); return true;
    } catch (reason) { if (active.current) setError(matrixSecurityErrorMessage(reason)); return false; }
    finally { running.current = false; if (active.current) setBusy(false); }
  };
  const close = () => { if (running.current) return; if (recoveryKey) { setCloseRequested(true); return; } onBack(); };
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { close(); return true; });
    const beforeUnload = (event: BeforeUnloadEvent) => { if (running.current || recoveryKey) { event.preventDefault(); event.returnValue = ''; } };
    if (Platform.OS === 'web') window.addEventListener('beforeunload', beforeUnload);
    return () => { subscription.remove(); if (Platform.OS === 'web') window.removeEventListener('beforeunload', beforeUnload); };
  }, [recoveryKey, onBack]);
  const verify = (operation: (accountId: string, id: string) => Promise<MatrixVerificationState>) => { if (verification) void action(() => operation(accountId, verification.id)); };
  return <View style={styles.screen}><ScreenTopBar title="Защита сообщений" onBack={close} /><ScrollView ref={scroll} contentContainerStyle={styles.content}>
    {scan && verification ? <><CameraView style={styles.camera} barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={result => { if (scanned.current) return; scanned.current = true; setScan(false); try { const encoded = matrixQrPayload(result, Platform.OS); void action(() => manager.scanQrVerification(accountId, verification.id, encoded)); } catch { setError('Некорректный QR-код'); } }} /><MatrixSecurityAction secondary onPress={() => setScan(false)}>Назад к проверке</MatrixSecurityAction></> : null}
    <View style={scan ? { display: 'none' } : undefined}><MatrixSecurityFlow
      scope="account" security={security} verification={verification} busy={busy || (!security && !readError)} error={error ?? readError} partnerName="" recoveryKey={recoveryKey} closeRequested={closeRequested}
      onClose={close} onStepChange={() => scroll.current?.scrollTo({ y: 0, animated: false })} onRetry={() => { if (!running.current) { setError(null); void refresh(); } }}
      onRecoverySaved={() => { setRecoveryKey(''); setCloseRequested(false); }}
      onRecover={key => action(() => manager.recoverSecurity(accountId, key))}
      onSetupRecovery={() => void action(() => manager.setupRecovery(accountId))} onResetRecovery={() => void action(() => manager.resetRecovery(accountId))}
      onStart={device => void action(() => manager.startOwnDeviceVerification(accountId, device.userId, device.deviceId))}
      onAccept={() => verify(manager.acceptVerification)} onCancel={() => verify(manager.cancelVerification)} onConfirm={() => verify(manager.confirmVerification)} onMismatch={() => verify(manager.mismatchVerification)} onStartSas={() => verify(manager.startSasVerification)} onGenerateQr={() => verify(manager.generateQrVerification)}
      onScanQr={() => { void (async () => { try { const granted = permission?.granted || (await requestPermission()).granted; if (!active.current) return; if (granted) { scanned.current = false; setScan(true); } else setError('Разрешите доступ к камере для сканирования кода'); } catch { if (active.current) setError('Камера недоступна'); } })(); }}
    /></View>
  </ScrollView></View>;
}
const styles = StyleSheet.create({ screen: { flex: 1, backgroundColor: '#fff' }, content: { padding: 16, paddingBottom: 32 }, camera: { height: 280, width: '100%' } });
