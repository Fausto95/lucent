"use strict";
// The web target (decisions 0077 and 0133): for the `web` platform, Metro bundles each
// *.lucent.ts module as the JavaScript it is, in development and release
// bundles alike, with lucent:core's and lucent:thread's JavaScript, and
// PLATFORM "web" (react-native-web's Platform.OS). A module's web twin,
// m.web.lucent.ts, which withLucent's resolver puts in m's place, is plain
// TypeScript, bundled the same way. What the web can't run fails the
// module's transform, which the web build reports: a platform module or
// platform imports without a twin, and components, whose views are native.
const fs = require("node:fs");
const path = require("node:path");
const jsDev = require("./js-dev.cjs");

const TWIN = /\.web\.lucent\.ts$/;
const PLATFORMS = ["ios", "android"];

/** Lucent's modules with JavaScript of their own: what web code may import of Lucent's. */
const WEB_MODULES = ["lucent:core", "lucent:thread", "lucent:platform"];

/** Whether Metro bundles for the web. */
const isWeb = (options) => !!options && options.platform === "web";

/** A module file's web twin: m.web.lucent.ts, for m.lucent.ts and its platforms' files. */
const twinOf = (file) => file.replace(/(\.(ios|android))?\.lucent\.tsx?$/, ".web.lucent.ts");

/** The twin standing for `file` on the web, when there is one. */
function webTwin(file) {
  if (!file.endsWith(".lucent.ts") || TWIN.test(file)) return undefined;
  const twin = twinOf(file);
  return fs.existsSync(twin) ? twin : undefined;
}

/** A transform error at `file` (and a line of it), as Metro reports one. */
function failure(file, message, line) {
  const e = new Error(`Lucent: ${message}`);
  e.filename = file;
  if (line) {
    e.lineNumber = line;
    e.column = 0;
  }
  return e;
}

/** The line of the first import or export of `spec` in `src` that isn't type-only. */
function lineOf(file, src, spec) {
  const ts = require("typescript");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.ES2022, true);
  const typeOnly = (s) =>
    ts.isImportDeclaration(s)
      ? !!s.importClause && s.importClause.isTypeOnly
      : ts.isExportDeclaration(s) && s.isTypeOnly;
  const found = sf.statements.find(
    (s) =>
      (ts.isImportDeclaration(s) || ts.isExportDeclaration(s)) &&
      s.moduleSpecifier &&
      ts.isStringLiteral(s.moduleSpecifier) &&
      s.moduleSpecifier.text === spec &&
      !typeOnly(s),
  );
  return found ? sf.getLineAndCharacterOfPosition(found.getStart(sf)).line + 1 : undefined;
}

/** The `lucent:` modules the module's JavaScript requires (type-only imports are gone) that the web has none of. */
function platformRequires(js) {
  const out = new Set();
  for (const m of js.matchAll(/\brequire\((["'])(lucent:[^"']+)\1\)/g))
    if (!WEB_MODULES.includes(m[2])) out.add(m[2]);
  return [...out];
}

/** The module `file` as the web bundle runs it; throws, naming the code, for what the web can't run. */
function module_(file, src) {
  const name = path.basename(file);
  const twin = path.basename(twinOf(file));

  if (file.endsWith(".tsx"))
    throw failure(
      file,
      `${name} is a component module, whose views are native: the web has none. Render a React component on the web instead, in a .web.tsx file beside the code that uses it.`,
    );

  if (!TWIN.test(file)) {
    const base = file.replace(/(\.(ios|android))?\.lucent\.ts$/, "");
    const platforms = PLATFORMS.map((p) => `${base}.${p}.lucent.ts`).filter((f) =>
      fs.existsSync(f),
    );
    if (platforms.length)
      throw failure(
        file,
        `${path.basename(base)}.lucent.ts is a platform module (${platforms.map((f) => path.basename(f)).join(", ")}), which the web can't run: add ${twin}, TypeScript that exports what it declares, for the web.`,
      );
  }

  const js = jsDev.transpile(file, src);
  const platform = platformRequires(js);
  if (platform.length) {
    const first = platform[0];
    const line = lineOf(file, src, first);
    const named = `${line ? `line ${line} imports ` : "it imports "}${first}${platform.length > 1 ? ` (and ${platform.slice(1).join(", ")})` : ""}`;
    throw failure(
      file,
      TWIN.test(file)
        ? `${name} is a web twin, which runs on the web, but ${named}. Of Lucent's modules the web has ${WEB_MODULES.join(", ")}.`
        : `${name} uses platform code, which the web can't run: ${named}. Add ${twin}, TypeScript that exports what ${name} does, for the web.`,
      line,
    );
  }

  return jsDev.lucentImports(file, js);
}

module.exports = { isWeb, module: module_, twinOf, webTwin };
