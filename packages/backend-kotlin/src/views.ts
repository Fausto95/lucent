import type { IRExpr } from "@lucent-lang/compiler";
import { nativeKotlin } from "./native.ts";

type ViewExpr = Extract<IRExpr, { op: "view" }>;

const LAYOUT = "androidx.compose.foundation.layout.*";
const MATERIAL = "androidx.compose.material3.*";
const MODIFIER = "androidx.compose.ui.Modifier";
const DP = "androidx.compose.ui.unit.dp";
const SP = "androidx.compose.ui.unit.sp";
const COLOR = "androidx.compose.ui.graphics.Color";

/** Reading a view's props and children; the same shape drives every definition. */
interface ViewScope {
  /** A prop's emitted expression, or `fallback` when the prop is absent. */
  prop(name: string, fallback: string): string;
  has(name: string): boolean;
  /** Children emitted as statements, for a Compose content lambda. */
  readonly children: string;
  /** Children emitted individually, for views that combine them. */
  readonly childValues: string[];
  /** Declares an import a conditional branch of `render` just made necessary. */
  needs(...imports: readonly string[]): void;
}

/**
 * A built-in view: how it renders, and the Compose imports its output needs.
 * Keeping the two together is the point — an import list maintained separately
 * from the call it supports drifts, and drifts silently.
 */
interface ViewDefinition {
  readonly imports: readonly string[];
  render(view: ViewScope): string;
}

const VIEWS: Readonly<Record<string, ViewDefinition>> = {
  TextField: {
    imports: [MATERIAL],
    render: (v) =>
      `TextField(value = ${v.prop("value", '""')}, onValueChange = ${v.prop("onChange", "{}")}, placeholder = { Text(${v.prop("placeholder", '""')}) })`,
  },
  Toggle: {
    imports: [LAYOUT, MATERIAL],
    render: (v) =>
      `Row { Text(${v.prop("title", '""')}); Switch(checked = ${v.prop("value", "false")}, onCheckedChange = ${v.prop("onChange", "{}")}) }`,
  },
  Slider: {
    imports: [MATERIAL],
    render: (v) =>
      `Slider(value = (${v.prop("value", "0.0")}).toFloat(), onValueChange = { ${v.prop("onChange", "{}")} (it.toDouble()) }, valueRange = (${v.prop("min", "0.0")}).toFloat()..maxOf((${v.prop("min", "0.0")}).toFloat(), (${v.prop("max", "1.0")}).toFloat()))`,
  },
  ScrollView: {
    imports: [
      LAYOUT,
      MODIFIER,
      "androidx.compose.foundation.verticalScroll",
      "androidx.compose.foundation.rememberScrollState",
    ],
    render: (v) => `Column(modifier = Modifier.verticalScroll(rememberScrollState())) { ${v.children} }`,
  },
  ZStack: {
    imports: [LAYOUT],
    render: (v) => `Box { ${v.children} }`,
  },
  Padding: {
    imports: [LAYOUT, MODIFIER, DP],
    render: (v) => `Column(modifier = Modifier.padding((${v.prop("value", "0.0")}).toFloat().dp)) { ${v.children} }`,
  },
  Background: {
    imports: [LAYOUT, MODIFIER, COLOR, "androidx.compose.foundation.background"],
    render: (v) =>
      `Column(modifier = Modifier.background(Color(android.graphics.Color.parseColor(${v.prop("color", '"#000000"')})))) { ${v.children} }`,
  },
  CornerRadius: {
    imports: [
      LAYOUT,
      MODIFIER,
      DP,
      "androidx.compose.ui.draw.clip",
      "androidx.compose.foundation.shape.RoundedCornerShape",
    ],
    render: (v) =>
      `Column(modifier = Modifier.clip(RoundedCornerShape((${v.prop("value", "0.0")}).toFloat().dp))) { ${v.children} }`,
  },
  Accessibility: {
    imports: [
      LAYOUT,
      MODIFIER,
      "androidx.compose.ui.semantics.semantics",
      "androidx.compose.ui.semantics.contentDescription",
    ],
    render: (v) =>
      `Column(modifier = Modifier.semantics { contentDescription = ${v.prop("label", '""')} }) { ${v.children} }`,
  },
  VStack: {
    imports: [LAYOUT, MODIFIER, DP],
    render: (v) =>
      `Column(modifier = Modifier.padding((${v.prop("padding", "0.0")}).toFloat().dp), verticalArrangement = Arrangement.spacedBy((${v.prop("spacing", "0.0")}).toFloat().dp)) { ${v.children} }`,
  },
  HStack: {
    imports: [LAYOUT, MODIFIER, DP],
    render: (v) =>
      `Row(modifier = Modifier.padding((${v.prop("padding", "0.0")}).toFloat().dp), horizontalArrangement = Arrangement.spacedBy((${v.prop("spacing", "0.0")}).toFloat().dp)) { ${v.children} }`,
  },
  Text: {
    imports: [MATERIAL, SP],
    render: (v) => {
      const text = v.childValues.length ? v.childValues.join(" + ") : '""';
      if (!v.has("color")) return `Text(text = ${text}, fontSize = (${v.prop("size", "17.0")}).toFloat().sp)`;
      v.needs(COLOR);
      return `Text(text = ${text}, fontSize = (${v.prop("size", "17.0")}).toFloat().sp, color = Color(android.graphics.Color.parseColor(${v.prop("color", '"#000000"')})))`;
    },
  },
  Spacer: {
    imports: [LAYOUT, MODIFIER, DP],
    render: (v) => `Spacer(modifier = Modifier.size((${v.prop("size", "8.0")}).toFloat().dp))`,
  },
  Button: {
    imports: [MATERIAL],
    render: (v) => `Button(onClick = ${v.prop("onPress", "{}")}) { Text(${v.prop("title", '""')}) }`,
  },
  Divider: {
    imports: [MATERIAL],
    render: () => `HorizontalDivider()`,
  },
};

/** Every `@Composable` function the backend emits needs the annotation itself. */
export const COMPOSE_SCAFFOLDING = ["androidx.compose.runtime.Composable"];

/** `For` emits a `Column`, and a keyed `For` wraps each row in `key { }`. */
export const FOR_IMPORTS = [LAYOUT, MODIFIER, "androidx.compose.runtime.key"];

/**
 * Collects the imports for the views a module actually emits.
 *
 * Recorded while rendering rather than by walking the IR first: an emitted view
 * cannot then be missing from the import list, whereas a separate traversal
 * silently omits any expression shape it forgets to descend into.
 */
export class KotlinViewImports {
  private readonly used = new Set<string>();

  record(...imports: readonly string[]): void {
    for (const name of imports) this.used.add(name);
  }

  toSorted(): string[] {
    return [...this.used].toSorted();
  }

  get size(): number {
    return this.used.size;
  }
}

export function kotlinView(e: ViewExpr, expr: (e: IRExpr) => string, imports: KotlinViewImports): string {
  const childValues = e.children.map(expr);
  const scope: ViewScope = {
    prop: (name, fallback) => {
      const found = e.props.find((p) => p.name === name);
      return found ? expr(found.value) : fallback;
    },
    has: (name) => e.props.some((p) => p.name === name),
    children: childValues.join("; "),
    childValues,
    needs: (...names) => imports.record(...names),
  };
  if (e.native) {
    const descriptor = e.native.kotlin;
    imports.record(...(descriptor.imports ?? []));
    return descriptor.template.replace(/{{([^}]+)}}/g, (_, token: string) =>
      token === "children" ? scope.children : scope.prop(token.slice(5), descriptor.defaults?.[token.slice(5)] ?? ""),
    );
  }
  const definition = VIEWS[e.name];
  if (!definition) throw new Error(`Kotlin backend: unknown built-in view ${e.name}`);
  imports.record(...definition.imports);
  return definition.render(scope);
}

/** Row identity for a keyed `For`, matching the Swift helper's duplicate-key behaviour. */
export const kotlinViewRuntime = nativeKotlin("LucentViews.kt");
