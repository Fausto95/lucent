"use strict";
// JS dev mode: Metro bundles each *.lucent.ts module as the JavaScript it
// is, instead of the proxy of its native build. Lucent's contract is
// JavaScript's semantics, so a module's logic runs the same; a body edit
// is then a Fast Refresh, with no native rebuild. What only native code
// has fails clearly: a platform SDK, a native extension or a view
// toolkit's import is a stand-in that throws LUCENT_JS_DEV_NATIVE when
// code reads, calls or constructs anything of it. A `.lucent.tsx` module
// (components, which are native views) is bundled as its native build's
// proxy, as without the mode.
//
// Opt-in, for development builds: `withLucent(config, { js: true })` or
// LUCENT_JS=1 in Metro's environment. A release bundle refuses it.
const fs = require("node:fs");
const path = require("node:path");

const PLATFORM_FILE = /\.(ios|android)\.lucent\.ts$/;

/** Whether Metro runs modules as JavaScript (withLucent sets LUCENT_JS_DEV for its workers). */
const enabled = () => process.env.LUCENT_JS_DEV === "1";

/** lucent:core's JavaScript implementation: next to dist/ when installed, the compiler's here. */
function coreFile() {
  const installed = path.join(__dirname, "../lib/core.cjs");
  return fs.existsSync(installed) ? installed : path.join(__dirname, "../../compiler/lib/core.cjs");
}

/** A require path from `file`'s directory to `target`, as Metro resolves it. */
function relative(file, target) {
  const rel = path.relative(path.dirname(file), target).split(path.sep).join("/");
  return rel.startsWith(".") ? rel : `./${rel}`;
}

/** What a `lucent:*` import is in JS dev mode, as the expression `require(...)` becomes. */
function lucentImport(file, spec) {
  const here = (name) => JSON.stringify(relative(file, path.join(__dirname, "js", name)));
  if (spec === "lucent:core") return `require(${JSON.stringify(relative(file, coreFile()))})`;
  if (spec === "lucent:platform") return `require(${here("platform.js")})`;
  if (spec === "lucent:thread") return `require(${here("thread.js")})`;
  return `require(${here("native.js")})(${JSON.stringify(spec)})`;
}

/**
 * The module `file` as JavaScript, for Metro to bundle; undefined for one
 * bundled as its native proxy (`proxy()` gives that source). A platform
 * module's declaration (`name.lucent.ts` beside `name.ios.lucent.ts`)
 * requires the running platform's file.
 */
function module_(file, args, proxy) {
  if (args.options && args.options.dev === false)
    throw new Error(
      `Lucent: JS dev mode (withLucent's js option, LUCENT_JS=1) runs ${path.basename(file)} as JavaScript, which is for development only: bundle releases without it, from the native build.`,
    );
  if (file.endsWith(".tsx")) return proxy();

  const base = file.replace(/\.lucent\.ts$/, "");
  const implementations = PLATFORM_FILE.test(file)
    ? []
    : ["ios", "android"].filter((p) => fs.existsSync(`${base}.${p}.lucent.ts`));
  if (implementations.length) {
    const each = implementations
      .map(
        (p) =>
          `  ${JSON.stringify(p)}: () => require(${JSON.stringify(relative(file, `${base}.${p}.lucent.ts`))})`,
      )
      .join(",\n");
    return `"use strict";\nconst { Platform } = require("react-native");\nconst implementations = {\n${each},\n};\nconst load = implementations[Platform.OS];\nif (!load) throw new Error("Lucent: ${path.basename(file)} has no " + Platform.OS + " implementation");\nmodule.exports = load();\n`;
  }

  const ts = require("typescript");
  const out = ts.transpileModule(args.src, {
    fileName: file,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      // Class fields as JavaScript defines them, as Lucent compiles them.
      useDefineForClassFields: true,
    },
  }).outputText;
  return out.replace(/\brequire\((["'])(lucent:[^"']+)\1\)/g, (_, _q, spec) =>
    lucentImport(file, spec),
  );
}

module.exports = { enabled, module: module_ };
