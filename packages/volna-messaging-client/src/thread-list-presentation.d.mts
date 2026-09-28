export function mergeThreadListPage<T extends { id: string }>(
  current: T[],
  page: { items: T[] },
  reset: boolean,
  provisional: boolean,
): T[];
