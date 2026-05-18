import { describe, expect, it, vi } from 'vitest';
import { applyValueUpdate } from './apply-value-update';

function makeStubEditor(initialValue: string) {
  let modelValue = initialValue;
  const savedState = { scrollTop: 1234, cursor: { line: 42, col: 1 } };
  const setValue = vi.fn((v: string) => {
    modelValue = v;
  });
  const saveViewState = vi.fn(() => savedState);
  const restoreViewState = vi.fn();
  return {
    editor: { saveViewState, restoreViewState } as unknown as Parameters<typeof applyValueUpdate>[0],
    model: {
      getValue: () => modelValue,
      setValue,
    } as unknown as Parameters<typeof applyValueUpdate>[1],
    saveViewState,
    restoreViewState,
    setValue,
    savedState,
  };
}

describe('applyValueUpdate', () => {
  it('saves view state, sets the new value, then restores view state', () => {
    const stub = makeStubEditor('original');
    applyValueUpdate(stub.editor, stub.model, 'changed');

    expect(stub.saveViewState).toHaveBeenCalledOnce();
    expect(stub.setValue).toHaveBeenCalledWith('changed');
    expect(stub.restoreViewState).toHaveBeenCalledWith(stub.savedState);
  });

  it('preserves call order: save → setValue → restore', () => {
    const stub = makeStubEditor('a');
    const order: string[] = [];
    stub.saveViewState.mockImplementation(() => {
      order.push('save');
      return stub.savedState;
    });
    stub.setValue.mockImplementation(() => {
      order.push('setValue');
    });
    stub.restoreViewState.mockImplementation(() => {
      order.push('restore');
    });

    applyValueUpdate(stub.editor, stub.model, 'b');
    expect(order).toEqual(['save', 'setValue', 'restore']);
  });

  it('is a no-op when nextValue equals current value (no setValue, no view state churn)', () => {
    const stub = makeStubEditor('same');
    applyValueUpdate(stub.editor, stub.model, 'same');

    expect(stub.setValue).not.toHaveBeenCalled();
    expect(stub.saveViewState).not.toHaveBeenCalled();
    expect(stub.restoreViewState).not.toHaveBeenCalled();
  });

  it('skips restore when saveViewState returns null (fresh editor with no usable state)', () => {
    const stub = makeStubEditor('a');
    (stub.saveViewState as ReturnType<typeof vi.fn>).mockReturnValueOnce(null);

    applyValueUpdate(stub.editor, stub.model, 'b');
    expect(stub.setValue).toHaveBeenCalledWith('b');
    expect(stub.restoreViewState).not.toHaveBeenCalled();
  });
});
