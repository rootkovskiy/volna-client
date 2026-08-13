import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import {
  checkPostgresKeyDirectoryWitnessStore,
  createPostgresKeyDirectoryWitnessStore,
} from '../src/postgres-store.mjs';

const databaseUrl = process.env.WITNESS_TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;

integration('PostgreSQL store permits exactly one winner for each CAS revision', async (context) => {
  const pool = new Pool({ connectionString: databaseUrl, max: 4 });
  context.after(() => pool.end());
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  await pool.query(await readFile(path.join(root, 'schema.sql'), 'utf8'));
  await checkPostgresKeyDirectoryWitnessStore(pool);
  const store = createPostgresKeyDirectoryWitnessStore(pool);
  const label = 'e'.repeat(64);
  await pool.query('DELETE FROM key_directory_witness_state WHERE directory_label = $1', [label]);
  const first = { version: 1, revision: 1, directoryLabel: label };
  const insertRace = await Promise.all([
    store.compareAndSwap(label, null, first),
    store.compareAndSwap(label, null, first),
  ]);
  assert.equal(insertRace.filter(Boolean).length, 1);
  assert.deepEqual(await store.load(label), first);

  const second = { ...first, revision: 2 };
  const updateRace = await Promise.all([
    store.compareAndSwap(label, 1, second),
    store.compareAndSwap(label, 1, second),
  ]);
  assert.equal(updateRace.filter(Boolean).length, 1);
  assert.deepEqual(await store.load(label), second);
});
