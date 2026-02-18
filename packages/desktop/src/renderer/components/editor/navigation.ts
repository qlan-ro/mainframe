import type * as monacoNs from 'monaco-editor';

// --- Import patterns ---

const JS_IMPORT_PATTERNS = [
  /(?:import|export)\s+.*?\s+from\s+['"]([^'"]+)['"]/,
  /import\s+['"]([^'"]+)['"]/,
  /require\s*\(\s*['"]([^'"]+)['"]\s*\)/,
];

const JVM_IMPORT_PATTERN = /import\s+(?:static\s+)?([a-zA-Z_][\w]*(?:\.[a-zA-Z_][\w]*)+)/;

const PY_FROM_IMPORT = /from\s+([a-zA-Z_][\w]*(?:\.[a-zA-Z_][\w]*)*)\s+import/;
const PY_IMPORT = /^import\s+([a-zA-Z_][\w]*(?:\.[a-zA-Z_][\w]*)*)/;

// --- Symbol definition patterns (for same-file go-to-definition) ---

// Scala: def, val, var, lazy val, class, trait, object, type, case class, case object
const SCALA_DEF_KEYWORDS = /(?:def|val|var|lazy\s+val|class|trait|object|type|case\s+class|case\s+object)\s+/;
// Java: method/field declarations, class, interface, enum, record
const JAVA_DEF_KEYWORDS =
  /(?:class|interface|enum|record|void|int|long|double|float|boolean|char|byte|short|String|[A-Z][\w<>,\s]*?)\s+/;
// Python: def, class
const PY_DEF_KEYWORDS = /(?:def|class)\s+/;
// JS/TS: function, class, const, let, var, type, interface, enum
const JS_DEF_KEYWORDS =
  /(?:function|class|const|let|var|type|interface|enum|export\s+(?:default\s+)?(?:function|class|const|let|var|type|interface|enum))\s+/;

// --- Extensions ---

const JS_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];
const JS_INDEX_FILES = JS_EXTENSIONS.map((ext) => `/index${ext}`);

const SCALA_EXTENSIONS = ['.scala', '.sc'];
const JAVA_EXTENSIONS = ['.java'];
const PYTHON_EXTENSIONS = ['.py'];

const JVM_SOURCE_ROOTS = ['src/main/scala', 'src/main/java', 'src/test/scala', 'src/test/java', 'app', 'src'];

// --- Extractors ---

function extractJsImportPath(lineText: string): string | null {
  for (const pattern of JS_IMPORT_PATTERNS) {
    const match = lineText.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

function extractJvmImportPath(lineText: string): string | null {
  const match = lineText.match(JVM_IMPORT_PATTERN);
  if (!match?.[1]) return null;
  const parts = match[1].split('.');
  const last = parts[parts.length - 1]!;
  if (last === '_' || last === '*') {
    return parts.slice(0, -1).join('/');
  }
  return parts.join('/');
}

function extractPyImportPath(lineText: string): string | null {
  const fromMatch = lineText.match(PY_FROM_IMPORT);
  if (fromMatch?.[1]) return fromMatch[1].replace(/\./g, '/');
  const importMatch = lineText.match(PY_IMPORT);
  if (importMatch?.[1]) return importMatch[1].replace(/\./g, '/');
  return null;
}

// --- Path utilities ---

function isRelativeImport(importPath: string): boolean {
  return importPath.startsWith('./') || importPath.startsWith('../');
}

function dirname(filePath: string): string {
  const lastSlash = filePath.lastIndexOf('/');
  return lastSlash >= 0 ? filePath.substring(0, lastSlash) : '';
}

function resolveRelative(base: string, relative: string): string {
  const parts = base.split('/');
  const relParts = relative.split('/');
  for (const part of relParts) {
    if (part === '..') parts.pop();
    else if (part !== '.') parts.push(part);
  }
  return parts.join('/');
}

function findProjectRoot(filePath: string): string {
  const parts = filePath.split('/');
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i] === 'src' || parts[i] === 'app') {
      return parts.slice(0, i).join('/');
    }
  }
  return parts.slice(0, Math.max(1, parts.length - 3)).join('/');
}

// --- Candidate path builders ---

function buildJsCandidatePaths(baseDir: string, importPath: string): string[] {
  const resolved = resolveRelative(baseDir, importPath);
  const candidates: string[] = [resolved];
  for (const ext of JS_EXTENSIONS) candidates.push(resolved + ext);
  for (const indexFile of JS_INDEX_FILES) candidates.push(resolved + indexFile);
  return candidates;
}

function buildJvmCandidatePaths(projectRoot: string, packagePath: string, extensions: string[]): string[] {
  const candidates: string[] = [];
  for (const sourceRoot of JVM_SOURCE_ROOTS) {
    const base = `${projectRoot}/${sourceRoot}/${packagePath}`;
    for (const ext of extensions) candidates.push(base + ext);
  }
  return candidates;
}

function buildPyCandidatePaths(projectRoot: string, modulePath: string): string[] {
  const candidates: string[] = [];
  const roots = ['src', 'lib', 'app', '.'];
  for (const root of roots) {
    const base = root === '.' ? `${projectRoot}/${modulePath}` : `${projectRoot}/${root}/${modulePath}`;
    for (const ext of PYTHON_EXTENSIONS) candidates.push(base + ext);
    candidates.push(`${base}/__init__.py`);
  }
  return candidates;
}

// --- Same-file symbol search ---

function getWordAtPosition(model: monacoNs.editor.ITextModel, position: monacoNs.Position): string | null {
  const wordInfo = model.getWordAtPosition(position);
  return wordInfo?.word ?? null;
}

function findSymbolInModel(
  model: monacoNs.editor.ITextModel,
  symbol: string,
  defPattern: RegExp,
  monaco: typeof monacoNs,
): monacoNs.languages.Definition | null {
  const lineCount = model.getLineCount();
  // Build a regex that matches `<keyword> <symbol>` — the symbol must be at a word boundary
  const symbolEscaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  for (let i = 1; i <= lineCount; i++) {
    const lineText = model.getLineContent(i);
    // Check if line contains a definition keyword followed by the symbol
    const fullPattern = new RegExp(`(?:${defPattern.source})${symbolEscaped}\\b`);
    const match = lineText.match(fullPattern);
    if (match) {
      const col = lineText.indexOf(symbol, match.index ?? 0) + 1;
      return {
        uri: model.uri,
        range: new monaco.Range(i, col, i, col + symbol.length),
      };
    }
  }
  return null;
}

// --- Language configs ---

interface LanguageConfig {
  languageIds: string[];
  defPattern: RegExp;
  resolveImport: (
    model: monacoNs.editor.ITextModel,
    position: monacoNs.Position,
    monaco: typeof monacoNs,
    currentFilePath: string,
  ) => monacoNs.languages.Definition | null;
}

function getLanguageConfig(language: string, currentFilePath: string): LanguageConfig | null {
  if (language === 'typescript' || language === 'javascript') {
    return {
      languageIds: language === 'typescript' ? ['typescript', 'typescriptreact'] : ['javascript', 'javascriptreact'],
      defPattern: JS_DEF_KEYWORDS,
      resolveImport(model, _position, monaco) {
        const lineText = model.getLineContent(_position.lineNumber);
        const importPath = extractJsImportPath(lineText);
        if (!importPath || !isRelativeImport(importPath)) return null;
        const baseDir = dirname(model.uri.path || currentFilePath);
        const candidates = buildJsCandidatePaths(baseDir, importPath);
        return { uri: monaco.Uri.file(candidates[0]!), range: new monaco.Range(1, 1, 1, 1) };
      },
    };
  }

  if (language === 'scala') {
    return {
      languageIds: ['scala'],
      defPattern: SCALA_DEF_KEYWORDS,
      resolveImport(model, _position, monaco) {
        const lineText = model.getLineContent(_position.lineNumber);
        const packagePath = extractJvmImportPath(lineText);
        if (!packagePath) return null;
        const projectRoot = findProjectRoot(model.uri.path || currentFilePath);
        const candidates = buildJvmCandidatePaths(projectRoot, packagePath, SCALA_EXTENSIONS);
        if (candidates.length === 0) return null;
        return { uri: monaco.Uri.file(candidates[0]!), range: new monaco.Range(1, 1, 1, 1) };
      },
    };
  }

  if (language === 'java') {
    return {
      languageIds: ['java'],
      defPattern: JAVA_DEF_KEYWORDS,
      resolveImport(model, _position, monaco) {
        const lineText = model.getLineContent(_position.lineNumber);
        const packagePath = extractJvmImportPath(lineText);
        if (!packagePath) return null;
        const projectRoot = findProjectRoot(model.uri.path || currentFilePath);
        const candidates = buildJvmCandidatePaths(projectRoot, packagePath, JAVA_EXTENSIONS);
        if (candidates.length === 0) return null;
        return { uri: monaco.Uri.file(candidates[0]!), range: new monaco.Range(1, 1, 1, 1) };
      },
    };
  }

  if (language === 'python') {
    return {
      languageIds: ['python'],
      defPattern: PY_DEF_KEYWORDS,
      resolveImport(model, _position, monaco) {
        const lineText = model.getLineContent(_position.lineNumber);
        const modulePath = extractPyImportPath(lineText);
        if (!modulePath) return null;
        const projectRoot = findProjectRoot(model.uri.path || currentFilePath);
        const candidates = buildPyCandidatePaths(projectRoot, modulePath);
        if (candidates.length === 0) return null;
        return { uri: monaco.Uri.file(candidates[0]!), range: new monaco.Range(1, 1, 1, 1) };
      },
    };
  }

  return null;
}

// --- Registration ---

const registeredLanguages = new Set<string>();

export function registerDefinitionProvider(monaco: typeof monacoNs, language: string, currentFilePath: string): void {
  const config = getLanguageConfig(language, currentFilePath);
  if (!config) return;

  for (const langId of config.languageIds) {
    if (registeredLanguages.has(langId)) continue;
    registeredLanguages.add(langId);

    monaco.languages.registerDefinitionProvider(langId, {
      provideDefinition(model, position): monacoNs.languages.ProviderResult<monacoNs.languages.Definition> {
        // 1. Try import-line resolution first
        const importResult = config.resolveImport(model, position, monaco, currentFilePath);
        if (importResult) return importResult;

        // 2. Fall back to same-file symbol search
        const word = getWordAtPosition(model, position);
        if (!word) return null;
        return findSymbolInModel(model, word, config.defPattern, monaco);
      },
    });
  }
}
