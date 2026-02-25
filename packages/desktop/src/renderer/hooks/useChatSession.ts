import { useEffect, useCallback, useRef } from 'react';
import { daemonClient } from '../lib/client';
import { getChatMessages, getPendingPermission, uploadAttachments } from '../lib/api';
import { useChatsStore } from '../store/chats';
import type { ControlUpdate } from '@mainframe/types';
import { createLogger } from '../lib/logger';

const log = createLogger('renderer:chat-session');

export function useChatSession(chatId: string | null) {
  const { messages, pendingPermissions } = useChatsStore();
  const chatMessages = chatId ? messages.get(chatId) || [] : [];
  const pendingPermission = chatId ? pendingPermissions.get(chatId) : undefined;
  const verifyPermissionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!chatId) return;

    // resumeChat starts the adapter process (loads history + spawns CLI) and subscribes.
    // If the process is already running, startChat returns early — this is a safe no-op.
    daemonClient.resumeChat(chatId);

    // Load cached messages from daemon (survives desktop reloads)
    const existing = useChatsStore.getState().messages.get(chatId);
    if (!existing || existing.length === 0) {
      getChatMessages(chatId)
        .then((msgs) => {
          if (msgs.length > 0) {
            useChatsStore.getState().setMessages(chatId, msgs);
          }
        })
        .catch((err) => log.warn('message fetch failed', { err: String(err) }));
    }

    // Restore pending permission from daemon (survives desktop reloads)
    if (!useChatsStore.getState().pendingPermissions.has(chatId)) {
      getPendingPermission(chatId)
        .then((permission) => {
          if (permission) {
            useChatsStore.getState().addPendingPermission(chatId, permission);
          }
        })
        .catch((err) => log.warn('permission fetch failed', { err: String(err) }));
    }

    // On daemon reconnect, reload messages from daemon.
    // Delay slightly so the daemon's loadChat() (triggered by chat.resume) has time to
    // populate its message cache before we fetch via REST.
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    const unsubConnection = daemonClient.subscribeConnection(() => {
      if (daemonClient.connected) {
        daemonClient.resumeChat(chatId);
        reconnectTimer = setTimeout(() => {
          getChatMessages(chatId)
            .then((msgs) => {
              if (msgs.length > 0) {
                useChatsStore.getState().setMessages(chatId, msgs);
              }
            })
            .catch((err) => log.warn('reconnect message fetch failed', { err: String(err) }));
          getPendingPermission(chatId)
            .then((permission) => {
              if (permission) {
                useChatsStore.getState().addPendingPermission(chatId, permission);
              }
            })
            .catch((err) => log.warn('reconnect permission fetch failed', { err: String(err) }));
        }, 500);
      }
    });

    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (verifyPermissionTimerRef.current) clearTimeout(verifyPermissionTimerRef.current);
      daemonClient.unsubscribe(chatId);
      unsubConnection();
    };
  }, [chatId]);

  const sendMessage = useCallback(
    async (
      content: string,
      attachments?: {
        name: string;
        mediaType: string;
        sizeBytes: number;
        kind: 'image' | 'file';
        data: string;
        originalPath?: string;
      }[],
    ) => {
      if (!chatId) return;
      let attachmentIds: string[] | undefined;
      if (attachments?.length) {
        const uploaded = await uploadAttachments(chatId, attachments);
        attachmentIds = uploaded.map((a) => a.id);
      }
      daemonClient.sendMessage(chatId, content, attachmentIds);
    },
    [chatId],
  );

  const respondToPermission = useCallback(
    (
      behavior: 'allow' | 'deny',
      alwaysAllow?: ControlUpdate[],
      overrideInput?: Record<string, unknown>,
      message?: string,
      executionMode?: string,
      clearContext?: boolean,
    ) => {
      if (!chatId || !pendingPermission) return;
      daemonClient.respondToPermission(chatId, {
        requestId: pendingPermission.requestId,
        toolUseId: pendingPermission.toolUseId,
        toolName: pendingPermission.toolName,
        behavior,
        updatedInput: overrideInput ?? pendingPermission.input,
        updatedPermissions: alwaysAllow,
        message,
        executionMode: executionMode as 'default' | 'acceptEdits' | 'yolo' | undefined,
        clearContext,
      });
      useChatsStore.getState().removePendingPermission(chatId);

      // Verify the respond was received. If the daemon still has the permission pending
      // after 3s (WS message lost, Zod failure, etc.) restore the popup so the user can retry.
      const capturedChatId = chatId;
      const capturedRequestId = pendingPermission.requestId;
      if (verifyPermissionTimerRef.current) clearTimeout(verifyPermissionTimerRef.current);
      verifyPermissionTimerRef.current = setTimeout(() => {
        verifyPermissionTimerRef.current = null;
        getPendingPermission(capturedChatId)
          .then((pending) => {
            if (pending && pending.requestId === capturedRequestId) {
              log.warn('permission respond appears lost — restoring popup for retry');
              useChatsStore.getState().addPendingPermission(capturedChatId, pending);
            }
          })
          .catch((err) => log.warn('permission verify check failed', { err: String(err) }));
      }, 3000);
    },
    [chatId, pendingPermission],
  );

  return { messages: chatMessages, pendingPermission, sendMessage, respondToPermission };
}
