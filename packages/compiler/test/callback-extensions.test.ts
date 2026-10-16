/**
 * A native extension's C callbacks (decisions 0126 and 0128): a function
 * pointer its declaration makes a callback, with the `void *` C passes
 * back and how long it lives; what the declarations, the analyses and the
 * generated call make of it. Read with the host's clang, as the other
 * extensions' tests do.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import {
  bindExtensions,
  compile,
  extensionDts,
  type ExtensionBinding,
  type LucentPackage,
  resolveNative,
} from "../src/index.ts";
import { int64Name } from "../../bindgen/test/c-types.ts";

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/ticker");
const clang = spawnSync(process.env.LUCENT_CLANG ?? "clang", ["--version"]).status === 0;

/** The fixture package, copied, its declaration changed by `edit` and its header by `header`. */
function ticker(
  edit: (declaration: Record<string, any>) => void = () => {},
  header: (text: string) => string = (text) => text,
): LucentPackage {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-cb-ext-"));
  fs.cpSync(fixture, dir, { recursive: true });

  const h = path.join(dir, "native/ticker.h");
  fs.writeFileSync(h, header(fs.readFileSync(h, "utf8")));
  const file = path.join(dir, "lucent.json");
  const json = JSON.parse(fs.readFileSync(file, "utf8"));
  edit(json.extensions.ticker);
  fs.writeFileSync(file, JSON.stringify(json));

  return { name: "lucent-ticker", version: "1.0.0", dir, sources: path.join(dir, "src") };
}

const bind = (p: LucentPackage): ExtensionBinding =>
  bindExtensions(resolveNative([p]).extensions)[0]!;

let bound: ExtensionBinding | undefined;
const tickerBinding = () => (bound ??= bind(ticker()));

/** A callback named `param` of function `fn`, declared as `callback`. */
const declaring =
  (fn: string, param: string, callback: Record<string, unknown>) => (d: Record<string, any>) => {
    d.functions[fn].params[param] = { callback };
  };

/** The header with `decl` added before its closing extern "C" guard. */
const adding = (decl: string) => (text: string) =>
  text.replace("#ifdef __cplusplus\n}", `${decl}\n\n#ifdef __cplusplus\n}`);

const at = "lucent-ticker/lucent.json: extensions.ticker.functions";

describe.skipIf(!clang)("binding a C extension's callbacks", () => {
  it("binds a callback with its context, its signature and how long it lives", () => {
    const fn = (name: string) => tickerBinding().functions.find((f) => f.name === name)!;

    expect(fn("ticker_count").params).toEqual([
      { kind: "number", name: "from", c: "int" },
      { kind: "number", name: "to", c: "int" },
      {
        kind: "callback",
        name: "visit",
        context: 3,
        contextAt: 0,
        params: [{ kind: "number", c: "int" }],
        result: { kind: "void" },
        lives: "call",
      },
      { kind: "context", name: "context", callback: 2 },
    ]);
    // Strings and 64-bit integers it is given, a boolean it gives; its context last.
    expect(fn("ticker_keep").params[1]).toMatchObject({
      contextAt: 2,
      params: [{ kind: "string" }, { kind: "bigint", c: int64Name() }],
      result: { kind: "boolean" },
    });
    expect(fn("ticker_later").params[1]).toMatchObject({ lives: "once" });
    // As long as the handle parameter lives: by its index.
    expect(fn("ticker_on_tick").params[1]).toMatchObject({ lives: { handle: 0 } });
  });

  it("leaves out a function pointer its declaration doesn't make a callback", () => {
    const ext = bind(ticker((d) => delete d.functions.ticker_count));
    expect(ext.functions.some((f) => f.name === "ticker_count")).toBe(false);
    expect(ext.skipped).toContain(
      "ticker_count: parameter visit is a function pointer: declare it in params as a callback, with its context",
    );
  });

  it("refuses a callback C can't call as the declaration says, naming the field", () => {
    const refuses = (
      edit: (d: Record<string, any>) => void,
      message: string,
      header?: (t: string) => string,
    ) => expect(() => bind(ticker(edit, header))).toThrow(message);

    refuses(
      (d) => (d.functions.ticker_check.params.value = { callback: { context: "context" } }),
      `${at}.ticker_check.params.value: a callback parameter must be a function pointer, not int`,
    );
    refuses(
      declaring("ticker_count", "visit", { context: "to" }),
      `${at}.ticker_count.params.visit.callback.context: to is int, not void *: C passes it back to visit as its void *`,
    );
    refuses(
      declaring("ticker_count", "visit", { context: "nope" }),
      `${at}.ticker_count.params.visit.callback.context: ticker_count has no parameter nope`,
    );
    refuses(
      declaring("ticker_count", "visit", { context: "context", lives: "forever" }),
      `${at}.ticker_count.params.visit.callback.lives: forever is not "call", "once" or a handle parameter of ticker_count`,
    );
    // A context two callbacks share.
    refuses(
      (d) =>
        (d.functions.ticker_two = {
          params: {
            a: { callback: { context: "context" } },
            b: { callback: { context: "context" } },
          },
        }),
      `${at}.ticker_two.params.b.callback.context: context is already another callback's context`,
      adding("void ticker_two(void (*a)(void*), void (*b)(void*), void* context);"),
    );
    // No void * to pass the context back as, or one too many.
    refuses(
      (d) => (d.functions.ticker_none = { params: { f: { callback: { context: "context" } } } }),
      `${at}.ticker_none.params.f: f (void (*)(int)) must take one void *, which C passes context back as; it takes 0`,
      adding("void ticker_none(void (*f)(int), void* context);"),
    );
    refuses(
      (d) => (d.functions.ticker_bytes = { params: { f: { callback: { context: "context" } } } }),
      `${at}.ticker_bytes.params.f: f (void (*)(void *, const unsigned char *)) takes const unsigned char *; a callback takes numbers, bigints, booleans and const char * strings`,
      adding("void ticker_bytes(void (*f)(void*, const uint8_t*), void* context);"),
    );
    refuses(
      (d) => (d.functions.ticker_text = { params: { f: { callback: { context: "context" } } } }),
      `${at}.ticker_text.params.f: f (const char * (*)(void *)) returns const char *; a callback returns nothing, a number, a bigint or a boolean`,
      adding("void ticker_text(const char* (*f)(void*), void* context);"),
    );
  });
});

describe.skipIf(!clang)("a C extension's callbacks in Lucent", () => {
  it("are function types in the declarations, without their context", () => {
    const dts = extensionDts(tickerBinding());
    expect(dts).toContain(
      "export declare function ticker_count(from: number, to: number, visit: (arg0: number) => void): void;",
    );
    expect(dts).toContain(
      "export declare function ticker_keep(names: string, keep: (arg0: string, arg1: bigint) => boolean): number;",
    );
    expect(dts).toContain("  onTick(tick: (arg0: number) => void): void;");
  });

  it("are held for the call and given C as a thunk of its own parameter type", () => {
    const r = compile([path.join(fixture, "src/tick.lucent.ts")], {
      extensions: [tickerBinding()],
    });
    expect(r.diagnostics).toEqual([]);

    const cpp = [...r.files]
      .filter(([f]) => f.endsWith(".cpp"))
      .map(([, text]) => text)
      .join("\n");
    expect(cpp).toMatch(
      /lucent::ext::Callback<lucent::Fn<void\(double\)>>\("ticker_count's visit", lucent::ext::Lives::Call, x_\d+_\)/,
    );
    expect(cpp).toContain(
      "lucent::ext::thunk<lucent::Fn<void(double)>, 0>(lucent::ext::paramOf<2>(&::ticker_count))",
    );
    expect(cpp).toMatch(/auto c_\d+_ = callback_\d+_\.context\(\);/);
    expect(cpp).toMatch(/callback_\d+_\.done\(\);/);
    // As long as the ticker lives: ended once it is destroyed.
    expect(cpp).toMatch(/lucent::ext::Lives::Handle/);
    expect(cpp).toMatch(/callback_\d+_\.until\(x_\d+_\);/);
  });

  it("run during the call, as the analyses see: a compute task's callback reaches its module state", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-cb-src-"));
    const file = path.join(dir, "use.lucent.ts");
    fs.writeFileSync(
      file,
      `import { ticker_count } from "lucent:ext/ticker";
import { compute } from "lucent:core";

let total = 0;

function work(n: number): number {
  ticker_count(1, n, (v) => {
    total += v;
  });
  return n;
}

export function count(): Promise<number> {
  return compute(work, 2);
}
`,
    );
    const r = compile([file], { extensions: [tickerBinding()] });
    expect(r.diagnostics.map((d) => [d.code, d.message])).toEqual([
      [
        "LUCENT3011",
        expect.stringContaining("it calls `ticker_count`, which calls `the closure in work`"),
      ],
    ]);
  });
});
