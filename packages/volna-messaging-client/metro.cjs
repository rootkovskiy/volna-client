// Node-only adapter shared by Metro and the development reverse proxy.
const fs = require('node:fs');
const path = require('node:path');

const matrixCryptoAssetPath = '/matrix-assets/matrix-sdk-crypto-wasm/18.5.0-volna.2/matrix_sdk_crypto_wasm_bg.wasm';
const sdkEntry = require.resolve('matrix-js-sdk', { paths: [__dirname] });
const wasmPath = path.join(path.dirname(require.resolve('@matrix-org/matrix-sdk-crypto-wasm', {
  paths: [path.dirname(sdkEntry)],
})), 'pkg', 'matrix_sdk_crypto_wasm_bg.wasm');

function matrixWasmMiddleware(request, response, next) {
  if (!['GET', 'HEAD'].includes(request.method) || request.url?.split('?')[0] !== matrixCryptoAssetPath) return next();
  let stats;
  try { stats = fs.statSync(wasmPath); }
  catch {
    response.writeHead(503, { 'content-type': 'text/plain', 'cache-control': 'no-store' });
    response.end('Matrix crypto asset is unavailable');
    return;
  }
  response.writeHead(200, {
    'cache-control': 'public, max-age=31536000, immutable',
    'content-length': stats.size,
    'content-type': 'application/wasm',
    'x-content-type-options': 'nosniff',
  });
  if (request.method === 'HEAD') return response.end();
  const stream = fs.createReadStream(wasmPath);
  stream.on('error', () => response.destroy());
  response.on('close', () => stream.destroy());
  stream.pipe(response);
}

module.exports = { matrixWasmMiddleware, matrixCryptoAssetPath };
