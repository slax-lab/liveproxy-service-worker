class WabacLiveProxy {
  constructor({ collName = "liveproxy", adblockUrl = undefined } = {}) {
    this.url = "";
    this.ts = "";
    this.collName = collName;
    this.adblockUrl = adblockUrl;

    this.queryParams = { injectScripts: "./custom.js" };
  }

  async init() {
    if (!navigator.serviceWorker) throw new Error('navigator.serviceWorker is not supported');

    await navigator.serviceWorker.register(
      "./sw.js",
      { scope: '/' }
    );

    console.log("register done");

    if (!navigator.serviceWorker.controller) {
      await new Promise(resolve => {
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          console.log("Controller changed, continuing...");
          resolve();
        });
      });
    }

    console.log("controller", navigator.serviceWorker.controller);

    navigator.serviceWorker.controller.postMessage({
      msg_type: "init",
      proxy_prefix: '/w/liveproxy',
      proxy_prefix_regexp: '(?:\\/proxy\\/(?:([0-9]*)([a-z]{2,3})_)?\\/|\\/w\\/liveproxy\\/(?:([a-z]{2,3})_)?\\/)(https?:\\/\\/.+)'
    });

    console.log("postMessage done");

    await new Promise(resolve => {
      navigator.serviceWorker.addEventListener('message', event => {
        console.log("message", event);
        if (event.data.msg_type === 'init_done') {
          console.log("Initialization complete, continuing...");
          resolve();
        }
      });
    });

    console.log("Initialization complete, continuing...");
  }
}
