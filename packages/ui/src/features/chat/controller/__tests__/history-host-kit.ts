import type { AcpHistory } from '../acp-history';

type HistoryHostOf = ConstructorParameters<typeof AcpHistory>[0];

/** The window members of a history host, for a test that never leaves the live tail. */
export const noWindowHost: Pick<
  HistoryHostOf,
  'newestPageStart' | 'trimTo' | 'showWindow' | 'extendWindow' | 'hideWindow' | 'windowHasItem' | 'windowSpan'
> = {
  newestPageStart: () => null,
  trimTo: () => {},
  showWindow: () => {},
  extendWindow: () => {},
  hideWindow: () => {},
  windowHasItem: () => false,
  windowSpan: () => null,
};
