// Web Locks, not an expiring localStorage lease: a suspended tab must never
// overlap a new SDK owner. The only persisted coordination data is a logout
// generation/pending bit, with no credentials, keys or message content.
export class MatrixStoreOwnershipError extends Error {
  constructor(code) { super(code); this.name = 'MatrixStoreOwnershipError'; this.code = code; }
}

export function createMatrixStoreOwnership({ locks = globalThis.navigator?.locks,
  storage, events = globalThis.window,
  newGeneration = () => globalThis.crypto.randomUUID() } = {}) {
  const markerKey = accountId => `volna.matrix.logout.v1:${accountId}`;
  const read = accountId => {
    try {
      // Access can itself throw in a storage-denied browser. Defer it until
      // acquisition, so constructing the disabled messaging runtime still works.
      const raw = (storage ?? globalThis.localStorage).getItem(markerKey(accountId));
      if (raw === null) return { generation: '', pending: false };
      const value = JSON.parse(raw);
      if (typeof value?.generation !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(value.generation)
          || typeof value.pending !== 'boolean') throw Error('invalid marker');
      return value;
    } catch { throw new MatrixStoreOwnershipError('matrix_store_unavailable'); }
  };
  const write = (accountId, value) => {
    try { (storage ?? globalThis.localStorage).setItem(markerKey(accountId), JSON.stringify(value)); }
    catch { throw new MatrixStoreOwnershipError('matrix_store_unavailable'); }
  };
  const validate = accountId => {
    if (typeof accountId !== 'string' || !/^[A-Za-z0-9_-]{8,80}$/.test(accountId)) throw Error('Invalid Matrix account');
  };

  const requestLogout = accountId => {
    validate(accountId);
    const generation = newGeneration();
    write(accountId, { generation, pending: true });
    // Storage events reach other documents; this also retires duplicate managers
    // in this document, including a previous development/HMR module instance.
    events?.dispatchEvent(new Event('volna:matrix-logout'));
  };

  const acquire = async (accountId, onInvalidate = () => {}) => {
    validate(accountId);
    if (!locks?.request) throw new MatrixStoreOwnershipError('matrix_store_unavailable');
    let resolveReady, rejectReady, finish;
    let held = false, retired = false, generation;
    const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    const lifetime = new Promise(resolve => { finish = resolve; });
    const invalidate = () => {
      if (!held || retired) return;
      retired = true;
      onInvalidate(); // stop the SDK/fence keys; only its owner releases the lock
    };
    const changed = () => {
      try { if (read(accountId).generation !== generation) invalidate(); }
      catch { invalidate(); }
    };
    const onStorage = event => {
      if (event.key === null) invalidate(); // storage.clear also erased device material
      else if (event.key === markerKey(accountId)) changed();
    };
    const detach = () => {
      events?.removeEventListener('storage', onStorage);
      events?.removeEventListener('volna:matrix-logout', changed);
      events?.removeEventListener('pagehide', invalidate);
    };
    const completed = Promise.resolve().then(() => locks.request(`volna.matrix.store.v1:${accountId}`,
      { mode: 'exclusive', ifAvailable: true }, async lock => {
        if (!lock) throw new MatrixStoreOwnershipError('matrix_store_busy');
        generation = read(accountId).generation;
        held = true;
        events?.addEventListener('storage', onStorage);
        events?.addEventListener('volna:matrix-logout', changed);
        events?.addEventListener('pagehide', invalidate);
        resolveReady({
          assertActive() {
            let current;
            try { current = read(accountId); }
            catch (error) { invalidate(); throw error; }
            if (!held || retired || current.generation !== generation) {
              invalidate();
              throw new MatrixStoreOwnershipError('matrix_store_retired');
            }
          },
          pendingLogout() {
            if (!held) throw new MatrixStoreOwnershipError('matrix_store_retired');
            const marker = read(accountId);
            return marker.pending ? marker.generation : null;
          },
          acknowledgeLogout(value) {
            if (!held) throw new MatrixStoreOwnershipError('matrix_store_retired');
            const marker = read(accountId);
            if (marker.generation === value && marker.pending) write(accountId, { ...marker, pending: false });
          },
          async release() {
            held = false; detach(); finish();
            await completed;
          },
        });
        await lifetime;
      })).catch(error => {
        invalidate();
        held = false; detach();
        rejectReady(error instanceof MatrixStoreOwnershipError ? error : new MatrixStoreOwnershipError('matrix_store_unavailable'));
      });
    return ready;
  };
  return { acquire, requestLogout };
}
