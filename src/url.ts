export function parseUrl(url: string, baseUrl: string): string {
  if (url.match(/^https?:\/\//)) {
    return url;
  }

  try {
    const baseUrlObj = new URL(baseUrl);
    let result;

    if (url.startsWith("//")) {
      result = `${baseUrlObj.protocol}${url}`;
    } else if (url.startsWith("/")) {
      result = baseUrlObj.origin + url;
    } else if (url.startsWith("./")) {
      const pathParts = baseUrlObj.pathname.split("/");
      pathParts.pop();
      result = baseUrlObj.origin + pathParts.join("/") + "/" + url.substring(2);
    } else if (url.startsWith("../")) {
      let pathParts = baseUrlObj.pathname.split("/");
      pathParts.pop();

      let segments = url.split("/");
      let upCount = 0;

      while (segments[0] === "..") {
        upCount++;
        segments.shift();
      }

      for (let i = 0; i < upCount && pathParts.length > 1; i++) {
        pathParts.pop();
      }

      result =
        baseUrlObj.origin + pathParts.join("/") + "/" + segments.join("/");
    } else {
      const pathParts = baseUrlObj.pathname.split("/");
      pathParts.pop();
      result = baseUrlObj.origin + pathParts.join("/") + "/" + url;
    }

    result = result.replace(/([^:])\/+/g, "$1/");
    return result;
  } catch (e) {
    console.error("URL parsing error:", e);
    return url;
  }
}
