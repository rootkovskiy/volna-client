import * as Sentry from '@sentry/react-native';

const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN?.trim();

function urlWithoutQuery(value: unknown) {
  if (typeof value !== 'string') return undefined;
  try {
    const parsed = new URL(value);
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return undefined;
  }
}

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment: __DEV__ ? 'development' : 'production',
  sendDefaultPii: false,
  tracesSampleRate: 0.05,
  enableAutoSessionTracking: true,
  beforeBreadcrumb(breadcrumb) {
    if (breadcrumb.category === 'console') return null;
    if (!breadcrumb.data) return breadcrumb;
    const data = { ...breadcrumb.data };
    for (const key of ['body', 'data', 'query', 'request_body', 'response_body']) delete data[key];
    if ('url' in data) {
      const safeUrl = urlWithoutQuery(data.url);
      if (safeUrl) data.url = safeUrl;
      else delete data.url;
    }
    return { ...breadcrumb, data };
  },
  beforeSend(event) {
    delete event.user;
    if (event.request) {
      delete event.request.cookies;
      delete event.request.data;
      delete event.request.query_string;
      const safeUrl = urlWithoutQuery(event.request.url);
      if (safeUrl) event.request.url = safeUrl;
      else delete event.request.url;
      if (event.request.headers) {
        delete event.request.headers.Authorization;
        delete event.request.headers.authorization;
        delete event.request.headers.Cookie;
        delete event.request.headers.cookie;
      }
    }
    return event;
  },
});

export { Sentry };
