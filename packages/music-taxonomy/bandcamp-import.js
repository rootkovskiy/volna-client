'use strict';

const { isMusicGenreValue, isMusicSubgenreValue, normalizeMusicGenreList } = require('./index');
const normalizeTag = value => value.trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' ');

// Import-only policy. Manual release forms/API continue to require subgenres.
function createBandcampGenreResolver(mapping) {
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) {
    throw new Error('Bandcamp genre map must be an object');
  }
  const tags = new Map();
  for (const [tag, value] of Object.entries(mapping)) {
    const values = Array.isArray(value) ? value : [value];
    if (!values.length || values.some(item => typeof item !== 'string' || !isMusicGenreValue(item))) {
      throw new Error(`Invalid VOLNA genre mapping for Bandcamp tag "${tag}"`);
    }
    tags.set(normalizeTag(tag), values);
  }
  return sourceTags => {
    const matched = normalizeMusicGenreList(sourceTags.filter(tag => typeof tag === 'string')
      .flatMap(tag => tags.get(normalizeTag(tag)) || []), Number.MAX_SAFE_INTEGER);
    // A supported child already conveys its parent; reserve space for other genres.
    const distinct = matched.filter(value => !matched.some(other => other.startsWith(`${value} > `)));
    return [...distinct.filter(isMusicSubgenreValue), ...distinct.filter(value => !isMusicSubgenreValue(value))].slice(0, 5);
  };
}

module.exports = { createBandcampGenreResolver };
