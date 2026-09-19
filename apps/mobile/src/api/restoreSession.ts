import type { Account, Profile } from '../types';

/** Only an explicit auth rejection is an expired session. Transport/profile failures are retryable. */
export async function readRestorableSession(apiOrigin: string, token: string, request: typeof fetch) {
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
  const response = await request(`${apiOrigin}/auth/me`, { headers, cache: 'no-store' });
  if (response.status === 401 || response.status === 403) return null;
  if (!response.ok) throw new Error('session_restore_unavailable');
  const { account } = await response.json() as { account: Account };
  if (!account?.id || !account.username) throw new Error('session_restore_invalid_response');
  const profileResponse = await request(`${apiOrigin}/profiles/${encodeURIComponent(account.username)}`, { headers, cache: 'no-store' });
  if (!profileResponse.ok) throw new Error('session_profile_unavailable');
  const profile = await profileResponse.json() as Profile;
  if (profile?.id !== account.id) throw new Error('session_profile_mismatch');
  return { account, profile: { ...profile, isFollowing: profile.isFollowing ?? false, musicGenres: profile.musicGenres ?? [] } };
}
