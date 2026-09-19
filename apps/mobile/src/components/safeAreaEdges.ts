// Only the immersive chat owns its bottom inset in the composer. Keep the
// established shell padding on all routes with bottom navigation: removing it
// moves that navigation down on installed iPhone PWAs.
export const chatSafeAreaEdges = { top: 'additive', right: 'off', bottom: 'off', left: 'off' } as const;
