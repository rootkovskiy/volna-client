// SPDX-License-Identifier: Apache-2.0
export function requireMatrixRecipientCrypto(crypto) {
  if (!crypto || typeof crypto.getRoomKeyRecipientPolicyVersion !== 'function'
      || crypto.getRoomKeyRecipientPolicyVersion() !== 1
      || typeof crypto.getAuthenticatedBackupVersion !== 'function'
      || crypto.getAuthenticatedBackupVersion() !== 1
      || typeof crypto.bindRoomKeyRecipients !== 'function') {
    throw new Error('Требуется обновлённая библиотека защиты Matrix. Отправка остановлена.');
  }
  return crypto;
}
