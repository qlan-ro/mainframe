import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import type { AdapterInfo, AdapterModel, Chat } from '@qlan-ro/mainframe-types';
import { TooltipProvider } from '@/components/ui/tooltip';
import { selectedModel, withCliModel } from '@/lib/cli-model';
import { ProviderModelSelect } from '../ProviderModelSelect';

const large: AdapterModel = {
  id: 'opus[1m]',
  label: 'Opus 5.5',
  resolvedModel: 'claude-opus-5-5[1m]',
  contextWindow: 1_000_000,
  supportedEfforts: ['low', 'high'],
  defaultEffort: 'high',
};
const base: AdapterModel = { ...large, id: 'opus', resolvedModel: 'claude-opus-5-5' };

function renderPicker(models: AdapterModel[], savedId = 'opus') {
  const adapter = withCliModel(
    { id: 'claude', name: 'Claude Code', installed: true, capabilities: {}, models } as AdapterInfo,
    null,
  );
  const chat = { id: 'chat', adapterId: 'claude', model: savedId, effort: 'low' } as Chat;
  const actions = {
    setAdapter: vi.fn(),
    setModel: vi.fn(),
    setModelTuning: vi.fn(),
    setEffort: vi.fn(),
    setFeature: vi.fn(),
  };
  render(
    <TooltipProvider>
      <ProviderModelSelect
        chat={chat}
        adapters={[adapter]}
        adapter={adapter}
        model={selectedModel(adapter, savedId)}
        locked={true}
        disabled={false}
        {...actions}
      />
    </TooltipProvider>,
  );
  return { chat, ...actions };
}

it('shows one readable native-1M choice and tunes the saved bare alias', async () => {
  const actions = renderPicker([large, base]);
  expect(screen.getByTestId('composer-model-select')).toHaveTextContent('Opus 5.5 · 1M · Low');
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  await user.click(screen.getByTestId('composer-model-select'));
  expect(screen.queryByTestId('composer-model-select-option-opus[1m]')).not.toBeInTheDocument();
  await user.hover(screen.getByTestId('composer-model-select-option-opus'));
  await screen.findByTestId('composer-model-opus-tuning');
  fireEvent.click(screen.getByTestId('composer-model-opus-effort-high'));
  expect(actions.setEffort).toHaveBeenCalledExactlyOnceWith('high');
  expect(actions.setModel).not.toHaveBeenCalled();
  expect(actions.setModelTuning).not.toHaveBeenCalled();
  expect(actions.chat.model).toBe('opus');
});

it('keeps distinct reported context windows selectable by their exact IDs', async () => {
  const actions = renderPicker([large, { ...base, contextWindow: 250_000 }]);
  expect(screen.getByTestId('composer-model-select')).toHaveTextContent('Opus 5.5 · 250K · Low');
  await userEvent.click(screen.getByTestId('composer-model-select'));
  expect(screen.getByTestId('composer-model-select-option-opus')).toHaveTextContent('Opus 5.5 · 250K');
  expect(screen.getByTestId('composer-model-select-option-opus[1m]')).toHaveTextContent('Opus 5.5 · 1M');
  await userEvent.click(screen.getByTestId('composer-model-select-option-opus[1m]'));
  expect(actions.setModel).toHaveBeenCalledExactlyOnceWith('opus[1m]');
});

it('keeps a pinned resolved model selected without a duplicate alias row', async () => {
  const actions = renderPicker([large, base], 'claude-opus-5-5');
  await userEvent.click(screen.getByTestId('composer-model-select'));
  expect(screen.queryByTestId('composer-model-select-option-opus')).not.toBeInTheDocument();
  expect(screen.queryByTestId('composer-model-select-option-opus[1m]')).not.toBeInTheDocument();
  await userEvent.click(screen.getByTestId('composer-model-select-option-claude-opus-5-5'));
  expect(actions.setModel).not.toHaveBeenCalled();
  expect(actions.chat.model).toBe('claude-opus-5-5');
});
