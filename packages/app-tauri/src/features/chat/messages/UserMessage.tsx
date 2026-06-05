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
 *   - Plain text    → CoolCard + ReadMoreBubble + markdown + @mention highlights
 *   - /command|skill → CoolCard + leading pill badge + user text
 *   - Queued badge  → quiet animated footer badge above the card
 *   - Inline images → thumbnail row
 *
 * Deferred (TODO-leaf — do NOT build here):
 *   - Sandbox capture context row (SandboxCaptureContext)
 *   - PLAN_PREFIX "Implementing plan" card
 *   - File attachment chips (FileAttachmentThumbs)
 *   - Context-sent chips (UMContextRow)
 *
 * Metadata access: reads from `useAuiState(s => s.message.metadata.custom.mainframe)`
 * which is populated by the user-message arm of convert-message.ts.
 * No `getExternalStoreMessages` or `useMessage` (legacy API).
 */
import { memo, useMemo, type ReactNode } from 'react';
import { MessagePrimitive, useAuiState } from '@assistant-ui/react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { Wrench, Zap, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { markdownComponents } from '../parts/markdown-text';
import { urlTransform, remarkAppLinks } from '../parts/markdown-url-transform';
import { ReadMoreBubble } from './ReadMoreBubble';

// ─────────────────────────────────────────────────────────────────────────────
// Remark plugin set (stable reference — never define inline)
// ─────────────────────────────────────────────────────────────────────────────

const REMARK_PLUGINS = [remarkGfm, remarkAppLinks, remarkBreaks];

// ─────────────────────────────────────────────────────────────────────────────
// @mention highlighting
// ─────────────────────────────────────────────────────────────────────────────

const MENTION_RE = /(@[\w./\-]+)/g;

/**
 * Splits a string on @mention tokens and wraps each match in an accent span.
 * Cheap enough to run inline — only applies to user message text.
 */
function highlightMentions(children: ReactNode): ReactNode {
  if (typeof children !== 'string') return children;

  const parts: ReactNode[] = [];
  let lastIndex = 0;

  for (const match of children.matchAll(MENTION_RE)) {
    const mention = match[1]!;
    const start = match.index! + match[0].indexOf(mention);

    // Only highlight when preceded by whitespace or start of string
    const prevChar = children[start - 1];
    if (prevChar !== undefined && !/\s/.test(prevChar)) continue;

    if (start > lastIndex) parts.push(children.slice(lastIndex, start));
    parts.push(
      <span key={start} className="rounded bg-primary/10 px-1 py-0.5 font-semibold text-primary">
        {mention}
      </span>,
    );
    lastIndex = start + mention.length;
  }

  if (parts.length === 0) return children;
  if (lastIndex < children.length) parts.push(children.slice(lastIndex));
  return parts;
}

/**
 * `<p>` override that wraps text children with @mention highlighting.
 * Only the plain `<p>` element needs this — headings, code, etc. are unchanged.
 */
function MentionParagraph({ children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p {...props}>{highlightMentions(children)}</p>;
}

const userMarkdownComponents = { ...markdownComponents, p: MentionParagraph };

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
        'relative max-w-[75%] rounded-xl border px-[15px] py-[10px]',
        'border-mf-um-edge text-mf-um-ink',
        'text-body leading-relaxed tracking-tight',
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
    <span className="mr-1 inline-flex items-center gap-1.5 font-mono text-caption text-mf-text-3">
      <Clock size={12} className="animate-pulse" />
      Queued · sends after the current run
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Slash (command / skill) pill
// ─────────────────────────────────────────────────────────────────────────────

interface SlashPillProps {
  kind: 'command' | 'skill';
  name: string;
}

function SlashPill({ kind, name }: SlashPillProps) {
  const Icon = kind === 'command' ? Wrench : Zap;
  const colorClass = kind === 'command' ? 'text-primary' : 'text-[#7a4dd0]';
  const bgClass = kind === 'command' ? 'bg-primary/8' : 'bg-[#7a4dd0]/8';

  return (
    <span className={cn('mr-2 inline-flex items-center gap-1 rounded-lg py-0.5 pl-1.5 pr-2', bgClass)}>
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
          className="size-16 rounded-[11px] border border-border object-cover shadow-sm"
        />
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Metadata shape coming from convert-message.ts (metadata.custom.mainframe)
// ─────────────────────────────────────────────────────────────────────────────

interface UserMessageMeta {
  queued?: boolean;
  cleanText?: string;
  command?: { name: string; userText?: string; source?: string };
  attachments?: Array<{ name?: string; kind?: string }>;
  attachedFiles?: Array<{ name: string }>;
}

/** Stable empty fallback — returning a fresh `{}` from useAuiState loops (getSnapshot). */
const EMPTY_USER_META: UserMessageMeta = Object.freeze({});

function useUserMessageMeta(): UserMessageMeta {
  return useAuiState((s) => {
    const meta = (s as { message: { metadata?: { custom?: Record<string, unknown> } } }).message.metadata;
    return (meta?.custom?.['mainframe'] as UserMessageMeta | undefined) ?? EMPTY_USER_META;
  }) as UserMessageMeta;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

function UserMessageImpl() {
  const meta = useUserMessageMeta();
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
