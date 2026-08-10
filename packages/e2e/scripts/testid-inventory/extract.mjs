const DEFINITION_ATTR_RE = /\b(?:data-testid|testId|testIdPrefix)=(?:"([^"]*)"|\{`([^`]*)`\})/g;
const GET_BY_TEST_ID_RE = /getByTestId\((?:'([^']*)'|"([^"]*)"|`([^`]*)`)\)/g;
const ATTR_SELECTOR_RE = /\[data-testid=(?:"([^"]*)"|'([^']*)')\]/g;
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
  if (templateStart === -1) return { prefix: value, templated: false };
  const prefix = value.slice(0, templateStart);
  if (prefix.length < MIN_TEMPLATE_PREFIX_LENGTH) return null;
  return { prefix, templated: true };
}

/** @param {string} sourceText @returns {Array<{ prefix: string, templated: boolean }>} */
export function collectDefinitions(sourceText) {
  const definitions = [];
  for (const match of sourceText.matchAll(DEFINITION_ATTR_RE)) {
    const quoted = match[1];
    const templated = match[2];
    const definition = quoted !== undefined ? { prefix: quoted, templated: false } : toDefinition(templated);
    if (definition) definitions.push(definition);
  }
  return definitions;
}

/**
 * Three independent scans (one per quote style) rather than one consuming
 * pass: a spec's `'[data-testid="x"]'` is a single-quoted literal that also
 * contains a nested double-quoted token, and both readings are wanted.
 * @param {string} text
 * @returns {string[]}
 */
export function stringLiterals(text) {
  const literals = [];
  for (const match of text.matchAll(/'([^']*)'/g)) literals.push(match[1]);
  for (const match of text.matchAll(/"([^"]*)"/g)) literals.push(match[1]);
  for (const match of text.matchAll(/`([^`]*)`/g)) {
    const templateStart = match[1].indexOf('${');
    literals.push(templateStart === -1 ? match[1] : match[1].slice(0, templateStart));
  }
  return literals;
}

/** @param {string} specText @returns {{ broad: string[], strict: Array<{ prefix: string, templated: boolean }> }} */
export function collectReferences(specText) {
  const broad = stringLiterals(specText).filter((token) => token.length >= MIN_BROAD_TOKEN_LENGTH);

  const strict = [];
  for (const match of specText.matchAll(GET_BY_TEST_ID_RE)) {
    const quoted = match[1] ?? match[2];
    const definition = quoted !== undefined ? { prefix: quoted, templated: false } : toDefinition(match[3]);
    if (definition) strict.push(definition);
  }
  for (const match of specText.matchAll(ATTR_SELECTOR_RE)) {
    strict.push({ prefix: match[1] ?? match[2], templated: false });
  }
  return { broad, strict };
}
