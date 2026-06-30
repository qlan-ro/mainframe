/**
 * Hint component unit tests.
 *
 * Contract being pinned:
 *  - Non-empty string label: child renders inside a tooltip trigger; hovering the
 *    trigger reveals a tooltip containing the exact label text.
 *  - Empty string label: child renders bare — no tooltip wrapper, no tooltip content
 *    appears even when the test provides a live TooltipProvider.
 *  - undefined label: same bare-render behavior as empty string.
 *  - null label: same bare-render behavior as empty string.
 *  - Child props (data-testid, onClick) are preserved when Hint wraps in a tooltip.
 *
 * Uses a TooltipProvider with delayDuration={0} so Radix opens the portal
 * synchronously on hover/focus without requiring fake timers.
 *
 * Radix renders the label text twice: once in the visible tooltip div and once in a
 * visually-hidden span with role="tooltip". We use getByRole('tooltip') to target
 * the accessible element that Radix uses as the canonical tooltip text source.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { TooltipProvider } from '../tooltip';
import { Hint, DismissibleHint } from '../hint';

function renderWithProvider(ui: React.ReactElement) {
  return render(<TooltipProvider delayDuration={0}>{ui}</TooltipProvider>);
}

describe('Hint', () => {
  describe('non-empty string label', () => {
    it('renders the trigger child in the document', () => {
      renderWithProvider(
        <Hint label="Save file">
          <button data-testid="save-btn">Save</button>
        </Hint>,
      );
      expect(screen.getByTestId('save-btn')).toBeInTheDocument();
    });

    it('shows the label text in the tooltip when the trigger is hovered', async () => {
      const user = userEvent.setup();
      renderWithProvider(
        <Hint label="Save file">
          <button data-testid="save-btn">Save</button>
        </Hint>,
      );
      await user.hover(screen.getByTestId('save-btn'));
      // Radix renders an accessible span[role="tooltip"] containing the label text.
      const tooltip = screen.getByRole('tooltip');
      expect(tooltip).toHaveTextContent('Save file');
    });

    it('shows the label text when the trigger is focused', async () => {
      const user = userEvent.setup();
      renderWithProvider(
        <Hint label="Delete item">
          <button data-testid="delete-btn">Delete</button>
        </Hint>,
      );
      await user.tab();
      expect(document.activeElement).toBe(screen.getByTestId('delete-btn'));
      const tooltip = screen.getByRole('tooltip');
      expect(tooltip).toHaveTextContent('Delete item');
    });

    it('does not show the tooltip content before the trigger is hovered', () => {
      // The tooltip content must not be present at initial render — it should only
      // appear after an interaction. This also verifies the Hint does not eagerly
      // render the label outside the Radix portal.
      renderWithProvider(
        <Hint label="Open settings">
          <button data-testid="settings-btn">Settings</button>
        </Hint>,
      );
      // No hover yet — role="tooltip" must not be in the document.
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    });
  });

  describe('empty string label', () => {
    it('renders the child directly without a tooltip wrapper', () => {
      renderWithProvider(
        <Hint label="">
          <button data-testid="bare-btn">Action</button>
        </Hint>,
      );
      expect(screen.getByTestId('bare-btn')).toBeInTheDocument();
    });

    it('does not show a tooltip role element on hover when label is empty string', async () => {
      const user = userEvent.setup();
      // TooltipProvider is active so a tooltip COULD appear if Hint wrongly rendered one.
      renderWithProvider(
        <Hint label="">
          <button data-testid="bare-btn">Action</button>
        </Hint>,
      );
      await user.hover(screen.getByTestId('bare-btn'));
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    });
  });

  describe('undefined label', () => {
    it('renders the child directly without a tooltip wrapper', () => {
      renderWithProvider(
        <Hint label={undefined}>
          <button data-testid="undef-btn">Action</button>
        </Hint>,
      );
      expect(screen.getByTestId('undef-btn')).toBeInTheDocument();
    });

    it('does not show a tooltip role element on hover when label is undefined', async () => {
      const user = userEvent.setup();
      renderWithProvider(
        <Hint label={undefined}>
          <button data-testid="undef-btn">Action</button>
        </Hint>,
      );
      await user.hover(screen.getByTestId('undef-btn'));
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    });
  });

  describe('null label', () => {
    it('renders the child directly without a tooltip wrapper', () => {
      renderWithProvider(
        <Hint label={null}>
          <button data-testid="null-btn">Action</button>
        </Hint>,
      );
      expect(screen.getByTestId('null-btn')).toBeInTheDocument();
    });

    it('does not show a tooltip role element on hover when label is null', async () => {
      const user = userEvent.setup();
      renderWithProvider(
        <Hint label={null}>
          <button data-testid="null-btn">Action</button>
        </Hint>,
      );
      await user.hover(screen.getByTestId('null-btn'));
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    });
  });

  describe('child props forwarding', () => {
    it('preserves data-testid on the child when wrapped in a tooltip', () => {
      renderWithProvider(
        <Hint label="Copy to clipboard">
          <button data-testid="copy-btn">Copy</button>
        </Hint>,
      );
      expect(screen.getByTestId('copy-btn')).toBeInTheDocument();
    });

    it('fires the onClick handler on the wrapped child when clicked', async () => {
      const handleClick = vi.fn();
      const user = userEvent.setup();
      renderWithProvider(
        <Hint label="Copy to clipboard">
          <button data-testid="copy-btn" onClick={handleClick}>
            Copy
          </button>
        </Hint>,
      );
      await user.click(screen.getByTestId('copy-btn'));
      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('renders a ReactNode label (JSX) in the tooltip content', async () => {
      const user = userEvent.setup();
      renderWithProvider(
        <Hint label={<strong>Rich label</strong>}>
          <button data-testid="rich-trigger">Trigger</button>
        </Hint>,
      );
      await user.hover(screen.getByTestId('rich-trigger'));
      // The role="tooltip" element is the accessible label holder; it contains the text.
      const tooltip = screen.getByRole('tooltip');
      expect(tooltip).toHaveTextContent('Rich label');
    });
  });

  describe('DismissibleHint', () => {
    it('shows the label and a dismiss affordance in the tooltip when not dismissed', async () => {
      const user = userEvent.setup();
      render(
        <DismissibleHint
          label="Right-click for options"
          dismissed={false}
          onDismiss={() => undefined}
          dismissTestId="dismiss"
        >
          <button data-testid="pill">Pill</button>
        </DismissibleHint>,
      );
      await user.hover(screen.getByTestId('pill'));
      expect(screen.getByRole('tooltip')).toHaveTextContent('Right-click for options');
      // Radix mirrors tooltip content into an accessible copy, so the button appears twice.
      expect(screen.getAllByTestId('dismiss')[0]).toHaveTextContent("Don't show anymore");
    });

    it('calls onDismiss when the dismiss affordance is clicked', async () => {
      const onDismiss = vi.fn();
      const user = userEvent.setup();
      render(
        <DismissibleHint
          label="Right-click for options"
          dismissed={false}
          onDismiss={onDismiss}
          dismissTestId="dismiss"
        >
          <button data-testid="pill">Pill</button>
        </DismissibleHint>,
      );
      await user.hover(screen.getByTestId('pill'));
      await user.click(screen.getAllByTestId('dismiss')[0]!);
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it('renders the child bare with no tooltip once dismissed', async () => {
      const user = userEvent.setup();
      render(
        <DismissibleHint label="Right-click for options" dismissed onDismiss={() => undefined} dismissTestId="dismiss">
          <button data-testid="pill">Pill</button>
        </DismissibleHint>,
      );
      expect(screen.getByTestId('pill')).toBeInTheDocument();
      await user.hover(screen.getByTestId('pill'));
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
      expect(screen.queryByTestId('dismiss')).not.toBeInTheDocument();
    });
  });

  describe('side and sideOffset props', () => {
    it('accepts a side prop without crashing and still shows the label', async () => {
      const user = userEvent.setup();
      renderWithProvider(
        <Hint label="Bottom hint" side="bottom">
          <button data-testid="bottom-trigger">Trigger</button>
        </Hint>,
      );
      await user.hover(screen.getByTestId('bottom-trigger'));
      expect(screen.getByRole('tooltip')).toHaveTextContent('Bottom hint');
    });

    it('accepts a sideOffset prop without crashing and still shows the label', async () => {
      const user = userEvent.setup();
      renderWithProvider(
        <Hint label="Offset hint" sideOffset={8}>
          <button data-testid="offset-trigger">Trigger</button>
        </Hint>,
      );
      await user.hover(screen.getByTestId('offset-trigger'));
      expect(screen.getByRole('tooltip')).toHaveTextContent('Offset hint');
    });
  });
});
