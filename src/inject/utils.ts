export function extractOriginalUrl(url: string | null): string | null {
  if (!url || typeof url !== "string") return url;

  const newProxyMatch = url.match(/\/w\/liveproxy\/[^\/]*([a-z_]+)\/(.+)/);
  if (newProxyMatch) {
    return newProxyMatch[2];
  }

  const oldProxyMatch = url.match(/\/proxy\/[^\/]*([a-z_]+)\/(.+)/);
  if (oldProxyMatch) {
    return oldProxyMatch[2];
  }

  return url;
}
