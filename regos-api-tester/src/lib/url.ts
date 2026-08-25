const REGOS_INTEGRATION_HOST = "https://integration.regos.uz";
const REGOS_AUTH_HOST = "https://auth.regos.uz";

export const DEFAULT_BASE_URL = `${REGOS_INTEGRATION_HOST}/gateway/out`;
export const DEFAULT_PATH_PREFIX = "/v1/";
export const DEFAULT_OAUTH_TOKEN_URL = `${REGOS_AUTH_HOST}/oauth/token`;

/** Build a Regos gateway URL from freeform parts. No validation. */
export function buildRegosUrl(parts: {
  baseUrl: string;
  token: string;
  pathPrefix: string;
  endpoint: string;
}): string {
  const base = parts.baseUrl.replace(/\/+$/, "");
  const token = parts.token.replace(/^\/+|\/+$/g, "");
  let prefix = parts.pathPrefix.trim();
  if (prefix && !prefix.startsWith("/")) prefix = `/${prefix}`;
  if (prefix && !prefix.endsWith("/")) prefix = `${prefix}/`;
  const endpoint = parts.endpoint.replace(/^\/+/, "");

  const segments = [base];
  if (token) segments.push(token);
  const path = `${prefix}${endpoint}`;
  return `${segments.join("/")}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Rewrite Regos integration / auth URLs through the Vite dev proxy. */
export function applyViteProxy(url: string, useProxy: boolean): string {
  if (!useProxy) return url;

  if (url.startsWith(REGOS_INTEGRATION_HOST)) {
    return `/regos-proxy${url.slice(REGOS_INTEGRATION_HOST.length)}`;
  }
  if (url.startsWith(REGOS_AUTH_HOST)) {
    return `/oauth-proxy${url.slice(REGOS_AUTH_HOST.length)}`;
  }
  return url;
}
