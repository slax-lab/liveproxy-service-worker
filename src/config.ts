export const disablePostHost = [/mp\.weixin\.qq\.com/];

export const proxyPrefix = "https://wabac-test.slax.dev/proxy/";

export const REPLAY_URL_PREFIX =
  /(?:\/proxy\/(?:([0-9]*)([a-z]{2,3})_)?\/|\/w\/liveproxy\/(?:([a-z]{2,3})_)?\/)(https?:\/\/.+)/;

export const globalOverrides = [
  "window",
  "globalThis",
  "self",
  "document",
  "location",
];
