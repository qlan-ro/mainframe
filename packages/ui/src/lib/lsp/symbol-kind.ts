/**
 * Map an LSP SymbolKind enum number (LSP spec §SymbolKind) to a short tag
 * shown on `@` symbol rows in the spotlight palette.
 */
const LABELS: Record<number, string> = {
  5: 'class', // Class
  6: 'fn', // Method
  9: 'fn', // Constructor
  10: 'enum', // Enum
  11: 'iface', // Interface
  12: 'fn', // Function
  13: 'var', // Variable
  14: 'const', // Constant
  22: 'enum', // EnumMember
  23: 'type', // Struct
  26: 'type', // TypeParameter
};

export function symbolKindLabel(kind: number): string {
  return LABELS[kind] ?? 'sym';
}
