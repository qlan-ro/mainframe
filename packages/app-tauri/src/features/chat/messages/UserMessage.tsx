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
 *   - Inline images → thumbnail row
 *   - File attachments → UserAttachments (native message.attachments)
 *   - Sandbox captures → CaptureContextRow (sentinel parsed in the projection)
 *   - Code review   → CodeRefCard (render-only; producer lands with the editor)
 *
 * @mention inline rendering uses the native `createDirectiveText` pattern from
 * @assistant-ui/react via our `mainframeUserFormatter` (see user-directives.ts).
 * The SlashPill leading badge is kept metadata-driven: when daemon metadata carries
 * `command.name`, we render the pill before the text body. If no metadata exists
 * but the text itself starts with `/command`, the formatter will emit a command
 * chip — so both paths produce a chip, just at different levels.
 *
 * Deferred (TODO-leaf — do NOT build here):
 *   - PLAN_PREFIX "Implementing plan" card
 */
import { memo, useMemo, type ReactNode } from 'react';
import { MessagePrimitive, useAuiState } from '@assistant-ui/react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { AtSign, Wrench, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { markdownComponents } from '../parts/markdown-text';
import { urlTransform, remarkAppLinks } from '../parts/markdown-url-transform';
import { useMainframeMeta } from '../view-model/message-meta';
import { ReadMoreBubble } from './ReadMoreBubble';
import { QueuedUserTurn } from './QueuedUserTurn';
import { ZoomableImage } from '../parts/ZoomableImage';
import { createDirectiveText } from '@/components/ui/assistant-ui/directive-text';
import { mainframeUserFormatter } from './user-directives';
import { useChatSkills, resolveSkillName } from '@/features/skills/use-chat-skills';
import { UserAttachments } from './UserAttachments';
import { CaptureContextRow } from './CaptureContextRow';
import { CodeRefCard } from './CodeRefCard';

// ─────────────────────────────────────────────────────────────────────────────
// Remark plugin set (stable reference — never define inline)
// ─────────────────────────────────────────────────────────────────────────────

const REMARK_PLUGINS = [remarkGfm, remarkAppLinks, remarkBreaks];

// ─────────────────────────────────────────────────────────────────────────────
// Directive-text inline renderer (replaces highlightMentions + MentionParagraph)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * TextMessagePartComponent for user text — renders @mentions as accent chips,
 * optionally a leading /command chip if present in the raw text.
 */
const UserDirectiveText = createDirectiveText(mainframeUserFormatter, {
  iconMap: {
    mention: AtSign,
    command: Wrench,
  },
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
        'relative max-w-[75%] rounded-xl border-[0.5px] px-[15px] py-[10px]',
        'border-mf-um-edge text-mf-um-ink',
        'text-body leading-relaxed tracking-normal',
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
  const bgClass = kind === 'command' ? 'bg-mf-selection' : 'bg-mf-directive-skill-tint';

  return (
    <span className={cn('mr-2 inline-flex items-center gap-1 rounded-md py-0.5 pl-1.5 pr-2', bgClass)}>
      <Icon size={12} className={colorClass} />
      <span className={cn('font-mono text-caption font-semibold', colorClass)}>/{name}</span>
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Image thumbnails
// ─────────────────────────────────────────────────────────────────────────────

interface InlineImageThumbsProps {
  parts: Array<{ type: 'image'; image: string }>;
}

function InlineImageThumbs({ parts }: InlineImageThumbsProps) {
  if (parts.length === 0) return null;
  return (
    <div className="flex flex-wrap justify-end gap-2">
      {parts.map((p) => (
        <ZoomableImage
          key={p.image}
          src={p.image}
          className="size-16 rounded-[11px] border-[0.5px] border-border object-cover shadow-sm"
        />
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

function UserMessageImpl() {
  const meta = useMainframeMeta();
  const isQueued = meta.queued === true;

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
  const imageSrcs = useMemo(() => imageParts.map((p) => p.image), [imageParts]);
  // Native file attachments live on message.attachments (built in convert-message).
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

  // TODO(leaf): PLAN_PREFIX card ("Implementing plan") — deferred to plan-card leaf

  const captureRow =
    meta.captures && meta.captures.length > 0 ? (
      <CaptureContextRow rows={meta.captures} imageSrcs={imageSrcs} previews={meta.attachmentPreviews} />
    ) : null;
  const codeRefCard = meta.codeRef ? <CodeRefCard codeRef={meta.codeRef} /> : null;

  const body = slashProps ? (
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
  // status === 'failed'. Retry action is out of scope — that requires controller
  // wiring that doesn't exist yet (follow-up TODO).
  const sendError = meta.error;

  // Capture context + attachments + image thumbs. For a queued turn these ride
  // INSIDE QueuedUserTurn (above its meta footer, with the ghost treatment —
  // artboard "Queued + attachment"); for a sent turn they stack as siblings
  // below the cool-card. Built once so both paths share the exact same content.
  const extras = (
    <>
      {captureRow}
      <UserAttachments />
      <InlineImageThumbs parts={imageParts} />
    </>
  );
  // Render the queued shell when there is a text body OR meaningful extras, so an
  // attachment/image/capture-only queued send is never dropped (codex review).
  const hasExtras = captureRow != null || imageParts.length > 0 || attachmentCount > 0;

  return (
    <MessagePrimitive.Root data-testid="chat-user-message" className="flex flex-col items-end gap-2 pt-2">
      {codeRefCard}

      {isQueued ? (
        (body || hasExtras) && (
          <QueuedUserTurn messageId={messageId} content={cleanText} extrasSlot={extras}>
            {body}
          </QueuedUserTurn>
        )
      ) : (
        <>
          {body && <CoolCard>{body}</CoolCard>}
          {extras}
        </>
      )}

      {sendError != null && (
        <p data-testid="chat-user-message-send-failed" className="text-caption text-destructive">
          Failed to send
        </p>
      )}
    </MessagePrimitive.Root>
  );
}

export const UserMessage = memo(UserMessageImpl);
UserMessage.displayName = 'UserMessage';
