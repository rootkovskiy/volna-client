export function normalizeExternalHttpsUrl(
  value: unknown,
  allowedHostnames?: readonly string[],
): string | null;

export function isSameOriginUrl(value: string, trustedOriginUrl: string): boolean;

export function normalizeTelegramPostReference(
  channelUsername: unknown,
  messageId: unknown,
): { channelUsername: string; messageId: string } | null;

export function normalizeYouTubeVideoId(value: unknown): string | null;
