/**
 * UserMessage — the "cool card" user turn for the warm-chrome theme.
 *
 * Visual contract (§5.1, component-map.md):
 *   - `--mf-um-card` gradient background  (set via inline style — it's a gradient,
 *     not a solid color, so `bg-*` Tailwind utilities can't address it)
 *   - `--mf-um-edge` hairline border
 *   - `--mf-um-ink` text color
 *   - radius `xl` (13px)
 *   - 0.5px box-shadow for soft lift
 *   - right-aligned, max-width 75% of thread
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
 * @mention inline rendering uses the native `createDirectiveText` pattern from
 * @assistant-ui/react via our `mainframeUserFormatter` (see user-directives.ts).
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
import { cn } from '@/lib/utils';
import { markdownComponents } from '../parts/markdown-text';
import { urlTransform, remarkAppLinks } from '../parts/markdown-url-transform';
import { useMainframeMeta } from '../view-model/message-meta';
import { useChatExtras, useChatQueuedMessages } from '../runtime/use-chat-thread-runtime';
import { ReadMoreBubble } from './ReadMoreBubble';
import { QueuedUserTurn } from './QueuedUserTurn';
import { queuePosition } from './queue-position';
import { InlineImageThumbs } from './InlineImageThumbs';
import { createDirectiveText } from '@/components/ui/assistant-ui/directive-text';
import { mainframeUserFormatter } from './user-directives';
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
// Directive-text inline renderer (replaces highlightMentions + MentionParagraph)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * TextMessagePartComponent for user text — renders @mentions as plain accent
 * text (no box/icon, design 7.1), and a leading /command as a boxed chip if
 * present in the raw text.
 */
const UserDirectiveText = createDirectiveText(mainframeUserFormatter, {
  iconMap: {
    command: Wrench,
  },
  plainTypes: ['mention'],
});

/**
 * `<p>` override for react-markdown that feeds string children through the
 * directive formatter.  Non-string children (bold, italic, etc.) pass through
 * unchanged — identical to the prior highlightMentions guard.
 */
function DirectiveParagraph({ children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  if (typeof children !== 'string') {
    return <p {...props}>{children}</p>;
  }
  return (
    <p {...props}>
      <UserDirectiveText type="text" text={children} status={{ type: 'complete' }} />
    </p>
  );
}

const userMarkdownComponents = { ...markdownComponents, p: DirectiveParagraph };

// ─────────────────────────────────────────────────────────────────────────────
// Cool-card shell
// ─────────────────────────────────────────────────────────────────────────────

const CARD_STYLE = {
  background: 'var(--mf-um-card)',
  boxShadow: 'var(--mf-shadow-user-card)',
} as const;

interface CoolCardProps {
  children: ReactNode;
  className?: string;
}

function CoolCard({ children, className }: CoolCardProps) {
  return (
    <div
      style={CARD_STYLE}
      className={cn(
        'relative max-w-[470px] rounded-xl border-[0.5px] px-[15px] py-[10px]',
        'border-mf-um-edge text-mf-um-ink',
        'text-body leading-loose tracking-tight',
        className,
      )}
    >
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Slash (command / skill) pill — metadata-driven leading badge
// ─────────────────────────────────────────────────────────────────────────────

interface SlashPillProps {
  kind: 'command' | 'skill';
  name: string;
}

function SlashPill({ kind, name }: SlashPillProps) {
  const Icon = kind === 'command' ? Wrench : Zap;
  const colorClass = kind === 'command' ? 'text-primary' : 'text-mf-directive-skill';
  const bgClass = kind === 'command' ? 'bg-mf-directive-command-tint' : 'bg-mf-directive-skill-tint';

  return (
    // Design 7.5: padding 2px 8px 2px 6px, gap 5, marginRight 8 — py-0.5 (2px)
    // and pl-1.5 (6px) already match the compressed scale; mr-4/pr-4 hit the
    // exact 8px tokens, gap-[5px] has no matching integer step (arbitrary).
    <span className={cn('mr-4 inline-flex items-center gap-[5px] rounded-md py-0.5 pl-1.5 pr-4', bgClass)}>
      <Icon size={12} className={colorClass} />
      <span className={cn('font-mono text-label font-semibold', colorClass)}>/{name}</span>
    </span>
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

  const cleanText = meta.cleanText ?? rawText;

  // ── Command / skill resolution from metadata ──────────────────────────────
  const { skills } = useChatSkills();
  const metaCmd = meta.command;
  let slashProps: { kind: 'command' | 'skill'; name: string; userText: string } | null = null;
  if (metaCmd?.name) {
    const isCommand = metaCmd.source === 'commands';
    slashProps = {
      kind: isCommand ? 'command' : 'skill',
      name: isCommand ? metaCmd.name : resolveSkillName(metaCmd.name, skills),
      userText: metaCmd.userText ?? cleanText,
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
    <MessagePrimitive.Root
      data-testid="chat-user-message"
      data-message-id={messageId}
      // Design 7.7: marginBottom 16 to the next transcript element — pb-6
      // hits the compressed 16px token; pt-2 (4px) is the existing top gap.
      className="flex flex-col items-end gap-2 pt-2 pb-6"
    >
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
        <PlanBubble plan={planBody} />
      ) : (
        <>
          {body && <CoolCard>{body}</CoolCard>}
          {extras}
        </>
      )}

      {sendError != null && (
        <div className="flex items-center gap-2">
          <span data-testid="chat-user-message-send-failed" className="text-label text-destructive">
            Failed to send
          </span>
          {retryClientId && chatExtras && (
            <button
              type="button"
              data-testid="chat-user-message-retry"
              onClick={() => void chatExtras.retryMessage(retryClientId)}
              className="text-label font-medium text-primary hover:underline"
            >
              Retry
            </button>
          )}
        </div>
      )}
    </MessagePrimitive.Root>
  );
}

export const UserMessage = memo(UserMessageImpl);
UserMessage.displayName = 'UserMessage';
