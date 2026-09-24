"use strict";
// TypeScript language-service plugin: adds Lucent diagnostics to *.lucent.ts
// (index.js, not .cjs: tsserver resolves plugin paths without "exports").
// files. tsserver loads plugins with require() and its own `typescript`,
// while the compiler is an ES module that walks ASTs from its own
// `typescript`; so the plugin imports the compiler asynchronously and hands
// it file paths and unsaved text, never the editor's AST.

const LUCENT_FILE = /\.lucent\.tsx?$/;
const TYPESCRIPT_PASSTHROUGH = "LUCENT9001";

function createPlugin(loadCompiler) {
  return function init({ typescript: ts }) {
    function create(info) {
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
        const key = files.map((f) => `${f}@${info.languageServiceHost.getScriptVersion(f)}`).join("|");
        if (cache.key !== key) {
          const byFile = new Map();
          const readSource = (f) => {
            const snap = files.includes(f) ? info.languageServiceHost.getScriptSnapshot(f) : undefined;
            return snap ? snap.getText(0, snap.getLength()) : undefined;
          };
          for (const d of compiler.checkSources(files, readSource)) {
            if (d.code === TYPESCRIPT_PASSTHROUGH || !d.file) continue;
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
          extra = lucentDiagnostics(fileName).map((d) => ({
            file,
            start: d.start ?? 0,
            length: d.length ?? 0,
            messageText: [`${d.code}: ${d.message}`, d.fix && `fix: ${d.fix}`, d.docs && `docs: ${d.docs}`].filter(Boolean).join("\n"),
            category: ts.DiagnosticCategory.Error,
            code: Number(d.code.replace(/^LUCENT/, "")),
            source: "lucent",
          }));
        } catch (e) {
          log(`check failed: ${e && e.stack ? e.stack : e}`);
          return own;
        }
        return [...own, ...extra];
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
const compiler = fs.existsSync(path.join(__dirname, "../src")) ? "@lucent-lang/compiler" : pathToFileURL(path.join(__dirname, "../dist/compiler.js")).href;

module.exports = createPlugin(() => import(compiler));
module.exports.createPlugin = createPlugin;
