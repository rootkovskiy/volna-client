const test = require('node:test');
const assert = require('node:assert/strict');
const { formatPresence } = require('../src/chat-activity.mjs');

const now = Date.parse('2026-09-15T12:00:00Z');
test('online expires; hidden and unknown activity stays absent', () => {
  assert.equal(formatPresence(null, now), '');
  assert.equal(formatPresence({ onlineUntil: now + 1000, lastSeenAt: null }, now), 'Онлайн');
  assert.equal(formatPresence({ onlineUntil: now - 1, lastSeenAt: null }, now), '');
});
test('Russian minute/hour inflections, future clock clamp and old calendar dates', () => {
  for (const [minutes, expected] of [[0, 'недавно'], [1, '1 минуту назад'], [2, '2 минуты назад'], [11, '11 минут назад'], [21, '21 минуту назад'], [60, '1 час назад'], [120, '2 часа назад'], [660, '11 часов назад']]) {
    assert.equal(formatPresence({ lastSeenAt: new Date(now - minutes * 60_000).toISOString() }, now), `был(а) ${expected}`);
  }
  assert.equal(formatPresence({ lastSeenAt: new Date(now + 60000).toISOString() }, now), 'был(а) недавно');
  assert.match(formatPresence({ lastSeenAt: '2025-09-13T12:00:00Z' }, now), /2025/);
});
