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
 * unboxed, a missing value and null would look the same. `shape` says
 * where a value holds nullable ones: 0 (nowhere), `{ n }` (it is one),
 * `{ a }` (its elements) or `{ o }` (some of its fields).
 */
function encode(value, shape) {
  if (value === undefined || shape === 0) return value;

  if ("n" in shape) return value === null ? [null] : [encode(value, shape.n)];

  if ("a" in shape) return Array.isArray(value) ? value.map((v) => encode(v, shape.a)) : value;

  if (value === null || typeof value !== "object") return value;

  const out = { ...value };
  for (const field of shape.o) {
    if (Object.prototype.hasOwnProperty.call(out, field.name))
      out[field.name] = encode(out[field.name], field.shape);
  }
  return out;
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

/** The native view's props for React's `props` (but its ref). */
function hostProps(config, props) {
  const out = { style: props.style };

  for (const prop of config.props) {
    const value = given(props, prop.name);
    if (value !== undefined) out[prop.key] = encode(value, prop.shape);
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
// when its view unmounts first (the native side's work is not stopped:
// its answer is dropped). A command sent while the view is not mounted
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

  if (error === null || error === undefined) request.resolve(value);
  else request.reject(new Error(`Lucent: ${error}`));
}

/** Gives the native host settleRequest, once: requests are answered through its channel. */
function connect(ReactNative) {
  if (connected) return;

  const host = ReactNative.TurboModuleRegistry.get("Lucent");
  if (!host || typeof host.__lucentViewRequests !== "function") {
    const e = new Error(
      "Lucent: the app's native code cannot answer view commands. Recompile the app's native " +
        "code: run `lucent build`, then build and install the app again (compile-native).",
    );
    e.code = "LUCENT_NATIVE_MISMATCH";
    e.action = "compile-native";
    throw e;
  }

  host.__lucentViewRequests(settleRequest);
  connected = true;
}

/** The ref's methods: each sends its command to the mounted native view. */
function commandsOf(config, host, mount, native, ReactNative) {
  const out = {};

  for (const command of config.commands) {
    const where = `${config.displayName}.${command.name}()`;
    const encoded = (args) =>
      args.slice(0, command.params.length).map((a, i) => encode(a, command.params[i]));

    const unmounted = () =>
      named("InvalidStateError", `Lucent: ${where}: the view is not mounted.`);

    out[command.name] = command.request
      ? (...args) =>
          new Promise((resolve, reject) => {
            if (!host.current) throw unmounted();

            connect(ReactNative);

            // The answer comes in a later turn of the JavaScript thread, after the id is pending.
            const id = ++lastRequest;
            native[command.name](host.current, id, ...encoded(args));

            pending.set(id, { resolve, reject, mount });
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
    if (request)
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
      { ...hostProps(config, props), ref: host },
      ...childrenOf(props),
    );
  }

  LucentComponent.displayName = config.displayName;
  return LucentComponent;
}

module.exports = { lucentComponent, settleRequest };
