import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const releaseRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function resolveMetroImageSize() {
  const rootRequire = createRequire(path.join(releaseRoot, 'package.json'));
  const metroRequire = createRequire(rootRequire.resolve('metro/package.json'));
  const metroFileMapRequire = createRequire(metroRequire.resolve('metro-file-map/package.json'));
  return metroFileMapRequire.resolve('image-size');
}

test('patched image-size rejects zero-length ICNS and JXL records without hanging', () => {
  const imageSizeEntry = resolveMetroImageSize();
  const script = String.raw`
    const imageSize = require(${JSON.stringify(imageSizeEntry)});
    const ascii = (value) => [...Buffer.from(value, 'ascii')];
    const be32 = (value) => [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
    const malformedIcns = Uint8Array.from([...ascii('icns'), ...be32(16), ...ascii('ic10'), ...be32(0)]);
    const malformedJxl = Uint8Array.from([
      ...be32(12), ...ascii('JXL '), 0, 0, 0, 0,
      ...be32(12), ...ascii('ftyp'), ...ascii('jxl '),
      ...be32(0), ...ascii('jxlp'), 0, 0, 0, 0,
    ]);
    for (const input of [malformedIcns, malformedJxl]) {
      let rejected = false;
      try { imageSize(input); } catch { rejected = true; }
      if (!rejected) process.exit(2);
    }
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    encoding: 'utf8',
    timeout: 2_000,
    windowsHide: true,
  });
  assert.equal(result.error?.code, undefined, `parser subprocess failed or timed out: ${result.error?.message ?? ''}`);
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
});
