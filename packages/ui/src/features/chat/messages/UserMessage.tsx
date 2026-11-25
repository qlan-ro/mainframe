/**
 * UserMessage — the user turn, on the v2 chat kit.
 *
 * The shell is `Message align="end"` › `MessageContent` › `Bubble` ›
 * `BubbleContent`: aui supplies the message state, the kit supplies the pixels.
 * The bubble is neutral (T1), 14 px corners, at most 85% of the column.
 *
 * Variants rendered by this file:
 *   - Plain text    → CoolCard + ReadMoreBubble + markdown + @mention chips
 *   - /command|skill → CoolCard + leading pill badge (metadata-driven) + user text
 *   - Steered       → a line under the bubble (C9)
 *   - Inline images → thumbnail row (regular image parts)
 *   - Attachments   → UserAttachments: file pills + clickable capture-image
 *     tiles with their selector context (native message.attachments)
 *   - Plan approved → PlanApprovedMarker, when the daemon sent a clear-context
 *     `Implement the following plan:` turn (see plan-message.ts)
 *   - Agent-sent turn → AgentMessageCard, when another chat's agent wrote it
 *     through the orchestration MCP server (see markers/agent-message.ts)
 *
 * Inline directives (@mention, @session, /command) render through
 * user-directive-renderers.tsx; session reference lines are stripped here so the
 * agent-facing preamble never reaches the transcript.
 * The SlashPill leading badge is kept metadata-driven: when daemon metadata carries
 * `command.name`, we render the pill before the text body. If no metadata exists
 * but the text itself starts with `/command`, the formatter will emit a command
 * chip — so both paths produce a chip, just at different levels.
 */
import { memo, useMemo, type ReactNode } from 'react';
import { MessagePrimitive, useAuiState } from '@assistant-ui/react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { Wrench, Zap } from 'lucide-react';
import { Message, MessageContent } from '@/components/ui/message';
import { Bubble, BubbleContent } from '@/components/ui/bubble';
import { Badge } from '@/components/ui/badge';
import { urlTransform, remarkAppLinks } from '../parts/markdown-url-transform';
import { useMainframeMeta } from '../view-model/message-meta';
import { MessageFooter } from './MessageFooter';
import { useIsNestedTranscript } from './nested-transcript-context';
import { ReadMoreBubble } from './ReadMoreBubble';
import { InlineImageThumbs } from './InlineImageThumbs';
import { userMarkdownComponents } from './user-directive-renderers';
import { visibleMessageText } from '../markers/message-markers';
import { useChatSkills, resolveSkillName } from '@/features/skills/use-chat-skills';
import { UserAttachments } from './UserAttachments';
import { ReviewCommentCard } from './ReviewCommentCard';
import { PlanApprovedMarker } from './PlanApprovedMarker';
import { parsePlanUserMessage } from './plan-message';
import { AgentMessageCard } from './AgentMessageCard';
import { SendFailureNotice } from './SendFailureNotice';
import { parseAgentText } from '../markers/agent-message';

// ─────────────────────────────────────────────────────────────────────────────
// Remark plugin set (stable reference — never define inline)
// ─────────────────────────────────────────────────────────────────────────────

const REMARK_PLUGINS = [remarkGfm, remarkAppLinks, remarkBreaks];

// ─────────────────────────────────────────────────────────────────────────────
// Bubble shell
// ─────────────────────────────────────────────────────────────────────────────

function UserBubble({ children }: { children: ReactNode }) {
  return (
    <Bubble variant="muted" align="end" className="mf-tr-bubble max-w-[85%]">
      <BubbleContent data-testid="chat-user-bubble" className="mf-prose rounded-[14px] px-3.5 py-2 wrap-anywhere">
        {children}
      </BubbleContent>
    </Bubble>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Slash (command / skill) badge — metadata-driven leading badge
// ─────────────────────────────────────────────────────────────────────────────

interface SlashPillProps {
  kind: 'command' | 'skill';
  name: string;
}

/** The GLYPH carries the kind (wrench = command, zap = skill); one Badge variant
 *  serves both, so the two `mf-directive-*` tints are gone. */
function SlashPill({ kind, name }: SlashPillProps) {
  const Icon = kind === 'command' ? Wrench : Zap;
  return (
    <Badge variant="secondary" className="mr-2 align-middle font-mono font-semibold">
      <Icon data-icon="inline-start" />/{name}
    </Badge>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

function UserMessageImpl() {
  const meta = useMainframeMeta();
  const nested = useIsNestedTranscript();

  // H6: s.message is typed as MessageState (= ThreadMessage & extras) via the
  // ScopeRegistry augmentation in @assistant-ui/core — no cast needed.
  const messageId = useAuiState((s) => s.message.id);

  // Resolve text: prefer cleanText (pipeline-stripped) over raw part text.
  // Read the stable content ref; derive text outside useAuiState to avoid a
  // fresh-array reference on every render triggering a getSnapshot loop.
  const rawText = useAuiState((s) => {
    const textPart = s.message.content.find((p) => p.type === 'text');
    return textPart && 'text' in textPart ? (textPart.text as string) : '';
  });

  // Native image parts projected from DisplayContent images in convert-message.
  // Select the stable content ref, then derive — a filter inside useAuiState
  // returns a fresh array each render and loops (getSnapshot).
  const content = useAuiState((s) => s.message.content);
  const imageParts = useMemo(
    () =>
      content.filter((p): p is { type: 'image'; image: string } => p.type === 'image' && typeof p.image === 'string'),
    [content],
  );

  // Reference lines are addressed to the agent, not the reader — the chips in
  // the body already say which sessions were referenced.
  const cleanText = visibleMessageText(meta.cleanText ?? rawText);

  // ── Command / skill resolution from metadata ──────────────────────────────
  const { skills } = useChatSkills();
  const metaCmd = meta.command;
  let slashProps: { kind: 'command' | 'skill'; name: string; userText: string } | null = null;
  if (metaCmd?.name) {
    const isCommand = metaCmd.source === 'commands';
    slashProps = {
      kind: isCommand ? 'command' : 'skill',
      name: isCommand ? metaCmd.name : resolveSkillName(metaCmd.name, skills),
      // A slash command keeps line 1, so its references sit below it and survive
      // the cleanText strip above. Idempotent — the fallback is already stripped.
      userText: visibleMessageText(metaCmd.userText ?? cleanText),
    };
  }

  // Diff-review sends: the file card IS the message (the projection dropped the
  // raw text), so it takes the bubble's place rather than stacking beside one.
  const reviewCard = meta.reviewComment ? <ReviewCommentCard review={meta.reviewComment} /> : null;

  // Clear-context "Implementing plan" turn: the daemon prefixes the plan with
  // `Implement the following plan:` — render the approved plan's marker in place
  // of the plain bubble (never a command/review turn, never queued).
  const planBody = !slashProps && !meta.reviewComment ? parsePlanUserMessage(cleanText) : null;
  // A message another agent sent (chat_send/launch, a task prompt, task
  // results) renders as a card naming the sender, never as the user's bubble.
  const agentText = !slashProps && !meta.reviewComment && !planBody ? parseAgentText(cleanText) : null;

  const body =
    planBody || agentText ? null : slashProps ? (
      <ReadMoreBubble>
        <SlashPill kind={slashProps.kind} name={slashProps.name} />
        {slashProps.userText}
      </ReadMoreBubble>
    ) : cleanText ? (
      <ReadMoreBubble>
        <Markdown remarkPlugins={REMARK_PLUGINS} urlTransform={urlTransform} components={userMarkdownComponents}>
          {cleanText}
        </Markdown>
      </ReadMoreBubble>
    ) : null;

  // H5: surface send failures. `error` is set by projectPendingMessage when
  // status === 'failed'; SendFailureNotice offers Retry (and the remedy).
  const sendError = meta.error;

  // Capture context + attachments + image thumbs, stacked below the bubble.
  const extras = (
    <>
      <UserAttachments />
      <InlineImageThumbs parts={imageParts} />
    </>
  );
  return (
    <MessagePrimitive.Root
      data-testid="chat-user-message"
      data-message-id={messageId}
      data-search-item-id={messageId}
      data-tr-message
      className="pt-1 pb-1"
    >
      <Message align="end">
        <MessageContent>
          {reviewCard && <div data-text-part>{reviewCard}</div>}

          {planBody ? (
            // Full width, so the marker centres on the spine rather than on the
            // end-aligned column.
            <div className="w-full">
              <PlanApprovedMarker plan={planBody} messageId={messageId} />
            </div>
          ) : agentText ? (
            <div data-text-part className="w-full">
              <AgentMessageCard parsed={agentText} messageId={messageId} />
            </div>
          ) : (
            <>
              {body && <UserBubble>{body}</UserBubble>}
              {extras}
              {meta.steered && (
                <span data-testid="chat-user-steered" className="text-xs text-muted-foreground">
                  Steered into the running turn
                </span>
              )}
            </>
          )}

          {sendError != null && (
            <SendFailureNotice
              error={sendError}
              clientId={meta.clientId}
              remedy={meta.remedy}
              attachmentsRestored={meta.attachmentsRestored}
            />
          )}
        </MessageContent>
      </Message>
      {!meta.queued && !planBody && !nested && <MessageFooter user />}
    </MessagePrimitive.Root>
  );
}

export const UserMessage = memo(UserMessageImpl);
UserMessage.displayName = 'UserMessage';
