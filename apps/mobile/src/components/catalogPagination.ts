export type CatalogPaginationState = {
  cursor: string | null; loading: boolean; enabled: boolean; error: boolean; rowCount: number;
};
const maximumEmptyAdvances = 5;

/** Geometry, not a once-per-content-height edge event, owns pagination readiness. */
export function createCatalogPaginationTrigger() {
  let height = 0, content = 0, offset = 0;
  let requested: string | null = null;
  let completed: string | null = null;
  let rows = 0, emptyAdvances = 0;
  return {
    reset() { content = 0; offset = 0; requested = null; completed = null; rows = 0; emptyAdvances = 0; },
    layout(value: number) { height = value; },
    content(value: number) { content = value; },
    scroll(y: number, viewport: number, total: number) { offset = Math.max(0, y); height = viewport; content = total; },
    continue() { emptyAdvances = 0; requested = null; },
    release() { requested = null; },
    take(state: CatalogPaginationState) {
      if (!state.enabled || state.loading || state.error || !state.cursor || height <= 0) return false;
      if (completed !== state.cursor) {
        emptyAdvances = state.rowCount > rows ? 0 : emptyAdvances + 1;
        rows = state.rowCount;
        completed = state.cursor;
      }
      if (requested === state.cursor || emptyAdvances >= maximumEmptyAdvances) return false;
      if (content - height - offset > height * .35) return false;
      requested = state.cursor;
      return true;
    },
  };
}
