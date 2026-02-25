import React, { useCallback, useEffect, useState } from 'react';
import { ArrowUp, Square, Paperclip, Shield, GitBranch, X } from 'lucide-react';
import { createLogger } from '../../../../lib/logger';

const log = createLogger('renderer:composer');
import { ComposerPrimitive, useThread, useComposerRuntime } from '@assistant-ui/react';
import { useMainframeRuntime } from '../MainframeRuntimeProvider';
import { useChatsStore } from '../../../../store/chats';
import { useSkillsStore } from '../../../../store/skills';
import { useAdaptersStore } from '../../../../store/adapters';
import { getAdapterOptions, getModelOptions } from '../../../../lib/adapters';
import { daemonClient } from '../../../../lib/client';
import { focusComposerInput } from '../../../../lib/focus';
import { ContextPickerMenu } from '../../ContextPickerMenu';
import { ComposerDropdown } from './ComposerDropdown';
import { ComposerHighlight } from './ComposerHighlight';
import { ImageAttachmentPreview } from './ImageAttachmentPreview';
import { useSandboxStore } from '../../../../store/sandbox';

const PERMISSION_MODES = [
  { id: 'default', label: 'Interactive' },
  { id: 'plan', label: 'Plan' },
  { id: 'acceptEdits', label: 'Auto-Edits' },
  { id: 'yolo', label: 'Unattended' },
];

// Two overlapping circles: back circle = /, front circle = @
function ContextPickerIcon() {
  const bg = 'var(--color-mf-panel-bg)';
  return (
    <svg viewBox="0 0 17 13" width="17" height="13" aria-hidden="true">
      {/* Back circle (/) */}
      <circle cx="5" cy="6.5" r="5" fill="currentColor" opacity="0.38" />
      {/* Front circle (@) */}
      <circle cx="11.5" cy="6.5" r="5" fill="currentColor" />
      {/* / as diagonal line */}
      <line
        x1="3"
        y1="9"
        x2="7"
        y2="4"
        style={{ stroke: bg, strokeWidth: 1.5, strokeLinecap: 'round' } as React.CSSProperties}
      />
      {/* @ — Lucide AtSign paths scaled to 7×7, centered on right circle */}
      <svg
        x="8"
        y="3"
        width="7"
        height="7"
        viewBox="0 0 24 24"
        style={
          {
            fill: 'none',
            stroke: bg,
            strokeWidth: 2.4,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
          } as React.CSSProperties
        }
      >
        <circle cx="12" cy="12" r="4" />
        <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94" />
      </svg>
    </svg>
  );
}

function StopButton() {
  const thread = useThread();
  if (!thread.isRunning) return null;
  return (
    <ComposerPrimitive.Cancel
      className="w-7 h-7 flex items-center justify-center rounded-mf-input text-mf-text-secondary hover:bg-mf-hover hover:text-mf-destructive transition-colors"
      title="Stop response"
      aria-label="Stop response"
    >
      <Square size={12} />
    </ComposerPrimitive.Cancel>
  );
}

export function ComposerCard() {
  const { chatId, composerError, dismissComposerError } = useMainframeRuntime();
  const chat = useChatsStore((s) => s.chats.find((c) => c.id === chatId));
  const adapters = useAdaptersStore((s) => s.adapters);
  const messages = useChatsStore((s) => s.messages.get(chatId));
  const hasMessages = (messages?.length ?? 0) > 0;
  const composerRuntime = useComposerRuntime();
  const [pickerOpen, setPickerOpen] = useState(false);
  const captures = useSandboxStore((s) => s.captures);
  const removeCapture = useSandboxStore((s) => s.removeCapture);

  useEffect(() => {
    requestAnimationFrame(() => {
      focusComposerInput();
    });
  }, [chatId]);

  const pendingInvocation = useSkillsStore((s) => s.pendingInvocation);
  useEffect(() => {
    if (pendingInvocation) {
      try {
        composerRuntime.setText(pendingInvocation);
        focusComposerInput();
      } catch (err) {
        log.warn('failed to set pending invocation', { err: String(err) });
      }
      useSkillsStore.getState().setPendingInvocation(null);
    }
  }, [pendingInvocation, composerRuntime]);

  const currentAdapter = chat?.adapterId ?? 'claude';
  const adapterOptions = getAdapterOptions(adapters);
  const modelOptions = getModelOptions(currentAdapter, adapters);
  const currentModel = chat?.model ?? modelOptions[0]?.id ?? '';

  const handleAdapterChange = useCallback(
    (adapterId: string) => {
      if (!chatId) return;
      const defaultModel = getModelOptions(adapterId, adapters)[0]?.id;
      daemonClient.updateChatConfig(chatId, adapterId, defaultModel);
    },
    [chatId, adapters],
  );

  const handleModelChange = useCallback(
    (model: string) => {
      if (!chatId) return;
      daemonClient.updateChatConfig(chatId, undefined, model);
    },
    [chatId],
  );

  const currentMode = chat?.permissionMode ?? 'default';

  const handleModeChange = useCallback(
    (mode: string) => {
      if (!chatId) return;
      daemonClient.updateChatConfig(chatId, undefined, undefined, mode as 'default' | 'acceptEdits' | 'plan' | 'yolo');
    },
    [chatId],
  );

  return (
    <ComposerPrimitive.Root
      data-tutorial="step-3"
      className="relative border border-mf-border rounded-mf-card bg-transparent"
    >
      <ContextPickerMenu forceOpen={pickerOpen} onClose={() => setPickerOpen(false)} />
      <div className="flex items-center gap-1 px-2 pt-2">
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setPickerOpen((p) => !p);
            focusComposerInput();
          }}
          className="p-1.5 rounded-mf-input text-mf-text-secondary hover:bg-mf-hover hover:text-mf-text-primary transition-colors"
          title="Open context picker (agents, files, skills)"
          aria-label="Open context picker"
        >
          <ContextPickerIcon />
        </button>
        <ComposerPrimitive.AddAttachment
          className="p-1.5 rounded-mf-input text-mf-text-secondary hover:bg-mf-hover hover:text-mf-text-primary transition-colors"
          title="Add attachment"
          aria-label="Add attachment"
        >
          <Paperclip size={14} />
        </ComposerPrimitive.AddAttachment>
      </div>

      <div className="flex gap-2 px-3 pt-1 flex-wrap">
        <ComposerPrimitive.Attachments
          components={{
            Image: ImageAttachmentPreview,
            Attachment: ImageAttachmentPreview,
          }}
        />
      </div>
      {captures.length > 0 && (
        <div className="flex flex-wrap gap-1 px-3 pt-2">
          {captures.map((c) => (
            <div
              key={c.id}
              className="flex items-center gap-1 bg-mf-hover rounded px-2 py-0.5 text-xs text-mf-text-primary"
            >
              {c.type === 'screenshot' ? '📷 screenshot' : `⊕ ${c.selector ?? 'element'}`}
              <button
                type="button"
                onClick={() => removeCapture(c.id)}
                className="ml-1 text-mf-text-secondary hover:text-red-400"
                aria-label="Remove capture"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      {composerError && (
        <div className="mx-3 mt-2 rounded-md bg-mf-chat-error/15 px-3 py-2 text-mf-small text-mf-chat-error-subtle flex items-center justify-between gap-2 shadow-chat-error-inset">
          <span>{composerError}</span>
          <button
            type="button"
            onClick={dismissComposerError}
            className="shrink-0 text-mf-chat-error-subtle/80 hover:text-mf-text-primary transition-colors"
            aria-label="Dismiss attachment error"
          >
            <X size={12} />
          </button>
        </div>
      )}

      <div className="relative">
        <ComposerHighlight />
        <ComposerPrimitive.Input
          data-mf-composer-input
          rows={2}
          autoFocus
          spellCheck={false}
          placeholder="Type @ to search files, / for skills… (Enter to send)"
          className="w-full bg-transparent border-none px-3 py-2 font-sans text-mf-chat text-transparent caret-mf-text-primary selection:text-mf-text-primary resize-none placeholder:text-mf-text-secondary focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
        />
      </div>

      <div className="flex items-center justify-between px-2 pb-2">
        <div className="flex items-center gap-1">
          <ComposerDropdown
            data-tutorial="step-4"
            items={adapterOptions}
            value={currentAdapter}
            onChange={handleAdapterChange}
            disabled={hasMessages}
          />
          <ComposerDropdown items={modelOptions} value={currentModel} onChange={handleModelChange} />
          <ComposerDropdown
            items={PERMISSION_MODES}
            value={currentMode}
            onChange={handleModeChange}
            icon={<Shield size={12} />}
            className={
              currentMode === 'yolo' ? 'text-mf-destructive' : currentMode === 'plan' ? 'text-mf-accent' : undefined
            }
          />
          {!hasMessages && (
            <button
              type="button"
              onClick={() => {
                if (!chatId) return;
                if (chat?.worktreePath) {
                  daemonClient.disableWorktree(chatId);
                } else {
                  daemonClient.enableWorktree(chatId);
                }
              }}
              className={`flex items-center gap-1 px-2 py-1 rounded-mf-input text-mf-small transition-colors ${
                chat?.worktreePath
                  ? 'text-mf-accent bg-mf-hover'
                  : 'text-mf-text-secondary hover:bg-mf-hover hover:text-mf-text-primary'
              }`}
              title={chat?.worktreePath ? `Branch: ${chat.branchName}` : 'Enable worktree isolation'}
              aria-label={
                chat?.worktreePath ? `Worktree enabled on branch ${chat.branchName}` : 'Enable worktree isolation'
              }
            >
              <GitBranch size={12} />
            </button>
          )}
        </div>
        <div className="flex items-center gap-1">
          <StopButton />
          <ComposerPrimitive.Send
            className="w-7 h-7 flex items-center justify-center rounded-mf-input text-mf-text-secondary hover:bg-mf-hover hover:text-mf-text-primary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="Send message"
            aria-label="Send message"
          >
            <ArrowUp size={16} />
          </ComposerPrimitive.Send>
        </div>
      </div>
    </ComposerPrimitive.Root>
  );
}
