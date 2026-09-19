// Presentation only: trust and verification results always come from Matrix Crypto.
import { matrixStoreErrorMessage } from './matrix-store-errors.mjs';

export function matrixSecurityErrorMessage(error) {
  const ownershipMessage = matrixStoreErrorMessage(error);
  if (ownershipMessage) return ownershipMessage;
  const reason = error?.cause ?? error;
  if (reason?.httpStatus === 401 || reason?.httpStatus === 403 || reason?.errcode === 'M_UNKNOWN_TOKEN') {
    return 'Сессия защищённых сообщений прервана. Выйдите из VOLNA и войдите снова, чтобы восстановить соединение.';
  }
  const message = reason instanceof Error ? reason.message : '';
  // App-authored validation remains useful; never render SDK URLs, IDs or stack traces.
  if (/^[А-ЯЁ]/u.test(message) && !/[\r\n]|https?:|\/_matrix|@|\bMatrix\b/.test(message)) return message;
  return 'Не удалось проверить защиту сообщений. Проверьте соединение и повторите попытку.';
}

export function isActiveMatrixVerification(value) {
  return Boolean(value && !['done', 'cancelled'].includes(value.phase));
}

export function selectMatrixVerification(security, current) {
  const updates = security.verificationUpdates ?? security.pendingVerifications;
  const matched = updates.find((item) => item.id === current?.id);
  const pending = security.pendingVerifications.find(isActiveMatrixVerification);
  return isActiveMatrixVerification(current) ? matched ?? pending ?? current : pending ?? matched ?? current;
}

// Local trust is established by SAS, not a prerequisite for requesting it.
// A new endpoint cannot yet call the existing endpoint locally verified.
export function matrixOwnVerificationTargets(security) {
  return (security?.ownDevices ?? []).filter((device) => !device.current);
}

export function matrixSecurityOverview(security, verification) {
  if (!security) return { kind: 'loading', title: 'Проверяем защиту', description: 'Получаем состояние ваших устройств.', action: null };
  if (security.partnerIdentityChanged) return { kind: 'identity-changed', title: 'Ключи собеседника изменились', description: 'Отправка приостановлена. Свяжитесь с собеседником по другому каналу и заново сравните код защиты.', action: 'partner' };
  if (isActiveMatrixVerification(verification)) return { kind: 'verification', title: verification.initiatedByMe ? 'Продолжите подтверждение' : 'Запрос на подтверждение', description: 'Сравните код на двух экранах. Принимайте только тот запрос, который вы ожидали.', action: 'verification' };
  const current = security.ownDevices.find((device) => device.current);
  if (!current) return { kind: 'loading', title: 'Не удалось определить это устройство', description: 'Обновите состояние защиты и попробуйте ещё раз.', action: null };
  if (!current.verified || !security.crossSigningReady) {
    const hasOtherDevice = matrixOwnVerificationTargets(security).length > 0;
    if (!hasOtherDevice && security.recoveryKeyExists === false) return { kind: 'verify-current', title: 'Настройте защиту сообщений', description: 'Сохраните ключ восстановления, чтобы получать доступ к защищённой переписке на новых устройствах.', action: 'recovery' };
    return { kind: 'verify-current', title: 'Подтвердите это устройство', description: hasOtherDevice ? 'Откройте VOLNA на другом своём устройстве и сравните код на двух экранах. Подтверждайте только знакомое устройство.' : 'Восстановите доступ с сохранённым ключом. Если вы настраиваете защиту впервые, создайте его на следующем шаге.', action: hasOtherDevice ? 'devices' : 'recovery' };
  }
  if (security.ownDevices.some((device) => !device.current && !device.verified)) return { kind: 'verify-other', title: 'Подтвердите новое устройство', description: 'Если вы вошли в VOLNA на другом устройстве, сравните код на обоих экранах. Незнакомые устройства не подтверждайте.', action: 'devices' };
  if (!security.secretStorageReady) return { kind: 'recovery', title: 'Сохраните доступ к сообщениям', description: 'Настройте восстановление, чтобы не потерять доступ при смене устройства.', action: 'recovery' };
  return { kind: 'ready', title: 'Это устройство подтверждено', description: 'Новые сообщения защищены сквозным шифрованием. Доступ на другом устройстве подтверждается отдельно.', action: null };
}

export function matrixDeviceDisplayName({ platform = 'web', userAgent = '' } = {}) {
  if (platform === 'ios') return 'iOS · приложение VOLNA';
  if (platform === 'android') return 'Android · приложение VOLNA';
  if (platform === 'native') return 'Приложение VOLNA';
  const device = /iPhone/i.test(userAgent) ? 'iPhone' : /iPad/i.test(userAgent) ? 'iPad' : /Android/i.test(userAgent) ? 'Android' : /Windows/i.test(userAgent) ? 'Windows' : /Macintosh/i.test(userAgent) ? 'Mac' : /Linux/i.test(userAgent) ? 'Linux' : 'Браузер';
  const browser = /Edg(?:e|A|iOS)?\//i.test(userAgent) ? 'Edge' : /(?:Firefox|FxiOS)\//i.test(userAgent) ? 'Firefox' : /(?:Chrome|CriOS)\//i.test(userAgent) ? 'Chrome' : /Version\/.*Safari/i.test(userAgent) ? 'Safari' : null;
  return browser ? `${device} · ${browser}` : device;
}

export function matrixDeviceLabel(device, devices) {
  const name = device.displayName?.trim();
  const generic = !name || /^VOLNA (Web\/PWA|Native)$/.test(name);
  const base = generic ? name === 'VOLNA Native' ? 'Приложение VOLNA' : 'Браузер' : name;
  const peers = devices.filter((item) => item.displayName === device.displayName).sort((a, b) => a.deviceId.localeCompare(b.deviceId));
  return peers.length > 1 ? `${base} · ${peers.findIndex((item) => item.deviceId === device.deviceId) + 1}` : base;
}
