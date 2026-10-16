/**
 * Widgets in a widget's build (decision 0124).
 *
 * Its body is compiled through the semantic IR as a function of its entry,
 * whose C++ computes, once, each value the body shows (toolkit.ts
 * `widgetJsx`) and returns them encoded, in an array. Its view is SwiftUI,
 * written from the JSX (swiftui.ts `swiftUIWidget`), as a component's body
 * is: WidgetKit draws it once per entry, so nothing in it calls back.
 *
 * Its provider's methods are C functions of its glue (`widgets/<name>.mm`,
 * declared in `widgets/<name>.h` for its Swift), each running the method
 * on its module's actor as an entry point does, and giving the entries it
 * returns as its Swift reads them: each entry's date, and its body's values
 * for it. Its Swift (`widgets/<name>.swift`) has what WidgetKit takes: the
 * entry, a TimelineProvider calling those functions, and the Widget, which
 * the extension's own target names from its `@main` bundle.
 *
 * In the module's namespace, for a widget `Weather` whose body is `Forecast`:
 *
 *   lucent::NativeRef Forecast_widget(Entry entry);   (an NSArray of its values)
 */
import { cpp, swift } from "@lucent-lang/codegen";
import ts from "typescript";
import { Codes, fail } from "../diagnostics.ts";
import { widgetName } from "../os-names.ts";
import { cppIdent, type LType } from "../types.ts";
import type { CppFunction } from "../ir/cpp.ts";
import { bodyOf } from "../ui/toolkit-body.ts";
import type { WidgetBody } from "../ui/widgets.ts";
import type { Ctx } from "./context.ts";
import type { IrUnit } from "./through-ir.ts";

/** A widget whose body and provider this program compiles. */
export interface Widget {
  readonly body: WidgetBody;
  /** Its entry's type. */
  readonly entry: LType;
  /** Its values function's C++ name, in its body's module's namespace. */
  readonly values: string;
  /** Its provider's class, as C++ names it. */
  readonly provider: string;
  /** What its provider's `timeline()` gives, a record of its entries and the date to reload after. */
  readonly timeline: { readonly type: LType; readonly reloadAfter?: { optional: boolean } };
}

/** What a body's values function returns: an NSArray, the values in the order the view reads them. */
export const WIDGET_VALUES: LType = {
  k: "native",
  platform: "ios",
  module: "Foundation",
  name: "NSArray",
};

/** The Swift names of a widget, and its glue's C functions' prefix. */
export function widgetNames(extension: string): {
  widget: string;
  values: string;
  view: string;
  entry: string;
  provider: string;
  call: string;
  c: string;
} {
  const base = `LucentWidget_${widgetName(extension)}`;

  return {
    widget: base,
    values: `${base}_Values`,
    view: `${base}_View`,
    entry: `${base}_Entry`,
    provider: `${base}_Provider`,
    call: `${base}_Call`,
    c: `lucent_widget_${widgetName(extension)}`,
  };
}

/** Registers a widget's body and provider with the program: their types, before any code is emitted. */
export function planWidget(ctx: Ctx, body: WidgetBody): Widget {
  const { checker } = ctx;
  const entry = ctx.reg.lower(checker.getTypeAtLocation(body.entry), body.entry);
  const record = (t: LType) => (t.k === "struct" ? ctx.reg.struct(t.id) : undefined);
  const date = record(entry)?.fields.find((f) => f.name === "date");

  if (date?.type.k !== "date" || date.optional)
    fail(
      body.entry,
      Codes.UnknownExtensionCode,
      `the widget ${body.extension}'s entry is a record with a \`date: Date\`, which Lucent lowers as one: give it a type of its own (\`type Entry = { date: Date; … }\`)`,
    );

  const decl = body.provider.decl;
  const info = ctx.reg.classForDecl(decl);
  if (!info) throw new Error(`the provider ${decl.name?.text} is no class of the program`);

  // What timeline() promises: a record of entries, and the date to reload after.
  const method = checker.getTypeAtLocation(decl).getProperty("timeline")!;
  const signature = checker.getTypeOfSymbolAtLocation(method, decl).getCallSignatures()[0]!;
  const promised = checker.getAwaitedType(checker.getReturnTypeOfSignature(signature))!;
  const type = ctx.reg.lower(promised, decl);
  const reload = record(type)?.fields.find((f) => f.name === "reloadAfter");

  const widget: Widget = {
    body,
    entry,
    values: `${cppIdent(body.name)}_widget`,
    provider: info.cppName,
    timeline: {
      type,
      ...(reload ? { reloadAfter: { optional: reload.optional || reload.type.k === "opt" } } : {}),
    },
  };

  ctx.widgets.set(body.fn, widget);

  return widget;
}

/** The widget `node` is in the body function of, if any. */
export function widgetOf(ctx: Ctx, node: ts.Node): Widget | undefined {
  for (let n: ts.Node | undefined = node; n; n = n.parent) {
    const found = ctx.widgets.get(n);
    if (found) return found;
  }

  return undefined;
}

/** The values function of a widget's body, lowered by `lower`: its declaration and definition. */
export function emitWidget(
  ctx: Ctx,
  widget: Widget,
  lower: (unit: IrUnit) => CppFunction,
): { decls: cpp.Decl[]; defs: cpp.Decl[] } {
  const { body } = widget;
  const ns = cpp.type(body.module.ns);

  // It returns its body, once, as its last statement: checked before any of its code is lowered.
  bodyOf(body.fn, "swiftui", ctx.checker);

  const lowered = lower({
    decl: body.fn,
    id: `${body.module.ns}::${widget.values}`,
    params: [
      { name: "entry", type: widget.entry, cppType: widget.entry, optional: false, rest: false },
    ],
    result: WIDGET_VALUES,
    async: false,
    generic: false,
    opts: { module: body.module, async: false },
    site: body.name,
  });

  ctx.nativeUnit(body.module).include("lucent/platform/swiftui.h");
  ctx.nativeUnit(body.module).include("lucent/platform/ios.h");

  return {
    decls: [cpp.fn(widget.values, lowered.ret, lowered.params)],
    defs: [cpp.fn(widget.values, lowered.ret, lowered.params, lowered.body, { scope: ns })],
  };
}

// --- the provider's glue ---------------------------------------------------------------------

/**
 * The C functions the widget's Swift calls (`widgets/<name>.h`), C for
 * Swift to import: what they give is retained, an entry an NSArray of its
 * date in seconds since 1970 and its body's values, a timeline an NSArray
 * of its entries and the date to reload after (NSNull for none), an error
 * its message.
 */
export function widgetHeader(widget: Widget): string {
  const { body } = widget;
  const { c } = widgetNames(body.extension);
  const done = (what: string) => `void (*done)(void* context, void* ${what}, void* error)`;

  return [
    "// Generated by Lucent. Do not edit.",
    `// The widget ${body.extension}'s provider, ${providerCode(widget)}, as its Swift calls`,
    "// it (decision 0124). What these give is retained: an entry is an NSArray of",
    "// its date, in seconds since 1970, and its body's values; a timeline, an",
    "// NSArray of its entries and the date to reload after (NSNull for none); an",
    "// error, its message, an NSString.",
    "#pragma once",
    "",
    "#ifdef __cplusplus",
    'extern "C" {',
    "#endif",
    "",
    "/// placeholder()'s entry; NULL, with `error` set, when it throws.",
    `void* ${c}_placeholder(void** error);`,
    "/// Calls `done` once, with snapshot()'s entry or its error.",
    `void ${c}_snapshot(void* context, ${done("entry")});`,
    "/// Calls `done` once, with timeline()'s timeline or its error.",
    `void ${c}_timeline(void* context, ${done("timeline")});`,
    "",
    "#ifdef __cplusplus",
    "}",
    "#endif",
    "",
  ].join("\n");
}

const providerCode = (w: Widget) =>
  `${w.body.provider.module.name}#${w.body.provider.decl.name!.text}`;

/**
 * The glue's definitions (`widgets/<name>.mm`, after `includes`): each runs
 * its method on the provider's module's actor as an entry point does,
 * starting module state if none lasts; the provider is made at its first
 * use, and holds module state while the widget's process lives (the
 * process is the widget's alone). `declared` are the program's names,
 * undefined as macros around the code that spells them.
 */
export function widgetGlue(
  ctx: Ctx,
  widget: Widget,
  includes: readonly cpp.Decl[],
  declared: ReadonlySet<string>,
): string {
  const { body } = widget;
  const { c } = widgetNames(body.extension);
  const entry = cpp.printType(ctx.reg.cppType(widget.entry));
  const timeline = cpp.printType(ctx.reg.cppType(widget.timeline.type));
  const provider = `lucent_app::${widget.provider}`;
  const actor = cpp.printExpr(ctx.actorAt(body.provider.module));
  const bodyActor = cpp.printExpr(ctx.actorAt(body.module));
  const values = `lucent_app::${body.module.ns}::${widget.values}`;
  const seconds = (date: string) => `@(${date}->getTime() / 1000)`;
  const reload = widget.timeline.reloadAfter;
  const reloadAfter = !reload
    ? "[NSNull null]"
    : reload.optional
      ? `timeline->reloadAfter.has() ? (id)${seconds("timeline->reloadAfter.get()")} : (id)[NSNull null]`
      : seconds("timeline->reloadAfter");
  // An async method's settling: `give(value)` is the retained object it gives, which may throw.
  const settle = (type: string, give: string[]) => [
    `      [done, context](lucent::entries::Kept&, const ${type}* value, const lucent_error* error) {`,
    "        if (!value) return done(context, nullptr, lucentError(*error));",
    "        id out = nil;",
    "        try {",
    ...give.map((line) => `          ${line}`),
    "        } catch (...) {",
    "          lucent::entries::Kept kept;",
    "          return done(context, nullptr, lucentError(lucent::entries::errorOf(kept, lucent::entries::caught(std::current_exception()))));",
    "        }",
    "        done(context, (__bridge_retained void*)out, nullptr);",
    "      });",
  ];

  const code = [
    "namespace {",
    "",
    "/// The provider: made at its first use, holding module state while the process lives.",
    `lucent::Ref<${provider}> lucentProvider() {`,
    "  static lucent::ModuleStateHold* hold = new lucent::ModuleStateHold();",
    `  static lucent::Ref<${provider}>* provider = new lucent::Ref<${provider}>(${provider}::create());`,
    "  (void)hold;",
    "  return *provider;",
    "}",
    "",
    "/// An entry as the widget's Swift reads it: its date, and its body's values.",
    `id lucentEntry(const ${entry}& entry) {`,
    // The body's module shares the provider's actor, being its package's; else it is entered.
    ...(bodyActor === actor ? [] : [`  lucent::LucentScope scope(${bodyActor});`]),
    `  id values = lucent::objc::unwrap(${values}(entry));`,
    `  return @[ ${seconds("entry->date")}, values ];`,
    "}",
    "",
    "/// What a failure gives the Swift: its message, retained.",
    "void* lucentError(const lucent_error& error) {",
    "  NSString* message = [[NSString alloc] initWithBytes:error.message.data length:error.message.length encoding:NSUTF8StringEncoding];",
    '  return (__bridge_retained void*)(message ?: @"");',
    "}",
    "",
    "}  // namespace",
    "",
    `extern "C" void* ${c}_placeholder(void** error) {`,
    "  id out = nil;",
    "  lucent_error failed{};",
    `  if (!lucent::entries::call(&lucent_app::initModules, ${actor}, &failed, [&](lucent::entries::Kept&) {`,
    "        out = lucentEntry(lucentProvider()->placeholder());",
    "      })) {",
    "    if (error) *error = lucentError(failed);",
    "    return nullptr;",
    "  }",
    "  return (__bridge_retained void*)out;",
    "}",
    "",
    `extern "C" void ${c}_snapshot(void* context, void (*done)(void* context, void* entry, void* error)) {`,
    `  lucent::entries::callAsync<${entry}>(`,
    `      &lucent_app::initModules, ${actor},`,
    "      [&] { return lucentProvider()->snapshot(); },",
    ...settle(entry, ["out = lucentEntry(*value);"]),
    "}",
    "",
    `extern "C" void ${c}_timeline(void* context, void (*done)(void* context, void* timeline, void* error)) {`,
    `  lucent::entries::callAsync<${timeline}>(`,
    `      &lucent_app::initModules, ${actor},`,
    "      [&] { return lucentProvider()->timeline(); },",
    ...settle(timeline, [
      "const auto& timeline = *value;",
      "NSMutableArray* entries = [NSMutableArray arrayWithCapacity:timeline->entries.size()];",
      "for (std::size_t i = 0; i < timeline->entries.size(); i++) [entries addObject:lucentEntry(timeline->entries.at(i))];",
      `out = @[ entries, ${reloadAfter} ];`,
    ]),
    "}",
  ].join("\n");

  // The program's names the code spells (a field named as a C macro), undefined around it.
  const spelled = new Set([...code.matchAll(/[A-Za-z_]\w*/g)].map((m) => m[0]));
  const names = [...declared].filter((n) => spelled.has(n)).sort();

  return [
    cpp
      .printUnit({
        banner: `Generated by Lucent from the widget ${body.extension}'s provider, ${providerCode(widget)}. Do not edit.`,
        decls: [
          { k: "include", path: "Foundation/Foundation.h", system: true, objc: true },
          cpp.include(`${body.extension}.h`),
          ...includes,
          cpp.include("lucent/entries.h", true),
          cpp.include("lucent/platform/ios.h", true),
        ],
      })
      .trimEnd(),
    "",
    ...names.flatMap((n) => [`#pragma push_macro("${n}")`, `#undef ${n}`]),
    ...(names.length ? [""] : []),
    code,
    ...(names.length ? ["", ...names.toReversed().map((n) => `#pragma pop_macro("${n}")`)] : []),
    "",
  ].join("\n");
}

// --- the widget's Swift ----------------------------------------------------------------------

/** How long a widget whose timeline() failed waits to ask again: 15 minutes, in seconds. */
const RETRY_AFTER = 15 * 60;

/**
 * What WidgetKit takes, in the widget's Swift, after its body's values
 * and view: the entry, the provider calling the glue, and the widget,
 * public, for the extension's entry point to name. A failed snapshot()
 * gives the placeholder's entry, and a failed timeline() that entry until
 * WidgetKit asks again, in 15 minutes; each failure is logged.
 */
export function widgetKitDecls(widget: Widget): swift.Decl[] {
  const { body } = widget;
  const n = widgetNames(body.extension);
  const ext = body.extension;
  const { displayName, description, families } = body.gallery;
  const modifiers = [
    `.configurationDisplayName(${JSON.stringify(displayName ?? ext)})`,
    ...(description !== undefined ? [`.description(${JSON.stringify(description)})`] : []),
    ...(families?.length
      ? [`.supportedFamilies([${families.map((f) => `.${f}`).join(", ")}])`]
      : []),
  ];

  return [
    {
      k: "verbatim",
      text: `/// An entry of the widget's timeline: its date, and its body's values for it.
fileprivate struct ${n.entry}: TimelineEntry {
  let date: Date
  let values: ${n.values}

  init(_ x: Any) {
    let fields = lucentDecodeList(x, "${n.entry}")
    self.date = Date(timeIntervalSince1970: lucentDecodeNumber(fields[0], "${n.entry}.date").doubleValue)
    self.values = ${n.values}(fields[1])
  }
}

/// A call of the glue's, which gives a retained object (or nothing) and its error.
fileprivate final class ${n.call} {
  let done: (Any?, String?) -> Void

  init(_ done: @escaping (Any?, String?) -> Void) {
    self.done = done
  }

  /// The call's context, which settle() takes back.
  static func start(_ done: @escaping (Any?, String?) -> Void) -> UnsafeMutableRawPointer {
    Unmanaged.passRetained(${n.call}(done)).toOpaque()
  }
}

fileprivate func lucentTake(_ x: UnsafeMutableRawPointer?) -> Any? {
  x.map { Unmanaged<AnyObject>.fromOpaque($0).takeRetainedValue() }
}

fileprivate func ${n.c}_settle(
  _ context: UnsafeMutableRawPointer?, _ value: UnsafeMutableRawPointer?, _ error: UnsafeMutableRawPointer?
) {
  let call = Unmanaged<${n.call}>.fromOpaque(context!).takeRetainedValue()
  call.done(lucentTake(value), lucentTake(error) as? String)
}

/// WidgetKit's provider: the Lucent provider's methods, through the glue.
fileprivate struct ${n.provider}: TimelineProvider {
  func placeholder(in context: Context) -> ${n.entry} {
    var error: UnsafeMutableRawPointer?
    guard let entry = lucentTake(${n.c}_placeholder(&error)) else {
      fatalError("Lucent: the widget ${ext}'s placeholder() threw: \\(lucentTake(error) as? String ?? "")")
    }
    return ${n.entry}(entry)
  }

  func getSnapshot(in context: Context, completion: @escaping (${n.entry}) -> Void) {
    let call = ${n.call}.start { entry, error in
      guard let entry else {
        NSLog("Lucent: the widget ${ext}'s snapshot() failed: %@", error ?? "")
        return completion(placeholder(in: context))
      }
      completion(${n.entry}(entry))
    }
    ${n.c}_snapshot(call, ${n.c}_settle)
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<${n.entry}>) -> Void) {
    let call = ${n.call}.start { timeline, error in
      guard let timeline else {
        NSLog("Lucent: the widget ${ext}'s timeline() failed: %@", error ?? "")
        let again = Date(timeIntervalSinceNow: ${RETRY_AFTER})
        return completion(Timeline(entries: [placeholder(in: context)], policy: .after(again)))
      }
      let fields = lucentDecodeList(timeline, "${n.provider}.timeline")
      let entries = lucentDecodeList(fields[0], "${n.provider}.entries").map { ${n.entry}($0) }
      let policy: TimelineReloadPolicy =
        fields[1] is NSNull
        ? .atEnd
        : .after(Date(timeIntervalSince1970: lucentDecodeNumber(fields[1], "${n.provider}.reloadAfter").doubleValue))
      completion(Timeline(entries: entries, policy: policy))
    }
    ${n.c}_timeline(call, ${n.c}_settle)
  }
}

/// The widget, which the extension's entry point names (its target's LucentWidget.swift).
public struct ${n.widget}: Widget {
  public init() {}

  public var body: some WidgetConfiguration {
    StaticConfiguration(kind: ${JSON.stringify(ext)}, provider: ${n.provider}()) { entry in
      ${n.view}(values: entry.values)
    }
${modifiers.map((m) => `    ${m}`).join("\n")}
  }
}`,
    },
  ];
}
