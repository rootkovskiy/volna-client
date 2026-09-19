import { MessageProjection, MessageProjectionError } from './message-projection.mjs';

// This transport is for encrypted VOLNA timeline events, not generic Matrix
// RoomMessage traffic. Enforce this BEFORE passing any request to the network.
export function createEncryptedMatrixFetch(fetch, homeserverUrl) {
  const origin = new URL(homeserverUrl).origin;
  return async (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    const send = url.pathname.match(/^\/_matrix\/client\/[^/]+\/rooms\/[^/]+\/send\/([^/]+)\//);
    if (url.origin === origin && send && decodeURIComponent(send[1]) !== 'm.room.encrypted') {
      throw new Error('Отправка незашифрованного Matrix-события заблокирована');
    }
    return fetch(input, init);
  };
}

export function originalEncryptedMatrixContent(event) {
  if (event.getWireType() !== 'm.room.encrypted' || event.isDecryptionFailure()
      || event.getType() !== 'm.room.message') return null;
  // getContent() can contain an UNSIGNED server-bundled m.replace. VOLNA edits
  // are separate authenticated content events, never Matrix aggregations.
  return event.getOriginalContent();
}

export async function sendMatrixContentOnce(client, room, content, transactionId) {
  // Recreating a MatrixEvent with an already pending transaction throws in the
  // SDK. Reuse its failed local echo; acknowledge an already confirmed one.
  const existing = room.getEventForTxnId(transactionId)
    ?? room.getLiveTimeline().getEvents().find(event => event.getTxnId() === transactionId
      && event.getSender() === client.getUserId());
  if (existing) {
    if ((existing.status === 'sent' || existing.status === null)
        && existing.getWireType() === 'm.room.encrypted' && existing.getId()?.startsWith('$')) {
      return { event_id: existing.getId() };
    }
    if (existing.status === 'not_sent') return client.resendEvent(existing, room);
    throw new Error('Matrix-сообщение ещё отправляется; повтор будет выполнен позже');
  }
  return client.sendEvent(room.roomId, 'm.room.message', content, transactionId);
}

export function projectMatrixContentEvents(records) {
  const projection = new MessageProjection();
  const ordered = [...records].sort((a, b) => Date.parse(a.serverCreatedAt) - Date.parse(b.serverCreatedAt)
    || a.envelopeId.localeCompare(b.envelopeId));
  for (const record of ordered) {
    try { projection.append(record); } catch (error) {
      if (!(error instanceof MessageProjectionError)) throw error;
      // Quarantine this conflicting event, not the conversation or inbox.
    }
  }
  return projection.snapshot();
}
