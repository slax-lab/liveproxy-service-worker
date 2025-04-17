export function extractOriginalUrl(url: string | null): string | null {
  if (!url || typeof url !== "string") return url;

  if (url.includes("#http")) {
    const hashIndex = url.indexOf("#http");
    const extractedUrl = url.substring(hashIndex + 1);
    return extractedUrl;
  }

  const newProxyMatch = url.match(/\/w\/liveproxy\/[^\/]*([a-z_]+)\/(.+)/);
  if (newProxyMatch) {
    const extractedUrl = newProxyMatch[2];
    return extractedUrl;
  }

  const oldProxyMatch = url.match(/\/proxy\/[^\/]*([a-z_]+)\/(.+)/);
  if (oldProxyMatch) {
    return oldProxyMatch[2];
  }

  return url;
}
