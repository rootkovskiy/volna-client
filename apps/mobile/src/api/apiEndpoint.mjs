const isLoopback = hostname => hostname === 'localhost' || /^127(?:\.\d{1,3}){3}$/.test(hostname);

// Local Web installations have separate cookie/storage origins per hostname.
// Respect an explicitly configured local API port while retaining that hostname;
// a production API setting must never redirect localhost QA to real accounts.
export function resolveApiEndpoint({ webHostname, configuredUrl }) {
  const configured = configuredUrl?.replace(/\/$/, '');
  if (webHostname && isLoopback(webHostname)) {
    try {
      const endpoint = new URL(configured);
      if (['http:', 'https:'].includes(endpoint.protocol) && isLoopback(endpoint.hostname)
          && !endpoint.username && !endpoint.password) {
        endpoint.hostname = webHostname;
        return endpoint.toString().replace(/\/$/, '');
      }
    } catch { /* No explicit local endpoint: use the established development port. */ }
    return `http://${webHostname}:43101`;
  }
  return configured || 'http://localhost:43101';
}
