"use strict";
// What a platform module (lucent:ios/*, lucent:android/*, lucent:ext/*, …)
// is in JS dev mode: a stand-in whose members exist, so importing it and
// branching on PLATFORM work, but which throws as soon as code reads,
// calls or constructs anything of it. JS dev mode runs modules as
// JavaScript, which can't reach the platform's SDK.

function failure(module, member) {
  const e = new Error(
    `Lucent: ${member ? `${member} (${module})` : module} is native code, which JS dev mode can't run: it runs *.lucent.ts modules as JavaScript. Start Metro without LUCENT_JS (or withLucent's js option) and rebuild the app to call it.`,
  );
  e.code = "LUCENT_JS_DEV_NATIVE";
  return e;
}

/** A member of `module`: reading, calling or constructing it throws. */
function member(module, name) {
  const fail = () => {
    throw failure(module, name);
  };
  return new Proxy(function () {}, {
    get(_, key) {
      // What JavaScript asks of any value it holds (printing it, awaiting it).
      if (typeof key === "symbol" || key === "then" || key === "toJSON") return undefined;
      return fail();
    },
    set: fail,
    has: fail,
    apply: fail,
    construct: fail,
  });
}

/** The stand-in for `module`, as `import { X } from "<module>"` reads it. */
module.exports = function nativeModule(module) {
  const members = new Map();
  return new Proxy(
    {},
    {
      get(_, key) {
        if (key === "__esModule") return true;
        if (typeof key === "symbol" || key === "then") return undefined;
        if (!members.has(key))
          members.set(key, member(module, key === "default" ? undefined : key));
        return members.get(key);
      },
    },
  );
};
module.exports.failure = failure;
