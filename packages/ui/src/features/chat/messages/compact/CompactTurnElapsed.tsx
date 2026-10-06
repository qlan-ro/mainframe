import type { TurnDisclosure } from '../../view-model/compact/turn-types';
import { turnDuration } from '../../view-model/compact/turn-timing';
import { formatDurationMs } from '../../format-duration';

/**
 * "Worked for X" once the turn settles. While the turn RUNS this renders
 * nothing: the footer's status line is the one live timer (D18), and a
 * second clock ticking inside the transcript would contradict it.
 */
export function CompactTurnElapsed({ turn }: { turn: TurnDisclosure }) {
  if (turn.running) return null;
  const duration = turnDuration(turn.timing, false, 0);
  return <>{duration === undefined ? 'Work details' : `Worked for ${formatDurationMs(duration)}`}</>;
}
