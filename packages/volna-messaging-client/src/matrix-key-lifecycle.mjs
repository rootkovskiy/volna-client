// A retired key object must never authorize another persistence operation.
// A new session gets a distinct key copy, even when reopening the same store.
const lifetimes = new WeakMap();
const accountShutdowns = new Map();

function lifetime(key) {
  if (!(key instanceof Uint8Array) || key.length !== 32) throw new Error('Invalid Matrix storage key');
  let state = lifetimes.get(key);
  if (!state) {
    state = { closed: false, writes: new Set() };
    lifetimes.set(key, state);
  }
  return state;
}

export function assertMatrixKeyActive(key) {
  if (lifetime(key).closed || !key.some(byte => byte !== 0)) {
    throw new Error('Matrix session is closed');
  }
  lifetime(key).guard?.();
}

export function bindMatrixKeyGuard(key, guard) {
  assertMatrixKeyActive(key);
  lifetime(key).guard = guard;
}

export async function withMatrixKeyWrite(key, operation) {
  assertMatrixKeyActive(key);
  const state = lifetime(key);
  const write = Promise.resolve().then(() => {
    assertMatrixKeyActive(key);
    return operation();
  });
  state.writes.add(write);
  try { return await write; } finally { state.writes.delete(write); }
}

// Fence synchronously, then drain only local writes. Never hold this fence across
// network calls: a 401 callback can itself wait for account shutdown.
export async function closeMatrixKey(key) {
  const state = lifetime(key);
  state.closed = true;
  await Promise.allSettled([...state.writes]);
}

export function assertMatrixAccountOpen(accountId) {
  if (accountShutdowns.has(accountId)) throw new Error('Matrix session is closing');
}

export async function withMatrixAccountShutdown(accountId, operation) {
  const previous = accountShutdowns.get(accountId) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  accountShutdowns.set(accountId, current);
  try { return await current; } finally {
    if (accountShutdowns.get(accountId) === current) accountShutdowns.delete(accountId);
  }
}
