import { LoadingIndicator } from '@volna/messaging-client/loading';
import { CalendarClock, Clock3, Plus, Trash2 } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiFetch as fetch, apiUrl, readApiError } from '../api/client';
import type { PublicPageRadioScheduleItem, ToastMessage } from '../types';
import { TimePickerModal } from '../screens/CreateEventScreen';
import { CalendarPickerModal } from './CalendarPickerModal';

type RadioScheduleDraft = {
  id: string;
  title: string;
  hostName: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  sourceUrl: string | null;
};

type PickerTarget = { id: string; field: 'startDate' | 'startTime' | 'endDate' | 'endTime' } | null;

function dateInput(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function timeInput(value: Date) {
  return `${String(value.getHours()).padStart(2, '0')}:${String(Math.floor(value.getMinutes() / 5) * 5).padStart(2, '0')}`;
}

function dateTimeInput(date: string, time: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match || !timeMatch) return null;
  const value = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(timeMatch[1]), Number(timeMatch[2]), 0, 0);
  return Number.isNaN(value.getTime()) ? null : value;
}

function draftFromItem(item: PublicPageRadioScheduleItem): RadioScheduleDraft {
  const startsAt = new Date(item.startsAt);
  const endsAt = new Date(item.endsAt);
  return {
    id: item.id,
    title: item.title,
    hostName: item.hostName ?? '',
    startDate: dateInput(startsAt),
    startTime: timeInput(startsAt),
    endDate: dateInput(endsAt),
    endTime: timeInput(endsAt),
    sourceUrl: item.sourceUrl,
  };
}

function newDraft(): RadioScheduleDraft {
  const startsAt = new Date();
  startsAt.setSeconds(0, 0);
  startsAt.setMinutes(Math.ceil(startsAt.getMinutes() / 5) * 5);
  const endsAt = new Date(startsAt.getTime() + 60 * 60 * 1000);
  return {
    id: `draft:${Date.now()}:${Math.random().toString(36).slice(2)}`,
    title: '',
    hostName: '',
    startDate: dateInput(startsAt),
    startTime: timeInput(startsAt),
    endDate: dateInput(endsAt),
    endTime: timeInput(endsAt),
    sourceUrl: null,
  };
}

function formatDay(value: Date) {
  const formatted = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }).format(value);
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

function formatTimeRange(item: PublicPageRadioScheduleItem) {
  const formatter = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return `${formatter.format(new Date(item.startsAt))}–${formatter.format(new Date(item.endsAt))}`;
}

export function RadioScheduleSection({ authToken, canManage, onNotify, username }: {
  authToken: string;
  canManage: boolean;
  onNotify: (message: string, type?: ToastMessage['type']) => void;
  username: string;
}) {
  const [items, setItems] = useState<PublicPageRadioScheduleItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [isEditorOpen, setIsEditorOpen] = useState(false);

  const load = async () => {
    setIsLoading(true);
    setError('');
    try {
      const response = await fetch(`${apiUrl}/public-pages/${encodeURIComponent(username)}/radio-schedule`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!response.ok) throw new Error(await readApiError(response, 'Не удалось загрузить расписание'));
      setItems(await response.json() as PublicPageRadioScheduleItem[]);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Не удалось загрузить расписание');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { void load(); }, [username]);



  return (
    <View style={localStyles.section}>
      <View style={localStyles.headingRow}>
        <Text style={localStyles.heading}><Text style={localStyles.slash}>/ </Text>Расписание</Text>
        {canManage ? <Pressable accessibilityRole="button" onPress={() => setIsEditorOpen(true)}><Text style={localStyles.manageLink}>Редактировать</Text></Pressable> : null}
      </View>
      {isLoading ? <LoadingIndicator style={localStyles.loader} /> : null}
      {!isLoading && error ? (
        <View style={localStyles.empty}>
          <Text style={localStyles.emptyTitle}>Не удалось загрузить расписание</Text>
          <Text style={localStyles.emptyText}>{error}</Text>
          <Pressable accessibilityRole="button" onPress={() => void load()} style={localStyles.retry}><Text style={localStyles.retryText}>Повторить</Text></Pressable>
        </View>
      ) : null}
      {!isLoading && !error && !items.length ? (
        <View style={localStyles.empty}>
          <CalendarClock color="#111" size={28} strokeWidth={1.8} />
          <Text style={localStyles.emptyTitle}>Расписание пока не опубликовано</Text>
        </View>
      ) : null}
      {!isLoading && !error ? <RadioScheduleList items={items} /> : null}
      <RadioScheduleEditor
        authToken={authToken}
        initialItems={items}
        isVisible={isEditorOpen}
        onClose={() => setIsEditorOpen(false)}
        onNotify={onNotify}
        onSaved={(nextItems) => { setItems(nextItems); setIsEditorOpen(false); }}
        username={username}
      />
    </View>
  );
}

function RadioScheduleEditor({ authToken, initialItems, isVisible, onClose, onNotify, onSaved, username }: {
  authToken: string;
  initialItems: PublicPageRadioScheduleItem[];
  isVisible: boolean;
  onClose: () => void;
  onNotify: (message: string, type?: ToastMessage['type']) => void;
  onSaved: (items: PublicPageRadioScheduleItem[]) => void;
  username: string;
}) {
  const insets = useSafeAreaInsets();
  const [drafts, setDrafts] = useState<RadioScheduleDraft[]>(() => initialItems.map(draftFromItem));
  const [pickerTarget, setPickerTarget] = useState<PickerTarget>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!isVisible) return;
    setDrafts(initialItems.map(draftFromItem));
    setPickerTarget(null);
  }, [initialItems, isVisible]);

  const updateDraft = (id: string, patch: Partial<RadioScheduleDraft>) => {
    setDrafts((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  };
  const selectedDraft = pickerTarget ? drafts.find((item) => item.id === pickerTarget.id) : null;
  const canSave = !isSaving && drafts.every((item) => {
    const startsAt = dateTimeInput(item.startDate, item.startTime);
    const endsAt = dateTimeInput(item.endDate, item.endTime);
    return item.title.trim() && startsAt && endsAt && endsAt > startsAt && endsAt.getTime() - startsAt.getTime() <= 48 * 60 * 60 * 1000;
  });

  const save = async () => {
    if (!canSave) return;
    setIsSaving(true);
    try {
      const response = await fetch(`${apiUrl}/public-pages/${encodeURIComponent(username)}/radio-schedule`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: drafts.map((item) => ({
            title: item.title.trim(),
            hostName: item.hostName.trim() || undefined,
            startsAt: dateTimeInput(item.startDate, item.startTime)!.toISOString(),
            endsAt: dateTimeInput(item.endDate, item.endTime)!.toISOString(),
            sourceUrl: item.sourceUrl ?? undefined,
          })),
        }),
      });
      if (!response.ok) throw new Error(await readApiError(response, 'Не удалось сохранить расписание'));
      const saved = await response.json() as PublicPageRadioScheduleItem[];
      onSaved(saved);
      onNotify('Расписание сохранено', 'success');
    } catch (saveError) {
      onNotify(saveError instanceof Error ? saveError.message : 'Не удалось сохранить расписание', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const pickerValue = selectedDraft && pickerTarget ? selectedDraft[pickerTarget.field] : '';
  const pickerDate = selectedDraft && pickerTarget?.field === 'endDate'
    ? dateTimeInput(selectedDraft.startDate, selectedDraft.startTime) ?? new Date(2020, 0, 1)
    : new Date(2020, 0, 1);

  return (
    <Modal animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen" visible={isVisible}>
      <View style={[localStyles.editor, { paddingTop: insets.top }]}>
        <View style={localStyles.editorHeader}>
          <Pressable accessibilityRole="button" disabled={isSaving} onPress={onClose} style={localStyles.headerAction}><Text style={localStyles.cancelText}>Отмена</Text></Pressable>
          <Text style={localStyles.editorTitle}>Расписание</Text>
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: !canSave }} disabled={!canSave} onPress={() => void save()} style={[localStyles.saveButton, !canSave && localStyles.saveButtonDisabled]}>
            {isSaving ? <LoadingIndicator tone="inverse" size="small" /> : <Text style={localStyles.saveText}>Сохранить</Text>}
          </Pressable>
        </View>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={localStyles.editorBody}>
          <ScrollView contentContainerStyle={[localStyles.editorContent, { paddingBottom: Math.max(24, insets.bottom + 16) }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {drafts.map((item, index) => (
              <View key={item.id} style={localStyles.editorCard}>
                <View style={localStyles.editorCardHeader}>
                  <Text style={localStyles.editorCardTitle}>Эфир {index + 1}</Text>
                  <Pressable accessibilityLabel={`Удалить эфир ${index + 1}`} accessibilityRole="button" onPress={() => setDrafts((current) => current.filter((draft) => draft.id !== item.id))} style={localStyles.deleteButton}><Trash2 color="#c62828" size={19} strokeWidth={1.9} /></Pressable>
                </View>
                <TextInput maxLength={160} onChangeText={(title) => updateDraft(item.id, { title })} placeholder="Название эфира" placeholderTextColor="#98a3ae" style={localStyles.input} value={item.title} />
                <TextInput maxLength={160} onChangeText={(hostName) => updateDraft(item.id, { hostName })} placeholder="Ведущий или участник (необязательно)" placeholderTextColor="#98a3ae" style={localStyles.input} value={item.hostName} />
                <Text style={localStyles.fieldLabel}>Начало</Text>
                <View style={localStyles.dateTimeRow}>
                  <Pressable accessibilityRole="button" onPress={() => setPickerTarget({ id: item.id, field: 'startDate' })} style={localStyles.dateButton}><Text style={localStyles.dateButtonText}>{item.startDate}</Text></Pressable>
                  <Pressable accessibilityRole="button" onPress={() => setPickerTarget({ id: item.id, field: 'startTime' })} style={localStyles.timeButton}><Text style={localStyles.dateButtonText}>{item.startTime}</Text></Pressable>
                </View>
                <Text style={localStyles.fieldLabel}>Окончание</Text>
                <View style={localStyles.dateTimeRow}>
                  <Pressable accessibilityRole="button" onPress={() => setPickerTarget({ id: item.id, field: 'endDate' })} style={localStyles.dateButton}><Text style={localStyles.dateButtonText}>{item.endDate}</Text></Pressable>
                  <Pressable accessibilityRole="button" onPress={() => setPickerTarget({ id: item.id, field: 'endTime' })} style={localStyles.timeButton}><Text style={localStyles.dateButtonText}>{item.endTime}</Text></Pressable>
                </View>
              </View>
            ))}
            <Pressable accessibilityRole="button" onPress={() => setDrafts((current) => [...current, newDraft()])} style={localStyles.addButton}><Plus color="#111" size={20} strokeWidth={2} /><Text style={localStyles.addButtonText}>Добавить эфир</Text></Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
        <CalendarPickerModal
          embedded
          isVisible={pickerTarget?.field === 'startDate' || pickerTarget?.field === 'endDate'}
          minDate={pickerDate}
          maxDate={new Date(new Date().getFullYear() + 1, 11, 31)}
          onClose={() => setPickerTarget(null)}
          onSelect={(value) => {
            if (pickerTarget) updateDraft(pickerTarget.id, { [pickerTarget.field]: value });
            setPickerTarget(null);
          }}
          selectedValue={pickerValue}
          title={pickerTarget?.field === 'endDate' ? 'Дата окончания' : 'Дата начала'}
        />
        <TimePickerModal
          embedded
          isVisible={pickerTarget?.field === 'startTime' || pickerTarget?.field === 'endTime'}
          onClose={() => setPickerTarget(null)}
          onSelect={(value) => {
            if (pickerTarget && value) updateDraft(pickerTarget.id, { [pickerTarget.field]: value });
            setPickerTarget(null);
          }}
          value={pickerValue}
        />
      </View>
    </Modal>
  );
}

const localStyles = StyleSheet.create({
  section: { paddingHorizontal: 16, paddingBottom: 16 },
  headingRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: 16, minHeight: 32 },
  heading: { color: '#111', fontSize: 18, fontWeight: '600', lineHeight: 24 },
  slash: { color: '#6f7b86' },
  manageLink: { color: '#218bdc', fontSize: 14, fontWeight: '600' },
  loader: { marginVertical: 24 },
  empty: { alignItems: 'center', gap: 8, justifyContent: 'center', minHeight: 176, paddingHorizontal: 24 },
  emptyTitle: { color: '#111', fontSize: 16, fontWeight: '600', textAlign: 'center' },
  emptyText: { color: '#6f7b86', fontSize: 14, lineHeight: 19, textAlign: 'center' },
  retry: { backgroundColor: '#f3f5f7', borderRadius: 22, minHeight: 44, justifyContent: 'center', paddingHorizontal: 20 },
  retryText: { color: '#111', fontSize: 14, fontWeight: '600' },
  dayGroup: { gap: 8, marginTop: 16 },
  dayTitle: { color: '#6f7b86', fontSize: 14, fontWeight: '600', lineHeight: 20 },
  dayList: { gap: 8 },
  item: { backgroundColor: '#f3f5f7', borderRadius: 8, gap: 4, padding: 14 },
  timeRow: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  time: { color: '#6f7b86', fontSize: 13, lineHeight: 18 },
  itemTitle: { color: '#111', fontSize: 16, fontWeight: '600', lineHeight: 22 },
  host: { color: '#53606c', fontSize: 14, lineHeight: 19 },
  editor: { backgroundColor: '#fff', flex: 1 },
  editorHeader: { alignItems: 'center', borderBottomColor: '#d7dee5', borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', minHeight: 62, paddingHorizontal: 16 },
  headerAction: { justifyContent: 'center', minHeight: 44, minWidth: 76 },
  cancelText: { color: '#111', fontSize: 16 },
  editorTitle: { color: '#111', flex: 1, fontSize: 16, fontWeight: '600', textAlign: 'center' },
  saveButton: { alignItems: 'center', backgroundColor: '#111', borderRadius: 8, height: 42, justifyContent: 'center', minWidth: 96, paddingHorizontal: 14 },
  saveButtonDisabled: { backgroundColor: '#aab4be', opacity: 0.7 },
  saveText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  editorBody: { flex: 1 },
  editorContent: { gap: 8, paddingHorizontal: 20, paddingTop: 16 },
  editorCard: { backgroundColor: '#f3f5f7', borderRadius: 8, gap: 8, padding: 14 },
  editorCardHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', minHeight: 32 },
  editorCardTitle: { color: '#111', fontSize: 16, fontWeight: '600' },
  deleteButton: { alignItems: 'center', height: 44, justifyContent: 'center', marginRight: -10, marginVertical: -6, width: 44 },
  input: { backgroundColor: '#fff', borderRadius: 8, color: '#111', fontSize: 16, minHeight: 44, paddingHorizontal: 16, paddingVertical: 10 },
  fieldLabel: { color: '#6f7b86', fontSize: 12, lineHeight: 17, marginTop: 4 },
  dateTimeRow: { flexDirection: 'row', gap: 8 },
  dateButton: { alignItems: 'center', backgroundColor: '#fff', borderRadius: 8, flex: 1, justifyContent: 'center', minHeight: 44, paddingHorizontal: 12 },
  timeButton: { alignItems: 'center', backgroundColor: '#fff', borderRadius: 8, justifyContent: 'center', minHeight: 44, width: 92 },
  dateButtonText: { color: '#111', fontSize: 16 },
  addButton: { alignItems: 'center', backgroundColor: '#f3f5f7', borderRadius: 22, flexDirection: 'row', gap: 8, justifyContent: 'center', minHeight: 44, paddingHorizontal: 18 },
  addButtonText: { color: '#111', fontSize: 14, fontWeight: '600' },
});


/** Data-only schedule presentation; fetching and editing belong to the section. */
export function RadioScheduleList({ items }: { items: PublicPageRadioScheduleItem[] }) {
  const groups = useMemo(() => {
    const grouped = new Map<string, { date: Date; items: PublicPageRadioScheduleItem[] }>();
    for (const item of items) {
      const date = new Date(item.startsAt);
      const key = dateInput(date);
      const group = grouped.get(key) ?? { date, items: [] };
      group.items.push(item);
      grouped.set(key, group);
    }
    return [...grouped.values()];
  }, [items]);
  return <>{groups.map((group) => (
        <View key={dateInput(group.date)} style={localStyles.dayGroup}>
          <Text style={localStyles.dayTitle}>{formatDay(group.date)}</Text>
          <View style={localStyles.dayList}>
            {group.items.map((item) => (
              <View accessibilityLabel={`${item.title}, ${formatTimeRange(item)}${item.hostName ? `, ${item.hostName}` : ''}`} key={item.id} style={localStyles.item}>
                <View style={localStyles.timeRow}><Clock3 color="#6f7b86" size={15} strokeWidth={1.9} /><Text style={localStyles.time}>{formatTimeRange(item)}</Text></View>
                <Text style={localStyles.itemTitle}>{item.title}</Text>
                {item.hostName ? <Text style={localStyles.host}>{item.hostName}</Text> : null}
              </View>
            ))}
          </View>
        </View>
      ))}</>;
}
