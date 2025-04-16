import { isCdnUrl } from "./cdn";
import { parseUrl } from "./url";
import { parse as parseHtml } from "node-html-parser";

const liveProxyCode = "";

function wrapJavaScript(code: string): string {
  return `
(function() {
  var _____SLAX_function_____ = function(name) {
    try {
      if (self._SLAX_obj_proxy && self._SLAX_obj_proxy[name]) {
        return self._SLAX_obj_proxy[name];
      }
      return self[name];
    } catch (e) {
      console.error("Error in SLAX assign function", e);
      return self[name];
    }
  };

  
  {
    let window = _____SLAX_function_____("window");
    let self = _____SLAX_function_____("self");
    let document = _____SLAX_function_____("document");
    let location = _____SLAX_function_____("location");

    ${code}
  }

  ;document.close();
})();`;
}

export function rewriteJS(
  js: string,
  baseUrl: string,
  timestamp: string,
  isModule: boolean
): string {
  if (!js) return js;

  if (isModule) {
    js = js.replace(
      /(import(?:['"\s]*(?:[\w*${}\s,]+from\s*)?['"\s]?['"\s]))((?:https?|[./]).*?)(['"\s])/g,
      (match, importStmt, importUrl, quote) => {
        try {
          const fullUrl = parseUrl(importUrl, baseUrl);
          if (isCdnUrl(fullUrl)) {
            return importStmt + fullUrl + quote;
          }
          const proxyUrl = `/proxy/${timestamp}mp_/${fullUrl}`;
          return importStmt + proxyUrl + quote;
        } catch (e) {
          console.error("ESM import rewriting error:", e);
          return match;
        }
      }
    );
  }

  js = js.replace(
    /import\s*\(\s*(['"])((?:https?|[./]).*?)(['"])\s*\)/g,
    (match, quote1, importUrl, quote2) => {
      try {
        const fullUrl = parseUrl(importUrl, baseUrl);
        if (isCdnUrl(fullUrl)) {
          return `import(${quote1}${fullUrl}${quote2})`;
        }
        const proxyUrl = `/proxy/${timestamp}mp_/${fullUrl}`;
        return `import(${quote1}${proxyUrl}${quote2})`;
      } catch (e) {
        console.error("Dynamic import rewriting error:", e);
        return match;
      }
    }
  );

  js = js.replace(
    /(?:new URL|fetch)\s*\(\s*(['"])((?:https?|[./][^'"])+)(['"])/g,
    (match, quote1, url, quote2) => {
      if (
        url.startsWith("#") ||
        url.startsWith("javascript:") ||
        url.startsWith("data:")
      ) {
        return match;
      }

      try {
        const fullUrl = parseUrl(url, baseUrl);
        if (isCdnUrl(fullUrl)) {
          return match.replace(url, fullUrl);
        }

        // Use oe_ modifier for fetch, mp_ for others
        let mod = match.includes("fetch") ? "oe_" : "mp_";
        const proxyUrl = `/proxy/${timestamp}${mod}/${fullUrl}`;
        return match.replace(url, proxyUrl);
      } catch (e) {
        console.error("JS API URL rewriting error:", e);
        return match;
      }
    }
  );

  js = js.replace(
    /\.open\s*\(\s*(['"])GET\1\s*,\s*(['"])((?:https?|[./][^'"])+)(['"])/g,
    (match, quote1, quote2, url, quote3) => {
      if (
        url.startsWith("#") ||
        url.startsWith("javascript:") ||
        url.startsWith("data:")
      ) {
        return match;
      }

      try {
        const fullUrl = parseUrl(url, baseUrl);
        if (isCdnUrl(fullUrl)) {
          return match.replace(url, fullUrl);
        }
        const proxyUrl = `/proxy/${timestamp}oe_/${fullUrl}`;
        return match.replace(url, proxyUrl);
      } catch (e) {
        console.error("XHR URL rewriting error:", e);
        return match;
      }
    }
  );

  js = js.replace(
    /new\s+Worker\s*\(\s*(['"])((?:https?|[./][^'"])+)(['"])/g,
    (match, quote1, url, quote3) => {
      if (
        url.startsWith("#") ||
        url.startsWith("javascript:") ||
        url.startsWith("data:")
      ) {
        return match;
      }

      try {
        const fullUrl = parseUrl(url, baseUrl);
        const proxyUrl = `/proxy/${timestamp}js_/${fullUrl}`;
        return match.replace(url, proxyUrl);
      } catch (e) {
        console.error("Worker URL rewriting error:", e);
        return match;
      }
    }
  );

  js = js.replace(
    /\.src\s*=\s*(['"])((?:https?|[./][^'"])+)(['"])/g,
    (match, quote1, url, quote3) => {
      if (
        url.startsWith("#") ||
        url.startsWith("javascript:") ||
        url.startsWith("data:")
      ) {
        return match;
      }

      try {
        const fullUrl = parseUrl(url, baseUrl);
        const proxyUrl = `/proxy/${timestamp}js_/${fullUrl}`;
        return match.replace(url, proxyUrl);
      } catch (e) {
        console.error("Script src rewriting error:", e);
        return match;
      }
    }
  );

  if (!isModule) {
    js = wrapJavaScript(js);
  }

  return js;
}

export function rewriteCSS(
  css: string,
  baseUrl: string,
  timestamp: string
): string {
  return css.replace(
    /url\(\s*(['"]?)([^'"\)]+)(['"]?)\s*\)/gi,
    (match, quote1, url, quote2) => {
      if (!url || url.startsWith("data:") || url.startsWith("#")) {
        return match;
      }

      try {
        const fullUrl = parseUrl(url, baseUrl);
        const proxyUrl = `/proxy/${timestamp}im_/${fullUrl}`;
        return `url(${quote1}${proxyUrl}${quote2})`;
      } catch (e) {
        console.error("CSS URL rewriting error:", e);
        return match;
      }
    }
  );
}

function createProxyUrl(
  url: string,
  baseUrl: string,
  timestamp: string,
  modifier: string = "mp_",
  useFullOrigin: boolean = false
): string {
  if (
    !url ||
    url.startsWith("#") ||
    url.startsWith("javascript:") ||
    url.startsWith("data:") ||
    url.startsWith("about:")
  ) {
    return url;
  }

  try {
    const fullUrl = parseUrl(url, baseUrl);

    if (isCdnUrl(fullUrl)) {
      return fullUrl;
    }

    if (useFullOrigin) {
      const origin =
        typeof self !== "undefined" && self.location
          ? self.location.origin
          : "";
      return `${origin}/w/liveproxy/${modifier}/${fullUrl}`;
    }

    return `/proxy/${timestamp}${modifier}/${fullUrl}`;
  } catch (e) {
    console.error(`URL rewriting error for ${url}:`, e);
    return url;
  }
}

export function completeHtmlRewrite(
  html: string,
  baseUrl: string,
  timestamp: string
): string {
  const baseUrlObj = new URL(baseUrl);
  const baseOrigin = baseUrlObj.origin;
  const basePath = baseUrlObj.pathname.split("/").slice(0, -1).join("/") || "/";

  console.log(`baseOrigin: ${baseOrigin}`);
  console.log(`basePath: ${basePath}`);

  const injectScript = `
   <script>
   ${liveProxyCode
     .replace("${originURL}", baseUrl)
     .replace("${proxyURL}", self.location.origin)}
   </script>
   <style>
    body {
      font-family: inherit;
      font-size: inherit;
    }
   </style>`;

  const root = parseHtml(html, {
    comment: true,
    blockTextElements: {
      script: true,
      noscript: true,
      style: true,
      pre: true,
    },
    fixNestedATags: true,
    parseNoneClosedTags: true,
    lowerCaseTagName: false,
  });

  const head = root.querySelector("head");
  if (head) {
    head.insertAdjacentHTML("afterbegin", injectScript);
  }

  root.querySelectorAll("iframe").forEach((iframe) => {
    if (iframe.hasAttribute("src")) {
      const src = iframe.getAttribute("src") || "";
      iframe.setAttribute(
        "src",
        createProxyUrl(src, baseUrl, timestamp, "if_")
      );
    }

    if (iframe.hasAttribute("sandbox")) iframe.removeAttribute("sandbox");

    if (!iframe.hasAttribute("allow")) {
      iframe.setAttribute(
        "allow",
        "scripts forms popups popups-to-escape-sandbox"
      );
    }

    iframe.setAttribute("data-wabac-frame", "true");
  });

  root.querySelectorAll("img").forEach((img) => {
    if (img.hasAttribute("src")) {
      const src = img.getAttribute("src") || "";
      if (!src.startsWith("data:")) {
        img.setAttribute(
          "src",
          createProxyUrl(src, baseUrl, timestamp, "mp_", true)
        );
      }
    }

    if (img.hasAttribute("data-src")) {
      const dataSrc = img.getAttribute("data-src") || "";
      const proxyUrl = createProxyUrl(dataSrc, baseUrl, timestamp, "mp_", true);
      img.setAttribute("data-src", proxyUrl);

      const src = img.getAttribute("src") || "";
      if (!src || src.includes("data:image") || src.includes("svg+xml")) {
        img.setAttribute("src", proxyUrl);
      }
    }

    if (img.hasAttribute("srcset")) {
      const srcset = img.getAttribute("srcset") || "";
      const currentOrigin = self.location.origin;

      const parts = srcset.split(",").map((part) => {
        const [url, ...rest] = part.trim().split(/\s+/);
        if (url && !url.startsWith("data:")) {
          const fullUrl = parseUrl(url, baseUrl);
          const proxyUrl = `${currentOrigin}/w/liveproxy/mp_/${fullUrl}`;
          return [proxyUrl, ...rest].join(" ");
        }
        return part;
      });

      img.setAttribute("srcset", parts.join(", "));
    }
  });

  root.querySelectorAll("link").forEach((link) => {
    if (link.hasAttribute("href")) {
      const href = link.getAttribute("href") || "";

      if (href.startsWith("#")) return;

      const rel = link.getAttribute("rel") || "";
      const type = link.getAttribute("type") || "";
      const isStylesheet =
        rel === "stylesheet" || type === "text/css" || href.endsWith(".css");

      const modifier = isStylesheet ? "cs_" : "oe_";
      link.setAttribute(
        "href",
        createProxyUrl(href, baseUrl, timestamp, modifier)
      );
    }
  });

  root.querySelectorAll("script").forEach((script) => {
    if (script.hasAttribute("src")) {
      const src = script.getAttribute("src") || "";
      script.setAttribute(
        "src",
        createProxyUrl(src, baseUrl, timestamp, "mp_")
      );
    } else if (script.textContent) {
      let content = script.textContent;
      const isModule = script.getAttribute("type") === "module";

      if (!isModule && content.trim()) {
        content = wrapJavaScript(content);
        script.textContent = content;
      }
    }
  });

  root.querySelectorAll("video, audio").forEach((media) => {
    if (media.hasAttribute("src")) {
      const src = media.getAttribute("src") || "";
      media.setAttribute("src", createProxyUrl(src, baseUrl, timestamp, "oe_"));
    }

    if (media.tagName === "VIDEO" && media.hasAttribute("poster")) {
      const poster = media.getAttribute("poster") || "";
      media.setAttribute(
        "poster",
        createProxyUrl(poster, baseUrl, timestamp, "mp_", true)
      );
    }

    media.querySelectorAll("source").forEach((source) => {
      if (source.hasAttribute("src")) {
        const src = source.getAttribute("src") || "";
        source.setAttribute(
          "src",
          createProxyUrl(src, baseUrl, timestamp, "oe_")
        );
      }
    });
  });

  root.querySelectorAll("a").forEach((anchor) => {
    if (anchor.hasAttribute("href")) {
      const href = anchor.getAttribute("href") || "";
      if (
        href.startsWith("#") ||
        href.startsWith("javascript:") ||
        href.startsWith("mailto:")
      )
        return;

      anchor.setAttribute(
        "href",
        createProxyUrl(href, baseUrl, timestamp, "mp_")
      );
    }
  });

  root.querySelectorAll("form").forEach((form) => {
    if (form.hasAttribute("action")) {
      const action = form.getAttribute("action") || "";
      if (action.startsWith("#") || action.startsWith("javascript:")) return;

      form.setAttribute(
        "action",
        createProxyUrl(action, baseUrl, timestamp, "mp_")
      );
    }
  });

  root.querySelectorAll('[style*="background"]').forEach((element) => {
    const style = element.getAttribute("style");
    if (!style) return;

    // Match: background-image: url(...) or background: url(...)
    const backgroundUrlRegex =
      /background(-image)?\s*:\s*url\(\s*['"]?([^'"\)]+)['"]?\s*\)/gi;
    let newStyle = style;

    let match;
    while ((match = backgroundUrlRegex.exec(style)) !== null) {
      const [fullMatch, prop, url] = match;
      if (!url || url.startsWith("data:") || url.startsWith("#")) continue;

      const proxyUrl = createProxyUrl(url, baseUrl, timestamp, "mp_", true);
      newStyle = newStyle.replace(url, proxyUrl);
    }

    if (newStyle !== style) {
      element.setAttribute("style", newStyle);
    }
  });

  return root.outerHTML;
}
