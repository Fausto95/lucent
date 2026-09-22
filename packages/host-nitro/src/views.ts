import type { IRModule, NativeType } from "@lucent-lang/compiler";
import {
  generateSwiftNamespace,
  swiftType,
  swiftHostedViewRuntime,
  swiftViewRuntime,
} from "@lucent-lang/backend-swift";
import { generateKotlinNamespace, kotlinType } from "@lucent-lang/backend-kotlin";
import { exportedViews, viewName, viewNamespace, viewProps, jsType, type FileTree } from "@lucent-lang/host-core";

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
      const type = fn.params[0]?.type;
      const swiftArgs = props
        .map(
          (p) =>
            `${p.name}: ${p.name}${p.type.kind === "event" ? (p.type.payload.kind === "void" ? " ?? {}" : " ?? { _ in }") : ""}`,
        )
        .join(", ");
      const kotlinArgs = props.map((p) => `${p.name} = ${p.name}${p.type.kind === "event" ? " ?: {}" : ""}`).join(", ");
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
  func afterUpdate() {
    MainActor.assumeIsolated {
      content.render(${namespace}.${fn.name}(${type?.kind === "struct" ? `${fn.params[0]!.name}: ${namespace}.${type.name}(${swiftArgs})` : ""}))
    }
  }
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
${props.map((p) => `  override var ${p.name}: ${p.type.kind === "event" ? `(${kotlinType(p.type)})?` : kotlinType(p.type)} by mutableStateOf(${defaultValue(p.type, "kotlin")})`).join("\n")}
  override val view: View = ComposeView(context).apply {
    setViewCompositionStrategy(ViewCompositionStrategy.DisposeOnDetachedFromWindowOrReleasedFromPool)
    setContent { ${namespace}.${fn.name}(${type?.kind === "struct" ? `${namespace}.${type.name}(${kotlinArgs})` : ""}) }
  }
}
`,
      );
    }
  }
}
function defaultValue(type: NativeType, language: string): string {
  const defaults: Record<string, string> = {
    event: language === "swift" ? "nil" : "null",
    string: '""',
    bool: "false",
    float: "0.0",
    optional: language === "swift" ? "nil" : "null",
  };
  if (!(type.kind in defaults)) throw new Error(`Unsupported native view prop ${type.kind}`);
  return defaults[type.kind]!;
}
