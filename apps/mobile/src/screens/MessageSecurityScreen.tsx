import { useEffect, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { MatrixAccountSecurityScreen } from '@volna/messaging-client/matrix-account-security';
import { LoadingIndicator } from '@volna/messaging-client/loading';
import { ScreenTopBar } from '../components/ScreenTopBar';
import { matrixMessagingManager } from '../messaging/matrixMessaging';
import { styles } from '../styles';
import {
  MessageSecurityScreen as PublicMessageSecurityScreen,
  type MessageSecurityScreenProps as PublicMessageSecurityScreenProps,
} from '@volna/messaging-client/react-native-message-security';
import {
  getSecureMessagingClient,
  loadMessagingCapabilities,
} from '../messaging/secureMessaging';

type MessageSecurityScreenProps = Omit<PublicMessageSecurityScreenProps, 'getClient' | 'loadCapabilities'>;

export function MessageSecurityScreen(props: MessageSecurityScreenProps) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { let active = true; setError(false); void matrixMessagingManager.capabilities().then(value => { if (active) setEnabled(value.enabled); }).catch(() => { if (active) setError(true); }); return () => { active = false; }; }, [attempt]);
  if (enabled === null) return <View style={{ flex: 1 }}><ScreenTopBar title="Защита сообщений" onBack={props.onBack} /><View style={styles.settingsContent}>{error ? <Pressable accessibilityRole="button" onPress={() => setAttempt(value => value + 1)}><Text style={styles.settingsLabel}>Не удалось загрузить настройки. Повторить</Text></Pressable> : <LoadingIndicator />}</View></View>;
  if (enabled) return <MatrixAccountSecurityScreen key={props.accountId} accountId={props.accountId} manager={matrixMessagingManager} onBack={props.onBack} />;
  return (
    <PublicMessageSecurityScreen
      {...props}
      getClient={getSecureMessagingClient}
      loadCapabilities={loadMessagingCapabilities}
    />
  );
}
