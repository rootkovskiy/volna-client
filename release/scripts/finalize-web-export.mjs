import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile, mkdir, rename, lstat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const legacyPrefix = '/_expo/static/js/';
export async function finalizeWebExport(directory) {
  const root = path.resolve(directory);
  const source = path.join(root, '_expo/static/js/web');
  const files = (await readdir(source)).sort();
  if (!files.some(file => /^entry-.*\.js$/.test(file))) throw Error('Expo Web entry missing');
  // The ordinary production export has no source maps. Do not silently publish
  // wrong mappings after rewriting generated URL strings in a diagnostic export.
  if (files.some(file => file.endsWith('.map'))) throw Error('Finalize the standard export without --source-maps');
  const digest = createHash('sha256');
  const originals = new Map();
  for (const name of files) {
    if (!(await lstat(path.join(source, name))).isFile()) throw Error('Unexpected nested Expo Web asset');
    const bytes = await readFile(path.join(source, name));
    digest.update(name).update('\0').update(bytes).update('\0');
    originals.set(name, bytes);
  }
  const release = digest.digest('hex').slice(0, 24);
  const prefix = `${legacyPrefix}releases/${release}/`;
  const htmlPath = path.join(root, 'index.html');
  const html = await readFile(htmlPath, 'utf8');
  if (!html.includes(`${legacyPrefix}web/`)) throw Error('Expo HTML entry missing');
  const assets = [];
  for (const [name, bytes] of originals) {
    const output = name.endsWith('.js') ? Buffer.from(bytes.toString('utf8').replaceAll(legacyPrefix, prefix)) : bytes;
    await writeFile(path.join(source, name), output);
    assets.push({ path: `${prefix}web/${name}`, sha256: createHash('sha256').update(output).digest('hex') });
  }
  const destination = path.join(root, '_expo/static/js/releases', release);
  await mkdir(destination, { recursive: true });
  await rename(source, path.join(destination, 'web'));
  await writeFile(htmlPath, html.replaceAll(legacyPrefix, prefix));
  await writeFile(path.join(root, 'web-release.json'), JSON.stringify({ version: 1, release, assets }, null, 2));
  return { release, assets: assets.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw Error('Usage: node scripts/finalize-web-export.mjs <export directory>');
  console.log(JSON.stringify(await finalizeWebExport(process.argv[2])));
}
