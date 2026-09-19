// Shared by React Native, browser CSS and the pre-JavaScript boot surface.
const loadingTokens = Object.freeze({
  small: 20, large: 32, strokeWidth: 2, durationMs: 900,
  color: '#111', inverseColor: '#fff', dangerColor: '#c62828', trackOpacity: 0.18,
  progressDurationMs: 240, progressSize: 24, progressRadius: 10,
  progressTrack: '#d7dee5',
});

function bootLoadingCss() {
  const t = loadingTokens;
  return `/* VOLNA_LOADING_START — generated from loading-tokens.js */
      .volna-boot__loader { position: relative; width: ${t.large}px; height: ${t.large}px; margin: 0 auto; color: ${t.color}; }
      .volna-boot__loader::before, .volna-boot__loader::after { content: ''; position: absolute; inset: 0; box-sizing: border-box; border: ${t.strokeWidth}px solid currentColor; border-radius: 50%; }
      .volna-boot__loader::before { opacity: ${t.trackOpacity}; }
      .volna-boot__loader::after { border-left-color: transparent; animation: volna-loading ${t.durationMs}ms linear infinite; }
      .volna-boot--failed .volna-boot__loader { display: none; }
      @keyframes volna-loading { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      @media (prefers-reduced-motion: reduce) { .volna-boot__loader::after { animation: none; } }
      /* VOLNA_LOADING_END */`;
}

function syncBootLoadingHtml(html) {
  return html.replace(/\/\* VOLNA_LOADING_START[\s\S]*?\/\* VOLNA_LOADING_END \*\//, bootLoadingCss());
}
module.exports = { loadingTokens, bootLoadingCss, syncBootLoadingHtml };
