import { Router } from 'express';
import { z } from 'zod';
import { unlink, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RouteContext } from './types.js';
import { param } from './types.js';
import { ok, okEmpty, fail } from './respond.js';
import { asyncHandler } from './async-handler.js';
import { createChildLogger } from '../../logger.js';
import { buildRunTree, type RunTreeNode } from '../../workflows/projection/run-tree.js';
import { parseWorkflowYaml, WorkflowParseError } from '../../workflows/dsl/parse.js';
import { verifyWorkflow } from '../../workflows/dsl/verify.js';
import { writeWorkflowYaml, ValidationError } from '../../workflows/writer.js';
import { workflowAdminRoutes } from './workflow-admin.js';
import type { WorkflowService } from '../../workflows/index.js';
import type { LoadedWorkflow } from '../../workflows/loader.js';

const logger = createChildLogger('routes:workflows');

const DISPLAY_TRUNCATE_BYTES = 32 * 1024;
const StartRunBody = z.object({
  inputs: z.record(z.string(), z.unknown()).optional(),
  payload: z.unknown().optional(),
});
const ValidateBody = z.object({ yaml: z.string() });
const WriteBody = z.object({ yaml: z.string() });

/** Truncate a JSON-serialisable value to DISPLAY_TRUNCATE_BYTES for wire display. */
function displayTruncate(value: unknown): { value: unknown; truncated: boolean } {
  if (value === null || value === undefined) return { value: null, truncated: false };
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json) <= DISPLAY_TRUNCATE_BYTES) return { value, truncated: false };
  return { value: `[truncated — ${Buffer.byteLength(json)} bytes]`, truncated: true };
}

/** Apply display-truncation to input/output fields of every node in the tree. */
function truncateTree(nodes: RunTreeNode[]): RunTreeNode[] {
  return nodes.map((n) => {
    const { value: input, truncated: inputTruncated } = displayTruncate(n.input);
    const { value: output, truncated: outputTruncated } = displayTruncate(n.output);
    const truncated = inputTruncated || outputTruncated;
    const node: RunTreeNode & { truncated: boolean } = { ...n, input, output, truncated };
    if (n.lanes) node.lanes = n.lanes.map((l) => ({ ...l, steps: truncateTree(l.steps) }));
    if (n.arms) node.arms = n.arms.map((a) => ({ ...a, steps: truncateTree(a.steps) }));
    if (n.iterations) node.iterations = n.iterations.map((it) => ({ ...it, steps: truncateTree(it.steps) }));
    if (n.steps) node.steps = truncateTree(n.steps);
    return node;
  });
}

/** Convert a LoadedWorkflow to the wire WorkflowSummary shape. */
function toWorkflowSummary(wf: LoadedWorkflow) {
  return {
    id: wf.id,
    name: wf.name,
    description: wf.definition.description,
    projectId: wf.projectId,
    filePath: wf.filePath,
    triggers: (wf.definition.triggers ?? []).map((t) => ({
      kind: 'schedule' in t ? ('schedule' as const) : ('event' as const),
      detail: 'schedule' in t ? t.schedule.cron : t.event.on,
    })),
  };
}

export function workflowRoutes(ctx: RouteContext): Router {
  const router = Router();
  router.use(workflowAdminRoutes(ctx));

  // ── list ──────────────────────────────────────────────────────────────────

  router.get('/api/workflows', (_req, res) => {
    const service = ctx.workflows;
    if (!service) return void fail(res, 503, 'workflow service not available');
    ok(res, service.loader.list().map(toWorkflowSummary));
  });

  // ── rescan ────────────────────────────────────────────────────────────────

  router.post(
    '/api/workflows/rescan',
    asyncHandler(async (_req, res) => {
      const service = ctx.workflows;
      if (!service) return void fail(res, 503, 'workflow service not available');
      const result = await service.rescan();
      ok(res, result);
    }),
  );

  // ── validate ──────────────────────────────────────────────────────────────

  router.post(
    '/api/workflows/validate',
    asyncHandler(async (req, res) => {
      const parsed = ValidateBody.safeParse(req.body);
      if (!parsed.success) return void fail(res, 400, parsed.error.message);
      try {
        const def = parseWorkflowYaml(parsed.data.yaml);
        const errors = verifyWorkflow(def);
        ok(res, { valid: errors.length === 0, errors });
      } catch (err) {
        if (err instanceof WorkflowParseError) return void fail(res, 400, err.message);
        logger.error({ err }, 'validate unexpected error');
        fail(res, 500, 'validation failed');
      }
    }),
  );

  // ── get source ────────────────────────────────────────────────────────────

  router.get(
    '/api/workflows/:id',
    asyncHandler(async (req, res) => {
      const service = ctx.workflows;
      if (!service) return void fail(res, 503, 'workflow service not available');
      const wfId = param(req, 'id');
      const wf = service.loader.get(wfId);
      if (!wf) return void fail(res, 404, 'workflow not found');
      let yaml: string;
      try {
        yaml = await readFile(wf.filePath, 'utf8');
      } catch (err) {
        logger.warn({ err, wfId, filePath: wf.filePath }, 'read workflow source failed');
        return void fail(res, 404, 'workflow source file not found');
      }
      ok(res, { summary: toWorkflowSummary(wf), yaml });
    }),
  );

  // ── write (PUT) ───────────────────────────────────────────────────────────

  router.put(
    '/api/workflows/:id',
    asyncHandler(async (req, res) => {
      const service = ctx.workflows;
      if (!service) return void fail(res, 503, 'workflow service not available');
      const wfId = param(req, 'id');
      const parsed = WriteBody.safeParse(req.body);
      if (!parsed.success) return void fail(res, 400, parsed.error.message);

      const dir = resolveWorkflowDir(service, wfId);
      if (!dir) return void fail(res, 400, `cannot resolve write directory for '${wfId}'`);

      const colonIdx = wfId.indexOf(':');
      const name = colonIdx >= 0 ? wfId.slice(colonIdx + 1) : wfId;

      try {
        await writeWorkflowYaml({ dir, name, yaml: parsed.data.yaml });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn({ err, wfId }, 'write workflow failed');
        if (err instanceof WorkflowParseError || err instanceof ValidationError) {
          return void fail(res, 400, msg);
        }
        return void fail(res, 500, msg);
      }

      const result = await service.rescan();
      if (result.errors.some((e) => e.file.includes(name))) {
        return void fail(res, 400, 'workflow was written but failed to load after rescan');
      }

      const updated = service.loader.get(wfId);
      if (!updated) return void fail(res, 404, 'workflow not found after rescan');
      ok(res, toWorkflowSummary(updated));
    }),
  );

  // ── delete ────────────────────────────────────────────────────────────────

  router.delete(
    '/api/workflows/:id',
    asyncHandler(async (req, res) => {
      const service = ctx.workflows;
      if (!service) return void fail(res, 503, 'workflow service not available');
      const wfId = param(req, 'id');
      const existing = service.loader.get(wfId);
      if (!existing) return void fail(res, 404, 'workflow not found');

      try {
        await unlink(existing.filePath);
      } catch (err) {
        logger.error({ err, wfId, filePath: existing.filePath }, 'unlink workflow failed');
        fail(res, 500, 'failed to delete workflow file');
        return;
      }
      // Remove the stale DB row immediately so list() reflects the deletion
      // before callers see the next rescan.
      service.db.prepare(`DELETE FROM workflow_defs WHERE id = ?`).run(wfId);
      await service.rescan();
      okEmpty(res);
    }),
  );

  // ── start run ─────────────────────────────────────────────────────────────

  router.post(
    '/api/workflows/:id/runs',
    asyncHandler(async (req, res) => {
      const service = ctx.workflows;
      if (!service) return void fail(res, 503, 'workflow service not available');
      const wfId = param(req, 'id');
      const wf = service.loader.get(wfId);
      if (!wf) return void fail(res, 404, 'workflow not found');

      const parsed = StartRunBody.safeParse(req.body);
      if (!parsed.success) return void fail(res, 400, parsed.error.message);

      let run;
      try {
        run = service.engine.startRun({
          workflowId: wfId,
          definition: wf.definition,
          triggerKind: 'manual',
          triggerPayload: parsed.data.payload ?? null,
          inputs: parsed.data.inputs ?? {},
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn({ err, wfId }, 'startRun failed');
        return void fail(res, 400, msg);
      }

      void service.engine.advance(run.id).catch((err: unknown) => {
        logger.error({ err, runId: run.id }, 'manual run advance failed');
      });

      res.status(202).json({ success: true, data: run });
    }),
  );

  // ── list runs ─────────────────────────────────────────────────────────────

  router.get('/api/workflows/:id/runs', (req, res) => {
    const service = ctx.workflows;
    if (!service) return void fail(res, 503, 'workflow service not available');
    const wfId = param(req, 'id');
    ok(res, service.store.listRuns(wfId));
  });

  // ── run detail ────────────────────────────────────────────────────────────

  router.get(
    '/api/workflow-runs/:runId',
    asyncHandler(async (req, res) => {
      const service = ctx.workflows;
      if (!service) return void fail(res, 503, 'workflow service not available');
      const runId = param(req, 'runId');
      const run = service.store.getRun(runId);
      if (!run) return void fail(res, 404, 'run not found');

      const latest = service.store.latestStepResults(runId);
      const rawTree = buildRunTree(run.definition, latest);
      const tree = truncateTree(rawTree);
      ok(res, { run, tree });
    }),
  );

  // ── cancel run ────────────────────────────────────────────────────────────

  router.post(
    '/api/workflow-runs/:runId/cancel',
    asyncHandler(async (req, res) => {
      const service = ctx.workflows;
      if (!service) return void fail(res, 503, 'workflow service not available');
      const runId = param(req, 'runId');
      const run = service.store.getRun(runId);
      if (!run) return void fail(res, 404, 'run not found');

      try {
        await service.engine.cancelRun(runId);
        okEmpty(res);
      } catch (err) {
        logger.warn({ err, runId }, 'cancel run failed');
        fail(res, 500, 'cancel failed');
      }
    }),
  );

  return router;
}

/**
 * Resolve the on-disk directory where a workflow file should live.
 * `wfId` is `global:<name>` or `<projectId>:<name>`.
 * For global workflows: `<dataDir>/workflows/`.
 * For project workflows: `<project.path>/.mainframe/workflows/`.
 */
function resolveWorkflowDir(service: WorkflowService, wfId: string): string | null {
  const colonIdx = wfId.indexOf(':');
  if (colonIdx < 0) return null;
  const scope = wfId.slice(0, colonIdx);

  // Access the dataDir via the private deps field — the service stores it there.
  const deps = (
    service as unknown as { deps: { dataDir: string; listProjects: () => Array<{ id: string; path: string }> } }
  ).deps;

  if (scope === 'global') {
    return join(deps.dataDir, 'workflows');
  }

  // Project-scoped: look up project path.
  const project = deps.listProjects().find((p) => p.id === scope);
  if (!project) return null;
  return join(project.path, '.mainframe', 'workflows');
}
