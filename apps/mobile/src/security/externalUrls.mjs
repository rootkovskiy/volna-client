function normalizedHostname(value) {
  return value.toLowerCase().replace(/\.$/, '');
}

function hostMatches(hostname, allowedHostname) {
  const host = normalizedHostname(hostname);
  const allowed = normalizedHostname(allowedHostname);
  return host === allowed || host.endsWith(`.${allowed}`);
}

/**
 * Reduces an untrusted navigation target to an absolute, credential-free HTTPS
 * URL. This check belongs at the rendering boundary even when the API also
 * validates stored links: the public client treats API content as untrusted.
 */
export function normalizeExternalHttpsUrl(value, allowedHostnames = []) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null;
    if (allowedHostnames.length && !allowedHostnames.some((host) => hostMatches(parsed.hostname, host))) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function isSameOriginUrl(value, trustedOriginUrl) {
  try {
    return new URL(value).origin === new URL(trustedOriginUrl).origin;
  } catch {
    return false;
  }
}

export function normalizeTelegramPostReference(channelUsername, messageId) {
  const channel = typeof channelUsername === 'string' ? channelUsername.trim() : '';
  const message = typeof messageId === 'string' ? messageId.trim() : '';
  if (!/^[A-Za-z0-9_]{5,32}$/.test(channel) || !/^[1-9]\d{0,19}$/.test(message)) return null;
  return { channelUsername: channel, messageId: message };
}

export function normalizeYouTubeVideoId(value) {
  const videoId = typeof value === 'string' ? value.trim() : '';
  return /^[A-Za-z0-9_-]{11}$/.test(videoId) ? videoId : null;
}
