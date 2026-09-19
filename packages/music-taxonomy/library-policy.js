// Personal collections contain full playable sources. Preview providers remain available
// to the independent profile-header picker and attached content, not the music library.
const musicLibraryProviders = Object.freeze(['soundcloud', 'bandcamp', 'youtube', 'volna']);
function isMusicLibraryProvider(provider) {
  return musicLibraryProviders.includes(provider);
}
function isMusicLibraryPlaylistKey(key) {
  return typeof key === 'string' && /^(profile:(soundcloud|bandcamp|youtube):[a-zA-Z0-9_-]{1,180}|upload:[a-zA-Z0-9_-]{1,180})$/.test(key);
}
module.exports = { musicLibraryProviders, isMusicLibraryProvider, isMusicLibraryPlaylistKey };
