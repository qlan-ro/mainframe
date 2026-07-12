/**
 * Shared `AutomationsGateway` test double — every method throws "not
 * implemented" (write verbs) or resolves empty (list verbs) unless a test
 * overrides it. Was duplicated verbatim across three test files; extracted
 * here per the 3+-duplication rule once this phase's `getRunTimeline`/
 * `onEvent` additions needed updating in all three anyway.
 */
import type { AutomationsGateway } from '../gateway';

export function createFakeGateway(overrides: Partial<AutomationsGateway> = {}): AutomationsGateway {
  return {
    listAutomations: async () => [],
    createAutomation: async () => {
      throw new Error('not implemented');
    },
    getAutomation: async () => {
      throw new Error('not implemented');
    },
    updateAutomation: async () => {
      throw new Error('not implemented');
    },
    deleteAutomation: async () => {},
    setEnabled: async () => {
      throw new Error('not implemented');
    },
    startRun: async () => {
      throw new Error('not implemented');
    },
    listRuns: async () => [],
    getRun: async () => {
      throw new Error('not implemented');
    },
    cancelRun: async () => {},
    getRunTimeline: async () => [],
    listInteractions: async () => [],
    respondInteraction: async () => {},
    listActions: async () => [],
    listCredentialLabels: async () => [],
    putCredential: async () => {},
    deleteCredential: async () => {},
    onEvent: () => () => {},
    ...overrides,
  };
}
