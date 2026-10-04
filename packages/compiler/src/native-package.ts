import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { identityScript } from "./emit/identity.ts";
import { type EmitResult, IDENTITY, LOADER } from "./emit/index.ts";
import { androidViewFiles, autolinkingConfig } from "./ui/android.ts";
import { fabricViews } from "./ui/fabric.ts";
import { VIEWS_RUNTIME } from "./ui/proxy.ts";
import {
  androidManifest,
  consumerRules,
  libraryBuildGradle,
  packagesCmake,
  podspec,
} from "./native-build-files.ts";
import type { NativeInputs, PackagePath } from "./package-config.ts";
import { inNativePackage } from "./package-files.ts";
import { coreTypesPath } from "./program.ts";
import { currentReads, readsKey } from "./reads.ts";
import { currentSdkIdentity, type SdkOptions, withSdkOptions } from "./sdk/schema.ts";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Location of the C++ runtime, the native templates and the JS loader:
 * runtime/ next to dist/ when bundled into @lucent-lang/lucent, the runtime
 * package in this repository.
 */
export function runtimeDir(): string {
  const bundled = path.resolve(here, "../runtime");
  if (fs.existsSync(path.join(bundled, "cpp/lucent"))) return bundled;
  return path.dirname(createRequire(import.meta.url).resolve("@lucent-lang/runtime/package.json"));
}

export interface WriteResult {
  outDir: string;
  written: string[];
  unchanged: number;
  removed: string[];
  /** Written files that did not exist before. */
  added: string[];
  /** True when files were added or removed (pods / Gradle need a resync). */
  structureChanged: boolean;
}

/**
 * A key for everything a build is given: the sources, the compiler, the
 * runtime and templates it copies, the SDKs it binds (`sdk`, as compile
 * takes them) and the output location. Content, not versions, so edits to
 * the compiler or runtime invalidate it too. What the compile reads besides
 * is in its CheckRecord.
 */
export function inputsKey(files: string[], outDir: string, sdk?: SdkOptions): string {
  const hash = crypto.createHash("sha256");
  hash.update(path.resolve(outDir));
  // The compiler itself: its sources in this repository, dist when installed.
  const compilerRoot = path.resolve(here, "..");
  const compilerFiles = ["src", "dist", "lib"].flatMap((d) =>
    listFiles(path.join(compilerRoot, d)),
  );
  const deps = [
    ...compilerFiles,
    ...listFiles(runtimeDir()).filter(
      (f) =>
        !f.includes(`${path.sep}test${path.sep}`) &&
        !f.includes(`${path.sep}node_modules${path.sep}`),
    ),
    coreTypesPath(),
  ];
  // The SDKs bindings come from (their schemas are derived from them): the app's
  // dependencies' artifacts too.
  hash.update(withSdkOptions(sdk, currentSdkIdentity));
  // Whether components' views are generated.
  hash.update(`views:${fabricViews()}`);
  for (const f of [...files.map((f) => path.resolve(f)).sort(), ...deps.sort()]) {
    hash.update(f);
    hash.update(fs.readFileSync(f));
  }
  return hash.digest("hex");
}

/**
 * What a passing check was given and read: `.lucent/check.json` keeps it,
 * and a build's native package's manifest.
 */
export interface CheckRecord {
  /** The key of what it was given (inputsKey) and of the files it read. */
  inputs: string;
  /** The files it read. */
  read: string[];
}

/** The record of a check given `key` that read `read` (CompileResult.read). */
export function checkRecord(key: string, read: ReadonlyMap<string, string>): CheckRecord {
  return { inputs: `${key}:${readsKey(read)}`, read: [...read.keys()].sort() };
}

/**
 * The files the check recorded in `file` (a CheckRecord, or a native
 * package's manifest) read, as they are now, when its result holds: it was
 * given `key`, and each file is as it found it. Undefined otherwise.
 */
export function upToDate(file: string, key: string): ReadonlyMap<string, string> | undefined {
  let last: Partial<CheckRecord> | null;
  try {
    last = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<CheckRecord> | null;
  } catch {
    return undefined;
  }
  if (!last || !Array.isArray(last.read)) return undefined;

  const read = currentReads(last.read);
  return checkRecord(key, read).inputs === last.inputs ? read : undefined;
}

function listFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

/**
 * The Android library's build.gradle while Android's code is built later,
 * by the app's Gradle build (after expo prebuild): configured for Kotlin
 * shims, and for components' Compose content while views are generated,
 * which only that build can tell Android needs. The Gradle build
 * configures the library before it builds Android, and a library
 * configured so builds whatever Android turns out to need.
 */
export function deferredLibraryGradle(native: NativeInputs | undefined): string {
  const template = fs.readFileSync(path.join(runtimeDir(), "native/android/build.gradle"), "utf8");
  return libraryBuildGradle(template, native, true, fabricViews() ? "unknown" : []);
}

/**
 * Writes the native package React Native autolinks: the C++ runtime, the
 * generated module code, the TurboModule host, build files for both
 * platforms, and the JavaScript proxies. Files whose content did not change
 * are left alone so native builds stay incremental.
 */
export function writeNativePackage(
  result: EmitResult,
  outDir: string,
  options: {
    /** The check the package's code passed, for the next build to tell whether it holds (upToDate). */
    check?: CheckRecord;
    native?: NativeInputs;
    /** Android's code is built later, by the app's Gradle build (see deferredLibraryGradle). */
    androidDeferred?: boolean;
  } = {},
): WriteResult {
  const rt = runtimeDir();
  const want = new Map<string, string | Buffer>();
  const copyTree = (from: string, to: string, filter: (f: string) => boolean) => {
    for (const f of listFiles(from)) {
      if (!filter(f)) continue;
      want.set(path.join(to, path.relative(from, f)), fs.readFileSync(f));
    }
  };
  copyTree(path.join(rt, "cpp/lucent"), path.join(outDir, "cpp/lucent"), () => true);
  copyTree(path.join(rt, "cpp/rn"), path.join(outDir, "cpp/rn"), () => true);
  copyTree(path.join(rt, "cpp/third_party"), path.join(outDir, "cpp/third_party"), () => true);
  copyTree(path.join(rt, "native"), outDir, () => true);
  for (const [name, content] of result.files)
    want.set(path.join(outDir, "cpp/generated", name), content);

  const native = options.native?.manifest;

  // Lucent packages' pods, with every requirement on them, and the pods whose
  // modules the iOS code imports (the app's Podfile resolves those).
  const pods = new Map<string, string[]>(
    Object.entries(native?.ios.pods ?? {}).map(([pod, asked]) => [
      pod,
      [
        ...new Set(Object.keys(asked).flatMap((r) => r.split(",").map((part) => part.trim()))),
      ].sort(),
    ]),
  );
  for (const pod of result.pods ?? []) if (!pods.has(pod)) pods.set(pod, []);

  // Frameworks the iOS platform code and the packages use join the podspec's.
  const frameworks = new Set([
    ...(result.frameworks ?? []),
    ...Object.keys(native?.ios.frameworks ?? {}),
  ]);
  frameworks.delete("CoreFoundation");

  // Lucent packages' files, under packages/<package>/.
  const packageFiles = [...(options.native?.files ?? [])];
  for (const [file, from] of packageFiles) want.set(path.join(outDir, file), fs.readFileSync(from));

  const inPackage = (paths: PackagePath[]) => paths.map((p) => inNativePackage(p));
  const sources = inPackage(native?.ios.nativeSources ?? []);
  const inSources = (f: string) => sources.some((dir) => f.startsWith(`${dir}/`));

  const podspecFile = path.join(outDir, "LucentNative.podspec");
  want.set(
    podspecFile,
    podspec(want.get(podspecFile)!.toString(), {
      frameworks: ["CoreFoundation", ...[...frameworks].sort()],
      swift:
        [...result.files.keys()].some((f) => f.endsWith(".swift")) ||
        packageFiles.some(([f]) => f.endsWith(".swift") && inSources(f)),
      pods: [...pods],
      sources,
      resources: inPackage(native?.ios.resources ?? []),
      resourceBundles: Object.entries(native?.ios.resourceBundles ?? {}).map(([name, paths]) => [
        name,
        inPackage(paths),
      ]),
      vendoredFrameworks: inPackage(native?.ios.vendoredFrameworks ?? []),
      swiftPackages: Object.entries(native?.ios.swiftPackages ?? {}),
      deploymentTarget: native?.ios.deploymentTarget?.value,
    }),
  );

  const gradle = path.join(outDir, "android/build.gradle");
  want.set(
    gradle,
    options.androidDeferred
      ? deferredLibraryGradle(options.native)
      : libraryBuildGradle(
          want.get(gradle)!.toString(),
          options.native,
          !!result.kotlin?.size,
          // The components' Compose content: the libraries it imports.
          result.compose
            ? [...result.kotlin!]
                .filter(([f]) => f.startsWith("dev/lucent/compose/"))
                .map(([, t]) => t)
            : [],
        ),
  );

  const cmake = packagesCmake(options.native);
  if (cmake) want.set(path.join(outDir, "android/packages.cmake"), cmake);

  // The components' Android registration, when views are generated. The Gradle build
  // that builds a deferred Android reads the autolinking config before it does.
  const views = result.components?.length && fabricViews() ? result.components : [];
  const deferred = !!options.androidDeferred;
  const config = path.join(outDir, "react-native.config.js");
  want.set(config, autolinkingConfig(want.get(config)!.toString(), views, deferred));
  for (const [file, content] of androidViewFiles(views, deferred))
    want.set(path.join(outDir, file), content);

  for (const [name, content] of result.proxies)
    want.set(path.join(outDir, "js", `${name}.js`), content);
  want.set(path.join(outDir, "js", LOADER), fs.readFileSync(path.join(rt, "js/index.js")));
  want.set(path.join(outDir, "js", VIEWS_RUNTIME), fs.readFileSync(path.join(rt, "js/views.js")));
  if (result.identity) want.set(path.join(outDir, "js", IDENTITY), identityScript(result.identity));
  for (const [name, content] of [...(result.java ?? []), ...(result.kotlin ?? [])])
    want.set(path.join(outDir, "android/src/main/java", name), content);

  // The permissions of the SDK methods the platform code calls, merged into the app's manifest.
  const uses = [
    ...new Set([
      ...(result.androidPermissions ?? []),
      ...Object.keys(native?.android.permissions ?? {}),
    ]),
  ].sort();
  want.set(
    path.join(outDir, "android/src/main/AndroidManifest.xml"),
    androidManifest(
      uses,
      Object.values(native?.android.components ?? {}).map((c) => c.value),
    ),
  );
  want.set(path.join(outDir, "android/consumer-rules.pro"), consumerRules(result.javaKeep ?? []));

  // What the app's `"lucent:*"` tsconfig path resolves: lucent:core always, and the platform modules its code imports.
  want.set(path.join(outDir, "types/core.d.ts"), fs.readFileSync(coreTypesPath()));
  for (const [name, content] of result.types ?? [])
    want.set(path.join(outDir, "types", name), content);
  // Under the views switch: each module's components as React sees them.
  for (const [name, content] of result.componentTypes ?? [])
    want.set(path.join(outDir, "types/views", `${name}.d.ts`), content);
  want.set(
    path.join(outDir, "manifest.json"),
    JSON.stringify(
      {
        generator: "lucent",
        modules: [...result.proxies.keys()].sort(),
        inputs: options.check?.inputs,
        read: options.check?.read,
        identity: result.identity,
      },
      null,
      2,
    ) + "\n",
  );

  // What the app's Lucent packages contribute, and which package each need came from.
  if (native) want.set(path.join(outDir, "resolved.json"), `${JSON.stringify(native, null, 2)}\n`);

  // Gradle builds android/ in place: its outputs are not the package's files.
  const buildOutput = /^android[\\/](build|\.cxx|\.gradle)[\\/]/;
  const existing = new Set(
    listFiles(outDir).filter((f) => !buildOutput.test(path.relative(outDir, f))),
  );
  const before = new Set(existing);

  // The manifest last: Metro keys its cache on it, so it changes once every proxy is in place.
  const manifest = path.join(outDir, "manifest.json");
  const files = [...want.keys()].filter((f) => f !== manifest);

  const written: string[] = [];
  let unchanged = 0;

  const publish = (file: string) => {
    existing.delete(file);

    const content = want.get(file)!;
    const buf = typeof content === "string" ? Buffer.from(content) : content;

    // Unchanged files keep their content and mtime: native builds reuse their objects.
    if (fs.existsSync(file) && fs.readFileSync(file).equals(buf)) {
      unchanged++;
      return;
    }

    fs.mkdirSync(path.dirname(file), { recursive: true });
    writeWhole(file, buf);
    written.push(file);
  };

  for (const file of files) publish(file);

  const removed: string[] = [];
  for (const stale of existing) {
    if (stale === manifest) continue;

    fs.rmSync(stale);
    removed.push(stale);
  }

  if (want.has(manifest)) publish(manifest);

  return {
    outDir,
    written,
    unchanged,
    removed,
    added: written.filter((f) => !before.has(f)),
    structureChanged: removed.length > 0 || written.some((f) => !before.has(f)),
  };
}

/** Writes `file` through a temporary file renamed over it: a reader sees the old file or the new one, never part of one. */
function writeWhole(file: string, content: Buffer): void {
  const tmp = `${file}.${process.pid}.tmp`;

  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}
