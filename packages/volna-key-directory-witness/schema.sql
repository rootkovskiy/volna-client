CREATE TABLE IF NOT EXISTS key_directory_witness_state (
  directory_label char(64) PRIMARY KEY,
  revision bigint NOT NULL CHECK (revision > 0),
  state jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (directory_label ~ '^[0-9a-f]{64}$'),
  CHECK ((state ->> 'directoryLabel') = directory_label),
  CHECK ((state ->> 'revision')::bigint = revision)
);

REVOKE ALL ON key_directory_witness_state FROM PUBLIC;
