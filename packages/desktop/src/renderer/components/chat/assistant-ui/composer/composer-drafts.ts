import type { Capture } from '../../../../store/sandbox.js';

export interface Draft {
  text: string;
  attachments: Array<{ type: string; name: string; contentType?: string; content: unknown[] }>;
  captures: Array<Omit<Capture, 'id'>>;
}

const drafts = new Map<string, Draft>();

export function getDraft(chatId: string): Draft | undefined {
  return drafts.get(chatId);
}

export function saveDraft(chatId: string, draft: Draft): void {
  const hasContent = draft.text.trim() !== '' || draft.attachments.length > 0 || draft.captures.length > 0;
  if (!hasContent) return;
  drafts.set(chatId, draft);
}

export function deleteDraft(chatId: string): void {
  drafts.delete(chatId);
}
