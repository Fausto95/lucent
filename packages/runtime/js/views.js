"use strict";
// Lucent components in React. A module's proxy describes each component it
// exports (see lucentComponent), and this file makes the description a
// React component rendering the native view React Native registers under
// the component's registration name. `lucent build` copies it into the
// native package (js/_lucent/views.js).
// Like the loader, it requires nothing itself: the proxy passes the app's
// React and React Native in.

/**
 * A value as its native view reads it. A nullable value travels boxed,
 * `[value]` (`[null]` for null), because React sends a removed prop as
 * null and turns undefined into null inside objects and argument lists:
 * unboxed, a missing value and null would look the same. An instance of a
 * Lucent class travels as its id (instanceId). `shape` says where a value
 * holds nullable ones or instances: 0 (nowhere), `{ n }` (it is
 * nullable), `{ i, c }` (it is an instance of class `i`, named `c`), `{ a }`
 * (its elements) or `{ o }` (some of its fields). `at` names the value in
 * messages (`at.where`), and gives the native host's instance ids
 * (`at.ids()`).
 */
function encode(value, shape, at) {
  if (value === undefined || shape === 0) return value;

  if ("n" in shape) return value === null ? [null] : [encode(value, shape.n, at)];

  if ("i" in shape) return instanceId(value, shape, at);

  if ("a" in shape) return Array.isArray(value) ? value.map((v) => encode(v, shape.a, at)) : value;

  if (value === null || typeof value !== "object") return value;

  const out = { ...value };
  for (const field of shape.o) {
    if (Object.prototype.hasOwnProperty.call(out, field.name))
      out[field.name] = encode(out[field.name], field.shape, at);
  }
  return out;
}

/** What a value is, for a message: "null", "a number", "an object", "a Date"… */
function described(value) {
  if (value === null) return "null";

  const name =
    typeof value !== "object"
      ? typeof value
      : value.constructor && value.constructor.name && value.constructor.name !== "Object"
        ? value.constructor.name
        : "object";

  return `${/^[aeiou]/i.test(name) ? "an" : "a"} ${name}`;
}

/**
 * The id of `value`, an instance of the Lucent class `shape.i`, or one
 * extending it, which its native view finds it by: a TypeError, thrown
 * where React renders, for anything else. A class's prototype is kept on
 * the global object under its id once JavaScript has one of its instances.
 */
function instanceId(value, shape, at) {
  const prototypes = globalThis.__lucentPrototypes;
  const proto = prototypes ? prototypes[shape.i] : undefined;

  if (
    value === null ||
    typeof value !== "object" ||
    !proto ||
    !Object.prototype.isPrototypeOf.call(proto, value)
  )
    throw new TypeError(`Lucent: ${at.where} takes a ${shape.c}, not ${described(value)}.`);

  return at.ids()(value);
}

/** The error of an app whose native code is older than its JavaScript. */
function nativeMismatch(what) {
  const e = new Error(
    `Lucent: the app's native code cannot ${what}. Recompile the app's native code: run ` +
      "`lucent build`, then build and install the app again (compile-native).",
  );
  e.code = "LUCENT_NATIVE_MISMATCH";
  e.action = "compile-native";
  return e;
}

// The native host's function giving an instance's id, once asked for.
let instanceIdOf;

/** The native host's function giving an instance's id (its __lucentViewInstance). */
function instanceIds(ReactNative) {
  if (instanceIdOf) return instanceIdOf;

  const host = ReactNative.TurboModuleRegistry.get("Lucent");
  const ids = host ? host.__lucentViewInstance : undefined;
  if (typeof ids !== "function") throw nativeMismatch("pass instances to views");

  instanceIdOf = ids;
  return ids;
}

/** React Native's view configuration: the props and handlers under their keys, the events by slot. */
function viewConfig(config) {
  const validAttributes = {};
  const directEventTypes = {};

  for (const prop of config.props) validAttributes[prop.key] = true;

  for (const event of config.events) {
    validAttributes[event.key] = true;
    directEventTypes[event.event] = { registrationName: event.key };
  }

  return { uiViewClassName: config.name, validAttributes, directEventTypes };
}

/** A prop React was given: not what every object inherits (toString, constructor). */
const given = (props, name) =>
  Object.prototype.hasOwnProperty.call(props, name) ? props[name] : undefined;

/** The names of a component's own props: its props', its events', and its children. */
const ownNames = new WeakMap();
function ownOf(config) {
  let names = ownNames.get(config);
  if (!names) {
    names = new Set([
      "children",
      ...config.props.map((p) => p.name),
      ...config.events.map((e) => e.name),
    ]);
    ownNames.set(config, names);
  }
  return names;
}

/** The native view's props for React's `props` (but its ref). */
function hostProps(config, props, ReactNative) {
  // React Native's view props (style, testID, accessibilityLabel, onLayout…), which every host
  // view takes, as they are: the component's own go under their keys.
  const out = {};
  const own = ownOf(config);
  for (const name of Object.keys(props)) if (!own.has(name)) out[name] = props[name];

  for (const prop of config.props) {
    const value = given(props, prop.name);
    if (value !== undefined)
      out[prop.key] = encode(value, prop.shape, {
        where: `${config.displayName}'s prop ${prop.name}`,
        ids: () => instanceIds(ReactNative),
      });
  }

  // React calls the handler of the latest commit, which calls that commit's
  // callback with the arguments the native call passed, by position (React
  // Native adds the view's tag to every payload as `target`).
  for (const event of config.events) {
    const callback = given(props, event.name);
    if (typeof callback === "function") out[event.key] = (e) => callback(...e.nativeEvent.args);
  }

  return out;
}

// --- requests: commands that answer ---------------------------------------------------
//
// A request's promise settles once: with the command's result, with its
// error (an Error of the native side's message), or with an AbortError
// when its view unmounts first, or when the caller aborts the signal it
// passed after the command's arguments (`{ signal }`): the native side's
// work is not stopped, and its answer is dropped. A command sent while the view is not mounted
// fails with an InvalidStateError: thrown by a void command, the
// rejection of a request.

/** An Error named `name`, as JavaScript names the state it reports. */
function named(name, message) {
  const e = new Error(message);
  e.name = name;
  return e;
}

const pending = new Map();
let lastRequest = 0;
let connected = false;
// Where this runtime's request ids start, from the native host: an id
// names the runtime that sent it (0 from a host that gives none).
let requestBase = 0;

/**
 * Settles request `id`: rejects it with `error` (a message) unless that is
 * null or undefined, else resolves it with `value`. A request that is no
 * longer pending (its view unmounted) is ignored. The native host calls it
 * on the JavaScript thread.
 */
function settleRequest(id, error, value) {
  const request = pending.get(id);
  if (!request) return;

  pending.delete(id);
  request.mount.delete(id);
  request.unfollow();

  if (error === null || error === undefined) request.resolve(value);
  else request.reject(new Error(`Lucent: ${error}`));
}

/** Gives the native host settleRequest, once: requests are answered through its channel. */
function connect(ReactNative) {
  if (connected) return;

  const host = ReactNative.TurboModuleRegistry.get("Lucent");
  if (!host || typeof host.__lucentViewRequests !== "function")
    throw nativeMismatch("answer view commands");

  const base = host.__lucentViewRequests(settleRequest);
  requestBase = typeof base === "number" ? base : 0;
  connected = true;
}

/** The AbortError of a request its caller aborted: the signal's reason, if it gives one. */
function aborted(signal, where) {
  return signal.reason !== undefined
    ? signal.reason
    : named("AbortError", `Lucent: ${where}: aborted.`);
}

/**
 * The ref's methods: each sends its command to the mounted native view;
 * and the host view's measure and measureInWindow, as any host view's ref
 * has them.
 */
function commandsOf(config, host, mount, native, ReactNative) {
  const out = {
    measure: (callback) => host.current && host.current.measure(callback),
    measureInWindow: (callback) => host.current && host.current.measureInWindow(callback),
  };

  for (const command of config.commands) {
    const where = `${config.displayName}.${command.name}()`;
    const at = { where, ids: () => instanceIds(ReactNative) };
    const encoded = (args) =>
      args.slice(0, command.params.length).map((a, i) => encode(a, command.params[i], at));

    const unmounted = () =>
      named("InvalidStateError", `Lucent: ${where}: the view is not mounted.`);

    out[command.name] = command.request
      ? (...args) =>
          new Promise((resolve, reject) => {
            if (!host.current) throw unmounted();

            // What the caller passed after the command's arguments: its signal.
            const options = args[command.params.length];
            const signal =
              options !== null && typeof options === "object" ? options.signal : undefined;
            if (signal && signal.aborted) throw aborted(signal, where);

            connect(ReactNative);

            // The answer comes in a later turn of the JavaScript thread, after the id is pending.
            const id = requestBase + ++lastRequest;
            native[command.name](host.current, id, ...encoded(args));

            const abort = () => {
              if (!pending.delete(id)) return;
              mount.delete(id);
              reject(aborted(signal, where));
            };
            if (signal) signal.addEventListener("abort", abort, { once: true });
            const unfollow = () => signal && signal.removeEventListener("abort", abort);

            pending.set(id, { resolve, reject, mount, unfollow });
            mount.add(id);
          })
      : (...args) => {
          if (!host.current) throw unmounted();

          native[command.name](host.current, ...encoded(args));
        };
  }

  return out;
}

/** Rejects the requests a mount left unanswered: its unmount cancelled them. */
function abandon(config, mount) {
  for (const id of mount) {
    const request = pending.get(id);
    pending.delete(id);
    if (!request) continue;
    request.unfollow();
    request.reject(
      named("AbortError", `Lucent: ${config.displayName} unmounted before answering.`),
    );
  }
  mount.clear();
}

/**
 * The React component a proxy exports for a Lucent component.
 * @param config the component's description, which the compiler generates
 * @param React the app's React
 * @param ReactNative the app's React Native
 */
function lucentComponent(config, React, ReactNative) {
  const Host = ReactNative.NativeComponentRegistry.get(config.name, () => viewConfig(config));
  const native = config.commands.length
    ? ReactNative.codegenNativeCommands({ supportedCommands: config.commands.map((c) => c.name) })
    : {};
  // A component taking none gets children only from untyped code: its host has no slot for them.
  let refused = false;
  const childrenOf = (props) => {
    if (config.children) return [props.children];

    if (props.children !== undefined && !refused) {
      refused = true;
      console.error(
        `Lucent: ${config.displayName} takes no children (its props declare no \`children: Children\`): they are not rendered.`,
      );
    }

    return [];
  };

  function LucentComponent({ ref, ...props }) {
    const host = React.useRef(null);
    // The ids of this mount's unanswered requests.
    const [requests] = React.useState(() => new Set());

    React.useImperativeHandle(ref, () => commandsOf(config, host, requests, native, ReactNative), [
      requests,
    ]);
    React.useEffect(() => () => abandon(config, requests), [requests]);

    return React.createElement(
      Host,
      { ...hostProps(config, props, ReactNative), ref: host },
      ...childrenOf(props),
    );
  }

  LucentComponent.displayName = config.displayName;
  return LucentComponent;
}

module.exports = { lucentComponent, settleRequest };
