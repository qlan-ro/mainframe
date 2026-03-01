import { Router, Request, Response } from 'express';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';
import { GENERAL_DEFAULTS } from '@mainframe/types';
import type { RouteContext } from './types.js';
import { validate, UpdateProviderSettingsBody, UpdateGeneralSettingsBody } from './schemas.js';
import { asyncHandler } from './async-handler.js';

export function settingRoutes(ctx: RouteContext): Router {
  const router = Router();

  // General settings
  router.get('/api/settings/general', (_req: Request, res: Response) => {
    const raw = ctx.db.settings.getByCategory('general');
    res.json({
      success: true,
      data: { ...GENERAL_DEFAULTS, ...raw },
    });
  });

  router.put('/api/settings/general', (req: Request, res: Response) => {
    const parsed = validate(UpdateGeneralSettingsBody, req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error });
      return;
    }
    for (const [key, value] of Object.entries(parsed.data)) {
      if (value !== undefined) {
        const defaultVal = GENERAL_DEFAULTS[key as keyof typeof GENERAL_DEFAULTS];
        if (value === defaultVal) ctx.db.settings.delete('general', key);
        else ctx.db.settings.set('general', key, value);
      }
    }
    res.json({ success: true });
  });

  // Provider defaults
  router.get('/api/settings/providers', (_req: Request, res: Response) => {
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
    res.json({ success: true, data: providers });
  });

  router.put('/api/settings/providers/:adapterId', (req: Request, res: Response) => {
    const { adapterId } = req.params;
    const parsed = validate(UpdateProviderSettingsBody, req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error });
      return;
    }
    const { defaultModel, defaultMode, planExecutionMode, executablePath } = parsed.data;

    if (defaultModel !== undefined) {
      if (defaultModel) ctx.db.settings.set('provider', `${adapterId}.defaultModel`, defaultModel);
      else ctx.db.settings.delete('provider', `${adapterId}.defaultModel`);
    }
    if (defaultMode !== undefined) {
      if (defaultMode) ctx.db.settings.set('provider', `${adapterId}.defaultMode`, defaultMode);
      else ctx.db.settings.delete('provider', `${adapterId}.defaultMode`);
      ctx.db.settings.delete('provider', `${adapterId}.skipPermissions`);
    }
    if (planExecutionMode !== undefined) {
      if (planExecutionMode) ctx.db.settings.set('provider', `${adapterId}.planExecutionMode`, planExecutionMode);
      else ctx.db.settings.delete('provider', `${adapterId}.planExecutionMode`);
    }
    if (executablePath !== undefined) {
      if (executablePath) ctx.db.settings.set('provider', `${adapterId}.executablePath`, executablePath);
      else ctx.db.settings.delete('provider', `${adapterId}.executablePath`);
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
