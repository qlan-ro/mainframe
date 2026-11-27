/**
 * Build-only stand-ins for the three HTML plugins Streamdown imports statically
 * for its default `rehypePlugins` (rehype-raw with parse5, rehype-sanitize,
 * rehype-harden). Mainframe passes `rehypePlugins={[]}` (raw HTML renders as
 * text), so none of them ever runs; vite.config.ts resolves them here (for imports from inside streamdown only) so their
 * ~140 KB gzip stays out of the bundle. If a future change passes any of them
 * to Streamdown, remove the plugin.
 */
const unused = () => {
  throw new Error('An HTML rehype plugin was stubbed out of the build; see vite.config.ts');
};

export default unused;
export const harden = unused;
export const defaultSchema = {};
