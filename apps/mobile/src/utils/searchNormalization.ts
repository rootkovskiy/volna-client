/** Use for text matching only; keep the original spelling for display and saving. */
export function normalizeSearchText(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
}

export function searchIncludes(value: string, query: string) {
  return normalizeSearchText(value).includes(normalizeSearchText(query));
}

export function searchStartsWith(value: string, query: string) {
  return normalizeSearchText(value).startsWith(normalizeSearchText(query));
}
