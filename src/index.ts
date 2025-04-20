import {
  handleActivateEvent,
  handleFetchEvent,
  handleInstallEvent,
  handleUnhandledRejectionEvent,
  handleMessageEvent,
} from "./event";

self.addEventListener("install", handleInstallEvent);

self.addEventListener("activate", handleActivateEvent);

self.addEventListener("fetch", handleFetchEvent);

self.addEventListener("unhandledrejection", handleUnhandledRejectionEvent);

self.addEventListener("message", handleMessageEvent);
