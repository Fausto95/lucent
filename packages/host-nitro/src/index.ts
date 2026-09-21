import { emitViews } from "./views.ts";
/**
 * Nitro Modules host: one library package with a HybridObject per Lucent module.
 * nitrogen owns the boundary types (its structs, arrays, and `number` for every
 * integer), so backend bodies live in their own namespace and explicit
 * converters move values across.
 */
import type { IRModule, NativeType } from "@lucent-lang/compiler";
import {
  generateSwift,
  swiftClass,
  swiftObjectRuntime,
  swiftRuntime,
  swiftEventRuntime,
  swiftType,
  indent,
  signature as swiftSignature,
} from "@lucent-lang/backend-swift";
import {
  generateKotlin,
  kotlinClass,
  kotlinObjectRuntime,
  kotlinRuntime,
  kotlinEventRuntime,
  kotlinType,
  signature as kotlinSignature,
} from "@lucent-lang/backend-kotlin";
import type { GeneratedFunction } from "@lucent-lang/backend-kotlin";
import {
  exportedViews,
  viewName,
  viewConfig,
  viewProps,
  withoutViews,
  isReference,
  classProxies,
  GENERATED_HEADER,
  runtimeImport,
  declarations,
  exportedFunctions,
  moduleIdentifier,
  proxyFunctions,
  type EmitOptions,
  type FileTree,
  type Host,
} from "@lucent-lang/host-core";

// Nitrogen emits these names directly into C++ method declarations.
const CPP_KEYWORDS = new Set(
  "alignas alignof and asm auto bitand bitor bool char char8_t char16_t char32_t compl concept const consteval constexpr constinit const_cast decltype delete double dynamic_cast enum explicit extern float friend inline int long mutable namespace noexcept not operator or private protected public register reinterpret_cast requires short signed sizeof static_assert static_cast struct template thread_local typedef typeid typename union unsigned using virtual void volatile wchar_t xor".split(
    " ",
  ),
);
const boundaryName = (name: string): string =>
  CPP_KEYWORDS.has(name) || name.startsWith("lucent_") ? `lucent_${name}` : name;

export const IOS_MODULE_NAME = "NitroLucent";
export const ANDROID_NAMESPACE = "lucent";
export const ANDROID_PACKAGE = `com.margelo.nitro.${ANDROID_NAMESPACE}`;
const ANDROID_DIR = `android/src/main/java/${ANDROID_PACKAGE.replace(/\./g, "/")}`;

export const hybridName = (module: IRModule): string => moduleIdentifier(module.name);
/** nitrogen puts every struct in one namespace, so struct names are prefixed with their module. */
export const nitroStructName = (module: IRModule, struct: string): string => `${hybridName(module)}${struct}`;
const bodiesName = (module: IRModule): string => `${hybridName(module)}Bodies`;

export const nitroHost: Host = {
  name: "nitro",
  emitPackage,
  emitProxy,
  async postGenerate(packageDir: string): Promise<void> {
    const { spawn } = await import("node:child_process");
    await new Promise<void>((resolve, reject) => {
      const child = spawn("npx", ["nitrogen"], { cwd: packageDir, stdio: "inherit" });
      child.on("error", reject);
      child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`nitrogen exited with ${code}`))));
    });
  },
};

function emitPackage(modules: IRModule[], options: EmitOptions): FileTree {
  const files: FileTree = new Map();
  const ident = moduleIdentifier(options.packageName);
  files.set(
    "package.json",
    JSON.stringify(
      {
        name: `${options.packageName}-native`,
        version: "0.0.0",
        private: true,
        main: "src/index.ts",
        "react-native": "src/index.ts",
        types: "src/index.ts",
        files: ["src", "ios", "android", "nitrogen", "*.podspec", "nitro.json", "react-native.config.js"],
        scripts: { specs: "nitrogen" },
        peerDependencies: { "react-native-nitro-modules": "*" },
      },
      null,
      2,
    ) + "\n",
  );
  files.set(
    "nitro.json",
    JSON.stringify(
      {
        $schema: "https://nitro.margelo.com/nitro.schema.json",
        cxxNamespace: [ANDROID_NAMESPACE],
        ios: { iosModuleName: IOS_MODULE_NAME },
        android: { androidNamespace: [ANDROID_NAMESPACE], androidCxxLibName: IOS_MODULE_NAME },
        autolinking: Object.fromEntries(
          [...modules.map(hybridName), ...modules.flatMap((m) => exportedViews(m).map((f) => viewName(m, f)))].map(
            (name) => [
              name,
              {
                ios: { language: "swift", implementationClassName: `Hybrid${name}` },
                android: { language: "kotlin", implementationClassName: `Hybrid${name}` },
              },
            ],
          ),
        ),
        ignorePaths: ["**/node_modules"],
        gitAttributesGeneratedFlag: true,
      },
      null,
      2,
    ) + "\n",
  );
  files.set("react-native.config.js", "module.exports = { dependency: { platforms: { ios: {}, android: {} } } };\n");
  files.set(
    "src/index.ts",
    GENERATED_HEADER + modules.map((m) => `export type * from "./specs/${hybridName(m)}.nitro";`).join("\n") + "\n",
  );
  files.set(`${IOS_MODULE_NAME}.podspec`, podspec());
  files.set(`ios/${ident}Runtime.swift`, SWIFT_RUNTIME);
  files.set(
    "android/build.gradle",
    modules.some((m) => exportedViews(m).length) ? COMPOSE_BUILDSCRIPT + buildGradle() + COMPOSE_CONFIG : buildGradle(),
  );
  if (modules.some((m) => m.functions.some((f) => f.thread && f.thread !== "caller")))
    files.set(
      "android/build.gradle",
      files.get("android/build.gradle") +
        '\ndependencies { implementation "org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2" }\n',
    );
  files.set("android/CMakeLists.txt", CMAKE);
  files.set("android/src/main/AndroidManifest.xml", "<manifest>\n</manifest>\n");
  files.set("android/src/main/cpp/cpp-adapter.cpp", CPP_ADAPTER);
  files.set(
    `${ANDROID_DIR}/${ident}Package.kt`,
    PACKAGE_KT(
      ident,
      modules.flatMap((m) => exportedViews(m).map((f) => viewName(m, f))),
    ),
  );
  files.set(`${ANDROID_DIR}/${ident}Runtime.kt`, KOTLIN_RUNTIME);
  for (const module of modules) {
    files.set(`src/specs/${hybridName(module)}.nitro.ts`, spec(withoutViews(module)));
    files.set(`ios/Hybrid${hybridName(module)}.swift`, swiftHybrid(module));
    files.set(`${ANDROID_DIR}/Hybrid${hybridName(module)}.kt`, kotlinHybrid(module));
  }
  if (modules.some((m) => m.events?.length)) {
    files.set("ios/LucentEvents.swift", swiftEventRuntime);
    files.set(`${ANDROID_DIR}/LucentEvents.kt`, `package ${ANDROID_PACKAGE}\n\n` + kotlinEventRuntime);
  }
  if (modules.some((m) => m.structs.some((s) => s.reference))) {
    files.set("ios/LucentObjects.swift", swiftObjectRuntime);
    files.set(`${ANDROID_DIR}/LucentObjects.kt`, `package ${ANDROID_PACKAGE}\n\n` + kotlinObjectRuntime);
    for (const s of modules.flatMap((m) => m.structs).filter((item) => item.reference)) {
      files.set(`ios/${s.name}.swift`, swiftClass(s));
      files.set(`${ANDROID_DIR}/${s.name}.kt`, `package ${ANDROID_PACKAGE}\n\n` + kotlinClass(s));
    }
  }
  emitViews(files, modules, ANDROID_PACKAGE);
  return files;
}

function emitProxy(module: IRModule): { js: string; dts: string } {
  const body =
    proxyFunctions(module, (fn, args) => `native.${boundaryName(fn.name)}(${args.join(", ")})`, {
      nullAsUndefined: true,
    }) + (module.structs.some((s) => s.reference) ? "\n\n" + classProxies(module, true) : "");
  const js = [
    GENERATED_HEADER,
    `import { NitroModules${exportedViews(module).length ? ", getHostComponent, callback" : ""} } from "react-native-nitro-modules";`,
    ...(exportedViews(module).length ? ['import { createElement } from "react";'] : []),
    runtimeImport(body),
    "",
    `const native = NitroModules.createHybridObject(${JSON.stringify(hybridName(module))});`,
    "",
    body,
    ...(module.events ?? [])
      .filter((e) => e.exported)
      .map(
        (e) =>
          `export const ${e.name} = { subscribe(listener) { const id = native.subscribe${moduleIdentifier(e.name)}((json) => listener(JSON.parse(json))); let active = true; return { remove() { if (active) { active = false; native.unsubscribe${moduleIdentifier(e.name)}(id); } } }; } };`,
      ),
    ...exportedViews(module).flatMap((f) => {
      const events = viewProps(module, f).filter((p) => p.type.kind === "event");
      return [
        `const Native${f.name} = getHostComponent(${JSON.stringify(viewName(module, f))}, () => (${viewConfig(module, f)}));`,
        `export function ${f.name}(props) { return createElement(Native${f.name}, { ...props, ${events.map((p) => `${p.name}: callback(props.${p.name})`).join(", ")} }); }`,
      ];
    }),
    "",
  ].join("\n");
  return { js, dts: GENERATED_HEADER + declarations(module) };
}

// ---- nitro spec ----------------------------------------------------------------

function specType(t: NativeType, module: IRModule): string {
  if (isReference(t, module)) return "number";
  switch (t.kind) {
    case "event":
      return `(${t.payload.kind === "void" ? "" : `payload: ${specType(t.payload, module)}`}) => void`;
    case "float":
    case "int":
      return "number";
    case "bool":
      return "boolean";
    case "string":
    case "view":
    case "void":
      return t.kind;
    case "bytes":
      return "ArrayBuffer";
    case "array":
      return t.element.kind === "optional" ? `(${specType(t.element, module)})[]` : `${specType(t.element, module)}[]`;
    case "map":
      return `Record<string, ${specType(t.value, module)}>`;
    case "optional":
      return `${specType(t.value, module)} | undefined`;
    case "struct":
      return nitroStructName(module, t.name);
    case "promise":
      return `Promise<${specType(t.value, module)}>`;
  }
}

function spec(module: IRModule): string {
  const structs = module.structs
    .filter((s) => !s.reference)
    .map(
      (s) =>
        `export interface ${nitroStructName(module, s.name)} {\n${s.fields
          .map((f) =>
            f.type.kind === "optional"
              ? `  ${f.name}?: ${specType(f.type.value, module)};`
              : `  ${f.name}: ${specType(f.type, module)};`,
          )
          .join("\n")}\n}`,
    );
  const methods = exportedFunctions(module).map((fn) => {
    const params = fn.params.map((p) => `${p.name}: ${specType(p.type, module)}`).join(", ");
    const ret = fn.async ? `Promise<${specType(fn.returnType, module)}>` : specType(fn.returnType, module);
    return `  ${boundaryName(fn.name)}(${params}): ${ret};`;
  });
  return [
    GENERATED_HEADER,
    "import { type HybridObject } from 'react-native-nitro-modules';",
    "",
    ...structs.flatMap((s) => [s, ""]),
    `export interface ${hybridName(module)} extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {`,
    ...methods,
    ...(module.structs.some((s) => s.reference) ? ["  lucentRelease(handle: number): void;"] : []),
    ...(module.events ?? []).flatMap((e) =>
      e.exported
        ? [
            `  subscribe${moduleIdentifier(e.name)}(listener: (json: string) => void): number;`,
            `  unsubscribe${moduleIdentifier(e.name)}(token: number): void;`,
          ]
        : [],
    ),
    "}",
    "",
  ].join("\n");
}

// ---- Swift ---------------------------------------------------------------------

const SWIFT_RUNTIME =
  GENERATED_HEADER +
  "import NitroModules\n" +
  swiftRuntime(
    { length: "return Double(buffer.size)", get: "return Double(buffer.data[Int(index)])" },
    `/** Nitro forwards only the description; the proxy recovers the code from the "[CODE] " prefix. */
struct LucentError: Error, CustomStringConvertible {
  let code: String
  let message: String

  init(code: String, message: String? = nil) {
    self.code = code
    self.message = message ?? code
  }

  var description: String {
    return "[\\(code)] \\(message)"
  }
}`,
  );

/** nitrogen's Swift type for a spec type. */
function nitroSwiftType(t: NativeType, module: IRModule): string {
  if (isReference(t, module)) return "Double";
  switch (t.kind) {
    case "int":
      return "Double";
    case "array":
      return `[${nitroSwiftType(t.element, module)}]`;
    case "map":
      return `[String: ${nitroSwiftType(t.value, module)}]`;
    case "optional":
      return `${nitroSwiftType(t.value, module)}?`;
    case "struct":
      return nitroStructName(module, t.name);
    case "promise":
      return `Promise<${nitroSwiftType(t.value, module)}>`;
    default:
      return swiftType(t);
  }
}

const swiftNeedsConversion = (t: NativeType): boolean =>
  t.kind === "int" ||
  t.kind === "struct" ||
  ((t.kind === "array" || t.kind === "optional" || t.kind === "map") &&
    swiftNeedsConversion(t.kind === "array" ? t.element : t.value));

/** Swift expression converting `value` between nitrogen's representation and the body's. */
function swiftConvert(value: string, t: NativeType, direction: "toBody" | "toNitro", module: IRModule): string {
  if (isReference(t, module) && t.kind === "struct")
    return direction === "toBody"
      ? `try LucentObjectRegistry.shared.get(${value}, ${t.name}.self)`
      : `LucentObjectRegistry.shared.hold(${value})`;
  if (!swiftNeedsConversion(t)) return value;
  switch (t.kind) {
    case "int":
      return direction === "toBody" ? `${swiftType(t)}(${value})` : `Double(${value})`;
    case "struct":
      return direction === "toBody" ? `${bodiesName(module)}.${t.name}.fromNitro(${value})` : `${value}.toNitro()`;
    case "array":
      return `${value}.map { ${swiftConvert("$0", t.element, direction, module)} }`;
    case "optional":
      return `${value}.map { ${swiftConvert("$0", t.value, direction, module)} }`;
    case "map":
      return `${value}.mapValues { ${swiftConvert("$0", t.value, direction, module)} }`;
    default:
      return value;
  }
}

function swiftHybrid(module: IRModule): string {
  const unit = generateSwift(withoutViews(module));
  const bodies: string[] = [];
  for (const s of unit.structs.filter((item) => !item.reference)) {
    const ir = module.structs.find((x) => x.name === s.name)!;
    bodies.push(
      `struct ${s.name} {`,
      ...s.fields.map((f) => `  var ${f.name}: ${f.type}`),
      "",
      `  static func fromNitro(_ value: ${nitroStructName(module, s.name)}) -> ${s.name} {`,
      `    return ${s.name}(${ir.fields.map((f) => `${f.name}: ${swiftConvert(`value.${f.name}`, f.type, "toBody", module)}`).join(", ")})`,
      "  }",
      "",
      `  func toNitro() -> ${nitroStructName(module, s.name)} {`,
      `    return ${nitroStructName(module, s.name)}(${ir.fields.map((f) => `${f.name}: ${swiftConvert(f.name, f.type, "toNitro", module)}`).join(", ")})`,
      "  }",
      "}",
      "",
    );
  }
  for (const f of unit.functions)
    bodies.push(
      `${f.thread === "main" ? "@MainActor " : ""}static ${swiftSignature({ ...f, thread: "caller" })} {`,
      ...indent(f.body),
      "}",
      "",
    );
  bodies.pop();

  const methods: string[] = [];
  if (module.structs.some((s) => s.reference))
    methods.push("func lucentRelease(handle: Double) throws { LucentObjectRegistry.shared.release(handle) }", "");
  if (module.events?.some((e) => e.exported))
    methods.push(
      "private var eventTokens: Set<Int> = []",
      "deinit { eventTokens.forEach { LucentEventHub.shared.remove($0) } }",
    );
  for (const e of (module.events ?? []).filter((event) => event.exported))
    methods.push(
      `func subscribe${moduleIdentifier(e.name)}(listener: @escaping (String) -> Void) throws -> Double {`,
      `  let token = LucentEventHub.shared.subscribe(${JSON.stringify(e.id)}, listener)`,
      "  eventTokens.insert(token)",
      "  return Double(token)",
      "}",
      `func unsubscribe${moduleIdentifier(e.name)}(token: Double) throws { LucentEventHub.shared.remove(Int(token)); eventTokens.remove(Int(token)) }`,
      "",
    );
  for (const fn of exportedFunctions(module)) {
    const params = fn.params.map((p) => `${p.name}: ${nitroSwiftType(p.type, module)}`).join(", ");
    const args = fn.params.map((p) => `${p.name}: ${swiftConvert(p.name, p.type, "toBody", module)}`).join(", ");
    const isVoid = fn.returnType.kind === "void";
    const call = `${bodiesName(module)}.${fn.name}(${args})`;
    const result = isVoid ? "" : swiftConvert("result", fn.returnType, "toNitro", module);
    if (fn.async) {
      const ret = nitroSwiftType(fn.returnType, module);
      methods.push(
        `func ${boundaryName(fn.name)}(${params}) throws -> Promise<${ret}> {`,
        "  return Promise.async {",
        ...(isVoid ? [`    try await ${call}`] : [`    let result = try await ${call}`, `    return ${result}`]),
        "  }",
        "}",
        "",
      );
    } else {
      methods.push(
        `func ${boundaryName(fn.name)}(${params}) throws -> ${nitroSwiftType(fn.returnType, module)} {`,
        ...(fn.params.some((p) => isReference(p.type, module)) || isReference(fn.returnType, module)
          ? ["  return try LucentObjectRegistry.shared.withLock {"]
          : []),
        ...(isVoid ? [`  try ${call}`] : [`  let result = try ${call}`, `  return ${result}`]),
        ...(fn.params.some((p) => isReference(p.type, module)) || isReference(fn.returnType, module) ? ["  }"] : []),
        "}",
        "",
      );
    }
  }
  methods.pop();
  return [
    GENERATED_HEADER,
    "import Foundation",
    ...unit.imports.map((i) => `import ${i}`),
    "import NitroModules",
    "",
    `class Hybrid${hybridName(module)}: Hybrid${hybridName(module)}Spec {`,
    ...indent(methods),
    "}",
    "",
    `enum ${bodiesName(module)} {`,
    ...indent(bodies),
    "}",
    "",
  ].join("\n");
}

function podspec(): string {
  return `require "json"

Pod::Spec.new do |s|
  s.name         = "${IOS_MODULE_NAME}"
  s.version      = "0.0.0"
  s.summary      = "Native code generated by Lucent"
  s.homepage     = "https://github.com/Fausto95/lucent"
  s.license      = "MIT"
  s.authors      = "Lucent"

  s.platforms    = { :ios => min_ios_version_supported }
  s.source       = { :git => "https://github.com/Fausto95/lucent.git", :tag => "#{s.version}" }

  s.source_files = [
    "ios/**/*.{swift}",
    "ios/**/*.{m,mm}",
    "cpp/**/*.{hpp,cpp}",
  ]

  load 'nitrogen/generated/ios/${IOS_MODULE_NAME}+autolinking.rb'
  add_nitrogen_files(s)

  s.dependency 'React-jsi'
  s.dependency 'React-callinvoker'
  install_modules_dependencies(s)
end
`;
}

// ---- Kotlin --------------------------------------------------------------------

const KOTLIN_RUNTIME =
  GENERATED_HEADER +
  kotlinRuntime(
    {
      imports: ["import com.margelo.nitro.core.ArrayBuffer"],
      length: "return buffer.size.toDouble()",
      get: "return (buffer.getBuffer(false).get(index.toInt()).toInt() and 0xff).toDouble()",
    },
    ANDROID_PACKAGE,
    'class LucentError(val code: String, message: String? = null) : Exception("[$code] ${message ?: code}")',
  );

/** nitrogen's Kotlin type for a spec type. */
function nitroKotlinType(t: NativeType, module: IRModule): string {
  if (isReference(t, module)) return "Double";
  switch (t.kind) {
    case "int":
      return "Double";
    case "array":
      return primitiveArray(t.element) ?? `Array<${nitroKotlinType(t.element, module)}>`;
    case "map":
      return `Map<String, ${nitroKotlinType(t.value, module)}>`;
    case "optional":
      return `${nitroKotlinType(t.value, module)}?`;
    case "struct":
      return nitroStructName(module, t.name);
    case "promise":
      return `Promise<${nitroKotlinType(t.value, module)}>`;
    default:
      return kotlinType(t);
  }
}

function primitiveArray(element: NativeType): string | null {
  if (element.kind === "float" || element.kind === "int") return "DoubleArray";
  if (element.kind === "bool") return "BooleanArray";
  return null;
}

const kotlinNeedsConversion = (t: NativeType): boolean =>
  t.kind === "int" ||
  t.kind === "struct" ||
  t.kind === "array" ||
  ((t.kind === "optional" || t.kind === "map") && kotlinNeedsConversion(t.value));

function kotlinConvert(value: string, t: NativeType, direction: "toBody" | "toNitro", module: IRModule): string {
  if (isReference(t, module) && t.kind === "struct")
    return direction === "toBody"
      ? `LucentObjectRegistry.get(${value}, ${t.name}::class.java)`
      : `LucentObjectRegistry.hold(${value})`;
  if (!kotlinNeedsConversion(t)) return value;
  switch (t.kind) {
    case "int":
      return direction === "toBody" ? `${value}.to${kotlinType(t)}()` : `${value}.toDouble()`;
    case "struct":
      return direction === "toBody" ? `${bodiesName(module)}.${t.name}.fromNitro(${value})` : `${value}.toNitro()`;
    case "array": {
      const mapped = kotlinNeedsConversion(t.element)
        ? `${value}.map { ${kotlinConvert("it", t.element, direction, module)} }`
        : value;
      if (direction === "toBody") return `${mapped}.toMutableList()`;
      const primitive = primitiveArray(t.element);
      return primitive ? `${mapped}.to${primitive}()` : `${mapped}.toTypedArray()`;
    }
    case "optional":
      return `${value}?.let { ${kotlinConvert("it", t.value, direction, module)} }`;
    case "map":
      return `${value}.mapValues { ${kotlinConvert("it.value", t.value, direction, module)} }`;
    default:
      return value;
  }
}

function kotlinHybrid(module: IRModule): string {
  const unit = generateKotlin(withoutViews(module));
  const bodies: string[] = [];
  for (const s of unit.structs.filter((item) => !item.reference)) {
    const ir = module.structs.find((x) => x.name === s.name)!;
    const nitro = nitroStructName(module, s.name);
    bodies.push(
      `data class ${s.name}(`,
      ...s.fields.map((f, i) => `  var ${f.name}: ${f.type}${i < s.fields.length - 1 ? "," : ""}`),
      ") {",
      `  fun toNitro(): ${nitro} = ${nitro}(${ir.fields.map((f) => `${f.name} = ${kotlinConvert(f.name, f.type, "toNitro", module)}`).join(", ")})`,
      "",
      "  companion object {",
      `    fun fromNitro(value: ${nitro}): ${s.name} = ${s.name}(${ir.fields.map((f) => `${f.name} = ${kotlinConvert(`value.${f.name}`, f.type, "toBody", module)}`).join(", ")})`,
      "  }",
      "}",
      "",
    );
  }
  for (const f of unit.functions) bodies.push(`${kotlinSignature(f)} {`, ...indent(f.body), "}", "");
  bodies.pop();

  const methods: string[] = [];
  if (module.structs.some((s) => s.reference))
    methods.push("override fun lucentRelease(handle: Double) { LucentObjectRegistry.release(handle) }", "");
  if (module.events?.some((e) => e.exported))
    methods.push(
      "private val eventTokens = java.util.Collections.synchronizedSet(mutableSetOf<Int>())",
      "override fun dispose() { synchronized(eventTokens) { eventTokens.forEach { LucentEventHub.remove(it) }; eventTokens.clear() }; super.dispose() }",
    );
  for (const e of (module.events ?? []).filter((event) => event.exported))
    methods.push(
      `override fun subscribe${moduleIdentifier(e.name)}(listener: (String) -> Unit): Double {`,
      `  val token = LucentEventHub.subscribe(${JSON.stringify(e.id)}, listener)`,
      "  eventTokens.add(token)",
      "  return token.toDouble()",
      "}",
      `override fun unsubscribe${moduleIdentifier(e.name)}(token: Double) { LucentEventHub.remove(token.toInt()); eventTokens.remove(token.toInt()) }`,
      "",
    );
  for (const fn of exportedFunctions(module)) {
    const gen: GeneratedFunction = unit.functions.find((f) => f.name === fn.name)!;
    const params = fn.params.map((p) => `${p.name}: ${nitroKotlinType(p.type, module)}`).join(", ");
    const args = fn.params.map((p) => kotlinConvert(p.name, p.type, "toBody", module)).join(", ");
    const call = `${bodiesName(module)}.${gen.name}(${args})`;
    const isVoid = fn.returnType.kind === "void";
    const ret = nitroKotlinType(fn.returnType, module);
    const result = isVoid ? "" : kotlinConvert("result", fn.returnType, "toNitro", module);
    if (fn.async) {
      methods.push(
        `override fun ${boundaryName(fn.name)}(${params}): Promise<${ret}> {`,
        "  return Promise.async {",
        ...(isVoid ? [`    ${call}`] : [`    val result = ${call}`, `    ${result}`]),
        "  }",
        "}",
        "",
      );
    } else {
      methods.push(
        `override fun ${boundaryName(fn.name)}(${params}): ${ret} {`,
        ...(fn.params.some((p) => isReference(p.type, module)) || isReference(fn.returnType, module)
          ? ["  return LucentObjectRegistry.withLock {"]
          : []),
        ...(isVoid
          ? [`  ${call}`]
          : [
              `  val result = ${call}`,
              `  ${fn.params.some((p) => isReference(p.type, module)) || isReference(fn.returnType, module) ? "" : "return "}${result}`,
            ]),
        ...(fn.params.some((p) => isReference(p.type, module)) || isReference(fn.returnType, module) ? ["  }"] : []),
        "}",
        "",
      );
    }
  }
  methods.pop();
  return [
    GENERATED_HEADER,
    `package ${ANDROID_PACKAGE}`,
    "",
    ...unit.imports.map((i) => `import ${i}`),
    "import androidx.annotation.Keep",
    "import com.facebook.proguard.annotations.DoNotStrip",
    "import com.margelo.nitro.core.ArrayBuffer",
    "import com.margelo.nitro.core.Promise",
    "",
    "@Keep",
    "@DoNotStrip",
    `class Hybrid${hybridName(module)} : Hybrid${hybridName(module)}Spec() {`,
    ...indent(methods),
    "}",
    "",
    `object ${bodiesName(module)} {`,
    ...indent(bodies),
    "}",
    "",
  ].join("\n");
}

function buildGradle(): string {
  return `apply plugin: "com.android.library"
apply plugin: "org.jetbrains.kotlin.android"
apply from: '../nitrogen/generated/android/${IOS_MODULE_NAME}+autolinking.gradle'

def safeExtGet(prop, fallback) {
  rootProject.ext.has(prop) ? rootProject.ext.get(prop) : fallback
}

android {
  namespace "${ANDROID_PACKAGE}"

  compileSdkVersion safeExtGet("compileSdkVersion", 35)
  ndkVersion safeExtGet("ndkVersion", "27.1.12297006")

  defaultConfig {
    minSdkVersion safeExtGet("minSdkVersion", 24)
    targetSdkVersion safeExtGet("targetSdkVersion", 35)

    externalNativeBuild {
      cmake {
        cppFlags "-frtti -fexceptions -Wall -fstack-protector-all"
        arguments "-DANDROID_STL=c++_shared"
        abiFilters (*reactNativeArchitectures())
      }
    }
  }

  externalNativeBuild {
    cmake {
      path "CMakeLists.txt"
    }
  }

  buildFeatures {
    buildConfig true
    prefab true
  }

  packagingOptions {
    excludes = [
      "META-INF",
      "META-INF/**",
      "**/libc++_shared.so",
      "**/libfbjni.so",
      "**/libjsi.so",
      "**/libfolly_json.so",
      "**/libfolly_runtime.so",
      "**/libglog.so",
      "**/libhermes.so",
      "**/libhermes-executor-debug.so",
      "**/libhermes_executor.so",
      "**/libreactnative.so",
      "**/libreactnativejni.so",
      "**/libturbomodulejsijni.so",
      "**/libreact_nativemodule_core.so",
      "**/libjscexecutor.so",
    ]
  }

  compileOptions {
    sourceCompatibility JavaVersion.VERSION_17
    targetCompatibility JavaVersion.VERSION_17
  }

  kotlinOptions {
    jvmTarget = "17"
  }
}

def reactNativeArchitectures() {
  def value = project.getProperties().get("reactNativeArchitectures")
  return value ? value.split(",") : ["armeabi-v7a", "x86", "x86_64", "arm64-v8a"]
}

repositories {
  mavenCentral()
  google()
}

dependencies {
  implementation "com.facebook.react:react-native:+"
  implementation project(":react-native-nitro-modules")
}
`;
}

const CMAKE = `project(${IOS_MODULE_NAME})
cmake_minimum_required(VERSION 3.9.0)

set(PACKAGE_NAME ${IOS_MODULE_NAME})
set(CMAKE_VERBOSE_MAKEFILE ON)
set(CMAKE_CXX_STANDARD 20)

add_library(\${PACKAGE_NAME} SHARED src/main/cpp/cpp-adapter.cpp)

include(\${CMAKE_SOURCE_DIR}/../nitrogen/generated/android/${IOS_MODULE_NAME}+autolinking.cmake)

include_directories("../cpp")
`;

const CPP_ADAPTER = `#include <jni.h>
#include "${IOS_MODULE_NAME}OnLoad.hpp"

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*) {
  return margelo::nitro::${ANDROID_NAMESPACE}::initialize(vm);
}
`;

const PACKAGE_KT = (ident: string, views: string[]) => `${GENERATED_HEADER}
package ${ANDROID_PACKAGE}

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfoProvider${views.length ? "\n" + views.map((name) => `import ${ANDROID_PACKAGE}.views.Hybrid${name}Manager`).join("\n") : ""}

class ${ident}Package : BaseReactPackage() {
${views.length ? `  override fun createViewManagers(reactContext: ReactApplicationContext): List<com.facebook.react.uimanager.ViewManager<*, *>> = listOf(${views.map((n) => `Hybrid${n}Manager()`).join(", ")})\n\n` : ""}  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? = null

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider { HashMap() }

  companion object {
    init {
      ${IOS_MODULE_NAME}OnLoad.initializeNative()
    }
  }
}
`;

const COMPOSE_BUILDSCRIPT = `buildscript {
  repositories { google(); mavenCentral() }
  dependencies { classpath("org.jetbrains.kotlin:compose-compiler-gradle-plugin:\${rootProject.ext.kotlinVersion}") }
}
`;
const COMPOSE_CONFIG = `
apply plugin: 'org.jetbrains.kotlin.plugin.compose'
android { buildFeatures { compose true } }
dependencies {
  implementation 'androidx.compose.ui:ui:1.7.6'
  implementation 'androidx.compose.foundation:foundation:1.7.6'
  implementation 'androidx.compose.material3:material3:1.3.1'
}
`;
