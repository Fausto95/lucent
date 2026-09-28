/**
 * Native extensions, bound: a package's declaration checked against the C
 * header clang reads, into what the declarations and the emitter use.
 *
 * The header gives signatures; the declaration says what C cannot: which
 * struct is a handle and which functions make and destroy it, what each
 * pointer parameter is, how a result reports failure, and the thread a
 * call needs. Every name and shape the declaration uses is checked. A
 * header function the declaration does not mention is bound when its
 * signature needs no declaration, and listed as skipped otherwise.
 */
import path from "node:path";
import {
  type CFunction,
  type CHeader,
  cLinkage,
  type CRecord,
  type CType,
  extractCHeader,
  formatCType,
} from "@lucent-lang/bindgen";
import type {
  Affinity,
  ErrorDeclaration,
  ExtensionInput,
  FailsWhen,
  FunctionDeclaration,
  ParamDeclaration,
} from "../package-config.ts";
import { TS_RESERVED } from "./names.ts";

export interface ExtensionBinding {
  /** As `lucent:ext/<name>` imports it. */
  name: string;
  package: string;
  /** How generated code includes the header (`#include "…"`): both builds search its directory. */
  include: string;
  handles: HandleBinding[];
  /** Every function Lucent code can call, in the header's order. */
  functions: FunctionBinding[];
  /** Header functions left out, with why (`name: reason`). */
  skipped: string[];
}

export interface HandleBinding {
  /** The C type name, which is the class Lucent code sees. */
  name: string;
  create: FunctionBinding;
  /** The C function that destroys one. */
  destroy: string;
  methods: { name: string; fn: FunctionBinding }[];
  affinity: Affinity;
}

export interface FunctionBinding {
  name: string;
  /** One per C parameter, in order. */
  params: ParamBinding[];
  result: ResultBinding;
  failsWhen?: FailsWhen;
  /** The thread it needs: its own, or a main-thread handle's. */
  affinity: Affinity;
  blocking: boolean;
}

/**
 * What a C parameter is, and so what Lucent passes for it: nothing for a
 * length (the bytes' length) or an error (filled in by the call).
 */
export type ParamBinding =
  | { kind: "number"; name: string; c: string }
  | { kind: "bigint"; name: string; c: string }
  | { kind: "boolean"; name: string }
  | { kind: "handle"; name: string; handle: string }
  /** `c`: the pointer's C type, which the bytes' data is cast to. */
  | { kind: "bytes"; name: string; access: "read" | "write"; c: string }
  | { kind: "length"; name: string; c: string; of: number }
  | { kind: "string"; name: string }
  | { kind: "error"; name: string; error: ErrorBinding };

export type ResultBinding =
  | { kind: "void" }
  | { kind: "number"; c: string }
  | { kind: "bigint"; c: string }
  | { kind: "boolean" }
  | { kind: "handle"; handle: string };

export interface ErrorBinding {
  /** The struct's C type name. */
  type: string;
  code?: string;
  message: string;
  release?: string;
}

/** A shape Lucent cannot bind: the reason, and the declaration field it is about. */
class Refused extends Error {
  readonly field: string | undefined;

  constructor(message: string, field?: string) {
    super(message);
    this.field = field;
  }
}

/** A header as C and as C++ read it. */
interface Read {
  header: CHeader;
  cxx: ReturnType<typeof cLinkage>;
}

/** Headers read in this process, by where they are and their files' contents: watch rebuilds read a header again once it changes. */
const headers = new Map<string, Read>();

/**
 * Binds every extension. Throws for a declaration its header contradicts,
 * naming the package and the field.
 */
export function bindExtensions(inputs: ExtensionInput[]): ExtensionBinding[] {
  return inputs.map((input) => {
    const at = `extensions.${input.name}`;

    try {
      return bindExtension(input, readHeader(input), at);
    } catch (e) {
      if (!(e instanceof Refused)) throw e;

      throw new Error(
        `${input.package}/lucent.json: ${e.field ? `${at}.${e.field}` : at}: ${e.message}`,
        { cause: e },
      );
    }
  });
}

function readHeader(input: ExtensionInput): Read {
  const key = `${input.header}\0${input.includePaths.join("\0")}\0${input.hash}`;
  const cached = headers.get(key);
  if (cached) return cached;

  const opts = { includePaths: input.includePaths };
  const read = { header: extractCHeader(input.header, opts), cxx: cLinkage(input.header, opts) };
  headers.set(key, read);

  return read;
}

/** Forgets the headers this process read (tests, and watch sessions after a header changes). */
export function forgetExtensionHeaders(): void {
  headers.clear();
}

function bindExtension(input: ExtensionInput, read: Read, at: string): ExtensionBinding {
  const { header, cxx } = read;
  const d = input.declaration;
  const file = path.basename(input.header);

  // Generated code is C++: the header must compile as C++ too.
  if (!cxx.ok) fail("header", `${file} does not compile as C++: ${cxx.error}`);

  const byName = new Map(header.functions.map((f) => [f.name, f]));

  const fn = (name: string, field: string): CFunction =>
    byName.get(name) ?? fail(field, `${file} declares no function ${name}`);

  for (const name of Object.keys(d.functions ?? {})) fn(name, `functions.${name}`);

  // Handles: opaque structs, with a create, a destroy and methods that take and give them.
  const handles = new Map<string, { record: CRecord; affinity: Affinity; create: string }>();

  for (const [name, h] of Object.entries(d.handles ?? {})) {
    const record = header.records.find((r) => r.name === name || r.aliases.includes(name));

    if (!record) fail(`handles.${name}`, `${file} declares no struct ${name}`);
    if (record.complete)
      fail(
        `handles.${name}`,
        `${name} is defined in ${file}; a handle's struct must be opaque (declared, not defined), so Lucent never reads its fields`,
      );

    handles.set(name, { record, affinity: h.affinity ?? "any", create: h.create });
  }

  const handleOf = (t: CType) =>
    t.k === "pointer" && t.to.k === "record"
      ? [...handles].find(([, h]) => h.record.name === (t.to as { name: string }).name)?.[0]
      : undefined;

  for (const [name, h] of Object.entries(d.handles ?? {})) {
    const field = `handles.${name}`;
    const type = `${name} *`;

    const made = fn(h.create, `${field}.create`).result;
    if (handleOf(made) !== name) fail(`${field}.create`, `${h.create} must return ${type}`);
    if (made.k === "pointer" && made.const)
      fail(
        `${field}.create`,
        `${h.create} returns ${formatCType(made)}; a handle's create must return ${type}`,
      );

    const destroy = fn(h.destroy, `${field}.destroy`);
    const destroys =
      destroy.result.k === "void" &&
      destroy.params.length === 1 &&
      handleOf(destroy.params[0]!.type) === name;
    if (!destroys) fail(`${field}.destroy`, `${h.destroy} must be void ${h.destroy}(${type})`);

    for (const [method, c] of Object.entries(h.methods ?? {})) {
      const at = `${field}.methods.${method}`;

      if (method === "close" || method === "constructor")
        fail(at, `${method} is the handle's own method`);
      if (!/^[A-Za-z_$][\w$]*$/.test(method)) fail(at, `${method} is not a method name`);

      const f = fn(c, at);
      if (!f.params.length || handleOf(f.params[0]!.type) !== name)
        fail(at, `${c} must take ${type} first`);
    }
  }

  const errors = d.errors ?? {};
  const destroys = new Set(Object.values(d.handles ?? {}).map((h) => h.destroy));
  const releases = new Set(Object.values(errors).flatMap((e) => (e.release ? [e.release] : [])));

  // Lucent code never calls a destroy or a release itself: close() and the binding do, once.
  for (const [name, h] of Object.entries(d.handles ?? {}))
    for (const [method, c] of Object.entries(h.methods ?? {})) {
      const why = destroys.has(c)
        ? "destroys a handle: close() calls it"
        : releases.has(c)
          ? "releases an error: the binding calls it"
          : undefined;
      if (why) fail(`handles.${name}.methods.${method}`, `${c} ${why}`);
    }

  const errorOf = (name: string, field: string) =>
    errors[name]
      ? bindError(name, errors[name], header, fn, `errors.${name}`)
      : fail(field, `${at}.errors does not declare ${name}`);

  const scope: Scope = { handleOf, errorOf, handles };

  const hidden = new Set([...destroys, ...releases]);
  const declared = (name: string) => !!d.functions?.[name] || usedByHandle(d, name);

  const bound = new Map<string, FunctionBinding>();
  const skipped: string[] = [];

  for (const f of header.functions) {
    if (hidden.has(f.name)) continue;

    if (TS_RESERVED.has(f.name)) {
      if (declared(f.name))
        fail(
          `functions.${f.name}`,
          `${f.name} is a TypeScript keyword, which Lucent code cannot call`,
        );

      skipped.push(`${f.name}: its name is a TypeScript keyword`);
      continue;
    }

    try {
      const binding = bindFunction(f, d.functions?.[f.name] ?? {}, scope, `functions.${f.name}`);

      // Whether a function keeps or frees a handle it is given, only its package can say.
      const handle = f.params.find((p) => handleOf(p.type))?.type;
      if (handle && !declared(f.name)) {
        skipped.push(
          `${f.name}: it takes a handle (${formatCType(handle)}): name it in functions or as a method, so Lucent knows it neither keeps nor frees it`,
        );
        continue;
      }

      bound.set(f.name, binding);
    } catch (e) {
      // A function the declaration names must bind; any other is left out, with the reason.
      if (!(e instanceof Refused) || declared(f.name)) throw e;

      skipped.push(`${f.name}: ${e.message}`);
    }
  }

  // Called from C++: every function it uses must have C linkage there.
  const used = new Set([...bound.keys(), ...hidden]);
  const unlinked = header.functions.find(
    (f) => used.has(f.name) && !cxx.functions.includes(f.name),
  );
  if (unlinked)
    fail(
      "header",
      `${file} declares ${unlinked.name} without C linkage when C++ includes it: wrap its declarations in #ifdef __cplusplus extern "C" { … } #endif`,
    );

  return {
    name: input.name,
    package: input.package,
    include: input.include,
    handles: Object.entries(d.handles ?? {}).map(([name, h]) => ({
      name,
      create: bound.get(h.create)!,
      destroy: h.destroy,
      methods: Object.entries(h.methods ?? {}).map(([method, c]) => ({
        name: method,
        fn: bound.get(c)!,
      })),
      affinity: h.affinity ?? "any",
    })),
    functions: [...bound.values()],
    skipped,
  };
}

const usedByHandle = (d: ExtensionInput["declaration"], name: string) =>
  Object.values(d.handles ?? {}).some(
    (h) => h.create === name || Object.values(h.methods ?? {}).includes(name),
  );

function fail(field: string | undefined, message: string): never {
  throw new Refused(message, field);
}

interface Scope {
  handleOf(t: CType): string | undefined;
  errorOf(name: string, field: string): { record: string; binding: ErrorBinding };
  handles: Map<string, { affinity: Affinity; create: string }>;
}

function bindFunction(
  f: CFunction,
  d: FunctionDeclaration,
  scope: Scope,
  field: string,
): FunctionBinding {
  if (f.variadic) fail(field, `${f.name} takes variable arguments, which Lucent cannot pass`);

  const declared = d.params ?? {};
  const index = new Map(f.params.map((p, i) => [p.name, i]));

  for (const name of Object.keys(declared))
    if (!index.has(name)) fail(`${field}.params.${name}`, `${f.name} has no parameter ${name}`);

  // Lengths first: the bytes they measure name them.
  const lengths = new Map<number, number>();

  for (const [name, p] of Object.entries(declared)) {
    if (!("bytes" in p)) continue;

    const at = `${field}.params.${name}.length`;
    const i = index.get(p.length) ?? fail(at, `${f.name} has no parameter ${p.length}`);
    const length = f.params[i]!;

    if (length.type.k !== "int")
      fail(at, `${p.length} is ${formatCType(length.type)}, not an integer`);
    if (declared[p.length] || lengths.has(i))
      fail(at, `${p.length} is already declared as something else`);

    lengths.set(i, index.get(name)!);
  }

  const params = f.params.map((p, i): ParamBinding => {
    const of = lengths.get(i);
    if (of !== undefined)
      return { kind: "length", name: p.name, c: (p.type as { name: string }).name, of };

    return bindParam(p.name, p.type, declared[p.name], scope, `${field}.params.${p.name}`, field);
  });

  const result = bindResult(f, d.failsWhen, scope, `${field}.failsWhen`);

  // The struct is read when the result says the call failed: without failsWhen, never.
  const error = params.find((p) => p.kind === "error");
  if (error && !d.failsWhen)
    fail(
      field,
      `${error.name} fills in ${error.error.type} when the call fails: declare failsWhen, how its result says so`,
    );

  // A main-thread handle's functions run on the main thread too.
  const main =
    d.affinity === "main" ||
    params.some((p) => p.kind === "handle" && scope.handles.get(p.handle)?.affinity === "main") ||
    (result.kind === "handle" && scope.handles.get(result.handle)?.affinity === "main");

  return {
    name: f.name,
    params,
    result,
    ...(d.failsWhen ? { failsWhen: d.failsWhen } : {}),
    affinity: main ? "main" : "any",
    blocking: !!d.blocking,
  };
}

function bindParam(
  name: string,
  t: CType,
  d: ParamDeclaration | undefined,
  scope: Scope,
  field: string,
  fnField: string,
): ParamBinding {
  if (d && "bytes" in d) {
    const byte = t.k === "pointer" && (t.to.k === "void" || (t.to.k === "int" && t.to.bits === 8));
    if (!byte)
      fail(field, `bytes must be a pointer to 8-bit integers or void, not ${formatCType(t)}`);
    if (d.bytes === "write" && (t as { const: boolean }).const)
      fail(field, `bytes written through a const pointer (${formatCType(t)})`);

    return { kind: "bytes", name, access: d.bytes, c: formatCType(t) };
  }

  if (d && "string" in d) {
    if (!(t.k === "pointer" && t.const && t.to.k === "int" && t.to.name === "char"))
      fail(field, `a string parameter must be const char *, not ${formatCType(t)}`);

    return { kind: "string", name };
  }

  if (d && "error" in d) {
    if (!(t.k === "pointer" && !t.const && t.to.k === "record"))
      fail(field, `an error parameter must point to ${d.error}, not ${formatCType(t)}`);

    const error = scope.errorOf(d.error, field);
    if (t.to.name !== error.record)
      fail(field, `an error parameter must point to ${d.error}, not ${formatCType(t)}`);

    return { kind: "error", name, error: error.binding };
  }

  const handle = scope.handleOf(t);
  if (handle) return { kind: "handle", name, handle };

  const scalar = scalarOf(t);
  if (scalar) return { ...scalar, name } as ParamBinding;

  if (t.k === "function")
    fail(fnField, `parameter ${name} is a function pointer; extensions cannot take callbacks yet`);
  if (t.k === "pointer")
    fail(
      fnField,
      `parameter ${name} is a pointer (${formatCType(t)}): declare it in params as bytes, a string or an error`,
    );

  return fail(fnField, `parameter ${name} is ${formatCType(t)}, which Lucent cannot pass`);
}

/** A number, bigint or boolean parameter or result: integers wider than 32 bits are bigints. */
function scalarOf(
  t: CType,
): { kind: "number" | "bigint"; c: string } | { kind: "boolean" } | undefined {
  if (t.k === "bool") return { kind: "boolean" };
  if (t.k === "float") return { kind: "number", c: t.name };
  if (t.k === "int") return { kind: t.bits === 64 ? "bigint" : "number", c: t.name };

  return undefined;
}

function bindResult(
  f: CFunction,
  failsWhen: FailsWhen | undefined,
  scope: Scope,
  field: string,
): ResultBinding {
  const t = f.result;
  const returns = `${f.name} returns ${formatCType(t)}`;
  const needs = (what: string, ok: boolean) => {
    if (!ok) fail(field, `${failsWhen} needs ${what}; ${returns}`);
  };

  if (failsWhen === "null") needs("a pointer result", t.k === "pointer");
  // char is signed on some targets and not on others (Android on ARM).
  if (failsWhen === "negative")
    needs(
      t.k === "int" ? "a signed result" : "an integer result",
      t.k === "int" && t.signed && t.name !== "char",
    );
  if (failsWhen === "nonzero" || failsWhen === "zero") needs("an integer result", t.k === "int");
  if (failsWhen === "false") needs("a bool result", t.k === "bool");

  // A status: the call's value is whether it failed, which throws.
  if (t.k === "void" || failsWhen === "nonzero" || failsWhen === "false") return { kind: "void" };

  const fnField = field.replace(/\.failsWhen$/, "");
  const handle = scope.handleOf(t);

  if (handle) {
    // Who owns another pointer to a handle is unknown: only its create gives one Lucent owns.
    if (scope.handles.get(handle)!.create !== f.name)
      fail(fnField, `${returns}; only ${handle}'s create gives a handle Lucent owns`);
    if (failsWhen !== "null") fail(fnField, `${f.name} makes a ${handle}: declare failsWhen null`);

    return { kind: "handle", handle };
  }

  const scalar = scalarOf(t);
  if (scalar) return scalar;

  return fail(fnField, `${returns}, which Lucent cannot take`);
}

function bindError(
  name: string,
  d: ErrorDeclaration,
  header: CHeader,
  fn: (name: string, field: string) => CFunction,
  field: string,
): { record: string; binding: ErrorBinding } {
  const record = header.records.find((r) => r.name === name || r.aliases.includes(name));

  if (!record?.complete)
    fail(field, `${name} must be a struct the header defines, with its fields`);

  const member = (f: string, at: string) =>
    record.fields.find((x) => x.name === f) ?? fail(at, `${name} has no field ${f}`);

  const message = member(d.message, `${field}.message`);
  const isString =
    message.type.k === "pointer" && message.type.to.k === "int" && message.type.to.name === "char";
  if (!isString)
    fail(
      `${field}.message`,
      `${name}.${d.message} is ${formatCType(message.type)}, not const char *`,
    );

  if (d.code) {
    const code = member(d.code, `${field}.code`);
    if (code.type.k !== "int")
      fail(`${field}.code`, `${name}.${d.code} is ${formatCType(code.type)}, not an integer`);
  }

  if (d.release) {
    const release = fn(d.release, `${field}.release`);
    const takes = release.params.length === 1 && release.params[0]!.type;
    if (
      release.result.k !== "void" ||
      !takes ||
      takes.k !== "pointer" ||
      takes.to.k !== "record" ||
      takes.to.name !== record.name
    )
      fail(`${field}.release`, `${d.release} must be void ${d.release}(${name} *)`);
  }

  const binding: ErrorBinding = {
    type: name,
    ...(d.code ? { code: d.code } : {}),
    message: d.message,
    ...(d.release ? { release: d.release } : {}),
  };

  return { record: record.name, binding };
}
