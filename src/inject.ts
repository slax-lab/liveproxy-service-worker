import { disablePostHost } from "./config";
import { SlaxLocation } from "./inject/location";
import { SlaxEnv } from "./inject/proxy";
import { extractOriginalUrl, rewriteUrl } from "./inject/utils";

const originURL = "${originURL}";
const proxyURL = "${proxyURL}";

class SlaxInject {
  private slaxLocation: SlaxLocation;

  constructor(private $window: Window) {
    console.log("[Interceptor] Execution context:", {
      isIframe: self !== top,
      location: self.location.href,
      parent: self.parent ? "exists" : "none",
    });

    this.slaxLocation = new SlaxLocation(this.$window.location);

    //@ts-ignore
    this.$window._slaxLocation = this.slaxLocation;
    //@ts-ignore
    this.slaxEnv = new SlaxEnv(this.$window);

    console.log("[SlaxInject] Injection completed");

    this.initAllInterceptors();
  }

  createPropertyInterceptor(
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
        const rewrittenValue = rewriteUrl(value, proxyURL, originURL, finalMod);

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

  createSrcsetInterceptor(prototype: any): void {
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
            const rewrittenUrl = rewriteUrl(url, proxyURL, originURL, "mp_");
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

  rewriteCssUrls(value: string): string {
    if (!value || typeof value !== "string" || !value.includes("url(")) {
      return value;
    }

    return value.replace(
      /url\(\s*(['"]?)([^'"\)]+)\1\s*\)/gi,
      function (match, quote, url) {
        if (url.startsWith("data:") || url.startsWith("#")) {
          return match;
        }
        const rewrittenUrl = rewriteUrl(url, proxyURL, originURL, "mp_");
        return `url(${quote}${rewrittenUrl}${quote})`;
      }
    );
  }

  overrideStyleProperties(): void {
    const originalSetProperty = CSSStyleDeclaration.prototype.setProperty;
    const classBin = this;

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
        value = classBin.rewriteCssUrls(value);
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
              value = classBin.rewriteCssUrls(value);
            }
            originalDescriptor.set!.call(this, value);
          },
          enumerable: true,
          configurable: true,
        });
      }
    });
  }

  overrideFetch(): void {
    const originalFetch = self.fetch;

    self.fetch = function (
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
              specialProtocols.some((protocol) => input.startsWith(protocol)) ||
              disablePostHost.some((host) => host.test(input))
            ) {
              return originalFetch.call(this, input, init);
            }

            rewrittenInput = rewriteUrl(input, proxyURL, originURL, "mp_");
            console.log(
              `[Fetch Interceptor] Rewrote URL: ${input} -> ${rewrittenInput}`
            );
          } catch (error) {
            console.error("[Fetch Interceptor] Error rewriting URL:", error);
            rewrittenInput = input; // 出错时使用原始URL
          }
        } else if (input instanceof Request) {
          try {
            const originalUrl = input.url;
            // 特殊URL协议不需要重写
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
              ) ||
              disablePostHost.some((host) => host.test(originalUrl))
            ) {
              return originalFetch.call(this, input, init);
            }

            const rewrittenUrl = rewriteUrl(
              originalUrl,
              proxyURL,
              originURL,
              "mp_"
            );
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

  overrideXHR(): void {
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
        if (
          specialProtocols.some((protocol) => url.startsWith(protocol)) ||
          disablePostHost.some((host) => host.test(url))
        ) {
          return originalOpen.call(
            this,
            method,
            url,
            async ?? true,
            user,
            password
          );
        }

        const rewrittenUrl = rewriteUrl(url, proxyURL, originURL, "mp_");

        console.log(`[XHR Interceptor] Rewrote URL: ${url} -> ${rewrittenUrl}`);

        return originalOpen.call(
          this,
          method,
          rewrittenUrl,
          async ?? true,
          user,
          password
        );
      } catch (error) {
        // 发生错误时记录并使用原始URL
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

  overrideWorkers(): void {
    // Web Worker拦截
    const originalWorker = self.Worker;
    //@ts-ignore
    self.Worker = function (
      url: string | URL,
      options?: WorkerOptions
    ): Worker {
      console.log(`[Worker Interceptor] Creating Web Worker with URL: ${url}`);
      let interceptedUrl = url;

      if (typeof url === "string") {
        interceptedUrl = rewriteUrl(url, proxyURL, originURL, "js_");
        console.log(
          `[Worker Interceptor] Rewrote Worker URL: ${url} -> ${interceptedUrl}`
        );
      }

      return new originalWorker(interceptedUrl, options);
    } as typeof Worker;

    // Shared Worker拦截
    if (typeof SharedWorker !== "undefined") {
      const originalSharedWorker = self.SharedWorker;
      //@ts-ignore
      self.SharedWorker = function (
        url: string | URL,
        options?: string | WorkerOptions
      ): SharedWorker {
        console.log(
          `[Worker Interceptor] Creating Shared Worker with URL: ${url}`
        );
        let interceptedUrl = url;

        if (typeof url === "string") {
          interceptedUrl = rewriteUrl(url, proxyURL, originURL, "js_");
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

  disableNotifications(): void {
    if (self.Notification) {
      // 模拟通知接口
      interface MockNotification {
        close: () => void;
      }

      // 重写Notification
      self.Notification = function (
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
      Object.defineProperties(self.Notification, {
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

  disableGeolocation(): void {
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
    }
  }

  overrideBeacon(): void {
    if (navigator.sendBeacon) {
      const originalSendBeacon = navigator.sendBeacon;
      navigator.sendBeacon = function (
        url: string | URL,
        data?: BodyInit | null
      ): boolean {
        let rewrittenUrl = url;

        // TODO: Beacon 先跳过，不处理
        // if (typeof url === "string") {
        //   rewrittenUrl = rewriteUrl(url, "mp_");
        //   console.log(
        //     `[Beacon Interceptor] Rewrote sendBeacon URL: ${url} -> ${rewrittenUrl}`
        //   );
        // }

        console.log(`[Beacon Interceptor] sendBeacon to ${rewrittenUrl}`, data);
        return originalSendBeacon.call(navigator, rewrittenUrl, data);
      };
    }
  }

  overrideDocumentCreateElement(): void {
    const originalCreateElement = document.createElement;
    const classBin = this;
    document.createElement = function (
      tagName: string,
      options?: ElementCreationOptions | undefined
    ): HTMLElement {
      const element = originalCreateElement.call(document, tagName, options);

      // 为新创建的元素应用相应的拦截器
      if (element instanceof HTMLElement) {
        classBin.applyInterceptorsToNewElement(element);
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
        classBin.applyInterceptorsToNewElement(element);
      }

      return element;
    };
  }

  applyInterceptorsToNewElement(element: HTMLElement): void {
    // 根据元素类型应用不同的拦截器
    if (element instanceof HTMLAnchorElement) {
      this.interceptElementAttribute(element, "href", "mp_");
    } else if (element instanceof HTMLAreaElement) {
      this.interceptElementAttribute(element, "href", "mp_");
    } else if (element instanceof HTMLImageElement) {
      this.interceptElementAttribute(element, "src", "mp_");
      this.interceptElementSrcset(element);
    } else if (element instanceof HTMLIFrameElement) {
      this.interceptElementAttribute(element, "src", "mp_");
    } else if (element instanceof HTMLVideoElement) {
      this.interceptElementAttribute(element, "src", "mp_");
    } else if (element instanceof HTMLAudioElement) {
      this.interceptElementAttribute(element, "src", "mp_");
    } else if (element instanceof HTMLSourceElement) {
      this.interceptElementAttribute(element, "src", "mp_");
      this.interceptElementSrcset(element);
    } else if (element instanceof HTMLScriptElement) {
      this.interceptElementAttribute(element, "src", "js_");
    } else if (element instanceof HTMLLinkElement) {
      // 对于link元素，需要检查rel属性
      const mod =
        element.rel === "stylesheet" ||
        element.as === "style" ||
        (element.getAttribute("href") &&
          element.getAttribute("href")!.endsWith(".css"))
          ? "cs_"
          : "mp_";
      this.interceptElementAttribute(element, "href", mod);
    } else if (element instanceof HTMLFormElement) {
      this.interceptElementAttribute(element, "action", "mp_");
    }

    // 额外处理DocumentFragment
    //@ts-ignore
    if (element.content && element.content instanceof DocumentFragment) {
      //@ts-ignore
      processDocumentFragment(element.content);
    }

    // 处理子元素
    if (element.children && element.children.length > 0) {
      Array.from(element.children).forEach((child) => {
        if (child instanceof HTMLElement) {
          this.applyInterceptorsToNewElement(child);
        }
      });
    }
  }

  interceptElementAttribute(
    element: HTMLElement,
    attributeName: string,
    mod: string = "mp_"
  ): void {
    // 获取原始的属性值
    const originalValue = element.getAttribute(attributeName);

    // 如果属性已经存在，立即进行重写
    if (originalValue) {
      const rewrittenValue = rewriteUrl(
        originalValue,
        proxyURL,
        originURL,
        mod
      );
      element.setAttribute(attributeName, rewrittenValue);
    }

    // 拦截setAttribute方法
    const originalSetAttribute = element.setAttribute;
    element.setAttribute = function (name: string, value: string): void {
      if (name === attributeName) {
        const rewrittenValue = rewriteUrl(value, proxyURL, originURL, mod);
        return originalSetAttribute.call(this, name, rewrittenValue);
      }
      return originalSetAttribute.call(this, name, value);
    };
  }

  interceptElementSrcset(element: HTMLImageElement | HTMLSourceElement): void {
    // 获取原始的srcset值
    const originalSrcset = element.srcset;

    // 如果srcset已经存在，立即进行重写
    if (originalSrcset) {
      const parts = originalSrcset.split(",").map((part) => {
        const [url, ...descriptors] = part.trim().split(/\s+/);
        if (url && !url.startsWith("data:")) {
          const rewrittenUrl = rewriteUrl(url, proxyURL, originURL, "mp_");
          return [rewrittenUrl, ...descriptors].join(" ");
        }
        return part;
      });

      element.srcset = parts.join(", ");
    }
  }

  processDocumentFragment(fragment: DocumentFragment): void {
    // 遍历所有子节点
    Array.from(fragment.childNodes).forEach((node) => {
      if (node instanceof HTMLElement) {
        this.applyInterceptorsToNewElement(node);
      }
    });
  }

  overrideDocumentWrite(): void {
    const originalWrite = document.write;
    const classBin = this;
    document.write = function (...args: string[]): void {
      // 处理输入的HTML字符串
      if (args.length > 0 && typeof args[0] === "string") {
        args[0] = classBin.rewriteHTMLContent(args[0]);
      }
      originalWrite.apply(document, args);
    };

    const originalWriteln = document.writeln;
    document.writeln = function (...args: string[]): void {
      // 处理输入的HTML字符串
      if (args.length > 0 && typeof args[0] === "string") {
        args[0] = classBin.rewriteHTMLContent(args[0]);
      }
      originalWriteln.apply(document, args);
    };
  }

  rewriteHTMLContent(html: string): string {
    if (!html || typeof html !== "string") return html;

    const classBin = this;

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
              element.setAttribute(
                attr,
                rewriteUrl(value, proxyURL, originURL, mod)
              );
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
                const rewrittenUrl = rewriteUrl(
                  url,
                  proxyURL,
                  originURL,
                  "mp_"
                );
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
            element.setAttribute("style", classBin.rewriteCssUrls(style));
          }
        }
      }
    });

    // 将处理后的HTML转换回字符串
    return doc.documentElement.innerHTML;
  }

  overrideHTMLInsertionAPIs(): void {
    // 拦截Element.prototype.innerHTML
    const classBin = this;
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
          const rewrittenHTML = classBin.rewriteHTMLContent(html);
          originalInnerHTMLDescriptor.set!.call(this, rewrittenHTML);

          // 处理新添加的元素
          if (this instanceof HTMLElement) {
            Array.from(this.querySelectorAll("*")).forEach((element) => {
              if (element instanceof HTMLElement) {
                classBin.applyInterceptorsToNewElement(element);
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
          const rewrittenHTML = classBin.rewriteHTMLContent(html);
          originalOuterHTMLDescriptor.set!.call(this, rewrittenHTML);

          // 处理新添加的元素
          if (this.parentElement) {
            Array.from(this.parentElement.querySelectorAll("*")).forEach(
              (element) => {
                if (element instanceof HTMLElement) {
                  classBin.applyInterceptorsToNewElement(element);
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
      const rewrittenHTML = classBin.rewriteHTMLContent(html);
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
            classBin.applyInterceptorsToNewElement(element);
          }
        });
      }
    };
  }

  overrideNodeRelatedAPIs(): void {
    const classBin = this;

    // 拦截Node.appendChild
    const originalAppendChild = Node.prototype.appendChild;
    Node.prototype.appendChild = function <T extends Node>(newChild: T): T {
      // 如果是有效的节点对象，直接处理
      if (newChild instanceof Node) {
        if (newChild instanceof HTMLElement) {
          classBin.applyInterceptorsToNewElement(newChild);
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
        classBin.applyInterceptorsToNewElement(newChild);
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
        classBin.applyInterceptorsToNewElement(newChild);
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
            classBin.applyInterceptorsToNewElement(node);
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
            classBin.applyInterceptorsToNewElement(node);
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

        const rewrittenValue = rewriteUrl(value, proxyURL, originURL, mod);
        return originalSetAttribute.call(this, name, rewrittenValue);
      }

      // 特殊处理srcset属性
      if (name === "srcset" && typeof value === "string") {
        const parts = value.split(",").map((part) => {
          const [url, ...descriptors] = part.trim().split(/\s+/);
          if (url && !url.startsWith("data:")) {
            const rewrittenUrl = rewriteUrl(url, proxyURL, originURL, "mp_");
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
        const rewrittenStyle = classBin.rewriteCssUrls(value);
        return originalSetAttribute.call(this, name, rewrittenStyle);
      }

      return originalSetAttribute.call(this, name, value);
    };
  }

  overrideIntersectionObserver(): void {
    const OriginalIntersectionObserver = self.IntersectionObserver;

    // 使用构造函数模式正确重写
    self.IntersectionObserver = function (
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

  initElementInterceptors(): void {
    // 拦截元素属性访问器
    this.createPropertyInterceptor(HTMLAnchorElement.prototype, "href");
    this.createPropertyInterceptor(HTMLAreaElement.prototype, "href");
    this.createPropertyInterceptor(HTMLImageElement.prototype, "src");
    this.createPropertyInterceptor(HTMLIFrameElement.prototype, "src");
    this.createPropertyInterceptor(HTMLVideoElement.prototype, "src");
    this.createPropertyInterceptor(HTMLAudioElement.prototype, "src");
    this.createPropertyInterceptor(HTMLSourceElement.prototype, "src");
    this.createPropertyInterceptor(HTMLScriptElement.prototype, "src");

    // 为<link>元素创建特殊的href拦截器
    this.createPropertyInterceptor(
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
    this.createSrcsetInterceptor(HTMLImageElement.prototype);
    this.createSrcsetInterceptor(HTMLSourceElement.prototype);

    // 拦截表单action属性
    this.createPropertyInterceptor(HTMLFormElement.prototype, "action");
  }

  initHistoryOverrides(): void {
    if (self !== self.top) return;

    const origPushState = self.history.pushState;
    const origReplaceState = self.history.replaceState;

    self.history.pushState = function (
      state: any,
      title: string,
      url?: string | URL | null
    ): void {
      console.log(`[History Interceptor] pushState: ${url}`);

      if (url) {
        if (typeof url === "string" && !url.includes(proxyURL)) {
          url = rewriteUrl(url, proxyURL, originURL);
        }
      }

      origPushState.call(this, state, title, url);

      const popStateEvent = new PopStateEvent("popstate", { state: state });
      self.dispatchEvent(popStateEvent);
    };

    self.history.replaceState = function (
      state: any,
      title: string,
      url?: string | URL | null
    ): void {
      if (url) {
        if (typeof url === "string" && !url.includes(proxyURL)) {
          url = rewriteUrl(url, proxyURL, originURL);
        }
      }

      origReplaceState.call(this, state, title, url);

      const popStateEvent = new PopStateEvent("popstate", { state: state });
      self.dispatchEvent(popStateEvent);
    };

    self.addEventListener("popstate", function (event) {
      console.log(
        `[History Interceptor] popstate event: ${self.location.href}`
      );
    });

    console.log("[History Interceptor] History API overrides initialized");
  }

  public initAllInterceptors(): void {
    this.initElementInterceptors();

    this.overrideStyleProperties();

    this.overrideFetch();
    this.overrideXHR();

    this.overrideWorkers();

    this.disableNotifications();
    this.disableGeolocation();
    this.overrideBeacon();

    this.overrideIntersectionObserver();

    this.overrideDocumentCreateElement();
    this.overrideDocumentWrite();
    this.overrideHTMLInsertionAPIs();
    this.overrideNodeRelatedAPIs();

    this.initHistoryOverrides();
  }
}

const slaxInject = new SlaxInject(window);
