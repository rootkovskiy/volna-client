import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { finalizeWebExport } from '../scripts/finalize-web-export.mjs';
import { hashWebFiles, writeWebArtifactEvidence } from '../scripts/web-artifact-evidence.mjs';

test('public Web release includes deterministic post-processing and every served asset', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'volna-public-web-'));
  try {
    const manifests = [];
    for (const copy of ['first', 'second']) {
      const root = path.join(temporary, copy);
      const js = path.join(root, '_expo/static/js/web');
      await mkdir(js, { recursive: true });
      await writeFile(path.join(js, 'entry-same.js'), "load('/_expo/static/js/web/child.js')");
      await writeFile(path.join(js, 'child.js'), 'child();');
      await writeFile(path.join(root, 'index.html'), '<script src="/_expo/static/js/web/entry-same.js"></script>');
      await writeFile(path.join(root, 'service-worker.js'), 'worker();');
      await finalizeWebExport(root);
      await writeWebArtifactEvidence(root);
      const hashes = await hashWebFiles(root);
      assert.ok(hashes.some(entry => entry.path.endsWith('/matrix_sdk_crypto_wasm_bg.wasm')));
      assert.ok(hashes.some(entry => entry.path === 'service-worker.js'));
      const manifest = await readFile(path.join(root, 'web-artifacts.sha256'), 'utf8');
      assert.equal(manifest, hashes.map(entry => `${entry.sha256}  ${entry.path}\n`).join(''));
      manifests.push(manifest);
      await writeFile(path.join(root, 'service-worker.js'), 'changed();');
      assert.notDeepEqual(await hashWebFiles(root), hashes);
    }
    assert.equal(manifests[0], manifests[1]);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('diagnostic source maps cannot be silently invalidated by release rewriting', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'volna-public-web-'));
  try {
    const js = path.join(root, '_expo/static/js/web');
    await mkdir(js, { recursive: true });
    await writeFile(path.join(js, 'entry-test.js'), 'original');
    await writeFile(path.join(js, 'entry-test.js.map'), '{}');
    await assert.rejects(finalizeWebExport(root), /without --source-maps/);
    assert.equal(await readFile(path.join(js, 'entry-test.js'), 'utf8'), 'original');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
