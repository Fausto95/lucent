/**
 * Nitro Modules host: one library package with a HybridObject per Lucent module.
 * nitrogen owns the boundary types (its structs, arrays, and `number` for every
 * integer), so backend bodies live in their own namespace and explicit
 * converters move values across.
 */
import type { IRModule, NativeType } from "@lucent/compiler";
import { generateSwift, swiftRuntime, swiftType, indent, signature as swiftSignature } from "@lucent/backend-swift";
import { generateKotlin, kotlinRuntime, kotlinType, signature as kotlinSignature } from "@lucent/backend-kotlin";
import type { GeneratedFunction } from "@lucent/backend-kotlin";
import {
  GENERATED_HEADER,
  runtimeImport,
  declarations,
  exportedFunctions,
  moduleIdentifier,
  proxyFunctions,
  type EmitOptions,
  type FileTree,
  type Host,
} from "@lucent/host-core";

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
          modules.map((m) => [
            hybridName(m),
            {
              ios: { language: "swift", implementationClassName: `Hybrid${hybridName(m)}` },
              android: { language: "kotlin", implementationClassName: `Hybrid${hybridName(m)}` },
            },
          ]),
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
  files.set("android/build.gradle", buildGradle());
  files.set("android/CMakeLists.txt", CMAKE);
  files.set("android/src/main/AndroidManifest.xml", "<manifest>\n</manifest>\n");
  files.set("android/src/main/cpp/cpp-adapter.cpp", CPP_ADAPTER);
  files.set(`${ANDROID_DIR}/${ident}Package.kt`, PACKAGE_KT(ident));
  files.set(`${ANDROID_DIR}/${ident}Runtime.kt`, KOTLIN_RUNTIME);
  for (const module of modules) {
    files.set(`src/specs/${hybridName(module)}.nitro.ts`, spec(module));
    files.set(`ios/Hybrid${hybridName(module)}.swift`, swiftHybrid(module));
    files.set(`${ANDROID_DIR}/Hybrid${hybridName(module)}.kt`, kotlinHybrid(module));
  }
  return files;
}

function emitProxy(module: IRModule): { js: string; dts: string } {
  const body = proxyFunctions(module, (fn, args) => `native.${fn.name}(${args.join(", ")})`, { nullAsUndefined: true });
  const js = [
    GENERATED_HEADER,
    'import { NitroModules } from "react-native-nitro-modules";',
    runtimeImport(body),
    "",
    `const native = NitroModules.createHybridObject(${JSON.stringify(hybridName(module))});`,
    "",
    body,
    "",
  ].join("\n");
  return { js, dts: GENERATED_HEADER + declarations(module) };
}

// ---- nitro spec ----------------------------------------------------------------

function specType(t: NativeType, module: IRModule): string {
  switch (t.kind) {
    case "float":
    case "int":
      return "number";
    case "bool":
      return "boolean";
    case "string":
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
  const structs = module.structs.map(
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
    return `  ${fn.name}(${params}): ${ret};`;
  });
  return [
    GENERATED_HEADER,
    "import { type HybridObject } from 'react-native-nitro-modules';",
    "",
    ...structs.flatMap((s) => [s, ""]),
    `export interface ${hybridName(module)} extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {`,
    ...methods,
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
  const unit = generateSwift(module);
  const bodies: string[] = [];
  for (const s of unit.structs) {
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
  for (const f of unit.functions) bodies.push(`static ${swiftSignature(f)} {`, ...indent(f.body), "}", "");
  bodies.pop();

  const methods: string[] = [];
  for (const fn of exportedFunctions(module)) {
    const params = fn.params.map((p) => `${p.name}: ${nitroSwiftType(p.type, module)}`).join(", ");
    const args = fn.params.map((p) => `${p.name}: ${swiftConvert(p.name, p.type, "toBody", module)}`).join(", ");
    const isVoid = fn.returnType.kind === "void";
    const call = `${bodiesName(module)}.${fn.name}(${args})`;
    const result = isVoid ? "" : swiftConvert("result", fn.returnType, "toNitro", module);
    if (fn.async) {
      const ret = nitroSwiftType(fn.returnType, module);
      methods.push(
        `func ${fn.name}(${params}) throws -> Promise<${ret}> {`,
        "  return Promise.async {",
        ...(isVoid ? [`    try await ${call}`] : [`    let result = try await ${call}`, `    return ${result}`]),
        "  }",
        "}",
        "",
      );
    } else {
      methods.push(
        `func ${fn.name}(${params}) throws -> ${nitroSwiftType(fn.returnType, module)} {`,
        ...(isVoid ? [`  try ${call}`] : [`  let result = try ${call}`, `  return ${result}`]),
        "}",
        "",
      );
    }
  }
  methods.pop();
  return [
    GENERATED_HEADER,
    "import Foundation",
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
  const unit = generateKotlin(module);
  const bodies: string[] = [];
  for (const s of unit.structs) {
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
        `override fun ${fn.name}(${params}): Promise<${ret}> {`,
        "  return Promise.async {",
        ...(isVoid ? [`    ${call}`] : [`    val result = ${call}`, `    ${result}`]),
        "  }",
        "}",
        "",
      );
    } else {
      methods.push(
        `override fun ${fn.name}(${params}): ${ret} {`,
        ...(isVoid ? [`  ${call}`] : [`  val result = ${call}`, `  return ${result}`]),
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

const PACKAGE_KT = (ident: string) => `${GENERATED_HEADER}
package ${ANDROID_PACKAGE}

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfoProvider

class ${ident}Package : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? = null

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider { HashMap() }

  companion object {
    init {
      ${IOS_MODULE_NAME}OnLoad.initializeNative()
    }
  }
}
`;
