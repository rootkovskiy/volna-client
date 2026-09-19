import { Platform } from 'react-native';

type BrowserDevice = { userAgent?: string; platform?: string; maxTouchPoints?: number; userAgentData?: { mobile?: boolean } };

/** Product surface, not a width breakpoint: a narrow PC window is still a PC. */
export function isMobileDownloadDevice(os: string, browser?: BrowserDevice) {
  if (os !== 'web') return os === 'ios' || os === 'android';
  if (!browser) return false;
  const ua = browser.userAgent || '';
  if (/Windows NT|CrOS/i.test(ua)) return false;
  return /Android|iPhone|iPad|iPod/i.test(ua)
    || ((browser.platform === 'MacIntel' || /Macintosh/i.test(ua)) && (browser.maxTouchPoints || 0) > 1)
    || browser.userAgentData?.mobile === true;
}

export function supportsDeviceDownloads() {
  return isMobileDownloadDevice(Platform.OS, typeof navigator === 'undefined' ? undefined : navigator);
}
