/**
 * UserMessage — the user turn, on the v2 chat kit.
 *
 * The shell is `Message align="end"` › `MessageContent` › `Bubble variant="tinted"`
 * › `BubbleContent`: aui supplies the message state, the kit supplies the pixels.
 * `tinted` is the kit's soft-primary fill — the v2 analogue of the warm-chrome
 * `--mf-um-card` gradient this replaced. The 470px cap is kept over the kit's
 * relative `max-w-[80%]`: at this column width 80% measures ~582px, and the
 * absolute cap is a deliberate app value (an e2e case pins it).
 *
 * Variants rendered by this file:
 *   - Plain text    → CoolCard + ReadMoreBubble + markdown + @mention chips
 *   - /command|skill → CoolCard + leading pill badge (metadata-driven) + user text
 *   - Queued badge  → quiet animated footer badge above the card
 *   - Inline images → thumbnail row (regular image parts)
 *   - Attachments   → UserAttachments: file pills + clickable capture-image
 *     tiles with their selector context (native message.attachments)
 *   - Implementing plan → PlanBubble, when the daemon sent a clear-context
 *     `Implement the following plan:` turn (see plan-message.ts)
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
import { useChatExtras, useChatQueuedMessages } from '../runtime/chat-extras';
import { ReadMoreBubble } from './ReadMoreBubble';
import { QueuedUserTurn } from './QueuedUserTurn';
import { queuePosition } from './queue-position';
import { InlineImageThumbs } from './InlineImageThumbs';
import { userMarkdownComponents } from './user-directive-renderers';
import { visibleMessageText } from '../markers/message-markers';
import { useChatSkills, resolveSkillName } from '@/features/skills/use-chat-skills';
import { UserAttachments } from './UserAttachments';
import { ReviewCommentCard } from './ReviewCommentCard';
import { PlanBubble } from './PlanBubble';
import { parsePlanUserMessage } from './plan-message';

// ─────────────────────────────────────────────────────────────────────────────
// Remark plugin set (stable reference — never define inline)
// ─────────────────────────────────────────────────────────────────────────────

const REMARK_PLUGINS = [remarkGfm, remarkAppLinks, remarkBreaks];

// ─────────────────────────────────────────────────────────────────────────────
// Bubble shell
// ─────────────────────────────────────────────────────────────────────────────

function UserBubble({ children }: { children: ReactNode }) {
  return (
    <Bubble variant="tinted" align="end" className="max-w-[470px]">
      <BubbleContent data-testid="chat-user-bubble">{children}</BubbleContent>
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
  const chatExtras = useChatExtras();
  const isQueued = meta.queued === true;
  // FIFO position/total for the queued footer (design 7.2: UMQueuedStack).
  // Only needed while queued — the hook is cheap (memoized off extras.queued).
  const queuedRefs = useChatQueuedMessages();

  // H6: s.message is typed as MessageState (= ThreadMessage & extras) via the
  // ScopeRegistry augmentation in @assistant-ui/core — no cast needed.
  const messageId = useAuiState((s) => s.message.id);

  const { position: queuePos, total: queueTotal } = useMemo(
    () => queuePosition(queuedRefs, messageId),
    [queuedRefs, messageId],
  );

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
  // Native attachments (file pills + capture image tiles) live on
  // message.attachments (built in convert-message).
  const attachmentCount = useAuiState((s) => s.message.attachments?.length ?? 0);

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
  // `Implement the following plan:` — render the PlanBubble in place of the
  // plain bubble (never a command/review turn, never queued).
  const planBody = !slashProps && !meta.reviewComment ? parsePlanUserMessage(cleanText) : null;

  const body = planBody ? null : slashProps ? (
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
  // status === 'failed'; Retry re-sends the pending's text via the controller
  // (text-only — attachments are not re-uploaded).
  const sendError = meta.error;
  const retryClientId = meta.clientId;

  // Capture context + attachments + image thumbs. For a queued turn these ride
  // INSIDE QueuedUserTurn (above its meta footer, with the ghost treatment —
  // artboard "Queued + attachment"); for a sent turn they stack as siblings
  // below the cool-card. Built once so both paths share the exact same content.
  const extras = (
    <>
      <UserAttachments />
      <InlineImageThumbs parts={imageParts} />
    </>
  );
  // Render the queued shell when there is a text body OR meaningful extras, so an
  // attachment/image/capture-only queued send is never dropped (codex review).
  const hasExtras = imageParts.length > 0 || attachmentCount > 0;

  return (
    <MessagePrimitive.Root data-testid="chat-user-message" data-message-id={messageId} className="pt-1 pb-4">
      <Message align="end">
        <MessageContent>
          {reviewCard}

          {isQueued ? (
            (body || hasExtras) && (
              <QueuedUserTurn
                messageId={messageId}
                content={cleanText}
                extrasSlot={extras}
                position={queuePos}
                total={queueTotal}
              >
                {body}
              </QueuedUserTurn>
            )
          ) : planBody ? (
            // The gate shell's max-width cap should govern the record's width,
            // not MessageContent's end-alignment of its slotted children — an
            // explicit full-width wrapper escapes the shrink-to-fit sizing.
            <div className="w-full">
              <PlanBubble plan={planBody} clearedContext executionMode={chatExtras?.state.chatConfig?.permissionMode} />
            </div>
          ) : (
            <>
              {body && <UserBubble>{body}</UserBubble>}
              {extras}
            </>
          )}

          {sendError != null && (
            <div className="flex flex-col items-end gap-1">
              <div className="flex items-center gap-2">
                <span data-testid="chat-user-message-send-failed" className="text-xs text-destructive">
                  Failed to send
                </span>
                {/* Retry re-sends the text only, so it would silently drop the
                    attachments the runtime just put back into the composer. */}
                {retryClientId && chatExtras && !meta.attachmentsRestored && (
                  <button
                    type="button"
                    data-testid="chat-user-message-retry"
                    onClick={() => void chatExtras.retryMessage(retryClientId)}
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    Retry
                  </button>
                )}
              </div>
              <p
                data-testid="chat-user-message-send-error"
                className="max-w-[470px] wrap-break-word text-right text-xs text-muted-foreground"
              >
                {sendError}
              </p>
            </div>
          )}
        </MessageContent>
      </Message>
    </MessagePrimitive.Root>
  );
}

export const UserMessage = memo(UserMessageImpl);
UserMessage.displayName = 'UserMessage';
