export type PlaylistArtworkSource = {
  artworkUrl?: string | null;
  artworkThumbnailUrl?: string | null;
  artworkLocalUri?: string;
  removeArtwork?: boolean;
  tracks: readonly string[];
};

/** Display-only fallback: never write a track's cover into saved playlist metadata. */
export function resolvePlaylistArtwork(playlist: PlaylistArtworkSource, trackArtwork: ReadonlyMap<string, string | null | undefined>): string | null {
  if (!playlist.removeArtwork) {
    const custom = playlist.artworkLocalUri?.trim() || playlist.artworkThumbnailUrl?.trim() || playlist.artworkUrl?.trim();
    if (custom) return custom;
  }
  for (let index = playlist.tracks.length - 1; index >= 0; index -= 1) {
    const artwork = trackArtwork.get(playlist.tracks[index])?.trim();
    if (artwork) return artwork;
  }
  return null;
}

/** Keep the category's existing newest-playlist-with-artwork ordering. */
export function playlistCategoryArtwork(playlists: readonly { artworkUrl?: string | null }[]): string | null {
  for (let index = playlists.length - 1; index >= 0; index -= 1) {
    const artwork = playlists[index].artworkUrl?.trim();
    if (artwork) return artwork;
  }
  return null;
}
