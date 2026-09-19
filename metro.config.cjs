const { getSentryExpoConfig } = require('@sentry/react-native/metro');
const fs = require('node:fs');
const path = require('node:path');
const { syncBootLoadingHtml } = require('./packages/volna-messaging-client/src/loading-tokens');
const { matrixWasmMiddleware } = require('./packages/volna-messaging-client/metro.cjs');
// Keep the pre-JavaScript shell derived from the same loading module on start/export.
const bootPath = path.join(__dirname, 'public/index.html');
const bootHtml = fs.readFileSync(bootPath, 'utf8');
const syncedBootHtml = syncBootLoadingHtml(bootHtml);
if (syncedBootHtml !== bootHtml) fs.writeFileSync(bootPath, syncedBootHtml);

const config = getSentryExpoConfig(__dirname);
const enhanceExpoMiddleware = config.server.enhanceMiddleware;
config.server.enhanceMiddleware = (middleware, server) => {
  const enhanced = enhanceExpoMiddleware ? enhanceExpoMiddleware(middleware, server) : middleware;
  return (request, response, next) => matrixWasmMiddleware(request, response, () => enhanced(request, response, next));
};
// Backend watch builds delete/recreate dist. Neither those files nor local SDK
// build caches are client inputs; watching them races Metro's Windows crawler.
const projectPattern = __dirname.replaceAll('\\', '/').replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replaceAll('/', '[\\\\/]');
const excludedClientInputs = new RegExp(`^${projectPattern}[\\\\/](?:apps[\\\\/]api|\\.cache|\\.logs|\\.matrix)(?:[\\\\/]|$)`);
const existingBlockList = config.resolver.blockList;
config.resolver.blockList = [
  ...(Array.isArray(existingBlockList) ? existingBlockList : existingBlockList ? [existingBlockList] : []),
  excludedClientInputs,
];
const rewriteExpoRequestUrl = config.server.rewriteRequestUrl;

config.server.rewriteRequestUrl = (requestUrl) => {
  const parsed = new URL(requestUrl, 'http://localhost');

  // Expo Router web registers the current browser pathname as an HMR entry
  // point. On a deep link such as /volna Metro would otherwise try to import
  // a non-existent root module named ./volna and terminate the dev server.
  // Every route-level web entry must resolve through Expo Router's virtual
  // entry; actual *.bundle requests keep their original module path.
  if (parsed.searchParams.get('platform') === 'web' && !parsed.pathname.endsWith('.bundle')) {
    parsed.pathname = '/.expo/.virtual-metro-entry.bundle';
    const normalized = requestUrl.startsWith('/')
      ? `${parsed.pathname}${parsed.search}`
      : parsed.toString();
    return rewriteExpoRequestUrl(normalized);
  }

  return rewriteExpoRequestUrl(requestUrl);
};

module.exports = config;
