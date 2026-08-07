export type MusicTaxonomyGenre = Readonly<{
  name: string;
  subgenres: readonly string[];
}>;

export type MusicTaxonomyCategory = Readonly<{
  category: string;
  genres: readonly MusicTaxonomyGenre[];
}>;

export const musicTaxonomy: readonly MusicTaxonomyCategory[];
export function buildMusicGenreValue(category: string, genre: string, subgenre?: string): string;
export function canonicalizeMusicGenreValue(value: string): string;
export function isMusicGenreValue(value: string): boolean;
export function isMusicSubgenreValue(value: string): boolean;
export function musicGenreSearchText(value: string): string;
export function musicSubgenreDisplayName(value: string): string;
export function normalizeMusicGenreList(values: string[], limit: number): string[];
export const profileMusicGenreLimit: 18;
export const releasePrimaryGenreLimit: 2;
export function splitReleaseGenres(values: string[]): {
  all: string[];
  primary: string[];
  additional: string[];
};
