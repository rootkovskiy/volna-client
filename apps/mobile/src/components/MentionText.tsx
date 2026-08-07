import type { ReactNode } from 'react';
import { Text, type StyleProp, type TextStyle } from 'react-native';
import { styles } from '../styles';

const mentionPattern = /(^|[^a-z0-9_])(@[a-z0-9_]{3,30})\b/gi;

export function MentionText({
  children,
  onOpenMention,
  style,
}: {
  children: string;
  onOpenMention: (username: string) => void | Promise<void>;
  style?: StyleProp<TextStyle>;
}) {
  const parts: ReactNode[] = [];
  let cursor = 0;

  for (const match of children.matchAll(mentionPattern)) {
    const index = match.index ?? 0;
    const prefix = match[1] ?? '';
    const mention = match[2];
    const textBefore = children.slice(cursor, index);
    if (textBefore) parts.push(textBefore);
    if (prefix) parts.push(prefix);
    parts.push(
      <Text
        accessibilityLabel={`Открыть ${mention}`}
        accessibilityRole="link"
        key={`${index}:${mention}`}
        onPress={() => void onOpenMention(mention.slice(1).toLowerCase())}
        style={styles.mentionLink}
      >
        {mention}
      </Text>,
    );
    cursor = index + match[0].length;
  }

  if (cursor < children.length) parts.push(children.slice(cursor));
  return <Text style={style}>{parts.length ? parts : children}</Text>;
}
