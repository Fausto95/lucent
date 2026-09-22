import { emitNativePackages } from "@lucent-lang/host-core";
import { emitViews, nativeViewEvent } from "./views.ts";
/**
 * Expo Modules host (SDK 58): wraps backend output in an autolinked local
 * module folder. Swift uses the macro API, Kotlin the definition DSL.
 */
import type { IRModule, IRStruct, NativeType } from "@lucent-lang/compiler";
import {
  generateSwift,
  swiftClass,
  swiftObjectRuntime,
  swiftRuntime,
  swiftEventRuntime,
  indent as indentSwift,
  signature as swiftSignature,
} from "@lucent-lang/backend-swift";
import {
  generateKotlin,
  kotlinClass,
  kotlinObjectRuntime,
  kotlinRuntime,
  kotlinEventRuntime,
  kotlinType,
  indent as indentKotlin,
  signature as kotlinSignature,
} from "@lucent-lang/backend-kotlin";
import type { GeneratedFunction, GeneratedStruct } from "@lucent-lang/backend-kotlin";
import {
  exportedViews,
  viewName,
  viewProps,
  withoutViews,
  isReference,
  classProxies,
  GENERATED_HEADER,
  runtimeImport,
  declarations,
  moduleIdentifier,
  proxyFunctions,
  type EmitOptions,
  type FileTree,
  type Host,
} from "@lucent-lang/host-core";

export const ANDROID_PACKAGE = "expo.modules.lucent";
export const nativeModuleName = (module: IRModule): string => `Lucent_${module.name}`;
export const moduleClassName = (module: IRModule): string => `Lucent${moduleIdentifier(module.name)}Module`;

export const expoHost: Host = {
  name: "expo",
  emitPackage,
  emitProxy,
};

function emitPackage(modules: IRModule[], options: EmitOptions): FileTree {
  const files: FileTree = new Map();
  const ident = moduleIdentifier(options.packageName);
  const androidDir = `android/src/main/java/${ANDROID_PACKAGE.replace(/\./g, "/")}`;
  files.set(
    "expo-module.config.json",
    JSON.stringify(
      {
        platforms: ["apple", "android"],
        apple: {
          modules: modules.flatMap((m) => [
            moduleClassName(m),
            ...exportedViews(m).map((f) => `${viewName(m, f)}Module`),
          ]),
        },
        android: {
          modules: modules
            .flatMap((m) => [moduleClassName(m), ...exportedViews(m).map((f) => `${viewName(m, f)}Module`)])
            .map((n) => `${ANDROID_PACKAGE}.${n}`),
        },
      },
      null,
      2,
    ) + "\n",
  );
  files.set(
    "package.json",
    JSON.stringify({ name: `${options.packageName}-native`, version: "0.0.0", private: true }, null, 2) + "\n",
  );
  files.set(".gitignore", "*\n");
  files.set(`ios/${ident}.podspec`, podspec(ident));
  files.set(`ios/${ident}Runtime.swift`, SWIFT_RUNTIME);
  files.set(
    "android/build.gradle",
    modules.some((m) => exportedViews(m).length) ? COMPOSE_BUILDSCRIPT + BUILD_GRADLE + COMPOSE_CONFIG : BUILD_GRADLE,
  );
  files.set("android/src/main/AndroidManifest.xml", "<manifest>\n</manifest>\n");
  files.set(`${androidDir}/${ident}Runtime.kt`, KOTLIN_RUNTIME);
  for (const module of modules) {
    files.set(`ios/${moduleClassName(module)}.swift`, swiftModule(module));
    files.set(`${androidDir}/${moduleClassName(module)}.kt`, kotlinModule(module));
  }
  if (modules.some((m) => m.events?.length)) {
    files.set("ios/LucentEvents.swift", swiftEventRuntime);
    files.set(`${androidDir}/LucentEvents.kt`, `package ${ANDROID_PACKAGE}\n\n` + kotlinEventRuntime);
  }
  if (modules.some((m) => m.structs.some((s) => s.reference))) {
    files.set("ios/LucentObjects.swift", swiftObjectRuntime);
    files.set(`${androidDir}/LucentObjects.kt`, `package ${ANDROID_PACKAGE}\n\n` + kotlinObjectRuntime);
    for (const s of modules.flatMap((m) => m.structs).filter((item) => item.reference)) {
      files.set(`ios/${s.name}.swift`, swiftClass(s));
      files.set(`${androidDir}/${s.name}.kt`, `package ${ANDROID_PACKAGE}\n\n` + kotlinClass(s));
    }
  }
  emitNativePackages(files, modules, ANDROID_PACKAGE);
  emitViews(files, modules, ANDROID_PACKAGE);
  return files;
}

function emitProxy(module: IRModule): { js: string; dts: string } {
  const body =
    proxyFunctions(module, (fn, args) => `native.${fn.name}(${args.join(", ")})`) +
    (module.structs.some((s) => s.reference) ? "\n\n" + classProxies(module, false) : "");
  const js = [
    GENERATED_HEADER,
    ...(exportedViews(module).length ? ['import { createElement } from "react";'] : []),
    `import { requireNativeModule${exportedViews(module).length ? ", requireNativeViewManager" : ""} } from "expo-modules-core";`,
    runtimeImport(body),
    "",
    `const native = requireNativeModule(${JSON.stringify(nativeModuleName(module))});`,
    "",
    body,
    ...(module.events ?? [])
      .filter((e) => e.exported)
      .map(
        (e) =>
          `export const ${e.name} = { subscribe(listener) { return native.addListener(${JSON.stringify(e.name)}, (event) => listener(JSON.parse(event.json))); } };`,
      ),
    ...exportedViews(module).map((f) => {
      const events = viewProps(module, f).filter((p) => p.type.kind === "event");
      const mapped = events
        .map(
          (p) =>
            `${nativeViewEvent(module, f, p.name)}: ${p.type.kind === "event" && p.type.payload.kind !== "void" ? `(event) => props.${p.name}?.(event.nativeEvent.payload)` : `props.${p.name}`}`,
        )
        .join(", ");
      const cleared = events.map((p) => `${p.name}: undefined`).join(", ");
      return `const ${f.name}Native = requireNativeViewManager(${JSON.stringify(viewName(module, f))});\nexport function ${f.name}(props) { return createElement(${f.name}Native, { ...props${cleared ? ", " + cleared : ""}${mapped ? ", " + mapped : ""} }); }`;
    }),
    "",
  ].join("\n");
  return { js, dts: GENERATED_HEADER + declarations(module) };
}

// ---- Swift -------------------------------------------------------------------

const SWIFT_RUNTIME =
  GENERATED_HEADER +
  "import ExpoModulesCore\n" +
  swiftRuntime(
    {
      length: "return Double(buffer.byteLength)",
      get: "return buffer.withUnsafeBytes { Double($0[Int(index)]) }",
      data: "return buffer.data",
      fromData: "return try ArrayBuffer.copy(data: data)",
    },
    `/** Reaches JavaScript as a CodedError with \`code\`. */
final class LucentError: Exception {
  let message: String

  init(code: String, message: String? = nil, metadata: [String: Any] = [:]) {
    self.message = lucentErrorWire(code, message ?? code, metadata)
    super.init(name: "LucentError", description: self.message, code: code)
  }

  override var reason: String {
    return message
  }
}`,
  );

function swiftModule(module: IRModule): string {
  const unit = generateSwift(withoutViews(module));
  const concurrent = unit.functions.some((f) => f.async);
  const members: string[] = [];
  const events = (module.events ?? []).filter((e) => e.exported);
  if (events.length)
    members.push(
      "private var eventTokens: [Int] = []",
      "public func definition() -> ModuleDefinition {",
      `  Events(${events.map((e) => JSON.stringify(e.name)).join(", ")})`,
      "  OnCreate { [weak self] in",
      "    guard let self else { return }",
      ...events.map(
        (e) =>
          `    self.eventTokens.append(LucentEventHub.shared.subscribe(${JSON.stringify(e.id)}) { [weak self] json in self?.sendEvent(${JSON.stringify(e.name)}, ["json": json]) })`,
      ),
      "  }",
      "  OnDestroy { [weak self] in self?.eventTokens.forEach { LucentEventHub.shared.remove($0) }; self?.eventTokens.removeAll() }",
      "}",
      "",
    );
  for (const s of unit.structs.filter((item) => !item.reference)) {
    members.push(`@Record`, `struct ${s.name} {`, ...s.fields.map((f) => `  var ${f.name}: ${f.type}`), `}`, "");
  }
  if (module.structs.some((s) => s.reference))
    members.push("@JS func lucentRelease(handle: Double) { LucentObjectRegistry.shared.release(handle) }", "");
  for (const f of unit.functions) {
    const ir = module.functions.find((fn) => fn.name === f.name)!;
    const bridged = ir.params.some((p) => isReference(p.type, module)) || isReference(ir.returnType, module);
    if (f.exported && bridged) {
      const params = ir.params
        .map((p, i) => `${p.name}: ${isReference(p.type, module) ? "Double" : f.params[i]!.type}`)
        .join(", ");
      const args = ir.params
        .map(
          (p) =>
            `${p.name}: ${isReference(p.type, module) && p.type.kind === "struct" ? `try ${f.async ? "lucentLeases" : "LucentObjectRegistry.shared"}.get(${p.name}, ${p.type.name}.self)` : p.name}`,
        )
        .join(", ");
      members.push(
        `@JS("${f.name}"${f.async ? ", .concurrent" : ""})`,
        `func __bridge_${f.name}(${params})${f.async ? " async" : ""} throws -> ${isReference(ir.returnType, module) ? "Double" : f.returnType} {`,
        ...(f.async && ir.params.some((p) => isReference(p.type, module))
          ? [
              `  let lucentLeases = try LucentObjectRegistry.shared.acquireMany([${ir.params
                .filter((p) => isReference(p.type, module))
                .map((p) => p.name)
                .join(", ")}])`,
              "  defer { lucentLeases.close() }",
            ]
          : []),
        ...(f.async ? [] : ["  return try LucentObjectRegistry.shared.withLock {"]),
        `    let result = try ${f.async ? "await " : ""}${f.name}(${args})`,
        `    return ${isReference(ir.returnType, module) ? "LucentObjectRegistry.shared.hold(result)" : "result"}`,
        ...(f.async ? [] : ["  }"]),
        "}",
        "",
      );
    }
    if (f.exported && !bridged) members.push(f.async ? "@JS(.concurrent)" : "@JS");
    members.push(
      `${swiftSignature(f)} {`,
      ...indentSwift(
        f.body.map((line) =>
          f.thread === "worker" ? line.replace("Task.detached {", "Task.detached { [self] in") : line,
        ),
      ),
      "}",
      "",
    );
  }
  members.pop();
  return [
    GENERATED_HEADER,
    "import ExpoModulesCore",
    ...unit.imports.map((i) => `import ${i}`),
    "",
    `@ExpoModule(${JSON.stringify(nativeModuleName(module))})`,
    `public final class ${moduleClassName(module)}: Module${concurrent ? ", @unchecked Sendable" : ""} {`,
    ...indentSwift(members),
    "}",
    "",
  ].join("\n");
}

function podspec(ident: string): string {
  return `Pod::Spec.new do |s|
  s.name           = '${ident}'
  s.version        = '0.0.0'
  s.summary        = 'Native code generated by Lucent'
  s.description    = 'Swift generated ahead of time from *.lucent.ts files.'
  s.author         = ''
  s.homepage       = 'https://github.com/Fausto95/lucent'
  s.platforms      = { :ios => '16.4', :tvos => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
`;
}

// ---- Kotlin ------------------------------------------------------------------

const KOTLIN_RUNTIME =
  GENERATED_HEADER +
  kotlinRuntime(
    {
      imports: ["import expo.modules.kotlin.exception.CodedException", "import expo.modules.kotlin.jni.ArrayBuffer"],
      length: "return buffer.size().toDouble()",
      get: "return (buffer.readByte(index.toInt()).toInt() and 0xff).toDouble()",
      toByteArray:
        "val source = buffer.toDirectBuffer().duplicate(); source.rewind(); return ByteArray(source.remaining()).also { source.get(it) }",
      fromByteArray:
        "val buffer = java.nio.ByteBuffer.allocateDirect(bytes.size); buffer.put(bytes); buffer.flip(); return ArrayBuffer(buffer)",
    },
    ANDROID_PACKAGE,
    "class LucentError(code: String, message: String? = null, val metadata: Map<String, Any?> = emptyMap()) : CodedException(code, lucentErrorWire(code, message ?: code, metadata), null)",
  );

const BUILD_GRADLE = `plugins {
  id 'com.android.library'
  id 'expo-module-gradle-plugin'
}

group = '${ANDROID_PACKAGE}'
version = '0.0.0'

android {
  namespace "${ANDROID_PACKAGE}"
  defaultConfig {
    versionCode 1
    versionName "0.0.0"
  }
  lintOptions {
    abortOnError false
  }
}
`;

/** Expo's Kotlin bridge converts Boolean/Int/Long/Float/Double/String; narrower and unsigned ints cross as Int/Long. */
const KOTLIN_BOUNDARY: Readonly<Record<string, { type: string; into: string; outOf: string }>> = {
  Byte: { type: "Int", into: ".toByte()", outOf: ".toInt()" },
  Short: { type: "Int", into: ".toShort()", outOf: ".toInt()" },
  UByte: { type: "Int", into: ".toUByte()", outOf: ".toInt()" },
  UShort: { type: "Int", into: ".toUShort()", outOf: ".toInt()" },
  UInt: { type: "Long", into: ".toUInt()", outOf: ".toLong()" },
  ULong: { type: "Long", into: ".toULong()", outOf: ".toLong()" },
};

/** Default values Expo `Record` fields need on Android. */
function kotlinDefault(t: NativeType, structs: ReadonlyMap<string, IRStruct>): string {
  switch (t.kind) {
    case "optional":
      return "null";
    case "string":
      return '""';
    case "bool":
      return "false";
    case "float":
      return t.bits === 32 ? "0f" : "0.0";
    case "int":
      if (t.bits !== 32 && t.bits !== 64)
        throw new Error(`Expo host: ${kotlinType(t)} struct fields are not supported on Android yet.`);
      return t.signed
        ? t.bits === 64
          ? "0L"
          : "0"
        : (() => {
            throw new Error(`Expo host: unsigned struct fields are not supported on Android yet.`);
          })();
    case "array":
      return "mutableListOf()";
    case "map":
      return "emptyMap()";
    case "bytes":
      return "ArrayBuffer.allocate(0)";
    case "struct":
      if (!structs.has(t.name)) throw new Error(`Expo host: unknown struct ${t.name}`);
      return `${t.name}()`;
    case "callback":
      throw new Error("Native callbacks cannot cross the JavaScript boundary.");
    case "event":
    case "view":
    case "void":
    case "promise":
      throw new Error(`Expo host: ${t.kind} cannot be a struct field.`);
  }
}

function kotlinModule(module: IRModule): string {
  const unit = generateKotlin(withoutViews(module));
  const structs = new Map(module.structs.map((s) => [s.name, s]));
  const members: string[] = [];
  for (const s of unit.structs.filter((item) => !item.reference))
    members.push(...kotlinRecord(s, structs.get(s.name)!, structs), "");
  const definition: string[] = [`Name(${JSON.stringify(nativeModuleName(module))})`];
  const events = (module.events ?? []).filter((e) => e.exported);
  if (events.length) {
    members.push("private val eventTokens = mutableListOf<Int>()");
    definition.push(
      `Events(${events.map((e) => JSON.stringify(e.name)).join(", ")})`,
      "OnCreate {",
      ...events.map(
        (e) =>
          `  eventTokens.add(LucentEventHub.subscribe(${JSON.stringify(e.id)}) { json -> sendEvent(${JSON.stringify(e.name)}, mapOf("json" to json)) })`,
      ),
      "}",
      "OnDestroy { eventTokens.forEach { LucentEventHub.remove(it) }; eventTokens.clear() }",
    );
  }
  if (module.structs.some((s) => s.reference))
    definition.push('Function("lucentRelease") { handle: Double -> LucentObjectRegistry.release(handle) }');
  for (const f of unit.functions.filter((x) => x.exported)) {
    const ir = module.functions.find((fn) => fn.name === f.name)!;
    const bridged = ir.params.some((p) => isReference(p.type, module)) || isReference(ir.returnType, module);
    if (!bridged) {
      definition.push("", ...kotlinBinding(f));
      continue;
    }
    const params = ir.params
      .map(
        (p, i) =>
          `${p.name}: ${isReference(p.type, module) ? "Double" : (KOTLIN_BOUNDARY[f.params[i]!.type]?.type ?? f.params[i]!.type)}`,
      )
      .join(", ");
    const args = ir.params
      .map((p, i) =>
        isReference(p.type, module) && p.type.kind === "struct"
          ? `${f.async ? "lucentLeases" : "LucentObjectRegistry"}.get(${p.name}, ${p.type.name}::class.java)`
          : `${p.name}${KOTLIN_BOUNDARY[f.params[i]!.type]?.into ?? ""}`,
      )
      .join(", ");
    definition.push(
      `${f.async ? `AsyncFunction("${f.name}") Coroutine` : `Function("${f.name}")`} {${params ? ` ${params} ->` : ""}`,
      ...(f.async && ir.params.some((p) => isReference(p.type, module))
        ? [
            `  val lucentLeases = LucentObjectRegistry.acquireMany(listOf(${ir.params
              .filter((p) => isReference(p.type, module))
              .map((p) => p.name)
              .join(", ")}))`,
            "  try {",
          ]
        : []),
      ...(f.async ? [] : ["  LucentObjectRegistry.withLock {"]),
      `    val result = ${f.name}(${args})`,
      `    ${isReference(ir.returnType, module) ? "LucentObjectRegistry.hold(result)" : `result${KOTLIN_BOUNDARY[f.returnType]?.outOf ?? ""}`}`,
      ...(f.async && ir.params.some((p) => isReference(p.type, module))
        ? ["  } finally { lucentLeases.close() }"]
        : []),
      ...(f.async ? [] : ["  }"]),
      "}",
    );
  }
  members.push("override fun definition() = ModuleDefinition {", ...indentKotlin(definition), "}", "");
  for (const f of unit.functions) members.push(`private ${kotlinSignature(f)} {`, ...indentKotlin(f.body), "}", "");
  members.pop();
  return [
    GENERATED_HEADER,
    `package ${ANDROID_PACKAGE}`,
    "",
    ...unit.imports.map((i) => `import ${i}`),
    "import expo.modules.kotlin.functions.Coroutine",
    "import expo.modules.kotlin.jni.ArrayBuffer",
    "import expo.modules.kotlin.modules.Module",
    "import expo.modules.kotlin.modules.ModuleDefinition",
    "import expo.modules.kotlin.records.Field",
    "import expo.modules.kotlin.records.Record",
    "",
    `class ${moduleClassName(module)} : Module() {`,
    ...indentKotlin(members),
    "}",
    "",
  ].join("\n");
}

/** Constructor-parameter Records: named construction for the backend bodies, defaults for the JS bridge. */
function kotlinRecord(s: GeneratedStruct, ir: IRStruct, structs: ReadonlyMap<string, IRStruct>): string[] {
  const fields = ir.fields.map(
    (f, i) => `  @Field var ${f.name}: ${s.fields[i]!.type} = ${kotlinDefault(f.type, structs)},`,
  );
  fields[fields.length - 1] = fields[fields.length - 1]!.replace(/,$/, "");
  return [`class ${s.name}(`, ...fields, ") : Record"];
}

/** `Function("name") { a: Double -> name(a) }` or its `AsyncFunction … Coroutine` form, with boundary conversions. */
function kotlinBinding(f: GeneratedFunction): string[] {
  const params = f.params.map((p) => `${p.name}: ${KOTLIN_BOUNDARY[p.type]?.type ?? p.type}`);
  const args = f.params.map((p) => `${p.name}${KOTLIN_BOUNDARY[p.type]?.into ?? ""}`);
  const call = `${f.name}(${args.join(", ")})${KOTLIN_BOUNDARY[f.returnType]?.outOf ?? ""}`;
  const head = f.async
    ? `AsyncFunction(${JSON.stringify(f.name)}) Coroutine {`
    : `Function(${JSON.stringify(f.name)}) {`;
  const arrow = params.length ? ` ${params.join(", ")} ->` : f.async ? " ->" : "";
  return [`${head}${arrow}`, `  ${call}`, "}"];
}

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
