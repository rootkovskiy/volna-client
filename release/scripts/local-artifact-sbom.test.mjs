import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePnpmComponents } from './build-release-evidence.mjs';

test('custom local WASM remains in CycloneDX with its real version and integrity', () => {
  const records = parsePnpmComponents("packages:\n  '@matrix-org/matrix-sdk-crypto-wasm@file:packages/sdk/custom.tgz':\n    resolution: {integrity: sha512-YWJj, tarball: file:packages/sdk/custom.tgz}\n    version: 18.5.0-volna.2\nsnapshots:\n");
  const [record] = records.values();
  assert.equal(records.size, 1);
  assert.equal(record.name, '@matrix-org/matrix-sdk-crypto-wasm');
  assert.equal(record.version, '18.5.0-volna.2');
  assert.deepEqual(record.hashes, [{ alg: 'SHA-512', content: '616263' }]);
});
