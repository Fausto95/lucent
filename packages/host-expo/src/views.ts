import type { IRFunction, IRModule } from "@lucent-lang/compiler";
import {
  generateSwiftNamespace,
  swiftType,
  swiftHostedViewRuntime,
  swiftViewRuntime,
} from "@lucent-lang/backend-swift";
import { generateKotlinNamespace, kotlinType } from "@lucent-lang/backend-kotlin";
import {
  exportedViews,
  stateArguments,
  stateFields,
  viewCallWithState,
  viewName,
  viewNamespace,
  viewProps,
  type FileTree,
} from "@lucent-lang/host-core";

export const nativeViewEvent = (module: IRModule, fn: IRFunction, prop: string): string =>
  `on${viewName(module, fn)}_${prop}`;

export function emitViews(files: FileTree, modules: IRModule[], androidPackage: string): void {
  if (!modules.some((m) => exportedViews(m).length)) return;
  const dir = `android/src/main/java/${androidPackage.replaceAll(".", "/")}`;
  files.set("ios/LucentHostedView.swift", swiftHostedViewRuntime + swiftViewRuntime);
  for (const module of modules) {
    if (!exportedViews(module).length) continue;
    const namespace = viewNamespace(module);
    files.set(`ios/${namespace}.swift`, generateSwiftNamespace(module, namespace));
    files.set(`${dir}/${namespace}.kt`, `package ${androidPackage}\n\n` + generateKotlinNamespace(module, namespace));
    for (const fn of exportedViews(module)) {
      const name = viewName(module, fn);
      const props = viewProps(module, fn);
      const swiftProps = props
        .map((p) =>
          p.type.kind === "event"
            ? `  let ${nativeViewEvent(module, fn, p.name)} = EventDispatcher()`
            : `  var lucentProp_${p.name}: ${swiftType(p.type)} = ${defaultValue(p.type.kind, "swift")}`,
        )
        .join("\n");
      const swiftArgs = props
        .map(
          (p) =>
            `${p.name}: ${p.type.kind === "event" ? (p.type.payload.kind === "void" ? `{ [weak self] in self?.${nativeViewEvent(module, fn, p.name)}() }` : `{ [weak self] payload in self?.${nativeViewEvent(module, fn, p.name)}(["payload": payload]) }`) : `lucentProp_${p.name}`}`,
        )
        .join(", ");
      const kotlinArgs = props
        .map(
          (p) =>
            `${p.name} = ${p.type.kind === "event" ? (p.type.payload.kind === "void" ? `{ ${nativeViewEvent(module, fn, p.name)}(emptyMap<String, Any>()) }` : `{ payload -> ${nativeViewEvent(module, fn, p.name)}(mapOf("payload" to payload)) }`) : `lucentProp_${p.name}`}`,
        )
        .join(", ");
      files.set(
        `ios/${name}.swift`,
        `import ExpoModulesCore
import SwiftUI
public final class ${name}Module: Module {
  public func definition() -> ModuleDefinition {
    Name("${name}")
    View(${name}.self) {
${props
  .filter((p) => p.type.kind === "event")
  .map((p) => `      Events("${nativeViewEvent(module, fn, p.name)}")`)
  .join("\n")}
${props
  .filter((p) => p.type.kind !== "event")
  .map(
    (p) =>
      `      Prop("${p.name}") { (view: ${name}, value: ${swiftType(p.type)}) in view.lucentProp_${p.name} = value }`,
  )
  .join("\n")}
      OnViewDidUpdateProps { (view: ${name}) in view.update() }
    }
  }
}
final class ${name}: ExpoView {
  private let content = LucentHostedView(frame: .zero)
${swiftProps}
${indentLines(stateFields(fn, "swift", swiftType))}
  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    addSubview(content)
    update()
  }
  override func layoutSubviews() { super.layoutSubviews(); content.frame = bounds }
  func update() { content.render(${namespace}.${fn.name}(${viewCallWithState(viewCall(module, fn, swiftArgs, "swift"), stateArguments(fn, "swift", "update"))})) }
}
`,
      );
      files.set(
        `${dir}/${name}.kt`,
        `package ${androidPackage}
import android.content.Context
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.ViewCompositionStrategy
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.views.ExpoView
import expo.modules.kotlin.viewevent.EventDispatcher
class ${name}Module : Module() {
  override fun definition() = ModuleDefinition {
    Name("${name}")
    View(${name}::class) {
${props
  .filter((p) => p.type.kind === "event")
  .map((p) => `      Events("${nativeViewEvent(module, fn, p.name)}")`)
  .join("\n")}
${props
  .filter((p) => p.type.kind !== "event")
  .map(
    (p) =>
      `      Prop("${p.name}") { view: ${name}, value: ${kotlinType(p.type)} -> view.lucentProp_${p.name} = value }`,
  )
  .join("\n")}
    }
  }
}
class ${name}(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
${props.map((p) => (p.type.kind === "event" ? `  val ${nativeViewEvent(module, fn, p.name)} by EventDispatcher<Map<String, Any>>()` : `  var lucentProp_${p.name}: ${kotlinType(p.type)} by mutableStateOf(${defaultValue(p.type.kind, "kotlin")})`)).join("\n")}
${indentLines(stateFields(fn, "kotlin", kotlinType))}
  private val content = ComposeView(context).apply {
    setViewCompositionStrategy(ViewCompositionStrategy.DisposeOnDetachedFromWindowOrReleasedFromPool)
    setContent { ${namespace}.${fn.name}(${viewCallWithState(viewCall(module, fn, kotlinArgs, "kotlin"), stateArguments(fn, "kotlin", "update"))}) }
  }
  init { addView(content, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)) }
}
`,
      );
    }
  }
}
function viewCall(module: IRModule, fn: IRFunction, args: string, language: string): string {
  const param = fn.params[0];
  if (!param || param.type.kind !== "struct") return "";
  return `${language === "swift" ? `${param.name}: ` : ""}${viewNamespace(module)}.${param.type.name}(${args})`;
}
function indentLines(text: string): string {
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => `  ${line}`)
    .join("\n");
}
function defaultValue(kind: string, language: string): string {
  const defaults: Record<string, string> = {
    string: '""',
    bool: "false",
    float: "0.0",
    array: language === "kotlin" ? "mutableListOf()" : "[]",
    optional: language === "swift" ? "nil" : "null",
  };
  if (!(kind in defaults)) throw new Error(`Native view prop ${kind} requires an explicit supported boundary type.`);
  return defaults[kind]!;
}
