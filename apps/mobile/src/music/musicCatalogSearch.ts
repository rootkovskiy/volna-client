import type { ProfileMusicTrack, PublicUploadedMusicTrack } from '../types';
import { normalizeSearchText } from '../utils/searchNormalization';

export type MusicCatalogItem = { key: string } & (
  { kind: 'external'; track: ProfileMusicTrack } | { kind: 'upload'; track: PublicUploadedMusicTrack }
);
export type MusicSearchRow = MusicCatalogItem & { sectionTitle?: string };
const normalizeSearch = (value: string) => normalizeSearchText(value).trim();

/** Account-owned descriptors stay on the client; only text/filters go to the public catalog. */
export function personalMusicMatches(items: MusicCatalogItem[], query: string, genres: string[]) {
  const words = normalizeSearch(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return items.filter((item) => {
    const track = item.track;
    const release = item.kind === 'external' ? item.track.releaseMetadata : null;
    const text = normalizeSearch([track.title, track.artist,
      item.kind === 'external' ? `${item.track.labelName ?? ''} ${item.track.labelUsername ?? ''}` : '',
      ...(track.participants ?? []).map(person => `${person.name} ${person.entityType === 'text' ? '' : person.username}`),
      release?.title, release?.artist, ...(release?.tracks ?? []).map(child => `${child.title} ${child.artist}`),
    ].filter(Boolean).join(' '));
    return words.every(word => text.includes(word)) && (!genres.length || genres.some(genre => (
      track.genres?.some(value => value === genre || value.startsWith(`${genre} > `))
    )));
  });
}

function catalogItemIdentity(item: MusicCatalogItem) {
  if (item.kind === 'upload') return `volna:${item.track.id}`;
  const { track } = item;
  let source = track.externalUrl?.trim();
  if (!source) return `${track.provider}:id:${track.id}`;
  try {
    const url = new URL(source);
    url.hash = '';
    const trackingKeys: string[] = [];
    url.searchParams.forEach((_value, key) => { if (key.startsWith('utm_') || key === 'fbclid') trackingKeys.push(key); });
    trackingKeys.forEach(key => url.searchParams.delete(key));
    // Keep identity-bearing parameters, notably YouTube's case-sensitive v.
    url.searchParams.sort();
    source = url.toString().replace(/\/$/, '');
  } catch { /* Keep the exact legacy provider identity. */ }
  // A child with only its parent URL must not hide the complete release.
  if (track.provider === 'bandcamp' && !track.releaseMetadata && /\/album\//.test(source)) source += `#${track.id}`;
  return `${track.provider}:${source}`;
}

/** Stable personal-first order, deduplicated across all loaded public pages. */
export function musicSearchRows(personal: MusicCatalogItem[], catalog: MusicCatalogItem[], searching: boolean): MusicSearchRow[] {
  if (!searching) return catalog;
  const seen = new Set<string>(), rows: MusicSearchRow[] = [];
  for (const [title, items] of [['В моей музыке', personal], ['На VOLNA', catalog]] as const) {
    let first = true;
    for (const item of items) {
      const identity = catalogItemIdentity(item);
      if (seen.has(identity)) continue;
      seen.add(identity);
      rows.push({ ...item, ...(first ? { sectionTitle: title } : {}) });
      first = false;
    }
  }
  return rows;
}
