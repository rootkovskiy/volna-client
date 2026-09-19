// /join acknowledges server membership before /sync installs the room locally.
// Wait for that installation, then let the caller validate the full contract.
// A timeout must never grant membership or synthesize room state.
export function waitForMatrixJoinedRoom(client, roomId, { assertActive, timeoutMs = 20_000 }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer;
    const finish = (error, room) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      client.off('sync', check);
      if (error) reject(error);
      else resolve(room);
    };
    const check = (state) => {
      try {
        assertActive();
        if (state === 'STOPPED') throw new Error('Matrix sync stopped before room was ready');
        const room = client.getRoom(roomId);
        if (room?.getMyMembership() === 'join') finish(null, room);
        else if (room?.getMyMembership() === 'leave' || room?.getMyMembership() === 'ban') {
          throw new Error('Matrix room membership is missing');
        }
      } catch (error) { finish(error); }
    };
    client.on('sync', check);
    timer = setTimeout(() => finish(new Error('Matrix room sync timeout')), timeoutMs);
    check();
  });
}
