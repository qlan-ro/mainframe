import { Router, Request, Response } from 'express';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';
import { z } from 'zod';
import { GENERAL_DEFAULTS, NOTIFICATION_DEFAULTS, type NotificationConfig } from '@qlan-ro/mainframe-types';
import type { RouteContext } from './types.js';
import { validate, UpdateProviderSettingsBody, UpdateGeneralSettingsBody } from './schemas.js';
import { asyncHandler } from './async-handler.js';
import { resolveAdapterExecutableCached, defaultRun } from '../../adapters/resolve-executable.js';
import { normalizeSavedDefaultModel } from '../../settings/model-default.js';

// Per-group validation so a single bad leaf doesn't discard the user's other
// valid overrides on read.
const ChatReadGroup = z.object({ taskComplete: z.boolean(), sessionError: z.boolean() }).partial();
const PermissionReadGroup = z
  .object({ toolRequest: z.boolean(), userQuestion: z.boolean(), planApproval: z.boolean() })
  .partial();
const OtherReadGroup = z.object({ plugin: z.boolean() }).partial();

function salvage<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> | undefined {
  const result = schema.safeParse(value);
  return result.success ? result.data : undefined;
}

/**
 * The PUT route below validates incoming patches with Zod, so the stored JSON
 * is always well-typed under normal operation. We still re-validate on read as
 * defense-in-depth: a future migration, downgraded daemon, or a hand-edit could
 * otherwise leak a string `"false"` (truthy) into a boolean gate.
 */
function parseNotifications(raw: string | undefined): NotificationConfig {
  if (!raw) return NOTIFICATION_DEFAULTS;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    /* expected: malformed stored JSON → fall back to defaults */
    return NOTIFICATION_DEFAULTS;
  }
  const root = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  return {
    chat: { ...NOTIFICATION_DEFAULTS.chat, ...salvage(ChatReadGroup, root.chat) },
    permission: { ...NOTIFICATION_DEFAULTS.permission, ...salvage(PermissionReadGroup, root.permission) },
    other: { ...NOTIFICATION_DEFAULTS.other, ...salvage(OtherReadGroup, root.other) },
  };
}

/**
 * Patch shape accepted by the route. Each subgroup is partial so callers can
 * flip a single leaf without restating siblings — keeps PUTs commutative
 * across independent leaves under concurrent writes.
 */
type NotificationPatch = {
  chat?: Partial<NotificationConfig['chat']>;
  permission?: Partial<NotificationConfig['permission']>;
  other?: Partial<NotificationConfig['other']>;
};

function persistNotifications(ctx: RouteContext, patch: NotificationPatch): void {
  const existing = parseNotifications(ctx.db.settings.get('general', 'notifications') ?? undefined);
  const merged: NotificationConfig = {
    chat: { ...existing.chat, ...patch.chat },
    permission: { ...existing.permission, ...patch.permission },
    other: { ...existing.other, ...patch.other },
  };
  ctx.db.settings.set('general', 'notifications', JSON.stringify(merged));
}

function normalizeProviderDefaultModels(providers: Record<string, Record<string, unknown>>, ctx: RouteContext): void {
  const catalogs = new Map(ctx.adapters.getSnapshots().map((snapshot) => [snapshot.id, snapshot.models]));
  for (const [adapterId, provider] of Object.entries(providers)) {
    const configured = typeof provider.defaultModel === 'string' ? provider.defaultModel : undefined;
    if (configured && normalizeSavedDefaultModel(configured, catalogs.get(adapterId) ?? []) === undefined) {
      delete provider.defaultModel;
    }
  }
}

export function settingRoutes(ctx: RouteContext): Router {
  const router = Router();

  // General settings
  router.get('/api/settings/general', (_req: Request, res: Response) => {
    const raw = ctx.db.settings.getByCategory('general');
    const notifications = parseNotifications(raw['notifications']);
    const { notifications: _n, ...scalars } = raw;
    res.json({
      success: true,
      data: { ...GENERAL_DEFAULTS, ...scalars, notifications },
    });
  });

  router.put('/api/settings/general', (req: Request, res: Response) => {
    const parsed = validate(UpdateGeneralSettingsBody, req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error });
      return;
    }
    const { notifications, ...scalars } = parsed.data;
    for (const [key, value] of Object.entries(scalars)) {
      if (value !== undefined) {
        const defaultVal = GENERAL_DEFAULTS[key as keyof typeof GENERAL_DEFAULTS];
        if (value === defaultVal) ctx.db.settings.delete('general', key);
        else ctx.db.settings.set('general', key, String(value));
      }
    }
    if (notifications !== undefined) {
      persistNotifications(ctx, notifications);
    }
    res.json({ success: true });
  });

  // Provider defaults
  router.get(
    '/api/settings/providers',
    asyncHandler(async (_req: Request, res: Response) => {
      const raw = ctx.db.settings.getByCategory('provider');
      const providers: Record<string, Record<string, unknown>> = {};
      for (const [key, value] of Object.entries(raw)) {
        const dotIdx = key.indexOf('.');
        if (dotIdx === -1) continue;
        const adapterId = key.slice(0, dotIdx);
        const field = key.slice(dotIdx + 1);
        if (!providers[adapterId]) providers[adapterId] = {};
        providers[adapterId][field] = value;
      }
      for (const id of Object.keys(providers)) {
        const provider = providers[id]!;
        if (provider.skipPermissions === 'true' && !provider.defaultMode) {
          provider.defaultMode = 'yolo';
        }
        delete provider.skipPermissions;
      }
      normalizeProviderDefaultModels(providers, ctx);
      const ids = new Set<string>(Object.keys(providers));
      for (const a of ctx.adapters.getAll()) ids.add(a.id);
      const idList = Array.from(ids);
      const resolved = await Promise.all(
        idList.map((id) => resolveAdapterExecutableCached(id, { settings: ctx.db.settings, run: defaultRun })),
      );
      const out: Record<string, Record<string, unknown>> = {};
      idList.forEach((id, i) => {
        out[id] = { ...(providers[id] ?? {}) };
        out[id].resolvedExecutable = resolved[i];
      });
      res.json({ success: true, data: out });
    }),
  );

  router.put('/api/settings/providers/:adapterId', (req: Request, res: Response) => {
    const { adapterId } = req.params;
    const parsed = validate(UpdateProviderSettingsBody, req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error });
      return;
    }
    const {
      defaultModel,
      defaultMode,
      defaultPlanMode,
      executablePath,
      systemPrompt,
      defaultEffort,
      defaultFast,
      defaultUltracode,
      defaultAdaptiveThinking,
      personality,
      reasoningSummary,
    } = parsed.data;

    if (defaultModel !== undefined) {
      if (defaultModel) ctx.db.settings.set('provider', `${adapterId}.defaultModel`, defaultModel);
      else ctx.db.settings.delete('provider', `${adapterId}.defaultModel`);
    }
    if (defaultMode !== undefined) {
      if (defaultMode) ctx.db.settings.set('provider', `${adapterId}.defaultMode`, defaultMode);
      else ctx.db.settings.delete('provider', `${adapterId}.defaultMode`);
      ctx.db.settings.delete('provider', `${adapterId}.skipPermissions`);
    }
    if (defaultPlanMode !== undefined) {
      if (defaultPlanMode) ctx.db.settings.set('provider', `${adapterId}.defaultPlanMode`, defaultPlanMode);
      else ctx.db.settings.delete('provider', `${adapterId}.defaultPlanMode`);
    }
    if (executablePath !== undefined) {
      if (executablePath) ctx.db.settings.set('provider', `${adapterId}.executablePath`, executablePath);
      else ctx.db.settings.delete('provider', `${adapterId}.executablePath`);
    }
    if (systemPrompt !== undefined) {
      if (systemPrompt) ctx.db.settings.set('provider', `${adapterId}.systemPrompt`, systemPrompt);
      else ctx.db.settings.delete('provider', `${adapterId}.systemPrompt`);
    }
    if (defaultEffort !== undefined) {
      if (defaultEffort) ctx.db.settings.set('provider', `${adapterId}.defaultEffort`, defaultEffort);
      else ctx.db.settings.delete('provider', `${adapterId}.defaultEffort`);
    }
    if (defaultFast !== undefined) {
      if (defaultFast) ctx.db.settings.set('provider', `${adapterId}.defaultFast`, defaultFast);
      else ctx.db.settings.delete('provider', `${adapterId}.defaultFast`);
    }
    if (defaultUltracode !== undefined) {
      if (defaultUltracode) ctx.db.settings.set('provider', `${adapterId}.defaultUltracode`, defaultUltracode);
      else ctx.db.settings.delete('provider', `${adapterId}.defaultUltracode`);
    }
    if (defaultAdaptiveThinking !== undefined) {
      if (defaultAdaptiveThinking)
        ctx.db.settings.set('provider', `${adapterId}.defaultAdaptiveThinking`, defaultAdaptiveThinking);
      else ctx.db.settings.delete('provider', `${adapterId}.defaultAdaptiveThinking`);
    }
    if (personality !== undefined) {
      if (personality) ctx.db.settings.set('provider', `${adapterId}.personality`, personality);
      else ctx.db.settings.delete('provider', `${adapterId}.personality`);
    }
    if (reasoningSummary !== undefined) {
      if (reasoningSummary) ctx.db.settings.set('provider', `${adapterId}.reasoningSummary`, reasoningSummary);
      else ctx.db.settings.delete('provider', `${adapterId}.reasoningSummary`);
    }

    res.json({ success: true });
  });

  // Claude Code config conflict detection
  router.get(
    '/api/adapters/:adapterId/config-conflicts',
    asyncHandler(async (req: Request, res: Response) => {
      if (req.params.adapterId !== 'claude') {
        res.json({ success: true, data: { conflicts: [] } });
        return;
      }

      const conflicts: string[] = [];
      const settingsPath = path.join(homedir(), '.claude', 'settings.json');
      try {
        const raw = await readFile(settingsPath, 'utf-8');
        const settings = JSON.parse(raw);
        if (settings.permissions?.defaultMode) conflicts.push('defaultMode');
        if (settings.permissions?.allow) conflicts.push('allowedTools');
        if (settings.permissions?.deny) conflicts.push('deniedTools');
      } catch {
        // File doesn't exist or is invalid — no conflicts
      }
      res.json({ success: true, data: { conflicts } });
    }),
  );

  return router;
}
