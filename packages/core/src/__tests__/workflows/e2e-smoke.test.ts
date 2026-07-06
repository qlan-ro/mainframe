// Full vertical: YAML on disk -> rescan -> manual trigger -> question step parks
// (restart-survival: second WorkflowService reads the same DB) -> respond ->
// parallel fan-out (files.append x2) -> outputs validated.
// This mirrors the daily-kid-health-log shape with files-only sinks.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { WorkflowService } from '../../workflows/index.js';

/** Build workflow YAML using canonical grammar: question + fields, parallel + files.append, outputs. */
function buildWorkflowYaml(dir: string): string {
  return `version: 1
name: health
steps:
  - id: ask
    question:
      title: "Daily check-in"
      fields:
        - key: mood
          type: choice
          options: [happy, sad]
          required: true
        - key: temp
          type: number
          required: true
  - id: record
    parallel:
      log1:
        - id: w
          connector: files.append
          with:
            path: "${dir}/a.md"
            content: "mood=\${ ask.output.mood }\\n"
      log2:
        - id: w
          connector: files.append
          with:
            path: "${dir}/b.md"
            content: "temp=\${ ask.output.temp }\\n"
outputs:
  mood: \${ ask.output.mood }
`;
}

function makeService(dir: string): WorkflowService {
  return new WorkflowService({
    dataDir: dir,
    logger: pino({ level: 'silent' }),
    emitEvent: () => {},
    agentPort: {
      async createChatAndSend() {
        return { chatId: 'stub' };
      },
    },
    listProjects: () => [],
  });
}

describe('e2e: question -> parallel files.append, restart survival', () => {
  let dir: string;
  let service: WorkflowService;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'wfe2e-'));
    mkdirSync(join(dir, 'workflows'), { recursive: true });
    writeFileSync(join(dir, 'workflows', 'health.yml'), buildWorkflowYaml(dir));
    service = makeService(dir);
  });

  afterEach(() => {
    service.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it('runs the full lifecycle across a simulated daemon restart', async () => {
    // ---- Service 1: load, start, park at question ----
    await service.rescan();

    const wf = service.loader.get('global:health');
    if (!wf) throw new Error('workflow "health" not loaded after rescan');

    const run = service.engine.startRun({
      workflowId: wf.id,
      definition: wf.definition,
      triggerKind: 'manual',
      inputs: {},
      triggerPayload: null,
    });

    await service.engine.advance(run.id);

    // Question step parks the run as 'waiting'
    expect(service.store.getRun(run.id)?.status).toBe('waiting');

    // ---- Simulate a daemon restart: new WorkflowService over the same dataDir ----
    service.stop();

    const service2 = makeService(dir);
    await service2.start(); // triggers reconcileOnBoot which resumes active runs

    // The pending interaction must survive the restart
    const pending = service2.interactions.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.title).toBe('Daily check-in');

    // ---- Respond with valid answers; this resumes the run ----
    await service2.interactionService.respond(pending[0]!.id, { mood: 'happy', temp: 36.6 });

    // Run should now be succeeded
    const done = service2.store.getRun(run.id);
    expect(done?.status).toBe('succeeded');

    // Workflow outputs must be evaluated and persisted
    expect(done?.outputs).toEqual({ mood: 'happy' });

    // Both parallel file lanes must have written their content
    expect(readFileSync(join(dir, 'a.md'), 'utf8')).toBe('mood=happy\n');
    expect(readFileSync(join(dir, 'b.md'), 'utf8')).toBe('temp=36.6\n');

    service2.stop();
  });
});
