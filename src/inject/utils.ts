import { parseUrl } from "../url";
import { isCdnUrl } from "../cdn";

export function extractOriginalUrl(url: string | null): string | null {
  if (!url || typeof url !== "string") return url;

  if (url.includes("#http")) {
    const hashIndex = url.indexOf("#http");
    const extractedUrl = url.substring(hashIndex + 1);
    console.log(`[URL Debug] Extracted from hash format: ${extractedUrl}`);
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

export function rewriteUrl(
  url: string,
  proxyURL: string,
  originURL: string,
  mod: string = "mp_"
): string {
  if (!url || typeof url !== "string") return url;

  try {
    const specialProtocols = [
      "javascript:",
      "data:",
      "#",
      "blob:",
      "about:",
      "mailto:",
    ];
    if (specialProtocols.some((protocol) => url.startsWith(protocol))) {
      return url;
    }

    if (url.includes(proxyURL)) {
      return url;
    }

    let fullUrl = "";
    try {
      fullUrl = parseUrl(url, originURL);
    } catch (e) {
      console.warn(`[URL Rewriter] Failed to parse URL: ${url}`, e);
      return url;
    }

    const isHashMode = self.location.href.includes("#http");

    if (isHashMode) {
      return `${proxyURL}/#${fullUrl}`;
    } else {
      return `${proxyURL}/w/liveproxy/${mod}/${fullUrl}`;
    }
  } catch (error) {
    console.error(`[URL Rewriter] Error rewriting URL: ${url}`, error);
    return url;
  }
}
