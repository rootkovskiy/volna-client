import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ignoredDirectories = new Set(['node_modules', 'target', 'dist', 'coverage']);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function collectSourceFiles(directory = packageRoot, files = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) await collectSourceFiles(absolute, files);
    else files.push(absolute);
  }
  return files.sort((left, right) => {
    const leftPath = path.relative(packageRoot, left).replaceAll('\\', '/');
    const rightPath = path.relative(packageRoot, right).replaceAll('\\', '/');
    return leftPath < rightPath ? -1 : leftPath > rightPath ? 1 : 0;
  });
}

const crc32Table = new Uint32Array(256);
for (let index = 0; index < crc32Table.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  crc32Table[index] = value >>> 0;
}

function deterministicGzip(content) {
  const parts = [Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff])];
  for (let offset = 0; offset < content.length; offset += 65_535) {
    const block = content.subarray(offset, Math.min(content.length, offset + 65_535));
    const header = Buffer.alloc(5);
    header[0] = offset + block.length === content.length ? 0x01 : 0x00;
    header.writeUInt16LE(block.length, 1);
    header.writeUInt16LE((~block.length) & 0xffff, 3);
    parts.push(header, block);
  }
  let crc = 0xffffffff;
  for (const byte of content) crc = crc32Table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  const trailer = Buffer.alloc(8);
  trailer.writeUInt32LE((crc ^ 0xffffffff) >>> 0, 0);
  trailer.writeUInt32LE(content.length >>> 0, 4);
  parts.push(trailer);
  return Buffer.concat(parts);
}

function writeAscii(target, offset, length, value) {
  const bytes = Buffer.from(value, 'ascii');
  if (bytes.length > length) throw new Error(`tar field exceeds ${length} bytes`);
  bytes.copy(target, offset);
}

function writeOctal(target, offset, length, value) {
  const encoded = value.toString(8).padStart(length - 1, '0');
  if (encoded.length > length - 1) throw new Error(`tar number exceeds ${length} bytes`);
  writeAscii(target, offset, length, `${encoded}\0`);
}

function splitTarPath(value) {
  const encoded = Buffer.byteLength(value, 'utf8');
  if (encoded <= 100) return { name: value, prefix: '' };
  for (let index = value.lastIndexOf('/'); index > 0; index = value.lastIndexOf('/', index - 1)) {
    const prefix = value.slice(0, index);
    const name = value.slice(index + 1);
    if (Buffer.byteLength(prefix, 'utf8') <= 155 && Buffer.byteLength(name, 'utf8') <= 100) {
      return { name, prefix };
    }
  }
  throw new Error(`tar path is too long: ${value}`);
}

function tarEntry(nameValue, content) {
  const { name, prefix } = splitTarPath(nameValue);
  const header = Buffer.alloc(512);
  writeAscii(header, 0, 100, name);
  writeOctal(header, 100, 8, 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, content.length);
  writeOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  writeAscii(header, 156, 1, '0');
  writeAscii(header, 257, 6, 'ustar\0');
  writeAscii(header, 263, 2, '00');
  writeAscii(header, 265, 32, 'volna');
  writeAscii(header, 297, 32, 'volna');
  writeOctal(header, 329, 8, 0);
  writeOctal(header, 337, 8, 0);
  writeAscii(header, 345, 155, prefix);
  let checksum = 0;
  for (const byte of header) checksum += byte;
  writeAscii(header, 148, 8, `${checksum.toString(8).padStart(6, '0')}\0 `);
  const padding = Buffer.alloc((512 - (content.length % 512)) % 512);
  return Buffer.concat([header, content, padding]);
}

function npmPurl(name, version) {
  if (name.startsWith('@')) {
    const separator = name.indexOf('/');
    if (separator < 2) throw new Error(`invalid scoped package name: ${name}`);
    return `pkg:npm/%40${encodeURIComponent(name.slice(1, separator))}/${encodeURIComponent(name.slice(separator + 1))}@${encodeURIComponent(version)}`;
  }
  return `pkg:npm/${encodeURIComponent(name)}@${encodeURIComponent(version)}`;
}

function cargoPurl(name, version) {
  return `pkg:cargo/${encodeURIComponent(name)}@${encodeURIComponent(version)}`;
}

function integrityHash(integrity) {
  if (typeof integrity !== 'string') return undefined;
  const separator = integrity.indexOf('-');
  if (separator <= 0) return undefined;
  const algorithm = integrity.slice(0, separator).toUpperCase().replace('SHA', 'SHA-');
  let digest;
  try {
    digest = Buffer.from(integrity.slice(separator + 1), 'base64').toString('hex');
  } catch {
    return undefined;
  }
  return digest.length === 0 ? undefined : [{ alg: algorithm, content: digest }];
}

function parsePnpmInventory(lockText, directRuntimeDependencies) {
  const lines = lockText.split(/\r?\n/);
  const packagesStart = lines.findIndex((line) => line === 'packages:');
  const snapshotsStart = lines.findIndex((line, index) => index > packagesStart && line === 'snapshots:');
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
      const integrityMatch = /integrity:\s*([^,}\s]+)/.exec(lines[detail]);
      if (integrityMatch !== null) {
        integrity = integrityMatch[1];
        break;
      }
    }
    const bomRef = npmPurl(name, version);
    components.set(bomRef, {
      type: 'library',
      'bom-ref': bomRef,
      name,
      version,
      purl: bomRef,
      ...(integrityHash(integrity) === undefined ? {} : { hashes: integrityHash(integrity) }),
      properties: [{
        name: 'volna:dependency-scope',
        value: directRuntimeDependencies[name] === version ? 'runtime-direct' : 'verification-lock-inventory',
      }],
    });
  }
  return components;
}

function parseCargoInventory(lockText) {
  const components = new Map();
  for (const block of lockText.split('[[package]]').slice(1)) {
    const name = /^name = "([^"]+)"/m.exec(block)?.[1];
    const version = /^version = "([^"]+)"/m.exec(block)?.[1];
    const checksum = /^checksum = "([0-9a-f]{64})"/m.exec(block)?.[1];
    if (name === undefined || version === undefined) continue;
    const bomRef = cargoPurl(name, version);
    components.set(bomRef, {
      type: 'library',
      'bom-ref': bomRef,
      name,
      version,
      purl: bomRef,
      ...(checksum === undefined ? {} : { hashes: [{ alg: 'SHA-256', content: checksum }] }),
      properties: [{ name: 'volna:dependency-scope', value: 'openmls-evaluation' }],
    });
  }
  return components;
}

function deterministicUuid(hexDigest) {
  const value = hexDigest.slice(0, 32).split('');
  value[12] = '5';
  value[16] = ((Number.parseInt(value[16], 16) & 0x3) | 0x8).toString(16);
  const compact = value.join('');
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}

function buildSbom(packageJson, lockText, cargoLockText, sourceTreeHash) {
  const components = parsePnpmInventory(lockText, packageJson.dependencies ?? {});
  for (const [reference, component] of parseCargoInventory(cargoLockText)) components.set(reference, component);
  const rootRef = npmPurl(packageJson.name, packageJson.version);
  const directRuntimeRefs = Object.entries(packageJson.dependencies ?? {})
    .map(([name, version]) => npmPurl(name, version))
    .sort();
  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.6',
    serialNumber: `urn:uuid:${deterministicUuid(sourceTreeHash)}`,
    version: 1,
    metadata: {
      component: {
        type: 'library',
        'bom-ref': rootRef,
        name: packageJson.name,
        version: packageJson.version,
        purl: rootRef,
        licenses: [{ license: { id: packageJson.license } }],
      },
      properties: [
        { name: 'volna:inventory-scope', value: 'runtime plus complete public verification lockfiles' },
        { name: 'volna:source-tree-sha256', value: sourceTreeHash },
      ],
    },
    components: [...components.values()].sort((left, right) => (
      left['bom-ref'] < right['bom-ref'] ? -1 : left['bom-ref'] > right['bom-ref'] ? 1 : 0
    )),
    dependencies: [{ ref: rootRef, dependsOn: directRuntimeRefs }],
  };
}

export async function buildReleaseEvidence({ outputDirectory }) {
  if (typeof outputDirectory !== 'string' || outputDirectory.length === 0) throw new Error('outputDirectory is required');
  const outputRoot = path.resolve(outputDirectory);
  if (outputRoot === packageRoot || outputRoot.startsWith(`${packageRoot}${path.sep}`)) {
    throw new Error('release evidence output must be outside the public package source tree');
  }
  const packageJson = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
  const files = await collectSourceFiles();
  const sourceEntries = [];
  const archiveParts = [];
  const archiveRoot = `volna-messaging-client-${packageJson.version}`;
  for (const absolute of files) {
    const relative = path.relative(packageRoot, absolute).replaceAll('\\', '/');
    const content = await readFile(absolute);
    sourceEntries.push({ path: relative, bytes: content.length, sha256: sha256(content) });
    archiveParts.push(tarEntry(`${archiveRoot}/${relative}`, content));
  }
  archiveParts.push(Buffer.alloc(1024));
  const sourceTreeJson = canonicalJson({ schemaVersion: 1, files: sourceEntries });
  const sourceTreeHash = sha256(sourceTreeJson);
  const sourceTreeName = `${archiveRoot}.source-tree.json`;
  const tar = Buffer.concat(archiveParts);
  const sourceArchive = deterministicGzip(tar);
  tar.fill(0);
  const archiveName = `${archiveRoot}-source.tar.gz`;
  const archiveHash = sha256(sourceArchive);
  const sbom = buildSbom(
    packageJson,
    await readFile(path.join(packageRoot, 'pnpm-lock.public.yaml'), 'utf8'),
    await readFile(path.join(packageRoot, 'rust', 'openmls-evaluation', 'Cargo.lock'), 'utf8'),
    sourceTreeHash,
  );
  const sbomName = `${archiveRoot}.cdx.json`;
  const sbomJson = canonicalJson(sbom);
  const sbomHash = sha256(sbomJson);
  const evidence = {
    schemaVersion: 1,
    package: { name: packageJson.name, version: packageJson.version, license: packageJson.license },
    sourceTree: { file: sourceTreeName, files: sourceEntries.length, sha256: sourceTreeHash },
    sourceArchive: { file: archiveName, bytes: sourceArchive.length, sha256: archiveHash },
    sbom: { file: sbomName, format: 'CycloneDX', specVersion: '1.6', sha256: sbomHash },
    assurance: {
      reproducibleSourceArtifact: true,
      signed: false,
      independentlyReviewed: false,
    },
  };
  await mkdir(outputRoot, { recursive: true });
  await Promise.all([
    writeFile(path.join(outputRoot, archiveName), sourceArchive),
    writeFile(path.join(outputRoot, `${archiveName}.sha256`), `${archiveHash}  ${archiveName}\n`, 'utf8'),
    writeFile(path.join(outputRoot, sourceTreeName), sourceTreeJson, 'utf8'),
    writeFile(path.join(outputRoot, `${sourceTreeName}.sha256`), `${sourceTreeHash}  ${sourceTreeName}\n`, 'utf8'),
    writeFile(path.join(outputRoot, sbomName), sbomJson, 'utf8'),
    writeFile(path.join(outputRoot, `${sbomName}.sha256`), `${sbomHash}  ${sbomName}\n`, 'utf8'),
    writeFile(path.join(outputRoot, 'release-evidence.json'), canonicalJson(evidence), 'utf8'),
  ]);
  sourceArchive.fill(0);
  return evidence;
}

async function main() {
  const outputIndex = process.argv.indexOf('--output');
  const outputDirectory = outputIndex < 0 ? undefined : process.argv[outputIndex + 1];
  const evidence = await buildReleaseEvidence({ outputDirectory });
  process.stdout.write(`${canonicalJson(evidence)}`);
}

const invokedPath = process.argv[1] === undefined ? null : pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
