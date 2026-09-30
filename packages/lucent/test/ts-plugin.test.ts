import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vite-plus/test";
import * as compiler from "@lucent-lang/compiler";

const require = createRequire(import.meta.url);
const { createPlugin, TOOLKIT_JSX } = require("../ts-plugin/index.js") as {
  createPlugin: (load: () => Promise<typeof compiler>) => ts.server.PluginModuleFactory;
  TOOLKIT_JSX: Record<string, string>;
};

/** A language service over `files` (unsaved text in `buffers`) with the plugin applied. */
function service(files: Record<string, string>, options: ts.CompilerOptions = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-plugin-"));
  const buffers = new Map<string, { text: string; version: number }>();
  for (const [name, text] of Object.entries(files)) {
    const f = path.join(dir, name);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, text);
    if (!name.startsWith("node_modules/") && !name.startsWith("types/"))
      buffers.set(f, { text, version: 0 });
  }
  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => ({
      strict: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      allowImportingTsExtensions: true,
      noEmit: true,
      types: [],
      ...options,
    }),
    getScriptFileNames: () => [...buffers.keys()],
    getScriptVersion: (f) => String(buffers.get(f)?.version ?? 0),
    getScriptSnapshot: (f) => {
      const b = buffers.get(f);
      if (b) return ts.ScriptSnapshot.fromString(b.text);
      return fs.existsSync(f)
        ? ts.ScriptSnapshot.fromString(fs.readFileSync(f, "utf8"))
        : undefined;
    },
    getCurrentDirectory: () => dir,
    getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
    fileExists: (f) => buffers.has(f) || fs.existsSync(f),
    readFile: (f) =>
      buffers.get(f)?.text ?? (fs.existsSync(f) ? fs.readFileSync(f, "utf8") : undefined),
  };
  const languageService = ts.createLanguageService(host);
  let refreshed = 0;
  const project = {
    getFileNames: () => [...buffers.keys()],
    refreshDiagnostics: () => refreshed++,
    projectService: { logger: { info: () => {} } },
  };
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
  const ls = plugin.create({
    languageService,
    languageServiceHost: host,
    project,
    config: {},
  } as never);
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
    const s = service({
      "a.lucent.ts": "export function f(): number {\n  var x = 1;\n  return x;\n}\n",
    });
    await s.ready;
    expect(s.refreshes()).toBe(1);
    const [d] = lucent(s.ls.getSemanticDiagnostics(s.file("a.lucent.ts")));
    expect(d).toMatchObject({
      code: 1001,
      category: ts.DiagnosticCategory.Error,
      start: 32,
      length: 9,
    });
    expect(d!.messageText).toMatch(/^LUCENT1001: /);
  });

  it("adds the fix and where the code is explained", async () => {
    const s = service({
      "a.lucent.ts": "export function f(): number {\n  var x = 1;\n  return x;\n}\n",
    });
    await s.ready;
    const [d] = lucent(s.ls.getSemanticDiagnostics(s.file("a.lucent.ts")));
    expect(d!.messageText).toMatch(
      /\nfix: .*let.*\ndocs: https:\/\/lucent-lang\.dev\/docs\/reference\/diagnostics\/#lucent1001$/,
    );
  });

  it.skipIf(!compiler.sdkAvailable("android"))("shows warnings as warnings", async () => {
    const s = service({
      "a.lucent.ts": `import { PLATFORM } from "lucent:platform";
import { Toast } from "lucent:android/android.widget";
import { appContext } from "lucent:android";
export async function toast(): Promise<boolean> {
  if (PLATFORM === "android") return Toast.makeText(appContext(), "hi", 5) !== null;
  return false;
}
`,
    });
    await s.ready;
    const [d] = lucent(s.ls.getSemanticDiagnostics(s.file("a.lucent.ts")));
    expect(d).toMatchObject({ code: 3008, category: ts.DiagnosticCategory.Warning });
  });

  it("follows unsaved edits", async () => {
    const s = service({ "a.lucent.ts": "export function f(): number { return 1; }\n" });
    await s.ready;
    expect(lucent(s.ls.getSemanticDiagnostics(s.file("a.lucent.ts")))).toEqual([]);
    s.edit("a.lucent.ts", "export function f(x: any): number { return 1; }\n");
    expect(lucent(s.ls.getSemanticDiagnostics(s.file("a.lucent.ts"))).map((d) => d.code)).toEqual([
      2001,
    ]);
  });

  it("leaves TypeScript errors and other files to TypeScript", async () => {
    const s = service({
      "a.lucent.ts": "export function f(): number { return 'x'; }\n",
      "b.ts": "var y = 1;\nexport {};\n",
    });
    await s.ready;
    expect(lucent(s.ls.getSemanticDiagnostics(s.file("a.lucent.ts")))).toEqual([]);
    expect(s.ls.getSemanticDiagnostics(s.file("a.lucent.ts")).length).toBeGreaterThan(0);
    expect(lucent(s.ls.getSemanticDiagnostics(s.file("b.ts")))).toEqual([]);
  });

  describe("JSX", () => {
    // A toolkit's module as `lucent build` writes it for the app, and React's runtime.
    const typed = {
      "types/swiftui.d.ts": `declare interface View { readonly swiftui: true }
declare interface $Text { (props: { children: string; padding?: number }): View }
export declare const Text: $Text;
export declare namespace JSX {
  type Element = View;
  interface ElementChildrenAttribute { children: {} }
  interface IntrinsicElements {}
}
`,
      "node_modules/react/package.json": JSON.stringify({ name: "react", types: "index.d.ts" }),
      "node_modules/react/index.d.ts": "export {};\n",
      "node_modules/react/jsx-runtime.d.ts": `export declare namespace JSX {
  interface Element { readonly react: true }
  interface IntrinsicElements { div: { id?: string } }
}
`,
      "hello.ios.lucent.tsx": `import { Text } from "lucent:swiftui";\nexport const hello = <Text padding={4}>hi</Text>;\n`,
      "app.tsx": `export const app = <div id="a" />;\n`,
    };
    const paths = { "lucent:*": ["./types/*"] };
    const errors = (s: ReturnType<typeof service>, name: string) =>
      s.ls
        .getSemanticDiagnostics(s.file(name))
        .filter((d) => d.source !== "lucent")
        .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));

    it("types a platform file's JSX with its toolkit, and the app's with React", () => {
      const s = service(typed, { jsx: ts.JsxEmit.ReactJSX, paths });

      expect(errors(s, "hello.ios.lucent.tsx")).toEqual([]);
      expect(errors(s, "app.tsx")).toEqual([]);
    });

    it("types them so when the app's JSX imports no runtime (React Native's)", () => {
      const s = service(typed, { jsx: ts.JsxEmit.ReactNative, paths });

      expect(errors(s, "hello.ios.lucent.tsx")).toEqual([]);
      expect(errors(s, "app.tsx")).toEqual([]);
    });

    it("keeps the compiler's toolkit for each platform", () => {
      expect(TOOLKIT_JSX).toEqual(compiler.jsxToolkits());
    });
  });
});
