import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import * as compiler from "@lucent-lang/compiler";

const require = createRequire(import.meta.url);
const { createPlugin } = require("../ts-plugin/index.js") as {
  createPlugin: (load: () => Promise<typeof compiler>) => ts.server.PluginModuleFactory;
};

/** A language service over `files` (unsaved text in `buffers`) with the plugin applied. */
function service(files: Record<string, string>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-plugin-"));
  const buffers = new Map<string, { text: string; version: number }>();
  for (const [name, text] of Object.entries(files)) {
    const f = path.join(dir, name);
    fs.writeFileSync(f, text);
    buffers.set(f, { text, version: 0 });
  }
  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => ({ strict: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, allowImportingTsExtensions: true, noEmit: true }),
    getScriptFileNames: () => [...buffers.keys()],
    getScriptVersion: (f) => String(buffers.get(f)?.version ?? 0),
    getScriptSnapshot: (f) => {
      const b = buffers.get(f);
      if (b) return ts.ScriptSnapshot.fromString(b.text);
      return fs.existsSync(f) ? ts.ScriptSnapshot.fromString(fs.readFileSync(f, "utf8")) : undefined;
    },
    getCurrentDirectory: () => dir,
    getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
    fileExists: (f) => buffers.has(f) || fs.existsSync(f),
    readFile: (f) => buffers.get(f)?.text ?? (fs.existsSync(f) ? fs.readFileSync(f, "utf8") : undefined),
  };
  const languageService = ts.createLanguageService(host);
  let refreshed = 0;
  const project = { getFileNames: () => [...buffers.keys()], refreshDiagnostics: () => refreshed++, projectService: { logger: { info: () => {} } } };
  let markLoaded = () => {};
  const loaded = new Promise<void>((resolve) => (markLoaded = resolve));
  const factory = createPlugin(async () => {
    try {
      return compiler;
    } finally {
      setTimeout(markLoaded);
    }
  });
  const plugin = factory({ typescript: ts });
  const ls = plugin.create({ languageService, languageServiceHost: host, project, config: {} } as never);
  return {
    ls,
    file: (name: string) => path.join(dir, name),
    edit(name: string, text: string) {
      const b = buffers.get(path.join(dir, name))!;
      b.text = text;
      b.version++;
    },
    ready: loaded,
    refreshes: () => refreshed,
  };
}

const lucent = (ds: readonly ts.Diagnostic[]) => ds.filter((d) => d.source === "lucent");

describe("@lucent-lang/lucent/ts-plugin", () => {
  it("adds Lucent diagnostics to .lucent.ts files once the compiler loads", async () => {
    const s = service({ "a.lucent.ts": "export function f(): number {\n  var x = 1;\n  return x;\n}\n" });
    await s.ready;
    expect(s.refreshes()).toBe(1);
    const [d] = lucent(s.ls.getSemanticDiagnostics(s.file("a.lucent.ts")));
    expect(d).toMatchObject({ code: 1001, category: ts.DiagnosticCategory.Error, start: 32, length: 9 });
    expect(d!.messageText).toMatch(/^LUCENT1001: /);
  });

  it("follows unsaved edits", async () => {
    const s = service({ "a.lucent.ts": "export function f(): number { return 1; }\n" });
    await s.ready;
    expect(lucent(s.ls.getSemanticDiagnostics(s.file("a.lucent.ts")))).toEqual([]);
    s.edit("a.lucent.ts", "export function f(x: any): number { return 1; }\n");
    expect(lucent(s.ls.getSemanticDiagnostics(s.file("a.lucent.ts"))).map((d) => d.code)).toEqual([2001]);
  });

  it("shows Lucent warnings as warnings", async () => {
    const s = service({ "a.lucent.ts": 'import { now } from "@lucent-lang/core";\nexport function f(): number { return now(); }\n' });
    await s.ready;
    const [d] = lucent(s.ls.getSemanticDiagnostics(s.file("a.lucent.ts")));
    expect(d).toMatchObject({ code: 3008, category: ts.DiagnosticCategory.Warning });
  });

  it("leaves TypeScript errors and other files to TypeScript", async () => {
    const s = service({ "a.lucent.ts": "export function f(): number { return 'x'; }\n", "b.ts": "var y = 1;\nexport {};\n" });
    await s.ready;
    expect(lucent(s.ls.getSemanticDiagnostics(s.file("a.lucent.ts")))).toEqual([]);
    expect(s.ls.getSemanticDiagnostics(s.file("a.lucent.ts")).length).toBeGreaterThan(0);
    expect(lucent(s.ls.getSemanticDiagnostics(s.file("b.ts")))).toEqual([]);
  });
});
