export class SlaxEnv {
  private overrides: Map<string, any> = new Map();
  private window: Window;
  public objProxies: Map<any, any> = new Map();
  private funCache: Map<any, Map<string, any>> = new Map();
  private readonly PREFIX = "__slax_";

  constructor(window: Window) {
    this.window = window;

    //@ts-ignore
    window._SLAX_obj_proxy = {};

    this.initLocation();
    this.initWindowProxy();
    this.initDocumentProxy();
    this.initIntersectionObsOverride();
    this.initMutationObsOverride();
    this.initCookieProxy();
    this.initIndexedDBProxy();
    this.overrideGetComputedStyle();
    this.setupDefinePropertyInterceptor();
  }

  private initLocation(): void {
    //@ts-ignore
    const slaxLocation = this.window._slaxLocation;
    this.overrides.set("location", slaxLocation);
    //@ts-ignore
    this.window._SLAX_obj_proxy.location = slaxLocation;
  }

  private overrideGetComputedStyle(): void {
    const originalGetComputedStyle = this.window.getComputedStyle;
    const self = this;

    function enhancedGetComputedStyle(element, pseudoElt) {
      try {
        // 参数验证
        if (!element) {
          throw new TypeError(
            "Failed to execute 'getComputedStyle' on 'Window': parameter 1 is not of type 'Element'."
          );
        }

        // 获取原始元素
        const originalElement = self.proxyToObj(element);

        // 验证元素类型
        if (!(originalElement instanceof Element)) {
          console.error(
            "[getComputedStyle] Invalid element:",
            element,
            originalElement
          );
          throw new TypeError(
            "Failed to execute 'getComputedStyle' on 'Window': parameter 1 is not of type 'Element'."
          );
        }

        // 调用原始方法
        //@ts-ignore
        return originalGetComputedStyle.call(this, originalElement, pseudoElt);
      } catch (e) {
        console.error("[getComputedStyle] Error:", e, "for element:", element);
        throw e;
      }
    }

    // 替换全局方法
    this.window.getComputedStyle = enhancedGetComputedStyle;

    // 确保getComputedStyle在所有上下文中可用
    try {
      Object.defineProperty(this.window, "getComputedStyle", {
        value: enhancedGetComputedStyle,
        writable: false,
        configurable: true,
      });
    } catch (e) {
      console.warn("[getComputedStyle] Failed to redefine global method:", e);
    }
  }

  // 创建Storage代理（localStorage和sessionStorage）
  private createStorageProxy(storage: Storage): Storage {
    const prefix = this.PREFIX;

    return new Proxy(storage, {
      get(target, prop) {
        // 处理getItem方法
        if (prop === "getItem") {
          return function (key: string) {
            return target.getItem(prefix + key);
          };
        }

        // 处理setItem方法
        if (prop === "setItem") {
          return function (key: string, value: string) {
            return target.setItem(prefix + key, value);
          };
        }

        // 处理removeItem方法
        if (prop === "removeItem") {
          return function (key: string) {
            return target.removeItem(prefix + key);
          };
        }

        // 处理key方法
        if (prop === "key") {
          return function (index: number) {
            // 过滤并重新索引带有前缀的键
            const allKeys = [];
            for (let i = 0; i < target.length; i++) {
              const key = target.key(i);
              if (key && key.startsWith(prefix)) {
                //@ts-ignore
                allKeys.push(key.substring(prefix.length));
              }
            }

            return index < allKeys.length ? allKeys[index] : null;
          };
        }

        // 处理clear方法
        if (prop === "clear") {
          return function () {
            // 只清除带有前缀的键
            for (let i = target.length - 1; i >= 0; i--) {
              const key = target.key(i);
              if (key && key.startsWith(prefix)) {
                target.removeItem(key);
              }
            }
            return undefined;
          };
        }

        // 处理length属性
        if (prop === "length") {
          // 计算带有前缀的键的数量
          let count = 0;
          for (let i = 0; i < target.length; i++) {
            const key = target.key(i);
            if (key && key.startsWith(prefix)) {
              count++;
            }
          }
          return count;
        }

        // 处理直接键访问 (如localStorage.myKey)
        if (
          typeof prop === "string" &&
          prop !== "length" &&
          prop !== "getItem" &&
          prop !== "setItem" &&
          prop !== "removeItem" &&
          prop !== "key" &&
          prop !== "clear" &&
          !prop.startsWith("__")
        ) {
          return target[prefix + prop];
        }

        return Reflect.get(target, prop);
      },

      set(target, prop, value) {
        // 对直接赋值的键添加前缀 (例如 localStorage.myKey = 'value')
        if (
          typeof prop === "string" &&
          prop !== "length" &&
          !prop.startsWith("__")
        ) {
          target[prefix + prop] = value;
          return true;
        }

        return Reflect.set(target, prop, value);
      },

      deleteProperty(target, prop) {
        // 处理 delete localStorage.myKey
        if (typeof prop === "string" && !prop.startsWith("__")) {
          return Reflect.deleteProperty(target, prefix + prop);
        }
        return Reflect.deleteProperty(target, prop);
      },
    });
  }

  // 初始化Cookie代理
  private initCookieProxy(): void {
    const prefix = this.PREFIX;
    const document = this.window.document;

    // 保存原始的 cookie 描述符
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      Document.prototype,
      "cookie"
    );
    if (!originalDescriptor) return;

    Object.defineProperty(document, "cookie", {
      get: function () {
        //@ts-ignore
        const cookies = originalDescriptor.get.call(this);

        // 解析 cookies 并过滤出带有前缀的
        const cookieArray = cookies.split(";");
        const filteredCookies = cookieArray
          .map((cookie) => cookie.trim())
          .filter((cookie) => {
            const [name] = cookie.split("=");
            return name.startsWith(prefix);
          })
          .map((cookie) => {
            const equalsPos = cookie.indexOf("=");
            if (equalsPos === -1) return cookie;

            const name = cookie.substring(0, equalsPos);
            return cookie.replace(name, name.substring(prefix.length));
          });

        return filteredCookies.join("; ");
      },

      set: function (cookieStr) {
        // 在设置 cookie 时添加前缀
        const equalsPos = cookieStr.indexOf("=");
        if (equalsPos === -1) {
          //@ts-ignore
          return originalDescriptor.set.call(this, cookieStr);
        }

        const name = cookieStr.substring(0, equalsPos).trim();
        const rest = cookieStr.substring(equalsPos);
        const prefixedCookie = prefix + name + rest;

        //@ts-ignore
        return originalDescriptor.set.call(this, prefixedCookie);
      },

      enumerable: originalDescriptor.enumerable,
      configurable: originalDescriptor.configurable,
    });
  }

  // 初始化IndexedDB代理
  private initIndexedDBProxy(): void {
    const self = this;
    const prefix = this.PREFIX;
    const originalIndexedDB = this.window.indexedDB;

    // 创建 indexedDB 代理
    const indexedDBProxy = new Proxy(originalIndexedDB, {
      get(target, prop) {
        // 对 open 方法进行特殊处理
        if (prop === "open") {
          return function (name: string, version?: number) {
            const prefixedName = prefix + name;

            // 打开带有前缀的数据库
            const request = target.open(prefixedName, version);

            // 代理请求对象
            return new Proxy(request, {
              get(reqTarget, reqProp) {
                // 代理 onupgradeneeded 事件
                if (reqProp === "onupgradeneeded") {
                  return reqTarget[reqProp];
                }

                // 代理 onsuccess 事件
                if (reqProp === "onsuccess") {
                  const originalOnsuccess = reqTarget[reqProp];

                  return function (event) {
                    // 包装数据库对象
                    if (request.result) {
                      //@ts-ignore
                      request.result = self.wrapIDBDatabase(
                        request.result,
                        prefix
                      );
                    }

                    //@ts-ignore
                    if (originalOnsuccess) {
                      //@ts-ignore
                      return originalOnsuccess.call(this, event);
                    }
                  };
                }

                return Reflect.get(reqTarget, reqProp);
              },

              set(reqTarget, reqProp, value) {
                if (reqProp === "onsuccess") {
                  //@ts-ignore
                  reqTarget.__originalOnsuccess = value;

                  reqTarget[reqProp] = function (event) {
                    if (request.result) {
                      //@ts-ignore
                      request.result = self.wrapIDBDatabase(
                        request.result,
                        prefix
                      );
                    }

                    //@ts-ignore
                    if (reqTarget.__originalOnsuccess) {
                      //@ts-ignore
                      return reqTarget.__originalOnsuccess.call(this, event);
                    }
                  };
                  return true;
                }

                return Reflect.set(reqTarget, reqProp, value);
              },
            });
          };
        }

        return Reflect.get(target, prop);
      },
    });

    // 覆盖原始的 indexedDB
    Object.defineProperty(this.window, "indexedDB", {
      get: function () {
        return indexedDBProxy;
      },
      configurable: true,
    });
  }

  // 包装 IDBDatabase 对象
  private wrapIDBDatabase(db: IDBDatabase, prefix: string): IDBDatabase {
    const self = this;

    return new Proxy(db, {
      get(target, prop) {
        // 对 objectStoreNames 进行特殊处理
        if (prop === "objectStoreNames") {
          // 创建一个 DOMStringList 代理，移除前缀
          return new Proxy(target.objectStoreNames, {
            get(namesTarget, namesProp) {
              if (namesProp === "contains") {
                return function (name: string) {
                  return namesTarget.contains(prefix + name);
                };
              }

              if (namesProp === "item") {
                return function (index: number) {
                  const item = namesTarget.item(index);
                  return item ? item.substring(prefix.length) : null;
                };
              }

              if (namesProp === "length") {
                return namesTarget.length;
              }

              // 处理数字属性 (索引)
              if (typeof namesProp === "string") {
                const index = parseInt(namesProp);
                if (!isNaN(index)) {
                  const item = namesTarget.item(index);
                  return item ? item.substring(prefix.length) : undefined;
                }
              }

              return Reflect.get(namesTarget, namesProp);
            },
          });
        }

        // 处理 createObjectStore
        if (prop === "createObjectStore") {
          return function (name: string, options?: IDBObjectStoreParameters) {
            const store = target.createObjectStore(prefix + name, options);
            return self.wrapIDBObjectStore(store, prefix);
          };
        }

        // 处理 transaction
        if (prop === "transaction") {
          return function (...args: any[]) {
            // 添加前缀到对象存储的名称
            if (Array.isArray(args[0])) {
              args[0] = args[0].map((name) => prefix + name);
            } else if (typeof args[0] === "string") {
              args[0] = prefix + args[0];
            }

            const tx = Reflect.apply(target.transaction, target, args);
            return self.wrapIDBTransaction(tx, prefix);
          };
        }

        // 处理 deleteObjectStore
        if (prop === "deleteObjectStore") {
          return function (name: string) {
            return target.deleteObjectStore(prefix + name);
          };
        }

        return Reflect.get(target, prop);
      },
    });
  }

  // 包装 IDBTransaction 对象
  private wrapIDBTransaction(
    tx: IDBTransaction,
    prefix: string
  ): IDBTransaction {
    const self = this;

    return new Proxy(tx, {
      get(target, prop) {
        // 处理 objectStoreNames
        if (prop === "objectStoreNames") {
          // 与 IDBDatabase.objectStoreNames 相同的处理
          return new Proxy(target.objectStoreNames, {
            get(namesTarget, namesProp) {
              if (namesProp === "contains") {
                return function (name: string) {
                  return namesTarget.contains(prefix + name);
                };
              }

              if (namesProp === "item") {
                return function (index: number) {
                  const item = namesTarget.item(index);
                  return item ? item.substring(prefix.length) : null;
                };
              }

              if (namesProp === "length") {
                return namesTarget.length;
              }

              if (typeof namesProp === "string") {
                const index = parseInt(namesProp);
                if (!isNaN(index)) {
                  const item = namesTarget.item(index);
                  return item ? item.substring(prefix.length) : undefined;
                }
              }

              return Reflect.get(namesTarget, namesProp);
            },
          });
        }

        // 处理 objectStore
        if (prop === "objectStore") {
          return function (name: string) {
            const store = target.objectStore(prefix + name);
            return self.wrapIDBObjectStore(store, prefix);
          };
        }

        return Reflect.get(target, prop);
      },
    });
  }

  // 包装 IDBObjectStore 对象
  private wrapIDBObjectStore(
    store: IDBObjectStore,
    prefix: string
  ): IDBObjectStore {
    const self = this;

    return new Proxy(store, {
      get(target, prop) {
        // 处理 name 属性
        if (prop === "name") {
          return target.name.substring(prefix.length);
        }

        // 处理 createIndex
        if (prop === "createIndex") {
          return function (
            indexName: string,
            keyPath: string | string[],
            options?: IDBIndexParameters
          ) {
            const index = target.createIndex(
              prefix + indexName,
              keyPath,
              options
            );
            return self.wrapIDBIndex(index, prefix);
          };
        }

        // 处理 index
        if (prop === "index") {
          return function (name: string) {
            const index = target.index(prefix + name);
            return self.wrapIDBIndex(index, prefix);
          };
        }

        // 处理 deleteIndex
        if (prop === "deleteIndex") {
          return function (indexName: string) {
            return target.deleteIndex(prefix + indexName);
          };
        }

        // 处理 indexNames
        if (prop === "indexNames") {
          return new Proxy(target.indexNames, {
            get(namesTarget, namesProp) {
              if (namesProp === "contains") {
                return function (name: string) {
                  return namesTarget.contains(prefix + name);
                };
              }

              if (namesProp === "item") {
                return function (index: number) {
                  const item = namesTarget.item(index);
                  return item ? item.substring(prefix.length) : null;
                };
              }

              if (namesProp === "length") {
                return namesTarget.length;
              }

              if (typeof namesProp === "string") {
                const index = parseInt(namesProp);
                if (!isNaN(index)) {
                  const item = namesTarget.item(index);
                  return item ? item.substring(prefix.length) : undefined;
                }
              }

              return Reflect.get(namesTarget, namesProp);
            },
          });
        }

        return Reflect.get(target, prop);
      },
    });
  }

  // 包装 IDBIndex 对象
  private wrapIDBIndex(index: IDBIndex, prefix: string): IDBIndex {
    return new Proxy(index, {
      get(target, prop) {
        // 处理 name 属性
        if (prop === "name") {
          return target.name.substring(prefix.length);
        }

        return Reflect.get(target, prop);
      },
    });
  }

  private initIntersectionObsOverride(): void {
    //@ts-ignore
    var ori_obs = this.window.IntersectionObserver;
    const self = this;

    //@ts-ignore
    this.window.IntersectionObserver = (function (objs: any) {
      return function (callback: any, options: any) {
        if (options && options.root) {
          options.root = self.proxyToObj(options.root);
        }

        // 包装回调
        const wrappedCallback = function (entries: any, observer: any) {
          // 代理entries中的targets
          const proxiedEntries = entries.map((entry: any) => {
            // 使用代理而不是修改原始对象
            return new Proxy(entry, {
              get(target, prop) {
                if (prop === "target") {
                  return self.objToProxy(target.target);
                }
                return Reflect.get(target, prop);
              },
            });
          });

          return callback(proxiedEntries, observer);
        };

        return new objs(wrappedCallback, options);
      };
      //@ts-ignore
    })(this.window.IntersectionObserver);

    //@ts-ignore
    this.window.IntersectionObserver.prototype = ori_obs.prototype;

    //@ts-ignore
    Object.defineProperty(
      //@ts-ignore
      this.window.IntersectionObserver.prototype,
      "constructor",
      {
        //@ts-ignore
        value: this.window.IntersectionObserver,
      }
    );

    // 处理observe和unobserve方法
    //@ts-ignore
    const originalObserve = this.window.IntersectionObserver.prototype.observe;
    //@ts-ignore
    this.window.IntersectionObserver.prototype.observe = function (target) {
      return originalObserve.call(this, self.proxyToObj(target));
    };

    const originalUnobserve =
      //@ts-ignore
      this.window.IntersectionObserver.prototype.unobserve;
    //@ts-ignore
    this.window.IntersectionObserver.prototype.unobserve = function (target) {
      return originalUnobserve.call(this, self.proxyToObj(target));
    };
  }

  // 完全重写 MutationObserver 处理
  private initMutationObsOverride(): void {
    //@ts-ignore
    const originalMutationObserver = this.window.MutationObserver;
    const self = this;

    //@ts-ignore
    this.window.MutationObserver = function (callback) {
      // 包装回调以处理代理节点
      const wrappedCallback = function (mutations, observer) {
        // 创建代理，不修改原始对象
        const proxiedMutations = mutations.map((mutation) => {
          return new Proxy(mutation, {
            get(target, prop) {
              if (prop === "target") {
                return self.objToProxy(target.target);
              }
              if (prop === "addedNodes" || prop === "removedNodes") {
                return self.wrapNodeList(target[prop]);
              }
              return Reflect.get(target, prop);
            },
          });
        });

        return callback(proxiedMutations, observer);
      };

      return new originalMutationObserver(wrappedCallback);
    };

    // 维护原型链
    //@ts-ignore
    this.window.MutationObserver.prototype = originalMutationObserver.prototype;

    // 处理observe方法
    //@ts-ignore
    const originalObserve = this.window.MutationObserver.prototype.observe;
    //@ts-ignore
    this.window.MutationObserver.prototype.observe = function (
      target,
      options
    ) {
      return originalObserve.call(this, self.proxyToObj(target), options);
    };

    // 处理disconnect方法
    const originalDisconnect =
      //@ts-ignore
      this.window.MutationObserver.prototype.disconnect;
    //@ts-ignore
    this.window.MutationObserver.prototype.disconnect = function () {
      return originalDisconnect.call(this);
    };
  }

  private initWindowProxy(): void {
    const self = this;
    const windowOwnProps = this.getAllOwnProps(this.window);
    const funCache = new Map<string, any>();
    this.funCache.set(this.window, funCache);

    // 创建存储代理
    const localStorageProxy = this.createStorageProxy(this.window.localStorage);
    const sessionStorageProxy = this.createStorageProxy(
      this.window.sessionStorage
    );

    const windowProxy = new (this.window as any).Proxy(this.window, {
      get: (target: any, prop: string | symbol) => {
        // 特殊处理存储对象
        if (prop === "localStorage") {
          return localStorageProxy;
        }

        if (prop === "sessionStorage") {
          return sessionStorageProxy;
        }

        if (prop === "location") {
          return self.overrides.get("location") || target.location;
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
          const loc = this.overrides.get("location");
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
    const self = this;
    const documentOwnProps = this.getAllOwnProps(this.window.document);
    const funCache = new Map<string, any>();
    this.funCache.set(this.window.document, funCache);

    const documentProxy = new (this.window as any).Proxy(this.window.document, {
      get: (target: any, prop: string | symbol) => {
        if (prop === "location") {
          return self.overrides.get("location") || target.location;
        }

        if (prop === "defaultView") {
          return this.objProxies.get(this.window) || this.window;
        }

        // 不对querySelector和querySelectorAll进行代理
        return this.defaultProxyGet(
          this.window.document,
          prop,
          documentOwnProps,
          funCache
        );
      },
      set: (target: any, prop: string | symbol, value: any) => {
        if (prop === "location") {
          const loc = self.overrides.get("location");
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
      try {
        const props = Object.getOwnPropertyNames(obj);
        for (const prop of props) {
          if (ownProps.indexOf(prop) === -1) {
            ownProps.push(prop);
          }
        }
      } catch (e) {
        console.error("Error getting property names:", e);
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

          // 复制函数属性
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

      if (this.isWrappableConstructor(propStr)) {
        return this.wrapDOMConstructor(value);
      }
    }

    if (type === "object" && value && value._SLAX_obj_proxy) {
      return value._SLAX_obj_proxy;
    }

    // 如果值是DOM节点，尝试使用已有的代理或创建新代理
    if (value instanceof Node) {
      return this.objToProxy(value);
    }

    return value;
  }

  private isWrappableConstructor(propStr: string): boolean {
    if (/^HTML.*Element$/.test(propStr)) {
      return true;
    }

    const wrappableConstructors = [
      "MutationObserver",
      "IntersectionObserver",
      "XMLHttpRequest",
      "Image",
      "Option",
      "Audio",
    ];

    return wrappableConstructors.includes(propStr);
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
      try {
        // 解包DOM节点参数
        const convertedArgs = args.map((arg) => {
          if (
            arg instanceof Node ||
            (arg && typeof arg === "object" && arg._SLAX_obj_proxy)
          ) {
            return self.proxyToObj(arg);
          }
          return arg;
        });

        // 调用原始函数
        const result = originalFunc.apply(obj, convertedArgs);

        // 将返回的DOM节点重新包装为代理
        if (result instanceof Node) {
          return self.objToProxy(result);
        }

        // 处理返回的NodeList
        if (
          result &&
          result.constructor &&
          (result.constructor.name === "NodeList" ||
            result.constructor.name === "HTMLCollection")
        ) {
          return self.wrapNodeList(result);
        }

        return result;
      } catch (e) {
        console.error(`Error in wrapped function ${methodName}:`, e);
        // 错误时回退到原始函数
        return originalFunc.apply(obj, args);
      }
    };
  }

  // 改进的NodeList代理包装
  private wrapNodeList(nodeList: any): any {
    if (!nodeList || typeof nodeList !== "object") return nodeList;

    // 避免重复代理
    if (nodeList._SLAX_wrapped_nodelist) return nodeList;

    const self = this;
    const proxy = new Proxy(nodeList, {
      get(target, prop) {
        if (prop === "_SLAX_wrapped_nodelist") return true;

        if (typeof prop === "string") {
          // 数字索引 - 返回代理的节点
          const index = parseInt(prop);
          if (!isNaN(index)) {
            const node = target[index];
            if (node instanceof Node) {
              return self.objToProxy(node);
            }
            return node;
          }

          // 方法 - 包装以处理DOM节点
          if (prop === "item" || prop === "namedItem") {
            const original = target[prop];
            if (typeof original === "function") {
              return function (...args: any[]) {
                const result = original.apply(target, args);
                if (result instanceof Node) {
                  return self.objToProxy(result);
                }
                return result;
              };
            }
          }
        }

        return Reflect.get(target, prop);
      },
    });

    // 标记这个NodeList已经被包装
    try {
      Object.defineProperty(nodeList, "_SLAX_wrapped_nodelist", {
        value: true,
        writable: false,
        enumerable: false,
        configurable: true,
      });
    } catch (e) {}

    return proxy;
  }

  private wrapDOMConstructor(origCtor: Function): Function {
    const proxyThis = this;

    const ctorName = origCtor.name;

    function wrappedConstructor(this: any, ...args: any[]): any {
      // 如果不是通过new调用，则强制通过new调用
      if (!(this instanceof wrappedConstructor)) {
        return new (origCtor as any)(...args);
      }

      if (ctorName === "XMLHttpRequest") {
        return new (origCtor as any)(...args);
      }

      const newObj = new (origCtor as any)(...args);

      // 为Node添加一个特殊属性以便于识别原始节点
      if (newObj instanceof Node) {
        Object.defineProperty(newObj, "__slax_original_node", {
          value: newObj,
          writable: false,
          enumerable: false,
          configurable: false,
        });

        // 对于新创建的HTMLElement，应用拦截器
        if (
          newObj instanceof HTMLElement &&
          typeof (window as any).applyInterceptorsToNewElement === "function"
        ) {
          (window as any).applyInterceptorsToNewElement(newObj);
        }
      }

      return newObj;
    }

    wrappedConstructor.prototype = origCtor.prototype;

    // 复制静态属性和方法
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

  // 防止循环引用的代理转换方法
  public objToProxy(obj: any): any {
    if (!obj) return obj;

    // 原始类型直接返回
    if (typeof obj !== "object" && typeof obj !== "function") return obj;

    // 检查是否已经代理过
    if (obj._SLAX_obj_proxy_flag) {
      return obj; // 避免递归
    }

    // 检查已有代理
    if (this.objProxies.has(obj)) {
      return this.objProxies.get(obj);
    }

    // 临时标记，防止递归
    try {
      Object.defineProperty(obj, "_SLAX_obj_proxy_flag", {
        value: true,
        writable: false,
        enumerable: false,
        configurable: true,
      });
    } catch (e) {
      // 如果对象不可扩展，直接返回
      return obj;
    }

    // 如果是DOM节点，创建代理
    if (obj instanceof Node) {
      // 创建DOM节点的代理
      const proxy = this.createNodeProxy(obj);
      this.objProxies.set(obj, proxy);

      // 移除临时标记
      try {
        Object.defineProperty(obj, "_SLAX_obj_proxy_flag", {
          value: undefined,
          configurable: true,
        });
      } catch (e) {}

      return proxy;
    }

    // 移除临时标记
    try {
      Object.defineProperty(obj, "_SLAX_obj_proxy_flag", {
        value: undefined,
        configurable: true,
      });
    } catch (e) {}

    return obj;
  }

  // 改进的proxyToObj方法
  public proxyToObj(obj: any): any {
    if (!obj) {
      return obj;
    }

    if (typeof obj !== "object" && typeof obj !== "function") {
      return obj;
    }

    // 检查是否是代理对象
    if (obj._SLAX_obj_proxy) {
      for (const [origObj, proxyObj] of this.objProxies.entries()) {
        if (proxyObj === obj) {
          return origObj;
        }
      }
    }

    // 检查是否有特殊属性
    if (typeof obj === "object" && obj !== null) {
      if (obj.__slax_original_node) {
        return obj.__slax_original_node;
      }
    }

    return obj;
  }

  // 为DOM节点创建代理
  private createNodeProxy(node: Node): any {
    const self = this;

    // 创建节点代理
    const proxy = new Proxy(node, {
      get(target, prop) {
        // 特殊标记
        if (prop === "_SLAX_obj_proxy") return true;

        // 获取原始值
        const value = Reflect.get(target, prop);

        // 对DOM节点属性返回代理
        if (value instanceof Node) {
          return self.objToProxy(value);
        }

        // 处理childNodes和children
        if (prop === "childNodes" || prop === "children") {
          return self.wrapNodeList(value);
        }

        // 处理函数
        if (typeof value === "function") {
          // 需要特殊处理的DOM方法
          if (self.needsArgumentProxyConversion(target, prop.toString())) {
            return self.wrapFunctionForArgumentConversion(
              target,
              prop.toString(),
              value
            );
          }

          // 其他方法绑定到原始对象
          return function (...args: any[]) {
            return value.apply(target, args);
          };
        }

        return value;
      },
      set(target, prop, value) {
        // 特殊处理URL属性
        const urlProps = ["href", "src", "action", "srcset"];
        if (
          typeof prop === "string" &&
          urlProps.includes(prop) &&
          typeof value === "string"
        ) {
          try {
            // 确定URL类型的修饰符
            let mod = "mp_";
            if (target instanceof HTMLScriptElement && prop === "src") {
              mod = target.getAttribute("type") === "module" ? "esm_" : "js_";
            } else if (target instanceof HTMLLinkElement && prop === "href") {
              if (target.rel === "stylesheet") {
                mod = "cs_";
              }
            } else if (target instanceof HTMLIFrameElement && prop === "src") {
              mod = "if_";
            }

            // 使用全局rewriteUrl函数
            if (typeof (window as any).rewriteUrl === "function") {
              value = (window as any).rewriteUrl(value, mod);
            }
          } catch (e) {
            console.error(`Error rewriting URL for ${String(prop)}:`, e);
          }
        }

        return Reflect.set(target, prop, value);
      },
    });

    return proxy;
  }

  public get_override(name: string): any {
    return this.overrides.get(name);
  }

  public set_override(name: string, value: any): void {
    this.overrides.set(name, value);
  }
}
