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
 *
 * @mention inline rendering uses the native `createDirectiveText` pattern from
 * @assistant-ui/react via our `mainframeUserFormatter` (see user-directives.ts).
 * The SlashPill leading badge is kept metadata-driven: when daemon metadata carries
 * `command.name`, we render the pill before the text body. If no metadata exists
 * but the text itself starts with `/command`, the formatter will emit a command
 * chip — so both paths produce a chip, just at different levels.
 *
 * Deferred (TODO-leaf — do NOT build here):
 *   - Sandbox capture context row (SandboxCaptureContext)
 *   - PLAN_PREFIX "Implementing plan" card
 *   - File attachment chips (FileAttachmentThumbs)
 *   - Context-sent chips (UMContextRow)
 *   - UMCodeRef (editor code-reference card)
 *   - UMInspectChip (CSS-selector capture chips)
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
import { createDirectiveText } from '@/components/ui/assistant-ui/directive-text';
import { mainframeUserFormatter } from './user-directives';

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
    skill: Zap,
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
  boxShadow: '0 1px 2px rgba(30, 50, 120, 0.05)',
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
        'text-body leading-relaxed tracking-[-0.1px]',
        className,
      )}
    >
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Queued badge
// ─────────────────────────────────────────────────────────────────────────────

function QueuedBadge() {
  return (
    <span className="mr-1 inline-flex items-center gap-1.5 font-mono text-micro text-mf-text-3">
      <span
        className="inline-block h-[7px] w-[7px] shrink-0 animate-spin rounded-full border-[1.5px] border-mf-warning"
        style={{ borderTopColor: 'transparent' }}
      />
      Queued · sends after the current run
    </span>
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
  const colorClass = kind === 'command' ? 'text-primary' : 'text-[#7a4dd0]';
  const pillBg = kind === 'command' ? 'rgba(10,132,255,0.08)' : 'rgba(122,77,208,0.08)';

  return (
    <span className="mr-2 inline-flex items-center gap-1 rounded-md py-0.5 pl-1.5 pr-2" style={{ background: pillBg }}>
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
        <img
          key={p.image}
          src={p.image}
          alt=""
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

  // Resolve text: prefer cleanText (pipeline-stripped) over raw part text
  const rawText = useAuiState((s) => {
    const parts = (s as unknown as { message: { content: Array<{ type: string; text?: string }> } }).message.content;
    return parts.find((p) => p.type === 'text')?.text ?? '';
  }) as string;

  // Native image parts projected from DisplayContent images in convert-message.
  // Select the stable content ref, then derive — a filter inside useAuiState
  // returns a fresh array each render and loops (getSnapshot).
  const content = useAuiState(
    (s) => (s as unknown as { message: { content: Array<{ type: string; image?: string }> } }).message.content,
  );
  const imageParts = useMemo(
    () =>
      content.filter((p): p is { type: 'image'; image: string } => p.type === 'image' && typeof p.image === 'string'),
    [content],
  );

  const cleanText = meta.cleanText ?? rawText;

  // ── Command / skill resolution from metadata ──────────────────────────────
  const metaCmd = meta.command;
  let slashProps: { kind: 'command' | 'skill'; name: string; userText: string } | null = null;
  if (metaCmd?.name) {
    const isCommand = metaCmd.source === 'commands';
    slashProps = {
      kind: isCommand ? 'command' : 'skill',
      name: metaCmd.name,
      userText: metaCmd.userText ?? cleanText,
    };
  }

  // TODO(leaf): PLAN_PREFIX card ("Implementing plan") — deferred to plan-card leaf
  // TODO(leaf): SandboxCaptureContext — deferred to sandbox-capture leaf
  // TODO(leaf): FileAttachmentThumbs — deferred to attachment-chips leaf

  return (
    <MessagePrimitive.Root data-testid="chat-user-message" className="flex flex-col items-end gap-2 pt-2">
      {isQueued && <QueuedBadge />}

      {slashProps ? (
        <CoolCard>
          <ReadMoreBubble>
            <SlashPill kind={slashProps.kind} name={slashProps.name} />
            {slashProps.userText}
          </ReadMoreBubble>
        </CoolCard>
      ) : cleanText ? (
        <CoolCard>
          <ReadMoreBubble>
            <Markdown remarkPlugins={REMARK_PLUGINS} urlTransform={urlTransform} components={userMarkdownComponents}>
              {cleanText}
            </Markdown>
          </ReadMoreBubble>
        </CoolCard>
      ) : null}

      <InlineImageThumbs parts={imageParts} />
    </MessagePrimitive.Root>
  );
}

export const UserMessage = memo(UserMessageImpl);
UserMessage.displayName = 'UserMessage';
