// The JS loader against a real host: it checks the proxies' build identity
// against the native code's before a module loads. Runs after commonjs.js
// and the loader, with the hand-written module (manual_module.cpp).
var __failures = 0;
var __passes = 0;
function eq(label, actual, expected) {
  if (actual === expected) {
    __passes++;
  } else {
    __failures++;
    print("FAIL " + label + ": got " + actual + ", expected " + expected);
  }
}

var loader = module.exports;
var registry = function () {
  return { get: function () {} };
};
var native = __lucentModules.__lucentIdentity;
var built = {
  runtimeAbi: native.runtimeAbi,
  programs: { all: "program-of-manual" },
  apis: { all: { manual: "api-of-manual" } },
};
var warnings = [];
console = {
  warn: function (m) {
    warnings.push(m);
  },
};

eq(
  "the host's own identity",
  native.program + " " + native.modules.manual,
  "program-of-manual api-of-manual",
);
eq("a matching build loads", loader.loadModule("manual", registry, built), __lucent.manual);
eq("and says nothing", warnings.length, 0);

function action(expected) {
  try {
    loader.loadModule("manual", registry, expected);
    return "loaded";
  } catch (e) {
    return e.action;
  }
}

eq(
  "new proxies over a stale binary",
  action({
    runtimeAbi: built.runtimeAbi,
    programs: built.programs,
    apis: { all: { manual: "api-2" } },
  }),
  "compile-native",
);
eq(
  "an older runtime",
  action({ runtimeAbi: built.runtimeAbi + 1, programs: built.programs, apis: built.apis }),
  "compile-native",
);
eq(
  "a newer runtime",
  action({ runtimeAbi: built.runtimeAbi - 1, programs: built.programs, apis: built.apis }),
  "reload-js",
);
eq(
  "only the implementation differs",
  action({ runtimeAbi: built.runtimeAbi, programs: { all: "program-2" }, apis: built.apis }),
  "loaded",
);
eq("which warns", warnings.length, 1);

print(__passes + " passed, " + __failures + " failed");
