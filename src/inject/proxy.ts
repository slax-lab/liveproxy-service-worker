export class SlaxEnv {
  private overrides: Map<string, any> = new Map();
  private window: Window;
  private objProxies: Map<any, any> = new Map();

  constructor(window: Window) {
    this.window = window;

    //@ts-ignore
    const slaxLocation = window._slaxLocation || null;
    if (slaxLocation) {
      this.overrides.set("location", slaxLocation);
    }

    //@ts-ignore
    window._SLAX_obj_proxy = {};

    this.setupDefinePropertyInterceptor();
    this.initWindowProxy();
    this.initDocumentProxy();
  }

  private initWindowProxy(): void {
    const wombat = this;
    const windowOwnProps = this.getAllOwnProps(this.window);
    const funCache = {};

    const windowProxy = new (this.window as any).Proxy(this.window, {
      get: (target: any, prop: string | symbol) => {
        if (prop === "location") {
          return wombat.overrides.get("location") || target.location;
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
  }

  private initDocumentProxy(): void {
    const wombat = this;
    const documentOwnProps = this.getAllOwnProps(this.window.document);
    const funCache = {};

    const documentProxy = new (this.window as any).Proxy(this.window.document, {
      get: (target: any, prop: string | symbol) => {
        if (prop === "location") {
          return wombat.overrides.get("location") || target.location;
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
    funCache: any
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

    const value = Reflect.get(obj, prop);
    const type = typeof value;

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
        const cachedFn = funCache[propStr];
        if (!cachedFn || cachedFn.original !== value) {
          const boundFn = value.bind(obj);

          const skipProps = ["arguments", "caller", "length"];
          for (const ownProp of Object.getOwnPropertyNames(value)) {
            if (!skipProps.includes(ownProp)) {
              try {
                boundFn[ownProp] = value[ownProp];
              } catch (e) {}
            }
          }

          funCache[propStr] = {
            original: value,
            boundFn,
          };

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

  private wrapDOMConstructor(origCtor: Function): Function {
    const proxyThis = this;

    function wrappedConstructor(this: any, ...args: any[]): any {
      if (!(this instanceof wrappedConstructor)) {
        return new (origCtor as any)(...args);
      }
      return new (origCtor as any)(...args);
    }

    wrappedConstructor.prototype = origCtor.prototype;

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

    if (obj._SLAX_obj_proxy) {
      for (const [origObj, proxyObj] of this.objProxies.entries()) {
        if (proxyObj === obj) {
          return origObj;
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
