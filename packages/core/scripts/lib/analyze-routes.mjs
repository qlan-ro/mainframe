// Static per-endpoint analysis of the route source files. The dynamic router
// walk gives the authoritative method+path list; this fills in request schema
// identifiers, response shapes, and status codes by reading the handler bodies
// with the TypeScript AST (deterministic, no execution).
import ts from 'typescript';
import { readFileSync, readdirSync } from 'node:fs';

const ROUTES_DIR = new URL('../../src/server/routes/', import.meta.url);
const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'all']);
// Non-route modules in the routes/ directory.
const SKIP = new Set(['index.ts', 'types.ts', 'respond.ts', 'schemas.ts', 'path-utils.ts', 'async-handler.ts']);
const GLOBAL_PARSERS = new Set(['JSON', 'Object', 'Array', 'Number', 'Math', 'Date']);

function calleeName(expr) {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text;
  return null;
}

function numericArg(arg) {
  if (arg && ts.isNumericLiteral(arg)) return Number(arg.text);
  return null;
}

function analyzeHandler(node, sf, acc, resolve) {
  const { callables, schemaNames, seen } = resolve;
  // `recursed` is true while descending into a delegated factory/handler body,
  // where a `.safeParse` receiver may be a parameter (`schema`) rather than a
  // real Zod schema — those must not be mistaken for the request schema.
  const visit = (n, recursed) => {
    if (ts.isCallExpression(n)) {
      const name = calleeName(n.expression);
      const args = n.arguments;
      if (name === 'status' || name === 'sendStatus') {
        const code = numericArg(args[0]);
        if (code != null) acc.statusCodes.add(code);
        if (name === 'sendStatus') acc.responses.add('no-body');
      } else if (name === 'json') {
        // Bare res.json(...) → default 200; res.status(N).json(...) already counted N.
        const recv = ts.isPropertyAccessExpression(n.expression) ? n.expression.expression : null;
        const chained = recv && ts.isCallExpression(recv) && calleeName(recv.expression) === 'status';
        if (!chained) acc.statusCodes.add(200);
        acc.responses.add('json');
      } else if (name === 'end') {
        acc.responses.add('no-body');
      } else if (name === 'send') {
        acc.responses.add('raw-send');
      } else if (name === 'ok') {
        acc.statusCodes.add(200);
        acc.responses.add('envelope:ok');
      } else if (name === 'okEmpty') {
        acc.statusCodes.add(200);
        acc.responses.add('envelope:okEmpty');
      } else if (name === 'fail') {
        const code = numericArg(args[1]);
        if (code != null) acc.statusCodes.add(code);
        acc.responses.add('envelope:fail');
      } else if (name === 'validate') {
        if (args[0] && ts.isIdentifier(args[0])) acc.requestSchema = args[0].text;
      } else if (name === 'safeParse' || name === 'parse') {
        const recv = ts.isPropertyAccessExpression(n.expression) ? n.expression.expression : null;
        // Ignore JSON.parse and other global .parse() receivers — only Zod schema idents count.
        if (recv && ts.isIdentifier(recv) && !GLOBAL_PARSERS.has(recv.text)) {
          if (!recursed) acc.requestSchema = recv.text;
          else if (!acc.requestSchema && schemaNames.has(recv.text)) acc.requestSchema = recv.text;
        }
      }
      // Delegated handler/factory: `makeXHandler(...)`, `gitRoute(ctx, Schema, ...)`,
      // or a call to a same-file handler function. Capture a schema passed by
      // argument, then descend into the callee body so its ok/fail/status count.
      if (name && callables.has(name) && !seen.has(name)) {
        for (const a of args) {
          if (ts.isIdentifier(a) && schemaNames.has(a.text) && !acc.requestSchema) acc.requestSchema = a.text;
        }
        seen.add(name);
        acc.delegated = true;
        visit(callables.get(name), true);
      }
    }
    ts.forEachChild(n, (c) => visit(c, recursed));
  };
  visit(node, false);
}

/** Same-file callables (function decls + const arrow/function) → body node, so
 *  delegated handlers can be followed to where their ok/fail actually live. */
function collectCallables(sf) {
  const map = new Map();
  const visit = (n) => {
    if (ts.isFunctionDeclaration(n) && n.name && n.body) map.set(n.name.text, n.body);
    if (
      ts.isVariableDeclaration(n) &&
      n.name &&
      ts.isIdentifier(n.name) &&
      n.initializer &&
      (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))
    ) {
      map.set(n.name.text, n.initializer.body);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return map;
}

/** Identifiers imported from a `*schemas*` module — request-schema candidates
 *  passed by argument to a delegated factory (e.g. git-write's GitCommitBody). */
function collectImportedSchemaNames(sf) {
  const names = new Set();
  for (const stmt of sf.statements) {
    if (
      ts.isImportDeclaration(stmt) &&
      ts.isStringLiteral(stmt.moduleSpecifier) &&
      /schemas/.test(stmt.moduleSpecifier.text) &&
      stmt.importClause?.namedBindings &&
      ts.isNamedImports(stmt.importClause.namedBindings)
    ) {
      for (const el of stmt.importClause.namedBindings.elements) names.add(el.name.text);
    }
  }
  return names;
}

/** Collect top-level `const Name = z.<...>` declarations → source text. */
function collectLocalSchemas(sf) {
  const map = new Map();
  const visit = (n) => {
    if (ts.isVariableDeclaration(n) && n.name && ts.isIdentifier(n.name) && n.initializer) {
      const text = n.initializer.getText(sf);
      if (/^z\s*\./.test(text) || /^z\./.test(text)) map.set(n.name.text, text);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return map;
}

function analyzeFile(fileName) {
  const src = readFileSync(new URL(fileName, ROUTES_DIR), 'utf8');
  const sf = ts.createSourceFile(fileName, src, ts.ScriptTarget.Latest, true);
  const localSchemas = collectLocalSchemas(sf);
  const callables = collectCallables(sf);
  const schemaNames = new Set([...localSchemas.keys(), ...collectImportedSchemaNames(sf)]);
  const endpoints = new Map();

  const visit = (n) => {
    // Local `command(path, method, run, label)` helper in chat-commands.ts:
    // wraps registration with a fixed shape (404 if chat missing, okEmpty on
    // success, fail 500 on error) and no request body.
    if (
      ts.isCallExpression(n) &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === 'command' &&
      n.arguments[0] &&
      ts.isStringLiteral(n.arguments[0]) &&
      n.arguments[1] &&
      ts.isStringLiteral(n.arguments[1])
    ) {
      const method = n.arguments[1].text.toUpperCase();
      endpoints.set(`${method} ${n.arguments[0].text}`, {
        sourceFile: `src/server/routes/${fileName}`,
        statusCodes: [200, 404, 500],
        responses: ['envelope:fail', 'envelope:okEmpty'],
        requestSchema: null,
        localSchemas,
        via: 'command() wrapper',
      });
    }
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      HTTP_METHODS.has(n.expression.name.text) &&
      n.arguments[0] &&
      ts.isStringLiteral(n.arguments[0])
    ) {
      const method = n.expression.name.text.toUpperCase();
      const path = n.arguments[0].text;
      const acc = { statusCodes: new Set(), responses: new Set(), requestSchema: null, delegated: false };
      const seen = new Set();
      for (let i = 1; i < n.arguments.length; i++) {
        analyzeHandler(n.arguments[i], sf, acc, { callables, schemaNames, seen });
      }
      endpoints.set(`${method} ${path}`, {
        sourceFile: `src/server/routes/${fileName}`,
        statusCodes: [...acc.statusCodes].sort((a, b) => a - b),
        responses: [...acc.responses].sort(),
        requestSchema: acc.requestSchema,
        localSchemas,
        ...(acc.delegated ? { via: 'delegated handler' } : {}),
      });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return endpoints;
}

/** Analyze every route file → Map keyed `METHOD /path` → endpoint detail. */
export function analyzeAllRoutes() {
  const all = new Map();
  const files = readdirSync(ROUTES_DIR)
    .filter((f) => f.endsWith('.ts') && !SKIP.has(f))
    .sort();
  for (const file of files) {
    for (const [key, detail] of analyzeFile(file)) all.set(key, detail);
  }
  return all;
}
