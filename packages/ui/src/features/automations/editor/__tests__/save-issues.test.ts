/**
 * save-issues — turns a rejected save into the same `ValidationIssue[]` the
 * client-side `validate()` produces, so a daemon rejection lands on the step
 * that caused it instead of only in a toast.
 *
 * Only a rejection that carries per-item `errors[]` is a verdict on the draft.
 * A detail-less failure (network, 500) says nothing about the steps, so it
 * stays a toast: turning it into an issue would gate Save on a draft the
 * daemon never judged, and the user would have to edit something arbitrary to
 * get a retry.
 */
import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '@/lib/api/http';
import { saveIssuesFrom } from '../save-issues';

describe('saveIssuesFrom', () => {
  it('maps each per-step detail to an error issue pinned to that step', () => {
    const err = new ApiRequestError('two problems', [
      { stepId: 'v1', message: 'Give this value a name.' },
      { stepId: 'n1', message: 'This step uses $nope, but no earlier step defines it.' },
    ]);

    expect(saveIssuesFrom(err)).toEqual([
      { stepId: 'v1', level: 'error', msg: 'Give this value a name.' },
      { stepId: 'n1', level: 'error', msg: 'This step uses $nope, but no earlier step defines it.' },
    ]);
  });

  it('keeps an automation-level detail unpinned so the footer shows it', () => {
    const err = new ApiRequestError('nope', [{ stepId: null, message: 'Give your automation a name.' }]);

    expect(saveIssuesFrom(err)).toEqual([{ stepId: null, level: 'error', msg: 'Give your automation a name.' }]);
  });

  it('reports nothing for a rejection with no per-item errors — the toast owns it', () => {
    expect(saveIssuesFrom(new ApiRequestError('Automation is not valid'))).toEqual([]);
  });

  it('reports nothing for a plain Error, so a network failure never gates Save', () => {
    expect(saveIssuesFrom(new Error('Failed to fetch'))).toEqual([]);
  });

  it('reports nothing for a non-Error rejection', () => {
    expect(saveIssuesFrom('boom')).toEqual([]);
  });
});
