// SPDX-License-Identifier: Apache-2.0
// Build custom source; never fall back to an upstream recipient-unguarded binary.
import { cp, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { manifest, prepareSdkSource, run } from './prepare-sdk-source.mjs';

if (process.platform !== 'darwin') throw new Error('The custom Matrix iOS SDK requires macOS with Xcode; no upstream fallback is allowed.');
const root = fileURLToPath(new URL('../', import.meta.url));
const { source, workspace, pin } = await prepareSdkSource('ios');
const env = { RUSTUP_TOOLCHAIN: manifest.rustToolchain, CARGO_BUILD_JOBS: '2' };
await run('xcodebuild', ['-version'], source);
await run('rustup', ['target', 'add', '--toolchain', manifest.rustToolchain, 'aarch64-apple-ios', 'aarch64-apple-ios-sim', 'x86_64-apple-ios'], source);
const components = join(workspace, 'components');
await mkdir(components);
await run('cargo', ['run', '--locked', '-p', 'xtask', '--', 'swift', 'build-framework', '--release', '--sequentially',
  '--target', 'aarch64-apple-ios', '--target', 'aarch64-apple-ios-sim', '--target', 'x86_64-apple-ios',
  '--ios-deployment-target', '16.0', '--components-path', components], source, env);
const swiftSource = join(components, 'Sources', 'MatrixRustSDK');
const api = await readFile(join(swiftSource, 'matrix_sdk_ffi.swift'), 'utf8');
if (!api.includes('bindRoomKeyRecipients') || !api.includes('roomKeyRecipientPolicyVersion')) throw new Error('Custom recipient API missing from generated Swift');
// Keep the previous vendor inputs recoverable.
const vendor = join(root, 'vendor');
try { await rename(vendor, join(workspace, 'previous-vendor')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
await mkdir(vendor);
await cp(join(components, 'MatrixSDKFFI.xcframework'), join(vendor, 'MatrixSDKFFI.xcframework'), { recursive: true });
await cp(swiftSource, join(vendor, 'MatrixRustSDK'), { recursive: true });
await writeFile(join(vendor, 'recipient-build.json'), JSON.stringify({ sourceRevision: pin.revision, patchSha256: pin.patchSha256,
  policyVersion: 1, builtLocally: true, signed: false, independentlyReproduced: false }, null, 2));
console.log('Custom iOS SDK built locally. App compilation, physical tests and signed independent reproduction remain separate gates.');
