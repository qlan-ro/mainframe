/**
 * useWorkflowHydration — loads an edit target's YAML and hydrates it into a
 * WfDraft via `parseWorkflowToDraft` (Task 20).
 *
 * `!ok` (schema-invalid/unparseable) and `ok && hasComments` (a hand-authored
 * file whose comments a visual save would silently drop) both render a
 * banner instead of seeding the model — the comments-only case adds an
 * explicit `onConvert` action; the unparseable case has no draft to convert.
 * Extracted out of WorkflowEditor.tsx to keep that file under the size limit.
 */
import { useEffect, useState } from 'react';
import * as wfApi from '@/lib/api/workflows';
import { parseWorkflowToDraft } from './yaml-parse';
import type { WfDraft } from './wf-draft-types';
import type { WfEditorTarget } from '../use-workflows-modal';

export interface HydrationBannerState {
  reason: string;
  rawYaml: string;
  onConvert?: () => void;
}

interface UseWorkflowHydrationResult {
  banner: HydrationBannerState | null;
  hydrating: boolean;
}

export function useWorkflowHydration(
  port: number,
  target: WfEditorTarget,
  onHydrated: (draft: WfDraft) => void,
): UseWorkflowHydrationResult {
  const [banner, setBanner] = useState<HydrationBannerState | null>(null);
  const [hydrating, setHydrating] = useState(target.mode === 'edit');

  useEffect(() => {
    if (target.mode !== 'edit') return;
    let cancelled = false;
    setHydrating(true);
    setBanner(null);

    wfApi
      .getWorkflowSource(port, target.workflowId)
      .then((res) => {
        if (cancelled) return;
        const result = parseWorkflowToDraft(res.yaml);
        if (!result.ok) {
          setBanner({ reason: result.reason, rawYaml: res.yaml });
        } else if (result.hasComments) {
          setBanner({
            reason: 'This file has comments the visual editor cannot preserve — converting will drop them.',
            rawYaml: res.yaml,
            onConvert: () => {
              onHydrated(result.draft);
              setBanner(null);
            },
          });
        } else {
          onHydrated(result.draft);
        }
        setHydrating(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        console.warn('[useWorkflowHydration] failed to load source:', err);
        setBanner({ reason: message, rawYaml: '' });
        setHydrating(false);
      });

    return () => {
      cancelled = true;
    };
  }, [port, target, onHydrated]);

  return { banner, hydrating };
}
