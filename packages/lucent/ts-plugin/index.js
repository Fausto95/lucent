"use strict";
// TypeScript language-service plugin: adds Lucent diagnostics to *.lucent.ts
// files, and types platform Lucent files' JSX with their toolkit (index.js,
// not .cjs: tsserver resolves plugin paths without "exports"). tsserver loads plugins with require() and its own `typescript`,
// while the compiler is an ES module that walks ASTs from its own
// `typescript`; so the plugin imports the compiler asynchronously and hands
// it file paths and unsaved text, never the editor's AST.

const LUCENT_FILE = /\.lucent\.tsx?$/;
const TYPESCRIPT_PASSTHROUGH = "LUCENT9001";

// A platform's Lucent files write JSX with its toolkit (the compiler's TOOLKITS,
// ui/toolkits.ts; a test keeps them equal): their implicit JSX runtime import
// resolves to lucent:<toolkit>, whose module declares the JSX namespace. A
// shared Lucent file writes either toolkit's, each in its platform's code:
// its runtime is lucent:jsx, which `lucent build` writes beside them.
const TOOLKIT_JSX = { ios: "swiftui", android: "compose" };
const SHARED_JSX = "jsx";
const LUCENT_JSX_FILE = /\.lucent\.tsx$/;
const PLATFORM_FILE = /\.(ios|android)\.lucent\.tsx$/;
const JSX_RUNTIME = /\/jsx-(dev-)?runtime$/;

/**
 * Types each platform Lucent file's JSX with its toolkit, the app's other
 * files' JSX as they are: TypeScript imports a JSX runtime implicitly, per
 * file, and the host resolves that import. An app whose JSX has no runtime
 * import (React Native's `jsx: react-native`) gets React's as its import
 * source, which types React's JSX alike (react/jsx-runtime's JSX is
 * React.JSX), once it has Lucent files with JSX.
 */
function withToolkitJsx(ts, host) {
  const settings = host.getCompilationSettings.bind(host);
  host.getCompilationSettings = () => {
    const options = settings();
    const imported =
      options.jsx === ts.JsxEmit.ReactJSX ||
      options.jsx === ts.JsxEmit.ReactJSXDev ||
      options.jsx === ts.JsxEmit.React ||
      options.jsxImportSource;
    if (imported || !host.getScriptFileNames().some((f) => LUCENT_JSX_FILE.test(f))) return options;
    return { ...options, jsxImportSource: "react" };
  };

  const resolve = host.resolveModuleNameLiterals
    ? host.resolveModuleNameLiterals.bind(host)
    : defaultResolution(ts, host);
  host.resolveModuleNameLiterals = (literals, containing, redirected, options, sf, reused) => {
    const platform = PLATFORM_FILE.exec(containing);
    const toolkit = platform
      ? TOOLKIT_JSX[platform[1]]
      : LUCENT_JSX_FILE.test(containing)
        ? SHARED_JSX
        : undefined;
    // The implicit import is synthesized: it has no place in the file's text.
    const runtime = (l) => toolkit && l.pos < 0 && JSX_RUNTIME.test(l.text);
    const own = literals.map((l) =>
      runtime(l) ? Object.create(l, { text: { value: `lucent:${toolkit}` } }) : l,
    );
    return resolve(own, containing, redirected, options, sf, reused);
  };
}

/** Module resolution as the language service does it, for a host that leaves it to it. */
function defaultResolution(ts, host) {
  const cache = ts.createModuleResolutionCache(
    host.getCurrentDirectory(),
    (f) => f,
    host.getCompilationSettings(),
  );
  return (literals, containing, redirected, options, sf) =>
    literals.map((l) =>
      ts.resolveModuleName(
        l.text,
        containing,
        options,
        host,
        cache,
        redirected,
        ts.getModeForUsageLocation(sf, l, options),
      ),
    );
}

function createPlugin(loadCompiler) {
  return function init({ typescript: ts }) {
    function create(info) {
      withToolkitJsx(ts, info.languageServiceHost);
      const log = (msg) => info.project.projectService.logger.info(`[lucent] ${msg}`);
      let compiler;
      loadCompiler().then(
        (c) => {
          compiler = c;
          info.project.refreshDiagnostics();
        },
        (e) => log(`could not load the Lucent compiler: ${e && e.stack ? e.stack : e}`),
      );

      // One check serves every file until any Lucent source changes.
      let cache = { key: undefined, byFile: new Map() };
      function lucentDiagnostics(fileName) {
        const files = info.project.getFileNames().filter((f) => LUCENT_FILE.test(f));
        const key = files
          .map((f) => `${f}@${info.languageServiceHost.getScriptVersion(f)}`)
          .join("|");
        if (cache.key !== key) {
          const byFile = new Map();
          const readSource = (f) => {
            const snap = files.includes(f)
              ? info.languageServiceHost.getScriptSnapshot(f)
              : undefined;
            return snap ? snap.getText(0, snap.getLength()) : undefined;
          };
          const root = info.languageServiceHost.getCurrentDirectory();
          // Bound again each check: headers (and packages) change too; unchanged ones are read once.
          const extensions = compiler.projectExtensions(root);
          const checked = compiler.filesInBuild(root, files);
          // What the build binds from: the app's pods, Swift packages, resolved Gradle classpath
          // and its packages' binaries, so the editor types what the build types.
          const sdk = compiler.projectSdk(root);
          // TypeScript's own errors stay TypeScript's to report; kept for the fixes their hints carry.
          for (const d of compiler.checkSources(checked, readSource, { extensions, sdk })) {
            if (!d.file || (d.code === TYPESCRIPT_PASSTHROUGH && !d.quickFix)) continue;
            const list = byFile.get(d.file) || [];
            list.push(d);
            byFile.set(d.file, list);
          }
          cache = { key, byFile };
        }
        return cache.byFile.get(fileName) || [];
      }

      const proxy = Object.create(null);
      for (const k of Object.keys(info.languageService)) {
        const member = info.languageService[k];
        proxy[k] = typeof member === "function" ? member.bind(info.languageService) : member;
      }
      proxy.getSemanticDiagnostics = (fileName) => {
        const own = info.languageService.getSemanticDiagnostics(fileName);
        if (!compiler || !LUCENT_FILE.test(fileName)) return own;
        let extra;
        try {
          const file = info.languageService.getProgram()?.getSourceFile(fileName);
          extra = lucentDiagnostics(fileName)
            .filter((d) => d.code !== TYPESCRIPT_PASSTHROUGH)
            .map((d) => ({
              file,
              start: d.start ?? 0,
              length: d.length ?? 0,
              messageText: [
                `${d.code}: ${d.message}`,
                d.fix && `fix: ${d.fix}`,
                d.docs && `docs: ${d.docs}`,
              ]
                .filter(Boolean)
                .join("\n"),
              category:
                d.severity === "warning"
                  ? ts.DiagnosticCategory.Warning
                  : ts.DiagnosticCategory.Error,
              code: Number(d.code.replace(/^LUCENT/, "")),
              source: "lucent",
            }));
        } catch (e) {
          log(`check failed: ${e && e.stack ? e.stack : e}`);
          return own;
        }
        return [...own, ...extra];
      };

      // A diagnostic's code as the editor has it: Lucent's number, or a passthrough's TypeScript one.
      const editorCode = (d) =>
        d.code === TYPESCRIPT_PASSTHROUGH
          ? Number((/^TS(\d+):/.exec(d.message) || [])[1])
          : Number(d.code.replace(/^LUCENT/, ""));

      // Lucent's numbers are TypeScript's too (1006): a fix is offered at its diagnostic's span only.
      proxy.getCodeFixesAtPosition = (fileName, start, end, errorCodes, format, preferences) => {
        const own = info.languageService.getCodeFixesAtPosition(
          fileName,
          start,
          end,
          errorCodes,
          format,
          preferences,
        );
        if (!compiler || !LUCENT_FILE.test(fileName)) return own;

        const fixes = lucentDiagnostics(fileName)
          .filter(
            (d) =>
              d.quickFix &&
              errorCodes.includes(editorCode(d)) &&
              (d.start ?? 0) <= end &&
              start <= (d.start ?? 0) + (d.length ?? 0),
          )
          .map((d) => ({
            fixName: "lucent",
            description: d.quickFix.title,
            changes: [
              {
                fileName,
                textChanges: d.quickFix.edits.map((e) => ({
                  span: { start: e.start, length: e.length },
                  newText: e.text,
                })),
              },
            ],
          }));
        return [...own, ...fixes];
      };

      proxy.getSupportedCodeFixes = (fileName) => {
        const own = info.languageService.getSupportedCodeFixes(fileName);
        if (!compiler || !fileName || !LUCENT_FILE.test(fileName)) return own;

        const lucent = lucentDiagnostics(fileName)
          .filter((d) => d.quickFix)
          .map((d) => String(editorCode(d)));
        return [...new Set([...own, ...lucent])];
      };

      return proxy;
    }
    return { create };
  };
}

// Published, the compiler is bundled into dist/; in this repository (which
// has the sources) it is the workspace package.
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const compiler = fs.existsSync(path.join(__dirname, "../src"))
  ? "@lucent-lang/compiler"
  : pathToFileURL(path.join(__dirname, "../dist/compiler.js")).href;

module.exports = createPlugin(() => import(compiler));
module.exports.createPlugin = createPlugin;
module.exports.TOOLKIT_JSX = TOOLKIT_JSX;
