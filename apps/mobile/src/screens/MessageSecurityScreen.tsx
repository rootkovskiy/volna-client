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
  return (
    <PublicMessageSecurityScreen
      {...props}
      getClient={getSecureMessagingClient}
      loadCapabilities={loadMessagingCapabilities}
    />
  );
}
