import agent from './canonical/agent.yml?raw';
import call from './canonical/call.yml?raw';
import choose from './canonical/choose.yml?raw';
import foreach from './canonical/foreach.yml?raw';
import form from './canonical/form.yml?raw';
import full from './canonical/full.yml?raw';
import minimal from './canonical/minimal.yml?raw';
import parallel from './canonical/parallel.yml?raw';
import questionLegacy from './canonical/question-legacy.yml?raw';
import service from './canonical/service.yml?raw';
import set from './canonical/set.yml?raw';
import triggersEvent from './canonical/triggers-event.yml?raw';
import triggersSchedule from './canonical/triggers-schedule.yml?raw';

/** Canonical DSL fixtures, hand-authored from `packages/core/src/workflows/dsl/schema.ts`. */
export const CANONICAL_FIXTURES: Array<{ name: string; yaml: string }> = [
  { name: 'agent', yaml: agent },
  { name: 'form', yaml: form },
  { name: 'question-legacy', yaml: questionLegacy },
  { name: 'service', yaml: service },
  { name: 'choose', yaml: choose },
  { name: 'foreach', yaml: foreach },
  { name: 'parallel', yaml: parallel },
  { name: 'call', yaml: call },
  { name: 'set', yaml: set },
  { name: 'triggers-schedule', yaml: triggersSchedule },
  { name: 'triggers-event', yaml: triggersEvent },
  { name: 'full', yaml: full },
  { name: 'minimal', yaml: minimal },
];
