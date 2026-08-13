import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { canonicalJson, createDeterministicTarGzip, sha256 } from './deterministic-archive.mjs';
import { verifyPublicClientBoundary } from './verify-public-client-boundary.mjs';

const releaseRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ignoredDirectoryNames = new Set(['coverage', 'dist', 'node_modules', 'target']);
const portable = (value) => value.replaceAll('\\', '/');

async function collectFiles(target, output = []) {
  for (const entry of await readdir(target, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectoryNames.has(entry.name)) continue;
    if (entry.name === '.env' || entry.name.startsWith('.env.')) continue;
    const absolute = path.join(target, entry.name);
    if (entry.isDirectory()) await collectFiles(absolute, output);
    else output.push(absolute);
  }
  return output;
}

function npmPurl(name, version) {
  if (name.startsWith('@')) {
    const separator = name.indexOf('/');
    return `pkg:npm/%40${encodeURIComponent(name.slice(1, separator))}/${encodeURIComponent(name.slice(separator + 1))}@${encodeURIComponent(version)}`;
  }
  return `pkg:npm/${encodeURIComponent(name)}@${encodeURIComponent(version)}`;
}

function integrityHashes(integrity) {
  if (typeof integrity !== 'string') return undefined;
  const separator = integrity.indexOf('-');
  if (separator <= 0) return undefined;
  const algorithm = integrity.slice(0, separator).toUpperCase().replace('SHA', 'SHA-');
  const digest = Buffer.from(integrity.slice(separator + 1), 'base64').toString('hex');
  return digest.length === 0 ? undefined : [{ alg: algorithm, content: digest }];
}

function parsePnpmComponents(lockText) {
  const lines = lockText.split(/\r?\n/);
  const packagesStart = lines.indexOf('packages:');
  const snapshotsStart = lines.indexOf('snapshots:');
  if (packagesStart < 0 || snapshotsStart < 0) throw new Error('unsupported pnpm lockfile shape');
  const components = new Map();
  for (let index = packagesStart + 1; index < snapshotsStart; index += 1) {
    const match = /^  (.+):$/.exec(lines[index]);
    if (match === null) continue;
    let key = match[1];
    if (key.startsWith("'") && key.endsWith("'")) key = key.slice(1, -1).replaceAll("''", "'");
    const separator = key.lastIndexOf('@');
    if (separator <= 0) continue;
    const name = key.slice(0, separator);
    const version = key.slice(separator + 1);
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) continue;
    let integrity;
    for (let detail = index + 1; detail < snapshotsStart && !/^  \S/.test(lines[detail]); detail += 1) {
      integrity = /integrity:\s*([^,}\s]+)/.exec(lines[detail])?.[1] ?? integrity;
    }
    const reference = npmPurl(name, version);
    components.set(reference, {
      type: 'library',
      'bom-ref': reference,
      name,
      version,
      purl: reference,
      ...(integrityHashes(integrity) === undefined ? {} : { hashes: integrityHashes(integrity) }),
    });
  }
  return components;
}

function parseGoComponents(modText, sumText) {
  const sums = new Map();
  for (const line of sumText.split(/\r?\n/)) {
    const match = /^(\S+) (v\S+) (h1:\S+)$/.exec(line);
    if (match !== null) sums.set(`${match[1]}@${match[2]}`, match[3]);
  }
  const components = [];
  for (const line of modText.split(/\r?\n/)) {
    const match = /^\s*([^\s()]+) (v\S+)(?: \/\/ indirect)?$/.exec(line);
    if (match === null) continue;
    const [, name, version] = match;
    const purl = `pkg:golang/${name.split('/').map(encodeURIComponent).join('/')}@${encodeURIComponent(version)}`;
    components.push({
      type: 'library',
      'bom-ref': purl,
      name,
      version,
      purl,
      ...(sums.has(`${name}@${version}`)
        ? { properties: [{ name: 'volna:go-module-h1', value: sums.get(`${name}@${version}`) }] }
        : {}),
    });
  }
  return components;
}

function deterministicUuid(hash) {
  const value = hash.slice(0, 32).split('');
  value[12] = '5';
  value[16] = ((Number.parseInt(value[16], 16) & 0x3) | 0x8).toString(16);
  const compact = value.join('');
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}

async function buildSbom(packageJson, lockText, sourceTreeHash, repositoryRoot) {
  const components = parsePnpmComponents(lockText);
  for (const relative of [
    'apps/mobile/package.json',
    'packages/content-policy/package.json',
    'packages/music-taxonomy/package.json',
    'packages/volna-messaging-client/package.json',
    'packages/volna-key-directory-witness/package.json',
  ]) {
    const componentPackage = JSON.parse(await readFile(path.join(repositoryRoot, relative), 'utf8'));
    const reference = npmPurl(componentPackage.name, componentPackage.version);
    components.set(reference, {
      type: ['mobile', '@volna/key-directory-witness'].includes(componentPackage.name)
        ? 'application'
        : 'library',
      'bom-ref': reference,
      name: componentPackage.name,
      version: componentPackage.version,
      purl: reference,
      licenses: [{ license: { id: componentPackage.license } }],
      properties: [{ name: 'volna:first-party-source', value: relative }],
    });
  }
  const goRoot = path.join(repositoryRoot, 'packages', 'volna-key-transparency-log');
  for (const component of parseGoComponents(
    await readFile(path.join(goRoot, 'go.mod'), 'utf8'),
    await readFile(path.join(goRoot, 'go.sum'), 'utf8'),
  )) components.set(component['bom-ref'], component);
  const goServiceReference = 'pkg:generic/volna-key-transparency-log@0.1.0';
  components.set(goServiceReference, {
    type: 'application',
    'bom-ref': goServiceReference,
    name: 'volna-key-transparency-log',
    version: '0.1.0',
    purl: goServiceReference,
    licenses: [{ license: { id: 'Apache-2.0' } }],
    properties: [{ name: 'volna:first-party-source', value: 'packages/volna-key-transparency-log' }],
  });
  const rootReference = npmPurl(packageJson.name, packageJson.version);
  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.6',
    serialNumber: `urn:uuid:${deterministicUuid(sourceTreeHash)}`,
    version: 1,
    metadata: {
      component: {
        type: 'application',
        'bom-ref': rootReference,
        name: packageJson.name,
        version: packageJson.version,
        purl: rootReference,
        licenses: [{ license: { id: packageJson.license } }],
      },
      properties: [
        { name: 'volna:inventory-scope', value: 'complete public client lockfile' },
        { name: 'volna:source-tree-sha256', value: sourceTreeHash },
      ],
    },
    components: [...components.values()].sort((left, right) => left['bom-ref'].localeCompare(right['bom-ref'], 'en')),
  };
}

async function releaseEntries(boundary) {
  const entries = new Map();
  const add = async (archivePath, absolute) => {
    if (entries.has(archivePath)) throw new Error(`duplicate archive path: ${archivePath}`);
    entries.set(archivePath, await readFile(absolute));
  };
  for (const absolute of boundary.selectedFiles) {
    await add(portable(path.relative(boundary.repositoryRoot, absolute)), absolute);
  }
  for (const absolute of await collectFiles(releaseRoot)) {
    await add(`release/${portable(path.relative(releaseRoot, absolute))}`, absolute);
  }
  for (const archivePath of boundary.manifest.requiredArchiveRootFiles) {
    if (archivePath === 'LICENSE') {
      await add('LICENSE', path.join(boundary.repositoryRoot, 'packages', 'volna-messaging-client', 'LICENSE'));
      continue;
    }
    await add(archivePath, path.join(releaseRoot, archivePath));
  }
  return [...entries].map(([entryPath, content]) => ({ path: entryPath, content }))
    .sort((left, right) => left.path.localeCompare(right.path, 'en'));
}

export async function buildPublicClientEvidence({ outputDirectory }) {
  if (typeof outputDirectory !== 'string' || outputDirectory.length === 0) {
    throw new Error('outputDirectory is required');
  }
  const boundary = await verifyPublicClientBoundary();
  const outputRoot = path.resolve(outputDirectory);
  for (const selectedRoot of boundary.manifest.firstPartyRuntimeRoots) {
    const absolute = path.resolve(boundary.repositoryRoot, selectedRoot);
    if (outputRoot === absolute || outputRoot.startsWith(`${absolute}${path.sep}`)) {
      throw new Error('release evidence output must be outside public source roots');
    }
  }
  const packageJson = JSON.parse(await readFile(path.join(releaseRoot, 'package.json'), 'utf8'));
  const entries = await releaseEntries(boundary);
  const sourceTree = canonicalJson({
    schemaVersion: 1,
    files: entries.map((entry) => ({ path: entry.path, bytes: entry.content.length, sha256: sha256(entry.content) })),
  });
  const sourceTreeHash = sha256(sourceTree);
  const archiveRoot = `volna-client-${packageJson.version}`;
  const sourceArchive = createDeterministicTarGzip(archiveRoot, entries);
  const archiveName = `${archiveRoot}-source.tar.gz`;
  const sourceTreeName = `${archiveRoot}.source-tree.json`;
  const sbomName = `${archiveRoot}.cdx.json`;
  const archiveHash = sha256(sourceArchive);
  const sbom = await buildSbom(
    packageJson,
    await readFile(path.join(releaseRoot, 'pnpm-lock.yaml'), 'utf8'),
    sourceTreeHash,
    boundary.repositoryRoot,
  );
  const sbomJson = canonicalJson(sbom);
  const evidence = {
    schemaVersion: 1,
    client: { name: packageJson.name, version: packageJson.version, license: packageJson.license },
    boundary: {
      completeFirstPartyClientSource: true,
      runtimeFiles: boundary.runtimeFileCount,
      proprietaryBackendIncluded: false,
      forbiddenSourceRoots: boundary.manifest.forbiddenSourceRoots,
    },
    sourceTree: { file: sourceTreeName, files: entries.length, sha256: sourceTreeHash },
    sourceArchive: { file: archiveName, bytes: sourceArchive.length, sha256: archiveHash },
    sbom: { file: sbomName, format: 'CycloneDX', specVersion: '1.6', sha256: sha256(sbomJson) },
    assurance: {
      reproducibleSourceArtifact: true,
      reproducibleNativeBinary: false,
      signed: false,
      independentlyReviewed: false,
      webOriginReplacementResistant: false,
    },
  };
  await mkdir(outputRoot, { recursive: true });
  await Promise.all([
    writeFile(path.join(outputRoot, archiveName), sourceArchive),
    writeFile(path.join(outputRoot, `${archiveName}.sha256`), `${archiveHash}  ${archiveName}\n`, 'utf8'),
    writeFile(path.join(outputRoot, sourceTreeName), sourceTree, 'utf8'),
    writeFile(path.join(outputRoot, `${sourceTreeName}.sha256`), `${sourceTreeHash}  ${sourceTreeName}\n`, 'utf8'),
    writeFile(path.join(outputRoot, sbomName), sbomJson, 'utf8'),
    writeFile(path.join(outputRoot, `${sbomName}.sha256`), `${sha256(sbomJson)}  ${sbomName}\n`, 'utf8'),
    writeFile(path.join(outputRoot, 'release-evidence.json'), canonicalJson(evidence), 'utf8'),
  ]);
  sourceArchive.fill(0);
  return evidence;
}

async function main() {
  const outputIndex = process.argv.indexOf('--output');
  const outputDirectory = outputIndex < 0 ? undefined : process.argv[outputIndex + 1];
  const evidence = await buildPublicClientEvidence({ outputDirectory });
  process.stdout.write(canonicalJson(evidence));
}

const invokedPath = process.argv[1] === undefined ? null : pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
