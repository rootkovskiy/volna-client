import { createElement, useEffect, useRef } from 'react';
import { normalizeTelegramPostReference } from '../security/externalUrls.mjs';

export function TelegramPostEmbed({ channelUsername, compact = false, messageId }: { channelUsername: string; compact?: boolean; messageId: string; url: string }) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    host.replaceChildren();
    const reference = normalizeTelegramPostReference(channelUsername, messageId);
    if (!reference) return undefined;
    const quote = document.createElement('blockquote');
    quote.className = 'telegram-post';
    quote.dataset.telegramPost = `${reference.channelUsername}/${reference.messageId}`;
    quote.dataset.width = '100%';
    if (compact) quote.dataset.userpic = 'false';
    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    host.append(quote, script);
    return () => host.replaceChildren();
  }, [channelUsername, compact, messageId]);

  return createElement('div', {
    ref: hostRef,
    style: { marginTop: 12, maxWidth: '100%', minHeight: compact ? 100 : 140, overflow: 'hidden' },
  });
}
