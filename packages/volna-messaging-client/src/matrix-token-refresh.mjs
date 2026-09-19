/** One rotation per credential object, including retry of a failed durable write. */
export function createMatrixCredentialRefresher({ credentials, assertActive, checkSession, rotate, persist, now = Date.now }) {
  let pending;
  let unsaved;
  return function refresh(requestedToken) {
    if (pending) return pending;
    pending = (async () => {
      assertActive();
      await checkSession();
      assertActive();
      // The SDK may retry with its old token after a storage failure. Retain the
      // response in memory and retry persistence, never spend that token twice.
      if (!unsaved && requestedToken === credentials.refreshToken) {
        const value = await rotate(credentials.refreshToken);
        assertActive();
        if (typeof value.access_token !== 'string' || !value.access_token
            || !Number.isSafeInteger(value.expires_in_ms) || value.expires_in_ms <= 0
            || (value.refresh_token !== undefined && (typeof value.refresh_token !== 'string' || !value.refresh_token))) {
          throw new Error('Matrix вернул некорректное обновление device session');
        }
        unsaved = { ...credentials, accessToken: value.access_token,
          refreshToken: value.refresh_token ?? credentials.refreshToken, expiresAt: now() + value.expires_in_ms };
      }
      if (unsaved) {
        await persist(unsaved);
        assertActive();
        Object.assign(credentials, unsaved);
        unsaved = undefined;
      }
      assertActive();
      return { accessToken: credentials.accessToken, refreshToken: credentials.refreshToken, expiry: new Date(credentials.expiresAt) };
    })().finally(() => { pending = undefined; });
    return pending;
  };
}
