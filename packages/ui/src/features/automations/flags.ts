/**
 * Automations v2 feature flags.
 */

/**
 * Describe-it (the "draft it" flow, Phase 5) has no drafting endpoint in the
 * contract — REST route list (§4) carries no such verb. Ship the UI behind
 * this flag with a fixture-backed draft until the Node plan adds one.
 */
export const DESCRIBE_ENABLED = false;
