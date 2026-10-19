/**
 * Render-time lookup of a chat's registry controller.
 *
 * The registry can swap the controller behind an id while its holder stays
 * mounted: offload release disposes it, `adopt` replaces a stale one under
 * the remote id, `disposeAll` clears the lot. Re-asking the registry on every
 * render picks the live (or a recreated) controller up on the holder's next
 * render. The React Compiler would cache the lookup per (chatId, port) and
 * keep handing out the disposed instance, so this hook opts out of it.
 */
import type { AcpChatController } from '../../chat/controller/acp-chat-controller';
import { chatControllerRegistry } from './chat-controller-registry';

export function useChatController(chatId: string, port: number): AcpChatController {
  'use no memo'; // the registry is mutable; a cached lookup outlives a dispose
  return chatControllerRegistry.getOrCreate(chatId, port);
}
