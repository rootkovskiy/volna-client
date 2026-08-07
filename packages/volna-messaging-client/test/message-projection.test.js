'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

test('projection applies authenticated edits, reactions, and tombstones locally', async () => {
  const { projectContentEvents } = await import('../src/message-projection.mjs');
  const common = {
    senderDeviceId: 'device_alice',
    senderAccountId: 'account_alice',
  };
  const messages = projectContentEvents([
    {
      ...common,
      envelopeId: 'envelope_create',
      serverCreatedAt: '2026-08-03T12:00:00.000Z',
      event: { v: 1, kind: 'message.create', logicalMessageId: 'message_target', clientCreatedAt: '2026-08-03T12:00:00.000Z', text: 'old' },
    },
    {
      ...common,
      envelopeId: 'envelope_edit_1',
      serverCreatedAt: '2026-08-03T12:00:01.000Z',
      event: { v: 1, kind: 'message.edit', logicalMessageId: 'message_edit_1', targetLogicalMessageId: 'message_target', clientCreatedAt: '2026-08-03T12:00:01.000Z', text: 'new' },
    },
    {
      senderDeviceId: 'device_bobby',
      senderAccountId: 'account_bobby',
      envelopeId: 'envelope_react',
      serverCreatedAt: '2026-08-03T12:00:02.000Z',
      event: { v: 1, kind: 'message.reaction', logicalMessageId: 'message_react_1', targetLogicalMessageId: 'message_target', clientCreatedAt: '2026-08-03T12:00:02.000Z', emoji: '🔥' },
    },
  ]);
  assert.equal(messages[0].text, 'new');
  assert.deepEqual(messages[0].reactions, [{ accountId: 'account_bobby', emoji: '🔥' }]);
});

test('projection rejects logical event id collisions and ignores another sender edits', async () => {
  const { projectContentEvents } = await import('../src/message-projection.mjs');
  const records = [
    {
      envelopeId: 'envelope_create', senderAccountId: 'account_alice', senderDeviceId: 'device_alice', serverCreatedAt: '2026-08-03T12:00:00.000Z',
      event: { v: 1, kind: 'message.create', logicalMessageId: 'message_target', clientCreatedAt: '2026-08-03T12:00:00.000Z', text: 'original' },
    },
    {
      envelopeId: 'envelope_mallory', senderAccountId: 'account_bobby', senderDeviceId: 'device_bobby', serverCreatedAt: '2026-08-03T12:00:01.000Z',
      event: { v: 1, kind: 'message.edit', logicalMessageId: 'message_edit_1', targetLogicalMessageId: 'message_target', clientCreatedAt: '2026-08-03T12:00:01.000Z', text: 'forged' },
    },
  ];
  assert.equal(projectContentEvents(records)[0].text, 'original');
  assert.throws(() => projectContentEvents([
    ...records,
    { ...records[1], envelopeId: 'envelope_collision', event: { ...records[1].event, text: 'different' } },
  ]), /logical_event_collision/);
});
