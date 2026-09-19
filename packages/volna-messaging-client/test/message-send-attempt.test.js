const test = require('node:test');
const assert = require('node:assert/strict');
const { createMessageSendAttempt } = require('../src/message-send-attempt.js');
test('failed retries retain one transaction; changed content, destination and acknowledged sends do not reuse it', () => {
  let counter = 0;
  const attempt = createMessageSendAttempt(() => `message_${++counter}`);
  const first = attempt.get('alice:bobby', { text: 'fixture' });
  assert.equal(attempt.get('alice:bobby', { text: 'fixture' }), first);
  assert.notEqual(attempt.get('alice:bobby', { text: 'changed' }), first);
  const second = attempt.get('alice:bobby', { text: 'fixture' });
  assert.notEqual(second, first);
  assert.notEqual(attempt.get('alice:charlie', { text: 'fixture' }), second);
  const beforeSuccess = attempt.get('alice:bobby', { text: 'fixture' });
  attempt.clear();
  assert.notEqual(attempt.get('alice:bobby', { text: 'fixture' }), beforeSuccess);
});
