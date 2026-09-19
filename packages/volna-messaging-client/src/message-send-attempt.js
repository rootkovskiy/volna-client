// One current composer attempt, kept only in endpoint memory. Failed retries reuse
// the transaction; a changed draft/destination or acknowledged send starts anew.
exports.createMessageSendAttempt = (newId) => {
  let current = null;
  return {
    get(scope, draft) {
      const fingerprint = JSON.stringify([scope, draft]);
      if (!current || current.fingerprint !== fingerprint) current = { fingerprint, id: newId() };
      return current.id;
    },
    clear() { current = null; },
  };
};
