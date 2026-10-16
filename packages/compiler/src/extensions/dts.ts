/**
 * The declarations Lucent code imports from `lucent:ext/<name>`: each
 * handle as a class (its create is the constructor, its methods take the
 * handle as `this`, and close() destroys it), and every bound function
 * under its C name.
 */
import { ts as dts } from "@lucent-lang/codegen";
import type {
  CallbackValue,
  ExtensionBinding,
  FunctionBinding,
  ParamBinding,
  ResultBinding,
} from "./bind.ts";
import type { ClassBinding, CxxCallBinding, CxxValue } from "./bind-cxx.ts";
import { TS_RESERVED } from "./names.ts";

export function extensionDts(ext: ExtensionBinding): string {
  const handles = ext.handles.map((h): dts.Decl => ({
    k: "class",
    name: h.name,
    doc: [
      `A handle of ${ext.package}'s native extension, made by ${h.create.name}; close() destroys it, once.`,
      ...(h.affinity === "main" ? ["Used on the main thread only: inside main(() => …)."] : []),
    ],
    members: [
      { k: "constructor", params: params(h.create), doc: h.create.name },
      ...h.methods.map((m): dts.Member => ({
        k: "method",
        name: m.name,
        params: params(m.fn).slice(1),
        ret: result(m.fn.result),
        doc: m.fn.name,
      })),
      {
        k: "method",
        name: "close",
        params: [],
        ret: dts.keyword("void"),
        doc: "Destroys it; later uses throw. Closing again does nothing.",
      },
      {
        k: "method",
        name: "[Symbol.dispose]",
        params: [],
        ret: dts.keyword("void"),
        doc: "close()",
      },
    ],
  }));

  const functions = ext.functions.map((f): dts.Decl => ({
    k: "function",
    name: f.name,
    params: params(f),
    ret: result(f.result),
  }));

  const enums = ext.enums.map((e): dts.Decl => ({ k: "enum", name: e.name, members: e.values }));

  // A bytes parameter takes a NativeBuffer too (decision 0130).
  const buffers = [...ext.functions, ...ext.handles.map((h) => h.create)].some((f) =>
    f.params.some((p) => p.kind === "bytes"),
  );
  const text = dts.printUnit({
    banner: `lucent:ext/${ext.name}: ${ext.package}'s native extension (generated from its header and lucent.json)`,
    decls: [
      ...(buffers
        ? [{ k: "importType" as const, names: ["NativeBuffer"], from: "lucent:core" }]
        : []),
      ...handles,
      ...ext.classes.map((c) => classDecl(ext, c)),
      ...enums,
      ...functions,
    ],
  });

  return ext.skipped.length
    ? `${text}\n// Not bound:\n${ext.skipped.map((s) => `//   ${s}`).join("\n")}\n`
    : text;
}

/**
 * A C++ class (decision 0125): its constructor's and methods' overloads,
 * in the binding's order, which the emitter finds a call's by; close()
 * deletes its object. Without a bound constructor, it has a private one:
 * Lucent code gets one from a method.
 */
function classDecl(ext: ExtensionBinding, c: ClassBinding): dts.Decl {
  return {
    k: "class",
    name: c.name,
    doc: [
      `${c.qualified}, a class of ${ext.package}'s C++ library; close() deletes the object, once.`,
      ...(c.affinity === "main" ? ["Used on the main thread only: inside main(() => …)."] : []),
    ],
    members: [
      ...(c.constructors.length
        ? c.constructors.map((k): dts.Member => ({ k: "constructor", params: cxxParams(k) }))
        : [{ k: "constructor" as const, params: [], private: true }]),
      ...c.methods.flatMap((m) =>
        m.overloads.map((o): dts.Member => ({
          k: "method",
          name: m.name,
          ...(m.static ? { static: true } : {}),
          params: cxxParams(o),
          ret: o.result ? cxxType(o.result) : dts.keyword("void"),
        })),
      ),
      {
        k: "method",
        name: "close",
        params: [],
        ret: dts.keyword("void"),
        doc: "Deletes the object; later uses throw. Closing again does nothing.",
      },
      {
        k: "method",
        name: "[Symbol.dispose]",
        params: [],
        ret: dts.keyword("void"),
        doc: "close()",
      },
    ],
  };
}

function cxxParams(call: CxxCallBinding): dts.Param[] {
  return optionalSignal(
    call.params.map((p) => ({
      name: TS_RESERVED.has(p.name) ? `${p.name}$` : p.name,
      type: cxxType(p.value),
    })),
  );
}

/** A call's AbortSignal: `AbortSignal | undefined`, which a call leaves out when it is last. */
const SIGNAL: dts.Type = dts.union([dts.ref("AbortSignal"), dts.keyword("undefined")]);

function optionalSignal(params: dts.Param[]): dts.Param[] {
  const last = params.at(-1);
  if (last?.type !== SIGNAL) return params;
  return [
    ...params.slice(0, -1),
    { name: last.name, type: dts.ref("AbortSignal"), optional: true },
  ];
}

function cxxType(v: CxxValue): dts.Type {
  switch (v.kind) {
    case "number":
      return dts.keyword("number");
    case "bigint":
      return dts.ref("bigint");
    case "boolean":
      return dts.keyword("boolean");
    case "string":
      return dts.keyword("string");
    case "array":
      return dts.array(cxxType(v.of));
    case "optional":
      return dts.union([cxxType(v.of), dts.keyword("undefined")]);
    case "enum":
      return dts.ref(v.name);
    case "object":
      return dts.ref(v.class);
    case "callback":
      return {
        k: "fn",
        params: v.params.map((p, i) => ({ name: `arg${i}`, type: cxxType(p) })),
        ret: v.result ? cxxType(v.result) : dts.keyword("void"),
      };
    case "signal":
      return SIGNAL;
  }
}

/** What Lucent code passes: lengths, errors and callbacks' contexts are the binding's. */
function params(f: FunctionBinding): dts.Param[] {
  return optionalSignal(
    f.params.flatMap((p, i) => {
      const type = paramType(p);
      if (!type) return [];

      // Unnamed, or a TypeScript keyword (`new`): a name no C parameter has (C names cannot end in `$`).
      const name = !p.name ? `arg${i}$` : TS_RESERVED.has(p.name) ? `${p.name}$` : p.name;

      return [{ name, type }];
    }),
  );
}

function paramType(p: ParamBinding): dts.Type | undefined {
  switch (p.kind) {
    case "number":
      return dts.keyword("number");
    case "bigint":
      return dts.ref("bigint");
    case "boolean":
      return dts.keyword("boolean");
    case "handle":
      return dts.ref(p.handle);
    case "bytes":
      return dts.union([dts.ref("Uint8Array"), dts.ref("ArrayBuffer"), dts.ref("NativeBuffer")]);
    case "string":
      return dts.keyword("string");
    case "callback":
      return {
        k: "fn",
        params: p.params.map((v, i) => ({ name: `arg${i}`, type: callbackType(v) })),
        ret: p.result.kind === "void" ? dts.keyword("void") : callbackType(p.result),
      };
    case "signal":
      return SIGNAL;
    case "length":
    case "error":
    case "context":
      return undefined;
  }
}

function callbackType(v: CallbackValue): dts.Type {
  switch (v.kind) {
    case "number":
      return dts.keyword("number");
    case "bigint":
      return dts.ref("bigint");
    case "boolean":
      return dts.keyword("boolean");
    case "string":
      return dts.keyword("string");
  }
}

function result(r: ResultBinding): dts.Type {
  switch (r.kind) {
    case "void":
      return dts.keyword("void");
    case "number":
      return dts.keyword("number");
    case "bigint":
      return dts.ref("bigint");
    case "boolean":
      return dts.keyword("boolean");
    case "handle":
      return dts.ref(r.handle);
  }
}
