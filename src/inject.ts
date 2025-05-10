import { parseUrl } from "./url";
import { SlaxLocation } from "./inject/location";
import { SlaxEnv } from "./inject/proxy";
import { extractOriginalUrl } from "./inject/utils";

const originURL = "${originURL}";
const proxyURL = "${proxyURL}";
//@ts-ignore
window.proxyPrefixPath = "${proxyPrefixPath}";
//@ts-ignore
window.proxyPrefixPathRegexp = new RegExp("${proxyPrefixPathRegexpStr}");

(function () {
  if ((window as any).__URL_REWRITER_INITIALIZED__) return;
  (window as any).__URL_REWRITER_INITIALIZED__ = true;

  function rewriteUrl(url: string, mod: string): string {
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

      //@ts-ignore
      return `${proxyURL}${window.proxyPrefixPath}/${mod}/${fullUrl}`;
    } catch (error) {
      return url;
    }
  }

  function overrideElementGetSetAttribute(): void {
    const originalGetAttribute = Element.prototype.getAttribute;
    Element.prototype.getAttribute = function (name) {
      const value = originalGetAttribute.call(this, name);
      return extractOriginalUrl(value || "");
    };
  }

  function createPropertyInterceptor(
    prototype: any,
    propName: string,
    mod: string,
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

  function createSrcsetInterceptor(prototype: any): void {
    const srcsetPropName = "_originalSrcset";

    Object.defineProperty(prototype, "srcset", {
      get: function (this: HTMLElement): string {
        return (this as any)[srcsetPropName] || "";
      },
      set: function (this: HTMLElement, value: string): void {
        (this as any)[srcsetPropName] = value;

        if (!value) {
          this.setAttribute("srcset", "");
          return;
        }

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
        const rewrittenUrl = rewriteUrl(url, "im_");
        return `url(${quote}${rewrittenUrl}${quote})`;
      }
    );
  }

  function overrideStyleProperties(): void {
    const originalSetProperty = CSSStyleDeclaration.prototype.setProperty;

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

    cssPropertiesToRewrite.forEach((propName) => {
      const camelCaseProp = propName.replace(
        /-([a-z])/g,
        (_, letter: string): string => letter.toUpperCase()
      );

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

  function overrideFetch(): void {
    const originalFetch = window.fetch;
    const specialProtocols = ["javascript:", "data:", "#", "blob:", "about:"];

    window.fetch = function (
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> {
      try {
        let rewrittenInput = input;

        if (!input) {
          return originalFetch.call(this, input, init);
        }

        if (typeof input === "string") {
          if (specialProtocols.some((protocol) => input.startsWith(protocol))) {
            return originalFetch.call(this, input, init);
          }

          try {
            rewrittenInput = rewriteUrl(input, "mp_");
          } catch (error) {
            console.error("[Fetch Interceptor] Error rewriting URL:", error);
            rewrittenInput = input;
          }
        } else if (input instanceof Request) {
          try {
            const originalUrl = input.url;
            if (
              specialProtocols.some((protocol) =>
                originalUrl.startsWith(protocol)
              )
            ) {
              return originalFetch.call(this, input, init);
            }

            const rewrittenUrl = rewriteUrl(originalUrl, "mp_");
            rewrittenInput = new Request(rewrittenUrl, input);
          } catch (error) {
            console.error(
              "[Fetch Interceptor] Error rewriting Request URL:",
              error
            );
            rewrittenInput = input;
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

  function overrideXHR(): void {
    const originalOpen = XMLHttpRequest.prototype.open;
    const specialProtocols = ["javascript:", "data:", "#", "blob:", "about:"];

    XMLHttpRequest.prototype.open = function (
      method: string,
      url: string,
      async?: boolean,
      user?: string,
      password?: string
    ): void {
      try {
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

        // 重写 URL
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

    if (navigator.serviceWorker) {
      const originalRegister = navigator.serviceWorker.register;
      navigator.serviceWorker.register = function (
        scriptURL: string | URL,
        options?: RegistrationOptions
      ): Promise<ServiceWorkerRegistration> {
        console.log(
          `[Worker Interceptor] Registering Service Worker: ${scriptURL}`
        );
        console.warn("[Worker Interceptor] ServiceWorker registration blocked");
        return Promise.reject(
          new Error("ServiceWorker registration is disabled")
        );
      };
    }
  }

  function disableNotifications(): void {
    if (window.Notification) {
      interface MockNotification {
        close: () => void;
      }

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

      Object.defineProperties(window.Notification, {
        permission: {
          get: function (): NotificationPermission {
            console.log(
              "[Notification Interceptor] Getting Notification.permission"
            );
            return "denied";
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

      //@ts-ignore
      navigator.geolocation = mockGeolocation;
    }
  }

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

  function overrideDocumentCreateElement(): void {
    const originalCreateElement = document.createElement;
    document.createElement = function (
      tagName: string,
      options?: ElementCreationOptions | undefined
    ): HTMLElement {
      const element = originalCreateElement.call(document, tagName, options);

      if (element instanceof HTMLElement) {
        applyInterceptorsToNewElement(element);
      }

      return element;
    };

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
      interceptElementAttribute(element, "src", "if_");
    } else if (element instanceof HTMLVideoElement) {
      interceptElementAttribute(element, "src", "mp_");
    } else if (element instanceof HTMLAudioElement) {
      interceptElementAttribute(element, "src", "mp_");
    } else if (element instanceof HTMLSourceElement) {
      interceptElementAttribute(element, "src", "mp_");
      interceptElementSrcset(element);
    } else if (element instanceof HTMLScriptElement) {
      if (element.getAttribute("type") === "module") {
        interceptElementAttribute(element, "src", "esm_");
      } else {
        interceptElementAttribute(element, "src", "js_");
      }
    } else if (element instanceof HTMLLinkElement) {
      let mod = "mp_";
      if (
        element.rel === "stylesheet" ||
        element.as === "style" ||
        (element.getAttribute("href") &&
          element.getAttribute("href")!.endsWith(".css"))
      ) {
        mod = "cs_";
      } else if (
        element.getAttribute("href")?.endsWith(".mjs") ||
        element.rel === "modulepreload" ||
        element.rel === "module"
      ) {
        mod = "esm_";
      }
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
    mod: string
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
        return originalSetAttribute.call(this, name, value);
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

  function processDocumentFragment(fragment: DocumentFragment): void {
    Array.from(fragment.childNodes).forEach((node) => {
      if (node instanceof HTMLElement) {
        applyInterceptorsToNewElement(node);
      }
    });
  }

  function overrideDocumentWrite(): void {
    const originalWrite = document.write;
    document.write = function (...args: string[]): void {
      if (args.length > 0 && typeof args[0] === "string") {
        args[0] = rewriteHTMLContent(args[0]);
      }
      originalWrite.apply(document, args);
    };

    const originalWriteln = document.writeln;
    document.writeln = function (...args: string[]): void {
      if (args.length > 0 && typeof args[0] === "string") {
        args[0] = rewriteHTMLContent(args[0]);
      }
      originalWriteln.apply(document, args);
    };
  }

  function rewriteHTMLContent(html: string): string {
    if (!html || typeof html !== "string") return html;

    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    const elements = doc.querySelectorAll("*");
    elements.forEach((element) => {
      if (element instanceof HTMLElement) {
        const urlAttributes = ["src", "href", "action", "data-src"];
        urlAttributes.forEach((attr) => {
          if (element.hasAttribute(attr)) {
            const value = element.getAttribute(attr);
            if (value) {
              let mod = "mp_";
              if (element instanceof HTMLScriptElement) {
                if (element.getAttribute("type") === "module") {
                  mod = "esm_";
                } else {
                  mod = "js_";
                }
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

        if (element.hasAttribute("style")) {
          const style = element.getAttribute("style");
          if (style && style.includes("url(")) {
            element.setAttribute("style", rewriteCssUrls(style));
          }
        }
      }
    });

    return doc.documentElement.innerHTML;
  }

  function overrideHTMLInsertionAPIs(): void {
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

    const originalInsertAdjacentHTML = Element.prototype.insertAdjacentHTML;
    Element.prototype.insertAdjacentHTML = function (position, html) {
      const rewrittenHTML = rewriteHTMLContent(html);
      originalInsertAdjacentHTML.call(this, position, rewrittenHTML);

      if (this instanceof HTMLElement) {
        const elementsToCheck = Array.from(this.querySelectorAll("*"));
        if (position === "beforebegin" || position === "afterend") {
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

  function overrideNodeRelatedAPIs(): void {
    const originalAppendChild = Node.prototype.appendChild;
    Node.prototype.appendChild = function <T extends Node>(newChild: T): T {
      if (newChild instanceof Node) {
        if (newChild instanceof HTMLElement) {
          applyInterceptorsToNewElement(newChild);
        }
        //@ts-ignore
        return originalAppendChild.call(this, newChild);
      }

      if (typeof newChild === "string") {
        console.warn(
          "[Node Interceptor] String passed to appendChild, converting to TextNode"
        );
        const textNode = document.createTextNode(newChild);
        return originalAppendChild.call(this, textNode) as unknown as T;
      }

      try {
        //@ts-ignore
        return originalAppendChild.call(this, newChild);
      } catch (e) {
        console.warn("[Node Interceptor] Error in appendChild:", e);
        return this as unknown as T;
      }
    };

    const originalInsertBefore = Node.prototype.insertBefore;
    Node.prototype.insertBefore = function <T extends Node>(
      newChild: T,
      refChild: Node | null
    ): T {
      try {
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
      } catch (e) {
        console.warn(
          "[Node Interceptor] Error in insertBefore, using original method:",
          e
        );
        //@ts-ignore
        return originalInsertBefore.call(this, newChild, refChild);
      }
    };

    const originalReplaceChild = Node.prototype.replaceChild;
    //@ts-ignore
    Node.prototype.replaceChild = function <T extends Node>(
      newChild: T,
      oldChild: Node
    ): T {
      try {
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
      } catch (e) {
        console.warn(
          "[Node Interceptor] Error in replaceChild, using original method:",
          e
        );
        //@ts-ignore
        return originalReplaceChild.call(this, newChild, oldChild);
      }
    };

    if (Element.prototype.append) {
      const originalAppend = Element.prototype.append;
      Element.prototype.append = function (...nodes: (Node | string)[]) {
        try {
          const processedNodes = nodes.map((node) => {
            if (node instanceof HTMLElement) {
              applyInterceptorsToNewElement(node);
              return node;
            }
            return node;
          });

          return originalAppend.apply(this, processedNodes);
        } catch (e) {
          console.warn(
            "[Node Interceptor] Error in append, using original method:",
            e
          );
          return originalAppend.apply(this, nodes);
        }
      };
    }

    if (Element.prototype.prepend) {
      const originalPrepend = Element.prototype.prepend;
      Element.prototype.prepend = function (...nodes: (Node | string)[]) {
        try {
          const processedNodes = nodes.map((node) => {
            if (node instanceof HTMLElement) {
              applyInterceptorsToNewElement(node);
              return node;
            }
            return node;
          });

          return originalPrepend.apply(this, processedNodes);
        } catch (e) {
          console.warn(
            "[Node Interceptor] Error in prepend, using original method:",
            e
          );
          return originalPrepend.apply(this, nodes);
        }
      };
    }

    const originalSetAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (
      name: string,
      value: string
    ): void {
      try {
        const urlAttributes = ["src", "href", "action", "data-src"];
        if (urlAttributes.includes(name) && typeof value === "string") {
          let mod = "mp_";

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

        if (
          name === "style" &&
          typeof value === "string" &&
          value.includes("url(")
        ) {
          const rewrittenStyle = rewriteCssUrls(value);
          return originalSetAttribute.call(this, name, rewrittenStyle);
        }

        return originalSetAttribute.call(this, name, value);
      } catch (e) {
        console.warn(
          "[Node Interceptor] Error in setAttribute, using original method:",
          e
        );
        return originalSetAttribute.call(this, name, value);
      }
    };
  }

  function overrideImport(): void {
    //@ts-ignore
    window.__slax_js_import__ = function (base: string, url: string) {
      if (base) {
        url = new URL(url, base).toString();
      }
      return import(/*webpackIgnore: true*/ rewriteUrl(url, "esm_"));
    };
  }

  function overrideHistoryMethods(): void {
    if (!window.history) return;

    const originalPushState = window.history.pushState;
    const originalReplaceState = window.history.replaceState;

    const makeURLParser = (url: string, doc: Document): URL => {
      try {
        return new URL(url, originURL);
      } catch (e) {
        console.error(`Failed to parse URL: ${url}`, e);
        return new URL(window.location.href);
      }
    };

    window.history.pushState = function (
      state: any,
      title: string,
      url?: string | URL | null
    ): void {
      console.log(`Intercepted pushState with URL: ${url}`);

      const urlStr = url ? url.toString() : "";
      const originalUrl = extractOriginalUrl(urlStr);
      let rewrittenUrl = url;

      if (!originalUrl || !urlStr) {
        console.warn("[History Interceptor] Failed to extract original URL");
        return;
      }

      if (originalUrl) {
        const parser = makeURLParser(originalUrl, document);
        const resolvedURL = parser.href;
        //@ts-ignore
        rewrittenUrl = rewriteUrl(resolvedURL);

        console.log(`pushState: ${originalUrl} -> ${rewrittenUrl}`);
      }

      originalPushState.call(this, state, title, rewrittenUrl);
    };

    window.history.replaceState = function (
      state: any,
      title: string,
      url?: string | URL | null
    ): void {
      console.log(`Intercepted replaceState with URL: ${url}`);
      console.log(`Current location: ${window.location.href}`);
      console.log(`Stack trace: ${new Error().stack}`);

      const urlStr = url ? url.toString() : "";
      const originalUrl = extractOriginalUrl(urlStr);
      let rewrittenUrl = url;

      if (originalUrl) {
        const parser = makeURLParser(originalUrl, document);
        const resolvedURL = parser.href;
        //@ts-ignore
        rewrittenUrl = rewriteUrl(resolvedURL);

        console.log(`replaceState: ${originalUrl} -> ${rewrittenUrl}`);
      }

      if (!originalUrl || !urlStr) {
        console.warn("[History Interceptor] Failed to extract original URL");
        return;
      }

      originalReplaceState.call(this, state, title, rewrittenUrl);
    };
  }

  function overrideQuerySelectors(): void {
    if (!document.querySelector || !Document.prototype.querySelector) {
      return;
    }

    function rewriteQuery(query: string): string {
      if (typeof query === "string") {
        try {
          return query.replace(
            /(\[(?:src|href|data-href))([\^]?=(['"])(?:https?:)?\/\/[^'"]*\3)\]/g,
            "$1*$2]"
          );
        } catch (error) {
          console.error(
            "[Query Selector Interceptor] Error in rewriteQuery:",
            error
          );
        }
      }
      return query;
    }

    function getOriginalObject(obj: any): any {
      if (obj && typeof obj === "object" && obj._SLAX_obj_proxy) {
        for (const [origObj, proxyObj] of (
          window as any
        ).slaxEnv.objProxies.entries()) {
          if (proxyObj === obj) {
            return origObj;
          }
        }
      }
      return obj;
    }

    const orig_QS = document.querySelector;
    const orig_QSA = document.querySelectorAll;

    const querySelector = function (this: any, query: string): Element | null {
      const originalThis = getOriginalObject(this);
      const result = orig_QS.call(originalThis, rewriteQuery(query));
      return result;
    };

    const querySelectorAll = function (
      this: any,
      query: string
    ): NodeListOf<Element> {
      const originalThis = getOriginalObject(this);
      const result = orig_QSA.call(originalThis, rewriteQuery(query));
      return result;
    };

    Document.prototype.querySelector = querySelector;
    document.querySelector = querySelector;

    Document.prototype.querySelectorAll = querySelectorAll;
    document.querySelectorAll = querySelectorAll;
  }

  function overrideNodeMethods(): void {
    const originalCreateTreeWalker = Document.prototype.createTreeWalker;
    Document.prototype.createTreeWalker = function (
      root: Node,
      whatToShow?: number,
      filter?: NodeFilter | null,
      entityReferenceExpansion?: boolean
    ): TreeWalker {
      //@ts-ignore
      if (root && typeof root === "object" && root._SLAX_obj_proxy) {
        for (const [origObj, proxyObj] of (
          window as any
        ).slaxEnv.objProxies.entries()) {
          if (proxyObj === root) {
            root = origObj;
            break;
          }
        }
      }

      if (!(root instanceof Node)) {
        console.error("[TreeWalker Interceptor] Invalid root node:", root);
        throw new TypeError(
          "Failed to execute 'createTreeWalker' on 'Document': parameter 1 is not of type 'Node'."
        );
      }

      return originalCreateTreeWalker.call(
        this,
        root,
        whatToShow || 0,
        filter || null,
        //@ts-ignore
        entityReferenceExpansion || false
      );
    };

    if (Document.prototype.createNodeIterator) {
      const originalCreateNodeIterator = Document.prototype.createNodeIterator;
      Document.prototype.createNodeIterator = function (
        root: Node,
        whatToShow?: number,
        filter?: NodeFilter | null
      ): NodeIterator {
        //@ts-ignore
        if (root && typeof root === "object" && root._SLAX_obj_proxy) {
          for (const [origObj, proxyObj] of (
            window as any
          ).slaxEnv.objProxies.entries()) {
            if (proxyObj === root) {
              root = origObj;
              break;
            }
          }
        }

        if (!(root instanceof Node)) {
          console.error("[NodeIterator Interceptor] Invalid root node:", root);
          throw new TypeError(
            "Failed to execute 'createNodeIterator' on 'Document': parameter 1 is not of type 'Node'."
          );
        }

        return originalCreateNodeIterator.call(
          this,
          root,
          whatToShow || 0,
          filter || null
        );
      };
    }

    if (Range.prototype.setStart) {
      const originalSetStart = Range.prototype.setStart;
      Range.prototype.setStart = function (node: Node, offset: number): void {
        //@ts-ignore
        if (node && typeof node === "object" && node._SLAX_obj_proxy) {
          for (const [origObj, proxyObj] of (
            window as any
          ).slaxEnv.objProxies.entries()) {
            if (proxyObj === node) {
              node = origObj;
              break;
            }
          }
        }

        return originalSetStart.call(this, node, offset);
      };
    }

    if (Range.prototype.setEnd) {
      const originalSetEnd = Range.prototype.setEnd;
      Range.prototype.setEnd = function (node: Node, offset: number): void {
        //@ts-ignore
        if (node && typeof node === "object" && node._SLAX_obj_proxy) {
          for (const [origObj, proxyObj] of (
            window as any
          ).slaxEnv.objProxies.entries()) {
            if (proxyObj === node) {
              node = origObj;
              break;
            }
          }
        }

        return originalSetEnd.call(this, node, offset);
      };
    }

    const nodeMethodsToFix = [
      "appendChild",
      "insertBefore",
      "replaceChild",
      "removeChild",
    ];

    nodeMethodsToFix.forEach((methodName) => {
      const originalMethod = Node.prototype[methodName];
      // @ts-ignore
      Node.prototype[methodName] = function (...args) {
        const processedArgs = args.map((arg) => {
          if (arg && typeof arg === "object" && arg._SLAX_obj_proxy) {
            for (const [origObj, proxyObj] of (
              window as any
            ).slaxEnv.objProxies.entries()) {
              if (proxyObj === arg) {
                return origObj;
              }
            }
          }
          return arg;
        });

        return originalMethod.apply(this, processedArgs);
      };
    });

    if (TreeWalker && TreeWalker.prototype) {
      const originalCurrentNodeDesc = Object.getOwnPropertyDescriptor(
        TreeWalker.prototype,
        "currentNode"
      );

      if (originalCurrentNodeDesc && originalCurrentNodeDesc.set) {
        Object.defineProperty(TreeWalker.prototype, "currentNode", {
          get: function () {
            return originalCurrentNodeDesc.get!.call(this);
          },
          set: function (value) {
            if (value && typeof value === "object" && value._SLAX_obj_proxy) {
              for (const [origObj, proxyObj] of (
                window as any
              ).slaxEnv.objProxies.entries()) {
                if (proxyObj === value) {
                  value = origObj;
                  break;
                }
              }
            }

            if (!(value instanceof Node)) {
              console.error("[TreeWalker Interceptor] Invalid node:", value);
              throw new TypeError(
                "Failed to set the 'currentNode' property on 'TreeWalker': Failed to convert value to 'Node'."
              );
            }

            return originalCurrentNodeDesc.set!.call(this, value);
          },
          enumerable: originalCurrentNodeDesc.enumerable,
          configurable: originalCurrentNodeDesc.configurable,
        });
      }
    }
  }

  function overrideDocumentDefaultView(): void {
    const originalDefaultViewDesc = Object.getOwnPropertyDescriptor(
      Document.prototype,
      "defaultView"
    );

    if (!originalDefaultViewDesc || originalDefaultViewDesc.configurable) {
      Object.defineProperty(Document.prototype, "defaultView", {
        get: function () {
          return window;
        },
        configurable: true,
      });
    }
  }

  function initDOMInterceptors(): void {
    overrideDocumentCreateElement();
    overrideDocumentWrite();
    overrideHTMLInsertionAPIs();
    overrideNodeRelatedAPIs();
  }

  function initElementInterceptors(): void {
    createPropertyInterceptor(HTMLAnchorElement.prototype, "href", "mp_");
    createPropertyInterceptor(HTMLAreaElement.prototype, "href", "mp_");
    createPropertyInterceptor(HTMLImageElement.prototype, "src", "mp_");
    createPropertyInterceptor(HTMLIFrameElement.prototype, "src", "if_");
    createPropertyInterceptor(HTMLVideoElement.prototype, "src", "mp_");
    createPropertyInterceptor(HTMLAudioElement.prototype, "src", "mp_");
    createPropertyInterceptor(HTMLSourceElement.prototype, "src", "mp_");

    createPropertyInterceptor(
      HTMLScriptElement.prototype,
      "src",
      "js_",
      function (el) {
        if (
          el.getAttribute("type") === "module" ||
          el.hasAttribute("nomodule") ||
          el.getAttribute("type") === "importmap"
        ) {
          return "esm_";
        }
        return "js_";
      }
    );

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
        } else if (
          (el.getAttribute("href")?.endsWith(".mjs") ||
            el.getAttribute("rel")?.includes("modulepreload") ||
            el.getAttribute("rel")?.includes("module")) &&
          !el.getAttribute("nomodule")
        ) {
          return "esm_";
        }
        if (el.getAttribute("src")?.endsWith(".js")) {
          return "js_";
        }
        return "mp_";
      }
    );

    createSrcsetInterceptor(HTMLImageElement.prototype);
    createSrcsetInterceptor(HTMLSourceElement.prototype);

    createPropertyInterceptor(HTMLFormElement.prototype, "action", "mp_");
  }

  function initAllInterceptors(): void {
    //@ts-ignore
    window._slaxLocation = new SlaxLocation(window.location);
    //@ts-ignore
    window.slaxEnv = new SlaxEnv(window);

    initElementInterceptors();

    overrideStyleProperties();

    overrideNodeMethods();

    overrideFetch();
    overrideXHR();

    overrideWorkers();

    overrideQuerySelectors();

    disableNotifications();
    disableGeolocation();
    overrideBeacon();

    initDOMInterceptors();

    overrideDocumentDefaultView();

    overrideImport();

    overrideHistoryMethods();

    overrideElementGetSetAttribute();
  }

  initAllInterceptors();
})();
