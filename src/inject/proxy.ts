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

    const value = Reflect.get(obj, prop);

    if (typeof value === "function" && ownProps.indexOf(propStr) !== -1) {
      if (!funCache[propStr]) {
        funCache[propStr] = this.wrapFunction(obj, value);
      }
      return funCache[propStr];
    }

    return value;
  }

  private wrapFunction(thisObj: any, origFn: Function): Function {
    return function (this: any, ...args: any[]): any {
      return origFn.apply(thisObj, args);
    };
  }

  public get_override(name: string): any {
    return this.overrides.get(name);
  }

  public set_override(name: string, value: any): void {
    this.overrides.set(name, value);
  }
}
