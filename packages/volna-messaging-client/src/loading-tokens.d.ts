export const loadingTokens: Readonly<{
  small: number; large: number; strokeWidth: number; durationMs: number;
  color: string; inverseColor: string; dangerColor: string; trackOpacity: number;
  progressDurationMs: number; progressSize: number; progressRadius: number; progressTrack: string;
}>;
export function bootLoadingCss(): string;
export function syncBootLoadingHtml(html: string): string;
