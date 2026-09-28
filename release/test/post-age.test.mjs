import assert from 'node:assert/strict';
import test from 'node:test';
import { postAge } from '../../apps/mobile/src/components/post-age.mjs';

const NOW = Date.parse('2026-09-28T12:00:00.000Z');
const age = elapsedMs => postAge(new Date(NOW - elapsedMs).toISOString(), NOW);

test('post age uses seconds through years and changes at each unit boundary', () => {
  for (const [elapsed, label, nextUpdateMs] of [
    [0, '0 секунд назад', 1_000],
    [1_000, '1 секунду назад', 1_000],
    [59_999, '59 секунд назад', 1],
    [60_000, '1 минуту назад', 60_000],
    [59 * 60_000, '59 минут назад', 60_000],
    [60 * 60_000, '1 час назад', 3_600_000],
    [24 * 3_600_000, '1 день назад', 86_400_000],
    [5 * 86_400_000, '5 дней назад', 86_400_000],
    [30 * 86_400_000, '1 месяц назад', 86_400_000],
    [60 * 86_400_000, '2 месяца назад', 86_400_000],
    [365 * 86_400_000, '1 год назад', 86_400_000],
    [5 * 365 * 86_400_000, '5 лет назад', 86_400_000],
  ]) {
    assert.deepEqual(age(elapsed), { label, nextUpdateMs });
  }
});

test('post age has Russian singular and plural forms, and handles invalid or future time', () => {
  assert.equal(age(21_000).label, '21 секунду назад');
  assert.equal(age(22 * 60_000).label, '22 минуты назад');
  assert.equal(age(14 * 3_600_000).label, '14 часов назад');
  assert.equal(age(21 * 86_400_000).label, '21 день назад');
  assert.equal(age(11 * 30 * 86_400_000).label, '11 месяцев назад');
  assert.deepEqual(postAge('not a date', NOW), { label: '', nextUpdateMs: null });
  assert.equal(postAge(new Date(NOW + 60_000).toISOString(), NOW).label, '0 секунд назад');
});
