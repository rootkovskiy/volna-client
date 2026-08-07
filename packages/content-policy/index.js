const LINK_PATTERN = /(?:\b(?:https?:\/\/|www\.)\S+|\b(?:[a-zа-яё0-9](?:[a-zа-яё0-9-]{0,61}[a-zа-яё0-9])?\.)+(?:ru|рф|com|net|org|io|me|ai|app|dev|site|online|club|social|music|band|fm|tv|cc|co|info|biz|pro|xyz|link|live|space|world|store|shop|рф)\b(?:[/?#]\S*)?)/iu;

const CYRILLIC_LOOKALIKES = new Map([
  ['a', 'а'],
  ['b', 'в'],
  ['c', 'с'],
  ['e', 'е'],
  ['k', 'к'],
  ['m', 'м'],
  ['o', 'о'],
  ['p', 'р'],
  ['t', 'т'],
  ['x', 'х'],
  ['y', 'у'],
  ['3', 'з'],
  ['4', 'ч'],
  ['6', 'б'],
  ['@', 'а'],
]);

const PROFANITY_STEMS = [
  /^ху(?:й|я|е|и|ю|йн|ев|ес|яр)/u,
  /^пизд/u,
  /^(?:за|на|по|про|вы|у|до|пере|подъ|отъ|разъ)?еб(?:а|и|у|ы|л|н|уч|ат|ош|ан|ен|ыр|ец|ло|нут|ись|аться|ывать)/u,
  /^бля(?:д|т|$)/u,
  /^долбоеб/u,
  /^муд(?:ак|ил|озвон)/u,
  /^сук(?:а|и|у|ой|е|ин)/u,
  /^пид(?:ор|ар|р)/u,
];

function normalizeProfanityToken(token) {
  const normalized = token.normalize('NFKC').toLowerCase().replace(/ё/g, 'е');
  if (!/[а-я]/u.test(normalized)) return normalized;
  return [...normalized]
    .map((character) => CYRILLIC_LOOKALIKES.get(character) || character)
    .join('')
    .replace(/[^а-я]/gu, '');
}

function isProfanityToken(token) {
  const normalized = normalizeProfanityToken(token);
  if (!normalized || normalized.startsWith('блях') || normalized.startsWith('бляшк')) return false;
  return PROFANITY_STEMS.some((pattern) => pattern.test(normalized));
}

function containsRussianProfanity(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  const normalized = value.normalize('NFKC').toLowerCase().replace(/ё/g, 'е');
  const tokens = normalized.match(/[а-яa-z0-9@]+/giu) || [];
  if (tokens.some(isProfanityToken)) return true;

  // Catch deliberately separated spellings such as "б.л.я" or "х у й".
  return /(?:б[\W_]{0,2}л[\W_]{0,2}я(?:[\W_]{0,2}(?:д|т)[\W_]{0,2}ь?)?(?![а-я])|х[\W_]{0,2}у[\W_]{0,2}й|п[\W_]{0,2}и[\W_]{0,2}з[\W_]{0,2}д)/iu.test(normalized);
}

function containsDisallowedLink(value) {
  return typeof value === 'string' && LINK_PATTERN.test(value.normalize('NFKC'));
}

function getProfileTextViolation(value) {
  if (containsDisallowedLink(value)) return 'link';
  if (containsRussianProfanity(value)) return 'profanity';
  return null;
}

module.exports = {
  containsDisallowedLink,
  containsRussianProfanity,
  getProfileTextViolation,
};
