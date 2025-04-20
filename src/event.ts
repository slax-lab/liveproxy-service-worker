import { handleProxyRequest } from "./proxy";
import { REPLAY_URL_PREFIX } from "./config";

export function handleInstallEvent(event: ExtendableEvent) {
  event.waitUntil(self.skipWaiting());
}

export function handleUnhandledRejectionEvent(event: PromiseRejectionEvent) {
  console.error("Error in Service Worker:", event.reason);
  event.preventDefault();
}

export function handleActivateEvent(event: ExtendableEvent) {
  event.waitUntil(
    self.clients.claim().then(() => {
      self.clients.matchAll().then((clients) => {
        return Promise.all(
          clients.map((client) => {
            client.postMessage({
              msg_type: "sw_activated",
              timestamp: Date.now(),
            });
          })
        );
      });
    })
  );
}

export function handleFetchEvent(event: FetchEvent) {
  const url = event.request.url;
  const urlObj = new URL(url);

  const replayMatch = urlObj.pathname.match(REPLAY_URL_PREFIX);
  if (!replayMatch) {
    const referer = event.request.headers.get("Referer");
    if (referer && referer.match(REPLAY_URL_PREFIX)) {
      const refererObj = new URL(referer);
      const refMatch = refererObj.pathname.match(REPLAY_URL_PREFIX);
      if (refMatch) {
        const timestamp = "";
        const mod = "if_";

        event.respondWith(
          handleProxyRequest(event.request, timestamp, mod, url)
        );
        return;
      }
    }
    return;
  }

  let timestamp = "";
  let mod = "";
  let origUrl = "";

  const matchPath = replayMatch[0] || "";

  if (matchPath.includes("/proxy/")) {
    timestamp = replayMatch[1] || "";
    mod = replayMatch[2] || "";
    origUrl = replayMatch[4] || "";
  } else if (matchPath.includes("/w/liveproxy/")) {
    mod = replayMatch[3] || "";
    origUrl = replayMatch[4] || "";
  } else {
    console.error("can't parse url:", urlObj.pathname);
    return;
  }

  if (!origUrl) {
    console.error("can't parse url:", urlObj.pathname);
    return;
  }

  if (!origUrl.startsWith("http://") && !origUrl.startsWith("https://")) {
    origUrl = "https://" + origUrl;
  }

  // Preserve query parameters from the original request
  const originalQueryString = urlObj.search;
  if (originalQueryString) {
    // Check if the target URL already has query parameters
    if (origUrl.includes("?")) {
      // If it does, append the additional parameters
      origUrl += "&" + originalQueryString.substring(1); // Remove the leading '?'
    } else {
      // If it doesn't, add the query string
      origUrl += originalQueryString;
    }
  }

  event.respondWith(handleProxyRequest(event.request, timestamp, mod, origUrl));
}

export function handleMessageEvent(event: MessageEvent) {
  console.log("handleMessageEvent", event);
  if (event.data.msg_type === "init") {
    event.source?.postMessage({
      msg_type: "init_done",
      timestamp: Date.now(),
    });
  }
}
