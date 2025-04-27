export const disablePostHost = [/mp\.weixin\.qq\.com/];

export const proxyPrefix = "https://wabac-test.slax.dev/proxy/";

export let REPLAY_URL_PREFIX;
export let REPLAY_URL_PREFIX_REGEXP_STR;
export let REPLAY_URL_PREFIX_REGEXP;

export const globalOverrides = [
  "window",
  "globalThis",
  "self",
  "document",
  "location",
];

export function setProxyPathPrefix(prefix: string, regexp: string) {
  REPLAY_URL_PREFIX = prefix;
  REPLAY_URL_PREFIX_REGEXP_STR = regexp;
  REPLAY_URL_PREFIX_REGEXP = new RegExp(regexp);
}
