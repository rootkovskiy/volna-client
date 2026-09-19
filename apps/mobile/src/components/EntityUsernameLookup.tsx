import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { AppImage as Image } from './AppImage';
import { apiFetch as fetch, apiUrl, remoteSearchDebounceMs } from '../api/client';
import { getAvatarInitial, normalizeUsernameInput } from '../domain';
import { styles } from '../styles';
import type { CursorPage, PublicAccount, PublicPage } from '../types';

export type EntityUsernameCandidate = { id: string; name: string; username: string; avatarUrl: string | null };

export function EntityUsernameLookup({
  allowFreeText = false,
  endAdornment,
  entityType,
  isMuted = false,
  maxLength,
  onChange,
  onSelect,
  disabled = false,
  placeholder,
  searchEndpoint,
  value,
}: {
  allowFreeText?: boolean;
  endAdornment?: ReactNode;
  entityType: 'account' | 'community';
  isMuted?: boolean;
  maxLength?: number;
  onChange: (value: string) => void;
  onSelect?: (account: EntityUsernameCandidate) => void;
  disabled?: boolean;
  placeholder: string;
  searchEndpoint?: string;
  value: string;
}) {
  const [suggestions, setSuggestions] = useState<Array<{ id: string; name: string; username: string; avatarUrl: string | null }>>([]);
  const [committedValue, setCommittedValue] = useState<string | null>(null);
  const isSelectionCommitted = value === committedValue;

  useEffect(() => {
    const query = allowFreeText
      ? value.trim().replace(/^@/, '')
      : normalizeUsernameInput(value);
    if (query.length < 3 || isSelectionCommitted) {
      setSuggestions([]);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      const endpoint = searchEndpoint || `/${entityType === 'account' ? 'profiles' : 'public-pages'}`;
      void fetch(`${apiUrl}${endpoint}?q=${encodeURIComponent(query)}&pageSize=6`, { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error('lookup failed');
          const payload = await response.json() as CursorPage<PublicAccount | PublicPage> | Array<PublicAccount | PublicPage>;
          const items = Array.isArray(payload) ? payload : payload.items;
          if (controller.signal.aborted) return;
          setSuggestions(items.map((item) => ({ id: item.id, name: item.name, username: item.username, avatarUrl: item.avatarUrl })));
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          if (!(error instanceof Error) || error.name !== 'AbortError') setSuggestions([]);
        });
    }, remoteSearchDebounceMs);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [allowFreeText, entityType, isSelectionCommitted, searchEndpoint, value]);

  return (
    <View>
      <View style={[styles.entityUsernameField, isMuted && styles.entityUsernameFieldMuted]}>
        {!allowFreeText ? <Text style={styles.entityUsernamePrefix}>@</Text> : null}
        <TextInput
          autoCapitalize={allowFreeText ? 'words' : 'none'}
          autoCorrect={false}
          editable={!disabled}
          accessibilityLabel={placeholder}
          maxLength={maxLength}
          onChangeText={(nextValue) => {
            setCommittedValue(null);
            onChange(allowFreeText ? nextValue : normalizeUsernameInput(nextValue));
          }}
          placeholder={placeholder}
          placeholderTextColor="#98a3ae"
          style={styles.entityUsernameInput}
          value={value}
        />
        {endAdornment}
      </View>
      {suggestions.length ? (
        <View style={styles.entityUsernameSuggestions}>
          {suggestions.map((suggestion) => (
            <Pressable
              key={suggestion.id}
              disabled={disabled}
              accessibilityRole="button"
              onPress={() => {
                setCommittedValue(allowFreeText ? `@${suggestion.username}` : suggestion.username);
                setSuggestions([]);
                onChange(allowFreeText ? `@${suggestion.username}` : suggestion.username);
                onSelect?.(suggestion);
              }}
              style={styles.entityUsernameSuggestionRow}
            >
              {suggestion.avatarUrl ? (
                <Image resizeMode="cover" source={{ uri: suggestion.avatarUrl }} style={styles.entityUsernameSuggestionAvatar} />
              ) : (
                <View style={styles.entityUsernameSuggestionAvatar}>
                  <Text style={styles.entityUsernameSuggestionAvatarText}>{getAvatarInitial(suggestion.name)}</Text>
                </View>
              )}
              <View style={styles.publicPageTeamCopy}>
                <Text numberOfLines={1} style={styles.publicPageTeamName}>{suggestion.name}</Text>
                <Text numberOfLines={1} style={styles.publicPageTeamUsername}>@{suggestion.username}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

