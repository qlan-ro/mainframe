import { useTurnSelector } from './turn-context';

/** An unresolved failure opens by itself once its turn has ended (T1b). */
export function useFailedOpen(turnKey: string | undefined, toolCallId: string): boolean {
  return useTurnSelector(({ model, children }) => {
    const turn = turnKey ? model.turns.get(turnKey) : undefined;
    return turn !== undefined && !turn.live && (turn.failed.includes(toolCallId) || children.failed.has(toolCallId));
  }, false);
}
