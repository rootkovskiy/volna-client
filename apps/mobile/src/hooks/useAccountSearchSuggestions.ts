import { useEffect, useState } from 'react';
import { apiFetch as fetch, apiUrl, remoteSearchDebounceMs } from '../api/client';

export type AccountSearchSuggestion = {
  id: string;
  username: string;
  name: string;
  avatarUrl: string | null;
};

type SearchResponse = {
  accounts?: Array<{
    id: string;
    username: string;
    name: string;
    avatarUrl?: string | null;
  }>;
};

export function useAccountSearchSuggestions(queryValue: string, enabled: boolean) {
  const [suggestions, setSuggestions] = useState<AccountSearchSuggestion[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isSettled, setIsSettled] = useState(false);
  const query = queryValue.trim().replace(/^@/, '');

  useEffect(() => {
    setIsSearching(false);
    setIsSettled(false);
    if (!enabled || query.length < 3) {
      setSuggestions([]);
      return;
    }

    const controller = new AbortController();
    let isCurrent = true;
    const timer = setTimeout(() => {
      setIsSearching(true);
      void fetch(`${apiUrl}/search?q=${encodeURIComponent(query)}`, { signal: controller.signal })
        .then(async (response): Promise<SearchResponse> => response.ok ? response.json() : { accounts: [] })
        .then((result) => {
          if (!isCurrent) return;
          setSuggestions((result.accounts ?? []).map((account) => ({
            id: account.id,
            username: account.username,
            name: account.name,
            avatarUrl: account.avatarUrl ?? null,
          })).slice(0, 6));
        })
        .catch((error: unknown) => {
          if (isCurrent && (error as { name?: string }).name !== 'AbortError') setSuggestions([]);
        })
        .finally(() => {
          if (!isCurrent) return;
          setIsSearching(false);
          setIsSettled(true);
        });
    }, remoteSearchDebounceMs);

    return () => {
      isCurrent = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [enabled, query]);

  return {
    isSearching,
    isSettled,
    queryLength: query.length,
    suggestions,
  };
}
