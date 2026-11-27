/**
 * Chip composer harness (todos #482, #493): the composer field with the real
 * trigger engine, formatters, chip field and plugins, over a synthetic
 * external-store runtime. No daemon, no provider, no app. `?textarea` mounts the
 * textarea field instead, for a before/after comparison. Below the card, the
 * standalone chip editor that quote segments and queued-message edits use.
 * `window.__fixture` exposes state to `run.mjs`.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  INTERNAL,
  SimpleImageAttachmentAdapter,
  useAui,
  useAuiState,
  useExternalStoreRuntime,
  type ThreadMessageLike,
} from '@assistant-ui/react';
import '../../src/styles/app.css';
import { useTriggerField, type TriggerField } from '../../src/components/trigger-engine/use-trigger-field';
import { TriggerFieldPopover } from '../../src/components/trigger-engine/TriggerFieldPopover';
import type { TriggerAdapter, TriggerConfig, TriggerItem } from '../../src/components/trigger-engine/types';
import {
  literalDirectiveFormatter,
  mentionDirectiveFormatter,
  shouldCloseTriggerOnInsert,
} from '../../src/features/chat/composer/triggers/directive-formatter';
import { TriggerFieldAriaProvider } from '../../src/features/chat/composer/triggers/trigger-field-aria-context';
import { SideChatScopeProvider } from '../../src/features/side-chat/side-chat-scope';
import { useSessionReferences } from '../../src/features/chat/composer/sessions/session-reference-store';
import { ComposerLexicalField } from '../../src/features/chat/composer/lexical/ComposerLexicalField';
import { ChipTextEditor } from '../../src/features/chat/composer/lexical/ChipTextEditor';
import {
  createLexicalComposerBridge,
  useMaskedText,
  type LexicalComposerBridge,
} from '../../src/features/chat/composer/lexical/lexical-bridge';

const THREAD = 'fixture';
const textareaMode = location.search.includes('textarea');

function staticAdapter(items: TriggerItem[]): TriggerAdapter {
  return {
    categories: () => [],
    categoryItems: () => items,
    search: (q) => {
      const needle = q.replace(/^"/, '').toLowerCase();
      return items.filter((i) => `${i.id} ${i.label}`.toLowerCase().includes(needle));
    },
  };
}

const SLASH = staticAdapter([
  { id: 'review', type: 'command', label: 'review', description: 'Review the diff' },
  { id: 'brainstorm', type: 'skill', label: 'brainstorm', description: 'A skill' },
]);
const MENTION = staticAdapter([
  { id: 'src/app.ts', type: 'file', label: 'app.ts' },
  { id: 'src', type: 'directory', label: 'src' },
  { id: 'docs/my notes.md', type: 'file', label: 'my notes.md' },
  { id: 'chat-1', type: 'session', label: 'Fix login bug' },
]);

function useTriggers(): TriggerConfig[] {
  return useMemo(
    () => [
      { char: '/', adapter: SLASH, formatter: literalDirectiveFormatter('/'), itemTestIdPrefix: 'composer-skill-item' },
      {
        char: '@',
        adapter: MENTION,
        formatter: mentionDirectiveFormatter(),
        itemTestIdPrefix: 'composer-file-item',
        closeOnInsert: shouldCloseTriggerOnInsert,
        onInserted: (item: TriggerItem) => {
          if (item.type === 'session')
            useSessionReferences.getState().record(THREAD, item.label, `/t/${item.id}.jsonl`);
        },
      },
    ],
    [],
  );
}

function RegistryBridge({ field }: { field: TriggerField }) {
  const registry = INTERNAL.useComposerInputPluginRegistryOptional();
  useEffect(
    () => registry?.register({ handleKeyDown: field.handleKeyDown, setCursorPosition: field.setCursorPosition }),
    [registry, field.handleKeyDown, field.setCursorPosition],
  );
  return null;
}

function Triggers({
  children,
  lexical,
  textareaRef,
}: {
  children: ReactNode;
  lexical: LexicalComposerBridge | null;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const aui = useAui();
  const text = useAuiState((s) => s.composer.text);
  const masked = useMaskedText(lexical);
  const field = useTriggerField({
    value: masked ?? text,
    onChange: (next) => aui.composer.setText(next),
    triggers: useTriggers(),
    textareaRef,
    ...(lexical && { insert: lexical.insertPick }),
  });
  return (
    <ComposerPrimitive.Unstable_TriggerPopoverRoot>
      <RegistryBridge field={field} />
      <TriggerFieldAriaProvider value={field.ariaProps}>
        <TriggerFieldPopover field={field} testId="composer-trigger-popover">
          {children}
        </TriggerFieldPopover>
      </TriggerFieldAriaProvider>
    </ComposerPrimitive.Unstable_TriggerPopoverRoot>
  );
}

interface Sent {
  text: string;
  mode: 'send' | 'queue' | 'steer';
}

function Card({ running, onSent }: { running: boolean; onSent: (s: Sent) => void }) {
  const aui = useAui();
  const [lexical] = useState(() => (textareaMode ? null : createLexicalComposerBridge()));
  const [fieldKey, setFieldKey] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const submit = useCallback(
    (mode: Sent['mode']) => {
      const text = aui.composer.getState().text;
      if (text === '' && aui.composer.getState().attachments.length === 0) return;
      onSent({ text, mode });
      aui.composer.setText('');
    },
    [aui, onSent],
  );
  const onEnter = useCallback(
    (alt: boolean) => submit(running ? (alt ? 'queue' : 'steer') : 'send'),
    [running, submit],
  );
  const text = useAuiState((s) => s.composer.text);
  const attachments = useAuiState((s) => s.composer.attachments.length);
  Object.assign(window, {
    __fixture: { aui, lexical, remount: () => setFieldKey((k) => k + 1), refs: () => useSessionReferences.getState() },
  });

  return (
    <Triggers lexical={lexical} textareaRef={textareaRef}>
      <ComposerPrimitive.Root
        data-testid="chat-composer"
        onSubmit={(e) => {
          e.preventDefault();
          submit('send');
        }}
        className="m-6 w-[560px] rounded-[16px] bg-card p-3 shadow-card has-[[contenteditable]:focus]:focus-line-inset has-[textarea:focus-visible]:focus-line-inset"
      >
        <div className="relative max-h-48 overflow-y-auto">
          {lexical ? (
            <ComposerLexicalField
              key={fieldKey}
              bridge={lexical}
              placeholder="Ask anything, @ to mention, / for actions"
              onEnter={onEnter}
              onShiftTab={() => onSent({ text: '<shift-tab>', mode: 'send' })}
            />
          ) : (
            <ComposerPrimitive.Input
              ref={textareaRef}
              data-testid="chat-composer-input"
              cancelOnEscape={false}
              rows={1}
              className="block w-full resize-none bg-transparent px-1 font-sans text-composer-input outline-none"
            />
          )}
        </div>
        <div className="mt-2 flex gap-2 text-xs">
          <button type="button" data-testid="open-mention" onClick={() => lexical?.openMention()}>
            + Mention
          </button>
          <span data-testid="attachment-count">{attachments}</span>
        </div>
        <pre data-testid="composer-text" className="mt-2 text-xs whitespace-pre-wrap">
          {JSON.stringify(text)}
        </pre>
      </ComposerPrimitive.Root>
    </Triggers>
  );
}

/** The standalone chip editor, as a quote segment or a queued-message edit uses it. */
function SegmentEditor() {
  const [value, setValue] = useState('see @src/app.ts and /review');
  return (
    <div className="m-6 w-[560px] rounded-[12px] bg-card p-3">
      <ChipTextEditor testId="segment-editor" value={value} onChange={setValue} placeholder="Add a message…" />
      <pre data-testid="segment-text" className="mt-2 text-xs whitespace-pre-wrap">
        {JSON.stringify(value)}
      </pre>
    </div>
  );
}

function Fixture() {
  const [running, setRunning] = useState(false);
  const [sent, setSent] = useState<Sent[]>([]);
  const [messages] = useState<ThreadMessageLike[]>([]);
  const attachments = useMemo(() => new SimpleImageAttachmentAdapter(), []);
  const runtime = useExternalStoreRuntime({
    messages,
    isRunning: running,
    convertMessage: (m: ThreadMessageLike) => m,
    onNew: async () => {},
    onCancel: async () => {},
    adapters: { attachments },
  });
  const onSent = useCallback((s: Sent) => setSent((all) => [...all, s]), []);
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <SideChatScopeProvider value={{ parentChatId: 'parent', sideChatId: THREAD }}>
        <label className="m-6 flex gap-2 text-xs">
          <input
            type="checkbox"
            data-testid="running"
            checked={running}
            onChange={(e) => setRunning(e.target.checked)}
          />
          running
        </label>
        <div data-mf-chat-thread tabIndex={-1} data-testid="transcript" className="text-xs">
          <p className="mx-6">transcript</p>
          <Card running={running} onSent={onSent} />
        </div>
        {!textareaMode && <SegmentEditor />}
        <pre data-testid="sent" className="m-6 text-xs">
          {JSON.stringify(sent)}
        </pre>
      </SideChatScopeProvider>
    </AssistantRuntimeProvider>
  );
}

createRoot(document.getElementById('root')!).render(<Fixture />);
