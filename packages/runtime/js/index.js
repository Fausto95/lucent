"use strict";
// Loads Lucent modules from the native "Lucent" TurboModule. Generated proxies
// (what Metro bundles in place of each *.lucent.ts file) call loadModule().

let native;

function getNative() {
  if (native) return native;
  // Test hosts install modules directly.
  if (typeof globalThis.__lucentModules === "object" && globalThis.__lucentModules) {
    native = globalThis.__lucentModules;
    return native;
  }
  const { TurboModuleRegistry } = require("react-native");
  native = TurboModuleRegistry.get("Lucent");
  if (!native) {
    throw new Error(
      "Lucent: the native module is not linked. Run `lucent build`, then rebuild the app " +
        "(iOS: `pod install`; Android: a Gradle sync happens on the next build).",
    );
  }
  return native;
}

function loadModule(name) {
  const m = getNative()[name];
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
