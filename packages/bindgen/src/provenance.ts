/**
 * Where a schema's declarations come from: their native identities
 * (symbols), independent of the names Lucent gives them, and the artifact,
 * target and extractor behind them.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { SchemaProvenance, SymbolId } from "./schema.ts";

/**
 * The symbol of a symbol graph's declaration, from its USR. A member that
 * a protocol extension gives a conforming type (`<USR>::SYNTHESIZED::<type>`)
 * is the extension's own declaration.
 */
export function graphSymbol(usr: string): SymbolId {
  const declared = usr.split("::SYNTHESIZED::")[0]!;

  if (declared.startsWith("s:")) return `swift:${declared}`;
  return declared.startsWith("c:objc(") ? `objc:${declared}` : `c:${declared}`;
}

/**
 * The symbol of a JVM class (`android/os/Build$VERSION`), or of its member:
 * `name` and descriptor run together for methods (`<init>(I)V`), joined by
 * `:` for fields (`SDK_INT:I`).
 */
export function jvmSymbol(internal: string, member?: string): SymbolId {
  return member === undefined ? `jvm:${internal}` : `jvm:${internal}#${member}`;
}

// --- the extractor -------------------------------------------------------------------

/** Set when bindgen is bundled into @lucent-lang/lucent: the hash of its sources, as extractorVersion computes it here. */
declare const __LUCENT_EXTRACTOR__: string | undefined;

let extractorHash: string | undefined;

/**
 * The extractor's own code: a change to it re-extracts, so caches never hold
 * stale schemas. In the bundle, whose files hold the whole CLI, it is the
 * hash of these sources taken when bundling, so releases that leave the
 * extractor alone keep users' caches.
 */
export function extractorVersion(): string {
  if (extractorHash) return extractorHash;
  if (typeof __LUCENT_EXTRACTOR__ === "string") return (extractorHash = __LUCENT_EXTRACTOR__);

  extractorHash = sourcesHash(path.dirname(new URL(import.meta.url).pathname));
  return extractorHash;
}

/** The hash of bindgen's source files in `dir` (the bundle build uses it too). */
export function sourcesHash(dir: string): string {
  const h = crypto.createHash("sha256");
  for (const f of fs.readdirSync(dir).sort())
    if (/\.(ts|js)$/.test(f)) h.update(fs.readFileSync(path.join(dir, f)));

  return h.digest("hex").slice(0, 8);
}

// --- artifacts -----------------------------------------------------------------------

const contentHashes = new Map<string, string>();

/**
 * A hash of the files' contents, whatever their paths and order (a copied
 * SDK or a moved checkout keeps it). A directory counts as the files in it.
 */
export function contentHash(files: string[]): string {
  const each = filesOf(files).map((f) => {
    const st = fs.statSync(f);
    const key = `${f}:${st.size}:${st.mtimeMs}`;
    let h = contentHashes.get(key);
    if (!h) {
      h = crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
      contentHashes.set(key, h);
    }

    return h;
  });

  return crypto.createHash("sha256").update(each.sort().join("\n")).digest("hex").slice(0, 16);
}

/** The files `files` name, directories as the files in them. */
export function filesOf(files: string[]): string[] {
  return files.flatMap((file) => {
    if (!fs.statSync(file).isDirectory()) return [file];

    return filesOf(fs.readdirSync(file).map((e) => path.join(file, e)));
  });
}

/**
 * What a jar or AAR is, from where the build put it: an Android SDK
 * platform (`platforms/android-35/android.jar`), a Gradle dependency (its
 * Maven coordinates, from Gradle's `files-2.1/<group>/<name>/<version>/`
 * cache), or else an archive known by its file name.
 */
export function jarArtifact(file: string): Pick<SchemaProvenance, "artifact" | "kind"> & {
  target?: string;
} {
  const parts = file.split(/[\\/]/);
  const name = parts.at(-1)!;
  const kind = name.endsWith(".aar") ? "aar" : "jar";

  const platform = parts.at(-2);
  if (name === "android.jar" && parts.at(-3) === "platforms" && platform?.startsWith("android-"))
    return {
      artifact: `android-sdk:${platform.slice("android-".length)}`,
      kind: "sdk",
      target: platform,
    };

  const gradle = parts.lastIndexOf("files-2.1");
  if (gradle >= 0 && parts.length - gradle === 6) {
    const [group, artifact, version] = parts.slice(gradle + 1, gradle + 4);
    return { artifact: `maven:${group}:${artifact}:${version}`, kind };
  }

  return { artifact: `${kind}:${name}`, kind };
}

/** How an iOS module reaches the build: the SDK, or a framework, module map or Swift module on the search paths. */
export interface IosModuleSource {
  kind: "sdk" | "framework" | "clang-module" | "swift-module";
  /** The declaration inputs (headers, the .swiftmodule): none for the SDK, which its version names. */
  files: string[];
  /** The pod that installed it, as `Name@version` (Podfile.lock). */
  pod?: string;
  /** The Swift package whose build gave it, as `identity@version` (Package.resolved). */
  spm?: string;
}

/** An iOS module's provenance. */
export function iosProvenance(
  module: string,
  source: IosModuleSource,
  sdkVersion: string,
  target: string,
): SchemaProvenance {
  const artifact = source.pod
    ? `pod:${source.pod}`
    : source.spm
      ? `spm:${source.spm}`
      : source.kind === "sdk"
        ? `sdk:iphonesimulator${sdkVersion}`
        : `${source.kind}:${module}`;

  return {
    artifact,
    kind: source.kind,
    ...(source.files.length ? { contentHash: contentHash(source.files) } : {}),
    target,
    extractor: extractorVersion(),
  };
}

/** A pod Podfile.lock installed: its version, and the pods it depends on. */
export interface LockedPod {
  version: string;
  dependencies: string[];
}

/**
 * The pods Podfile.lock installed (its PODS section): name → version and
 * dependencies, subspecs counted as their pod.
 */
export function lockedPods(lockfile: string): Map<string, LockedPod> {
  const pods = new Map<string, LockedPod>();
  const text = fs.existsSync(lockfile) ? fs.readFileSync(lockfile, "utf8") : "";
  const section = /^PODS:\n((?:[ \t]+.*\n?)*)/m.exec(text)?.[1] ?? "";
  const podOf = (name: string) => name.split("/")[0]!;

  let current: LockedPod | undefined;
  let owner = "";
  for (const line of section.split("\n")) {
    const entry = /^ {2}- "?([^\s"(]+)(?: \(([^)]+)\))?"?:?$/.exec(line);
    if (entry) {
      owner = podOf(entry[1]!);
      current = pods.get(owner) ?? { version: entry[2] ?? "", dependencies: [] };
      pods.set(owner, current);
      continue;
    }

    const dependency = /^ {4}- "?([^\s"(]+)/.exec(line)?.[1];
    const pod = dependency && podOf(dependency);
    if (current && pod && pod !== owner && !current.dependencies.includes(pod))
      current.dependencies.push(pod);
  }

  return pods;
}
