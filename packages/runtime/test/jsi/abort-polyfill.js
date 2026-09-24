// AbortController / AbortSignal for the Hermes test host, with the semantics
// of React Native's implementation (src/private/webapis/dom/abort-api), which
// React Native installs as a global and Hermes alone does not have.
(function () {
  if (typeof globalThis.AbortController === "function") return;

  class AbortSignal {
    constructor() {
      this._aborted = false;
      this._reason = undefined;
      this._listeners = [];
      // oxlint-disable-next-line unicorn/prefer-add-event-listener -- the polyfill defines onabort, part of the API it reproduces
      this.onabort = null;
    }
    get aborted() {
      return this._aborted;
    }
    get reason() {
      return this._reason;
    }
    throwIfAborted() {
      if (this._aborted) throw this._reason;
    }
    addEventListener(type, listener, options) {
      if (type !== "abort" || typeof listener !== "function") return;
      if (this._listeners.some((l) => l.fn === listener)) return;
      this._listeners.push({ fn: listener, once: !!(options && options.once) });
    }
    removeEventListener(type, listener) {
      if (type === "abort") this._listeners = this._listeners.filter((l) => l.fn !== listener);
    }
  }

  function abortSignal(signal, reason) {
    if (signal._aborted) return;
    signal._aborted = true;
    if (reason === undefined) {
      reason = new Error("signal is aborted without reason");
      reason.name = "AbortError";
    }
    signal._reason = reason;
    const event = { type: "abort", target: signal };
    if (typeof signal.onabort === "function") signal.onabort.call(signal, event);
    for (const l of signal._listeners.slice()) {
      if (l.once) signal.removeEventListener("abort", l.fn);
      l.fn.call(signal, event);
    }
  }

  class AbortController {
    constructor() {
      this.signal = new AbortSignal();
    }
    abort(reason) {
      abortSignal(this.signal, reason);
    }
  }

  globalThis.AbortSignal = AbortSignal;
  globalThis.AbortController = AbortController;
})();
