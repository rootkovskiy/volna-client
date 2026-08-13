import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(path.join(packageRoot, 'public-boundary.json'), 'utf8'));
const packageJson = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
const failures = [];
const standaloneWorkspace = await readFile(path.join(packageRoot, 'pnpm-workspace.yaml'), 'utf8');
const standaloneLock = await readFile(path.join(packageRoot, 'pnpm-lock.yaml'), 'utf8');

if (packageJson.private !== false) failures.push('package.json must explicitly set private=false');
if (packageJson.license !== manifest.license) failures.push(`package license must be ${manifest.license}`);
if (packageJson.name !== manifest.package) failures.push(`package name must be ${manifest.package}`);
if (packageJson.volnaVerification?.packageManager !== 'pnpm@11.7.0') failures.push('verification package manager must be pinned to pnpm@11.7.0');
if (packageJson.packageManager !== undefined && packageJson.packageManager !== 'pnpm@11.7.0') failures.push('package manager must be pinned to pnpm@11.7.0');

const requiredPublishedFiles = [
  'DEPENDENCIES.md',
  'LICENSE',
  'NOTICE',
  'PUBLIC_BOUNDARY.md',
  'README.md',
  'SECURITY.md',
  'THREAT_MODEL.md',
  'pnpm-lock.yaml',
  'pnpm-lock.public.yaml',
  'pnpm-workspace.yaml',
];
if (!Array.isArray(packageJson.files)) failures.push('package.json files allowlist is required');
for (const required of requiredPublishedFiles) {
  if (!packageJson.files?.includes(required)) failures.push(`published files must include ${required}`);
  if (!manifest.allowedTopLevelEntries.includes(required)) failures.push(`public boundary must include ${required}`);
}
if (await readFile(path.join(packageRoot, 'pnpm-lock.yaml'), 'utf8') !== await readFile(path.join(packageRoot, 'pnpm-lock.public.yaml'), 'utf8')) {
  failures.push('pnpm-lock.public.yaml must exactly match pnpm-lock.yaml');
}
for (const [dependency, expected] of [['postcss', '8.5.26'], ['uuid', '11.1.1']]) {
  if (!new RegExp(`^\\s{2}${dependency}:\\s+${expected.replaceAll('.', '\\.') }\\s*$`, 'm').test(standaloneWorkspace)) {
    failures.push(`standalone workspace must override ${dependency} to ${expected}`);
  }
  const resolved = [...standaloneLock.matchAll(new RegExp(`^\\s{2}${dependency.replaceAll('-', '\\-')}@([^:]+):`, 'gm'))]
    .map((match) => match[1]);
  if (resolved.length === 0 || resolved.some((version) => version !== expected)) {
    failures.push(`standalone lockfile must resolve only ${dependency}@${expected}`);
  }
}
for (const [kind, dependencies] of Object.entries({
  dependencies: packageJson.dependencies,
  devDependencies: packageJson.devDependencies,
})) {
  for (const [name, version] of Object.entries(dependencies ?? {})) {
    if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
      failures.push(`${kind} must pin ${name} to an exact version`);
    }
  }
}

const topLevelEntries = (await readdir(packageRoot)).sort();
for (const entry of topLevelEntries) {
  if (entry === 'node_modules') continue;
  if (!manifest.allowedTopLevelEntries.includes(entry)) failures.push(`unexpected top-level entry: ${entry}`);
}

const ignoredDirectories = new Set(['node_modules', 'target', 'dist', 'coverage']);
const textExtensions = new Set(['.cjs', '.d.ts', '.js', '.json', '.md', '.mjs', '.rs', '.toml', '.ts', '.tsx', '.yml', '.yaml']);
const files = [];

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(absolute);
    else files.push(absolute);
  }
}

await walk(packageRoot);

for (const absolute of files) {
  const relative = path.relative(packageRoot, absolute).replaceAll('\\', '/');
  const lower = relative.toLowerCase();
  if (relative !== 'SECURITY.md' && manifest.forbiddenPathFragments.some((fragment) => lower.includes(fragment))) {
    failures.push(`secret-bearing path is forbidden: ${relative}`);
  }
  if (![...textExtensions].some((extension) => relative.endsWith(extension))) continue;
  const content = await readFile(absolute, 'utf8');
  if (/E:\\Projects\\SOYUZ|C:\\Users\\/i.test(content)) failures.push(`local workspace path leaked in ${relative}`);
  if (relative.startsWith('src/')) {
    if (/\bconsole\.(?:debug|error|info|log|trace|warn)\s*\(/.test(content)) {
      failures.push(`runtime logging sink is forbidden in ${relative}`);
    }
    if (/(?:from\s+|require\s*\(|import\s*\()["'][^"']*(?:sentry|analytics|telemetry|crashlytics)[^"']*["']/i.test(content)) {
      failures.push(`runtime telemetry dependency is forbidden in ${relative}`);
    }
  }
  const imports = [...content.matchAll(/(?:from\s+|require\s*\(|import\s*\()["']([^"']+)["']/g)].map((match) => match[1]);
  for (const specifier of imports) {
    if (specifier.startsWith('.')) {
      const resolved = path.resolve(path.dirname(absolute), specifier);
      if (resolved !== packageRoot && !resolved.startsWith(`${packageRoot}${path.sep}`)) {
        failures.push(`relative import escapes public package: ${specifier} in ${relative}`);
      }
      continue;
    }
    if (manifest.forbiddenImportPrefixes.some((prefix) => specifier.startsWith(prefix))) {
      failures.push(`forbidden import ${specifier} in ${relative}`);
    }
  }
}

if (failures.length) {
  for (const failure of failures) process.stderr.write(`${failure}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Verified ${files.length} public-boundary files for ${packageJson.name}.\n`);
}
