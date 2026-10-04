/**
 * The native artifacts a build links, as its build system resolved them:
 * the SDK, the pods Podfile.lock installed, the libraries of the Gradle
 * classpath. Bindings are extracted from them, and cached on what
 * identifies them: the build system's name and a hash of their
 * declaration inputs' contents, never where their files are.
 */
import fs from "node:fs";
import path from "node:path";
import { archiveIndex } from "./android.ts";
import { hash, memoByStat } from "./cache.ts";
import {
  contentHash,
  filesOf,
  type IosModuleSource,
  jarArtifact,
  type LockedPod,
} from "./provenance.ts";
import type { Platform, SchemaProvenance } from "./schema.ts";

export interface NativeArtifact {
  /** Build-system identity: `sdk:iphonesimulator27.0`, `pod:OrbitKit@1.2.0`, `maven:dev.orbit:tracking:1.0.0`, `android-sdk:35`. */
  id: string;
  target: Platform;
  kind: SchemaProvenance["kind"];
  /** Hash of the declaration inputs' contents (the iOS SDK: its version and build). */
  contentHash: string;
  /** What declarations are read for: `arm64-apple-ios15.1-simulator`, `android-35`. */
  targetTriple: string;
  /** The artifacts it depends on, by id, as the build system resolved them. */
  dependencies: string[];
  /** The modules (iOS) or Java packages (Android) it declares. */
  modules: string[];
  /** Where declarations are read from, on this machine: never part of an identity. */
  declarationInputs: string[];
  includePaths: string[];
  compilerArguments: string[];
  /** Who resolved it: the package and version, and the file that says so (on this machine). */
  origin: { package: string; version: string; buildFile: string };
}

/** What names an artifact in keys: its id and contents. */
export const identity = (a: NativeArtifact) => `${a.id}#${a.contentHash}`;

// --- Android -------------------------------------------------------------------------

/** An SDK platform's declaration inputs: android.jar, and the API levels and annotations beside it. */
export interface AndroidPlatform {
  jar: string;
  apiVersions?: string;
  annotations?: string;
}

/**
 * The SDK platform (if found) and each jar or AAR after it, as artifacts:
 * Maven coordinates from Gradle's cache layout, packages from the zip
 * directories. `memo` keeps what their contents give, by their stats.
 */
export function androidArtifacts(
  memo: string,
  platform: AndroidPlatform | undefined,
  jars: string[],
  classpath: string | undefined,
): NativeArtifact[] {
  const all = platform ? [platform.jar, ...jars] : jars;
  const targetTriple = all.map((j) => jarArtifact(j).target).find(Boolean) ?? "android";

  return all.map((file) => {
    const inputs =
      file === platform?.jar
        ? [file, ...[platform.apiVersions, platform.annotations].filter((f): f is string => !!f)]
        : [file];
    const { artifact: id, kind, target } = jarArtifact(file);

    // Its classes by name and CRC; the SDK's API levels and annotations by content.
    const indexed = memoByStat(memo, "jar", inputs, () => {
      try {
        const { packages, contentHash: classes } = archiveIndex(file);
        const data = inputs.slice(1);
        return {
          contentHash: data.length ? hash([classes, contentHash(data)]) : classes,
          modules: packages,
        };
      } catch (e) {
        throw new Error(`${file}: ${(e as Error).message}`, { cause: e });
      }
    });

    const maven = /^maven:([^:]+):([^:]+):(.+)$/.exec(id);
    const origin = target
      ? { package: target, version: id.slice(id.indexOf(":") + 1), buildFile: file }
      : maven
        ? {
            package: `${maven[1]}:${maven[2]}`,
            version: maven[3]!,
            buildFile: classpath ?? file,
          }
        : { package: path.basename(file), version: "", buildFile: classpath ?? file };

    return {
      id,
      target: "android",
      kind,
      contentHash: indexed.contentHash,
      targetTriple,
      dependencies: [],
      modules: indexed.modules,
      declarationInputs: inputs,
      includePaths: [],
      compilerArguments: [],
      origin,
    };
  });
}

// --- iOS -----------------------------------------------------------------------------

export interface IosInputs {
  /** The simulator SDK: its path, version and build, and the frameworks it has. */
  sdk: { path: string; version: string; build: string; frameworks: string[] };
  /** How each module outside the SDK reaches the build. */
  sources: Map<string, IosModuleSource>;
  /** Podfile.lock, and the pods it installed. */
  lockfile?: string;
  pods: Map<string, LockedPod>;
  /** Package.resolved, which pins the Swift packages modules came from. */
  resolved?: string;
  includePaths: string[];
  compilerArguments: string[];
  targetTriple: string;
}

/**
 * The SDK, then one artifact per pod or Swift package (all the modules it
 * defines) and per module on the search paths that neither installed.
 */
export function iosArtifacts(memo: string, inputs: IosInputs): NativeArtifact[] {
  const { sdk, sources, pods, includePaths, compilerArguments, targetTriple } = inputs;
  const common = { target: "ios" as const, targetTriple, includePaths, compilerArguments };

  const out: NativeArtifact[] = [
    {
      id: `sdk:iphonesimulator${sdk.version}`,
      kind: "sdk",
      contentHash: hash([`iphonesimulator${sdk.version}`, sdk.build]),
      dependencies: [],
      modules: [...sdk.frameworks].sort(),
      declarationInputs: [],
      origin: { package: "iphonesimulator", version: sdk.version, buildFile: sdk.path },
      ...common,
    },
  ];

  const groups = new Map<string, { source: IosModuleSource; modules: string[] }>();
  for (const [module, source] of sources) {
    const id = source.pod
      ? `pod:${source.pod}`
      : source.spm
        ? `spm:${source.spm}`
        : `${source.kind}:${module}`;
    const group = groups.get(id) ?? { source, modules: [] };
    group.modules.push(module);
    groups.set(id, group);
  }

  for (const [id, { source, modules }] of groups) {
    const files = [...new Set(modules.flatMap((m) => sources.get(m)!.files))];
    const existing = filesOf(files.filter((f) => fs.existsSync(f)));
    const name = source.pod?.slice(0, source.pod.lastIndexOf("@"));
    const pod = name ? pods.get(name) : undefined;

    out.push({
      id,
      kind: source.kind,
      contentHash: memoByStat(memo, "files", existing, () => contentHash(existing)),
      dependencies: (pod?.dependencies ?? []).map((d) => `pod:${d}@${pods.get(d)?.version ?? ""}`),
      modules: modules.sort(),
      declarationInputs: files,
      origin: pod
        ? { package: name!, version: pod.version, buildFile: inputs.lockfile! }
        : source.spm
          ? {
              package: source.spm.slice(0, source.spm.lastIndexOf("@")),
              version: source.spm.slice(source.spm.lastIndexOf("@") + 1),
              buildFile: inputs.resolved ?? files[0] ?? "",
            }
          : { package: modules[0]!, version: "", buildFile: files[0] ?? "" },
      ...common,
    });
  }

  return out;
}
