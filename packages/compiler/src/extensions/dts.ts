/**
 * The declarations Lucent code imports from `lucent:ext/<name>`: each
 * handle as a class (its create is the constructor, its methods take the
 * handle as `this`, and close() destroys it), and every bound function
 * under its C name.
 */
import { ts as dts } from "@lucent-lang/codegen";
import type { ExtensionBinding, FunctionBinding, ParamBinding, ResultBinding } from "./bind.ts";
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

  const text = dts.printUnit({
    banner: `lucent:ext/${ext.name}: ${ext.package}'s native extension (generated from its header and lucent.json)`,
    decls: [...handles, ...functions],
  });

  return ext.skipped.length
    ? `${text}\n// Not bound:\n${ext.skipped.map((s) => `//   ${s}`).join("\n")}\n`
    : text;
}

/** What Lucent code passes: lengths and errors are the binding's. */
function params(f: FunctionBinding): dts.Param[] {
  return f.params.flatMap((p, i) => {
    const type = paramType(p);
    if (!type) return [];

    // Unnamed, or a TypeScript keyword (`new`): a name no C parameter has (C names cannot end in `$`).
    const name = !p.name ? `arg${i}$` : TS_RESERVED.has(p.name) ? `${p.name}$` : p.name;

    return [{ name, type }];
  });
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
      return dts.ref("Uint8Array");
    case "string":
      return dts.keyword("string");
    case "length":
    case "error":
      return undefined;
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
