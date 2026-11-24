// The prototype numbers tool cards and markers with one counter for its whole life, so a state's ids depend on every
// state captured before it. Numbers them per state instead, prefixed with the state to stay unique on a board.
exports.numberIds = (html, state) => {
  const ids = new Map();
  return html.replace(/\b(id|aria-controls)="((?:tc|mk)\d+)"/g, (_, attribute, id) => {
    if (!ids.has(id)) ids.set(id, `${state}-${id.slice(0, 2)}${ids.size + 1}`);
    return `${attribute}="${ids.get(id)}"`;
  });
};
