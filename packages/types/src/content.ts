/**
 * Leaf content variants shared verbatim between the transcript-form
 * `MessageContent` (chat.ts) and the UI-render-form `DisplayContent`
 * (display.ts). These four are byte-identical in both unions; factoring them
 * here keeps the two unions in lockstep at the type level so a change to a
 * leaf variant cannot silently diverge between transcript and display.
 *
 * `parentToolUseId` tags a block as originating from a subagent stream event
 * (see the note on `MessageContent` in chat.ts).
 */
export type LeafContent =
  | { type: 'text'; text: string; parentToolUseId?: string }
  | { type: 'thinking'; thinking: string; parentToolUseId?: string }
  | { type: 'image'; mediaType: string; data: string; parentToolUseId?: string }
  | { type: 'skill_loaded'; skillName: string; path: string; content: string; parentToolUseId?: string };
