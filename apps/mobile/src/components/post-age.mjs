const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

function plural(value, one, few, many) {
  const remainder100 = value % 100;
  if (remainder100 >= 11 && remainder100 <= 14) return many;
  const remainder10 = value % 10;
  return remainder10 === 1 ? one : remainder10 >= 2 && remainder10 <= 4 ? few : many;
}

export function postAge(value, nowMs = Date.now()) {
  const publishedMs = Date.parse(value);
  if (!Number.isFinite(publishedMs) || !Number.isFinite(nowMs)) return { label: '', nextUpdateMs: null };
  if (publishedMs > nowMs) return { label: '0 секунд назад', nextUpdateMs: Math.min(DAY, publishedMs - nowMs + SECOND) };

  const elapsed = nowMs - publishedMs;
  let count;
  let unit;
  let label;
  let nextUpdateMs;
  if (elapsed < MINUTE) {
    count = Math.floor(elapsed / SECOND);
    unit = plural(count, 'секунду', 'секунды', 'секунд');
    nextUpdateMs = SECOND - elapsed % SECOND;
  } else if (elapsed < HOUR) {
    count = Math.floor(elapsed / MINUTE);
    unit = plural(count, 'минуту', 'минуты', 'минут');
    nextUpdateMs = MINUTE - elapsed % MINUTE;
  } else if (elapsed < DAY) {
    count = Math.floor(elapsed / HOUR);
    unit = plural(count, 'час', 'часа', 'часов');
    nextUpdateMs = HOUR - elapsed % HOUR;
  } else if (elapsed < MONTH) {
    count = Math.floor(elapsed / DAY);
    unit = plural(count, 'день', 'дня', 'дней');
    nextUpdateMs = DAY - elapsed % DAY;
  } else if (elapsed < YEAR) {
    count = Math.min(11, Math.floor(elapsed / MONTH));
    unit = plural(count, 'месяц', 'месяца', 'месяцев');
    nextUpdateMs = count === 11 ? YEAR - elapsed : MONTH - elapsed % MONTH;
  } else {
    count = Math.floor(elapsed / YEAR);
    unit = plural(count, 'год', 'года', 'лет');
    nextUpdateMs = YEAR - elapsed % YEAR;
  }
  label = `${count} ${unit} назад`;
  return { label, nextUpdateMs: Math.min(DAY, nextUpdateMs) };
}
