export function matrixStoreErrorMessage(error) {
  const code = error?.cause?.code ?? error?.code;
  if (code === 'matrix_store_busy') return 'Сообщения открыты в другой вкладке VOLNA. Закройте её и нажмите «Повторить».';
  if (code === 'matrix_store_retired') return 'Сессия сообщений в этой вкладке завершена. Обновите страницу, чтобы продолжить.';
  if (code === 'matrix_store_unavailable') return 'Браузер не предоставил безопасный доступ к хранилищу сообщений. Проверьте настройки хранения данных или обновите браузер.';
  return null;
}
