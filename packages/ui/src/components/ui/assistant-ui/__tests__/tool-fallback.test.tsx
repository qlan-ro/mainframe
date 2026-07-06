import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import type { ToolCallMessagePartStatus } from '@assistant-ui/react';
import { ToolFallback } from '../tool-fallback';

const status = (type: string): ToolCallMessagePartStatus => ({ type }) as ToolCallMessagePartStatus;

describe('ToolFallbackTrigger running shimmer', () => {
  it('overlay geometry matches the base label so it does not ghost (text-caption + font-medium)', () => {
    render(
      <ToolFallback.Root defaultOpen>
        <ToolFallback.Trigger toolName="DesignSync" status={status('running')} />
      </ToolFallback.Root>,
    );
    const shimmer = document.querySelector('[data-slot="tool-fallback-trigger-shimmer"]');
    expect(shimmer).not.toBeNull();
    // The running overlay is a duplicate text copy stacked on the base with a
    // sheen sweep; it must render at the SAME size/weight as the base
    // (text-caption 11px + font-medium 500), else it renders wider (13px/700)
    // and misaligns into doubled "Used tool: X" ghosting.
    expect(shimmer!.className).toContain('text-caption');
    expect(shimmer!.querySelector('b')?.className).toContain('font-medium');
  });

  it('renders no shimmer overlay when the tool is not running', () => {
    render(
      <ToolFallback.Root defaultOpen>
        <ToolFallback.Trigger toolName="DesignSync" status={status('complete')} />
      </ToolFallback.Root>,
    );
    expect(document.querySelector('[data-slot="tool-fallback-trigger-shimmer"]')).toBeNull();
  });
});

describe('ToolFallback data-testids (e2e punch-list)', () => {
  it('applies stable data-testids to the root, trigger, args, result, and error slots', () => {
    const errorStatus = {
      type: 'incomplete',
      reason: 'error',
      error: 'boom',
    } as ToolCallMessagePartStatus;

    render(
      <ToolFallback.Root defaultOpen>
        <ToolFallback.Trigger toolName="DesignSync" status={status('complete')} />
        <ToolFallback.Content>
          <ToolFallback.Error status={errorStatus} />
          <ToolFallback.Args argsText='{"foo":"bar"}' />
          <ToolFallback.Result result="done" />
        </ToolFallback.Content>
      </ToolFallback.Root>,
    );

    expect(document.querySelector('[data-testid="chat-tool-fallback-card"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="chat-tool-fallback-trigger"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="chat-tool-fallback-args"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="chat-tool-fallback-result"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="chat-tool-fallback-error"]')).not.toBeNull();
  });
});
