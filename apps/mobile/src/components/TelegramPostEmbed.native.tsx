import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { WebView } from 'react-native-webview';
import { normalizeExternalHttpsUrl, normalizeTelegramPostReference } from '../security/externalUrls.mjs';
import { openExternalHttpsUrl } from '../security/openExternalUrl';

export function TelegramPostEmbed({ channelUsername, compact = false, messageId }: { channelUsername: string; compact?: boolean; messageId: string; url: string }) {
  const [height, setHeight] = useState(compact ? 160 : 320);
  const reference = normalizeTelegramPostReference(channelUsername, messageId);
  const html = useMemo(() => reference ? `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}.telegram-post{margin:0!important}iframe{max-width:100%!important}</style></head><body><blockquote class="telegram-post" data-telegram-post="${reference.channelUsername}/${reference.messageId}" data-width="100%"${compact ? ' data-userpic="false"' : ''}></blockquote><script async src="https://telegram.org/js/telegram-widget.js?22"></script><script>new ResizeObserver(()=>window.ReactNativeWebView.postMessage(String(document.body.scrollHeight))).observe(document.body)</script></body></html>` : '', [compact, reference?.channelUsername, reference?.messageId]);
  if (!reference) return null;
  return <View style={{ height, marginTop: 12, overflow: 'hidden' }}><WebView javaScriptEnabled onMessage={(event) => { const next = Number(event.nativeEvent.data); if (Number.isFinite(next) && next > 80 && next <= 10_000) setHeight(Math.ceil(next)); }} onShouldStartLoadWithRequest={(request) => { if (request.url === 'about:blank' || normalizeExternalHttpsUrl(request.url, ['telegram.org'])) return true; void openExternalHttpsUrl(request.url, ['t.me', 'telegram.me']); return false; }} originWhitelist={['https://telegram.org', 'https://*.telegram.org', 'about:blank']} scrollEnabled={false} source={{ html, baseUrl: 'https://telegram.org' }} style={{ backgroundColor: 'transparent' }} /></View>;
}
