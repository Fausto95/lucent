"use strict";
// Loads Lucent modules from the native "Lucent" TurboModule. `lucent build`
// copies it into the native package (js/_lucent/runtime.js), and the generated
// proxies (what Metro bundles in place of each *.lucent.ts file) require it
// from there and call loadModule().
// This file must not require "react-native" itself: the proxy passes the
// app's own TurboModuleRegistry in.

let native;

function getNative(registry) {
  // Test hosts install modules directly, and may install new ones.
  if (typeof globalThis.__lucentModules === "object" && globalThis.__lucentModules)
    return globalThis.__lucentModules;
  if (native) return native;
  native = registry().get("Lucent");
  if (!native) {
    throw new Error(
      "Lucent: the native module is not linked. Run `lucent build`, then rebuild the app " +
        "(iOS: `pod install` first).",
    );
  }
  return native;
}

const REBUILD =
  "Recompile the app's native code: run `lucent build`, then build and install the app again " +
  "(compile-native). A JavaScript update (a reload, or over the air) cannot replace native code.";
const RELOAD = "Reload JavaScript built for the installed app (reload-js).";

/** An error that names what to do: `action` is one of lucent build's pending action kinds. */
function mismatch(problem, action) {
  const e = new Error(`Lucent: ${problem} ${action === "reload-js" ? RELOAD : REBUILD}`);
  e.code = "LUCENT_NATIVE_MISMATCH";
  e.action = action;
  return e;
}

/**
 * What the native code and this JavaScript's build share, once per host and
 * build: undefined, or the error to throw. A different program with the
 * same APIs runs, with a warning: calls are safe, but the implementation is
 * not the one this JavaScript was built with.
 */
const programs = new Map();

function checkProgram(actual, expected) {
  const key = `${actual.host}\n${expected.runtimeAbi}\n${expected.programs[actual.target]}`;
  if (programs.has(key)) return programs.get(key);

  let problem;
  if (actual.runtimeAbi !== expected.runtimeAbi) {
    problem = mismatch(
      `the app's native code has Lucent runtime ABI ${actual.runtimeAbi}, and this JavaScript needs ${expected.runtimeAbi}.`,
      actual.runtimeAbi > expected.runtimeAbi ? "reload-js" : "compile-native",
    );
  } else if (!expected.programs[actual.target]) {
    problem = mismatch(
      `this JavaScript was built without the ${actual.target} native code the app runs.`,
      "compile-native",
    );
  } else if (actual.program !== expected.programs[actual.target]) {
    console.warn(
      `Lucent: the app's native code (${actual.target} program ${actual.program}) was not built from ` +
        `the sources this JavaScript was (program ${expected.programs[actual.target]}): its modules have ` +
        `the same APIs, but the installed implementation runs. ${REBUILD} If the app was installed ` +
        `after this JavaScript was built, reload JavaScript instead (reload-js).`,
    );
  }

  programs.set(key, problem);
  return problem;
}

/** Throws unless module `name` of the native code is what this JavaScript was built against. */
function check(n, name, expected) {
  const actual = n.__lucentIdentity;
  if (!actual)
    throw mismatch(
      "the app's native code was built before Lucent gave it a build identity, so it cannot be checked against this JavaScript.",
      "compile-native",
    );

  const problem = checkProgram(actual, expected);
  if (problem) throw problem;

  const want = expected.apis[actual.target] && expected.apis[actual.target][name];
  const have = actual.modules[name];
  if (have === undefined)
    throw mismatch(`module "${name}" is not in the app's native code.`, "compile-native");
  if (have !== want)
    throw mismatch(
      `module "${name}" of the app's native code has other exports or signatures (API ${have}) ` +
        `than this JavaScript was built for (API ${want}).`,
      "compile-native",
    );
}

/**
 * The exports of a compiled Lucent module, after checking that the app's
 * native code was built as this JavaScript expects.
 * @param {string} name module name (the file name without .lucent.ts)
 * @param {() => { get(name: string): any }} registry returns React Native's TurboModuleRegistry
 * @param {{ runtimeAbi: number, programs: Record<string, string>, apis: Record<string, Record<string, string>> }} [expected]
 *   the build identity lucent build wrote next to the proxies (none from older proxies: nothing is checked)
 */
function loadModule(name, registry, expected) {
  const n = getNative(registry);
  if (expected) check(n, name, expected);
  const m = n[name];
  if (!m) {
    throw new Error(
      `Lucent: module "${name}" is not in the native build. Run \`lucent build\` and rebuild the app.`,
    );
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
  Object.defineProperty(LucentClass.prototype, "constructor", {
    value: LucentClass,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(LucentClass, "name", { value: factory.name });
  for (const key of Object.keys(factory)) LucentClass[key] = factory[key];
  return LucentClass;
}

module.exports = { loadModule, lucentClass };
