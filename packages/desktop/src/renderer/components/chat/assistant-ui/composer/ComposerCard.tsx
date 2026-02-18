import React, { useCallback, useEffect } from 'react';
import { ArrowUp, Square, AtSign, Paperclip, Shield, GitBranch, X } from 'lucide-react';
import { ComposerPrimitive, useThread, useComposerRuntime } from '@assistant-ui/react';
import { useMainframeRuntime } from '../MainframeRuntimeProvider';
import { useChatsStore } from '../../../../store/chats';
import { useSkillsStore } from '../../../../store/skills';
import { useAdaptersStore } from '../../../../store/adapters';
import { getAdapterOptions, getModelOptions } from '../../../../lib/adapters';
import { daemonClient } from '../../../../lib/client';
import { focusComposerInput } from '../../../../lib/focus';
import { SlashCommandMenu } from '../../SlashCommandMenu';
import { AtMentionMenu } from '../../AtMentionMenu';
import { ComposerDropdown } from './ComposerDropdown';
import { ComposerHighlight } from './ComposerHighlight';
import { ImageAttachmentPreview } from './ImageAttachmentPreview';

const PERMISSION_MODES = [
  { id: 'default', label: 'Interactive' },
  { id: 'plan', label: 'Plan' },
  { id: 'acceptEdits', label: 'Auto-Edits' },
  { id: 'yolo', label: 'Unattended' },
];

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
        console.warn('[ComposerCard] failed to set pending invocation:', err);
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
    <ComposerPrimitive.Root className="relative border border-mf-border rounded-mf-card bg-transparent">
      <SlashCommandMenu />
      <AtMentionMenu />
      <div className="flex items-center gap-1 px-2 pt-2">
        <button
          type="button"
          onClick={() => {
            try {
              const current = composerRuntime.getState()?.text ?? '';
              if (/(?:^|\s)@\S*$/.test(current)) {
                focusComposerInput();
                return;
              }
              const suffix = current.length === 0 || current.endsWith(' ') ? '@' : ' @';
              composerRuntime.setText(current + suffix);
              focusComposerInput();
            } catch (error) {
              console.warn('[composer-card] failed to insert mention prefix:', error);
            }
          }}
          className="p-1.5 rounded-mf-input text-mf-text-secondary hover:bg-mf-hover hover:text-mf-text-primary transition-colors"
          title="Mention files"
          aria-label="Mention files"
        >
          <AtSign size={14} />
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
          placeholder="Use / for commands, @ to search files... (Enter to send)"
          className="w-full bg-transparent border-none px-3 py-2 font-sans text-mf-chat text-transparent caret-mf-text-primary selection:text-mf-text-primary resize-none placeholder:text-mf-text-secondary focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
        />
      </div>

      <div className="flex items-center justify-between px-2 pb-2">
        <div className="flex items-center gap-1">
          <ComposerDropdown
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
