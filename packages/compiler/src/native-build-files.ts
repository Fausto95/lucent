/**
 * The native package's build files, from the runtime's templates and what
 * the build resolved: plain text in, text out.
 */
import { xml } from "@lucent-lang/codegen";
import type {
  ManifestComponent,
  NativeInputs,
  SwiftPackage,
  SwiftPackageRequirement,
} from "./package-config.ts";
import { inNativePackage, type PackagePath } from "./package-files.ts";

/** What the iOS code links, as the podspec declares it. Paths are relative to the native package. */
export interface PodspecInputs {
  /** Apple frameworks, in order. */
  frameworks: string[];
  /** Whether the pod has Swift sources. */
  swift: boolean;
  /** Lucent packages' pods: pod name → its version requirements. */
  pods: [string, string[]][];
  /** Other pods the iOS code imports modules of: the app's Podfile decides their versions. */
  importedPods: string[];
  /** Directories of Lucent packages' sources, compiled into the pod. */
  sources: string[];
  /** Copied to the app bundle's root. */
  resources: string[];
  /** Bundle name → what it holds. */
  resourceBundles: [string, string[]][];
  vendoredFrameworks: string[];
  /** Package URL → its requirement and the products the pod links. */
  swiftPackages: [string, SwiftPackage][];
  /** The lowest iOS version the packages run on, if they need one. */
  deploymentTarget?: string;
}

/** The source files CocoaPods compiles in a package's source directory. */
const POD_SOURCES = "**/*.{h,hpp,m,mm,c,cc,cpp,swift}";

/** A Ruby (and Groovy) array of strings. */
const list = (items: string[]) => `[${items.map((i) => JSON.stringify(i)).join(", ")}]`;

/** A Ruby hash with symbol keys: `{ kind: "exactVersion", version: "1.0.0" }`. */
const rubyHash = (r: SwiftPackageRequirement) =>
  `{ ${Object.entries(r)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join(", ")} }`;

/** The podspec's closing line: what the build's lines go before. */
const CLOSING_END = /^end\s*$/m;

/** LucentNative.podspec: the template with the frameworks, sources, resources and pods the build needs. */
export function podspec(template: string, inputs: PodspecInputs): string {
  let text = template.replace(
    /s\.frameworks\s*=.*$/m,
    () => `s.frameworks   = ${list([...new Set(inputs.frameworks)])}`,
  );

  // Never lower than React Native's own minimum; CocoaPods reports an app target below it.
  if (inputs.deploymentTarget)
    text = text.replace(
      /^(\s*s\.platforms\s*=\s*\{ :ios => )min_ios_version_supported \}$/m,
      (_, head: string) =>
        `${head}[min_ios_version_supported, ${JSON.stringify(inputs.deploymentTarget)}].max_by { |v| Gem::Version.new(v) } }`,
    );

  if (inputs.sources.length) {
    const patterns = inputs.sources.map((dir) => `${dir}/${POD_SOURCES}`);
    const searchPaths = inputs.sources.map((dir) => `\\"$(PODS_TARGET_SRCROOT)/${dir}\\"`);

    text = text
      .replace(
        /^(\s*s\.source_files\s*=\s*\[.*)\]$/m,
        (_, head: string) => `${head}, ${patterns.map((p) => JSON.stringify(p)).join(", ")}]`,
      )
      // A package's headers are found by name, as next to its sources.
      .replace(
        /^(\s*"HEADER_SEARCH_PATHS" => ".*)",$/m,
        (_, head: string) => `${head} ${searchPaths.join(" ")}",`,
      );
  }

  // Swift shims (Swift-only iOS APIs) or packages' Swift make it a Swift pod, only when there are any.
  if (inputs.swift) {
    const headers = [
      "cpp/**/*.{h,inc}",
      "ios/**/*.h",
      ...inputs.sources.map((dir) => `${dir}/**/*.{h,hpp}`),
    ];

    text = text
      .replace(/^(\s*s\.source_files\s*=\s*\["cpp\/\*\*\/\*\.\{[\w,]+)\}/m, "$1,swift}")
      // The module CocoaPods makes for Swift leaves the C++ headers out:
      // Swift imports it without C++ interop.
      .replace(
        /^(\s*s\.source_files\s*=.*)$/m,
        (line: string) =>
          `${line}\n  s.swift_version = "5.9"\n  s.private_header_files = ${list(headers)}`,
      );
  }

  const lines = [
    ...(inputs.resources.length ? [`  s.resources = ${list(inputs.resources)}`] : []),
    ...(inputs.resourceBundles.length
      ? [
          `  s.resource_bundles = { ${inputs.resourceBundles
            .map(([name, paths]) => `${JSON.stringify(name)} => ${list(paths)}`)
            .join(", ")} }`,
        ]
      : []),
    ...(inputs.vendoredFrameworks.length
      ? [`  s.vendored_frameworks = ${list(inputs.vendoredFrameworks)}`]
      : []),
    ...inputs.pods.map((pod) => podLine(pod)),
    ...inputs.importedPods.map((pod) => podLine([pod, []], false)),
    // React Native's helper (react_native_pods.rb) adds them to the pod's target at pod install.
    ...inputs.swiftPackages.map(
      ([url, { requirement, products }]) =>
        `  spm_dependency(s, url: ${JSON.stringify(url)}, requirement: ${rubyHash(requirement)}, products: ${list(products)})`,
    ),
  ];

  return lines.length ? text.replace(CLOSING_END, () => `${lines.join("\n")}\nend`) : text;
}

/** Ends a podspec line that a Lucent package's lucent.json asks for. */
const PACKAGE_POD = " # lucent.json";

/** A pod's line in a podspec: the pod, then its version requirements; marked when a package asks for it. */
const podLine = ([pod, requirements]: [string, string[]], fromPackage = true) =>
  `  s.dependency ${[pod, ...requirements].map((r) => JSON.stringify(r)).join(", ")}${fromPackage ? PACKAGE_POD : ""}`;

/**
 * `podspec` depending on the Lucent packages' `pods` as given: each pod's
 * line is replaced in place, a missing one is added before the closing
 * `end`, and a marked one no package asks for any more is dropped. The pods
 * the iOS code imports, unmarked, stay; and the same pods make the same
 * text. Lines may end in whitespace or `\r`.
 */
export function withPodDependencies(podspec: string, pods: [string, string[]][]): string {
  const wanted = new Map(pods);
  const done = new Set<string>();
  const lines = podspec.split("\n").flatMap((line) => {
    const pod = /^\s*s\.dependency "([^"]+)"/.exec(line)?.[1];
    if (pod === undefined) return [line];

    const requirements = wanted.get(pod);
    if (requirements) {
      if (done.has(pod)) return [];

      done.add(pod);
      return [podLine([pod, requirements])];
    }

    return line.trimEnd().endsWith(PACKAGE_POD) ? [] : [line];
  });
  const missing = pods.filter(([pod]) => !done.has(pod)).map((pod) => podLine(pod));
  if (!missing.length) return lines.join("\n");

  const end = lines.findIndex((line) => CLOSING_END.test(line));
  if (end < 0) throw new Error('a podspec without its closing "end" line: no place for pods');

  lines.splice(end, 0, ...missing);
  return lines.join("\n");
}

/** The files of `p` in the native package: `p` itself for a listed file. */
function filesOf(native: NativeInputs, p: PackagePath): string[] {
  const at = inNativePackage(p);

  return [...native.files.keys()].filter((f) => f === at || f.startsWith(`${at}/`));
}

/** Listed paths as the Android library (android/) refers to them. */
const fromAndroid = (paths: PackagePath[]) => paths.map((p) => `../${inNativePackage(p)}`);

/** The kotlinx-coroutines the Kotlin shims run suspend functions with: Gradle picks the app's if newer. */
export const COROUTINES = "org.jetbrains.kotlinx:kotlinx-coroutines-core:1.7.3";

/** The Compose libraries components' content uses, at the versions of one Compose release. */
export const COMPOSE_BOM = "androidx.compose:compose-bom:2026.03.00";

/** What any Compose content depends on. */
const COMPOSE_BASE = [
  "androidx.compose.runtime:runtime",
  "androidx.compose.ui:ui",
  "androidx.compose.foundation:foundation",
  "androidx.compose.animation:animation",
];

/** What content depends on when its Kotlin imports a package of the library's group. */
const COMPOSE_WHEN_IMPORTED = ["androidx.compose.material3:material3"];

/** Every Compose library content may use: lucent:compose binds them all. */
export const COMPOSE_LIBRARIES = [...COMPOSE_BASE, ...COMPOSE_WHEN_IMPORTED];

/**
 * Compose content, as the Android library's build needs to know it: its
 * Kotlin sources, or `unknown` for a build that configures the library
 * before the content is compiled (a deferred build).
 */
export type ComposeContent = readonly string[] | "unknown";

/**
 * The Compose libraries Compose content depends on: Compose's own, and a
 * library of COMPOSE_WHEN_IMPORTED when its Kotlin imports a package of
 * its group (`androidx.compose.material3.Text`); all of them when the
 * content is unknown.
 */
function composeLibraries(kotlin: ComposeContent): string[] {
  if (kotlin === "unknown") return COMPOSE_LIBRARIES;

  const imports = kotlin.flatMap((text) =>
    [...text.matchAll(/^import ([\w.]+)$/gm)].map((m) => m[1]!),
  );
  const imported = COMPOSE_WHEN_IMPORTED.filter((library) => {
    const group = library.slice(0, library.indexOf(":"));
    return imports.some((i) => i.startsWith(`${group}.`));
  });

  return [...COMPOSE_BASE, ...imported];
}

/**
 * The view model store owner the runtime's host of Compose content finds
 * for a window without one: the version Compose's own lifecycle artifacts
 * need at least (Gradle picks the app's if newer).
 */
export const LIFECYCLE_VIEWMODEL = "androidx.lifecycle:lifecycle-viewmodel:2.8.7";

/**
 * What builds components' Compose content: the Compose compiler plugin,
 * at the version of the app's Kotlin plugin (the app's `kotlinVersion`,
 * else the Kotlin Gradle plugin its build script loads), which Compose
 * requires.
 */
const COMPOSE_BUILDSCRIPT = `// Components' Compose content: the Compose compiler matches the app's Kotlin.
buildscript {
  def kotlinPlugin = rootProject.ext.has("kotlinVersion")
    ? rootProject.ext.get("kotlinVersion")
    : rootProject.buildscript.configurations.classpath.resolvedConfiguration.resolvedArtifacts
        .find { it.moduleVersion.id.group == "org.jetbrains.kotlin" && it.name == "kotlin-gradle-plugin" }
        ?.moduleVersion?.id?.version
  repositories {
    google()
    mavenCentral()
  }
  dependencies {
    classpath("org.jetbrains.kotlin:compose-compiler-gradle-plugin:\${kotlinPlugin}")
  }
}
`;

/**
 * The library's build.gradle: Lucent packages' Gradle artifacts, every
 * version asked for (Gradle picks one), their libraries (api: the app's
 * compile classpath sees them), and their sources, resources, assets and
 * native libraries; the Kotlin shims the program calls (`shims`),
 * compiled with kotlinx-coroutines; and components' Compose content
 * (`compose`: its Kotlin sources, none without), with the Compose
 * compiler, the libraries it uses, and the runtime's host of it.
 */
export function libraryBuildGradle(
  template: string,
  native: NativeInputs | undefined,
  shims = false,
  composeContent: ComposeContent = [],
): string {
  const compose = composeContent === "unknown" || composeContent.length > 0;
  const android = native?.manifest.android;
  let text = template;

  // A package's minimum raises the library's; Android's manifest merger reports an app below it.
  if (android?.minSdk)
    text = text.replace(
      /^(\s*minSdk )(safeExtGet\("minSdkVersion", \d+\))$/m,
      (_, head: string, app: string) => `${head}Math.max(${app} as int, ${android.minSdk!.value})`,
    );

  const kotlin =
    shims ||
    compose ||
    !!android?.nativeSources.some((p) => filesOf(native!, p).some((f) => f.endsWith(".kt")));
  if (kotlin)
    text = text.replace(
      /^(apply plugin: "com\.android\.library")$/m,
      '$1\napply plugin: "org.jetbrains.kotlin.android"',
    );

  if (compose)
    text = text
      .replace(
        /^(apply plugin: "com\.android\.library")$/m,
        (line) => `${COMPOSE_BUILDSCRIPT}\n${line}`,
      )
      .replace(
        /^(apply plugin: "org\.jetbrains\.kotlin\.android")$/m,
        '$1\napply plugin: "org.jetbrains.kotlin.plugin.compose"',
      )
      .replace(
        /^dependencies \{$/m,
        [
          "android {",
          "  buildFeatures {",
          "    compose true",
          "  }",
          "  // The runtime's host of Compose content.",
          '  sourceSets.main.java.srcDirs += "src/compose/java"',
          "}",
          "",
          "dependencies {",
        ].join("\n"),
      );

  const srcDirs = (
    [
      ["java", android?.nativeSources ?? []],
      ["res", android?.resources ?? []],
      ["assets", android?.assets ?? []],
      ["jniLibs", android?.nativeLibraries ?? []],
    ] as const
  )
    .filter(([, paths]) => paths.length)
    .map(([set, paths]) => `      ${set}.srcDirs += ${list(fromAndroid(paths))}`);

  if (srcDirs.length)
    text = text.replace(
      /^dependencies \{$/m,
      () =>
        `// Lucent packages' sources, resources and native libraries (their lucent.json).\nandroid {\n  sourceSets {\n    main {\n${srcDirs.join("\n")}\n    }\n  }\n}\n\ndependencies {`,
    );

  const deps = [
    ...fromAndroid(android?.libraries ?? []).map((f) => `  api(files(${JSON.stringify(f)}))`),
    ...Object.entries(android?.dependencies ?? {}).flatMap(([artifact, versions]) =>
      Object.keys(versions)
        .sort()
        .map((v) => `  api(${JSON.stringify(`${artifact}:${v}`)})`),
    ),
    ...(shims ? [`  implementation(${JSON.stringify(COROUTINES)})`] : []),
    ...(compose
      ? [
          `  implementation(platform(${JSON.stringify(COMPOSE_BOM)}))`,
          ...[...composeLibraries(composeContent), LIFECYCLE_VIEWMODEL].map(
            (l) => `  implementation(${JSON.stringify(l)})`,
          ),
        ]
      : []),
  ];

  return deps.length
    ? text.replace(/^dependencies \{\n/m, () => `dependencies {\n${deps.join("\n")}\n`)
    : text;
}

/**
 * android/packages.cmake, which the runtime's CMakeLists includes: Lucent
 * packages' C and C++ sources in the runtime's target, and their
 * directories for their headers. Undefined when there are none.
 */
export function packagesCmake(native: NativeInputs | undefined): string | undefined {
  if (!native) return undefined;

  const dirs = native.manifest.android.nativeSources;
  const sources = dirs.flatMap((p) => filesOf(native, p)).filter((f) => /\.(c|cc|cpp)$/.test(f));
  const includes = dirs
    .filter((p) => filesOf(native, p).some((f) => /\.(c|cc|cpp|h|hpp)$/.test(f)))
    .map((p) => inNativePackage(p));

  if (!sources.length && !includes.length) return undefined;

  const block = (head: string, paths: string[]) =>
    paths.length ? `${head}\n${paths.map((p) => `  \${LUCENT_ROOT}/${p}`).join("\n")}\n)\n` : "";

  return [
    "# Generated by Lucent. Do not edit.",
    "# Lucent packages' C and C++ sources (their lucent.json android.nativeSources).",
    block("target_sources(lucentnative PRIVATE", sources),
    block("target_include_directories(lucentnative PUBLIC", includes),
  ]
    .filter(Boolean)
    .join("\n");
}

/** A component's fields written as attributes, in this order. */
const COMPONENT_ATTRIBUTES = [
  "name",
  "exported",
  "enabled",
  "permission",
  "authorities",
  "grantUriPermissions",
  "foregroundServiceType",
  "theme",
  "configChanges",
] as const satisfies (keyof ManifestComponent)[];

/**
 * The runtime's own components, in every app: Activity tracking started
 * with the process (before any Activity or JavaScript), and the translucent
 * Activity that asks for activity results and permissions for Lucent code.
 */
const RUNTIME_COMPONENTS: ManifestComponent[] = [
  {
    kind: "provider",
    name: "dev.lucent.LucentInitializer",
    exported: false,
    authorities: "${applicationId}.lucent-initializer",
  },
  {
    kind: "activity",
    name: "dev.lucent.LucentRequestActivity",
    exported: false,
    theme: "@android:style/Theme.Translucent.NoTitleBar",
    configChanges: "orientation|screenSize|screenLayout|smallestScreenSize|keyboardHidden",
  },
];

const DATA_ATTRIBUTES = [
  "scheme",
  "host",
  "port",
  "path",
  "pathPrefix",
  "pathPattern",
  "mimeType",
] as const;

/** `android:<name>` attributes of the fields `from` has. */
function attributes<T extends object>(from: T, names: readonly (keyof T & string)[]) {
  return Object.fromEntries(
    names.filter((n) => from[n] !== undefined).map((n) => [`android:${n}`, String(from[n])]),
  );
}

function componentElement(c: ManifestComponent): xml.Element {
  const named = (tag: string) => (name: string) => xml.element(tag, { "android:name": name });

  const children = [
    ...(c.intentFilters ?? []).map((f) =>
      xml.element("intent-filter", {}, [
        ...f.actions.map(named("action")),
        ...(f.categories ?? []).map(named("category")),
        ...(f.data ?? []).map((d) => xml.element("data", attributes(d, DATA_ATTRIBUTES))),
      ]),
    ),
    ...Object.entries(c.metaData ?? {}).map(([name, value]) =>
      xml.element("meta-data", { "android:name": name, "android:value": value }),
    ),
  ];

  return xml.element(
    c.kind,
    attributes(c, COMPONENT_ATTRIBUTES),
    children.length ? children : undefined,
  );
}

/**
 * The library's AndroidManifest.xml, which Android merges into the app's:
 * the permissions, the runtime's components, and Lucent packages' ones.
 */
export function androidManifest(
  permissions: string[],
  components: ManifestComponent[] = [],
): string {
  return xml.printDocument({
    comment: "Generated by Lucent. Do not edit.",
    root: xml.element(
      "manifest",
      { "xmlns:android": "http://schemas.android.com/apk/res/android" },
      [
        ...permissions.map((p) => xml.element("uses-permission", { "android:name": p })),
        xml.element(
          "application",
          {},
          [...RUNTIME_COMPONENTS, ...components].map(componentElement),
        ),
      ],
    ),
  });
}

/** The library's consumer rules: what JNI finds by name survives the app's shrinker (R8). */
export function consumerRules(classes: string[]): string {
  const keep = [
    "-keep class dev.lucent.** { *; }",
    ...classes.map((c) => `-keep class ${c.replace(/\//g, ".")} { *; }`),
  ];

  return `# Generated by Lucent. Do not edit.\n# Classes Lucent's JNI glue uses by name.\n${keep.join("\n")}\n`;
}
