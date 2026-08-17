/**
 * ChipButton — the Agent card's toolbar chip (todo #234 T15). Chips carry
 * the *value* only; the field name lives on `title`/`aria-label`, matching
 * the composer's `PermissionSelect` precedent.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Sparkles } from 'lucide-react';
import { ChipButton } from '../ChipButton';

describe('ChipButton', () => {
  it('renders the value as its only visible text, with the descriptive label on aria-label', () => {
    render(
      <ChipButton icon={Sparkles} label="Model: Claude · Sonnet 5" testId="agent-a-model">
        Sonnet 5
      </ChipButton>,
    );
    const chip = screen.getByTestId('agent-a-model');
    expect(chip).toHaveTextContent('Sonnet 5');
    expect(chip).not.toHaveTextContent('Model:');
    expect(chip).toHaveAttribute('aria-label', 'Model: Claude · Sonnet 5');
    expect(chip).not.toHaveAttribute('title');
  });

  it('carries the open-state highlight classes so the chip lights up while its menu is up', () => {
    render(
      <ChipButton icon={Sparkles} label="Model" testId="agent-a-model">
        Sonnet 5
      </ChipButton>,
    );
    const chip = screen.getByTestId('agent-a-model');
    expect(chip.className).toContain('data-[state=open]:border-primary');
    expect(chip.className).toContain('data-[state=open]:bg-sidebar-selection');
  });

  it('renders destructive when flagged, muted otherwise', () => {
    const { rerender } = render(
      <ChipButton icon={Sparkles} label="Permission" testId="agent-a-permission">
        Interactive
      </ChipButton>,
    );
    expect(screen.getByTestId('agent-a-permission').className).toContain('text-muted-foreground');
    expect(screen.getByTestId('agent-a-permission').className).not.toContain('text-destructive');

    rerender(
      <ChipButton icon={Sparkles} label="Permission" testId="agent-a-permission" destructive>
        Unattended
      </ChipButton>,
    );
    expect(screen.getByTestId('agent-a-permission').className).toContain('text-destructive');
  });

  it('renders caution as a warning tint, and lets destructive outrank it', () => {
    const { rerender } = render(
      <ChipButton icon={Sparkles} label="Permission" testId="agent-a-permission" caution>
        Auto
      </ChipButton>,
    );
    expect(screen.getByTestId('agent-a-permission').className).toContain('text-warning');
    expect(screen.getByTestId('agent-a-permission').className).not.toContain('text-destructive');

    rerender(
      <ChipButton icon={Sparkles} label="Permission" testId="agent-a-permission" caution destructive>
        Unattended
      </ChipButton>,
    );
    expect(screen.getByTestId('agent-a-permission').className).toContain('text-destructive');
  });

  it('forwards clicks and native button props', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <ChipButton icon={Sparkles} label="Model" testId="agent-a-model" onClick={onClick}>
        Sonnet 5
      </ChipButton>,
    );
    await user.click(screen.getByTestId('agent-a-model'));
    expect(onClick).toHaveBeenCalledOnce();
    expect(screen.getByTestId('agent-a-model')).toHaveAttribute('type', 'button');
  });
});
