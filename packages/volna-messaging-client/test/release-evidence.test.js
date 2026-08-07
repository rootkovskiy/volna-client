'use strict';

const assert = require('node:assert/strict');
const { mkdtemp, readFile, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { gunzipSync } = require('node:zlib');

test('public source archive and CycloneDX inventory are byte-reproducible and unsigned honestly', async () => {
  const { buildReleaseEvidence } = await import('../scripts/build-release-evidence.mjs');
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'volna-messaging-evidence-'));
  try {
    const firstDirectory = path.join(temporary, 'first');
    const secondDirectory = path.join(temporary, 'second');
    const first = await buildReleaseEvidence({ outputDirectory: firstDirectory });
    const second = await buildReleaseEvidence({ outputDirectory: secondDirectory });
    assert.deepEqual(first, second);
    assert.equal(first.assurance.reproducibleSourceArtifact, true);
    assert.equal(first.assurance.signed, false);
    assert.equal(first.assurance.independentlyReviewed, false);
    assert.equal(
      JSON.parse(await readFile(path.join(firstDirectory, first.sourceTree.file), 'utf8')).files.length,
      first.sourceTree.files,
    );
    const firstArchive = await readFile(path.join(firstDirectory, first.sourceArchive.file));
    const secondArchive = await readFile(path.join(secondDirectory, second.sourceArchive.file));
    assert.equal(Buffer.compare(firstArchive, secondArchive), 0);
    assert.equal(
      gunzipSync(firstArchive).subarray(0, 100).toString('utf8').replaceAll('\0', '').startsWith('volna-messaging-client-0.1.0/'),
      true,
    );
    const sbomText = await readFile(path.join(firstDirectory, first.sbom.file), 'utf8');
    const sbom = JSON.parse(sbomText);
    assert.equal(sbom.bomFormat, 'CycloneDX');
    assert.equal(sbom.specVersion, '1.6');
    assert.ok(sbom.components.some((component) => component.purl === 'pkg:npm/ts-mls@1.6.2'));
    assert.ok(sbom.components.some((component) => component.purl === 'pkg:cargo/openmls@0.8.1'));
    assert.equal(sbomText.includes(temporary), false);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
