import { parseUrl } from "./url";
import { SlaxLocation } from "./inject/location";
import { SlaxEnv } from "./inject/proxy";

const originURL = "${originURL}";
const proxyURL = "${proxyURL}";

(function () {
  if ((window as any).__URL_REWRITER_INITIALIZED__) return;
  (window as any).__URL_REWRITER_INITIALIZED__ = true;

  function rewriteUrl(url: string, mod: string = "mp_"): string {
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
        return url;
      }

      return `${proxyURL}/w/liveproxy/${mod}/${fullUrl}`;
    } catch (error) {
      return url;
    }
  }

  /**
   * 从代理URL中提取原始URL
   * @param url 代理URL
   * @returns 原始URL
   */
  function extractOriginalUrl(url: string | null): string | null {
    if (!url || typeof url !== "string") return url;

    // 先检查新格式的URL： /w/liveproxy/[mod]_/
    const newProxyMatch = url.match(/\/w\/liveproxy\/[^\/]*([a-z_]+)\/(.+)/);
    if (newProxyMatch) {
      return newProxyMatch[2];
    }

    // 兼容旧格式的URL： /proxy/[mod]_/
    const oldProxyMatch = url.match(/\/proxy\/[^\/]*([a-z_]+)\/(.+)/);
    if (oldProxyMatch) {
      return oldProxyMatch[2];
    }

    return url;
  }

  // ==========================================
  // 通用属性拦截器工厂函数
  // ==========================================

  /**
   * 创建通用的属性拦截器
   * @param prototype 目标原型
   * @param propName 属性名称
   * @param mod 代理模式前缀
   */
  function createPropertyInterceptor(
    prototype: any,
    propName: string,
    mod: string = "mp_",
    checkFn?: (el: HTMLElement) => string
  ): void {
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      prototype,
      propName
    );

    Object.defineProperty(prototype, propName, {
      get: function (this: HTMLElement): string {
        const value = originalDescriptor
          ? originalDescriptor.get!.call(this)
          : this.getAttribute(propName);
        return extractOriginalUrl(value) || "";
      },
      set: function (this: HTMLElement, value: string): void {
        const finalMod = checkFn ? checkFn.call(this, this) : mod;
        const rewrittenValue = rewriteUrl(value, finalMod);

        if (originalDescriptor && originalDescriptor.set) {
          originalDescriptor.set.call(this, rewrittenValue);
        } else {
          this.setAttribute(propName, rewrittenValue);
        }
      },
      enumerable: true,
      configurable: true,
    });
  }

  /**
   * 创建srcset属性拦截器
   * @param prototype 目标原型
   */
  function createSrcsetInterceptor(prototype: any): void {
    const srcsetPropName = "_originalSrcset";

    Object.defineProperty(prototype, "srcset", {
      get: function (this: HTMLElement): string {
        return (this as any)[srcsetPropName] || "";
      },
      set: function (this: HTMLElement, value: string): void {
        // 保存原始值
        (this as any)[srcsetPropName] = value;

        if (!value) {
          this.setAttribute("srcset", "");
          return;
        }

        // 重写srcset格式
        const parts = value.split(",").map((part) => {
          const [url, ...descriptors] = part.trim().split(/\s+/);
          if (url && !url.startsWith("data:")) {
            const rewrittenUrl = rewriteUrl(url, "mp_");
            return [rewrittenUrl, ...descriptors].join(" ");
          }
          return part;
        });

        this.setAttribute("srcset", parts.join(", "));
      },
      enumerable: true,
      configurable: true,
    });
  }

  // ==========================================
  // CSS 属性拦截
  // ==========================================

  /**
   * 重写CSS URL函数
   * @param value CSS值
   * @returns 重写后的CSS值
   */
  function rewriteCssUrls(value: string): string {
    if (!value || typeof value !== "string" || !value.includes("url(")) {
      return value;
    }

    return value.replace(
      /url\(\s*(['"]?)([^'"\)]+)\1\s*\)/gi,
      function (match, quote, url) {
        if (url.startsWith("data:") || url.startsWith("#")) {
          return match;
        }
        const rewrittenUrl = rewriteUrl(url, "mp_");
        return `url(${quote}${rewrittenUrl}${quote})`;
      }
    );
  }

  /**
   * 拦截CSS样式属性
   */
  function overrideStyleProperties(): void {
    const originalSetProperty = CSSStyleDeclaration.prototype.setProperty;

    // 需要重写的CSS属性
    const cssPropertiesToRewrite: string[] = [
      "background-image",
      "background",
      "border-image",
      "border-image-source",
      "list-style-image",
      "content",
      "cursor",
      "mask-image",
    ];

    // 重写setProperty方法
    CSSStyleDeclaration.prototype.setProperty = function (
      propertyName: string,
      value: string,
      priority?: string
    ): void {
      if (
        value &&
        typeof value === "string" &&
        cssPropertiesToRewrite.includes(propertyName) &&
        value.includes("url(")
      ) {
        value = rewriteCssUrls(value);
      }

      return originalSetProperty.call(this, propertyName, value, priority);
    };

    // 为特定CSS属性创建访问器
    cssPropertiesToRewrite.forEach((propName) => {
      // 转换为驼峰命名
      const camelCaseProp = propName.replace(
        /-([a-z])/g,
        (_, letter: string): string => letter.toUpperCase()
      );

      // 避免重复定义
      const originalDescriptor = Object.getOwnPropertyDescriptor(
        CSSStyleDeclaration.prototype,
        camelCaseProp
      );

      if (originalDescriptor) {
        Object.defineProperty(CSSStyleDeclaration.prototype, camelCaseProp, {
          get: function (this: CSSStyleDeclaration): string {
            return originalDescriptor.get!.call(this);
          },
          set: function (this: CSSStyleDeclaration, value: string): void {
            if (value && typeof value === "string" && value.includes("url(")) {
              value = rewriteCssUrls(value);
            }
            originalDescriptor.set!.call(this, value);
          },
          enumerable: true,
          configurable: true,
        });
      }
    });
  }

  // ==========================================
  // 网络请求拦截
  // ==========================================

  /**
   * 拦截Fetch API
   */
  function overrideFetch(): void {
    const originalFetch = window.fetch;

    window.fetch = function (
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> {
      try {
        let rewrittenInput = input;

        if (typeof input === "string") {
          try {
            // 检查URL是否为有效值
            if (!input) {
              return originalFetch.call(this, input, init);
            }

            // 特殊URL协议不需要重写
            const specialProtocols = [
              "javascript:",
              "data:",
              "#",
              "blob:",
              "about:",
            ];
            if (
              specialProtocols.some((protocol) => input.startsWith(protocol))
            ) {
              return originalFetch.call(this, input, init);
            }

            rewrittenInput = rewriteUrl(input, "mp_");
          } catch (error) {
            console.error("[Fetch Interceptor] Error rewriting URL:", error);
            rewrittenInput = input;
          }
        } else if (input instanceof Request) {
          try {
            const originalUrl = input.url;
            const specialProtocols = [
              "javascript:",
              "data:",
              "#",
              "blob:",
              "about:",
            ];
            if (
              specialProtocols.some((protocol) =>
                originalUrl.startsWith(protocol)
              )
            ) {
              return originalFetch.call(this, input, init);
            }

            const rewrittenUrl = rewriteUrl(originalUrl, "mp_");
            rewrittenInput = new Request(rewrittenUrl, input);
            console.log(
              `[Fetch Interceptor] Rewrote Request URL: ${originalUrl} -> ${rewrittenUrl}`
            );
          } catch (error) {
            console.error(
              "[Fetch Interceptor] Error rewriting Request URL:",
              error
            );
            rewrittenInput = input; // 出错时使用原始请求
          }
        }

        return originalFetch.call(this, rewrittenInput, init);
      } catch (error) {
        console.error(
          "[Fetch Interceptor] Error in fetch interception:",
          error
        );
        return originalFetch.call(this, input, init);
      }
    };
  }

  /**
   * 拦截XMLHttpRequest
   */
  function overrideXHR(): void {
    const originalOpen = XMLHttpRequest.prototype.open;

    XMLHttpRequest.prototype.open = function (
      method: string,
      url: string,
      async?: boolean,
      user?: string,
      password?: string
    ): void {
      try {
        // 检查URL是否为有效值
        if (!url || typeof url !== "string") {
          console.warn("[XHR Interceptor] Invalid URL:", url);
          return originalOpen.call(
            this,
            method,
            url,
            async ?? true,
            user,
            password
          );
        }

        // 特殊URL协议不需要重写
        const specialProtocols = [
          "javascript:",
          "data:",
          "#",
          "blob:",
          "about:",
        ];
        if (specialProtocols.some((protocol) => url.startsWith(protocol))) {
          return originalOpen.call(
            this,
            method,
            url,
            async ?? true,
            user,
            password
          );
        }

        const rewrittenUrl = rewriteUrl(url, "mp_");

        return originalOpen.call(
          this,
          method,
          rewrittenUrl,
          async ?? true,
          user,
          password
        );
      } catch (error) {
        console.error("[XHR Interceptor] Error rewriting URL:", error);
        return originalOpen.call(
          this,
          method,
          url,
          async ?? true,
          user,
          password
        );
      }
    };
  }

  // ==========================================
  // Worker API 拦截
  // ==========================================

  /**
   * 拦截Worker相关API
   */
  function overrideWorkers(): void {
    // Web Worker拦截
    const originalWorker = window.Worker;
    //@ts-ignore
    window.Worker = function (
      url: string | URL,
      options?: WorkerOptions
    ): Worker {
      console.log(`[Worker Interceptor] Creating Web Worker with URL: ${url}`);
      let interceptedUrl = url;

      if (typeof url === "string") {
        interceptedUrl = rewriteUrl(url, "js_");
        console.log(
          `[Worker Interceptor] Rewrote Worker URL: ${url} -> ${interceptedUrl}`
        );
      }

      return new originalWorker(interceptedUrl, options);
    } as typeof Worker;

    // Shared Worker拦截
    if (typeof SharedWorker !== "undefined") {
      const originalSharedWorker = window.SharedWorker;
      //@ts-ignore
      window.SharedWorker = function (
        url: string | URL,
        options?: string | WorkerOptions
      ): SharedWorker {
        console.log(
          `[Worker Interceptor] Creating Shared Worker with URL: ${url}`
        );
        let interceptedUrl = url;

        if (typeof url === "string") {
          interceptedUrl = rewriteUrl(url, "js_");
          console.log(
            `[Worker Interceptor] Rewrote SharedWorker URL: ${url} -> ${interceptedUrl}`
          );
        }

        return new originalSharedWorker(interceptedUrl, options);
      } as typeof SharedWorker;
    }

    // ServiceWorker注册拦截
    if (navigator.serviceWorker) {
      const originalRegister = navigator.serviceWorker.register;
      navigator.serviceWorker.register = function (
        scriptURL: string | URL,
        options?: RegistrationOptions
      ): Promise<ServiceWorkerRegistration> {
        console.log(
          `[Worker Interceptor] Registering Service Worker: ${scriptURL}`
        );
        // 阻止ServiceWorker注册
        console.warn("[Worker Interceptor] ServiceWorker registration blocked");
        return Promise.reject(
          new Error("ServiceWorker registration is disabled")
        );
      };
    }
  }

  // ==========================================
  // 敏感API拦截
  // ==========================================

  /**
   * 禁用通知API
   */
  function disableNotifications(): void {
    if (window.Notification) {
      // 模拟通知接口
      interface MockNotification {
        close: () => void;
      }

      // 重写Notification
      window.Notification = function (
        title: string,
        options?: NotificationOptions
      ): MockNotification {
        console.warn(
          "[Notification Interceptor] Notification creation blocked:",
          title,
          options
        );
        return {
          close: function (): void {},
        };
      } as unknown as typeof Notification;

      // 重写静态属性和方法
      Object.defineProperties(window.Notification, {
        permission: {
          get: function (): NotificationPermission {
            console.log(
              "[Notification Interceptor] Getting Notification.permission"
            );
            return "denied"; // 始终返回denied
          },
        },
        requestPermission: {
          value: function (): Promise<NotificationPermission> {
            console.warn(
              "[Notification Interceptor] Notification.requestPermission blocked"
            );
            return Promise.resolve("denied");
          },
          writable: false,
        },
      });
    }
  }

  /**
   * 禁用地理位置API
   */
  function disableGeolocation(): void {
    if (navigator.geolocation) {
      interface PositionError {
        code: number;
        message: string;
      }

      const mockGeolocation: Geolocation = {
        getCurrentPosition: function (
          success?: PositionCallback,
          error?: PositionErrorCallback,
          options?: PositionOptions
        ): void {
          console.warn("[Geolocation Interceptor] getCurrentPosition blocked");
          if (error) {
            error({
              code: 1,
              message: "Geolocation is disabled",
            } as GeolocationPositionError);
          }
        },
        watchPosition: function (
          success?: PositionCallback,
          error?: PositionErrorCallback,
          options?: PositionOptions
        ): number {
          console.warn("[Geolocation Interceptor] watchPosition blocked");
          if (error) {
            error({
              code: 1,
              message: "Geolocation is disabled",
            } as GeolocationPositionError);
          }
          return 0;
        },
        clearWatch: function (id: number): void {
          console.log("[Geolocation Interceptor] clearWatch called");
        },
      };

      // 替换geolocation对象
      //@ts-ignore
      navigator.geolocation = mockGeolocation;
    }
  }

  /**
   * 重写Beacon API
   */
  function overrideBeacon(): void {
    if (navigator.sendBeacon) {
      const originalSendBeacon = navigator.sendBeacon;
      navigator.sendBeacon = function (
        url: string | URL,
        data?: BodyInit | null
      ): boolean {
        let rewrittenUrl = url;

        if (typeof url === "string") {
          rewrittenUrl = rewriteUrl(url, "mp_");
          console.log(
            `[Beacon Interceptor] Rewrote sendBeacon URL: ${url} -> ${rewrittenUrl}`
          );
        }

        console.log(`[Beacon Interceptor] sendBeacon to ${rewrittenUrl}`, data);
        return originalSendBeacon.call(navigator, rewrittenUrl, data);
      };
    }
  }

  /**
   * 拦截document.createElement和document.createElementNS方法
   * 这样可以在元素被创建时就应用拦截器
   */
  function overrideDocumentCreateElement(): void {
    const originalCreateElement = document.createElement;
    document.createElement = function (
      tagName: string,
      options?: ElementCreationOptions | undefined
    ): HTMLElement {
      const element = originalCreateElement.call(document, tagName, options);

      // 为新创建的元素应用相应的拦截器
      if (element instanceof HTMLElement) {
        applyInterceptorsToNewElement(element);
      }

      return element;
    };

    // 同样需要拦截createElementNS方法
    const originalCreateElementNS = document.createElementNS;
    //@ts-ignore
    document.createElementNS = function (
      namespaceURI: string,
      qualifiedName: string,
      options?: ElementCreationOptions | undefined
    ): Element {
      const element = originalCreateElementNS.call(
        document,
        namespaceURI,
        qualifiedName,
        options
      );

      if (element instanceof HTMLElement) {
        applyInterceptorsToNewElement(element);
      }

      return element;
    };
  }

  function applyInterceptorsToNewElement(element: HTMLElement): void {
    if (element instanceof HTMLAnchorElement) {
      interceptElementAttribute(element, "href", "mp_");
    } else if (element instanceof HTMLAreaElement) {
      interceptElementAttribute(element, "href", "mp_");
    } else if (element instanceof HTMLImageElement) {
      interceptElementAttribute(element, "src", "mp_");
      interceptElementSrcset(element);
    } else if (element instanceof HTMLIFrameElement) {
      interceptElementAttribute(element, "src", "mp_");
    } else if (element instanceof HTMLVideoElement) {
      interceptElementAttribute(element, "src", "mp_");
    } else if (element instanceof HTMLAudioElement) {
      interceptElementAttribute(element, "src", "mp_");
    } else if (element instanceof HTMLSourceElement) {
      interceptElementAttribute(element, "src", "mp_");
      interceptElementSrcset(element);
    } else if (element instanceof HTMLScriptElement) {
      interceptElementAttribute(element, "src", "js_");
    } else if (element instanceof HTMLLinkElement) {
      // 对于link元素，需要检查rel属性
      const mod =
        element.rel === "stylesheet" ||
        element.as === "style" ||
        (element.getAttribute("href") &&
          element.getAttribute("href")!.endsWith(".css"))
          ? "cs_"
          : "mp_";
      interceptElementAttribute(element, "href", mod);
    } else if (element instanceof HTMLFormElement) {
      interceptElementAttribute(element, "action", "mp_");
    }

    //@ts-ignore
    if (element.content && element.content instanceof DocumentFragment) {
      //@ts-ignore
      processDocumentFragment(element.content);
    }

    if (element.children && element.children.length > 0) {
      Array.from(element.children).forEach((child) => {
        if (child instanceof HTMLElement) {
          applyInterceptorsToNewElement(child);
        }
      });
    }
  }

  function interceptElementAttribute(
    element: HTMLElement,
    attributeName: string,
    mod: string = "mp_"
  ): void {
    const originalValue = element.getAttribute(attributeName);

    if (originalValue) {
      const rewrittenValue = rewriteUrl(originalValue, mod);
      element.setAttribute(attributeName, rewrittenValue);
    }

    const originalSetAttribute = element.setAttribute;
    element.setAttribute = function (name: string, value: string): void {
      if (name === attributeName) {
        const rewrittenValue = rewriteUrl(value, mod);
        return originalSetAttribute.call(this, name, rewrittenValue);
      }
      return originalSetAttribute.call(this, name, value);
    };
  }

  function interceptElementSrcset(
    element: HTMLImageElement | HTMLSourceElement
  ): void {
    const originalSrcset = element.srcset;

    if (originalSrcset) {
      const parts = originalSrcset.split(",").map((part) => {
        const [url, ...descriptors] = part.trim().split(/\s+/);
        if (url && !url.startsWith("data:")) {
          const rewrittenUrl = rewriteUrl(url, "mp_");
          return [rewrittenUrl, ...descriptors].join(" ");
        }
        return part;
      });

      element.srcset = parts.join(", ");
    }
  }

  /**
   * 处理DocumentFragment及其子元素
   */
  function processDocumentFragment(fragment: DocumentFragment): void {
    // 遍历所有子节点
    Array.from(fragment.childNodes).forEach((node) => {
      if (node instanceof HTMLElement) {
        applyInterceptorsToNewElement(node);
      }
    });
  }

  /**
   * 拦截document.write和document.writeln方法
   * 这些方法常用于动态注入HTML
   */
  function overrideDocumentWrite(): void {
    const originalWrite = document.write;
    document.write = function (...args: string[]): void {
      // 处理输入的HTML字符串
      if (args.length > 0 && typeof args[0] === "string") {
        args[0] = rewriteHTMLContent(args[0]);
      }
      originalWrite.apply(document, args);
    };

    const originalWriteln = document.writeln;
    document.writeln = function (...args: string[]): void {
      // 处理输入的HTML字符串
      if (args.length > 0 && typeof args[0] === "string") {
        args[0] = rewriteHTMLContent(args[0]);
      }
      originalWriteln.apply(document, args);
    };
  }

  /**
   * 重写HTML内容中的URL
   */
  function rewriteHTMLContent(html: string): string {
    if (!html || typeof html !== "string") return html;

    // 创建一个临时的DOM解析器
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    // 处理所有元素
    const elements = doc.querySelectorAll("*");
    elements.forEach((element) => {
      if (element instanceof HTMLElement) {
        // 处理常见的URL属性
        const urlAttributes = ["src", "href", "action", "data-src"];
        urlAttributes.forEach((attr) => {
          if (element.hasAttribute(attr)) {
            const value = element.getAttribute(attr);
            if (value) {
              let mod = "mp_";
              // 对于不同类型的元素使用不同的模式
              if (element instanceof HTMLScriptElement) {
                mod = "js_";
              } else if (
                element instanceof HTMLLinkElement &&
                (element.rel === "stylesheet" ||
                  element.as === "style" ||
                  (value && value.endsWith(".css")))
              ) {
                mod = "cs_";
              }
              element.setAttribute(attr, rewriteUrl(value, mod));
            }
          }
        });

        // 处理srcset属性
        if (element.hasAttribute("srcset")) {
          const srcset = element.getAttribute("srcset");
          if (srcset) {
            const parts = srcset.split(",").map((part) => {
              const [url, ...descriptors] = part.trim().split(/\s+/);
              if (url && !url.startsWith("data:")) {
                const rewrittenUrl = rewriteUrl(url, "mp_");
                return [rewrittenUrl, ...descriptors].join(" ");
              }
              return part;
            });
            element.setAttribute("srcset", parts.join(", "));
          }
        }

        // 处理inline样式中的URL
        if (element.hasAttribute("style")) {
          const style = element.getAttribute("style");
          if (style && style.includes("url(")) {
            element.setAttribute("style", rewriteCssUrls(style));
          }
        }
      }
    });

    // 将处理后的HTML转换回字符串
    return doc.documentElement.innerHTML;
  }

  /**
   * 拦截innerHTML、outerHTML和insertAdjacentHTML方法
   */
  function overrideHTMLInsertionAPIs(): void {
    // 拦截Element.prototype.innerHTML
    const originalInnerHTMLDescriptor = Object.getOwnPropertyDescriptor(
      Element.prototype,
      "innerHTML"
    );
    if (originalInnerHTMLDescriptor) {
      Object.defineProperty(Element.prototype, "innerHTML", {
        get: function () {
          return originalInnerHTMLDescriptor.get!.call(this);
        },
        set: function (html) {
          const rewrittenHTML = rewriteHTMLContent(html);
          originalInnerHTMLDescriptor.set!.call(this, rewrittenHTML);

          // 处理新添加的元素
          if (this instanceof HTMLElement) {
            Array.from(this.querySelectorAll("*")).forEach((element) => {
              if (element instanceof HTMLElement) {
                applyInterceptorsToNewElement(element);
              }
            });
          }
        },
        enumerable: originalInnerHTMLDescriptor.enumerable,
        configurable: originalInnerHTMLDescriptor.configurable,
      });
    }

    // 拦截Element.prototype.outerHTML
    const originalOuterHTMLDescriptor = Object.getOwnPropertyDescriptor(
      Element.prototype,
      "outerHTML"
    );
    if (originalOuterHTMLDescriptor) {
      Object.defineProperty(Element.prototype, "outerHTML", {
        get: function () {
          return originalOuterHTMLDescriptor.get!.call(this);
        },
        set: function (html) {
          const rewrittenHTML = rewriteHTMLContent(html);
          originalOuterHTMLDescriptor.set!.call(this, rewrittenHTML);

          // 处理新添加的元素
          if (this.parentElement) {
            Array.from(this.parentElement.querySelectorAll("*")).forEach(
              (element) => {
                if (element instanceof HTMLElement) {
                  applyInterceptorsToNewElement(element);
                }
              }
            );
          }
        },
        enumerable: originalOuterHTMLDescriptor.enumerable,
        configurable: originalOuterHTMLDescriptor.configurable,
      });
    }

    // 拦截insertAdjacentHTML方法
    const originalInsertAdjacentHTML = Element.prototype.insertAdjacentHTML;
    Element.prototype.insertAdjacentHTML = function (position, html) {
      const rewrittenHTML = rewriteHTMLContent(html);
      originalInsertAdjacentHTML.call(this, position, rewrittenHTML);

      // 处理新添加的元素
      if (this instanceof HTMLElement) {
        const elementsToCheck = Array.from(this.querySelectorAll("*"));
        if (position === "beforebegin" || position === "afterend") {
          // 如果在元素外部插入，需要检查父元素的子元素
          if (this.parentElement) {
            elementsToCheck.push(
              ...Array.from(this.parentElement.querySelectorAll("*"))
            );
          }
        }

        elementsToCheck.forEach((element) => {
          if (element instanceof HTMLElement) {
            applyInterceptorsToNewElement(element);
          }
        });
      }
    };
  }

  /**
   * 拦截Node相关API
   */
  function overrideNodeRelatedAPIs(): void {
    // 拦截Node.appendChild
    const originalAppendChild = Node.prototype.appendChild;
    Node.prototype.appendChild = function <T extends Node>(newChild: T): T {
      // 如果是有效的节点对象，直接处理
      if (newChild instanceof Node) {
        if (newChild instanceof HTMLElement) {
          applyInterceptorsToNewElement(newChild);
        }
        //@ts-ignore
        return originalAppendChild.call(this, newChild);
      }

      // 如果是字符串，创建文本节点
      if (typeof newChild === "string") {
        console.warn(
          "[Node Interceptor] String passed to appendChild, converting to TextNode"
        );
        const textNode = document.createTextNode(newChild);
        return originalAppendChild.call(this, textNode) as unknown as T;
      }

      // 其他情况，尝试使用原始方法
      try {
        //@ts-ignore
        return originalAppendChild.call(this, newChild);
      } catch (e) {
        console.warn("[Node Interceptor] Error in appendChild:", e);
        // 如果失败，返回this以避免完全中断
        return this as unknown as T;
      }
    };

    // 拦截Node.insertBefore
    const originalInsertBefore = Node.prototype.insertBefore;
    Node.prototype.insertBefore = function <T extends Node>(
      newChild: T,
      refChild: Node | null
    ): T {
      // 处理传入的可能是字符串而不是Node的情况
      if (typeof newChild === "string") {
        console.warn(
          "[Node Interceptor] String passed to insertBefore, converting to TextNode"
        );
        const textNode = document.createTextNode(newChild);
        return originalInsertBefore.call(
          this,
          textNode,
          refChild
        ) as unknown as T;
      }

      // 确保newChild是一个有效的Node对象
      if (!(newChild instanceof Node)) {
        console.warn(
          "[Node Interceptor] Invalid parameter passed to insertBefore:",
          newChild
        );
        throw new TypeError(
          "Failed to execute 'insertBefore' on 'Node': parameter 1 is not of type 'Node'"
        );
      }

      if (newChild instanceof HTMLElement) {
        applyInterceptorsToNewElement(newChild);
      }
      //@ts-ignore
      return originalInsertBefore.call(this, newChild, refChild);
    };

    // 拦截Node.replaceChild
    const originalReplaceChild = Node.prototype.replaceChild;
    //@ts-ignore
    Node.prototype.replaceChild = function <T extends Node>(
      newChild: T,
      oldChild: Node
    ): T {
      // 处理传入的可能是字符串而不是Node的情况
      if (typeof newChild === "string") {
        console.warn(
          "[Node Interceptor] String passed to replaceChild, converting to TextNode"
        );
        const textNode = document.createTextNode(newChild);
        return originalReplaceChild.call(
          this,
          textNode,
          oldChild
        ) as unknown as T;
      }

      // 确保newChild是一个有效的Node对象
      if (!(newChild instanceof Node)) {
        console.warn(
          "[Node Interceptor] Invalid parameter passed to replaceChild:",
          newChild
        );
        throw new TypeError(
          "Failed to execute 'replaceChild' on 'Node': parameter 1 is not of type 'Node'"
        );
      }

      if (newChild instanceof HTMLElement) {
        applyInterceptorsToNewElement(newChild);
      }
      //@ts-ignore
      return originalReplaceChild.call(this, newChild, oldChild);
    };

    // 拦截Element.append
    if (Element.prototype.append) {
      const originalAppend = Element.prototype.append;
      Element.prototype.append = function (...nodes: (Node | string)[]) {
        // 处理参数列表中的每个节点
        const processedNodes = nodes.map((node) => {
          if (node instanceof HTMLElement) {
            applyInterceptorsToNewElement(node);
            return node;
          }
          // 其他类型的节点或字符串保持原样 (字符串会被原生方法自动转换为文本节点)
          return node;
        });

        return originalAppend.apply(this, processedNodes);
      };
    }

    // 拦截Element.prepend
    if (Element.prototype.prepend) {
      const originalPrepend = Element.prototype.prepend;
      Element.prototype.prepend = function (...nodes: (Node | string)[]) {
        // 处理参数列表中的每个节点
        const processedNodes = nodes.map((node) => {
          if (node instanceof HTMLElement) {
            applyInterceptorsToNewElement(node);
            return node;
          }
          // 其他类型的节点或字符串保持原样 (字符串会被原生方法自动转换为文本节点)
          return node;
        });

        return originalPrepend.apply(this, processedNodes);
      };
    }

    // 拦截setAttribute方法
    const originalSetAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (
      name: string,
      value: string
    ): void {
      const urlAttributes = ["src", "href", "action", "data-src"];
      if (urlAttributes.includes(name) && typeof value === "string") {
        let mod = "mp_";

        // 根据元素类型和属性选择合适的模式
        if (this instanceof HTMLScriptElement && name === "src") {
          mod = "js_";
        } else if (
          this instanceof HTMLLinkElement &&
          name === "href" &&
          (this.rel === "stylesheet" ||
            this.as === "style" ||
            (value && value.endsWith(".css")))
        ) {
          mod = "cs_";
        }

        const rewrittenValue = rewriteUrl(value, mod);
        return originalSetAttribute.call(this, name, rewrittenValue);
      }

      // 特殊处理srcset属性
      if (name === "srcset" && typeof value === "string") {
        const parts = value.split(",").map((part) => {
          const [url, ...descriptors] = part.trim().split(/\s+/);
          if (url && !url.startsWith("data:")) {
            const rewrittenUrl = rewriteUrl(url, "mp_");
            return [rewrittenUrl, ...descriptors].join(" ");
          }
          return part;
        });

        return originalSetAttribute.call(this, name, parts.join(", "));
      }

      // 特殊处理style属性
      if (
        name === "style" &&
        typeof value === "string" &&
        value.includes("url(")
      ) {
        const rewrittenStyle = rewriteCssUrls(value);
        return originalSetAttribute.call(this, name, rewrittenStyle);
      }

      return originalSetAttribute.call(this, name, value);
    };
  }

  /**
   * 拦截IntersectionObserver API
   */
  function overrideIntersectionObserver(): void {
    const OriginalIntersectionObserver = window.IntersectionObserver;

    // 使用构造函数模式正确重写
    window.IntersectionObserver = function (
      this: IntersectionObserver,
      callback: IntersectionObserverCallback,
      options?: IntersectionObserverInit
    ): IntersectionObserver {
      // 使用原始构造函数创建实例
      const instance = new OriginalIntersectionObserver(callback, options);

      // 重写observe方法以确保参数是有效的Element
      const originalObserve = instance.observe;
      instance.observe = function (target: Element): void {
        if (!(target instanceof Element)) {
          console.warn(
            "[IntersectionObserver Interceptor] Invalid target passed to observe:",
            target
          );
          return;
        }

        return originalObserve.call(this, target);
      };

      return instance;
    } as unknown as typeof IntersectionObserver;
  }

  // ==========================================
  // 拦截器初始化
  // ==========================================

  function initDOMInterceptors(): void {
    overrideDocumentCreateElement();
    overrideDocumentWrite();
    overrideHTMLInsertionAPIs();
    overrideNodeRelatedAPIs();
  }

  /**
   * 初始化所有元素属性拦截器
   */
  function initElementInterceptors(): void {
    // 拦截元素属性访问器
    createPropertyInterceptor(HTMLAnchorElement.prototype, "href");
    createPropertyInterceptor(HTMLAreaElement.prototype, "href");
    createPropertyInterceptor(HTMLImageElement.prototype, "src");
    createPropertyInterceptor(HTMLIFrameElement.prototype, "src");
    createPropertyInterceptor(HTMLVideoElement.prototype, "src");
    createPropertyInterceptor(HTMLAudioElement.prototype, "src");
    createPropertyInterceptor(HTMLSourceElement.prototype, "src");
    createPropertyInterceptor(HTMLScriptElement.prototype, "src");

    // 为<link>元素创建特殊的href拦截器
    createPropertyInterceptor(
      HTMLLinkElement.prototype,
      "href",
      "mp_",
      function (el) {
        if (
          (el as HTMLLinkElement).rel === "stylesheet" ||
          (el as HTMLLinkElement).as === "style" ||
          (el.getAttribute("href") && el.getAttribute("href")!.endsWith(".css"))
        ) {
          return "cs_";
        }
        return "mp_";
      }
    );

    // 为srcset属性创建拦截器
    createSrcsetInterceptor(HTMLImageElement.prototype);
    createSrcsetInterceptor(HTMLSourceElement.prototype);

    // 拦截表单action属性
    createPropertyInterceptor(HTMLFormElement.prototype, "action");
  }

  /**
   * 初始化所有拦截器
   */
  function initAllInterceptors(): void {
    //@ts-ignore
    window._slaxLocation = new SlaxLocation(window.location);
    //@ts-ignore
    window.slaxEnv = new SlaxEnv(window);

    initElementInterceptors();

    overrideStyleProperties();

    overrideFetch();
    overrideXHR();

    overrideWorkers();

    disableNotifications();
    disableGeolocation();
    overrideBeacon();

    overrideIntersectionObserver();

    initDOMInterceptors();
  }

  initAllInterceptors();
})();
