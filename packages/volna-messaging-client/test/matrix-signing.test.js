'use strict';

const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const test = require('node:test');

const matrixBase64 = (value) => Buffer.from(value).toString('base64').replace(/=+$/, '');

test('Matrix canonical JSON signature verification ignores only unsigned and signatures', async () => {
  const { ed25519 } = await import('@noble/curves/ed25519.js');
  const { canonicalMatrixJson, verifyMatrixSignedObject } = await import('../src/matrix-signing.mjs');
  const privateKey = randomBytes(32);
  const publicKey = matrixBase64(ed25519.getPublicKey(privateKey));
  const userId = '@volna_test:matrix.volna.test';
  const keyId = 'ed25519:master';
  const value = {
    user_id: userId,
    usage: ['master'],
    keys: { [keyId]: publicKey },
    unsigned: { device_display_name: 'untrusted label' },
  };
  const signature = matrixBase64(ed25519.sign(new TextEncoder().encode(canonicalMatrixJson({
    keys: value.keys,
    usage: value.usage,
    user_id: value.user_id,
  })), privateKey));
  value.signatures = { [userId]: { [keyId]: signature } };

  assert.equal(verifyMatrixSignedObject(value, userId, keyId, publicKey), true);
  value.unsigned.device_display_name = 'changed outside signature';
  assert.equal(verifyMatrixSignedObject(value, userId, keyId, publicKey), true);
  value.usage = ['self_signing'];
  assert.equal(verifyMatrixSignedObject(value, userId, keyId, publicKey), false);
  privateKey.fill(0);
});

test('Matrix signed JSON helpers reject ambiguous keys, invalid sizes, and non-integers', async () => {
  const { canonicalMatrixJson, matrixBase64ToBytes, oneMatrixEd25519Key } = await import('../src/matrix-signing.mjs');
  assert.equal(canonicalMatrixJson({ z: 1, a: ['ю', true, null] }), '{"a":["ю",true,null],"z":1}');
  assert.equal(canonicalMatrixJson({ '\u{10000}': 1, '\ue000': 2 }), '{"":2,"𐀀":1}');
  assert.throws(() => canonicalMatrixJson({ value: 1.5 }), /non-canonical number/);
  assert.throws(() => matrixBase64ToBytes('AAAA', 32), /key size/);
  assert.throws(() => matrixBase64ToBytes(`${matrixBase64(randomBytes(32))}=`, 32), /key encoding/);
  assert.throws(() => oneMatrixEd25519Key({ 'ed25519:a': 'a', 'ed25519:b': 'b' }), /key set/);
  assert.throws(() => oneMatrixEd25519Key({ 'ed25519:a': 'a', 'future:a': 'b' }), /key set/);
});

test('Matrix cross-signing accepts an unsigned trusted master and verifies master-to-device delegation', async () => {
  const { ed25519 } = await import('@noble/curves/ed25519.js');
  const { canonicalMatrixJson, verifyMatrixSignedObject } = await import('../src/matrix-signing.mjs');
  const userId = '@volna_test:matrix.volna.test';
  const masterPrivate = randomBytes(32);
  const selfPrivate = randomBytes(32);
  const devicePrivate = randomBytes(32);
  const masterPublic = matrixBase64(ed25519.getPublicKey(masterPrivate));
  const selfPublic = matrixBase64(ed25519.getPublicKey(selfPrivate));
  const devicePublic = matrixBase64(ed25519.getPublicKey(devicePrivate));
  const masterId = `ed25519:${masterPublic}`;
  const selfId = `ed25519:${selfPublic}`;
  const deviceId = 'matrix_device_test';
  const master = { user_id: userId, usage: ['master'], keys: { [masterId]: masterPublic } };
  const selfSigning = { user_id: userId, usage: ['self_signing'], keys: { [selfId]: selfPublic } };
  selfSigning.signatures = { [userId]: { [masterId]: matrixBase64(ed25519.sign(new TextEncoder().encode(canonicalMatrixJson(selfSigning)), masterPrivate)) } };
  const device = {
    user_id: userId,
    device_id: deviceId,
    algorithms: ['m.olm.v1.curve25519-aes-sha2', 'm.megolm.v1.aes-sha2'],
    keys: { [`ed25519:${deviceId}`]: devicePublic, [`curve25519:${deviceId}`]: matrixBase64(randomBytes(32)) },
  };
  device.signatures = { [userId]: { [selfId]: matrixBase64(ed25519.sign(new TextEncoder().encode(canonicalMatrixJson(device)), selfPrivate)) } };

  assert.equal(master.signatures, undefined);
  assert.equal(verifyMatrixSignedObject(selfSigning, userId, masterId, masterPublic), true);
  assert.equal(verifyMatrixSignedObject(device, userId, selfId, selfPublic), true);
  device.keys[`ed25519:${deviceId}`] = matrixBase64(randomBytes(32));
  assert.equal(verifyMatrixSignedObject(device, userId, selfId, selfPublic), false);
  masterPrivate.fill(0);
  selfPrivate.fill(0);
  devicePrivate.fill(0);
});
