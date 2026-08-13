function state(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('witness database returned invalid state');
  }
  return JSON.parse(JSON.stringify(value));
}

export function createPostgresKeyDirectoryWitnessStore(pool) {
  if (pool === null || typeof pool !== 'object' || typeof pool.query !== 'function') {
    throw new TypeError('a PostgreSQL pool is required');
  }
  return Object.freeze({
    async load(directoryLabel) {
      const result = await pool.query(
        'SELECT revision, state FROM key_directory_witness_state WHERE directory_label = $1',
        [directoryLabel],
      );
      if (result.rowCount === 0) return null;
      const stored = state(result.rows[0].state);
      if (String(stored.revision) !== String(result.rows[0].revision)) {
        throw new Error('witness database revision does not match signed state');
      }
      return stored;
    },
    async compareAndSwap(directoryLabel, expectedRevision, next) {
      const stored = state(next);
      if (expectedRevision === null) {
        const result = await pool.query(
          `INSERT INTO key_directory_witness_state (directory_label, revision, state)
           VALUES ($1, $2, $3::jsonb)
           ON CONFLICT (directory_label) DO NOTHING
           RETURNING directory_label`,
          [directoryLabel, stored.revision, JSON.stringify(stored)],
        );
        return result.rowCount === 1;
      }
      const result = await pool.query(
        `UPDATE key_directory_witness_state
         SET revision = $3, state = $4::jsonb, updated_at = now()
         WHERE directory_label = $1 AND revision = $2
         RETURNING directory_label`,
        [directoryLabel, expectedRevision, stored.revision, JSON.stringify(stored)],
      );
      return result.rowCount === 1;
    },
  });
}

export async function checkPostgresKeyDirectoryWitnessStore(pool) {
  const result = await pool.query("SELECT to_regclass('key_directory_witness_state') AS table_name");
  if (result.rows[0]?.table_name !== 'key_directory_witness_state') {
    throw new Error('key_directory_witness_state is missing; apply schema.sql first');
  }
  await pool.query('SELECT 1 FROM key_directory_witness_state LIMIT 1');
}
