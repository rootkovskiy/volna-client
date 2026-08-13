import { createHash } from 'node:crypto';
import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const releaseRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(releaseRoot, '..');
const ignoredDirectoryNames = new Set([
  '.cache',
  '.expo',
  'coverage',
  'dist',
  'node_modules',
  'target',
]);
const textExtensions = new Set([
  '.cjs', '.d.ts', '.html', '.js', '.json', '.md', '.mjs', '.rs', '.sql',
  '.toml', '.ts', '.tsx', '.txt', '.yml', '.yaml',
]);
const serverOnlyImportPrefixes = [
  '@aws-sdk/',
  '@nestjs/',
  '@prisma/',
  'argon2',
  'bullmq',
  'ioredis',
  'pg',
  'prisma',
];
const imageSizePatchSha256 = '01100757bdbd55c38cda4b40e79d1b358024fe9fee2d45ab7a9f72111758e8e3';

const portable = (value) => value.replaceAll('\\', '/');
const isInside = (candidate, root) => candidate === root || candidate.startsWith(`${root}${path.sep}`);

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function collectFiles(target, output = []) {
  const statEntries = await readdir(target, { withFileTypes: true });
  for (const entry of statEntries) {
    if (entry.isDirectory() && ignoredDirectoryNames.has(entry.name)) continue;
    if (entry.name === '.env' || entry.name.startsWith('.env.')) continue;
    const absolute = path.join(target, entry.name);
    if (entry.isDirectory()) await collectFiles(absolute, output);
    else output.push(absolute);
  }
  return output;
}

function sourcePath(absolute) {
  return portable(path.relative(repositoryRoot, absolute));
}

function importSpecifiers(content) {
  return [...content.matchAll(/(?:from\s+|require\s*\(|import\s*\()["']([^"']+)["']/g)]
    .map((match) => match[1]);
}

function selectedAbsoluteRoots(manifest) {
  return manifest.firstPartyRuntimeRoots.map((relative) => path.resolve(repositoryRoot, relative));
}

function isSelectedPath(absolute, manifest) {
  if (manifest.rootRuntimeFiles.some((relative) => path.resolve(repositoryRoot, relative) === absolute)) return true;
  return selectedAbsoluteRoots(manifest).some((root) => isInside(absolute, root));
}

function validateManifest(manifest, failures) {
  if (manifest.schemaVersion !== 1) failures.push('boundary schemaVersion must be 1');
  if (manifest.name !== '@volna/client') failures.push('boundary name must be @volna/client');
  if (manifest.license !== 'Apache-2.0') failures.push('boundary license must be Apache-2.0');
  for (const key of [
    'firstPartyRuntimeRoots',
    'rootRuntimeFiles',
    'excludedNonRuntimePaths',
    'forbiddenSourceRoots',
    'allowedWorkspaceImports',
    'allowedPublicEnvironmentVariables',
    'requiredArchiveRootFiles',
  ]) {
    if (!Array.isArray(manifest[key]) || manifest[key].length === 0) failures.push(`${key} must be a non-empty array`);
  }
}

async function validateReleaseMetadata(manifest, failures) {
  const packageJson = JSON.parse(await readFile(path.join(releaseRoot, 'package.json'), 'utf8'));
  const workspace = await readFile(path.join(releaseRoot, 'pnpm-workspace.yaml'), 'utf8');
  const workflow = await readFile(path.join(releaseRoot, '.github', 'workflows', 'verify.yml'), 'utf8');
  const codeqlWorkflow = await readFile(path.join(releaseRoot, '.github', 'workflows', 'codeql.yml'), 'utf8');
  const dependabot = await readFile(path.join(releaseRoot, '.github', 'dependabot.yml'), 'utf8');
  const rustToolchain = await readFile(path.join(releaseRoot, 'rust-toolchain.toml'), 'utf8');
  if (packageJson.name !== manifest.name) failures.push('release package name does not match the boundary');
  if (packageJson.license !== manifest.license) failures.push('release package license does not match the boundary');
  if (packageJson.packageManager !== 'pnpm@11.7.0') failures.push('release package manager must be pnpm@11.7.0');
  if (packageJson.engines?.node !== '>=20 <25') failures.push('release Node engine must exclude unsupported Node 25');
  if (packageJson.scripts?.['verify:openmls'] !== 'cargo test --locked --all-targets --manifest-path packages/volna-messaging-client/rust/openmls-evaluation/Cargo.toml') {
    failures.push('release must expose the pinned locked OpenMLS verification command');
  }
  if (!/^\[toolchain\]\r?\nchannel = "1\.88\.0"\r?\nprofile = "minimal"\r?\n?$/.test(rustToolchain)) {
    failures.push('public OpenMLS evaluation must pin the minimal Rust 1.88.0 toolchain');
  }
  if (!workflow.includes('rustup toolchain install 1.88.0 --profile minimal --no-self-update')) {
    failures.push('public CI must install the pinned minimal Rust 1.88.0 toolchain');
  }
  if (!workflow.includes('run: rustup run 1.88.0 pnpm verify:openmls')) {
    failures.push('public CI must run the locked OpenMLS evaluation');
  }
  if (!workflow.includes("--invert libcrux-chacha20poly1305 --prefix none | grep -q '^libcrux-chacha20poly1305 '")) {
    failures.push('public CI must prove the vulnerable unused libcrux provider is outside the selected graph');
  }
  if (workflow.includes('VOLNA_SKIP_NODE_INTEROP')) {
    failures.push('public CI must not permit bypassing the ts-mls/OpenMLS interoperability test');
  }
  if (!workflow.includes('actions/dependency-review-action@a1d282b36b6f3519aa1f3fc636f609c47dddb294')) {
    failures.push('public PR verification must pin dependency-review-action v5.0.0');
  }
  if (!workflow.includes('fail-on-severity: moderate')) {
    failures.push('public dependency review must reject moderate-or-higher vulnerabilities');
  }
  for (const action of ['github/codeql-action/init@9e3211c9a3b9311dfe05da2ed48eea3386f042dd', 'github/codeql-action/analyze@9e3211c9a3b9311dfe05da2ed48eea3386f042dd']) {
    if (!codeqlWorkflow.includes(action)) failures.push(`public CodeQL workflow must pin ${action}`);
  }
  if (!codeqlWorkflow.includes('queries: security-extended')) {
    failures.push('public CodeQL workflow must run the security-extended query suite');
  }
  for (const ecosystem of ['npm', 'cargo', 'github-actions']) {
    if (!dependabot.includes(`package-ecosystem: ${ecosystem}`)) {
      failures.push(`public Dependabot configuration must cover ${ecosystem}`);
    }
  }
  if (!/^patchedDependencies:\r?\n\s{2}image-size@1\.2\.1:\s+patches\/image-size@1\.2\.1\.patch\s*$/m.test(workspace)) {
    failures.push('public workspace must apply the reviewed image-size 1.2.1 patch');
  }
  for (const advisory of ['GHSA-5p2g-fcmc-qvqq', 'GHSA-w3rx-r6r6-pgpr']) {
    if (!new RegExp(`^\\s{4}- ${advisory}$`, 'm').test(workspace)) {
      failures.push(`public audit policy must document the patched exception ${advisory}`);
    }
  }
  if (!/^\s{2}postcss:\s+8\.5\.26\s*$/m.test(workspace)) {
    failures.push('public workspace must pin postcss to the reviewed patched version 8.5.26');
  }
  if (!/^\s{2}uuid:\s+11\.1\.1\s*$/m.test(workspace)) {
    failures.push('public workspace must pin uuid to the reviewed patched version 11.1.1');
  }
  for (const [kind, dependencies] of Object.entries({
    dependencies: packageJson.dependencies,
    devDependencies: packageJson.devDependencies,
  })) {
    for (const [name, version] of Object.entries(dependencies ?? {})) {
      if (version === 'workspace:*') continue;
      if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
        failures.push(`${kind} must pin ${name} to an exact version`);
      }
    }
  }

  const lockPath = path.join(releaseRoot, 'pnpm-lock.yaml');
  if (!(await exists(lockPath))) {
    failures.push('dedicated public-client pnpm-lock.yaml is required');
    return;
  }
  const lock = await readFile(lockPath, 'utf8');
  for (const forbidden of ['  apps/api:', '@nestjs/', '@prisma/', 'prisma@', 'argon2@', 'bullmq@', 'ioredis@']) {
    if (lock.includes(forbidden)) failures.push(`public lockfile contains backend-only dependency marker: ${forbidden}`);
  }
  for (const match of lock.matchAll(/^  postcss@(\d+)\.(\d+)\.(\d+):/gm)) {
    const [, major, minor, patch] = match.map(Number);
    if (major < 8 || (major === 8 && (minor < 5 || (minor === 5 && patch < 18)))) {
      failures.push(`public lockfile contains vulnerable PostCSS ${major}.${minor}.${patch}`);
    }
  }
  const releaseMessagingRoot = path.join(releaseRoot, 'packages', 'volna-messaging-client');
  const standaloneMessagingRoot = await exists(releaseMessagingRoot)
    ? releaseMessagingRoot
    : path.join(repositoryRoot, 'packages', 'volna-messaging-client');
  const standaloneWorkspace = await readFile(path.join(standaloneMessagingRoot, 'pnpm-workspace.yaml'), 'utf8');
  const standaloneLock = await readFile(path.join(standaloneMessagingRoot, 'pnpm-lock.yaml'), 'utf8');
  for (const [dependency, expected] of [['postcss', '8.5.26'], ['uuid', '11.1.1']]) {
    if (!new RegExp(`^\\s{2}${dependency}:\\s+${expected.replaceAll('.', '\\.') }\\s*$`, 'm').test(standaloneWorkspace)) {
      failures.push(`standalone messaging workspace must override ${dependency} to ${expected}`);
    }
    const resolved = [...standaloneLock.matchAll(new RegExp(`^\\s{2}${dependency.replaceAll('-', '\\-')}@([^:]+):`, 'gm'))]
      .map((match) => match[1]);
    if (resolved.length === 0 || resolved.some((version) => version !== expected)) {
      failures.push(`standalone messaging lockfile must resolve only ${dependency}@${expected}`);
    }
  }
  const patchPath = path.join(releaseRoot, 'patches', 'image-size@1.2.1.patch');
  if (!(await exists(patchPath))) {
    failures.push('reviewed image-size patch is missing');
  } else {
    const patchHash = createHash('sha256').update(await readFile(patchPath)).digest('hex');
    if (patchHash !== imageSizePatchSha256) failures.push(`unexpected image-size patch SHA-256: ${patchHash}`);
  }
  if (!lock.includes(`image-size@1.2.1: ${imageSizePatchSha256}`)) {
    failures.push('public lockfile does not pin the reviewed image-size patch hash');
  }
  const snapshots = lock.slice(lock.indexOf('\nsnapshots:\n'));
  if (/^  image-size@1\.2\.1:\s*$/m.test(snapshots)) {
    failures.push('public lockfile contains an unpatched image-size 1.2.1 snapshot');
  }
}

async function validatePackageLicenses(manifest, failures) {
  for (const relativeRoot of manifest.firstPartyRuntimeRoots) {
    const packagePath = path.join(repositoryRoot, relativeRoot, 'package.json');
    if (!(await exists(packagePath))) continue;
    const packageJson = JSON.parse(await readFile(packagePath, 'utf8'));
    if (packageJson.license !== manifest.license) {
      failures.push(`${portable(path.relative(repositoryRoot, packagePath))} must declare ${manifest.license}`);
    }
  }
}

async function scanTextFile(absolute, manifest, failures) {
  const relative = sourcePath(absolute);
  if (![...textExtensions].some((extension) => relative.endsWith(extension))) return;
  const content = await readFile(absolute, 'utf8');

  if (/E:\\Projects\\SOYUZ|C:\\Users\\|\/Users\/[^/]+\//i.test(content)) {
    failures.push(`local workspace path leaked in ${relative}`);
  }
  if (/-----BEGIN (?:EC |RSA |OPENSSH )?PRIVATE KEY-----/.test(content)) {
    failures.push(`private key material found in ${relative}`);
  }
  if (/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\bgh[pousr]_[A-Za-z0-9]{30,}\b|\bsk-[A-Za-z0-9_-]{20,}\b/.test(content)) {
    failures.push(`credential-like token found in ${relative}`);
  }
  if (/\b(?:eval\s*\(|new\s+Function\s*\()/.test(content)) {
    failures.push(`dynamic code execution is forbidden in ${relative}`);
  }

  for (const match of content.matchAll(/process\.env(?:\.([A-Z][A-Z0-9_]*)|\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\])/g)) {
    const variableName = match[1] ?? match[2];
    if (!manifest.allowedPublicEnvironmentVariables.includes(variableName)) {
      failures.push(`undeclared environment variable ${variableName} in ${relative}`);
    }
  }
  if (/process\.env\s*\[(?!\s*['"][A-Z][A-Z0-9_]*['"]\s*\])/.test(content)) {
    failures.push(`dynamic environment-variable access is forbidden in ${relative}`);
  }

  for (const specifier of importSpecifiers(content)) {
    if (serverOnlyImportPrefixes.some((prefix) => specifier === prefix || specifier.startsWith(prefix))) {
      failures.push(`server-only import ${specifier} in ${relative}`);
    }
    if (specifier.startsWith('@volna/')) {
      const packageName = specifier.split('/').slice(0, 2).join('/');
      if (!manifest.allowedWorkspaceImports.includes(packageName)) {
        failures.push(`unpublished workspace import ${specifier} in ${relative}`);
      }
    }
    if (specifier.startsWith('.')) {
      const target = path.resolve(path.dirname(absolute), specifier);
      if (!isSelectedPath(target, manifest) && !isInside(target, releaseRoot)) {
        failures.push(`relative import escapes the public client boundary: ${specifier} in ${relative}`);
      }
    }
  }
}

export async function verifyPublicClientBoundary() {
  const failures = [];
  const manifestPath = path.join(releaseRoot, 'public-client-boundary.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  validateManifest(manifest, failures);

  const excluded = new Set(manifest.excludedNonRuntimePaths);
  const runtimeFiles = [];
  for (const relative of [...manifest.rootRuntimeFiles, ...manifest.firstPartyRuntimeRoots]) {
    const absolute = path.resolve(repositoryRoot, relative);
    if (!(await exists(absolute))) {
      failures.push(`required public client source is missing: ${relative}`);
      continue;
    }
    if (manifest.rootRuntimeFiles.includes(relative)) runtimeFiles.push(absolute);
    else await collectFiles(absolute, runtimeFiles);
  }

  const selectedFiles = runtimeFiles
    .filter((absolute) => !excluded.has(sourcePath(absolute)))
    .sort((left, right) => sourcePath(left).localeCompare(sourcePath(right), 'en'));
  for (const forbiddenRoot of manifest.forbiddenSourceRoots) {
    if (selectedFiles.some((absolute) => isInside(absolute, path.resolve(repositoryRoot, forbiddenRoot)))) {
      failures.push(`forbidden source root entered the public boundary: ${forbiddenRoot}`);
    }
  }

  const secretBearingPath = /(?:^|\/)(?:\.env(?:\.|$)|credentials?(?:\.|\/)|service-account(?:\.|\/))|\.(?:jks|keystore|p12|pem)$/i;
  for (const absolute of selectedFiles) {
    const relative = sourcePath(absolute);
    if (secretBearingPath.test(relative)) failures.push(`secret-bearing path entered the release: ${relative}`);
    await scanTextFile(absolute, manifest, failures);
  }

  const releaseFiles = await collectFiles(releaseRoot);
  for (const absolute of releaseFiles) await scanTextFile(absolute, manifest, failures);
  await validateReleaseMetadata(manifest, failures);
  await validatePackageLicenses(manifest, failures);

  if (failures.length > 0) {
    const uniqueFailures = [...new Set(failures)].sort();
    throw new Error(uniqueFailures.join('\n'));
  }
  return {
    manifest,
    releaseRoot,
    repositoryRoot,
    selectedFiles,
    runtimeFileCount: selectedFiles.length,
  };
}

async function main() {
  const result = await verifyPublicClientBoundary();
  process.stdout.write(
    `Verified ${result.runtimeFileCount} public client files; proprietary backend sources are excluded.\n`,
  );
}

const invokedPath = process.argv[1] === undefined ? null : pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
