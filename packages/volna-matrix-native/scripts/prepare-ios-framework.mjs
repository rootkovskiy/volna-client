import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';

const VERSION = '26.08.11';
const SHA256 = '6d6ca99429491c50b6ba5138e640cf51087bb2a48c8a10213efed7709219ef72';
const URL = `https://github.com/matrix-org/matrix-rust-components-swift/releases/download/${VERSION}/MatrixSDKFFI.xcframework.zip`;
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const vendor = join(root, 'vendor');
const destination = join(vendor, 'MatrixSDKFFI.xcframework');

try {
  if ((await stat(destination)).isDirectory()) process.exit(0);
} catch {}
if (process.platform !== 'darwin') throw new Error('The iOS Matrix XCFramework must be prepared on macOS');

const temporary = join(tmpdir(), `volna-matrix-ios-${process.pid}`);
const archive = join(temporary, 'MatrixSDKFFI.xcframework.zip');
const extracted = join(temporary, 'extracted');
await mkdir(extracted, { recursive: true });
try {
  const response = await fetch(URL, { redirect: 'follow' });
  if (!response.ok || !response.body) throw new Error(`Matrix iOS download failed (${response.status})`);
  await pipeline(response.body, createWriteStream(archive));
  const hash = createHash('sha256');
  const bytes = await import('node:fs/promises').then(({ readFile }) => readFile(archive));
  hash.update(bytes);
  if (hash.digest('hex') !== SHA256) throw new Error('Matrix iOS XCFramework checksum mismatch');
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn('ditto', ['-x', '-k', archive, extracted], { stdio: 'inherit' });
    child.once('exit', (code) => code === 0 ? resolvePromise() : rejectPromise(new Error(`ditto exited ${code}`)));
  });
  await mkdir(vendor, { recursive: true });
  await rm(destination, { recursive: true, force: true });
  await rename(join(extracted, 'MatrixSDKFFI.xcframework'), destination);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
