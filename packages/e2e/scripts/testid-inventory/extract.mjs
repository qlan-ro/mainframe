const DEF_TOKEN_RE = /\b([A-Za-z-]*[tT]est[iI][dD][A-Za-z]*|triggerId)\s*[=:]\s*/g;
const GET_BY_TEST_ID_RE = /getByTestId\((?:'([^']*)'|"([^"]*)"|`([^`]*)`)\)/g;
const ATTR_SELECTOR_RE = /\[data-testid=(?:"([^"]*)"|'([^']*)')\]/g;
const NESTED_QUOTED_RE = /'([^']*)'|"([^"]*)"/g;
const KEBAB_ID_RE = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]*)+$/;
const MIN_TEMPLATE_PREFIX_LENGTH = 4;
const MIN_BROAD_TOKEN_LENGTH = 4;
// A single-interpolation `data-testid` template — `${x}-confirm` — composes a
// runtime id from a caller-supplied prefix; the text after `}` is the static
// suffix a prefix definition can be combined with.
const TESTID_SUFFIX_TEMPLATE_RE = /data-testid=\{`\$\{[^{}]*\}([A-Za-z0-9-]+)`\}/g;

/**
 * Splits a possibly-templated attribute value into a Definition, discarding
 * templated prefixes too short to be a useful match (empty, or under the
 * 4-char floor a bare `${PREFIX[x]}-unlink-${n}` composite would otherwise pass).
 * A token name ending in `Prefix` (`itemTestIdPrefix`, `testIdPrefix`) is
 * always templated even when its literal has no `${` — the id it defines is
 * a caller-supplied prefix a component composes with a suffix at render time.
 * @param {string} value @param {string} [tokenName]
 * @returns {{ prefix: string, templated: boolean } | null}
 */
function toDefinition(value, tokenName) {
  const templateStart = value.indexOf('${');
  if (templateStart === -1) {
    if (!value) return null;
    return { prefix: value, templated: Boolean(tokenName?.endsWith('Prefix')) };
  }
  const prefix = value.slice(0, templateStart);
  if (prefix.length < MIN_TEMPLATE_PREFIX_LENGTH) return null;
  return { prefix, templated: true };
}

function blankRange(chars, start, end) {
  for (let i = start; i < end; i += 1) if (chars[i] !== '\n') chars[i] = ' ';
}

/**
 * Reads one quoted run. Unterminated single/double quotes stop at the newline
 * so a lone apostrophe — `card's` in JSX text, a regex class — costs one line
 * instead of desynchronising every literal in the rest of the file.
 * @param {string} text @param {number} start
 */
function readQuoted(text, start) {
  const quote = text[start];
  for (let i = start + 1; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (ch === quote) return { end: i + 1, value: text.slice(start + 1, i), quote };
    if (quote !== '`' && ch === '\n') return { end: i, value: text.slice(start + 1, i), quote };
  }
  return { end: text.length, value: text.slice(start + 1), quote };
}

/**
 * One pass over a source file: comments blanked (length-preserving, so every
 * index still lines up with the original text) and every string literal
 * outside them recorded with its span.
 * @param {string} text
 * @returns {{ code: string, literals: Array<{ start: number, end: number, value: string, quote: string }> }}
 */
export function scanSource(text) {
  const chars = [...text];
  const literals = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '/' && text[i + 1] === '/') {
      const newline = text.indexOf('\n', i);
      const stop = newline === -1 ? text.length : newline;
      blankRange(chars, i, stop);
      i = stop;
    } else if (ch === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2);
      const stop = close === -1 ? text.length : close + 2;
      blankRange(chars, i, stop);
      i = stop;
    } else if (ch === "'" || ch === '"' || ch === '`') {
      const literal = readQuoted(text, i);
      literals.push({ start: i, end: literal.end, value: literal.value, quote: literal.quote });
      i = literal.end;
    } else {
      i += 1;
    }
  }
  return { code: chars.join(''), literals };
}

function matchingBrace(code, literalByStart, start) {
  let depth = 0;
  let i = start;
  while (i < code.length) {
    const literal = literalByStart.get(i);
    if (literal) {
      i = literal.end;
      continue;
    }
    if (code[i] === '{') depth += 1;
    else if (code[i] === '}' && (depth -= 1) === 0) return i;
    i += 1;
  }
  return code.length;
}

/**
 * Definitions from a braced expression — `{cond ? 'a-id' : 'b-id'}`, `{`row-${id}`}`.
 * Both arms count; the kebab guard keeps an incidental `'utf-8'`-shaped operand
 * inside the same expression from minting a definition.
 */
function braceDefinitions(code, literals, literalByStart, braceStart, tokenName) {
  const braceEnd = matchingBrace(code, literalByStart, braceStart);
  const definitions = [];
  for (const literal of literals) {
    if (literal.start <= braceStart || literal.end > braceEnd) continue;
    const definition = toDefinition(literal.value, tokenName);
    if (definition && KEBAB_ID_RE.test(definition.prefix)) definitions.push(definition);
  }
  return definitions;
}

/**
 * Collects every id the UI defines: `data-testid` attributes, the `testId` /
 * `testIdPrefix` / `dismissTestId` prop family, `testid:` object keys in menu
 * and segmented-option descriptors, and `triggerId` (a prop rendered straight
 * into a `data-testid`).
 * @param {string} sourceText @returns {Array<{ prefix: string, templated: boolean }>}
 */
export function collectDefinitions(sourceText) {
  const { code, literals } = scanSource(sourceText);
  const literalByStart = new Map(literals.map((literal) => [literal.start, literal]));
  const definitions = [];
  for (const match of code.matchAll(DEF_TOKEN_RE)) {
    const tokenName = match[1];
    const valueStart = match.index + match[0].length;
    const literal = literalByStart.get(valueStart);
    if (literal) {
      const definition = toDefinition(literal.value, tokenName);
      if (definition) definitions.push(definition);
    } else if (code[valueStart] === '{') {
      definitions.push(...braceDefinitions(code, literals, literalByStart, valueStart, tokenName));
    }
  }
  return definitions;
}

/**
 * Static suffixes a component appends after a single-interpolation prefix in
 * a `data-testid` template — `data-testid={\`${testid}-confirm\`}` yields
 * `-confirm`. Scoped to dead-selector liveness only (see analyze.mjs); a
 * generic suffix rule over-matches for the unused computation.
 * @param {string} sourceText @returns {string[]}
 */
export function collectTestIdSuffixes(sourceText) {
  const { code } = scanSource(sourceText);
  const suffixes = new Set();
  for (const match of code.matchAll(TESTID_SUFFIX_TEMPLATE_RE)) suffixes.add(match[1]);
  return [...suffixes];
}

/**
 * Every literal a spec holds, plus the ids nested inside one — a page object's
 * `'[data-testid="chat-send"]'` is a single literal whose inner token is the
 * reference that matters. Template literals reduce to the text before `${`.
 * @param {string} text
 * @returns {string[]}
 */
export function stringLiterals(text) {
  const { literals } = scanSource(text);
  const values = [];
  for (const { value, quote } of literals) {
    const templateStart = value.indexOf('${');
    values.push(quote === '`' && templateStart !== -1 ? value.slice(0, templateStart) : value);
    for (const nested of value.matchAll(NESTED_QUOTED_RE)) values.push(nested[1] ?? nested[2]);
  }
  return values;
}

/** @param {string} specText @returns {{ broad: string[], strict: Array<{ prefix: string, templated: boolean }> }} */
export function collectReferences(specText) {
  const { code } = scanSource(specText);
  const broad = stringLiterals(specText).filter((token) => token.length >= MIN_BROAD_TOKEN_LENGTH);

  const strict = [];
  for (const match of code.matchAll(GET_BY_TEST_ID_RE)) {
    const quoted = match[1] ?? match[2];
    const definition = quoted !== undefined ? toDefinition(quoted) : toDefinition(match[3]);
    if (definition) strict.push(definition);
  }
  for (const match of code.matchAll(ATTR_SELECTOR_RE)) {
    const definition = toDefinition(match[1] ?? match[2]);
    if (definition) strict.push(definition);
  }
  return { broad, strict };
}
