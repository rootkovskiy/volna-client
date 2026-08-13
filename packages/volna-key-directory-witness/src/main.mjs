import { Pool } from 'pg';
import { createKeyDirectoryWitness } from '@volna/messaging-client/key-directory-witness';
import { base64UrlToBytes } from '@volna/messaging-client/mls-runtime';
import { createWitnessHttpServer } from './http-server.mjs';
import {
  checkPostgresKeyDirectoryWitnessStore,
  createPostgresKeyDirectoryWitnessStore,
} from './postgres-store.mjs';

function required(name, value) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${name} is required`);
  return value.trim();
}

function validateRawKey(name, value) {
  let bytes;
  try {
    bytes = base64UrlToBytes(value, 32);
    if (bytes.length !== 32) throw new Error(`${name} is invalid`);
  } catch (error) {
    throw new Error(`${name} is invalid`, { cause: error });
  } finally {
    bytes?.fill(0);
  }
}

function validateBrowserOrigin(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch (error) {
    throw new Error(`WITNESS_ALLOWED_ORIGINS contains an invalid origin: ${value}`, { cause: error });
  }
  const localDevelopment = parsed.protocol === 'http:'
    && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if (parsed.origin !== value || (parsed.protocol !== 'https:' && !localDevelopment)) {
    throw new Error(`WITNESS_ALLOWED_ORIGINS contains an invalid origin: ${value}`);
  }
  return value;
}

const databaseUrl = required('WITNESS_DATABASE_URL', process.env.WITNESS_DATABASE_URL);
const witnessId = required('WITNESS_ID', process.env.WITNESS_ID);
const signingKey = required('WITNESS_SIGNING_KEY', process.env.WITNESS_SIGNING_KEY);
const receiptPublicKey = required(
  'VOLNA_DIRECTORY_RECEIPT_PUBLIC_KEY',
  process.env.VOLNA_DIRECTORY_RECEIPT_PUBLIC_KEY,
);
const port = Number(process.env.WITNESS_PORT ?? 8080);
const poolSize = Number(process.env.WITNESS_DATABASE_POOL_SIZE ?? 10);
const maximumConcurrentObservations = Number(process.env.WITNESS_MAX_CONCURRENT_OBSERVATIONS ?? 16);
if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new Error('WITNESS_PORT is invalid');
if (!Number.isSafeInteger(poolSize) || poolSize < 1 || poolSize > 50) throw new Error('WITNESS_DATABASE_POOL_SIZE is invalid');
if (
  !Number.isSafeInteger(maximumConcurrentObservations)
  || maximumConcurrentObservations < 1
  || maximumConcurrentObservations > 128
) throw new Error('WITNESS_MAX_CONCURRENT_OBSERVATIONS is invalid');
if (!/^[A-Za-z0-9_-]{8,80}$/.test(witnessId)) throw new Error('WITNESS_ID is invalid');
validateRawKey('WITNESS_SIGNING_KEY', signingKey);
validateRawKey('VOLNA_DIRECTORY_RECEIPT_PUBLIC_KEY', receiptPublicKey);

const pool = new Pool({ connectionString: databaseUrl, max: poolSize, application_name: `volna-witness-${witnessId}` });
await checkPostgresKeyDirectoryWitnessStore(pool);
const witness = createKeyDirectoryWitness({
  witnessId,
  signingKey,
  store: createPostgresKeyDirectoryWitnessStore(pool),
});
const allowedOrigins = (process.env.WITNESS_ALLOWED_ORIGINS ?? 'https://volna.social')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
  .map(validateBrowserOrigin);
if (allowedOrigins.length === 0 || new Set(allowedOrigins).size !== allowedOrigins.length) {
  throw new Error('WITNESS_ALLOWED_ORIGINS must contain distinct explicit origins');
}
const server = createWitnessHttpServer({
  witness,
  receiptPublicKey,
  allowedOrigins,
  maximumConcurrentObservations,
  readiness: () => checkPostgresKeyDirectoryWitnessStore(pool),
});

server.listen(port, '0.0.0.0', () => {
  process.stdout.write(JSON.stringify({ event: 'witness_started', witnessId, publicKey: witness.publicKey, port }) + '\n');
});

let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  await new Promise((resolve) => {
    server.close(resolve);
    server.closeIdleConnections?.();
  });
  try {
    await pool.end();
  } finally {
    witness.destroy();
  }
};
process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());
