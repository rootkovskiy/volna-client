'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

test('gossip monitor verifies signatures and permanently rejects rollback, equivocation, and split views', async () => {
  const [{ ed25519 }, runtime, gossip] = await Promise.all([
    import('@noble/curves/ed25519.js'),
    import('../src/mls-runtime.mjs'),
    import('../src/key-directory-gossip.mjs'),
  ]);
  const keys = [new Uint8Array(32).fill(31), new Uint8Array(32).fill(32)];
  const witnesses = keys.map((key, index) => ({
    id: `witness_${index + 1}`,
    publicKey: runtime.bytesToBase64Url(ed25519.getPublicKey(key)),
  }));
  const label = 'a'.repeat(64);
  const identity = 'b'.repeat(64);
  const statement = (index, entryCount, headHash, observedAt) => {
    const unsigned = {
      version: 1,
      witnessId: witnesses[index].id,
      checkpoint: { version: 1, directoryLabel: label, identityFingerprint: identity, entryCount, headHash },
      observedAt,
    };
    return {
      ...unsigned,
      signature: runtime.bytesToBase64Url(ed25519.sign(
        runtime.canonicalKeyDirectoryWitnessStatement(unsigned),
        keys[index],
      )),
    };
  };
  const monitor = gossip.createKeyDirectoryGossipMonitor({
    policy: { witnesses },
    store: gossip.createMemoryKeyDirectoryGossipStore(),
  });
  const firstAt = '2026-08-08T10:00:00.000Z';
  const secondAt = '2026-08-08T10:01:00.000Z';
  await monitor.observe(statement(0, 1, 'c'.repeat(64), firstAt));
  const corroborated = await monitor.observe(statement(1, 1, 'c'.repeat(64), secondAt));
  assert.deepEqual(corroborated.checkpoints[0].witnessIds, ['witness_1', 'witness_2']);
  assert.deepEqual(Object.keys(corroborated.checkpoints[0].statements).sort(), ['witness_1', 'witness_2']);
  await assert.rejects(
    monitor.observe(statement(1, 1, 'd'.repeat(64), secondAt)),
    /split_view|witness_equivocation/,
  );
  await monitor.observe(statement(0, 2, 'e'.repeat(64), secondAt));
  await assert.rejects(
    monitor.observe(statement(0, 1, 'c'.repeat(64), '2026-08-08T10:02:00.000Z')),
    /witness_rollback/,
  );
  const tampered = statement(1, 2, 'e'.repeat(64), secondAt);
  tampered.checkpoint.headHash = 'f'.repeat(64);
  await assert.rejects(monitor.observe(tampered), /statement_signature/);
  const evidence = await monitor.getEvidence(label);
  assert.equal(JSON.stringify(evidence).includes('account_'), false);

  const corrupted = structuredClone(evidence);
  const originalSignature = corrupted.checkpoints[0].statements.witness_1.signature;
  const replacement = originalSignature.endsWith('A') ? 'B' : 'A';
  corrupted.checkpoints[0].statements.witness_1.signature = `${originalSignature.slice(0, -1)}${replacement}`;
  const corruptedMonitor = gossip.createKeyDirectoryGossipMonitor({
    policy: { witnesses },
    store: {
      load: async () => corrupted,
      compareAndSwap: async () => assert.fail('corrupted evidence must never be committed'),
    },
  });
  await assert.rejects(corruptedMonitor.getEvidence(label), /statement_signature/);
});
