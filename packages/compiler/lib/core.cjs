"use strict";
// JavaScript implementations of lucent:core, used when a Lucent module
// runs as plain JavaScript: the differential e2e harness, lucent bench's
// JavaScript side, and apps' own tests (@lucent-lang/lucent/core). Native
// builds use the C++ runtime.

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (!signal) return void setTimeout(resolve, ms);
    if (signal.aborted) return void reject(signal.reason);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort);
  });
}

function error(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

function errorCode(e) {
  return typeof e.code === "string" ? e.code : undefined;
}

function utf8Encode(s) {
  const out = [];
  for (let i = 0; i < s.length; i++) {
    let cp = s.charCodeAt(i);
    if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < s.length) {
      const lo = s.charCodeAt(i + 1);
      if (lo >= 0xdc00 && lo <= 0xdfff) {
        cp = 0x10000 + ((cp - 0xd800) << 10) + (lo - 0xdc00);
        i++;
      } else cp = 0xfffd;
    } else if (cp >= 0xd800 && cp <= 0xdfff) cp = 0xfffd;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 63),
        0x80 | ((cp >> 6) & 63),
        0x80 | (cp & 63),
      );
  }
  return new Uint8Array(out);
}

function utf8Decode(bytes) {
  let out = "";
  let i = 0;
  const n = bytes.length;
  const cont = (k) => (i + k < n && (bytes[i + k] & 0xc0) === 0x80 ? bytes[i + k] & 63 : -1);
  while (i < n) {
    const c = bytes[i];
    let cp = 0xfffd;
    let len = 1;
    if (c < 0x80) cp = c;
    else if ((c & 0xe0) === 0xc0) {
      const a = cont(1);
      if (a >= 0 && c >= 0xc2) {
        cp = ((c & 31) << 6) | a;
        len = 2;
      }
    } else if ((c & 0xf0) === 0xe0) {
      const a = cont(1),
        b = cont(2);
      if (a >= 0 && b >= 0) {
        const v = ((c & 15) << 12) | (a << 6) | b;
        if (v >= 0x800) {
          cp = v;
          len = 3;
        }
      }
    } else if ((c & 0xf8) === 0xf0) {
      const a = cont(1),
        b = cont(2),
        d = cont(3);
      if (a >= 0 && b >= 0 && d >= 0) {
        const v = ((c & 7) << 18) | (a << 12) | (b << 6) | d;
        if (v >= 0x10000 && v <= 0x10ffff) {
          cp = v;
          len = 4;
        }
      }
    }
    out += String.fromCodePoint(cp);
    i += len;
  }
  return out;
}

function now() {
  return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
}

// An error nobody can catch (a cleanup's): the host's uncaught error
// handler gets it, as native code's goes to the platform log.
function reportUncaught(e) {
  setTimeout(() => {
    throw e;
  }, 0);
}

// One promise that settles once, at the first of what `start`'s callbacks
// report and the signal aborting; the cleanup `start` returns runs once, as
// soon as it settles. The signal rejects with its reason, or resolves
// (`abortResolves`: a subscription the caller ended).
function compose(signal, start, abortResolves = false) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted)
      return void (abortResolves ? resolve(undefined) : reject(signal.reason));

    let settled = false;
    let registered = false;
    let cleanup;

    const runCleanup = () => {
      const f = cleanup;
      cleanup = undefined;
      if (typeof f !== "function") return;
      try {
        f();
      } catch (e) {
        reportUncaught(e);
      }
    };

    const settle = (how, value) => {
      if (settled) return;
      settled = true;
      if (signal) signal.removeEventListener("abort", onAbort);
      how(value);
      if (registered) runCleanup();
    };

    const onAbort = () =>
      abortResolves ? settle(resolve, undefined) : settle(reject, signal.reason);
    if (signal) signal.addEventListener("abort", onAbort);

    try {
      cleanup = start({
        open: () => !settled,
        resolve: (value) => settle(resolve, value),
        reject: (reason) => settle(reject, reason),
      });
    } catch (e) {
      settle(reject, e);
    }

    registered = true;
    if (settled) runCleanup();
  });
}

function fromCallback(register, signal) {
  return compose(signal, (c) =>
    register(
      (value) => void c.resolve(value),
      (reason) => void c.reject(reason),
    ),
  );
}

function subscribe(register, onValue, signal) {
  return compose(
    signal,
    (c) => {
      const next = (value) => {
        if (!c.open()) return;
        try {
          onValue(value);
        } catch (e) {
          c.reject(e);
        }
      };
      return register(
        next,
        () => void c.resolve(undefined),
        (error) => void c.reject(error),
      );
    },
    true,
  );
}

// --- events -------------------------------------------------------------------

// Each emitter's listeners by event name, out of reach of the code using it.
const emitters = new WeakMap();

function listenersOf(emitter, name) {
  const all = emitters.get(emitter);
  if (!all) throw new TypeError("not an EventEmitter");
  let list = all.get(name);
  if (!list) all.set(name, (list = []));
  return list;
}

/** Events a module sends to its listeners: lucent:core's EventEmitter. */
class EventEmitter {
  constructor() {
    emitters.set(this, new Map());
  }

  addListener(name, listener) {
    if (typeof listener !== "function")
      throw new TypeError("EventEmitter.addListener: argument 'listener' must be a function");
    const entry = { listener };
    listenersOf(this, name).push(entry);
    let removed = false;
    return {
      remove: () => {
        if (removed) return;
        removed = true;
        const list = listenersOf(this, name);
        const i = list.indexOf(entry);
        if (i >= 0) list.splice(i, 1);
      },
    };
  }

  emit(name, ...args) {
    // The listeners the event has now: those added or removed meanwhile wait for the next emit.
    for (const { listener } of listenersOf(this, name).slice()) listener(...args);
  }

  listenerCount(name) {
    return listenersOf(this, name).length;
  }

  removeAllListeners(name) {
    if (name === undefined) emitters.get(this).clear();
    else listenersOf(this, name).length = 0;
  }
}

// --- native buffers ---------------------------------------------------------

const MAX_SIZE = Number.MAX_SAFE_INTEGER;

const bufferCounts = { allocated: 0, adopted: 0, transfers: 0, copies: 0, bytesCopied: 0 };

function countCopy(bytes) {
  bufferCounts.copies++;
  bufferCounts.bytesCopied += bytes;
}

// Each buffer's state, out of reach of the code using it: its bytes, open,
// transferred or closed, and its borrows.
const buffers = new WeakMap();
const creating = Symbol("NativeBuffer");

function invalidState(why) {
  const e = new Error(`NativeBuffer ${why}`);
  e.name = "InvalidStateError";
  return e;
}

function stateOf(buffer) {
  const s = buffers.get(buffer);
  if (!s) throw new TypeError("not a NativeBuffer");
  return s;
}

/** Refuses a use unless the buffer is open and, for `write`, unborrowed (reads need no writer). */
function borrowable(s, write) {
  if (s.state !== "open")
    throw invalidState(s.state === "closed" ? "is closed" : "was transferred");
  if (s.writing || (write && s.readers > 0)) throw invalidState("is borrowed");
}

/**
 * Bytes native code owns, as the native runtime keeps them: borrowed for
 * one call, moved by transfer() and compute, copied only by from() and
 * toUint8Array(). Here the bytes a borrow lends are the buffer's own.
 */
class NativeBuffer {
  constructor(token, bytes) {
    if (token !== creating) throw new TypeError("Illegal constructor");
    buffers.set(this, { bytes, state: "open", readers: 0, writing: false });
  }

  static allocate(size) {
    if (!(size >= 0) || Math.trunc(size) !== size || size > MAX_SIZE)
      throw new RangeError("Invalid buffer size");

    bufferCounts.allocated++;
    return new NativeBuffer(creating, new Uint8Array(size));
  }

  static from(bytes) {
    const buffer = NativeBuffer.allocate(bytes.length);

    stateOf(buffer).bytes.set(bytes);
    countCopy(bytes.length);
    return buffer;
  }

  static stats() {
    return { ...bufferCounts };
  }

  get byteLength() {
    const s = stateOf(this);
    return s.state === "open" ? s.bytes.length : 0;
  }

  withRead(read) {
    const s = stateOf(this);

    borrowable(s, false);
    s.readers++;
    try {
      return read(s.bytes);
    } finally {
      s.readers--;
    }
  }

  withWrite(write) {
    const s = stateOf(this);

    borrowable(s, true);
    s.writing = true;
    try {
      return write(s.bytes);
    } finally {
      s.writing = false;
    }
  }

  toUint8Array() {
    return this.withRead((bytes) => {
      countCopy(bytes.length);
      return bytes.slice();
    });
  }

  transfer() {
    const moved = beginTransfer(this);

    commitTransfer(this);
    return moved;
  }

  close() {
    const s = stateOf(this);

    if (s.state !== "open") return;
    borrowable(s, true);

    s.state = "closed";
    s.bytes = new Uint8Array(0);
  }

  [Symbol.dispose]() {
    this.close();
  }
}

// A move in two steps, as a task's input is copied: the new buffer takes
// the bytes at once, and the old one gives them up for good only once the
// whole input has been copied.
function beginTransfer(buffer) {
  const s = stateOf(buffer);

  borrowable(s, true);
  s.state = "transferring";
  return new NativeBuffer(creating, s.bytes);
}

function commitTransfer(buffer) {
  const s = stateOf(buffer);

  s.state = "transferred";
  s.bytes = new Uint8Array(0);
  bufferCounts.transfers++;
}

function abortTransfer(buffer) {
  stateOf(buffer).state = "open";
}

/** What a copy refuses to copy: a DataCloneError, as structuredClone throws. */
function dataCloneError(message) {
  const e = new Error(message);
  e.name = "DataCloneError";
  return e;
}

/**
 * A compute task's input, copied as the native runtime copies it: every
 * object, array, map, set, date and byte buffer reached is copied once
 * (aliases stay aliases, cycles survive), objects keep their class, and
 * views of one buffer stay views of one copied buffer. A NativeBuffer
 * moves instead, once: `moved` collects the moves to commit or undo.
 */
function transportCopy(value, copies = new Map(), moved = []) {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return value;
  if (typeof value === "function")
    throw dataCloneError("A function cannot be copied to a compute task");

  const known = copies.get(value);
  if (known) return known;

  if (value instanceof NativeBuffer) {
    const successor = beginTransfer(value);
    moved.push(value);
    copies.set(value, successor);
    return successor;
  }

  if (value instanceof ArrayBuffer) {
    const buffer = value.slice(0);
    copies.set(value, buffer);
    return buffer;
  }

  if (value instanceof Uint8Array) {
    let buffer = copies.get(value.buffer);
    if (!buffer) {
      buffer = value.buffer.slice(0);
      copies.set(value.buffer, buffer);
    }
    const view = new Uint8Array(buffer, value.byteOffset, value.length);
    copies.set(value, view);
    return view;
  }

  if (value instanceof Date) {
    const date = new Date(value.getTime());
    copies.set(value, date);
    return date;
  }

  if (value instanceof Map) {
    const map = new Map();
    copies.set(value, map);
    for (const [k, v] of value)
      map.set(transportCopy(k, copies, moved), transportCopy(v, copies, moved));
    return map;
  }

  if (value instanceof Set) {
    const set = new Set();
    copies.set(value, set);
    for (const v of value) set.add(transportCopy(v, copies, moved));
    return set;
  }

  if (Array.isArray(value)) {
    const array = [];
    copies.set(value, array);
    for (const v of value) array.push(transportCopy(v, copies, moved));
    return array;
  }

  if (value instanceof Promise || value instanceof AbortSignal || value instanceof AbortController)
    throw dataCloneError(`A ${value.constructor.name} cannot be copied to a compute task`);

  const object = Object.create(Object.getPrototypeOf(value));
  copies.set(value, object);
  // Defined, not assigned: an own "__proto__" key stays a key.
  for (const key of Object.keys(value))
    Object.defineProperty(object, key, {
      value: transportCopy(value[key], copies, moved),
      writable: true,
      enumerable: true,
      configurable: true,
    });
  return object;
}

/**
 * Runs `task(input)` as a compute task would, on this thread: the input is
 * copied now, the task runs in a later turn, and aborting the signal first
 * rejects with its reason (the task then never runs).
 */
function compute(task, input, options) {
  const signal = options && options.signal;

  return new Promise((resolve, reject) => {
    let copy;
    const moved = [];
    try {
      copy = transportCopy(input, new Map(), moved);
    } catch (e) {
      moved.forEach(abortTransfer);
      return void reject(e);
    }
    moved.forEach(commitTransfer);

    if (signal && signal.aborted) return void reject(signal.reason);

    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      if (signal) signal.removeEventListener("abort", onAbort);
      try {
        resolve(task(copy));
      } catch (e) {
        reject(e);
      }
    }, 0);
    if (signal) signal.addEventListener("abort", onAbort);
  });
}

module.exports = {
  delay,
  error,
  errorCode,
  utf8Encode,
  utf8Decode,
  now,
  fromCallback,
  subscribe,
  compute,
  EventEmitter,
  NativeBuffer,
};
