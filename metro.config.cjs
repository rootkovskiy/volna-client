const { getSentryExpoConfig } = require('@sentry/react-native/metro');

const config = getSentryExpoConfig(__dirname);
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
