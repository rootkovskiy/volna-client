export type MusicLibraryProvider = 'soundcloud' | 'bandcamp' | 'youtube' | 'volna';
export const musicLibraryProviders: readonly MusicLibraryProvider[];
export function isMusicLibraryProvider(provider: unknown): provider is MusicLibraryProvider;
export function isMusicLibraryPlaylistKey(key: unknown): key is string;
