export function formatPresence(presence, now = Date.now()) {
  if (!presence) return '';
  if (Number.isFinite(presence.onlineUntil) && presence.onlineUntil > now) return 'Онлайн';
  const date = Date.parse(presence.lastSeenAt);
  if (!Number.isFinite(date)) return '';
  const minutes = Math.max(0, Math.floor((now - date) / 60000));
  if (!minutes) return 'был(а) недавно';
  const plural = (n, one, few, many) => n % 100 >= 11 && n % 100 <= 14 ? many : n % 10 === 1 ? one : n % 10 >= 2 && n % 10 <= 4 ? few : many;
  if (minutes < 60) return `был(а) ${minutes} ${plural(minutes, 'минуту', 'минуты', 'минут')} назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `был(а) ${hours} ${plural(hours, 'час', 'часа', 'часов')} назад`;
  return `был(а) ${new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', ...(new Date(date).getFullYear() !== new Date(now).getFullYear() ? { year: 'numeric' } : {}) }).format(date)}`;
}
