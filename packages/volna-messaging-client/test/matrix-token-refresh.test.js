const test = require('node:test');
const assert = require('node:assert/strict');

async function fixture(overrides = {}) {
  const { createMatrixCredentialRefresher } = await import('../src/matrix-token-refresh.mjs');
  const credentials = { accessToken: 'access-0', refreshToken: 'refresh-0', expiresAt: 100, deviceId: 'same-device' };
  const saved = [], tokens = [];
  const refresh = createMatrixCredentialRefresher({ credentials, now: () => 1000, assertActive() {}, checkSession: async () => {},
    rotate: async token => { tokens.push(token); return { access_token: `access-${tokens.length}`, refresh_token: `refresh-${tokens.length}`, expires_in_ms: 60000 }; },
    persist: async value => { saved.push({ ...value }); }, ...overrides });
  return { refresh, credentials, saved, tokens };
}

test('one rotation for simultaneous callers and a stale SDK callback reuses the durable pair', async () => {
  const h = await fixture();
  const values = await Promise.all(Array.from({ length: 20 }, () => h.refresh('refresh-0')));
  assert.equal(h.tokens.length, 1); assert.equal(h.saved.length, 1);
  assert.ok(values.every(x => x.accessToken === 'access-1'));
  assert.equal((await h.refresh('refresh-0')).refreshToken, 'refresh-1');
  assert.equal(h.tokens.length, 1);
  await h.refresh('refresh-1'); assert.equal(h.tokens.length, 2);
  assert.equal(h.credentials.deviceId, 'same-device');
});

test('failed persistence retries the received pair without spending the old refresh token again', async () => {
  let fail = true, writes = 0;
  const h = await fixture({ persist: async () => { writes++; if (fail) throw Error('storage temporarily unavailable'); } });
  await assert.rejects(h.refresh('refresh-0'), /storage/);
  assert.equal(h.credentials.refreshToken, 'refresh-0', 'do not expose an undurable pair to the SDK');
  fail = false;
  const recovered = await h.refresh('refresh-0');
  assert.equal(recovered.refreshToken, 'refresh-1'); assert.equal(h.tokens.length, 1); assert.equal(writes, 2);
});

test('retryable network failures do not poison the coordinator', async () => {
  let fail = true;
  const h = await fixture({ rotate: async () => { if (fail) throw Error('offline'); return { access_token: 'new', expires_in_ms: 10000 }; } });
  await assert.rejects(h.refresh('refresh-0'), /offline/); fail = false;
  assert.equal((await h.refresh('refresh-0')).accessToken, 'new');
  assert.equal(h.credentials.refreshToken, 'refresh-0', 'Matrix may retain the refresh token');
});

test('logout while rotation is in flight cannot persist or publish late credentials', async () => {
  let closed = false, done;
  const network = new Promise(resolve => { done = resolve; });
  const h = await fixture({ assertActive: () => { if (closed) throw Error('closed'); }, rotate: () => network });
  const pending = h.refresh('refresh-0'); await Promise.resolve(); closed = true;
  done({ access_token: 'late', refresh_token: 'late', expires_in_ms: 60000 });
  await assert.rejects(pending, /closed/); assert.equal(h.saved.length, 0); assert.equal(h.credentials.accessToken, 'access-0');
});

test('VOLNA revocation is checked even when retrying persistence or reusing a rotated pair', async () => {
  let active = true, storage = false;
  const h = await fixture({ checkSession: async () => { if (!active) throw Error('revoked'); }, persist: async () => { if (!storage) throw Error('storage'); } });
  await assert.rejects(h.refresh('refresh-0'), /storage/); active = false; storage = true;
  await assert.rejects(h.refresh('refresh-0'), /revoked/); assert.equal(h.credentials.accessToken, 'access-0');
});

test('malformed rotation responses do not overwrite credentials', async () => {
  for (const value of [{ access_token: '', expires_in_ms: 10 }, { access_token: 'a', expires_in_ms: -1 }, { access_token: 'a', refresh_token: '', expires_in_ms: 10 }]) {
    const h = await fixture({ rotate: async () => value });
    await assert.rejects(h.refresh('refresh-0'), /некорректное/);
    assert.equal(h.saved.length, 0); assert.equal(h.credentials.accessToken, 'access-0');
  }
});

test('72 simulated hours: concurrent rotations, offline resume, durable reload and failed writes retain one device', async () => {
  const { createMatrixCredentialRefresher } = await import('../src/matrix-token-refresh.mjs');
  const { xchacha20poly1305 } = await import('@noble/ciphers/chacha.js');
  const { randomBytes } = require('node:crypto');
  const key = randomBytes(32), aad = new TextEncoder().encode('fixture-credentials');
  let clock = 1800000000000, calls = 0, offline = false, failWrite = false, persisted;
  let credentials = { deviceId: 'device_unchanged', userId: '@fixture:example.org', accessToken: 'access_0', refreshToken: 'refresh_0', expiresAt: clock };
  const issued = new Set();
  const build = () => createMatrixCredentialRefresher({ credentials, now: () => clock, assertActive() {},
    checkSession: async () => { if (offline) throw Error('offline'); },
    rotate: async token => {
      assert.equal(issued.has(token), false, 'never spend a refresh token twice'); issued.add(token);
      calls++; return { access_token: `access_${calls}`, refresh_token: `refresh_${calls}`, expires_in_ms: 600000 };
    },
    persist: async value => {
      if (failWrite) { failWrite = false; throw Error('disk unavailable'); }
      const nonce = randomBytes(24);
      persisted = { nonce, ciphertext: xchacha20poly1305(key, nonce, aad).encrypt(new TextEncoder().encode(JSON.stringify(value))) };
      assert.equal(Buffer.from(persisted.ciphertext).includes(Buffer.from(value.refreshToken)), false);
    },
  });
  let refresh = build();
  for (let cycle = 0; cycle < 432; cycle++) {
    clock += 600000;
    const prior = credentials.refreshToken;
    if (cycle % 17 === 0) {
      offline = true;
      await assert.rejects(refresh(prior), /offline/);
      offline = false;
      assert.equal(credentials.refreshToken, prior);
    }
    if (cycle % 13 === 0) {
      failWrite = true;
      await assert.rejects(refresh(prior), /disk unavailable/);
      assert.equal(credentials.refreshToken, prior, 'undurable credentials stay unpublished');
    }
    const values = await Promise.all(Array.from({ length: 16 }, () => refresh(prior)));
    assert.ok(values.every(value => value.refreshToken === credentials.refreshToken));
    assert.equal(credentials.expiresAt, clock + 600000);
    const stale = await refresh(prior);
    assert.equal(stale.refreshToken, credentials.refreshToken);
    if (cycle % 24 === 23) {
      credentials = JSON.parse(new TextDecoder().decode(xchacha20poly1305(key, persisted.nonce, aad).decrypt(persisted.ciphertext)));
      refresh = build();
    }
    assert.equal(credentials.deviceId, 'device_unchanged');
  }
  assert.equal(calls, 432); key.fill(0);
});
