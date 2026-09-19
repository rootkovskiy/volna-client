// Provider release dates are calendar days, not instants in the viewer's timezone.
export function providerReleaseDateInput(value?: string | null): string {
  if (!value) return '';
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(value.trim());
  const bandcamp = /^(\d{1,2}) ([A-Za-z]{3}) (\d{4}) \d{2}:\d{2}:\d{2} GMT$/.exec(value.trim());
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const year = Number(iso?.[1] ?? bandcamp?.[3]);
  const month = iso ? Number(iso[2]) : months.indexOf(bandcamp?.[2] ?? '') + 1;
  const day = Number(iso?.[3] ?? bandcamp?.[1]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (year < 1900 || year > 9999 || date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return '';
  return `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}.${year}`;
}

export type ReleaseDateDraft = { url: string; value: string; edited: boolean };
export const emptyReleaseDateDraft: ReleaseDateDraft = { url: '', value: '', edited: false };
type ReleaseDateAction =
  | { type: 'url'; url: string }
  | { type: 'manual'; value: string }
  | { type: 'resolved'; url: string; releaseDate?: string | null };

export function releaseDateDraftReducer(state: ReleaseDateDraft, action: ReleaseDateAction): ReleaseDateDraft {
  if (action.type === 'url') {
    const url = action.url.trim();
    return url === state.url ? state : { url, value: '', edited: false };
  }
  if (action.type === 'manual') return { ...state, value: action.value, edited: true };
  if (state.url !== action.url.trim() || state.edited) return state;
  return { ...state, value: providerReleaseDateInput(action.releaseDate) };
}
