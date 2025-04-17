import { parseUrl } from "./url";
import * as acorn from "acorn";

const liveProxyCode = "";

const globalOverrides = [
  "window",
  "globalThis",
  "self",
  "document",
  "location",
  "top",
  "parent",
  "frames",
  "opener",
];

const GLOBALS_CONCAT_STR = globalOverrides
  .map((x) => `(?:^|[^$.])\\b${x}\\b(?:$|[^$])`)
  .join("|");
const GLOBALS_RX = new RegExp(`(${GLOBALS_CONCAT_STR})`);

function wrapJavaScript(code: string): string {
  if (code.includes("import")) return code;

  let ast: acorn.Node;
  try {
    ast = acorn.parse(code, { ecmaVersion: "latest" });
  } catch (e) {
    console.warn("AST parsing failed:", e);
    return code;
  }

  const declaredVars: string[] = [];
  let hasDocWrite = false;

  for (const node of (ast as any).body) {
    if (node.type === "VariableDeclaration") {
      const { kind, declarations } = node;
      if (kind === "const" || kind === "let") {
        for (const decl of declarations) {
          if (
            decl &&
            decl.type === "VariableDeclarator" &&
            decl.id &&
            decl.id.type === "Identifier" &&
            !globalOverrides.includes(decl.id.name)
          ) {
            declaredVars.push(decl.id.name);
          }
        }
      }
    } else if (!hasDocWrite && node.type === "ExpressionStatement") {
      const { expression } = node;
      if (expression && expression.type === "CallExpression") {
        const { callee } = expression;
        if (
          callee &&
          callee.type === "MemberExpression" &&
          callee.object.type === "Identifier" &&
          callee.object.name === "document" &&
          callee.property.type === "Identifier" &&
          callee.property.name === "write"
        ) {
          hasDocWrite = true;
        }
      }
    }
  }

  const uniqueVars = [...new Set(declaredVars)].sort();
  let exportCode = "";
  if (uniqueVars.length > 0) {
    exportCode = uniqueVars
      .map((varName) => `    self.${varName} = ${varName};`)
      .join("\n");
  }

  let docCloseCode = hasDocWrite ? "    ;document.close();" : "";

  if (!GLOBALS_RX.test(code)) {
    return code + (exportCode || docCloseCode);
  }

  return `
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
    
${exportCode || docCloseCode}
  }`;
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
      function (
        match: string,
        importStmt: string,
        importUrl: string,
        quote: string
      ) {
        try {
          const fullUrl = parseUrl(importUrl, baseUrl);
          const proxyUrl = `${self.location.origin}/proxy/${timestamp}mp_/${fullUrl}`;
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
    function (
      match: string,
      quote1: string,
      importUrl: string,
      quote2: string
    ) {
      try {
        const fullUrl = parseUrl(importUrl, baseUrl);

        const proxyUrl = `${self.location.origin}/proxy/${timestamp}mp_/${fullUrl}`;
        return `import(${quote1}${proxyUrl}${quote2})`;
      } catch (e) {
        console.error("Dynamic import rewriting error:", e);
        return match;
      }
    }
  );

  js = js.replace(
    /(?:new URL|fetch)\s*\(\s*(['"])((?:https?|[./][^'"])+)(['"])/g,
    function (match: string, quote1: string, url: string, quote2: string) {
      if (
        url.startsWith("#") ||
        url.startsWith("javascript:") ||
        url.startsWith("data:")
      ) {
        return match;
      }

      try {
        const fullUrl = parseUrl(url, baseUrl);

        let mod = match.includes("fetch") ? "oe_" : "mp_";
        const proxyUrl = `${self.location.origin}/proxy/${timestamp}${mod}/${fullUrl}`;
        return match.replace(url, proxyUrl);
      } catch (e) {
        console.error("JS API URL rewriting error:", e);
        return match;
      }
    }
  );

  js = js.replace(
    /\.open\s*\(\s*(['"])GET\1\s*,\s*(['"])((?:https?|[./][^'"])+)(['"])/g,
    function (
      match: string,
      quote1: string,
      quote2: string,
      url: string,
      quote3: string
    ) {
      if (
        url.startsWith("#") ||
        url.startsWith("javascript:") ||
        url.startsWith("data:")
      ) {
        return match;
      }

      try {
        const fullUrl = parseUrl(url, baseUrl);

        const proxyUrl = `${self.location.origin}/proxy/${timestamp}oe_/${fullUrl}`;
        return match.replace(url, proxyUrl);
      } catch (e) {
        console.error("XHR URL rewriting error:", e);
        return match;
      }
    }
  );

  js = js.replace(
    /new\s+Worker\s*\(\s*(['"])((?:https?|[./][^'"])+)(['"])/g,
    function (match: string, quote1: string, url: string, quote3: string) {
      if (
        url.startsWith("#") ||
        url.startsWith("javascript:") ||
        url.startsWith("data:")
      ) {
        return match;
      }

      try {
        const fullUrl = parseUrl(url, baseUrl);
        const proxyUrl = `${self.location.origin}/proxy/${timestamp}js_/${fullUrl}`;
        return match.replace(url, proxyUrl);
      } catch (e) {
        console.error("Worker URL rewriting error:", e);
        return match;
      }
    }
  );

  js = js.replace(
    /\.src\s*=\s*(['"])((?:https?|[./][^'"])+)(['"])/g,
    function (match: string, quote1: string, url: string, quote3: string) {
      if (
        url.startsWith("#") ||
        url.startsWith("javascript:") ||
        url.startsWith("data:")
      ) {
        return match;
      }

      try {
        // 使用固定的 URL 解析函数
        const fullUrl = parseUrl(url, baseUrl);
        const proxyUrl = `${self.location.origin}/proxy/${timestamp}js_/${fullUrl}`;
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

export function rewriteCSS(css: string, baseUrl: string, timestamp: string) {
  return css.replace(
    /url\(\s*(['"]?)([^'"\)]+)(['"]?)\s*\)/gi,
    function (match: string, quote1: string, url: string, quote2: string) {
      if (!url || url.startsWith("data:") || url.startsWith("#")) {
        return match;
      }

      try {
        const fullUrl = parseUrl(url, baseUrl);
        const proxyUrl = `${self.location.origin}/proxy/${timestamp}im_/${fullUrl}`;
        return `url(${quote1}${proxyUrl}${quote2})`;
      } catch (e) {
        console.error("CSS URL rewriting error:", e);
        return match;
      }
    }
  );
}

export function completeHtmlRewrite(
  html: string,
  baseUrl: string,
  timestamp: string
): string {
  const baseUrlObj = new URL(baseUrl);
  const baseOrigin = baseUrlObj.origin;
  console.log(`baseOrigin: ${baseOrigin}`);
  const basePath = baseUrlObj.pathname.split("/").slice(0, -1).join("/") || "/";
  console.log(`basePath: ${basePath}`);

  html = html.replace(
    /<iframe[^>]+src\s*=\s*["']([^"']+)["'][^>]*>/gi,
    function (match: string, src: string) {
      if (
        src.startsWith("#") ||
        src.startsWith("javascript:") ||
        src.startsWith("about:")
      ) {
        return match;
      }

      const fullUrl = parseUrl(src, baseUrl);
      const proxyUrl = `${self.location.origin}/proxy/${timestamp}if_/${fullUrl}`;
      return match.replace(src, proxyUrl);
    }
  );

  html = html.replace(
    /<iframe([^>]*)>/gi,
    function (match: string, attrs: string) {
      attrs = attrs.replace(/\s+sandbox\s*=\s*["'][^"']*["']/gi, " ");

      if (!attrs.includes("allow=")) {
        attrs += ' allow="scripts forms popups popups-to-escape-sandbox"';
      }

      attrs += ' data-wabac-frame="true"';

      return "<iframe" + attrs + ">";
    }
  );

  html = html.replace(
    /<img[^>]*(?:src|data-src)\s*=\s*["']([^"']+)["'][^>]*>/gi,
    function (match: string, url: string) {
      const isSrc = match.includes(" src=");
      const isDataSrc = match.includes(" data-src=");

      if (!isSrc && !isDataSrc) return match;

      let result = match;

      const currentOrigin = self.location.origin;

      if (isSrc) {
        const srcMatch = match.match(/src\s*=\s*["']([^"']+)["']/i);
        if (srcMatch && !srcMatch[1].startsWith("data:")) {
          const fullUrl = parseUrl(srcMatch[1], baseUrl);
          const proxyUrl = `${currentOrigin}/w/liveproxy/mp_/${fullUrl}`;
          result = result.replace(srcMatch[0], `src="${proxyUrl}"`);
        }
      }

      if (isDataSrc) {
        const dataSrcMatch = match.match(/data-src\s*=\s*["']([^"']+)["']/i);
        if (dataSrcMatch) {
          const fullUrl = parseUrl(dataSrcMatch[1], baseUrl);
          const proxyUrl = `${currentOrigin}/w/liveproxy/mp_/${fullUrl}`;
          result = result.replace(dataSrcMatch[0], `data-src="${proxyUrl}"`);

          if (
            !isSrc ||
            match.includes("data:image") ||
            match.includes("svg+xml")
          ) {
            result = result.replace(/<img/i, `<img src="${proxyUrl}"`);
          }
        }
      }

      return result;
    }
  );

  html = html.replace(
    /srcset\s*=\s*["']([^"']+)["']/gi,
    function (match: string, srcset: string) {
      if (!srcset) return match;

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

      return `srcset="${parts.join(", ")}"`;
    }
  );

  html = html.replace(
    /<link[^>]+href\s*=\s*["']([^"']+)["'][^>]*>/gi,
    function (match: string, href: string) {
      if (href.startsWith("#")) {
        return match;
      }

      const fullUrl = parseUrl(href, baseUrl);

      if (
        match.includes("stylesheet") ||
        match.includes("text/css") ||
        href.endsWith(".css")
      ) {
        const proxyUrl = `${self.location.origin}/proxy/${timestamp}cs_/${fullUrl}`;
        return match.replace(href, proxyUrl);
      }

      const proxyUrl = `${self.location.origin}/proxy/${timestamp}oe_/${fullUrl}`;
      return match.replace(href, proxyUrl);
    }
  );

  html = html.replace(
    /<script([^>]*)>([\s\S]*?)<\/script>/gi,
    function (match, attrs, content) {
      if (!attrs) {
        return `<script>${wrapJavaScript(content)}</script>`;
      }
      if (attrs.includes("application/ld+json")) return match;

      if (attrs.includes(" src=")) {
        const processedAttrs = attrs.replace(
          /src\s*=\s*["']([^"']+)["']/gi,
          function (srcMatch: string, src: string) {
            if (src.startsWith("#") || src.startsWith("data:")) {
              return srcMatch;
            }

            const fullUrl = parseUrl(src, baseUrl);
            const proxyUrl = `${self.location.origin}/proxy/${timestamp}js_/${fullUrl}`;
            return ` src="${proxyUrl}"`;
          }
        );
        return `<script${processedAttrs}>${content}</script>`;
      }

      if (content.trim()) {
        return `<script${attrs}>${wrapJavaScript(content)}</script>`;
      }

      return match;
    }
  );

  html = html.replace(
    /<(video|audio)[^>]+src\s*=\s*["']([^"']+)["'][^>]*>/gi,
    function (match: string, tag: string, src: string) {
      if (src.startsWith("data:") || src.startsWith("#")) {
        return match;
      }

      const fullUrl = parseUrl(src, baseUrl);
      const proxyUrl = `${self.location.origin}/proxy/${timestamp}oe_/${fullUrl}`;
      return match.replace(src, proxyUrl);
    }
  );

  html = html.replace(
    /<video[^>]+poster\s*=\s*["']([^"']+)["'][^>]*>/gi,
    function (match: string, poster: string) {
      if (poster.startsWith("data:") || poster.startsWith("#")) {
        return match;
      }

      const fullUrl = parseUrl(poster, baseUrl);
      const proxyUrl = `${self.location.origin}/w/liveproxy/mp_/${fullUrl}`;
      return match.replace(poster, proxyUrl);
    }
  );

  html = html.replace(
    /<source[^>]+src\s*=\s*["']([^"']+)["'][^>]*>/gi,
    function (match: string, src: string) {
      if (src.startsWith("data:") || src.startsWith("#")) {
        return match;
      }

      const fullUrl = parseUrl(src, baseUrl);
      const proxyUrl = `${self.location.origin}/proxy/${timestamp}oe_/${fullUrl}`;
      return match.replace(src, proxyUrl);
    }
  );

  html = html.replace(
    /style\s*=\s*["'][^"']*background(-image)?\s*:\s*url\(\s*['"]?([^'"\)]+)['"]?\s*\)[^"']*["']/gi,
    function (match: string, prop: string, url: string) {
      if (url.startsWith("data:") || url.startsWith("#")) {
        return match;
      }

      const fullUrl = parseUrl(url, baseUrl);
      const proxyUrl = `${self.location.origin}/w/liveproxy/mp_/${fullUrl}`;
      return match.replace(url, proxyUrl);
    }
  );

  html = html.replace(
    /<a[^>]+href\s*=\s*["']([^"']+)["'][^>]*>/gi,
    function (match: string, href: string) {
      if (
        href.startsWith("#") ||
        href.startsWith("javascript:") ||
        href.startsWith("mailto:")
      ) {
        return match;
      }

      const fullUrl = parseUrl(href, baseUrl);
      const proxyUrl = `${self.location.origin}/proxy/${timestamp}mp_/${fullUrl}`;
      return match.replace(href, proxyUrl);
    }
  );

  html = html.replace(
    /<form[^>]+action\s*=\s*["']([^"']+)["'][^>]*>/gi,
    function (match: string, action: string) {
      if (action.startsWith("#") || action.startsWith("javascript:")) {
        return match;
      }

      const fullUrl = parseUrl(action, baseUrl);
      const proxyUrl = `${self.location.origin}/proxy/${timestamp}mp_/${fullUrl}`;
      return match.replace(action, proxyUrl);
    }
  );

  const historyFixScript = `
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

  let headOpenPos = html.indexOf("<head");
  if (headOpenPos !== -1) {
    const headTagEndPos = html.indexOf(">", headOpenPos);
    if (headTagEndPos !== -1) {
      html =
        html.substring(0, headTagEndPos + 1) +
        historyFixScript +
        html.substring(headTagEndPos + 1);
    }
  }

  return html;
}
