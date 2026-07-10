export { FileChildRegistry, NoopChildRegistry } from './child-registry.js';
export type { ChildRegistryPort, ManagedChildEntry, ManagedChildKind } from './child-registry.js';
export {
  sweepStrayChildren,
  processMatchesBinary,
  processMatchesLaunch,
  defaultProcessCommand,
  defaultProcessCwd,
  defaultKill,
  defaultSweepDeps,
} from './sweep.js';
export type { SweepDeps, SweepResult } from './sweep.js';
