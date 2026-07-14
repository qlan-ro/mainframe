/**
 * TRIGGER_LABEL — human label per `AutomationRunTriggerKind`, shared by
 * `RunView`'s header and `details/DetailsRuns`' run rows (one source of
 * truth for run-trigger vocabulary). Kept in its own module, not
 * `RunView.tsx`, so `DetailsRuns` — lazy-loaded independently under
 * `details/AutomationDetails` — doesn't statically pull in `RunView`'s own
 * (separately lazy-loaded) component module.
 */
import type { AutomationRunTriggerKind } from '../contract';

export const TRIGGER_LABEL: Record<AutomationRunTriggerKind, string> = {
  schedule: 'Schedule',
  event: 'Event',
  webhook: 'Webhook',
  manual: 'Manual',
};
