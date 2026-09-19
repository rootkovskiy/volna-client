// SPDX-License-Identifier: Apache-2.0
// Build artifact transformation only: preserve upstream loaders and generate their CJS glue.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

const packageRoot = path.resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw new Error('Pass the prepared matrix-sdk-crypto-wasm source directory');
const declarations = await readFile(path.join(packageRoot, 'pkg/matrix_sdk_crypto_wasm.d.ts'), 'utf8');
if (!declarations.includes('bindRoomKeyRecipients') || !declarations.includes('roomKeyRecipientPolicyVersion')) {
  throw new Error('Generated WASM bindings lack the strict recipient capability');
}
const source = await readFile(path.join(packageRoot, 'pkg/matrix_sdk_crypto_wasm_bg.js'), 'utf8');
const result = ts.transpileModule(source, {
  fileName: 'matrix_sdk_crypto_wasm_bg.js',
  compilerOptions: { allowJs: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  reportDiagnostics: true,
});
if (result.diagnostics?.some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)) {
  throw new Error('Generated WASM glue could not be transpiled');
}
await writeFile(path.join(packageRoot, 'pkg/matrix_sdk_crypto_wasm_bg.cjs'), result.outputText);
console.log('Generated strict WASM CommonJS glue; upstream ESM glue and loaders retained');
