import { createHash, randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';
import { ed25519 } from '@noble/curves/ed25519.js';
import contract from '../src/index.js';
import {
  bytesToBase64Url,
  createMlsRuntime,
  encodeDeviceCredential,
} from '../src/mls-runtime.mjs';

const THREAD_ID = 'thread_interop_1';
const BOB_ACCOUNT_ID = 'account_openmls_bob';
const BOB_DEVICE_ID = 'device_openmls_bob';
const ALICE_ACCOUNT_ID = 'account_tsmls_alice';
const ALICE_DEVICE_ID = 'device_tsmls_alice';
const BOB_AAD = contract.canonicalEnvelopeAad({
  protocolVersion: 1,
  threadId: THREAD_ID,
  senderAccountId: BOB_ACCOUNT_ID,
  senderDeviceId: BOB_DEVICE_ID,
  clientEnvelopeId: 'envelope_openmls_1',
  kind: 'APPLICATION',
  epoch: '1',
});
const ALICE_AAD = contract.canonicalEnvelopeAad({
  protocolVersion: 1,
  threadId: THREAD_ID,
  senderAccountId: ALICE_ACCOUNT_ID,
  senderDeviceId: ALICE_DEVICE_ID,
  clientEnvelopeId: 'envelope_tsmls_1',
  kind: 'APPLICATION',
  epoch: '1',
});

const runtime = createMlsRuntime({ randomBytes: (length) => new Uint8Array(randomBytes(length)) });
const alice = await runtime.createDeviceIdentity({
  accountId: ALICE_ACCOUNT_ID,
  deviceId: ALICE_DEVICE_ID,
  platform: 'web',
  displayName: 'ts-mls Alice',
  capabilities: ['mls-v1'],
});

function record(identity) {
  return {
    accountId: identity.accountId,
    deviceId: identity.deviceId,
    platform: identity.platform,
    displayName: identity.displayName,
    capabilities: identity.capabilities,
    credential: identity.credential,
    signaturePublicKey: identity.signaturePublicKey,
    accountIdentityPublicKey: identity.accountIdentityPublicKey,
    accountIdentitySignature: identity.accountIdentitySignature,
  };
}

function fromHex(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length % 2 !== 0 || !/^[0-9a-f]+$/.test(value)) {
    throw new Error('invalid lowercase hexadecimal input');
  }
  return new Uint8Array(Buffer.from(value, 'hex'));
}

function toHex(value) {
  return Buffer.from(value).toString('hex');
}

function bobRecord(signaturePublicKey) {
  if (signaturePublicKey.length !== 32) throw new Error('OpenMLS signature public key must be 32 bytes');
  const recoverySecret = new Uint8Array(32).fill(41);
  const accountIdentityPublicKey = ed25519.getPublicKey(recoverySecret);
  const credentialBytes = encodeDeviceCredential({
    accountId: BOB_ACCOUNT_ID,
    deviceId: BOB_DEVICE_ID,
    signaturePublicKey,
    accountIdentityKeyHash: createHash('sha256').update(accountIdentityPublicKey).digest(),
  });
  const credential = bytesToBase64Url(credentialBytes);
  const signaturePublicKeyEncoded = bytesToBase64Url(signaturePublicKey);
  const authorization = contract.canonicalDeviceAuthorization({
    accountId: BOB_ACCOUNT_ID,
    deviceId: BOB_DEVICE_ID,
    platform: 'android',
    displayName: 'OpenMLS Bob',
    credential,
    signaturePublicKey: signaturePublicKeyEncoded,
    capabilities: ['mls-v1'],
  });
  return {
    accountId: BOB_ACCOUNT_ID,
    deviceId: BOB_DEVICE_ID,
    platform: 'android',
    displayName: 'OpenMLS Bob',
    capabilities: ['mls-v1'],
    credential,
    credentialBytes,
    signaturePublicKey: signaturePublicKeyEncoded,
    accountIdentityPublicKey: bytesToBase64Url(accountIdentityPublicKey),
    accountIdentitySignature: bytesToBase64Url(ed25519.sign(Buffer.from(authorization, 'utf8'), recoverySecret)),
  };
}

let bob;
let activated = false;
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  const [command, ...fields] = line.split('|');
  if (command === 'IDENTITY') {
    if (bob !== undefined || fields.length !== 1) throw new Error('invalid IDENTITY state');
    bob = bobRecord(fromHex(fields[0]));
    process.stdout.write(`CREDENTIAL|${toHex(bob.credentialBytes)}\n`);
    continue;
  }
  if (command === 'KEY_PACKAGE') {
    if (bob === undefined || activated || fields.length !== 1) throw new Error('invalid KEY_PACKAGE state');
    const activation = await runtime.createGroup({
      threadId: THREAD_ID,
      claims: [{
        claimId: 'claim_openmls_bob_1',
        recipientAccountId: bob.accountId,
        recipientDeviceId: bob.deviceId,
        platform: bob.platform,
        displayName: bob.displayName,
        capabilities: bob.capabilities,
        credential: bob.credential,
        signaturePublicKey: bob.signaturePublicKey,
        accountIdentityPublicKey: bob.accountIdentityPublicKey,
        accountIdentitySignature: bob.accountIdentitySignature,
        keyPackage: bytesToBase64Url(fromHex(fields[0])),
      }],
    });
    activated = true;
    process.stdout.write(`WELCOME|${toHex(Buffer.from(activation.groupId, 'base64url'))}|${toHex(Buffer.from(activation.welcomes[0].payload, 'base64url'))}\n`);
    continue;
  }
  if (command === 'OPENMLS_MESSAGE') {
    if (!activated || bob === undefined || fields.length !== 1) throw new Error('invalid OPENMLS_MESSAGE state');
    const received = await runtime.process({
      threadId: THREAD_ID,
      aad: BOB_AAD,
      epoch: '1',
      ciphertext: bytesToBase64Url(fromHex(fields[0])),
    });
    if (received.event.text !== 'hello from OpenMLS') throw new Error('unexpected OpenMLS plaintext');
    const reply = await runtime.encrypt({
      threadId: THREAD_ID,
      aad: ALICE_AAD,
      event: {
        v: 1,
        kind: 'message.create',
        logicalMessageId: 'logical_tsmls_reply_1',
        clientCreatedAt: '2026-08-13T12:00:01.000Z',
        text: 'hello from ts-mls',
      },
    });
    process.stdout.write(`TSMLS_MESSAGE|${toHex(Buffer.from(reply.ciphertext, 'base64url'))}\n`);
    continue;
  }
  throw new Error(`unknown interop command: ${command}`);
}
