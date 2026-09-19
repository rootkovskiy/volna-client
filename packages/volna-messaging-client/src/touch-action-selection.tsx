import { createElement } from 'react';
import { Platform } from 'react-native';

// Install before touch-down: cancelling contextmenu after a long press is too
// late for iOS selection. Only explicitly marked action surfaces opt in.
const touchActionSelectionCss = `
@media (hover: none) and (pointer: coarse) {
  [data-volna-touch-action], [data-volna-touch-action] * {
    -webkit-user-select: none !important;
    user-select: none !important;
    -webkit-touch-callout: none !important;
  }
  [data-volna-touch-action] input,
  [data-volna-touch-action] textarea,
  [data-volna-touch-action] [contenteditable="true"],
  [data-volna-touch-action] [contenteditable="true"] * {
    -webkit-user-select: text !important;
    user-select: text !important;
    -webkit-touch-callout: default !important;
  }
}`;

export function TouchActionSelectionStyles() {
  return Platform.OS === 'web' ? createElement('style', null, touchActionSelectionCss) : null;
}
