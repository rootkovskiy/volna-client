import { Platform } from 'react-native';
import {
  buildMusicGenreValue,
  canonicalizeMusicGenreValue,
  isMusicSubgenreValue,
  musicGenreSearchText,
  musicSubgenreDisplayName,
  musicTaxonomy,
  normalizeMusicGenreList,
  profileMusicGenreLimit,
  releasePrimaryGenreLimit,
  splitReleaseGenres,
} from '@volna/music-taxonomy';
import { getProfileTextViolation } from '@volna/content-policy';
import { apiFetch as fetch, apiUrl, baseFetch, readApiError } from './api/client';
import type { ApiMessagePrivacy, EventArtistDraft, MessagePrivacy, PublicPageTypeGroup, SocialLinkKind } from './types';

export { buildMusicGenreValue, canonicalizeMusicGenreValue, isMusicSubgenreValue, musicGenreSearchText, musicSubgenreDisplayName, musicTaxonomy, profileMusicGenreLimit, releasePrimaryGenreLimit, splitReleaseGenres };

export const profilePreviewPlayers = new globalThis.Map<string, () => void>();
export const countryOptions = buildCountryOptions();
export const phoneCountryOptions = [
  { country: 'Россия', code: '+7' }, { country: 'Беларусь', code: '+375' }, { country: 'Казахстан', code: '+7' },
  { country: 'Армения', code: '+374' }, { country: 'Грузия', code: '+995' }, { country: 'Азербайджан', code: '+994' },
  { country: 'Кыргызстан', code: '+996' }, { country: 'Узбекистан', code: '+998' }, { country: 'Таджикистан', code: '+992' },
  { country: 'Молдова', code: '+373' }, { country: 'Турция', code: '+90' }, { country: 'Германия', code: '+49' },
  { country: 'Франция', code: '+33' }, { country: 'Великобритания', code: '+44' }, { country: 'США и Канада', code: '+1' },
  { country: 'Израиль', code: '+972' },
] as const;
export const musicGenreLimit = profileMusicGenreLimit;
export const audioReleaseGenreLimit = 5;
export const connectInterestLimit = 5;
export const connectInterestGroups = [
  { title: 'Визуальное искусство', items: [
    ['PAINTING', 'Живопись'], ['ILLUSTRATION', 'Иллюстрация'], ['SCULPTURE', 'Скульптура'], ['PHOTOGRAPHY', 'Фотография'], ['STREET_ART', 'Стрит-арт'], ['CALLIGRAPHY', 'Каллиграфия'], ['COMICS_MANGA', 'Комиксы и манга'], ['COLLAGE', 'Коллаж'], ['THREE_D_ART', '3D-арт'],
  ] },
  { title: 'Музыка', items: [
    ['SINGING', 'Пение'], ['ELECTRONIC_MUSIC', 'Электронная музыка'], ['ELECTRONIC_MUSIC_PRODUCTION', 'Создание электронной музыки'], ['DJING', 'Диджеинг'], ['LIVE_SOUND', 'Рок-концерты'], ['GIG_ATTENDANCE', 'Посещение гигов'], ['RAVE_CULTURE', 'Рейв-культура'], ['ROCK_MUSIC', 'Рок-музыка'], ['POP_MUSIC', 'Поп-музыка'], ['RAP', 'Хип-хоп'], ['VINYL_COLLECTING', 'Коллекционирование винила'], ['CASSETTE_COLLECTING', 'Коллекционирование кассет'],
  ] },
  { title: 'Кино и сцена', items: [
    ['CINEMA', 'Кино'], ['DIRECTING', 'Режиссура'], ['SCREENWRITING', 'Сценарное мастерство'], ['VIDEO_ART', 'Видеоарт'], ['ANIMATION', 'Анимация'], ['THEATER', 'Театр'], ['ACTING', 'Актёрское мастерство'], ['PERFORMANCE', 'Перформанс'], ['DANCE', 'Танец'], ['SCENOGRAPHY', 'Сценография'],
  ] },
  { title: 'Дизайн и архитектура', items: [
    ['GRAPHIC_DESIGN', 'Графический дизайн'], ['INTERIOR_DESIGN', 'Дизайн интерьеров'], ['FASHION_DESIGN', 'Дизайн одежды'], ['ARCHITECTURE', 'Архитектура'], ['TYPOGRAPHY', 'Типографика'], ['UX_UI', 'UX/UI-дизайн'], ['PRODUCT_DESIGN', 'Предметный дизайн'],
  ] },
  { title: 'Тексты и медиа', items: [
    ['WRITING', 'Писательство'], ['POETRY', 'Поэзия'], ['JOURNALISM', 'Журналистика'], ['BLOGGING', 'Блогинг'],
  ] },
  { title: 'Ремёсла', items: [
    ['HANDICRAFT', 'Рукоделие'], ['WOOD_CARVING', 'Резьба по дереву'], ['CERAMICS', 'Керамика'], ['JEWELRY', 'Ювелирное дело'], ['FLORISTRY', 'Флористика'], ['RESTORATION', 'Реставрация'],
  ] },
  { title: 'Культура и события', items: [
    ['EXHIBITIONS', 'Выставки'], ['CURATING', 'Кураторство'], ['EVENT_PRODUCTION', 'Организация событий'],
  ] },
] as const;
export const connectInterestLabels: Record<string, string> = connectInterestGroups.reduce<Record<string, string>>((labels, group) => {
  group.items.forEach(([value, label]) => {
    labels[value] = label;
  });
  return labels;
}, {});

export function normalizePhoneDigits(value: string, maxLength = 15) {
  return value.replace(/\D/g, '').slice(0, maxLength);
}

export function splitInternationalPhone(value?: string | null) {
  const digits = normalizePhoneDigits(value || '');
  const option = [...phoneCountryOptions].sort((a, b) => b.code.length - a.code.length).find((item) => digits.startsWith(item.code.slice(1))) || phoneCountryOptions[0];
  const codeDigits = option.code.slice(1);
  return { code: option.code, number: digits.startsWith(codeDigits) ? digits.slice(codeDigits.length) : digits };
}

export function normalizeUsernameInput(value: string, maxLength = 30) {
  return value.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, maxLength);
}

export const publicPageTypeGroups: PublicPageTypeGroup[] = [
  {
    title: 'Локации',
    values: [
      'BAR',
      'CLUB',
      'JAZZ_CLUB',
      'RESTAURANT',
      'PIZZERIA',
      'KEBAB',
      'FAST_FOOD',
      'TATTOO',
      'BARBERSHOP',
      'BEAUTY',
      'VINYL',
      'VINTAGE_STORE',
      'CLOTHING',
      'ACCESSORIES',
      'ART_CLUSTER',
      'MUSIC_FESTIVAL',
      'FILM_FESTIVAL',
      'CINEMA',
      'MUSEUM',
      'WORKSHOP',
      'THEATER',
      'COFFEE_SHOP',
      'CREATIVE_HUB',
      'CONCERT_VENUE',
      'EXHIBITION_SPACE',
      'GALLERY',
    ],
  },
  {
    title: 'Организации',
    values: ['CLOTHING_BRAND', 'MUSIC_LABEL', 'MUSIC_BAND', 'MUSIC_DUO', 'PODCAST', 'RADIO_STATION', 'BOOKING_AGENCY', 'PROMO_GROUP', 'CREATIVE_COLLECTIVE', 'PRODUCTION_STUDIO', 'DESIGN_STUDIO', 'INDEPENDENT_MEDIA'],
  },
];

export const publicPageTypeLabels: Record<string, string> = {
  BAR: 'Бар',
  CLUB: 'Клуб',
  JAZZ_CLUB: 'Джаз-клуб',
  RESTAURANT: 'Ресторан',
  PIZZERIA: 'Пиццерия',
  KEBAB: 'Кебабная',
  FAST_FOOD: 'Фастфуд',
  TATTOO: 'Тату-салон',
  BARBERSHOP: 'Барбершоп',
  BEAUTY: 'Бьюти-студия',
  VINYL: 'Рекорд-стор',
  VINTAGE_STORE: 'Винтажный магазин',
  CLOTHING: 'Одежда',
  CLOTHING_BRAND: 'Бренд одежды',
  ACCESSORIES: 'Аксессуары',
  ART_CLUSTER: 'Арт-кластер',
  MUSIC_LABEL: 'Музыкальный лейбл',
  MUSIC_BAND: 'Музыкальная группа',
  MUSIC_DUO: 'Музыкальный дуэт',
  PODCAST: 'Подкаст',
  RADIO_STATION: 'Радиостанция',
  BOOKING_AGENCY: 'Букинг-агентство',
  PROMO_GROUP: 'Промо-команда',
  CREATIVE_COLLECTIVE: 'Творческое объединение',
  MUSIC_FESTIVAL: 'Музыкальный фестиваль',
  FILM_FESTIVAL: 'Кинофестиваль',
  CINEMA: 'Кинотеатр',
  MUSEUM: 'Музей',
  WORKSHOP: 'Мастерская',
  THEATER: 'Театр',
  COFFEE_SHOP: 'Кофейня',
  CREATIVE_HUB: 'Креативный хаб',
  DESIGN_STUDIO: 'Студия дизайна',
  PRODUCTION_STUDIO: 'Продакшн-студия',
  CONCERT_VENUE: 'Концертная площадка',
  EXHIBITION_SPACE: 'Выставочное пространство',
  GALLERY: 'Галерея',
  INDEPENDENT_MEDIA: 'Независимое медиа',
};


export function buildCountryOptions() {
  try {
    const intlWithRegions = Intl as typeof Intl & {
      supportedValuesOf?: (key: 'region') => string[];
    };
    const regionCodes = intlWithRegions.supportedValuesOf?.('region') ?? [];
    const displayNames = new Intl.DisplayNames(['ru'], { type: 'region' });
    const names = regionCodes
      .map((code) => displayNames.of(code))
      .filter((name): name is string => Boolean(name));

    return Array.from(new Set(names)).sort((first, second) => first.localeCompare(second, 'ru'));
  } catch {
    return [
      'Австралия',
      'Австрия',
      'Азербайджан',
      'Аргентина',
      'Армения',
      'Беларусь',
      'Бельгия',
      'Бразилия',
      'Великобритания',
      'Германия',
      'Грузия',
      'Дания',
      'Израиль',
      'Индия',
      'Испания',
      'Италия',
      'Казахстан',
      'Канада',
      'Китай',
      'Нидерланды',
      'Норвегия',
      'Польша',
      'Португалия',
      'Россия',
      'Сербия',
      'США',
      'Турция',
      'Узбекистан',
      'Украина',
      'Финляндия',
      'Франция',
      'Черногория',
      'Швеция',
      'Япония',
    ];
  }
}

export function buildSoundcloudPlayerUrl(soundcloudUrl: string) {
  return `https://w.soundcloud.com/player/?url=${encodeURIComponent(
    soundcloudUrl,
  )}&color=%23090909&auto_play=false&hide_related=false&show_artwork=false&show_comments=true&show_user=true&show_reposts=false&show_teaser=false`;
}

export function formatCountryCity(countryName: string, cityName: string) {
  const country = countryName.trim();
  const city = cityName.trim();

  if (!country) {
    return city;
  }

  if (!city) {
    return country;
  }

  return city.toLowerCase().startsWith(`${country.toLowerCase()},`) ? city : `${country}, ${city}`;
}

export function formatCityName(countryName: string, cityName: string) {
  const country = countryName.trim();
  const city = cityName.trim();

  if (!city) {
    return '';
  }

  if (country && city.toLowerCase().startsWith(`${country.toLowerCase()},`)) {
    return city.slice(country.length + 1).trim();
  }

  const commaIndex = city.indexOf(',');
  return commaIndex >= 0 ? city.slice(commaIndex + 1).trim() : city;
}

export function parseDateTimeInput(dateValue: string, timeValue: string) {
  const dateMatch = dateValue.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  const normalizedTime = timeValue.trim();
  const timeMatch = normalizedTime ? normalizedTime.match(/^(\d{2}):(\d{2})$/) : null;

  if (!dateMatch || (normalizedTime && !timeMatch)) {
    return null;
  }

  const day = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const year = Number(dateMatch[3]);
  const hours = timeMatch ? Number(timeMatch[1]) : 0;
  const minutes = timeMatch ? Number(timeMatch[2]) : 0;
  const parsed = new Date(year, month - 1, day, hours, minutes);

  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day ||
    parsed.getHours() !== hours ||
    parsed.getMinutes() !== minutes
  ) {
    return null;
  }

  return parsed;
}

export function parseDateInput(dateValue: string) {
  return parseDateTimeInput(dateValue, '');
}

export function getEndOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59);
}

export function createEventArtistDraft(): EventArtistDraft {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    accountUsername: null,
    displayName: '',
    query: '',
    stageName: '',
    startDate: '',
    endDate: '',
    startTime: '',
    endTime: '',
  };
}

async function discardTemporaryImageUpload(uploadKey: string, authToken: string, administrativeTarget = false) {
  try {
    await fetch(`${apiUrl}/media/discard-upload`, {
      method: 'POST',
      headers: {
        ...(administrativeTarget ? { 'x-volna-admin-mode': '1' } : {}),
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ uploadKey }),
    });
  } catch {
    // The private incoming bucket has a one-day lifecycle as a final fallback.
  }
}


export async function uploadAvatarAsset(
  localUri: string,
  authToken: string,
  kind: 'account' | 'community',
  communityUsername?: string,
  accountUsername?: string,
) {
  const administrativeAccountTarget = Boolean(accountUsername);
  const prepareResponse = await fetch(`${apiUrl}/media/avatar-upload`, {
    method: 'POST',
    headers: {
      ...(administrativeAccountTarget ? { 'x-volna-admin-mode': '1' } : {}),
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ kind, communityUsername, accountUsername }),
  });
  if (!prepareResponse.ok) {
    throw new Error(await readApiError(prepareResponse, 'Не удалось подготовить загрузку аватарки'));
  }

  const upload = (await prepareResponse.json()) as {
    uploadUrl: string;
    fields: Record<string, string>;
    uploadKey: string;
  };
  try {
    const form = new FormData();
    Object.entries(upload.fields).forEach(([key, value]) => form.append(key, value));
    if (Platform.OS === 'web') {
      const blob = await baseFetch(localUri).then((response) => response.blob());
      form.append('file', blob, 'avatar.jpg');
    } else {
      form.append('file', { uri: localUri, name: 'avatar.jpg', type: 'image/jpeg' } as never);
    }
    const uploadResponse = await baseFetch(upload.uploadUrl, { method: 'POST', body: form });
    if (!uploadResponse.ok) {
      throw new Error('Не удалось загрузить аватарку');
    }
    const finalizeResponse = await fetch(`${apiUrl}/media/avatar-finalize`, {
      method: 'POST',
      headers: {
        ...(administrativeAccountTarget ? { 'x-volna-admin-mode': '1' } : {}),
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ kind, communityUsername, accountUsername, uploadKey: upload.uploadKey }),
    });
    if (!finalizeResponse.ok) {
      throw new Error(await readApiError(finalizeResponse, 'Не удалось обработать аватарку'));
    }
    return (await finalizeResponse.json()) as { avatarUrl: string; avatarKey: string };
  } catch (error) {
    await discardTemporaryImageUpload(upload.uploadKey, authToken, administrativeAccountTarget);
    throw error;
  }
}

export function getAvatarInitial(name: string) {
  return name.trim().slice(0, 1).toUpperCase() || '?';
}

export function formatDateInput(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)].filter(Boolean).join('.');
}

export function russianPlural(count: number, one: string, few: string, many: string) {
  const absolute = Math.abs(Math.trunc(count));
  const lastTwo = absolute % 100;
  const last = absolute % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

export function toApiMessagePrivacy(value: MessagePrivacy): ApiMessagePrivacy {
  const map: Record<MessagePrivacy, ApiMessagePrivacy> = {
    everyone: 'EVERYONE',
    following: 'FOLLOWING',
    nobody: 'NOBODY',
  };

  return map[value];
}

export function fromApiMessagePrivacy(value: ApiMessagePrivacy): MessagePrivacy {
  const map: Record<ApiMessagePrivacy, MessagePrivacy> = {
    EVERYONE: 'everyone',
    FOLLOWING: 'following',
    NOBODY: 'nobody',
  };

  return map[value];
}

export function validateUsername(value: string) {
  return /^(?=.{3,20}$)(?=.*[a-zA-Z])[a-zA-Z0-9_]+$/.test(value.trim().replace(/^@/, ''))
    ? null
    : 'Username должен быть 3-20 символов и содержать хотя бы одну латинскую букву';
}

export function validateRequiredText(value: string, message: string, minLength = 2) {
  return value.trim().length >= minLength ? null : message;
}

export function validateDisplayName(value: string) {
  const normalized = value.trim();
  if (normalized.length < 2 || normalized.length > 30) return 'Имя должно содержать от 2 до 30 символов';
  if (!/\p{L}/u.test(normalized)) return 'Добавьте в имя хотя бы одну букву';
  if (/\s{2,}/u.test(normalized)) return 'Уберите повторяющиеся пробелы';
  const emojiPattern = /(?:\p{Regional_Indicator}{2}|\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?)*)/gu;
  const emojis = normalized.match(emojiPattern) ?? [];
  if (emojis.length > 1) return 'Можно добавить только один emoji';
  const contentViolation = getProfileTextViolation(normalized);
  if (contentViolation === 'link') return 'Имя не должно содержать ссылки';
  if (contentViolation === 'profanity') return 'Имя не должно содержать нецензурную лексику';
  const nameWithoutEmoji = normalized.replace(emojiPattern, '').trim().replace(/\s+/g, ' ');
  return /^[\p{L}\p{M}\p{N}](?:[\p{L}\p{M}\p{N} .’'&-]*[\p{L}\p{M}\p{N}])?$/u.test(nameWithoutEmoji)
    ? null
    : 'Допустимы буквы, цифры, один emoji, пробелы, точки, дефисы, апострофы и &';
}

export function validateOptionalUrl(value: string, label: string, hosts: string[]) {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    const hostname = parsed.hostname.replace(/^www\./, '').toLowerCase();
    const isAllowedHost = hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`));

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return `${label}: ссылка должна начинаться с http:// или https://`;
    }

    return isAllowedHost ? null : `${label}: ссылка должна вести на ${hosts[0]}`;
  } catch {
    return `${label}: укажите корректную ссылку`;
  }
}

export function normalizeSocialPath(value: string) {
  return value.trim().replace(/^@+/, '').replace(/^\/+/, '').replace(/\s+/g, '');
}

export function normalizeSocialLink(value: string, provider: SocialLinkKind) {
  const trimmed = value.trim();

  if (!trimmed) {
    return { error: null, url: '' };
  }

  const config: Record<SocialLinkKind, { label: string; hosts: string[]; build: (path: string) => string }> = {
    bandcamp: {
      label: 'Bandcamp',
      hosts: ['bandcamp.com'],
      build: (path) => `https://${normalizeSocialPath(path).split('/')[0]}.bandcamp.com`,
    },
    instagram: {
      label: 'Instagram',
      hosts: ['instagram.com'],
      build: (path) => `https://instagram.com/${normalizeSocialPath(path)}`,
    },
    letterboxd: {
      label: 'Letterboxd',
      hosts: ['letterboxd.com'],
      build: (path) => `https://letterboxd.com/${normalizeSocialPath(path)}`,
    },
    soundcloud: {
      label: 'SoundCloud',
      hosts: ['soundcloud.com'],
      build: (path) => `https://soundcloud.com/${normalizeSocialPath(path)}`,
    },
    threads: {
      label: 'Threads',
      hosts: ['threads.net'],
      build: (path) => `https://threads.net/@${normalizeSocialPath(path)}`,
    },
    telegram: {
      label: 'Telegram',
      hosts: ['t.me', 'telegram.me', 'telegram.org'],
      build: (path) => `https://t.me/${normalizeSocialPath(path)}`,
    },
    youtube: {
      label: 'YouTube',
      hosts: ['youtube.com', 'youtu.be'],
      build: (path) => `https://youtube.com/@${normalizeSocialPath(path)}`,
    },
  };
  const providerConfig = config[provider];
  const withProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const parsed = new URL(withProtocol);
    const hostname = parsed.hostname.replace(/^www\./, '').toLowerCase();
    const isAllowedHost = providerConfig.hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`));

    if (isAllowedHost && ['http:', 'https:'].includes(parsed.protocol)) {
      parsed.protocol = 'https:';
      return { error: null, url: parsed.toString() };
    }

    if (!trimmed.includes('.') && !trimmed.includes(':')) {
      const builtUrl = providerConfig.build(trimmed);
      return normalizeSocialLink(builtUrl, provider);
    }

    return { error: `${providerConfig.label}: проверьте ссылку или username`, url: '' };
  } catch {
    const normalizedPath = normalizeSocialPath(trimmed);

    if (!normalizedPath) {
      return { error: null, url: '' };
    }

    return normalizeSocialLink(providerConfig.build(normalizedPath), provider);
  }
}

export function normalizeBandcampEmbedInput(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return { error: null, url: '' };
  }

  try {
    const parsed = new URL(trimmed);
    const hostname = parsed.hostname.replace(/^www\./, '').toLowerCase();

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { error: 'Bandcamp: ссылка должна начинаться с http:// или https://', url: '' };
    }

    const isBandcampHost = hostname === 'bandcamp.com' || hostname.endsWith('.bandcamp.com');
    if (!isBandcampHost || !/^\/(album|track)\/[a-z0-9][a-z0-9-]*\/?$/i.test(parsed.pathname)) {
      return { error: 'Bandcamp: принимается только ссылка на альбом или трек', url: '' };
    }

    parsed.search = '';
    parsed.hash = '';
    parsed.protocol = 'https:';
    return { error: null, url: parsed.toString() };
  } catch {
    return { error: 'Bandcamp: вставьте ссылку на альбом или трек', url: '' };
  }
}

export async function uploadPostImageAsset(localUri: string, authToken: string) {
  const prepareResponse = await fetch(`${apiUrl}/media/content-upload`, {
    method: 'POST',
    headers: { ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}), 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'post-image', target: 'post' }),
  });
  if (!prepareResponse.ok) throw new Error(await readApiError(prepareResponse, 'Не удалось подготовить изображение'));
  const upload = await prepareResponse.json() as { uploadUrl: string; fields: Record<string, string>; uploadKey: string };
  try {
    const form = new FormData();
    Object.entries(upload.fields).forEach(([key, value]) => form.append(key, value));
    if (Platform.OS === 'web') {
      form.append('file', await baseFetch(localUri).then((response) => response.blob()), 'post.jpg');
    } else {
      form.append('file', { uri: localUri, name: 'post.jpg', type: 'image/jpeg' } as never);
    }
    const uploaded = await baseFetch(upload.uploadUrl, { method: 'POST', body: form });
    if (!uploaded.ok) throw new Error('Не удалось загрузить изображение');
    const finalized = await fetch(`${apiUrl}/media/content-finalize`, {
      method: 'POST',
      headers: { ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}), 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'post-image', target: 'post', uploadKey: upload.uploadKey }),
    });
    if (!finalized.ok) throw new Error(await readApiError(finalized, 'Не удалось обработать изображение'));
    const asset = await finalized.json() as { assetKey: string; assetUrl: string };
    return { imageKey: asset.assetKey, imageUrl: asset.assetUrl };
  } catch (error) {
    await discardTemporaryImageUpload(upload.uploadKey, authToken);
    throw error;
  }
}

export async function uploadEventPosterAsset(localUri: string, authToken: string, eventId: string, thumbnailLocalUri?: string) {
  const prepareResponse = await fetch(`${apiUrl}/media/content-upload`, {
    method: 'POST',
    headers: { ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}), 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'event-poster', target: eventId }),
  });
  if (!prepareResponse.ok) throw new Error(await readApiError(prepareResponse, 'Не удалось подготовить афишу'));
  const upload = await prepareResponse.json() as { uploadUrl: string; fields: Record<string, string>; uploadKey: string };
  let asset: { assetKey: string; assetUrl: string };
  try {
    const form = new FormData();
    Object.entries(upload.fields).forEach(([key, value]) => form.append(key, value));
    if (Platform.OS === 'web') form.append('file', await baseFetch(localUri).then((response) => response.blob()), 'event-poster.jpg');
    else form.append('file', { uri: localUri, name: 'event-poster.jpg', type: 'image/jpeg' } as never);
    const uploaded = await baseFetch(upload.uploadUrl, { method: 'POST', body: form });
    if (!uploaded.ok) throw new Error('Не удалось загрузить афишу');
    const finalized = await fetch(`${apiUrl}/media/content-finalize`, {
      method: 'POST',
      headers: { ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}), 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'event-poster', target: eventId, uploadKey: upload.uploadKey }),
    });
    if (!finalized.ok) throw new Error(await readApiError(finalized, 'Не удалось обработать афишу'));
    asset = await finalized.json() as { assetKey: string; assetUrl: string };
  } catch (error) {
    await discardTemporaryImageUpload(upload.uploadKey, authToken);
    throw error;
  }
  if (thumbnailLocalUri) {
    const thumbnailPrepareResponse = await fetch(`${apiUrl}/media/content-upload`, {
      method: 'POST',
      headers: { ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}), 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'event-poster-thumbnail', target: eventId }),
    });
    if (!thumbnailPrepareResponse.ok) throw new Error(await readApiError(thumbnailPrepareResponse, 'Не удалось подготовить миниатюру афиши'));
    const thumbnailUpload = await thumbnailPrepareResponse.json() as { uploadUrl: string; fields: Record<string, string>; uploadKey: string };
    try {
      const thumbnailForm = new FormData();
      Object.entries(thumbnailUpload.fields).forEach(([key, value]) => thumbnailForm.append(key, value));
      if (Platform.OS === 'web') thumbnailForm.append('file', await baseFetch(thumbnailLocalUri).then((response) => response.blob()), 'event-poster-thumbnail.jpg');
      else thumbnailForm.append('file', { uri: thumbnailLocalUri, name: 'event-poster-thumbnail.jpg', type: 'image/jpeg' } as never);
      const thumbnailUploaded = await baseFetch(thumbnailUpload.uploadUrl, { method: 'POST', body: thumbnailForm });
      if (!thumbnailUploaded.ok) throw new Error('Не удалось загрузить миниатюру афиши');
      const thumbnailFinalized = await fetch(`${apiUrl}/media/content-finalize`, {
        method: 'POST',
        headers: { ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}), 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'event-poster-thumbnail', target: eventId, uploadKey: thumbnailUpload.uploadKey }),
      });
      if (!thumbnailFinalized.ok) throw new Error(await readApiError(thumbnailFinalized, 'Не удалось обработать миниатюру афиши'));
    } catch (error) {
      await discardTemporaryImageUpload(thumbnailUpload.uploadKey, authToken);
      throw error;
    }
  }
  return asset;
}

export async function uploadConnectPhotoAsset(localUri: string, authToken: string, target = 'account') {
  const administrativeAccountTarget = target.startsWith('account:');
  const prepareResponse = await fetch(`${apiUrl}/media/content-upload`, {
    method: 'POST',
    headers: { ...(administrativeAccountTarget ? { 'x-volna-admin-mode': '1' } : {}), ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}), 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'connect-photo', target }),
  });
  if (!prepareResponse.ok) throw new Error(await readApiError(prepareResponse, 'Не удалось подготовить фотографию'));
  const upload = await prepareResponse.json() as { uploadUrl: string; fields: Record<string, string>; uploadKey: string };
  try {
    const form = new FormData();
    Object.entries(upload.fields).forEach(([key, value]) => form.append(key, value));
    if (Platform.OS === 'web') form.append('file', await baseFetch(localUri).then((response) => response.blob()), 'connect.jpg');
    else form.append('file', { uri: localUri, name: 'connect.jpg', type: 'image/jpeg' } as never);
    const uploaded = await baseFetch(upload.uploadUrl, { method: 'POST', body: form });
    if (!uploaded.ok) throw new Error('Не удалось загрузить фотографию');
    const finalized = await fetch(`${apiUrl}/media/content-finalize`, {
      method: 'POST',
      headers: { ...(administrativeAccountTarget ? { 'x-volna-admin-mode': '1' } : {}), ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}), 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'connect-photo', target, uploadKey: upload.uploadKey }),
    });
    if (!finalized.ok) throw new Error(await readApiError(finalized, 'Не удалось обработать фотографию'));
    const asset = await finalized.json() as { assetKey: string; assetUrl: string };
    return { imageKey: asset.assetKey, imageUrl: asset.assetUrl };
  } catch (error) {
    await discardTemporaryImageUpload(upload.uploadKey, authToken, administrativeAccountTarget);
    throw error;
  }
}

export async function uploadCategoryCoverAsset(localUri: string, authToken: string, target: string) {
  const prepareResponse = await fetch(`${apiUrl}/media/content-upload`, {
    method: 'POST',
    headers: { ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}), 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'category-cover', target }),
  });
  if (!prepareResponse.ok) throw new Error(await readApiError(prepareResponse, 'Не удалось подготовить обложку'));
  const upload = await prepareResponse.json() as { uploadUrl: string; fields: Record<string, string>; uploadKey: string };
  try {
    const form = new FormData();
    Object.entries(upload.fields).forEach(([key, value]) => form.append(key, value));
    if (Platform.OS === 'web') form.append('file', await baseFetch(localUri).then((response) => response.blob()), 'category-cover.jpg');
    else form.append('file', { uri: localUri, name: 'category-cover.jpg', type: 'image/jpeg' } as never);
    const uploaded = await baseFetch(upload.uploadUrl, { method: 'POST', body: form });
    if (!uploaded.ok) throw new Error('Не удалось загрузить обложку');
    const finalized = await fetch(`${apiUrl}/media/content-finalize`, {
      method: 'POST',
      headers: { ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}), 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'category-cover', target, uploadKey: upload.uploadKey }),
    });
    if (!finalized.ok) throw new Error(await readApiError(finalized, 'Не удалось обработать обложку'));
    return finalized.json() as Promise<{ assetKey: string; assetUrl: string }>;
  } catch (error) {
    await discardTemporaryImageUpload(upload.uploadKey, authToken);
    throw error;
  }
}

async function uploadPresignedAsset(
  upload: { uploadUrl: string; fields: Record<string, string> },
  asset: { uri: string; name: string; mimeType: string },
  onProgress?: (percent: number) => void,
) {
  const form = new FormData();
  Object.entries(upload.fields).forEach(([key, value]) => form.append(key, value));
  if (Platform.OS === 'web') form.append('file', await baseFetch(asset.uri).then((response) => response.blob()), asset.name);
  else form.append('file', { uri: asset.uri, name: asset.name, type: asset.mimeType } as never);
  await new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', upload.uploadUrl);
    request.upload.onprogress = (event) => event.lengthComputable && onProgress?.(event.loaded / event.total);
    request.onerror = () => reject(new Error('Не удалось загрузить файл в хранилище'));
    request.onabort = () => reject(new Error('Загрузка файла отменена'));
    request.onload = () => request.status >= 200 && request.status < 300 ? resolve() : reject(new Error('Не удалось загрузить файл в хранилище'));
    request.send(form);
  });
}

async function uploadMultipartMusicAsset(
  upload: { uploadId: string; uploadKey: string; partSize: number; parts: Array<{ partNumber: number; uploadUrl: string }> },
  asset: { uri: string; name: string; mimeType: string },
  authToken: string,
  onProgress?: (percent: number) => void,
) {
  try {
    const blob = await baseFetch(asset.uri).then((response) => response.blob());
    const loaded = new Array(upload.parts.length).fill(0) as number[];
    const completed: Array<{ partNumber: number; etag: string }> = [];
    let cursor = 0;
    const uploadPart = (part: { partNumber: number; uploadUrl: string }) => new Promise<void>((resolve, reject) => {
      const index = part.partNumber - 1;
      const body = blob.slice(index * upload.partSize, Math.min(blob.size, (index + 1) * upload.partSize), asset.mimeType);
      const request = new XMLHttpRequest();
      request.open('PUT', part.uploadUrl);
      request.upload.onprogress = (event) => {
        loaded[index] = event.loaded;
        onProgress?.(loaded.reduce((sum, value) => sum + value, 0) / blob.size);
      };
      request.onerror = () => reject(new Error('Не удалось загрузить часть файла'));
      request.onabort = () => reject(new Error('Загрузка файла отменена'));
      request.onload = () => {
        const etag = request.getResponseHeader('ETag');
        if (request.status < 200 || request.status >= 300 || !etag) return reject(new Error('Не удалось загрузить часть файла'));
        loaded[index] = body.size;
        completed.push({ partNumber: part.partNumber, etag });
        onProgress?.(loaded.reduce((sum, value) => sum + value, 0) / blob.size);
        resolve();
      };
      request.send(body);
    });
    const workers = Array.from({ length: Math.min(4, upload.parts.length) }, async () => {
      while (cursor < upload.parts.length) {
        const part = upload.parts[cursor++];
        await uploadPart(part);
      }
    });
    await Promise.all(workers);
    const completedResponse = await fetch(`${apiUrl}/my-music/upload/complete`, {
      method: 'POST',
      headers: { ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}), 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploadKey: upload.uploadKey, uploadId: upload.uploadId, parts: completed }),
    });
    if (!completedResponse.ok) throw new Error(await readApiError(completedResponse, 'Не удалось завершить загрузку трека'));
  } catch (error) {
    await fetch(`${apiUrl}/my-music/upload/abort`, {
      method: 'POST',
      headers: { ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}), 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploadKey: upload.uploadKey, uploadId: upload.uploadId }),
    }).catch(() => undefined);
    throw error;
  }
}

export async function prepareMusicAsset(
  asset: { uri: string; name: string; mimeType: string; size?: number },
  authToken: string,
  onProgress?: (progress: { stage: 'preparing' | 'uploading'; percent: number }) => void,
) {
  onProgress?.({ stage: 'preparing', percent: 2 });
  const prepareResponse = await fetch(`${apiUrl}/my-music/upload`, {
    method: 'POST',
    headers: { ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}), 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: asset.name, mimeType: asset.mimeType, ...(Platform.OS === 'web' && asset.size ? { size: asset.size } : {}) }),
  });
  if (!prepareResponse.ok) throw new Error(await readApiError(prepareResponse, 'Не удалось подготовить загрузку трека'));
  const upload = await prepareResponse.json() as ({ mode: 'form'; uploadUrl: string; fields: Record<string, string>; uploadKey: string } | { mode: 'multipart'; uploadId: string; uploadKey: string; partSize: number; parts: Array<{ partNumber: number; uploadUrl: string }> });
  const reportProgress = (ratio: number) => onProgress?.({ stage: 'uploading', percent: 5 + Math.round(ratio * 60) });
  try {
    if (upload.mode === 'multipart') await uploadMultipartMusicAsset(upload, asset, authToken, reportProgress);
    else await uploadPresignedAsset(upload, asset, reportProgress);
    const inspected = await fetch(`${apiUrl}/my-music/inspect`, {
      method: 'POST',
      headers: { ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}), 'Content-Type': 'application/json', 'x-volna-timeout-ms': '120000' },
      body: JSON.stringify({ uploadKey: upload.uploadKey }),
    });
    if (!inspected.ok) throw new Error(await readApiError(inspected, 'Не удалось прочитать данные трека'));
    return { uploadKey: upload.uploadKey, ...await inspected.json() as { title: string | null; artist: string | null; artworkDataUrl: string | null } };
  } catch (error) {
    await discardMusicAsset(upload.uploadKey, authToken);
    throw error;
  }
}

export async function uploadMusicArtworkAsset(asset: { uri: string; name: string; mimeType: string }, authToken: string) {
  const response = await fetch(`${apiUrl}/my-music/artwork-upload`, {
    method: 'POST',
    headers: { ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}), 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: asset.name, mimeType: asset.mimeType }),
  });
  if (!response.ok) throw new Error(await readApiError(response, 'Не удалось подготовить обложку'));
  const upload = await response.json() as { uploadUrl: string; fields: Record<string, string>; uploadKey: string };
  await uploadPresignedAsset(upload, asset);
  return upload.uploadKey;
}

export async function discardMusicArtworkAsset(artworkUploadKey: string, authToken: string) {
  const response = await fetch(`${apiUrl}/my-music/discard-artwork`, {
    method: 'POST',
    headers: { ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}), 'Content-Type': 'application/json' },
    body: JSON.stringify({ artworkUploadKey }),
  });
  if (!response.ok) throw new Error(await readApiError(response, 'Не удалось удалить временную обложку'));
}

export async function finalizeMusicAsset(
  input: { uploadKey: string; filename: string; mimeType: string; title: string; artist?: string; quality: 'AAC_128' | 'AAC_256'; artworkUploadKey?: string; genres?: string[]; includeSelfAsParticipant?: boolean; releaseDate?: string },
  authToken: string,
) {
  const finalized = await fetch(`${apiUrl}/my-music/finalize`, {
    method: 'POST',
    headers: {
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      'Content-Type': 'application/json',
      'x-volna-timeout-ms': '600000',
    },
    body: JSON.stringify(input),
  });
  if (!finalized.ok) throw new Error(await readApiError(finalized, 'Не удалось обработать аудиофайл'));
  return finalized.json();
}

export async function discardMusicAsset(uploadKey: string, authToken: string, artworkUploadKey?: string) {
  await fetch(`${apiUrl}/my-music/discard`, {
    method: 'POST',
    headers: { ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}), 'Content-Type': 'application/json' },
    body: JSON.stringify({ uploadKey, artworkUploadKey }),
  }).catch(() => undefined);
}

export type PasswordStrength = 'low' | 'medium' | 'high';

export function normalizeAsciiPassword(value: string) {
  return value.replace(/[^\x21-\x7E]/g, '').slice(0, 128);
}

export function normalizeEmailInput(value: string) {
  return value.toLowerCase().replace(/[^A-Za-z0-9.!#$%&'*+/=?^_`{|}~@-]/g, '').slice(0, 254);
}

export function isValidEmailInput(value: string) {
  if (value.length > 254 || value.split('@').length !== 2) return false;
  const [local, domain] = value.split('@');
  if (!local || local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;
  if (!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)) return false;
  const labels = domain.split('.');
  return labels.length >= 2 && labels.every((label) => label.length > 0 && label.length <= 63 && /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label));
}

export function getPasswordStrength(password: string): PasswordStrength {
  if (!password) return 'low';
  const categories = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z\d\s]/]
    .filter((pattern) => pattern.test(password)).length;
  const normalized = password.toLowerCase();
  const isCommon = /^(password|qwerty|123456)/.test(normalized);
  const isLow = password.length < 6 || !/[A-Za-z]/.test(password) || !/\d/.test(password) || isCommon;
  if (isLow) return 'low';
  return password.length >= 12 && categories >= 3 ? 'high' : 'medium';
}


export function formatMusicGenreChip(value: string) {
  const parts = value.includes(' > ')
    ? value.split(' > ').map((part) => part.trim()).filter(Boolean)
    : value.split(' / ').map((part) => part.trim()).filter(Boolean);

  if (parts.length >= 3) {
    return `${parts[1]} / ${parts.slice(2).join(' / ')}`;
  }

  return parts.length >= 2 ? parts[1] : value;
}

export function parseMusicGenreParts(value: string) {
  const parts = value.includes(' > ')
    ? value.split(' > ').map((part) => part.trim()).filter(Boolean)
    : value.split(' / ').map((part) => part.trim()).filter(Boolean);

  return {
    genre: parts.length >= 2 ? parts[1] : value,
    subgenre: parts.length >= 3 ? musicSubgenreDisplayName(value) : '',
  };
}

export function groupMusicGenreChips(genres: string[]) {
  const groups = new globalThis.Map<string, { genre: string; subgenres: string[]; values: string[] }>();

  genres.map(canonicalizeMusicGenreValue).forEach((value) => {
    const { genre, subgenre } = parseMusicGenreParts(value);
    const group = groups.get(genre) ?? { genre, subgenres: [], values: [] };

    if (subgenre && !group.subgenres.includes(subgenre)) {
      group.subgenres.push(subgenre);
    }

    group.values.push(value);
    groups.set(genre, group);
  });

  return Array.from(groups.values()).map((group) => ({
    key: group.values.join('|'),
    genre: group.genre,
    subgenres: group.subgenres,
    values: group.values,
  }));
}

export function normalizeMusicGenres(genres: string[]) {
  return normalizeMusicGenreList(genres, musicGenreLimit);
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function avatarThumbnail(value: string | null | undefined) {
  if (!value) return null;
  const thumbnailKey = (key: string) => {
    if (/-200\.webp$/i.test(key)) return key;
    if (/-1024\.webp$/i.test(key)) return key.replace(/-1024\.webp$/i, '-200.webp');
    return key.replace(/\.[a-z0-9]+$/i, '-200.webp');
  };
  try {
    const url = new URL(value);
    const key = url.searchParams.get('key');
    if (key?.startsWith('avatars/')) {
      url.searchParams.set('key', thumbnailKey(key));
      return url.toString();
    }
    if (/\/avatars\//i.test(url.pathname)) {
      url.pathname = thumbnailKey(url.pathname);
      return url.toString();
    }
  } catch {
    // Keep non-URL local values untouched.
  }
  return value;
}

export function connectPhotoThumbnail(value: string | null | undefined) {
  if (!value) return null;
  const thumbnailKey = (key: string) => key.replace(/-1080\.webp$/i, '-540.webp');
  try {
    const url = new URL(value);
    const key = url.searchParams.get('key');
    if (key?.startsWith('connect/')) {
      url.searchParams.set('key', thumbnailKey(key));
      return url.toString();
    }
    if (/\/connect\//i.test(url.pathname)) {
      url.pathname = thumbnailKey(url.pathname);
      return url.toString();
    }
  } catch {
    // Keep local draft image URIs untouched until upload finalization.
  }
  return value;
}

export function postImageThumbnail(value: string | null | undefined) {
  if (!value) return null;
  const thumbnailKey = (key: string) => key.replace(/-2160\.webp$/i, '-540.webp');
  try {
    const url = new URL(value);
    const key = url.searchParams.get('key');
    if (key?.startsWith('posts/')) {
      url.searchParams.set('key', thumbnailKey(key));
      return url.toString();
    }
    if (/\/posts\//i.test(url.pathname)) {
      url.pathname = thumbnailKey(url.pathname);
      return url.toString();
    }
  } catch {
    // Keep local draft image URIs untouched until upload finalization.
  }
  return value;
}

export function musicArtworkThumbnail(
  value: string | null | undefined,
  provider?: 'soundcloud' | 'bandcamp' | 'youtube' | 'volna' | 'apple' | 'yandex',
  targetSize = 120,
) {
  if (!value) return null;
  const normalizedSize = Math.max(120, Math.min(600, Math.round(targetSize)));
  if (provider === 'soundcloud') {
    return value.replace(/-(?:large|small|t\d+x\d+)\.(jpg|jpeg|png|webp)(\?.*)?$/i, `-t${normalizedSize}x${normalizedSize}.$1$2`);
  }
  if (provider === 'bandcamp') {
    return value.replace(/_\d+\.(jpg|jpeg|png|webp)(\?.*)?$/i, `${normalizedSize >= 300 ? '_4' : '_7'}.$1$2`);
  }
  if (provider === 'apple') {
    return value.replace(/\d+x\d+bb(?=\.(?:jpg|jpeg|png|webp)(?:\?|$))/i, `${normalizedSize}x${normalizedSize}bb`);
  }
  if (provider === 'yandex') {
    return value.replace(/\d+x\d+(?=\.(?:jpg|jpeg|png|webp)(?:\?|$))/i, `${normalizedSize}x${normalizedSize}`);
  }
  return value;
}

export function formatChatTime(value: string | null) {
  if (!value) {
    return '';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

