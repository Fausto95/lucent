/**
 * Widget bodies in a widget's build (decision 0124): the body is compiled
 * through the semantic IR as a function of its entry, whose C++ computes,
 * once, each value the body shows (toolkit.ts `widgetJsx`) and returns
 * them encoded, in an array, for the widget's Swift to read into the
 * entry it gives WidgetKit. Its view is SwiftUI, written from the JSX
 * (swiftui.ts `swiftUIWidget`), as a component's body is: WidgetKit draws
 * it once per entry, so nothing in it calls back.
 *
 * In the module's namespace, for a widget `Weather` whose body is `Forecast`:
 *
 *   lucent::NativeRef Forecast_widget(Entry entry);   (an NSArray of its values)
 */
import { cpp } from "@lucent-lang/codegen";
import type ts from "typescript";
import { cppIdent, type LType } from "../types.ts";
import type { CppFunction } from "../ir/cpp.ts";
import { bodyOf } from "../ui/toolkit-body.ts";
import type { WidgetBody } from "../ui/widgets.ts";
import type { Ctx } from "./context.ts";
import type { IrUnit } from "./through-ir.ts";

/** A widget whose body this program compiles. */
export interface Widget {
  readonly body: WidgetBody;
  /** Its entry's type. */
  readonly entry: LType;
  /** Its values function's C++ name, in its module's namespace. */
  readonly values: string;
}

/** What a body's values function returns: an NSArray, the values in the order the view reads them. */
export const WIDGET_VALUES: LType = {
  k: "native",
  platform: "ios",
  module: "Foundation",
  name: "NSArray",
};

/** Registers a widget's body with the program: its types, before any code is emitted. */
export function planWidget(ctx: Ctx, body: WidgetBody): Widget {
  const widget: Widget = {
    body,
    entry: ctx.reg.lower(ctx.checker.getTypeAtLocation(body.entry), body.entry),
    values: `${cppIdent(body.name)}_widget`,
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
