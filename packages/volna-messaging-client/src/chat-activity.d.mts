import type { MessagingMessage } from './messaging-surface-controller.mjs';
export type ChatPresence = { onlineUntil: number | null; lastSeenAt: string | null };
export type ChatActivity = { presence: ChatPresence | null; partnerLastReadAt: string | null };
export declare function formatPresence(presence: ChatPresence | null | undefined, now?: number): string;

