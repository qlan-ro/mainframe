/**
 * synthesizeDraftChat — pure function, no mocks needed.
 *
 * Verifies the field-mapping contract between DraftCfg and the produced Chat.
 * Every expectation is hardcoded — the test states the outcome, not re-derives it.
 */
import { describe, it, expect } from 'vitest';
import { synthesizeDraftChat } from '../synthesize-draft-chat';
import type { DraftCfg } from '@/features/sessions/runtime/draft-config';

// ---------------------------------------------------------------------------
// 1. Core field mapping
// ---------------------------------------------------------------------------

describe('synthesizeDraftChat — maps base fields', () => {
  it('maps adapterId, projectId, model from the draft', () => {
    const draft: DraftCfg = {
      projectId: 'proj-1',
      adapterId: 'claude',
      model: 'claude-3-sonnet',
      permissionMode: 'default',
    };

    const chat = synthesizeDraftChat('__LOCALID_abc', draft);

    expect(chat.id).toBe('__LOCALID_abc');
    expect(chat.adapterId).toBe('claude');
    expect(chat.projectId).toBe('proj-1');
    expect(chat.model).toBe('claude-3-sonnet');
  });

  it('maps permissionMode "default" directly', () => {
    const draft: DraftCfg = { projectId: 'p1', adapterId: 'claude', permissionMode: 'default' };

    const chat = synthesizeDraftChat('__LOCALID_x', draft);

    expect(chat.permissionMode).toBe('default');
  });

  it('maps permissionMode "acceptEdits" directly', () => {
    const draft: DraftCfg = { projectId: 'p1', adapterId: 'claude', permissionMode: 'acceptEdits' };

    const chat = synthesizeDraftChat('__LOCALID_x', draft);

    expect(chat.permissionMode).toBe('acceptEdits');
  });

  it('maps permissionMode "yolo" directly', () => {
    const draft: DraftCfg = { projectId: 'p1', adapterId: 'claude', permissionMode: 'yolo' };

    const chat = synthesizeDraftChat('__LOCALID_x', draft);

    expect(chat.permissionMode).toBe('yolo');
  });
});

// ---------------------------------------------------------------------------
// 2. permissionMode:'plan' → planMode:true, permissionMode:'default'
// ---------------------------------------------------------------------------

describe('synthesizeDraftChat — permissionMode "plan" normalisation', () => {
  it('sets planMode=true and normalises permissionMode to "default"', () => {
    const draft: DraftCfg = { projectId: 'p1', adapterId: 'claude', permissionMode: 'plan' };

    const chat = synthesizeDraftChat('__LOCALID_x', draft);

    expect(chat.planMode).toBe(true);
    expect(chat.permissionMode).toBe('default');
  });
});

// ---------------------------------------------------------------------------
// 3. Explicit planMode field overrides the permissionMode-derived value
// ---------------------------------------------------------------------------

describe('synthesizeDraftChat — explicit planMode field', () => {
  it('uses planMode:true when set on the draft regardless of permissionMode', () => {
    const draft: DraftCfg = {
      projectId: 'p1',
      adapterId: 'claude',
      permissionMode: 'default',
      planMode: true,
    };

    const chat = synthesizeDraftChat('__LOCALID_x', draft);

    expect(chat.planMode).toBe(true);
  });

  it('uses planMode:false when set on the draft with permissionMode "default"', () => {
    const draft: DraftCfg = {
      projectId: 'p1',
      adapterId: 'claude',
      permissionMode: 'default',
      planMode: false,
    };

    const chat = synthesizeDraftChat('__LOCALID_x', draft);

    expect(chat.planMode).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. Missing tuning → null flags
// ---------------------------------------------------------------------------

describe('synthesizeDraftChat — missing tuning fields become null', () => {
  it('effort, fast, ultracode, adaptiveThinking are null when absent in the draft', () => {
    const draft: DraftCfg = { projectId: 'p1', adapterId: 'claude', permissionMode: 'default' };

    const chat = synthesizeDraftChat('__LOCALID_x', draft);

    expect(chat.effort).toBeNull();
    expect(chat.fast).toBeNull();
    expect(chat.ultracode).toBeNull();
    expect(chat.adaptiveThinking).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5. Tuning fields are forwarded when present
// ---------------------------------------------------------------------------

describe('synthesizeDraftChat — tuning fields forwarded', () => {
  it('forwards effort, fast, ultracode, adaptiveThinking when set', () => {
    const draft: DraftCfg = {
      projectId: 'p1',
      adapterId: 'claude',
      permissionMode: 'default',
      effort: 'high',
      fast: false,
      ultracode: true,
      adaptiveThinking: null,
    };

    const chat = synthesizeDraftChat('__LOCALID_x', draft);

    expect(chat.effort).toBe('high');
    expect(chat.fast).toBe(false);
    expect(chat.ultracode).toBe(true);
    expect(chat.adaptiveThinking).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 6. Placeholder fields have inert values
// ---------------------------------------------------------------------------

describe('synthesizeDraftChat — placeholder fields', () => {
  it('sets status to "active", totalCost to 0, and worktreeMissing to false', () => {
    const draft: DraftCfg = { projectId: 'p1', adapterId: 'claude', permissionMode: 'default' };

    const chat = synthesizeDraftChat('__LOCALID_x', draft);

    expect(chat.status).toBe('active');
    expect(chat.totalCost).toBe(0);
    expect(chat.worktreeMissing).toBe(false);
  });
});
