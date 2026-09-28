export function mergeThreadListPage(current, page, reset, provisional) {
  if (provisional && reset && current.length) {
    const fresh = new Map(page.items.map(item => [item.id, item]));
    const retained = current.filter(item => {
      const next = fresh.get(item.id);
      // A previously authenticated preview belongs to its partner, protocol
      // and deletion state. Remove a row as soon as any of those changes.
      return !next || (next.partner.id === item.partner.id
        && next.encryptionMode === item.encryptionMode
        && next.protocolVersion === item.protocolVersion
        && JSON.stringify(next.visibility) === JSON.stringify(item.visibility));
    });
    return retained.length === current.length ? current : retained;
  }
  if (reset) return page.items;
  const updates = new Map(page.items.map(item => [item.id, item]));
  return [
    ...current.map(item => updates.get(item.id) ?? item),
    ...page.items.filter(item => !current.some(stored => stored.id === item.id)),
  ];
}
