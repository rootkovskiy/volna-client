import { Linking } from 'react-native';
import { normalizeExternalHttpsUrl } from './externalUrls.mjs';

/** Opens only a destination that satisfies the public client's HTTPS policy. */
export async function openExternalHttpsUrl(
  value: unknown,
  allowedHostnames: readonly string[] = [],
) {
  const safeUrl = normalizeExternalHttpsUrl(value, allowedHostnames);
  if (!safeUrl) return false;
  await Linking.openURL(safeUrl);
  return true;
}
