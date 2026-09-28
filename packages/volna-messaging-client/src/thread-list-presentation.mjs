export function mergeThreadListPage(current, page, reset, provisional) {
  if (provisional && reset && current.length) return current;
  if (reset) return page.items;
  const updates = new Map(page.items.map(item => [item.id, item]));
  return [
    ...current.map(item => updates.get(item.id) ?? item),
    ...page.items.filter(item => !current.some(stored => stored.id === item.id)),
  ];
}
