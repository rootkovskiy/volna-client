import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildPublicClientEvidence } from '../scripts/build-release-evidence.mjs';

const releaseRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('the complete client source archive and SBOM are byte-reproducible and honest', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'volna-client-evidence-'));
  try {
    const firstDirectory = path.join(temporary, 'first');
    const secondDirectory = path.join(temporary, 'second');
    const first = await buildPublicClientEvidence({ outputDirectory: firstDirectory });
    const second = await buildPublicClientEvidence({ outputDirectory: secondDirectory });

    assert.deepEqual(first, second);
    assert.equal(first.boundary.completeFirstPartyClientSource, true);
    assert.equal(first.boundary.proprietaryBackendIncluded, false);
    assert.equal(first.assurance.reproducibleSourceArtifact, true);
    assert.equal(first.assurance.reproducibleNativeBinary, false);
    assert.equal(first.assurance.signed, false);
    assert.equal(first.assurance.independentlyReviewed, false);
    assert.equal(first.assurance.webOriginReplacementResistant, false);

    const sourceTreeText = await readFile(path.join(firstDirectory, first.sourceTree.file), 'utf8');
    const sourcePaths = JSON.parse(sourceTreeText).files.map((entry) => entry.path);
    const boundary = JSON.parse(await readFile(path.join(releaseRoot, 'public-client-boundary.json'), 'utf8'));
    for (const required of [
      'app.json',
      'app/_layout.tsx',
      'apps/mobile/App.tsx',
      'apps/mobile/src/messaging/secureMessaging.ts',
      'packages/volna-messaging-client/src/mls-runtime.mjs',
      'public/service-worker.js',
      'release/public-client-boundary.json',
    ]) {
      assert.ok(sourcePaths.includes(required), `missing ${required}`);
    }
    for (const requiredRootFile of boundary.requiredArchiveRootFiles) {
      assert.ok(sourcePaths.includes(requiredRootFile), `missing release root file ${requiredRootFile}`);
    }
    assert.equal(sourcePaths.some((entry) => entry.startsWith('apps/api/')), false);
    assert.equal(sourcePaths.some((entry) => /(?:^|\/)\.env(?:\.|$)/.test(entry)), false);

    const firstArchive = await readFile(path.join(firstDirectory, first.sourceArchive.file));
    const secondArchive = await readFile(path.join(secondDirectory, second.sourceArchive.file));
    assert.equal(Buffer.compare(firstArchive, secondArchive), 0);

    const sbomText = await readFile(path.join(firstDirectory, first.sbom.file), 'utf8');
    const sbom = JSON.parse(sbomText);
    assert.equal(sbom.bomFormat, 'CycloneDX');
    assert.equal(sbom.specVersion, '1.6');
    assert.ok(sbom.components.some((component) => component.purl === 'pkg:npm/ts-mls@1.6.2'));
    assert.equal(sbom.components.some((component) => component.name.startsWith('@nestjs/')), false);
    assert.equal(sbom.components.some((component) => component.name.startsWith('@prisma/')), false);
    assert.equal(sbomText.includes(temporary), false);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
