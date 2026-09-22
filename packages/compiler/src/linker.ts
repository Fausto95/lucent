import { validateLibrary } from "./library-validation.ts";
/** Pure source graph linker. Dependencies are supplied as data by the integration. */
import { UI_PRIMITIVES } from "./ui.ts";
import { STANDARD_LIBRARIES, type LibraryModule, type NativeViewBinding } from "./libraries.ts";
import { diagnostic, type Diagnostic } from "./diagnostics/index.ts";
import { parseModule, LUCENT_TYPES_MODULE, type ParseResult } from "./parser/index.ts";
import type { Expr, Stmt, SurfaceModule, SurfaceType } from "./parser/surface.ts";

export function normalizeModulePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.replaceAll("\\", "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === ".." && parts.length && parts.at(-1) !== "..") parts.pop();
    else if (part !== ".." || !path.startsWith("/")) parts.push(part);
  }
  return (path.startsWith("/") ? "/" : "") + parts.join("/");
}

export function moduleCandidates(from: string, specifier: string): string[] {
  if (specifier.startsWith("@lucent-lang/")) return [specifier];
  const path = normalizeModulePath(from.replace(/[^/]*$/, "") + specifier);
  return /\.tsx?$/.test(path) ? [path] : [path + ".ts", path + ".tsx"];
}

export function linkModule(
  source: string,
  fileName: string,
  sources: Readonly<Record<string, string>>,
  additional: Readonly<Record<string, LibraryModule>> = {},
): ParseResult {
  const root = normalizeModulePath(fileName);
  const texts = new Map(Object.entries(sources).map(([path, text]) => [normalizeModulePath(path), text]));
  const libraries = { ...STANDARD_LIBRARIES, ...additional };
  const invalid = Object.entries(libraries).flatMap(([name, library]) =>
    validateLibrary(library).map((message) => diagnostic("LC1006", { start: 0, end: 0 }, `${name}: ${message}`)),
  );
  if (invalid.length)
    return { module: { fileName, imports: [], functions: [], typeAliases: [] }, diagnostics: invalid };
  for (const [name, library] of Object.entries(libraries)) texts.set(name, library.source);
  texts.set(root, source);
  const diagnostics: Diagnostic[] = [];
  const modules = new Map<string, SurfaceModule>();
  const viewBindings: Record<string, NativeViewBinding> = {};
  const overloads: Record<string, string[]> = {};
  const active = new Set<string>();
  const names = new Map<string, Map<string, string>>();
  const typeNames = new Map<string, Map<string, string>>();
  const visit = (path: string): void => {
    if (modules.has(path)) return;
    if (active.has(path)) {
      diagnostics.push(diagnostic("LC1006", { start: 0, end: 0 }, `Import cycle: ${[...active, path].join(" → ")}`));
      return;
    }
    active.add(path);
    const parsed = parseModule(texts.get(path)!, path);
    if (path !== root) annotateOrigins(parsed, { fileName: path, source: texts.get(path)! });
    diagnostics.push(...parsed.diagnostics);
    const module = parsed.module;
    for (const [name, enumeration] of Object.entries(libraries[path]?.enums ?? {})) {
      const alias = module.typeAliases.find((t) => t.name === name);
      const literals =
        alias?.type.kind === "union" && alias.type.members.every((m) => m.kind === "literal")
          ? alias.type.members.map((m) => (m.kind === "literal" ? m.value : ""))
          : null;
      if (!literals || literals.join("\u0000") !== enumeration.cases.join("\u0000")) {
        diagnostics.push(
          diagnostic(
            "LC1006",
            { start: 0, end: 0 },
            `Native enum ${name} requires a string-literal union declaring exactly its cases, in order.`,
          ),
        );
        continue;
      }
      if (alias) alias.enumeration = { name, binding: enumeration };
    }
    for (const [name, native] of Object.entries(libraries[path]?.references ?? {})) {
      const alias = module.typeAliases.find((t) => t.name === name);
      if (!alias || alias.type.kind !== "object" || !module.functions.some((f) => f.name === `${name}__create`)) {
        diagnostics.push(
          diagnostic(
            "LC1006",
            { start: 0, end: 0 },
            `Native reference ${name} requires a record declaration and constructor binding.`,
          ),
        );
        continue;
      }
      alias.reference = { publicName: name, exported: alias.exported, native };
      for (const fn of module.functions) {
        const operation = fn.name.slice(name.length);
        if (!fn.name.startsWith(name + "__")) continue;
        const kinds = { create: "constructor", get: "get", set: "set", method: "method" } as const;
        const match = /^__(create)$|^__(get|set|method)_(.+)$/.exec(operation);
        if (!match) continue;
        const kind = kinds[(match[1] ?? match[2]) as keyof typeof kinds];
        fn.classOp = { className: name, member: match[3] ?? "constructor", kind };
      }
    }
    for (const fn of module.functions) {
      const binding = libraries[path]?.bindings?.[fn.name];
      if (binding) {
        for (const name of Object.keys(binding.contract?.parameters ?? {}))
          if (!fn.params.some((p) => p.name === name))
            diagnostics.push(diagnostic("LC1006", fn.span, `Unknown native contract parameter ${name} in ${fn.name}.`));
        fn.binding = binding;
        if (fn.ambient && fn.returnType?.kind === "reference" && fn.returnType.name === "Promise") fn.async = true;
        if (binding.thread) fn.thread = binding.thread;
      }
    }
    const prefix = path === root ? "" : "lucentInternal_" + moduleId(path) + "_";
    const values = new Map(
      module.functions.map((fn) => [fn.name, (fn.event ? "__event_" + moduleId(path) + "_" : prefix) + fn.name]),
    );
    const types = new Map(
      module.typeAliases.map((t) => [
        t.name,
        (t.reference ? "lucentInternal_" + moduleId(path) + "_" : prefix) + t.name,
      ]),
    );
    for (const fn of module.functions)
      if (fn.classOp)
        values.set(fn.name, types.get(fn.classOp.className)! + fn.name.slice(fn.classOp.className.length));
    const groups = new Map<string, string[]>();
    for (const fn of module.functions)
      if (fn.binding?.overload) {
        const group = fn.binding.overload;
        const list = groups.get(group) ?? [];
        list.push(fn.name);
        groups.set(group, list);
      }
    for (const [group, candidates] of groups) {
      const owner = [...types.keys()].find((name) => group.startsWith(name + "__"));
      const renamed = owner ? types.get(owner)! + group.slice(owner.length) : prefix + group;
      values.set(group, renamed);
      overloads[renamed] = candidates.map((name) => values.get(name)!);
    }
    names.set(path, values);
    typeNames.set(path, types);
    for (const imp of module.imports) {
      if (imp.source === LUCENT_TYPES_MODULE) continue;
      if (imp.source === "@lucent-lang/objects") {
        for (const b of imp.bindings ?? [])
          if (b.imported !== "SharedObject" || b.typeOnly)
            diagnostics.push(
              diagnostic("LC1006", imp.span, "Only SharedObject may be imported from @lucent-lang/objects."),
            );
        continue;
      }
      if (imp.source === "@lucent-lang/events") {
        for (const b of imp.bindings ?? []) {
          if (b.imported === "Event" && b.typeOnly) types.set(b.local, "Event");
          else if (b.imported !== "event" || b.typeOnly)
            diagnostics.push(diagnostic("LC1006", imp.span, `Unknown event import ${b.imported}`));
        }
        continue;
      }
      if (imp.source === "@lucent-lang/ui") {
        for (const binding of imp.bindings ?? []) {
          if ((binding.imported === "NativeView" || binding.imported === "NativeProps") && binding.typeOnly)
            types.set(binding.local, binding.imported);
          else if (UI_PRIMITIVES[binding.imported] && !binding.typeOnly)
            values.set(binding.local, `__ui_${binding.imported}`);
          else diagnostics.push(diagnostic("LC1006", imp.span, `Unknown UI import ${binding.imported}`));
        }
        continue;
      }
      const candidates = moduleCandidates(path, imp.source).filter((p) => texts.has(p));
      if (candidates.length !== 1) {
        diagnostics.push(
          diagnostic(
            "LC1006",
            imp.span,
            `${candidates.length ? "Ambiguous" : "Missing"} Lucent import ${imp.source} in ${path}.`,
          ),
        );
        continue;
      }
      const target = candidates[0]!;
      visit(target);
      const dependency = modules.get(target);
      if (!dependency) continue;
      for (const binding of imp.bindings ?? []) {
        const view = libraries[target]?.views?.[binding.imported];
        if (view && !binding.typeOnly) {
          const name = `__package_${moduleId(target)}_${binding.imported}`;
          for (const language of ["swift", "kotlin"] as const) {
            const descriptor = view[language];
            if (!descriptor || typeof descriptor.template !== "string") {
              diagnostics.push(diagnostic("LC1006", imp.span, `Missing ${language} template for ${binding.imported}.`));
              continue;
            }
            for (const match of descriptor.template.matchAll(/{{([^}]+)}}/g)) {
              const token = match[1]!;
              if (token === "children" && view.children !== "none") continue;
              const prop = token.startsWith("prop:") ? token.slice(5) : "";
              if (
                !view.props[prop] ||
                (!(view.required ?? []).includes(prop) && descriptor.defaults?.[prop] === undefined)
              )
                diagnostics.push(
                  diagnostic("LC1006", imp.span, `Invalid or missing default for ${language} template token ${token}.`),
                );
            }
          }
          viewBindings[name] = view;
          values.set(binding.local, name);
          continue;
        }
        if (dependency.functions.some((f) => f.binding?.overload === binding.imported) && !binding.typeOnly) {
          values.set(binding.local, names.get(target)!.get(binding.imported)!);
          continue;
        }
        const fn = dependency.functions.find((f) => f.name === binding.imported && f.exported);
        const type = dependency.typeAliases.find((t) => t.name === binding.imported && t.exported);
        const scope = type ? types : values;
        if ((!fn && !type) || scope.has(binding.local) || (fn && binding.typeOnly)) {
          diagnostics.push(
            diagnostic(
              "LC1006",
              imp.span,
              `Invalid or duplicate import ${binding.local} from ${imp.source}. Only exported declarations may be imported.`,
            ),
          );
        } else {
          scope.set(binding.local, (type ? typeNames : names).get(target)!.get(binding.imported)!);
          if (type?.reference && !binding.typeOnly)
            values.set(`${binding.local}__create`, names.get(target)!.get(`${binding.imported}__create`)!);
        }
      }
    }
    active.delete(path);
    modules.set(path, module);
  };
  visit(root);
  const original = modules.get(root)!;
  if (diagnostics.length) return { module: original, diagnostics };
  const result: SurfaceModule = { fileName, imports: [], functions: [], typeAliases: [] };
  for (const [path, module] of modules) {
    const values = names.get(path)!;
    const types = typeNames.get(path)!;
    result.imports.push(...module.imports.filter((i) => i.source === LUCENT_TYPES_MODULE));
    for (const alias of module.typeAliases) {
      result.typeAliases.push({
        ...alias,
        name: types.get(alias.name)!,
        type: renameType(alias.type, types),
        ...(alias.reference
          ? { reference: { ...alias.reference, exported: path === root && alias.reference.exported } }
          : {}),
        exported: alias.exported || path !== root,
      });
    }
    for (const fn of module.functions) {
      result.functions.push({
        ...fn,
        name: values.get(fn.name)!,
        ...(fn.classOp ? { classOp: { ...fn.classOp, className: types.get(fn.classOp.className)! } } : {}),
        exported: !fn.binding?.nativeOnly && (!!fn.classOp || (!fn.event && path === root && fn.exported)),
        ...(fn.event
          ? { event: { ...fn.event, id: values.get(fn.name)!, exported: path === root && fn.event.exported } }
          : {}),
        params: fn.params.map((p) => ({ ...p, type: p.type ? renameType(p.type, types) : null })),
        returnType: fn.returnType ? renameType(fn.returnType, types) : null,
        body: renameBlock(fn.body, values, types, new Set(fn.params.map((p) => p.name))),
      });
    }
  }
  const nativePackages = Object.fromEntries(
    [...modules.keys()]
      .filter((path) => libraries[path]?.native)
      .map((path) => [moduleId(path), libraries[path]!.native!]),
  );
  if (Object.keys(nativePackages).length) result.nativePackages = nativePackages;
  if (Object.keys(overloads).length) result.overloads = overloads;
  if (Object.keys(viewBindings).length) result.views = viewBindings;
  return { module: result, diagnostics };
}

function renameType(type: SurfaceType, names: Map<string, string>): SurfaceType {
  if (type.kind === "function")
    return {
      ...type,
      params: type.params.map((p) => ({ ...p, type: p.type ? renameType(p.type, names) : null })),
      returnType: renameType(type.returnType, names),
    };
  if (type.kind === "reference")
    return { ...type, name: names.get(type.name) ?? type.name, args: type.args.map((t) => renameType(t, names)) };
  if (type.kind === "array") return { ...type, element: renameType(type.element, names) };
  if (type.kind === "union") return { ...type, members: type.members.map((t) => renameType(t, names)) };
  if (type.kind === "object")
    return { ...type, fields: type.fields.map((f) => ({ ...f, type: renameType(f.type, names) })) };
  return type;
}

function renameExpr(
  expr: Expr,
  values: Map<string, string>,
  locals: Set<string>,
  types = new Map<string, string>(),
): Expr {
  if (expr.kind === "closure") {
    const captured = new Set([...locals, ...expr.params.map((p) => p.name)]);
    return {
      ...expr,
      params: expr.params.map((p) => ({ ...p, type: p.type ? renameType(p.type, types) : null })),
      returnType: expr.returnType ? renameType(expr.returnType, types) : null,
      body: Array.isArray(expr.body)
        ? renameBlock(expr.body, values, types, captured)
        : renameExpr(expr.body, values, captured, types),
    };
  }
  // Expressions contain only expression children and scalar metadata. Rename symbol uses,
  // never member names, object keys, or lexical bindings.
  const result = { ...expr } as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(result)) {
    if (key === "span") continue;
    if (Array.isArray(value))
      result[key] = value.map((v) =>
        v && typeof v === "object" && "kind" in v
          ? renameExpr(v as Expr, values, locals, types)
          : v && typeof v === "object" && "value" in v
            ? { ...v, value: renameExpr(v.value as Expr, values, locals, types) }
            : v,
      );
    else if (value && typeof value === "object" && "kind" in value)
      result[key] = renameExpr(value as Expr, values, locals, types);
  }
  if (
    expr.kind === "methodCall" &&
    expr.method === "emit" &&
    expr.object.kind === "identifier" &&
    !locals.has(expr.object.name) &&
    values.get(expr.object.name)?.startsWith("__event_")
  )
    return { kind: "call", callee: values.get(expr.object.name)!, args: result.args as Expr[], span: expr.span };
  if (expr.kind === "identifier" && !locals.has(expr.name)) result.name = values.get(expr.name) ?? expr.name;
  if (expr.kind === "view") result.name = values.get(expr.name) ?? expr.name;
  if (expr.kind === "call" && !locals.has(expr.callee)) result.callee = values.get(expr.callee) ?? expr.callee;
  return result as unknown as Expr;
}

function renameBlock(
  stmts: Stmt[],
  values: Map<string, string>,
  types: Map<string, string>,
  outer: Set<string>,
): Stmt[] {
  const locals = new Set(outer);
  return stmts.map((stmt) => {
    const expr = (e: Expr) => renameExpr(e, values, locals, types);
    const block = (s: Stmt[]) => renameBlock(s, values, types, locals);
    switch (stmt.kind) {
      case "variable": {
        const init = stmt.init ? expr(stmt.init) : null;
        locals.add(stmt.name);
        return { ...stmt, type: stmt.type ? renameType(stmt.type, types) : null, init };
      }
      case "if":
        return {
          ...stmt,
          test: expr(stmt.test),
          consequent: block(stmt.consequent),
          alternate: stmt.alternate ? block(stmt.alternate) : null,
        };
      case "while":
        return { ...stmt, test: expr(stmt.test), body: block(stmt.body) };
      case "forOf":
        return {
          ...stmt,
          iterable: expr(stmt.iterable),
          body: renameBlock(stmt.body, values, types, new Set([...locals, stmt.variable])),
        };
      case "for": {
        const nested = new Set(locals);
        if (stmt.init?.kind === "variable") nested.add(stmt.init.name);
        return {
          ...stmt,
          init: stmt.init ? block([stmt.init])[0]! : null,
          test: stmt.test ? renameExpr(stmt.test, values, nested, types) : null,
          update: stmt.update ? renameExpr(stmt.update, values, nested, types) : null,
          body: renameBlock(stmt.body, values, types, nested),
        };
      }
      case "block":
        return { ...stmt, body: block(stmt.body) };
      case "return":
        return { ...stmt, argument: stmt.argument ? expr(stmt.argument) : null };
      case "throw":
        return {
          ...stmt,
          message: stmt.message ? expr(stmt.message) : null,
          ...(stmt.metadata ? { metadata: stmt.metadata.map((f) => ({ name: f.name, value: expr(f.value) })) } : {}),
        };
      case "expression":
        return { ...stmt, expression: expr(stmt.expression) };
      default:
        return stmt;
    }
  });
}

function moduleId(path: string): string {
  let hash = 14695981039346656037n;
  for (const c of path) hash = BigInt.asUintN(64, (hash ^ BigInt(c.codePointAt(0)!)) * 1099511628211n);
  return hash.toString(16);
}

/** Attach source identity before linking moves declarations into their importer. */
function annotateOrigins(value: unknown, origin: { fileName: string; source: string }): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((v) => annotateOrigins(v, origin));
    return;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.start === "number" && typeof record.end === "number") {
    record.origin = origin;
    return;
  }
  for (const child of Object.values(record)) annotateOrigins(child, origin);
}
