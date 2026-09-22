import type { IRModule, NativeType } from "@lucent-lang/compiler";
import {
  generateSwiftNamespace,
  swiftType,
  swiftHostedViewRuntime,
  swiftViewRuntime,
} from "@lucent-lang/backend-swift";
import { generateKotlinNamespace, kotlinType, kotlinViewRuntime } from "@lucent-lang/backend-kotlin";
import {
  exportedViews,
  stateArguments,
  stateFields,
  resourceArguments,
  resourceDispose,
  resourceFields,
  viewCallWithState,
  viewName,
  viewNamespace,
  viewProps,
  jsType,
  type FileTree,
} from "@lucent-lang/host-core";

export function emitViews(files: FileTree, modules: IRModule[], androidPackage: string): void {
  if (!modules.some((m) => exportedViews(m).length)) return;
  const dir = `android/src/main/java/${androidPackage.replaceAll(".", "/")}`;
  files.set("ios/LucentHostedView.swift", swiftHostedViewRuntime + swiftViewRuntime);
  files.set(`${dir}/LucentViews.kt`, `package ${androidPackage}\n\n` + kotlinViewRuntime);
  for (const module of modules) {
    if (!exportedViews(module).length) continue;
    const namespace = viewNamespace(module);
    files.set(`ios/${namespace}.swift`, generateSwiftNamespace(module, namespace));
    files.set(`${dir}/${namespace}.kt`, `package ${androidPackage}\n\n` + generateKotlinNamespace(module, namespace));
    for (const fn of exportedViews(module)) {
      const name = viewName(module, fn);
      const props = viewProps(module, fn);
      const type = fn.params[0]?.type;
      const swiftArgs = props
        .map(
          (p) =>
            `${p.name}: ${p.name}${p.type.kind === "event" ? (p.type.payload.kind === "void" ? " ?? {}" : " ?? { _ in }") : ""}`,
        )
        .join(", ");
      const kotlinArgs = props
        .map((p) => {
          const value =
            p.type.kind === "event"
              ? `${p.name} ?: {}`
              : p.type.kind === "array"
                ? `${p.name}.toMutableList()`
                : p.name;
          return `${p.name} = ${value}`;
        })
        .join(", ");
      files.set(
        `src/specs/${name}.nitro.ts`,
        `import type { HybridView, HybridViewProps, HybridViewMethods } from "react-native-nitro-modules";
export interface ${name}Props extends HybridViewProps {
${props.map((p) => `  ${p.name}${p.type.kind === "optional" || p.type.kind === "event" ? "?" : ""}: ${jsType(p.type.kind === "optional" ? p.type.value : p.type)};`).join("\n")}
}
export interface ${name}Methods extends HybridViewMethods {}
export type ${name} = HybridView<${name}Props, ${name}Methods>;
`,
      );
      files.set(
        `ios/Hybrid${name}.swift`,
        `import UIKit
import SwiftUI
import NitroModules
class Hybrid${name}: Hybrid${name}Spec {
  private let content = MainActor.assumeIsolated { LucentHostedView(frame: .zero) }
  var view: UIView { content }
${props.map((p) => `  var ${p.name}: ${p.type.kind === "event" ? `(${swiftType(p.type)})?` : swiftType(p.type)} = ${defaultValue(p.type, "swift")}`).join("\n")}
${indentLines(stateFields(fn, "swift", swiftType))}
${indentLines(resourceFields(fn, "swift", swiftType, namespace))}
  func afterUpdate() {
    MainActor.assumeIsolated {
      content.render(${namespace}.${fn.name}(${viewCallWithState(type?.kind === "struct" ? `${fn.params[0]!.name}: ${namespace}.${type.name}(${swiftArgs})` : "", stateArguments(fn, "swift", "afterUpdate"), resourceArguments(fn, "swift"))}))
    }
  }
  ${resourceDispose(fn, "swift")}
}
`,
      );
      files.set(
        `${dir}/Hybrid${name}.kt`,
        `package ${androidPackage}
import android.view.View
import com.facebook.react.uimanager.ThemedReactContext
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.ViewCompositionStrategy
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.annotation.Keep
import com.facebook.proguard.annotations.DoNotStrip
@Keep
@DoNotStrip
class Hybrid${name}(context: ThemedReactContext) : Hybrid${name}Spec() {
${props.map((p) => `  override var ${p.name}: ${nitroViewType(p.type)} by mutableStateOf(${nitroViewDefault(p.type)})`).join("\n")}
${indentLines(stateFields(fn, "kotlin", kotlinType))}
${indentLines(resourceFields(fn, "kotlin", kotlinType, namespace))}
  override val view: View = ComposeView(context).apply {
    setViewCompositionStrategy(ViewCompositionStrategy.DisposeOnDetachedFromWindowOrReleasedFromPool)
    setContent { ${namespace}.${fn.name}(${viewCallWithState(type?.kind === "struct" ? `${namespace}.${type.name}(${kotlinArgs})` : "", stateArguments(fn, "kotlin", "afterUpdate"), resourceArguments(fn, "kotlin"))}) }
  }
}
`,
      );
    }
  }
}
function indentLines(text: string): string {
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => `  ${line}`)
    .join("\n");
}
function nitroViewType(type: NativeType): string {
  if (type.kind === "event") return `(${kotlinType(type)})?`;
  if (type.kind !== "array") return kotlinType(type);
  if (type.element.kind === "string") return "Array<String>";
  if (type.element.kind === "bool") return "BooleanArray";
  if (type.element.kind === "float" || type.element.kind === "int") return "DoubleArray";
  return kotlinType(type);
}
function nitroViewDefault(type: NativeType): string {
  if (type.kind === "array" && type.element.kind === "string") return "emptyArray()";
  if (type.kind === "array" && type.element.kind === "bool") return "booleanArrayOf()";
  if (type.kind === "array" && (type.element.kind === "float" || type.element.kind === "int")) return "doubleArrayOf()";
  return defaultValue(type, "kotlin");
}
function defaultValue(type: NativeType, language: string): string {
  const defaults: Record<string, string> = {
    event: language === "swift" ? "nil" : "null",
    string: '""',
    bool: "false",
    float: "0.0",
    array: language === "kotlin" ? "mutableListOf()" : "[]",
    optional: language === "swift" ? "nil" : "null",
  };
  if (!(type.kind in defaults)) throw new Error(`Unsupported native view prop ${type.kind}`);
  return defaults[type.kind]!;
}
