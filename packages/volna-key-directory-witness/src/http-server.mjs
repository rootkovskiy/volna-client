import { createServer } from 'node:http';
import {
  KeyDirectoryWitnessError,
  verifyKeyDirectorySnapshotReceipt,
} from '@volna/messaging-client/key-directory-witness';
import { keyDirectoryLabel, verifyKeyDirectorySnapshot } from '@volna/messaging-client/mls-runtime';

const HASH = /^[0-9a-f]{64}$/;
const MAX_BODY_BYTES = 512 * 1024;

function json(response, status, body, origin) {
  const encoded = Buffer.from(JSON.stringify(body));
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': encoded.length,
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    ...(origin === undefined ? {} : { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' }),
  });
  response.end(encoded);
}

function checkpointFromUrl(url, directoryLabel) {
  if (!HASH.test(directoryLabel)) throw new KeyDirectoryWitnessError('checkpoint_label');
  const allowed = new Set(['entryCount', 'headHash', 'identityFingerprint']);
  if (
    [...url.searchParams.keys()].some((key) => !allowed.has(key))
    || [...allowed].some((key) => url.searchParams.getAll(key).length !== 1)
  ) {
    throw new KeyDirectoryWitnessError('checkpoint_query');
  }
  const entryCountText = url.searchParams.get('entryCount');
  const identityFingerprint = url.searchParams.get('identityFingerprint');
  const headHashText = url.searchParams.get('headHash');
  if (!/^(?:0|[1-9][0-9]{0,3})$/.test(entryCountText ?? '') || !HASH.test(identityFingerprint ?? '')) {
    throw new KeyDirectoryWitnessError('checkpoint_query');
  }
  const entryCount = Number(entryCountText);
  const headHash = headHashText === 'none' ? null : headHashText;
  if ((entryCount === 0) !== (headHash === null) || (headHash !== null && !HASH.test(headHash ?? ''))) {
    throw new KeyDirectoryWitnessError('checkpoint_query');
  }
  return { directoryLabel, identityFingerprint, entryCount, headHash };
}

async function body(request) {
  const declared = Number(request.headers['content-length']);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new KeyDirectoryWitnessError('body_too_large');
  const chunks = [];
  let bytes = 0;
  let tooLarge = false;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) {
      tooLarge = true;
      continue;
    }
    chunks.push(chunk);
  }
  if (tooLarge) throw new KeyDirectoryWitnessError('body_too_large');
  let parsed;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    throw new KeyDirectoryWitnessError('body_json', error);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new KeyDirectoryWitnessError('body_json');
  }
  return parsed;
}

function errorStatus(error) {
  if (!(error instanceof KeyDirectoryWitnessError)) return 503;
  if (error.code === 'body_too_large') return 413;
  if (error.code === 'receipt_signature' || error.code === 'receipt_expired' || error.code === 'receipt_checkpoint') return 401;
  if (error.code === 'rollback' || error.code === 'split_view' || error.code === 'identity_changed') return 409;
  if (error.code === 'store_contention') return 503;
  return 400;
}

export function createWitnessHttpServer(options) {
  const witness = options?.witness;
  const receiptPublicKey = options?.receiptPublicKey;
  const readiness = options?.readiness ?? (async () => undefined);
  const allowedOrigins = new Set(options?.allowedOrigins ?? []);
  const maximumConcurrentObservations = options?.maximumConcurrentObservations ?? 16;
  if (!witness || typeof witness.observe !== 'function' || typeof witness.getStatement !== 'function') {
    throw new TypeError('witness is required');
  }
  if (!Number.isSafeInteger(maximumConcurrentObservations) || maximumConcurrentObservations < 1 || maximumConcurrentObservations > 128) {
    throw new TypeError('maximumConcurrentObservations must be between 1 and 128');
  }
  const metrics = { requests: 0, observations: 0, conflicts: 0, failures: 0 };
  let activeObservations = 0;

  const server = createServer(async (request, response) => {
    metrics.requests += 1;
    const origin = request.headers.origin;
    const permittedOrigin = origin !== undefined && allowedOrigins.has(origin) ? origin : undefined;
    if (origin !== undefined && permittedOrigin === undefined) {
      json(response, 403, { error: 'origin_not_allowed' });
      return;
    }
    if (request.method === 'OPTIONS') {
      if (permittedOrigin === undefined) {
        json(response, 403, { error: 'origin_not_allowed' });
        return;
      }
      response.writeHead(204, {
        'Access-Control-Allow-Origin': permittedOrigin,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'content-type',
        'Access-Control-Max-Age': '600',
        Vary: 'Origin',
      });
      response.end();
      return;
    }
    const url = new URL(request.url ?? '/', 'http://witness.invalid');
    try {
      if (request.method === 'GET' && url.pathname === '/health/live') {
        json(response, 200, { status: 'ok', witnessId: witness.witnessId }, permittedOrigin);
        return;
      }
      if (request.method === 'GET' && url.pathname === '/health/ready') {
        await readiness();
        json(response, 200, { status: 'ready', witnessId: witness.witnessId, publicKey: witness.publicKey }, permittedOrigin);
        return;
      }
      if (request.method === 'GET' && url.pathname === '/metrics') {
        const lines = [
          '# TYPE volna_witness_requests_total counter',
          `volna_witness_requests_total ${metrics.requests}`,
          '# TYPE volna_witness_observations_total counter',
          `volna_witness_observations_total ${metrics.observations}`,
          '# TYPE volna_witness_conflicts_total counter',
          `volna_witness_conflicts_total ${metrics.conflicts}`,
          '# TYPE volna_witness_failures_total counter',
          `volna_witness_failures_total ${metrics.failures}`,
          '# TYPE volna_witness_active_observations gauge',
          `volna_witness_active_observations ${activeObservations}`,
          '',
        ].join('\n');
        response.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
        response.end(lines);
        return;
      }
      const checkpointMatch = /^\/v1\/key-directory\/checkpoints\/([0-9a-f]{64})$/.exec(url.pathname);
      if (request.method === 'GET' && checkpointMatch) {
        const statement = await witness.getStatement(checkpointFromUrl(url, checkpointMatch[1]));
        json(response, statement === null ? 404 : 200, statement ?? { error: 'checkpoint_not_observed' }, permittedOrigin);
        return;
      }
      if (request.method === 'POST' && url.pathname === '/v1/key-directory/observations') {
        if (request.headers.authorization !== undefined || request.headers.cookie !== undefined) {
          json(response, 400, { error: 'credentials_forbidden' }, permittedOrigin);
          return;
        }
        if (request.headers['content-type']?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
          json(response, 415, { error: 'content_type' }, permittedOrigin);
          return;
        }
        if (activeObservations >= maximumConcurrentObservations) {
          json(response, 503, { error: 'observation_capacity' }, permittedOrigin);
          return;
        }
        activeObservations += 1;
        try {
          const observation = await body(request);
          const verification = verifyKeyDirectorySnapshot(observation.snapshot);
          const checkpoint = {
            version: 1,
            directoryLabel: keyDirectoryLabel(verification.accountId),
            identityFingerprint: verification.identityFingerprint,
            entryCount: verification.entryHashes.length,
            headHash: verification.headHash,
          };
          verifyKeyDirectorySnapshotReceipt({ receipt: observation.receipt, checkpoint, publicKey: receiptPublicKey });
          const statement = await witness.observe(observation.snapshot);
          metrics.observations += 1;
          json(response, 200, statement, permittedOrigin);
        } finally {
          activeObservations -= 1;
        }
        return;
      }
      json(response, 404, { error: 'not_found' }, permittedOrigin);
    } catch (error) {
      const status = errorStatus(error);
      if (status === 409) metrics.conflicts += 1;
      else metrics.failures += 1;
      json(response, status, { error: error instanceof KeyDirectoryWitnessError ? error.code : 'service_unavailable' }, permittedOrigin);
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 64;
  return server;
}
