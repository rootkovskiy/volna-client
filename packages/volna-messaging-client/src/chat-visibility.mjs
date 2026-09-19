// Server-owned retention metadata carries opaque identifiers, never message content.
// It may suppress availability; it never authenticates or manufactures plaintext.
export function normalizeChatVisibility(value) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || typeof value.hasDeletions !== 'boolean'
      || !Array.isArray(value.deletedMessageIds) || value.deletedMessageIds.length > 500
      || value.deletedMessageIds.some(id => typeof id !== 'string' || !/^[A-Za-z0-9_-]{8,80}$/.test(id))
      || (value.clearedBefore !== null && (typeof value.clearedBefore !== 'string' || !Number.isFinite(Date.parse(value.clearedBefore))))) {
    throw new Error('Не удалось проверить удалённые сообщения');
  }
  return { hasDeletions: value.hasDeletions, clearedBefore: value.clearedBefore, deletedMessageIds: [...value.deletedMessageIds] };
}

export function visibleChatMessages(messages, state) {
  const deleted = new Set(state?.deletedMessageIds ?? []);
  const cutoff = state?.clearedBefore ? Date.parse(state.clearedBefore) : -Infinity;
  return messages.filter(message => !message.deletedAt && !deleted.has(message.id) && Date.parse(message.createdAt) > cutoff);
}
