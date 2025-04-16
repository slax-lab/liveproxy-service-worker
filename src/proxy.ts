import { completeHtmlRewrite, rewriteCSS, rewriteJS } from "./rewrite";
import { proxyPrefix, REPLAY_URL_PREFIX } from "./config";

export function processResponseHeaders(headers: Headers): Headers {
  const newHeaders = new Headers(headers);

  newHeaders.delete("content-security-policy");
  newHeaders.delete("content-security-policy-report-only");

  newHeaders.set("Access-Control-Allow-Origin", "*");
  newHeaders.set(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, DELETE, OPTIONS"
  );
  newHeaders.set("Access-Control-Allow-Headers", "*");
  newHeaders.set("Access-Control-Allow-Credentials", "true");
  newHeaders.set("Access-Control-Max-Age", "86400");

  newHeaders.delete("strict-transport-security");

  newHeaders.delete("x-frame-options");

  newHeaders.delete("referrer-policy");

  newHeaders.delete("feature-policy");
  newHeaders.delete("permissions-policy");

  newHeaders.delete("cross-origin-resource-policy");
  newHeaders.delete("cross-origin-opener-policy");
  newHeaders.delete("cross-origin-embedder-policy");

  return newHeaders;
}

export async function handleProxyRequest(
  request: Request,
  timestamp: string,
  mod: string,
  origUrl: string
): Promise<Response> {
  // Create the proxy URL (used for both GET and POST requests)
  const proxyUrl = proxyPrefix + origUrl;

  // Common header processing for all request types
  const headers = new Headers();
  for (const [key, value] of request.headers.entries()) {
    if (["host", "origin"].includes(key.toLowerCase())) {
      continue;
    }
    if (key.toLowerCase() === "referer") {
      continue;
    }
    headers.set(key, value);
  }

  // Process referrer for all request types
  const refererUrl = new URL(request.referrer || request.url);
  if (
    refererUrl.pathname.includes("/proxy/") ||
    refererUrl.pathname.includes("/w/liveproxy/")
  ) {
    const refMatch = refererUrl.pathname.match(REPLAY_URL_PREFIX);
    if (refMatch) {
      let refOrigUrl;
      // 优先使用完整URL匹配
      if (refMatch[4]) {
        refOrigUrl = refMatch[4];
      } else if (refMatch[3]) {
        refOrigUrl = refMatch[3];
      }

      if (
        refOrigUrl &&
        !refOrigUrl.startsWith("http://") &&
        !refOrigUrl.startsWith("https://")
      ) {
        refOrigUrl = "https://" + refOrigUrl;
      }

      if (refOrigUrl) {
        headers.set("X-Proxy-Referer", refOrigUrl);
        const currentOrigin = self.location.origin || "";
        const proxyReferer = `${currentOrigin}/w/liveproxy/mp_/${refOrigUrl}`;
        headers.set("Referer", proxyReferer);
      }
    }
  } else {
    // 如果referer不是代理URL，则直接传递
    headers.set("Referer", request.headers.get("Referer") || "");
  }

  headers.set("X-Proxy-User-Agent", request.headers.get("User-Agent")!);

  // Create fetch options for all request types
  const fetchOpts: RequestInit = {
    method: request.method,
    headers: headers,
    mode: "cors" as RequestMode,
    credentials: "include" as RequestCredentials,
    redirect: "manual" as RequestRedirect,
  };

  // Handle request body for POST, PUT, PATCH
  if (["POST", "PUT", "PATCH"].includes(request.method)) {
    console.log(`处理${request.method}请求到: ${proxyUrl}`);

    // Add body to fetch options
    try {
      // Similar to ArchiveRequest.getBody() in paste-3.txt
      if (request.body) {
        if (request.body instanceof ReadableStream) {
          // For stream bodies, use duplex: "half"
          // @ts-ignore
          fetchOpts.duplex = "half";
          fetchOpts.body = request.body;
        } else {
          // For other bodies, use arrayBuffer
          fetchOpts.body = await request.clone().arrayBuffer();
        }
      }
    } catch (error) {
      console.error("Error processing request body:", error);
      return new Response(
        JSON.stringify({
          error: `Request body processing error: ${
            error instanceof Error ? error.message : String(error)
          }`,
          url: origUrl,
          proxyUrl: proxyUrl,
          timestamp: Date.now(),
        }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }
  }

  try {
    // Send the proxy request - using proxyUrl for both GET and POST
    const response = await fetch(proxyUrl, fetchOpts);

    // Process response headers
    const respHeaders = processResponseHeaders(response.headers);

    // Handle redirects
    const redirectStatus = respHeaders.get("x-redirect-status");
    if (redirectStatus) {
      const location = respHeaders.get("x-orig-location");

      if (location) {
        // Create new redirect URL
        let newLocation;

        if (location.startsWith("/")) {
          // Relative path (starts with /)
          const urlObj = new URL(origUrl);
          newLocation = `/w/liveproxy/mp_/${urlObj.origin}${location}`;
        } else if (location.startsWith("http")) {
          // Absolute URL
          newLocation = `/w/liveproxy/mp_/${location}`;
        } else if (location.startsWith("//")) {
          // Protocol-relative URL
          const urlObj = new URL(origUrl);
          newLocation = `/w/liveproxy/mp_/${urlObj.protocol.replace(
            ":",
            ""
          )}:${location}`;
        } else {
          // Relative URL (no leading /)
          const urlObj = new URL(origUrl);
          const pathParts = urlObj.pathname.split("/");
          pathParts.pop();
          const basePath = pathParts.join("/");
          newLocation = `/w/liveproxy/mp_/${urlObj.origin}${basePath}/${location}`;
        }

        // Ensure no double slashes
        newLocation = newLocation.replace(/([^:])\/+/g, "$1/");

        console.log(`重定向到: ${newLocation}`);
        return Response.redirect(newLocation, parseInt(redirectStatus));
      }
    }

    // Clean up proxy headers
    respHeaders.delete("x-redirect-status");
    respHeaders.delete("x-redirect-statustext");
    respHeaders.delete("x-orig-location");
    respHeaders.delete("x-orig-ts");
    respHeaders.delete("x-proxy-set-cookie");

    // For POST/PUT/PATCH requests that don't need content processing, return directly
    if (["POST", "PUT", "PATCH"].includes(request.method)) {
      return new Response(response.body, {
        status: response.status,
        headers: respHeaders,
      });
    }

    // Content type detection and handling (mainly for GET requests)
    let contentType = respHeaders.get("content-type") || "";
    const url = new URL(origUrl);
    const path = url.pathname;

    // Check if there's a response body
    const hasBody =
      response.status !== 204 &&
      response.status !== 304 &&
      response.status !== 101;

    if (!contentType || contentType.includes("application/octet-stream")) {
      if (
        path.endsWith(".js") ||
        path.endsWith(".mjs") ||
        path.endsWith(".cjs")
      ) {
        contentType = "application/javascript";
      } else if (path.endsWith(".css")) {
        contentType = "text/css";
      } else if (path.endsWith(".html") || path.endsWith(".htm")) {
        contentType = "text/html";
      } else if (path.endsWith(".svg")) {
        contentType = "image/svg+xml";
      } else if (/\.(png|jpg|jpeg|gif|webp|avif)$/i.test(path)) {
        const ext = path.split(".").pop();
        contentType = ext ? `image/${ext.toLowerCase()}` : "image/jpeg";
      }
    }

    const contentTypeBase = getContentTypeBase(contentType);

    // Special handling for iframe content - important for CSP bypass
    const isIframeContent =
      mod === "if_" || request.headers.get("Sec-Fetch-Dest") === "iframe";

    // If no response body, return status code and response headers directly
    if (!hasBody) {
      return new Response(null, {
        status: response.status,
        headers: respHeaders,
      });
    }

    // Content type branches
    if (contentTypeBase.includes("text/html") || isIframeContent) {
      const text = await response.text();
      const rewrittenHtml = completeHtmlRewrite(text, origUrl, timestamp);

      // Ensure HTML content type
      respHeaders.set("Content-Type", "text/html; charset=UTF-8");

      return new Response(rewrittenHtml, {
        status: response.status,
        headers: respHeaders,
      });
    } else if (contentTypeBase.includes("text/css")) {
      const text = await response.text();

      const rewrittenCss = rewriteCSS(text, origUrl, timestamp);

      respHeaders.set("Content-Type", "text/css; charset=UTF-8");

      return new Response(rewrittenCss, {
        status: response.status,
        headers: respHeaders,
      });
    } else if (
      contentTypeBase.includes("javascript") ||
      contentTypeBase.includes("application/x-javascript") ||
      contentTypeBase.includes("text/javascript")
    ) {
      const text = await response.text();
      const isModule = contentType.includes("module");
      const rewrittenJs = rewriteJS(text, origUrl, timestamp, isModule);

      if (isModule) {
        respHeaders.set(
          "Content-Type",
          "application/javascript; charset=UTF-8"
        );
      } else {
        respHeaders.set("Content-Type", "text/javascript; charset=UTF-8");
      }

      return new Response(rewrittenJs, {
        status: response.status,
        headers: respHeaders,
      });
    } else if (contentTypeBase.includes("image/")) {
      if (contentType) {
        respHeaders.set("Content-Type", contentType);
      } else if (path.endsWith(".svg")) {
        respHeaders.set("Content-Type", "image/svg+xml");
      } else if (/\.(png|jpg|jpeg|gif|webp|avif)$/i.test(path)) {
        const ext = path.split(".").pop();
        respHeaders.set(
          "Content-Type",
          ext ? `image/${ext.toLowerCase()}` : "image/jpeg"
        );
      }

      return new Response(response.body, {
        status: response.status,
        headers: respHeaders,
      });
    } else if (
      // Handle font files
      contentTypeBase.includes("font/") ||
      contentTypeBase.includes("application/font") ||
      path.endsWith(".woff") ||
      path.endsWith(".woff2") ||
      path.endsWith(".ttf") ||
      path.endsWith(".otf") ||
      path.endsWith(".eot")
    ) {
      console.log(`处理字体文件: ${origUrl}`);
      // Set correct content type
      if (path.endsWith(".woff2")) {
        respHeaders.set("Content-Type", "font/woff2");
      } else if (path.endsWith(".woff")) {
        respHeaders.set("Content-Type", "font/woff");
      } else if (path.endsWith(".ttf")) {
        respHeaders.set("Content-Type", "font/ttf");
      } else if (path.endsWith(".otf")) {
        respHeaders.set("Content-Type", "font/otf");
      } else if (path.endsWith(".eot")) {
        respHeaders.set("Content-Type", "application/vnd.ms-fontobject");
      } else if (contentType && contentType.includes("font")) {
        respHeaders.set("Content-Type", contentType);
      }

      // Return font content directly
      return new Response(response.body, {
        status: response.status,
        headers: respHeaders,
      });
    } else if (
      // Special handling for Google Fonts CSS files
      origUrl.includes("fonts.googleapis.com") &&
      origUrl.includes(".css")
    ) {
      console.log(`origUrl: ${origUrl}`);
      console.log(`处理Google Fonts CSS: ${origUrl}`);

      // Get CSS content
      const text = await response.text();

      // Ensure correct CSS content type
      respHeaders.set("Content-Type", "text/css; charset=UTF-8");

      return new Response(text, {
        status: response.status,
        headers: respHeaders,
      });
    } else {
      // Other content types
      console.log(`处理其他内容类型: ${origUrl}`);
      return new Response(response.body, {
        status: response.status,
        headers: respHeaders,
      });
    }
  } catch (error: unknown) {
    console.error(
      "Proxy request error:",
      error instanceof Error ? error.message : String(error)
    );

    // Add more detailed error diagnostics
    let errorMessage = "Failed to fetch";
    let errorDetails = {};

    if (error instanceof Error) {
      errorMessage = error.message;
      errorDetails = {
        name: error.name,
        stack: error.stack,
        // TypeScript might not support Error.cause
        // @ts-ignore
        cause: error.cause,
      };
      console.log(`代理请求详细错误: ${JSON.stringify(errorDetails)}`);
    } else if (typeof error === "object" && error !== null) {
      try {
        errorDetails = JSON.stringify(error);
        console.log(`代理请求非标准错误对象: ${errorDetails}`);
      } catch (e) {
        console.log(`代理请求无法序列化的错误对象: ${String(error)}`);
      }
    }

    // Error response
    return new Response(
      JSON.stringify({
        error: `Proxy error: ${errorMessage}`,
        details: errorDetails,
        url: origUrl,
        proxyUrl: proxyUrl,
        timestamp: Date.now(),
      }),
      {
        status: 502,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }
}

// 辅助函数：获取内容类型的基本部分
export function getContentTypeBase(contentType: string | null): string {
  if (!contentType) return "";
  const parts = contentType.split(";");
  return parts[0].trim().toLowerCase();
}
