"use strict";
// Loads Lucent modules from the native "Lucent" TurboModule. Generated proxies
// (what Metro bundles in place of each *.lucent.ts file) call loadModule().
// This file must not require "react-native" itself: the proxy passes the
// app's own TurboModuleRegistry in.

let native;

function getNative(registry) {
  if (native) return native;
  // Test hosts install modules directly.
  if (typeof globalThis.__lucentModules === "object" && globalThis.__lucentModules) {
    native = globalThis.__lucentModules;
    return native;
  }
  native = registry().get("Lucent");
  if (!native) {
    throw new Error(
      "Lucent: the native module is not linked. Run `lucent build`, then rebuild the app " +
        "(iOS: `pod install` first).",
    );
  }
  return native;
}

/**
 * The exports of a compiled Lucent module.
 * @param {string} name module name (the file name without .lucent.ts)
 * @param {() => { get(name: string): any }} registry returns React Native's TurboModuleRegistry
 */
function loadModule(name, registry) {
  const m = getNative(registry)[name];
  if (!m) {
    throw new Error(`Lucent: module "${name}" is not in the native build. Run \`lucent build\` and rebuild the app.`);
  }
  return m;
}

/** Wraps a native class factory in a real constructor so `new` and `instanceof` work. */
function lucentClass(factory) {
  function LucentClass() {
    if (!new.target) throw new TypeError("Class constructor cannot be invoked without 'new'");
    return factory.apply(undefined, arguments);
  }
  LucentClass.prototype = factory.prototype;
  Object.defineProperty(LucentClass.prototype, "constructor", { value: LucentClass, configurable: true, writable: true });
  Object.defineProperty(LucentClass, "name", { value: factory.name });
  for (const key of Object.keys(factory)) LucentClass[key] = factory[key];
  return LucentClass;
}

module.exports = { loadModule, lucentClass };
