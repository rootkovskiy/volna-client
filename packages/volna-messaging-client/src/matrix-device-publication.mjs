// Readiness only, never a trust decision: compare the server's published public
// device keys with this endpoint's Rust Crypto keys before sending a SAS request.
// matrix-js-sdk 42.1.0 processes to-device requests before device-list changes
// from the same /sync. Refresh ONLY our own roster before handing a self-SAS
// request to that SDK; leave all event bytes and trust decisions to Rust Crypto.
export function createMatrixVerificationFetch({ fetch, homeserverUrl, userId, refreshOwnDeviceKeys }) {
  const origin = new URL(homeserverUrl).origin;
  return async (input, init) => {
    const response = await fetch(input, init);
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (response.ok && url.origin === origin && /^\/_matrix\/client\/(v3|r0)\/sync$/.test(url.pathname)) {
      const snapshot = await response.clone().json();
      if (Array.isArray(snapshot?.to_device?.events) && snapshot.to_device.events.some((event) =>
        event?.type === 'm.key.verification.request' && event.sender === userId
        && typeof event.content?.from_device === 'string' && typeof event.content?.transaction_id === 'string'
      )) await refreshOwnDeviceKeys();
    }
    return response;
  };
}

export async function waitForPublishedMatrixDevice({ userId, deviceId, ed25519, curve25519, readDevice }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    while (!controller.signal.aborted) {
      const device = await readDevice(controller.signal);
      if (controller.signal.aborted) break;
      if (device) {
        if (device.user_id !== userId || device.device_id !== deviceId
          || device.keys?.[`ed25519:${deviceId}`] !== ed25519
          || device.keys?.[`curve25519:${deviceId}`] !== curve25519) {
          throw new Error('Опубликованные ключи этого устройства не совпадают с локальными. Проверка не начата.');
        }
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  } catch (error) {
    if (!controller.signal.aborted) throw error;
  } finally {
    clearTimeout(timeout);
  }
  throw new Error('Это устройство ещё подключается к защите сообщений. Подождите несколько секунд и начните проверку снова.');
}
