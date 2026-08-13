'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

function bytesToBase64(bytes) {
  return Buffer.from(bytes).toString('base64');
}

function hexToBytes(value) {
  return new Uint8Array(Buffer.from(value, 'hex'));
}

test('sparse map proof is deterministic, compressed, and fail-closed', async () => {
  const kt = await import('../src/key-transparency.mjs');
  const key = '11'.repeat(32);
  const value = {
    version: 1,
    directoryLabel: key,
    identityFingerprint: '22'.repeat(32),
    entryCount: 2,
    headHash: '33'.repeat(32),
    deviceIds: ['device_alpha', 'device_bravo'],
  };
  const leaf = kt.hashKeyTransparencyLeaf(key, value);
  const { sha256 } = await import('@noble/hashes/sha2.js');
  let current = hexToBytes(leaf);
  const keyBytes = hexToBytes(key);
  for (let depth = 31; depth >= 0; depth -= 1) {
    const children = Array(256).fill(hexToBytes(kt.keyTransparencyDefaultHash(depth + 1)));
    children[keyBytes[depth]] = current;
    current = sha256(Uint8Array.from([0x03, ...children.flatMap((child) => [...child])]));
  }
  const proof = { key, value, siblings: [], root: Buffer.from(current).toString('hex') };
  assert.deepEqual(kt.verifyKeyTransparencyMapProof(proof).value, value);
  const nonDefaultProof = {
    key,
    value,
    siblings: [{ depth: 31, index: 18, hash: '44'.repeat(32) }],
    root: 'd286de09c6d4942c147ca8242a61f6d32bdd3c44ab55b9670357db9954a0d3ca',
  };
  assert.deepEqual(kt.verifyKeyTransparencyMapProof(nonDefaultProof).value, value);
  assert.throws(() => kt.verifyKeyTransparencyMapProof({ ...proof, root: '44'.repeat(32) }), /map_proof_root/);
  assert.throws(
    () => kt.verifyKeyTransparencyMapProof({ ...proof, siblings: [{ depth: 31, index: 18, hash: kt.keyTransparencyDefaultHash(32) }] }),
    /map_proof_noncanonical/,
  );
  assert.throws(() => kt.canonicalKeyTransparencyLeaf({ ...value, deviceIds: [...value.deviceIds].reverse() }), /device_order/);
});

test('million-account modeled proof remains bounded and fast', async (context) => {
  const kt = await import('../src/key-transparency.mjs');
  const { sha256 } = await import('@noble/hashes/sha2.js');
  const key = '11'.repeat(32);
  const keyBytes = hexToBytes(key);
  const value = {
    version: 1,
    directoryLabel: key,
    identityFingerprint: '22'.repeat(32),
    entryCount: 2,
    headHash: '33'.repeat(32),
    deviceIds: ['device_alpha', 'device_bravo'],
  };
  const siblings = [];
  for (let depth = 0; depth < 3; depth += 1) {
    const count = depth < 2 ? 256 : 16;
    for (let index = 0; index < count; index += 1) {
      if (index === keyBytes[depth]) continue;
      siblings.push({
        depth,
        index,
        hash: Buffer.from(sha256(new TextEncoder().encode(`million:${depth}:${index}`))).toString('hex'),
      });
    }
  }
  let current = hexToBytes(kt.hashKeyTransparencyLeaf(key, value));
  for (let depth = 31; depth >= 0; depth -= 1) {
    const children = Array(256).fill(hexToBytes(kt.keyTransparencyDefaultHash(depth + 1)));
    for (const sibling of siblings) {
      if (sibling.depth === depth) children[sibling.index] = hexToBytes(sibling.hash);
    }
    children[keyBytes[depth]] = current;
    current = sha256(Uint8Array.from([0x03, ...children.flatMap((child) => [...child])]));
  }
  const proof = { key, value, siblings, root: Buffer.from(current).toString('hex') };
  const proofBytes = Buffer.byteLength(JSON.stringify(proof), 'utf8');
  assert.equal(siblings.length, 526);
  assert.ok(proofBytes < 64 * 1024, `modeled proof is ${proofBytes} bytes`);
  const timings = [];
  for (let iteration = 0; iteration < 100; iteration += 1) {
    const started = performance.now();
    kt.verifyKeyTransparencyMapProof(proof);
    timings.push(performance.now() - started);
  }
  timings.sort((left, right) => left - right);
  const p50 = timings[49];
  const p95 = timings[94];
  context.diagnostic(`million-account modeled proof: bytes=${proofBytes} p50=${p50.toFixed(2)}ms p95=${p95.toFixed(2)}ms`);
  assert.ok(p95 < 100, `modeled proof verification p95 is ${p95.toFixed(2)}ms`);
});

test('RFC 6962 inclusion verifies an unbalanced tree', async () => {
  const kt = await import('../src/key-transparency.mjs');
  const { sha256 } = await import('@noble/hashes/sha2.js');
  const concat = (...values) => Uint8Array.from(values.flatMap((value) => [...value]));
  const leaves = ['a', 'b', 'c'].map((value) => new TextEncoder().encode(value));
  const hashes = leaves.map((value) => sha256(concat(Uint8Array.of(0), value)));
  const left = sha256(concat(Uint8Array.of(1), hashes[0], hashes[1]));
  const root = sha256(concat(Uint8Array.of(1), left, hashes[2]));
  assert.equal(kt.verifyRfc6962Inclusion({
    leaf: leaves[2],
    index: '2',
    treeSize: '3',
    proof: [Buffer.from(left).toString('hex')],
    root: Buffer.from(root).toString('hex'),
  }), true);
  assert.throws(() => kt.verifyRfc6962Inclusion({
    leaf: leaves[2], index: '2', treeSize: '3', proof: [], root: Buffer.from(root).toString('hex'),
  }), /log_inclusion_short/);
});

test('C2SP checkpoint requires the log signature and a fresh distinct 2-of-3 quorum', async () => {
  const [kt, { ed25519 }, { sha256 }] = await Promise.all([
    import('../src/key-transparency.mjs'),
    import('@noble/curves/ed25519.js'),
    import('@noble/hashes/sha2.js'),
  ]);
  const encoder = new TextEncoder();
  const makeVkey = (name, type, privateKey) => {
    const publicKey = ed25519.getPublicKey(privateKey);
    const id = sha256(Uint8Array.from([...encoder.encode(`${name}\n`), type, ...publicKey])).subarray(0, 4);
    return {
      name,
      id,
      publicKey,
      vkey: `${name}+${Buffer.from(id).toString('hex')}+${bytesToBase64(Uint8Array.from([type, ...publicKey]))}`,
    };
  };
  const logKey = new Uint8Array(32).fill(1);
  const witnessKeys = [2, 3, 4].map((value) => new Uint8Array(32).fill(value));
  const log = makeVkey('kt.volna.social/log', 1, logKey);
  const witnesses = witnessKeys.map((key, index) => makeVkey(`witness.example/${index}`, 4, key));
  const body = `kt.volna.social/log\n3\n${bytesToBase64(new Uint8Array(32).fill(9))}\n`;
  const line = (key, id, name, payload) => `— ${name} ${bytesToBase64(Uint8Array.from([...id, ...payload]))}\n`;
  const logLine = line(logKey, log.id, log.name, ed25519.sign(encoder.encode(body), logKey));
  const timestamp = 1_786_560_000;
  const timeBytes = new Uint8Array(8);
  new DataView(timeBytes.buffer).setBigUint64(0, BigInt(timestamp));
  const witnessLine = (index, at = timestamp) => {
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setBigUint64(0, BigInt(at));
    const message = encoder.encode(`cosignature/v1\ntime ${at}\n${body}`);
    return line(witnessKeys[index], witnesses[index].id, witnesses[index].name, Uint8Array.from([...bytes, ...ed25519.sign(message, witnessKeys[index])]));
  };
  const policy = {
    origin: log.name,
    logVkey: log.vkey,
    threshold: 2,
    maxAgeSeconds: 300,
    witnessVkeys: witnesses.map((value) => value.vkey),
  };
  const note = `${body}\n${logLine}${witnessLine(0)}${witnessLine(1)}`;
  const verified = kt.verifyC2spCheckpoint({ note, policy, now: timestamp + 10 });
  assert.equal(verified.treeSize, '3');
  assert.deepEqual(verified.witnessNames, ['witness.example/0', 'witness.example/1']);
  assert.throws(() => kt.verifyC2spCheckpoint({ note, policy, now: timestamp + 1000 }), /witness_stale/);
  assert.throws(() => kt.verifyC2spCheckpoint({ note: `${body}\n${witnessLine(0)}${witnessLine(1)}`, policy, now: timestamp }), /log_signature_missing/);
  assert.throws(
    () => kt.verifyC2spCheckpoint({ note: `${body}\n${logLine}${witnessLine(0)}${witnessLine(0)}`, policy, now: timestamp }),
    /signature_duplicate/,
  );
});
