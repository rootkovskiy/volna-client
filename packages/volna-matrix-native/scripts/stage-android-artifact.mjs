// SPDX-License-Identifier: Apache-2.0
// Deterministic binary chunks keep each generated Git blob below 100 MiB.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve } from 'node:path';
import { sdkRoot } from './prepare-sdk-source.mjs';

if (!process.argv[2]) throw new Error('Pass the complete four-ABI AAR');
const input = resolve(process.argv[2]);
const jar = process.argv[3] ?? 'jar';
const { stdout } = await promisify(execFile)(jar, ['tf', input], { windowsHide: true });
const entries = new Set(stdout.trim().split(/\r?\n/));
const abis = ['arm64-v8a', 'armeabi-v7a', 'x86', 'x86_64'];
for (const abi of abis) if (!entries.has(`jni/${abi}/libmatrix_sdk_ffi.so`)) throw new Error(`Missing SDK ABI: ${abi}`);
if (!entries.has('classes.jar')) throw new Error('Generated Kotlin classes are missing');
const bytes = await readFile(input);
const hash = value => createHash('sha256').update(value).digest('hex');
const artifact = 'matrix-sdk-android-26.08.13-volna.1.aar';
const parts = [];
const limit = 48 * 1024 * 1024;
for (let offset = 0; offset < bytes.length; offset += limit) {
  const chunk = bytes.subarray(offset, Math.min(offset + limit, bytes.length));
  const file = `${artifact}.part${String(parts.length + 1).padStart(2, '0')}`;
  const sha256 = hash(chunk);
  try { await writeFile(join(sdkRoot, file), chunk, { flag: 'wx' }); }
  catch (error) {
    if (error.code !== 'EEXIST' || hash(await readFile(join(sdkRoot, file))) !== sha256) throw error;
  }
  parts.push({ file, sha256 });
}
console.log(JSON.stringify({ artifact, sha256: hash(bytes), parts, abis, allArchitecturesComplete: true }, null, 2));
