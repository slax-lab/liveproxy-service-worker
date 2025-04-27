export function extractOriginalUrl(url: string): string {
  //@ts-ignore
  const newProxyMatch = url.match(window.proxyPrefixPathRegexp);
  if (newProxyMatch) {
    return newProxyMatch[4];
  }

  const oldProxyMatch = url.match(/\/proxy\/[^\/]*([a-z_]+)\/(.+)/);
  if (oldProxyMatch) {
    return oldProxyMatch[2];
  }

  return url;
}
