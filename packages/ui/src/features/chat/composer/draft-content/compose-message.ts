/**
 * Puts a draft's captures and code annotations into the message (C14).
 *
 * Captures keep the preview's own encoding (`format-captures.ts`), so a sent
 * one shows as the tile it always has. Code annotations keep the review
 * comment's (`format-line-comment.ts`): alone, and for one file, the message
 * is the review card; beside anything else they follow the text as Markdown.
 */
import type { CompleteAttachment } from '@assistant-ui/react';
import { formatReview } from '@/lib/editor/format-line-comment';
import { formatCaptures } from '@/features/run/format-captures';
import { SANDBOX_CAPTURE_SENTINEL } from '../../markers/message-markers';
import type { DraftCapture, DraftCodeNote, DraftItem } from './draft-content-store';

const CODE_NOTES_HEADING = '**Code annotations**';

function reviewsByFile(notes: readonly DraftCodeNote[]): string[] {
  const byFile = new Map<string, DraftCodeNote[]>();
  for (const note of notes) byFile.set(note.filePath, [...(byFile.get(note.filePath) ?? []), note]);
  return [...byFile].map(([filePath, ofFile]) =>
    formatReview(
      filePath,
      [...ofFile]
        .sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine)
        .map(({ startLine, endLine, lineContent, note }) => ({ startLine, endLine, lineContent, comment: note })),
    ).trim(),
  );
}

function withCodeNotes(body: string, notes: readonly DraftCodeNote[]): string {
  if (notes.length === 0) return body;
  const reviews = reviewsByFile(notes);
  // The card parser reads the whole message as one file's review, so anything
  // else (the user's text, a second file) must not start with its header.
  if (body === '' && reviews.length === 1) return reviews[0]!;
  return [body, CODE_NOTES_HEADING, ...reviews].filter(Boolean).join('\n\n');
}

function withCaptures(body: string, markdown: string): string {
  if (markdown === '') return body;
  if (body === '') return markdown;
  // A leading `/` is the CLI's only slash-command signal, so the command keeps
  // line 1. The block's marker only counts at the start of a message: below a
  // command the block is left as the readable list it is.
  if (body.startsWith('/')) return `${body}\n\n${markdown.slice(SANDBOX_CAPTURE_SENTINEL.length).trimStart()}`;
  return `${markdown}\n\n${body}`;
}

const isCapture = (item: DraftItem): item is DraftCapture => item.kind === 'capture';
const isCodeNote = (item: DraftItem): item is DraftCodeNote => item.kind === 'code';

export interface ComposedMessage {
  body: string;
  /** The captures' images, in the order their rows name them. */
  attachments: CompleteAttachment[];
  captures: DraftCapture[];
}

export function composeMessage(text: string, items: readonly DraftItem[]): ComposedMessage {
  const captures = items.filter(isCapture);
  const { markdown, attachments } = formatCaptures(
    captures.map(({ note, ...rest }) => ({ ...rest, annotation: note })),
  );
  return {
    body: withCaptures(withCodeNotes(text, items.filter(isCodeNote)), markdown),
    attachments: attachments.map((file, index) => ({
      id: captures[index]!.id,
      type: 'image',
      name: file.name,
      contentType: file.mediaType,
      content: [{ type: 'image', image: captures[index]!.imageDataUrl }],
      status: { type: 'complete' },
    })),
    captures,
  };
}
