// SPDX-License-Identifier: Apache-2.0
// Execute the actual generated WASM, not a JavaScript replacement of its policy.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';

if (!process.argv[2]) throw new Error('Pass a built matrix-sdk-crypto-wasm package directory');
const sdk = createRequire(import.meta.url)(path.resolve(process.argv[2], 'node.cjs'));
const opened = [];
async function fixture(user, device) {
  const machine = await sdk.OlmMachine.initialize(new sdk.UserId(user), new sdk.DeviceId(device));
  opened.push(machine);
  const request = (await machine.outgoingRequests()).find((item) => item.type === sdk.RequestType.KeysUpload);
  assert.ok(request, 'fixture must publish real signed device and one-time keys');
  const upload = JSON.parse(request.body);
  await machine.markRequestAsSent(request.id, request.type, JSON.stringify({ one_time_key_counts: { signed_curve25519: Object.keys(upload.one_time_keys).length } }));
  return { machine, user, device, upload };
}

try {
  const alice = await fixture('@alice:example.org', 'ALICE');
  const bob = await fixture('@bob:example.org', 'BOB');
  const outsider = await fixture('@service:example.org', 'SERVICE');
  assert.equal(alice.machine.roomKeyRecipientPolicyVersion, 1);
  const room = '!direct:example.org';
  await assert.rejects(() => alice.machine.shareRoomKey(new sdk.RoomId(room), [], new sdk.EncryptionSettings()));
  await alice.machine.bindRoomKeyRecipients(new sdk.RoomId(room), new sdk.UserId(bob.user));
  await alice.machine.bindRoomKeyRecipients(new sdk.RoomId(room), new sdk.UserId(bob.user));
  await assert.rejects(() => alice.machine.bindRoomKeyRecipients(new sdk.RoomId(room), new sdk.UserId(outsider.user)));

  const recipients = [bob, outsider];
  await alice.machine.updateTrackedUsers(recipients.map(({ user }) => new sdk.UserId(user)));
  await alice.machine.markRequestAsSent('fixture-query', sdk.RequestType.KeysQuery, JSON.stringify({
    device_keys: Object.fromEntries(recipients.map(({ user, device, upload }) => [user, { [device]: upload.device_keys }])),
    failures: {},
  }));
  const claim = await alice.machine.getMissingSessions(recipients.map(({ user }) => new sdk.UserId(user)));
  assert.ok(claim, 'both recipients must have real Olm session material');
  await alice.machine.markRequestAsSent(claim.id, sdk.RequestType.KeysClaim, JSON.stringify({
    one_time_keys: Object.fromEntries(recipients.map(({ user, device, upload }) => [user, { [device]: Object.fromEntries([Object.entries(upload.one_time_keys)[0]]) }])),
    failures: {},
  }));
  const settings = new sdk.EncryptionSettings();
  settings.sharingStrategy = sdk.CollectStrategy.allDevices();
  const shares = await alice.machine.shareRoomKey(new sdk.RoomId(room), recipients.map(({ user }) => new sdk.UserId(user)), settings);
  assert.ok(shares.length > 0, 'legitimate peer must receive a share');
  const events = [];
  for (const share of shares) {
    const messages = JSON.parse(share.body).messages;
    assert.ok(!Object.hasOwn(messages, outsider.user), 'late outsider received an encrypted key share');
    if (messages[bob.user]?.[bob.device]) events.push({ sender: alice.user, type: share.event_type, content: messages[bob.user][bob.device] });
  }
  assert.ok(events.length > 0);
  await bob.machine.receiveSyncChanges(JSON.stringify(events), new sdk.DeviceLists(), new Map());
  const counts = await bob.machine.roomKeyCounts();
  assert.ok(counts.total > 0, 'peer must decrypt and retain the generated Megolm key');
  const otherRoom = new sdk.RoomId('!other:example.org');
  await alice.machine.bindRoomKeyRecipients(otherRoom, new sdk.UserId(outsider.user));
  const bobDevice = await alice.machine.getDevice(new sdk.UserId(bob.user), new sdk.DeviceId(bob.device));
  assert.ok(bobDevice);
  for (const type of ['m.room_key', 'm.forwarded_room_key', 'm.room_key_bundle', 'io.element.msc4268.room_key_bundle']) {
    await assert.rejects(() => bobDevice.encryptToDeviceEvent(type, { room_id: '!other:example.org' }, sdk.CollectStrategy.allDevices()));
  }
  bobDevice.free();
  console.log('Built WASM PASS: capability, missing/conflicting binding, late outsider rejection, real peer key decryption, four alternate key-event sinks');
} finally {
  for (const machine of opened) machine.close();
}
