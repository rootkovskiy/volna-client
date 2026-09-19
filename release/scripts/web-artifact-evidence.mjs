import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const manifestName = 'web-artifacts.sha256';

export async function hashWebFiles(directory) {
  const root = path.resolve(directory);
  const entries = [];
  async function visit(relative = '') {
    for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (name === manifestName) continue;
      if (entry.isSymbolicLink()) throw Error(`Symbolic link in Web export: ${name}`);
      if (entry.isDirectory()) await visit(name);
      else if (entry.isFile()) {
        if (/[\r\n\\]/.test(name)) throw Error('Unsupported artifact filename');
        const bytes = await readFile(path.join(root, name));
        entries.push({ path: name, sha256: createHash('sha256').update(bytes).digest('hex') });
      } else throw Error(`Unsupported Web artifact: ${name}`);
    }
  }
  await visit();
  return entries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

export async function writeWebArtifactEvidence(directory) {
  const root = path.resolve(directory);
  // The same public adapter serves this asset in the product gateway. Copy the
  // installed integrity-pinned bytes so a public static build is self-contained.
  const adapterPath = require.resolve('../../packages/volna-messaging-client/metro.cjs');
  const { matrixCryptoAssetPath } = require(adapterPath);
  const sdkEntry = require.resolve('matrix-js-sdk', { paths: [path.dirname(adapterPath)] });
  const cryptoEntry = require.resolve('@matrix-org/matrix-sdk-crypto-wasm', { paths: [path.dirname(sdkEntry)] });
  if (!/^\/matrix-assets\/[a-zA-Z0-9./_-]+\.wasm$/.test(matrixCryptoAssetPath)
    || matrixCryptoAssetPath.split('/').includes('..')) throw Error('Invalid pinned Matrix asset path');
  const asset = path.join(root, matrixCryptoAssetPath.slice(1));
  await mkdir(path.dirname(asset), { recursive: true });
  await copyFile(path.join(path.dirname(cryptoEntry), 'pkg/matrix_sdk_crypto_wasm_bg.wasm'), asset);
  const entries = await hashWebFiles(root);
  if (!entries.some(entry => entry.path === 'web-release.json') || !entries.some(entry => entry.path === 'index.html')) {
    throw Error('Expected a finalized Web export');
  }
  await writeFile(path.join(root, manifestName), entries.map(entry => `${entry.sha256}  ${entry.path}\n`).join(''));
  return { files: entries.length, manifest: manifestName };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw Error('Usage: node release/scripts/web-artifact-evidence.mjs <finalized export>');
  console.log(JSON.stringify(await writeWebArtifactEvidence(process.argv[2])));
}
