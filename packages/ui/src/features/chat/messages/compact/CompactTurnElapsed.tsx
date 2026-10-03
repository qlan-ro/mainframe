import { useEffect, useState } from 'react';
import type { TurnDisclosure } from '../../view-model/compact/turn-types';
import { turnDuration } from '../../view-model/compact/turn-timing';
import { formatDurationMs } from '../../format-duration';

export function CompactTurnElapsed({ turn }: { turn: TurnDisclosure }) {
  const [now, setNow] = useState(Date.now);
  const ticking =
    turn.running &&
    turn.timing?.startedAtMs !== undefined &&
    turn.timing.completedAtMs === undefined &&
    turn.timing.durationMs === undefined;
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ticking]);
  const duration = turnDuration(turn.timing, turn.running, now);
  return (
    <>
      {duration === undefined
        ? 'Work details'
        : `${turn.running ? 'Working' : 'Worked'} for ${formatDurationMs(duration)}`}
    </>
  );
}
