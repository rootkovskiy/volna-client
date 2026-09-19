// SPDX-License-Identifier: Apache-2.0
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

export const sdkRoot = fileURLToPath(new URL('../sdk/', import.meta.url));
export const manifest = JSON.parse(await readFile(join(sdkRoot, 'manifest.json'), 'utf8'));
export function run(command, args, cwd, env = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: 'inherit', windowsHide: true });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolveRun() : reject(new Error(`${command} failed (${code})`)));
  });
}
export async function prepareSdkSource(platform) {
  const pin = manifest.sources[platform];
  if (!pin) throw new Error('Unknown pinned SDK source');
  const patch = await readFile(join(sdkRoot, pin.patch));
  if (createHash('sha256').update(patch).digest('hex') !== pin.patchSha256) throw new Error('SDK patch integrity mismatch');
  const workspace = await mkdtemp(join(tmpdir(), 'volna-recipient-sdk-'));
  const response = await fetch(`https://codeload.github.com/${pin.repository}/tar.gz/${pin.revision}`, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`SDK source download failed (${response.status})`);
  const archive = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(archive).digest('hex') !== pin.archiveSha256) throw new Error('SDK source integrity mismatch');
  const archivePath = join(workspace, 'source.tar.gz');
  await writeFile(archivePath, archive);
  const source = join(workspace, 'source');
  await mkdir(source);
  await run('tar', ['-xzf', archivePath, '--strip-components=1', '-C', source], workspace);
  await run('git', ['init', '--quiet'], source);
  // Git for Windows may otherwise rewrite patched source lines to CRLF.
  await run('git', ['config', 'core.autocrlf', 'false'], source);
  await run('git', ['apply', '--check', resolve(sdkRoot, pin.patch)], source);
  await run('git', ['apply', resolve(sdkRoot, pin.patch)], source);
  return { source, workspace, pin };
}
