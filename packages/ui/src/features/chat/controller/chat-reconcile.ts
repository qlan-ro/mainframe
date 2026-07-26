/**
 * Optimistic-send reconcile helpers — pure functions the controller composes.
 *
 * Reconcile = count-aware + server-authoritative (judo-A): each confirmed
 * server user-message clears at most one optimistic pending, oldest-first, by a
 * normalized-text multiset. No time window, no empty-text wildcard, no
 * over-clearing of legitimate duplicate sends. The single live `message.added`
 * and the full history re-seed feed the SAME matcher (one message vs many).
 */
import type { AppendMessage } from '@assistant-ui/react';
import type { DisplayContent } from '@qlan-ro/mainframe-types';
import type { PendingUserMessage } from './chat-thread-state';
import { toUploadItems } from '../composer/attachment-adapter';
import type { UploadAttachmentItem } from '../../../lib/api/attachments';

let localIdCounter = 0;

export function createLocalId(prefix: string): string {
  localIdCounter += 1;
  return `${prefix}_${Date.now().toString(36)}${localIdCounter.toString(36)}`;
}

export function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

// Sentinel key for attachment-only (no meaningful text) messages, so an empty
// server text can never wildcard-match a text-bearing pending.
const ATTACHMENT_KEY = '\0attachment';

export function reconcileKey(text: string): string {
  const fp = normalizeText(text);
  return fp.length > 0 ? fp : ATTACHMENT_KEY;
}

export function contentKey(content: DisplayContent[]): string {
  const textBlock = content.find((c): c is DisplayContent & { type: 'text' } => c.type === 'text');
  return reconcileKey(textBlock?.text ?? '');
}

/** Parsed optimistic-send input: trimmed text + the daemon upload payload. */
export interface SendInput {
  text: string;
  uploadItems: UploadAttachmentItem[];
}

/**
 * Extract the trimmed text + upload items from an aui AppendMessage. Returns
 * null for a non-user message or an empty send (no text and no attachments), so
 * the controller can early-return without dispatching anything.
 */
export function parseSendInput(message: AppendMessage): SendInput | null {
  if (message.role !== 'user') return null;
  const textPart = message.content.find((p) => p.type === 'text');
  const text = textPart?.type === 'text' ? textPart.text.trim() : '';
  const uploadItems = toUploadItems(message.attachments);
  if (!text && uploadItems.length === 0) return null;
  return { text, uploadItems };
}

/** Build the optimistic pending user-message for a send. */
export function buildPendingMessage(chatId: string, text: string): PendingUserMessage {
  return {
    clientId: createLocalId('local'),
    chatId,
    text,
    createdAt: Date.now(),
    status: 'pending',
  };
}

export function reconcilePendings(
  pendings: Readonly<Record<string, PendingUserMessage>>,
  serverMessages: readonly { content: DisplayContent[] }[],
): string[] {
  const remaining = new Map<string, number>();
  for (const m of serverMessages) {
    const k = contentKey(m.content);
    remaining.set(k, (remaining.get(k) ?? 0) + 1);
  }
  const matched: string[] = [];
  const oldestFirst = Object.values(pendings)
    .filter((p): p is PendingUserMessage => p.status === 'pending')
    .sort((a, b) => a.createdAt - b.createdAt);
  for (const p of oldestFirst) {
    const k = reconcileKey(p.text);
    const n = remaining.get(k) ?? 0;
    if (n > 0) {
      remaining.set(k, n - 1);
      matched.push(p.clientId);
    }
  }
  return matched;
}
