const test = require('node:test');
const assert = require('node:assert/strict');

function fixture() {
  const active = new Set(), records = new Map();
  const locks = { async request(name, options, callback) {
    assert.deepEqual(options, { mode: 'exclusive', ifAvailable: true });
    if (active.has(name)) return callback(null);
    active.add(name);
    try { return await callback({ name }); } finally { active.delete(name); }
  } };
  const storage = { getItem: key => records.get(key) ?? null, setItem: (key, value) => records.set(key, value) };
  let generation = 0;
  return { active, records, options: { locks, storage, newGeneration: () => `generation_${++generation}` } };
}

test('independent managers exclude the same store, allow other accounts and permit retry after release', async () => {
  const { createMatrixStoreOwnership } = await import('../src/matrix-store-ownership.mjs');
  const f = fixture(), a = createMatrixStoreOwnership(f.options), b = createMatrixStoreOwnership(f.options);
  const lease = await a.acquire('account_alice');
  await assert.rejects(b.acquire('account_alice'), { code: 'matrix_store_busy' });
  const other = await b.acquire('account_bobby');
  lease.assertActive(); await lease.release(); await lease.release();
  const retry = await b.acquire('account_alice'); retry.assertActive();
  await Promise.all([retry.release(), other.release()]); assert.equal(f.active.size, 0);
});

test('logout generation rejects a suspended owner before an event is delivered and fences encrypted writes', async () => {
  const { createMatrixStoreOwnership } = await import('../src/matrix-store-ownership.mjs');
  const { bindMatrixKeyGuard, withMatrixKeyWrite } = await import('../src/matrix-key-lifecycle.mjs');
  const f = fixture(), a = createMatrixStoreOwnership(f.options), b = createMatrixStoreOwnership(f.options);
  let invalidated = 0, written = false;
  const lease = await a.acquire('account_alice', () => invalidated++);
  const key = new Uint8Array(32).fill(7); bindMatrixKeyGuard(key, lease.assertActive);
  b.requestLogout('account_alice');
  await assert.rejects(withMatrixKeyWrite(key, async () => { written = true; }), { code: 'matrix_store_retired' });
  assert.equal(written, false); assert.equal(invalidated, 1);
  await assert.rejects(b.acquire('account_alice'), { code: 'matrix_store_busy' });
  assert.equal(lease.pendingLogout(), 'generation_1');
  lease.acknowledgeLogout('generation_1'); await lease.release();
  const next = await b.acquire('account_alice'); next.assertActive();
  assert.equal(next.pendingLogout(), null); await next.release();
});

test('cleanup acknowledgement cannot consume a later logout request', async () => {
  const { createMatrixStoreOwnership } = await import('../src/matrix-store-ownership.mjs');
  const f = fixture(), owner = createMatrixStoreOwnership(f.options);
  owner.requestLogout('account_alice');
  const lease = await owner.acquire('account_alice');
  const old = lease.pendingLogout(); owner.requestLogout('account_alice');
  lease.acknowledgeLogout(old);
  assert.equal(lease.pendingLogout(), 'generation_2');
  await lease.release();
});

test('pagehide retires the engine but retains ownership until its cleanup finishes', async () => {
  const { createMatrixStoreOwnership } = await import('../src/matrix-store-ownership.mjs');
  const f = fixture(), events = new EventTarget(); let retired = 0;
  const owner = createMatrixStoreOwnership({ ...f.options, events });
  const lease = await owner.acquire('account_alice', () => retired++);
  events.dispatchEvent(new Event('pagehide')); assert.equal(retired, 1);
  await assert.rejects(owner.acquire('account_alice'), { code: 'matrix_store_busy' });
  await lease.release(); events.dispatchEvent(new Event('pagehide')); assert.equal(retired, 1);
  const next = await owner.acquire('account_alice'); next.assertActive(); await next.release();
});

test('same-document duplicate managers receive logout without transferring secrets', async () => {
  const { createMatrixStoreOwnership } = await import('../src/matrix-store-ownership.mjs');
  const f = fixture(), events = new EventTarget(); let stopped = 0;
  const owner = createMatrixStoreOwnership({ ...f.options, events });
  const lease = await owner.acquire('account_alice', () => stopped++);
  createMatrixStoreOwnership({ ...f.options, events }).requestLogout('account_alice');
  assert.equal(stopped, 1);
  assert.deepEqual([...f.records.values()].map(JSON.parse), [{ generation: 'generation_1', pending: true }]);
  await lease.release();
});

test('clearing storage or losing access retires the owner while retaining its lock for cleanup', async () => {
  const { createMatrixStoreOwnership } = await import('../src/matrix-store-ownership.mjs');
  for (const failure of ['clear', 'denied']) {
    const f = fixture(), events = new EventTarget(); let stopped = 0;
    const manager = createMatrixStoreOwnership({ ...f.options, events });
    const lease = await manager.acquire('account_alice', () => stopped++);
    if (failure === 'clear') events.dispatchEvent(Object.assign(new Event('storage'), { key: null }));
    else f.options.storage.getItem = () => { throw Error('access lost'); };
    assert.throws(() => lease.assertActive()); assert.equal(stopped, 1);
    assert.equal(f.active.size, 1);
    await lease.release(); assert.equal(f.active.size, 0);
  }
});

test('denied locks, unavailable storage and malformed markers never open an unguarded store', async () => {
  const { createMatrixStoreOwnership } = await import('../src/matrix-store-ownership.mjs');
  for (const options of [{ locks: {} }, { locks: { request: async () => { throw Error('denied'); } } },
    { ...fixture().options, storage: { getItem() { throw Error('blocked'); } } },
    { ...fixture().options, storage: { getItem: () => '{corrupt' } }]) {
    await assert.rejects(createMatrixStoreOwnership(options).acquire('account_alice'), { code: 'matrix_store_unavailable' });
  }
});

test('storage getter denial is deferred and leaves the browser lock available', async () => {
  const { createMatrixStoreOwnership } = await import('../src/matrix-store-ownership.mjs');
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const f = fixture();
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw Error('denied'); } });
    const manager = createMatrixStoreOwnership({ locks: f.options.locks });
    await assert.rejects(manager.acquire('account_alice'), { code: 'matrix_store_unavailable' });
    assert.equal(f.active.size, 0);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete globalThis.localStorage;
  }
});

test('messages and security surfaces explain ownership errors without exposing technical details', async () => {
  const { messagingSurfaceErrorMessage } = await import('../src/messaging-surface-controller.mjs');
  const { matrixSecurityErrorMessage } = await import('../src/matrix-security-presentation.mjs');
  for (const [code, text] of [['matrix_store_busy', /другой вкладке/], ['matrix_store_retired', /завершена/], ['matrix_store_unavailable', /безопасный доступ/]]) {
    for (const format of [messagingSurfaceErrorMessage, matrixSecurityErrorMessage]) {
      const error = { cause: { code, message: 'https://private.example/_matrix/device' } };
      assert.match(format(error), text); assert.doesNotMatch(format(error), /private|_matrix|https:/);
    }
  }
});
