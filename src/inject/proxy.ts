export class SlaxEnv {
  private overrides: Map<string, any> = new Map();
  private window: Window;
  public objProxies: Map<any, any> = new Map();
  private funCache: Map<any, Map<string, any>> = new Map();

  constructor(window: Window) {
    this.window = window;

    //@ts-ignore
    window._SLAX_obj_proxy = {};

    this.initLocation();

    this.setupDefinePropertyInterceptor();
    this.initWindowProxy();
    this.initDocumentProxy();
  }

  private initLocation(): void {
    //@ts-ignore
    const slaxLocation = this.window._slaxLocation || null;
    if (slaxLocation) {
      this.overrides.set("location", slaxLocation);
    }
  }

  private initWindowProxy(): void {
    const wombat = this;
    const windowOwnProps = this.getAllOwnProps(this.window);
    const funCache = new Map<string, any>();
    this.funCache.set(this.window, funCache);

    const windowProxy = new (this.window as any).Proxy(this.window, {
      get: (target: any, prop: string | symbol) => {
        if (prop === "location") {
          return wombat.overrides.get("location") || target.location;
        }

        if (prop === "defaultView") {
          return windowProxy;
        }

        return this.defaultProxyGet(
          this.window,
          prop,
          windowOwnProps,
          funCache
        );
      },
      set: (target: any, prop: string | symbol, value: any) => {
        if (prop === "location") {
          const loc = wombat.overrides.get("location");
          if (loc) {
            loc.href = value;
            return true;
          }
        }

        const result = Reflect.set(target, prop, value);

        if (typeof prop === "string" && prop !== "_SLAX_obj_proxy") {
          try {
            //@ts-ignore
            this.window._SLAX_obj_proxy[prop] = value;
          } catch (e) {
            console.error(`Error syncing global property: ${prop}`, e);
          }
        }

        return result;
      },
    });

    //@ts-ignore
    this.window._SLAX_obj_proxy.window = windowProxy;
    //@ts-ignore
    this.window._SLAX_obj_proxy.self = windowProxy;
    this.objProxies.set(this.window, windowProxy);

    try {
      Object.defineProperty(this.window.document, "defaultView", {
        get: function () {
          return windowProxy;
        },
        configurable: true,
      });
    } catch (e) {
      console.error("Failed to override document.defaultView:", e);
    }
  }

  private initDocumentProxy(): void {
    const wombat = this;
    const documentOwnProps = this.getAllOwnProps(this.window.document);
    const funCache = new Map<string, any>();
    this.funCache.set(this.window.document, funCache);

    const documentProxy = new (this.window as any).Proxy(this.window.document, {
      get: (target: any, prop: string | symbol) => {
        if (prop === "location") {
          return wombat.overrides.get("location") || target.location;
        }

        if (prop === "defaultView") {
          return this.objProxies.get(this.window) || this.window;
        }

        return this.defaultProxyGet(
          this.window.document,
          prop,
          documentOwnProps,
          funCache
        );
      },
      set: (target: any, prop: string | symbol, value: any) => {
        if (prop === "location") {
          const loc = wombat.overrides.get("location");
          if (loc) {
            loc.href = value;
            return true;
          }
        }

        return Reflect.set(target, prop, value);
      },
    });

    //@ts-ignore
    this.window._SLAX_obj_proxy.document = documentProxy;
    this.objProxies.set(this.window.document, documentProxy);
  }

  private setupDefinePropertyInterceptor(): void {
    const originalDefineProperty = Object.defineProperty;
    const self = this;

    //@ts-ignore
    Object.defineProperty = function (obj, prop, descriptor) {
      const result = originalDefineProperty.call(this, obj, prop, descriptor);

      if (
        obj === self.window &&
        typeof prop === "string" &&
        prop !== "_SLAX_obj_proxy"
      ) {
        try {
          const value = descriptor.value;
          if (value !== undefined) {
            //@ts-ignore
            self.window._SLAX_obj_proxy[prop] = value;
          } else if (descriptor.get) {
            const value = self.window[prop];
            //@ts-ignore
            self.window._SLAX_obj_proxy[prop] = value;
          }
        } catch (e) {
          console.error(`Error syncing defined property: ${prop}`, e);
        }
      }

      return result;
    };
  }

  private getAllOwnProps(obj: any): string[] {
    if (!obj) return [];

    const ownProps: string[] = [];

    do {
      const props = Object.getOwnPropertyNames(obj);
      for (const prop of props) {
        if (ownProps.indexOf(prop) === -1) {
          ownProps.push(prop);
        }
      }

      obj = Object.getPrototypeOf(obj);
    } while (obj);

    return ownProps;
  }

  private defaultProxyGet(
    obj: any,
    prop: string | symbol,
    ownProps: string[],
    funCache: Map<string, any>
  ): any {
    if (prop === "_SLAX_obj_proxy") {
      return true;
    }

    const propStr = prop.toString();

    if (this.overrides.has(propStr)) {
      return this.overrides.get(propStr);
    }

    if (propStr === "constructor") {
      return obj.constructor;
    }

    if (propStr === "history" && obj === this.window) {
      const historyProxy = this.objProxies.get(this.window.history);
      return historyProxy || this.window.history;
    }

    if (propStr === "defaultView" && obj === this.window.document) {
      return this.objProxies.get(this.window) || this.window;
    }

    const value = Reflect.get(obj, prop);
    const type = typeof value;

    if (type === "object" && value !== null && this.objProxies.has(value)) {
      return this.objProxies.get(value);
    }

    if (type === "function") {
      if (
        propStr === "requestAnimationFrame" ||
        propStr === "cancelAnimationFrame"
      ) {
        if (!this.isNativeFunction(value)) {
          return value;
        }
      }

      if (ownProps.indexOf(propStr) !== -1) {
        const cachedFn = funCache.get(propStr);
        if (!cachedFn || cachedFn.original !== value) {
          let boundFn;

          if (this.needsArgumentProxyConversion(obj, propStr)) {
            boundFn = this.wrapFunctionForArgumentConversion(
              obj,
              propStr,
              value
            );
          } else {
            boundFn = value.bind(obj);
          }

          const skipProps = ["arguments", "caller", "length"];
          for (const ownProp of Object.getOwnPropertyNames(value)) {
            if (!skipProps.includes(ownProp)) {
              try {
                boundFn[ownProp] = value[ownProp];
              } catch (e) {}
            }
          }

          const fnCache = {
            original: value,
            boundFn,
          };

          funCache.set(propStr, fnCache);
          return boundFn;
        }
        return cachedFn.boundFn;
      }
    }

    if (type === "object" && value && value._SLAX_obj_proxy) {
      return value._SLAX_obj_proxy;
    }

    if (
      (type === "function" && /^HTML.*Element$/.test(propStr)) ||
      propStr === "MutationObserver" ||
      propStr === "IntersectionObserver"
    ) {
      return this.wrapDOMConstructor(value);
    }

    return value;
  }

  private needsArgumentProxyConversion(obj: any, methodName: string): boolean {
    const domMethodsNeedingConversion = [
      {
        obj: Document.prototype,
        methods: ["createTreeWalker", "createNodeIterator", "evaluate"],
      },

      {
        obj: Node.prototype,
        methods: [
          "appendChild",
          "insertBefore",
          "replaceChild",
          "removeChild",
          "compareDocumentPosition",
          "contains",
        ],
      },

      {
        obj: Element.prototype,
        methods: ["append", "prepend", "before", "after", "replaceWith"],
      },

      {
        obj: Range.prototype,
        methods: ["setStart", "setEnd", "selectNode", "selectNodeContents"],
      },
    ];

    for (const entry of domMethodsNeedingConversion) {
      if (
        obj instanceof Object &&
        entry.obj.isPrototypeOf(obj) &&
        entry.methods.includes(methodName)
      ) {
        return true;
      }
    }

    return false;
  }

  private wrapFunctionForArgumentConversion(
    obj: any,
    methodName: string,
    originalFunc: Function
  ): Function {
    const self = this;

    return function (...args: any[]) {
      const convertedArgs = args.map((arg) => {
        if (arg instanceof Node || (arg && typeof arg === "object")) {
          return self.proxyToObj(arg);
        }
        return arg;
      });

      return originalFunc.apply(obj, convertedArgs);
    };
  }

  private wrapDOMConstructor(origCtor: Function): Function {
    const proxyThis = this;

    function wrappedConstructor(this: any, ...args: any[]): any {
      if (!(this instanceof wrappedConstructor)) {
        return new (origCtor as any)(...args);
      }

      const newObj = new (origCtor as any)(...args);

      if (newObj instanceof Node) {
        Object.defineProperty(newObj, "__slax_original_node", {
          value: newObj,
          writable: false,
          enumerable: false,
          configurable: false,
        });
      }

      return newObj;
    }

    wrappedConstructor.prototype = origCtor.prototype;

    Object.getOwnPropertyNames(origCtor).forEach((prop) => {
      if (prop !== "prototype" && prop !== "length" && prop !== "name") {
        try {
          Object.defineProperty(
            wrappedConstructor,
            prop,
            Object.getOwnPropertyDescriptor(origCtor, prop) || {}
          );
        } catch (e) {}
      }
    });

    return wrappedConstructor;
  }

  private isNativeFunction(func: Function): boolean {
    return (
      typeof func === "function" &&
      /\[native code\]/.test(Function.prototype.toString.call(func))
    );
  }

  public proxyToObj(obj: any): any {
    if (!obj) {
      return obj;
    }

    if (typeof obj !== "object" && typeof obj !== "function") {
      return obj;
    }

    if (obj._SLAX_obj_proxy) {
      for (const [origObj, proxyObj] of this.objProxies.entries()) {
        if (proxyObj === obj) {
          return origObj;
        }
      }
    }

    if (typeof obj === "object" && obj !== null) {
      if (obj.__slax_original_node) {
        return obj.__slax_original_node;
      }

      if (obj._SLAX_obj_proxy) {
        if (
          obj instanceof Node ||
          (obj.nodeType !== undefined && obj.nodeName !== undefined)
        ) {
          return obj;
        }
      }
    }

    return obj;
  }

  public get_override(name: string): any {
    return this.overrides.get(name);
  }

  public set_override(name: string, value: any): void {
    this.overrides.set(name, value);
  }
}
