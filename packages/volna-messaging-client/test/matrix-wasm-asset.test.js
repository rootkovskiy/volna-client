const test = require('node:test');
const assert = require('node:assert/strict');
const { Writable } = require('node:stream');
const { once } = require('node:events');
const { matrixWasmMiddleware, matrixCryptoAssetPath } = require('../metro.cjs');

function response() {
  const chunks = [];
  const stream = new Writable({ write(chunk, _encoding, done) { chunks.push(chunk); done(); } });
  stream.writeHead = (status, headers) => { stream.status = status; stream.headers = headers; };
  stream.bytes = () => Buffer.concat(chunks);
  return stream;
}

test('the shared local/gateway asset is valid WASM with its pinned path, MIME and matching HEAD length', async () => {
  const get = response(), finished = once(get, 'finish');
  matrixWasmMiddleware({ method: 'GET', url: matrixCryptoAssetPath }, get, () => assert.fail('must serve the crypto asset'));
  await finished;
  assert.equal(get.status, 200);
  assert.equal(get.headers['content-type'], 'application/wasm');
  assert.equal(get.headers['x-content-type-options'], 'nosniff');
  assert.equal(get.headers['content-length'], get.bytes().length);
  assert.ok(get.bytes().subarray(0, 4).equals(Buffer.from([0, 97, 115, 109])));
  assert.ok(await WebAssembly.compile(get.bytes()));
  const head = response();
  matrixWasmMiddleware({ method: 'HEAD', url: `${matrixCryptoAssetPath}?check=1` }, head, () => assert.fail('must serve HEAD'));
  assert.equal(head.headers['content-length'], get.headers['content-length']);
  assert.equal(head.bytes().length, 0);
});

test('unrelated routes, unpinned versions and non-read methods stay with the original middleware', () => {
  let next = 0;
  for (const [method, url] of [['GET', '/messages'], ['GET', matrixCryptoAssetPath.replace('18.5.0-volna.2','upstream')], ['POST', matrixCryptoAssetPath]]) {
    const res = response(); matrixWasmMiddleware({ method, url }, res, () => next++);
    assert.equal(res.status, undefined);
  }
  assert.equal(next, 3);
});
