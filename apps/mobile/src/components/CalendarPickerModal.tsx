import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { parseDateInput } from '../domain';
import { AppSheetModal } from './AppSheetModal';

export function formatDateValue(date: Date) {
  return `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.${date.getFullYear()}`;
}

function calendarOpeningMonth(selected: Date | null, min: Date, max: Date | null) {
  const preferred = selected ?? new Date();
  const bounded = preferred < min ? min : max && preferred > max ? max : preferred;
  return new Date(bounded.getFullYear(), bounded.getMonth(), 1);
}

export function CalendarPickerModal({ embedded = false, isVisible, maxDate, minDate, onClose, onSelect, selectedValue, title }: { embedded?: boolean; isVisible: boolean; maxDate?: Date; minDate: Date; onClose: () => void; onSelect: (value: string) => void; selectedValue: string; title: string }) {
  const normalizedMin = new Date(minDate.getFullYear(), minDate.getMonth(), minDate.getDate());
  const normalizedMax = maxDate ? new Date(maxDate.getFullYear(), maxDate.getMonth(), maxDate.getDate()) : null;
  const selected = parseDateInput(selectedValue);
  const [visibleMonth, setVisibleMonth] = useState(() => calendarOpeningMonth(selected, normalizedMin, normalizedMax));
  const [level, setLevel] = useState<'days' | 'months' | 'years'>('days');
  const [yearPage, setYearPage] = useState(() => Math.floor(visibleMonth.getFullYear() / 12) * 12);

  useEffect(() => {
    if (!isVisible) return;
    setVisibleMonth(calendarOpeningMonth(parseDateInput(selectedValue), normalizedMin, normalizedMax));
    setLevel('days');
  }, [isVisible, selectedValue, minDate.getFullYear(), minDate.getMonth(), minDate.getDate(), maxDate?.getFullYear(), maxDate?.getMonth(), maxDate?.getDate()]);

  const year = visibleMonth.getFullYear();
  const month = visibleMonth.getMonth();
  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = Array.from({ length: 42 }, (_, index) => {
    const day = index - firstWeekday + 1;
    return day >= 1 && day <= daysInMonth ? new Date(year, month, day) : null;
  });
  const previousMonth = new Date(year, month - 1, 1);
  const nextMonth = new Date(year, month + 1, 1);
  const canGoPrevious = new Date(previousMonth.getFullYear(), previousMonth.getMonth() + 1, 0) >= normalizedMin;
  const canGoNext = nextMonth.getFullYear() <= 9999 && (!normalizedMax || nextMonth <= normalizedMax);
  const minYear = normalizedMin.getFullYear();
  const maxYear = normalizedMax?.getFullYear() ?? 9999;
  const openYears = () => { setYearPage(Math.floor(year / 12) * 12); setLevel('years'); };
  const monthAllowed = (targetYear: number, targetMonth: number) => new Date(targetYear, targetMonth + 1, 0) >= normalizedMin
    && (!normalizedMax || new Date(targetYear, targetMonth, 1) <= normalizedMax);
  const setYear = (targetYear: number) => {
    setVisibleMonth(calendarOpeningMonth(new Date(targetYear, month, 1), normalizedMin, normalizedMax));
  };
  const months = Array.from({ length: 12 }, (_, index) => new Intl.DateTimeFormat('ru-RU', { month: 'long' }).format(new Date(2024, index, 1)));
  const previousEnabled = level === 'days' ? canGoPrevious : level === 'months' ? year > minYear : yearPage > minYear;
  const nextEnabled = level === 'days' ? canGoNext : level === 'months' ? year < maxYear : yearPage + 12 <= maxYear;
  const navigate = (direction: number) => {
    if (level === 'days') setVisibleMonth(direction < 0 ? previousMonth : nextMonth);
    else if (level === 'months') setYear(year + direction);
    else setYearPage(yearPage + direction * 12);
  };
  const stepLabel = level === 'days' ? 'месяц' : level === 'months' ? 'год' : '12 лет';

  return <AppSheetModal embedded={embedded} isVisible={isVisible} onClose={onClose} title={title}>
    <View style={calendarStyles.calendarMonthHeader}>
      <Pressable accessibilityRole="button" accessibilityLabel={level === 'years' ? 'Предыдущие 12 лет' : `Предыдущий ${stepLabel}`} accessibilityState={{ disabled: !previousEnabled }} disabled={!previousEnabled} onPress={() => navigate(-1)} style={[calendarStyles.calendarArrow, !previousEnabled && calendarStyles.calendarArrowDisabled]}><ChevronLeft color="#111" size={22} /></Pressable>
      <View style={calendarStyles.headingControls}>
        {level === 'days' ? <Pressable accessibilityRole="button" accessibilityLabel="Выбрать месяц" onPress={() => setLevel('months')} style={calendarStyles.headingButton}><Text numberOfLines={1} style={calendarStyles.headingText}>{months[month].charAt(0).toUpperCase() + months[month].slice(1)}</Text><ChevronDown size={14} color="#6f7b86" /></Pressable> : null}
        <Pressable accessibilityRole="button" accessibilityLabel={level === 'years' ? 'Вернуться к дням' : 'Выбрать год'} onPress={level === 'years' ? () => setLevel('days') : openYears} style={calendarStyles.headingButton}><Text numberOfLines={1} style={calendarStyles.headingText}>{level === 'years' ? `${Math.max(minYear, yearPage)}–${Math.min(maxYear, yearPage + 11)}` : year}</Text>{level !== 'years' ? <ChevronDown size={14} color="#6f7b86" /> : null}</Pressable>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={level === 'years' ? 'Следующие 12 лет' : `Следующий ${stepLabel}`} accessibilityState={{ disabled: !nextEnabled }} disabled={!nextEnabled} onPress={() => navigate(1)} style={[calendarStyles.calendarArrow, !nextEnabled && calendarStyles.calendarArrowDisabled]}><ChevronRight color="#111" size={22} /></Pressable>
    </View>
    {level === 'days' ? <>
    <View style={calendarStyles.calendarWeekdays}>{['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((day) => <Text key={day} style={calendarStyles.calendarWeekday}>{day}</Text>)}</View>
    <View style={calendarStyles.calendarGrid}>{cells.map((date, index) => {
      if (!date) return <View key={`empty-${index}`} style={calendarStyles.calendarDay} />;
      const disabled = date < normalizedMin || Boolean(normalizedMax && date > normalizedMax);
      const active = Boolean(selected && date.getFullYear() === selected.getFullYear() && date.getMonth() === selected.getMonth() && date.getDate() === selected.getDate());
      return <Pressable accessibilityLabel={formatDateValue(date)} accessibilityRole="button" accessibilityState={{ selected: active, disabled }} disabled={disabled} key={date.toISOString()} onPress={() => onSelect(formatDateValue(date))} style={[calendarStyles.calendarDay, active && calendarStyles.calendarDayActive]}><Text style={[calendarStyles.calendarDayText, disabled && calendarStyles.calendarDayTextDisabled, active && calendarStyles.calendarDayTextActive]}>{date.getDate()}</Text></Pressable>;
    })}</View>
    </> : <>
      <View style={calendarStyles.calendarGrid}>{Array.from({ length: 12 }, (_, index) => {
        const value = level === 'years' ? yearPage + index : index;
        const disabled = level === 'years' ? value < minYear || value > maxYear : !monthAllowed(year, value);
        const active = level === 'years' ? value === year : value === month;
        const label = level === 'years' ? String(value) : months[value].charAt(0).toUpperCase() + months[value].slice(1);
        return <Pressable key={value} accessibilityRole="button" accessibilityLabel={`Выбрать ${level === 'years' ? 'год' : 'месяц'} ${label}`} accessibilityState={{ selected: active, disabled }} disabled={disabled} onPress={() => {
          if (level === 'years') { setYear(value); setLevel('months'); }
          else { setVisibleMonth(new Date(year, value, 1)); setLevel('days'); }
        }} style={[calendarStyles.periodOption, active && calendarStyles.calendarDayActive]}><Text numberOfLines={1} style={[calendarStyles.calendarDayText, disabled && calendarStyles.calendarDayTextDisabled, active && calendarStyles.calendarDayTextActive]}>{label}</Text></Pressable>;
      })}</View>
      <Pressable accessibilityRole="button" onPress={() => setLevel('days')} style={calendarStyles.backToDays}><Text style={calendarStyles.headingText}>К календарю</Text></Pressable>
    </>}
  </AppSheetModal>;
}


const calendarStyles = StyleSheet.create({
  headingControls: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  headingButton: { minHeight: 44, flexShrink: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3, paddingHorizontal: 3 },
  headingText: { flexShrink: 1, color: '#111', fontSize: 16, lineHeight: 22, fontWeight: '600' },
  periodOption: { width: '33.3333%', minHeight: 52, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  backToDays: { minHeight: 44, marginTop: 12, alignItems: 'center', justifyContent: 'center' },
  calendarMonthHeader: { height: 48, marginBottom: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  calendarArrow: { width: 42, height: 42, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f3f5f7' },
  calendarArrowDisabled: { opacity: 0.3 },
  calendarWeekdays: { flexDirection: 'row', marginBottom: 4 },
  calendarWeekday: { width: '14.2857%', textAlign: 'center', fontSize: 12, lineHeight: 18, fontWeight: '600', color: '#6f7b86' },
  calendarGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calendarDay: { width: '14.2857%', aspectRatio: 1, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  calendarDayActive: { backgroundColor: '#111' },
  calendarDayText: { fontSize: 15, lineHeight: 20, color: '#111' },
  calendarDayTextDisabled: { color: '#aab4be' },
  calendarDayTextActive: { color: '#fff', fontWeight: '600' },
});
