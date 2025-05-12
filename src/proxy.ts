import { completeHtmlRewrite, rewriteCSS, rewriteJS } from "./rewrite";
import {
  proxyPrefix,
  REPLAY_URL_PREFIX,
  REPLAY_URL_PREFIX_REGEXP,
  REPLAY_URL_PREFIX_REGEXP_STR,
} from "./config";

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

function handleESModule(): string {
  return `
    var wrapObj = function(name) {return (self._SLAX_obj_proxy && self._SLAX_obj_proxy[name]) || self[name]; };
    if (!self.__SLAX_pmw) { self.__SLAX_pmw = function(obj) { this.__SLAX_source = obj; return this; } }

    const window = wrapObj("window");
    const document = wrapObj("document");
    const location = wrapObj("location");
    const top = wrapObj("top");
    const parent = wrapObj("parent");
    const frames = wrapObj("frames");
    const opener = wrapObj("opener");
    const __self = wrapObj("self");
    const __globalThis = wrapObj("globalThis");

    export { window, document, location, top, parent, frames, opener, __self as self, __globalThis as globalThis };
    `;
}

export async function handleProxyRequest(
  request: Request,
  timestamp: string,
  mod: string,
  origUrl: string
): Promise<Response> {
  if (origUrl.includes("_slax_es_import.js")) {
    return new Response(handleESModule(), {
      status: 200,
      headers: {
        "Content-Type": "application/javascript",
      },
    });
  }

  const proxyUrl = proxyPrefix + origUrl;

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

  if (
    request.url.includes("/proxy/") ||
    request.url.includes(REPLAY_URL_PREFIX)
  ) {
    const refMatch = request.url.match(REPLAY_URL_PREFIX_REGEXP);
    if (refMatch) {
      let refOrigUrl;
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
      }
    }
  } else {
    headers.set("X-Proxy-Referer", request.url);
  }

  headers.set("X-Proxy-User-Agent", request.headers.get("User-Agent")!);

  const fetchOpts: RequestInit = {
    method: request.method,
    headers: headers,
    mode: "cors" as RequestMode,
    credentials: "include" as RequestCredentials,
    redirect: "manual" as RequestRedirect,
  };

  if (["POST", "PUT", "PATCH"].includes(request.method)) {
    try {
      if (request.body) {
        if (request.body instanceof ReadableStream) {
          // @ts-ignore
          fetchOpts.duplex = "half";
          fetchOpts.body = request.body;
        } else {
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
    const response = await fetch(proxyUrl, fetchOpts);

    const respHeaders = processResponseHeaders(response.headers);

    const redirectStatus = respHeaders.get("x-redirect-status");

    if (redirectStatus) {
      const location = respHeaders.get("x-orig-location");

      if (location) {
        let newLocation;

        if (location.startsWith("/")) {
          const urlObj = new URL(origUrl);
          newLocation = `${REPLAY_URL_PREFIX}/mp_/${urlObj.origin}${location}`;
        } else if (location.startsWith("http")) {
          newLocation = `${REPLAY_URL_PREFIX}/mp_/${location}`;
        } else if (location.startsWith("//")) {
          const urlObj = new URL(origUrl);
          newLocation = `${REPLAY_URL_PREFIX}/mp_/${urlObj.protocol.replace(
            ":",
            ""
          )}:${location}`;
        } else {
          const urlObj = new URL(origUrl);
          const pathParts = urlObj.pathname.split("/");
          pathParts.pop();
          const basePath = pathParts.join("/");
          newLocation = `${REPLAY_URL_PREFIX}/mp_/${urlObj.origin}${basePath}/${location}`;
        }

        newLocation = newLocation.replace(/([^:])\/+/g, "$1/");

        return Response.redirect(newLocation, parseInt(redirectStatus));
      }
    }

    respHeaders.delete("x-redirect-status");
    respHeaders.delete("x-redirect-statustext");
    respHeaders.delete("x-orig-location");
    respHeaders.delete("x-orig-ts");
    respHeaders.delete("x-proxy-set-cookie");

    if (["POST", "PUT", "PATCH"].includes(request.method)) {
      return new Response(response.body, {
        status: response.status,
        headers: respHeaders,
      });
    }

    let contentType = respHeaders.get("content-type") || "";
    const url = new URL(origUrl);
    const path = url.pathname;

    const hasBody =
      response.status !== 204 &&
      response.status !== 304 &&
      response.status !== 101;

    let isModule = mod === "esm";

    if (!contentType || contentType.includes("application/octet-stream")) {
      if (path.endsWith(".js") || path.endsWith(".cjs")) {
        contentType = "application/javascript";
      } else if (path.endsWith(".mjs")) {
        contentType = "application/javascript";
        isModule = true;
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

    const isIframeContent =
      mod === "if_" || request.headers.get("Sec-Fetch-Dest") === "iframe";

    if (!hasBody) {
      return new Response(null, {
        status: response.status,
        headers: respHeaders,
      });
    }

    if (contentTypeBase.includes("text/html") || isIframeContent) {
      const text = await response.text();
      const rewrittenHtml = completeHtmlRewrite(text, origUrl, timestamp);

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
      const rewrittenJs = rewriteJS(
        await response.text(),
        origUrl,
        timestamp,
        isModule
      );

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
      contentTypeBase.includes("font/") ||
      contentTypeBase.includes("application/font") ||
      path.endsWith(".woff") ||
      path.endsWith(".woff2") ||
      path.endsWith(".ttf") ||
      path.endsWith(".otf") ||
      path.endsWith(".eot")
    ) {
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

      return new Response(response.body, {
        status: response.status,
        headers: respHeaders,
      });
    } else if (
      origUrl.includes("fonts.googleapis.com") &&
      origUrl.includes(".css")
    ) {
      const text = await response.text();
      respHeaders.set("Content-Type", "text/css; charset=UTF-8");

      return new Response(text, {
        status: response.status,
        headers: respHeaders,
      });
    } else {
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

    let errorMessage = "Failed to fetch";
    let errorDetails = {};

    if (error instanceof Error) {
      errorMessage = error.message;
      errorDetails = {
        name: error.name,
        stack: error.stack,
        // @ts-ignore
        cause: error.cause,
      };
      console.log(`Slax Proxy Error: ${JSON.stringify(errorDetails)}`);
    } else if (typeof error === "object" && error !== null) {
      try {
        errorDetails = JSON.stringify(error);
        console.log(`Slax Proxy Error: ${errorDetails}`);
      } catch (e) {
        console.log(`Slax Proxy Error: ${String(error)}`);
      }
    }

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

export function getContentTypeBase(contentType: string | null): string {
  if (!contentType) return "";
  const parts = contentType.split(";");
  return parts[0].trim().toLowerCase();
}
