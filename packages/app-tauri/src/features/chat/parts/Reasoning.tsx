'use client';

/**
 * Reasoning — thin feature adapter for the AssistantMessage reasoning case.
 *
 * Drops into AssistantMessage's `case 'reasoning'` branch. Renders the warm-chrome
 * ReasoningRoot/Trigger/Content compound with the reasoning text as plain-text body.
 *
 * Markdown rendering is intentionally skipped: the reasoning stream is raw
 * model output that may contain partial/malformed markdown mid-stream. Rendering
 * it as plain text is stable and matches the design intent (muted italic body).
 * NOTE: if full markdown rendering is needed here in the future, import
 * MarkdownText from '@/features/chat/parts/markdown-text' and swap the <p>.
 *
 * Duration: the native `useAuiState` is used by the sibling ReasoningGroup
 * compound (GroupedParts path). This leaf carries no duration — it accepts only
 * the text prop that the GroupedParts ReasoningGroupImpl passes via `children`.
 */
import {
  ReasoningRoot,
  ReasoningTrigger,
  ReasoningContent,
  ReasoningText,
} from '@/components/ui/assistant-ui/reasoning';

interface ReasoningProps {
  /** Raw reasoning text from the message part. */
  text: string;
}

export function Reasoning({ text }: ReasoningProps) {
  if (!text) return null;

  return (
    <ReasoningRoot defaultOpen={false}>
      <ReasoningTrigger />
      <ReasoningContent>
        <ReasoningText>
          <p className="whitespace-pre-wrap">{text}</p>
        </ReasoningText>
      </ReasoningContent>
    </ReasoningRoot>
  );
}
