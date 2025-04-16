// URL 解析函数
export function parseUrl(url: string, baseUrl: string): string {
  // 如果 URL 已经是完整的 http/https URL，直接返回
  if (url.match(/^https?:\/\//)) {
    return url;
  }

  try {
    const baseUrlObj = new URL(baseUrl);
    let result;

    if (url.startsWith("//")) {
      // 协议相对 URL
      result = `${baseUrlObj.protocol}${url}`;
    } else if (url.startsWith("/")) {
      // 绝对路径
      result = baseUrlObj.origin + url;
    } else if (url.startsWith("./")) {
      // 显式相对路径 ./
      const pathParts = baseUrlObj.pathname.split("/");
      pathParts.pop(); // 移除文件名部分
      result = baseUrlObj.origin + pathParts.join("/") + "/" + url.substring(2);
    } else if (url.startsWith("../")) {
      // 显式父路径 ../
      let pathParts = baseUrlObj.pathname.split("/");
      pathParts.pop(); // 移除文件名部分

      // 处理多个 ../ 段
      let segments = url.split("/");
      let upCount = 0;

      while (segments[0] === "..") {
        upCount++;
        segments.shift();
      }

      // 上升所需的层级
      for (let i = 0; i < upCount && pathParts.length > 1; i++) {
        pathParts.pop();
      }

      result =
        baseUrlObj.origin + pathParts.join("/") + "/" + segments.join("/");
    } else {
      // 隐式相对路径
      const pathParts = baseUrlObj.pathname.split("/");
      pathParts.pop(); // 移除文件名部分
      result = baseUrlObj.origin + pathParts.join("/") + "/" + url;
    }

    // 确保没有双斜杠（除了协议中的）
    result = result.replace(/([^:])\/+/g, "$1/");
    return result;
  } catch (e) {
    console.error("URL parsing error:", e);
    return url; // 出错时返回原始 URL
  }
}
