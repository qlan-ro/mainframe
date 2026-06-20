import { describe, it, expect } from 'vitest';
import { symbolKindLabel } from '../symbol-kind';

describe('symbolKindLabel', () => {
  it('maps known LSP SymbolKind numbers to short labels', () => {
    expect(symbolKindLabel(12)).toBe('fn');     // Function
    expect(symbolKindLabel(6)).toBe('fn');      // Method
    expect(symbolKindLabel(5)).toBe('class');   // Class
    expect(symbolKindLabel(11)).toBe('iface');  // Interface
    expect(symbolKindLabel(26)).toBe('type');   // TypeParameter
    expect(symbolKindLabel(14)).toBe('const');  // Constant
    expect(symbolKindLabel(13)).toBe('var');    // Variable
    expect(symbolKindLabel(10)).toBe('enum');   // Enum
  });

  it('falls back to "sym" for unknown kinds', () => {
    expect(symbolKindLabel(999)).toBe('sym');
    expect(symbolKindLabel(0)).toBe('sym');
  });
});
