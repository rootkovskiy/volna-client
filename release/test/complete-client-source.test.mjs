import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const releaseRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('the public boundary contains every first-party source selected for the client release candidate', async () => {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(path.join(releaseRoot, 'public-client-boundary.json'), 'utf8'));
  } catch {
    assert.fail(
      'public-client-boundary.json is absent: the open messaging package still executes inside an unpublished client host',
    );
  }

  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.license, 'Apache-2.0');
  assert.deepEqual(
    new Set(manifest.firstPartyRuntimeRoots),
    new Set([
      'app',
      'apps/mobile',
      'packages/content-policy',
      'packages/music-taxonomy',
      'packages/volna-messaging-client',
      'packages/volna-matrix-native',
      'packages/volna-key-directory-witness',
      'packages/volna-key-transparency-log',
      'matrix',
      'public',
    ]),
  );
  assert.ok(manifest.rootRuntimeFiles.includes('index.ts'));
  assert.ok(manifest.rootRuntimeFiles.includes('app.json'));
  assert.ok(manifest.rootRuntimeFiles.includes('metro.config.cjs'));
  assert.ok(manifest.forbiddenSourceRoots.includes('apps/api'));
});
