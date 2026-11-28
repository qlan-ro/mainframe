/** Every third turn opened by the "viewer", with its 100-line Read output showing: the tall rows real chats have. */
import { disclosureStore } from '@/features/chat/messages/turn/disclosure-store';
import { turnDisclosureStore } from '@/features/chat/messages/turn/turn-disclosure-store';
import { params } from './params';
import { CHAT_ID } from './store';

export function openSomeTurns() {
  if (params.shape !== 'default') return;
  for (let i = 0; i < params.totalTurns; i += 3) {
    turnDisclosureStore.set(JSON.stringify([CHAT_ID, [], `t${i}-a1`]), 'open');
    disclosureStore.set(JSON.stringify([CHAT_ID, [], `t${i}-a1`, `tool:t${i}-read`]), true);
  }
}
