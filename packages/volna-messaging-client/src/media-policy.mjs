export function safeHttpsUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

export function trustedPublicMediaUrl(value) {
  const url = safeHttpsUrl(value);
  if (!url) return null;
  return new URL(url).hostname === 'media.volna.social' ? url : null;
}
