const DEF_TOKEN_RE = /\b(?:[A-Za-z-]*[tT]est[iI][dD][A-Za-z]*|triggerId)\s*[=:]\s*/g;
const GET_BY_TEST_ID_RE = /getByTestId\((?:'([^']*)'|"([^"]*)"|`([^`]*)`)\)/g;
const ATTR_SELECTOR_RE = /\[data-testid=(?:"([^"]*)"|'([^']*)')\]/g;
const NESTED_QUOTED_RE = /'([^']*)'|"([^"]*)"/g;
const KEBAB_ID_RE = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]*)+$/;
const MIN_TEMPLATE_PREFIX_LENGTH = 4;
const MIN_BROAD_TOKEN_LENGTH = 4;

/**
 * Splits a possibly-templated attribute value into a Definition, discarding
 * templated prefixes too short to be a useful match (empty, or under the
 * 4-char floor a bare `${PREFIX[x]}-unlink-${n}` composite would otherwise pass).
 * @param {string} value
 * @returns {{ prefix: string, templated: boolean } | null}
 */
function toDefinition(value) {
  const templateStart = value.indexOf('${');
  if (templateStart === -1) return value ? { prefix: value, templated: false } : null;
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
function braceDefinitions(code, literals, literalByStart, braceStart) {
  const braceEnd = matchingBrace(code, literalByStart, braceStart);
  const definitions = [];
  for (const literal of literals) {
    if (literal.start <= braceStart || literal.end > braceEnd) continue;
    const definition = toDefinition(literal.value);
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
    const valueStart = match.index + match[0].length;
    const literal = literalByStart.get(valueStart);
    if (literal) {
      const definition = toDefinition(literal.value);
      if (definition) definitions.push(definition);
    } else if (code[valueStart] === '{') {
      definitions.push(...braceDefinitions(code, literals, literalByStart, valueStart));
    }
  }
  return definitions;
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
