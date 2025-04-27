import { extractOriginalUrl } from "./utils";

export interface ILocation {
  href: string;
  protocol: string;
  host: string;
  hostname: string;
  port: string;
  pathname: string;
  search: string;
  hash: string;
  origin: string;

  assign(url: string): void;
  replace(url: string): void;
  reload(forceReload?: boolean): void;
  toString(): string;
}

export class SlaxLocation implements ILocation {
  private _url: URL;
  private _href: string;
  private _protocol: string;
  private _host: string;
  private _hostname: string;
  private _port: string;
  private _pathname: string;
  private _search: string;
  private _hash: string;
  private _origin: string;
  private _originalLocation: Location;

  constructor(originalLocation: Location) {
    this._originalLocation = originalLocation;

    const originalHref = extractOriginalUrl(originalLocation.href);
    try {
      this._url = new URL(originalHref!);
      this._href = originalHref!;
      this._protocol = this._url.protocol;
      this._host = this._url.host;
      this._hostname = this._url.hostname;
      this._port = this._url.port;
      this._pathname = this._url.pathname;
      this._search = this._url.search;
      this._hash = this._url.hash;
      this._origin = this._url.origin;
    } catch (e) {
      console.error(
        "Error creating URL:",
        e,
        originalHref,
        originalLocation.href
      );
      throw e;
    }
  }

  get href(): string {
    return this._href;
  }

  set href(value: string) {
    this._url = new URL(value);
    this._href = value;
    this._protocol = this._url.protocol;
    this._host = this._url.host;
    this._hostname = this._url.hostname;
    this._port = this._url.port;
    this._pathname = this._url.pathname;
    this._search = this._url.search;
    this._hash = this._url.hash;
    this._origin = this._url.origin;

    this._originalLocation.href = value;
  }

  get protocol(): string {
    return this._protocol;
  }

  set protocol(value: string) {
    this._url.protocol = value;
    this._protocol = value;
  }

  get host(): string {
    return this._host;
  }

  set host(value: string) {
    this._url.host = value;
    this._host = value;
  }

  get hostname(): string {
    return this._hostname;
  }

  set hostname(value: string) {
    this._url.hostname = value;
    this._hostname = value;
  }

  get port(): string {
    return this._port;
  }

  set port(value: string) {
    this._url.port = value;
    this._port = value;
  }

  get pathname(): string {
    return this._pathname;
  }

  set pathname(value: string) {
    this._url.pathname = value;
    this._pathname = value;
  }

  get search(): string {
    return this._search;
  }

  set search(value: string) {
    this._url.search = value;
    this._search = value;
  }

  get hash(): string {
    return this._hash;
  }

  set hash(value: string) {
    this._url.hash = value;
    this._hash = value;
  }

  get origin(): string {
    return this._origin;
  }

  assign(url: string): void {
    this._href = url;
    this._originalLocation.assign(url);
  }

  replace(url: string): void {
    this._href = url;
    this._originalLocation.replace(url);
  }

  reload(forceReload?: boolean): void {}

  toString(): string {
    return this._url.href;
  }
}
