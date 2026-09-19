import { Text, View } from 'react-native';
import { AnimatedSegmentedControl } from './AnimatedSegmentedControl';
import { VolnaSwitch } from './VolnaSwitch';
import { styles } from '../styles';
import type { MessagePrivacy } from '../types';

const audienceOptions: Array<{ label: string; value: MessagePrivacy }> = [
  { label: 'Никто', value: 'nobody' },
  { label: 'Друзья', value: 'friends' },
  { label: 'Все', value: 'everyone' },
];
const messageOptions = audienceOptions.filter(option => option.value !== 'nobody');

/** Pure presentation shared by Settings and the fictional UI Kit specimen. */
export function ChatPrivacyControls({
  messagePrivacy, readReceiptsPrivacy, onlinePrivacy, allowConnectMatchMessages,
  onMessagePrivacyChange, onReadReceiptsPrivacyChange, onOnlinePrivacyChange, onConnectMatchMessagesChange,
}: {
  messagePrivacy: MessagePrivacy;
  readReceiptsPrivacy: MessagePrivacy;
  onlinePrivacy: MessagePrivacy;
  allowConnectMatchMessages: boolean;
  onMessagePrivacyChange: (value: MessagePrivacy) => void;
  onReadReceiptsPrivacyChange: (value: MessagePrivacy) => void;
  onOnlinePrivacyChange: (value: MessagePrivacy) => void;
  onConnectMatchMessagesChange: (value: boolean) => void;
}) {
  return <>
    <Text style={styles.settingsLabel}>Кто может мне писать</Text>
    <AnimatedSegmentedControl accessibilityLabel="Кто может мне писать" containerStyle={styles.privacySegment}
      options={messagePrivacy === 'nobody' ? audienceOptions : messageOptions} value={messagePrivacy} onChange={onMessagePrivacyChange} />
    <Text style={styles.settingsHint}>Друзья — люди, с которыми вы подписаны друг на друга.</Text>
    <View style={styles.settingsDivider} />
    <View style={styles.settingsSwitchRow}>
      <View style={styles.settingsSwitchCopy}>
        <Text style={styles.settingsLabel}>Разрешать сообщения от совпадений в Коннекте</Text>
        <Text style={styles.settingsHint}>Совпадения смогут писать вам, даже если вы не друзья. Видимость онлайна и прочтений не меняется.</Text>
      </View>
      <VolnaSwitch accessibilityLabel="Разрешать сообщения от совпадений в Коннекте"
        value={allowConnectMatchMessages} onValueChange={onConnectMatchMessagesChange} />
    </View>
    <View style={styles.settingsDivider} />
    <Text style={styles.settingsLabel}>Кто может видеть статус мною прочитанных сообщений</Text>
    <AnimatedSegmentedControl accessibilityLabel="Кто может видеть статус мною прочитанных сообщений" containerStyle={styles.privacySegment}
      options={audienceOptions} value={readReceiptsPrivacy} onChange={onReadReceiptsPrivacyChange} />
    <View style={styles.settingsDivider} />
    <Text style={styles.settingsLabel}>Кто видит, когда я был(а) онлайн</Text>
    <AnimatedSegmentedControl accessibilityLabel="Кто видит, когда я был(а) онлайн" containerStyle={styles.privacySegment}
      options={audienceOptions} value={onlinePrivacy} onChange={onOnlinePrivacyChange} />
  </>;
}
