/**
 * Compose's libraries as the generated Android library builds against
 * them: COMPOSE_LIBRARIES at COMPOSE_BOM's versions, with the Compose
 * libraries they depend on (their POMs'), found in Gradle's cache on this
 * machine (an app build with Compose content downloads them). Their
 * other dependencies (kotlinx-coroutines, AndroidX collections…) are the
 * classpath their API names types from. The Kotlin standard library is
 * left out: bindings map its types by rule.
 *
 * Used by scripts/compose-bindings.ts (which binds them into
 * lib/sdk/compose.schemas.json.gz) and by the tests that compile Kotlin
 * against them.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { canonicalSchema, extractKotlinApi } from "@lucent-lang/bindgen";
import { ZipArchive } from "../../../bindgen/src/zip.ts";
import {
  COMPOSE_BOM,
  COMPOSE_LIBRARIES,
  LIFECYCLE_VIEWMODEL,
} from "../../src/native-build-files.ts";
import type { ComposeSchemaFile } from "../../src/ui/compose-schemas.ts";

export interface ComposeArtifacts {
  /** The BOM, as the Gradle build names it. */
  bom: string;
  /** Compose's own libraries (AARs or jars), sorted. */
  libraries: string[];
  /** What they depend on besides, sorted. */
  classpath: string[];
}

const CACHE = path.join(os.homedir(), ".gradle/caches/modules-2/files-2.1");

interface Dependency {
  group: string;
  artifact: string;
  version?: string;
}

/**
 * Compose's artifacts at the BOM's versions, or the coordinates Gradle's
 * cache is missing.
 */
export function composeArtifacts(cache = CACHE): ComposeArtifacts | { missing: string[] } {
  const [bomGroup, bomArtifact, bomVersion] = COMPOSE_BOM.split(":") as [string, string, string];
  const bomPom = files(path.join(cache, bomGroup, bomArtifact, bomVersion), ".pom")[0];
  if (!bomPom) return { missing: [COMPOSE_BOM] };

  const managed = new Map<string, string | undefined>(
    dependencies(fs.readFileSync(bomPom, "utf8"), true).map(
      (d) => [`${d.group}:${d.artifact}`, d.version] as const,
    ),
  );

  const libraries = new Set<string>();
  const classpath = new Set<string>();
  const missing: string[] = [];
  const seen = new Set<string>();

  const visit = (d: Dependency) => {
    const key = `${d.group}:${d.artifact.replace(/-(android|jvm)$/, "")}`;
    if (seen.has(key) || d.group === "org.jetbrains.kotlin") return;
    seen.add(key);

    const compose = d.group.startsWith("androidx.compose.");
    const version = managed.get(key) ?? d.version;
    const found = locate(cache, d.group, d.artifact, compose ? version : undefined, version);
    if (!found) {
      if (compose) missing.push(`${key}:${version ?? "?"}`);
      return;
    }

    (compose ? libraries : classpath).add(found.archive);
    if (found.pom) for (const next of dependencies(fs.readFileSync(found.pom, "utf8"))) visit(next);
  };

  for (const coordinate of COMPOSE_LIBRARIES) {
    const [group, artifact] = coordinate.split(":") as [string, string];
    visit({ group, artifact });
  }

  if (missing.length) return { missing };

  return { bom: COMPOSE_BOM, libraries: [...libraries].sort(), classpath: [...classpath].sort() };
}

/**
 * The bindings of Compose's libraries, as lib/sdk/compose.schemas.json.gz
 * holds them: every module their Kotlin declares, in canonical order.
 */
export function bindCompose(artifacts: ComposeArtifacts): ComposeSchemaFile {
  const modules = extractKotlinApi({
    libraries: artifacts.libraries,
    classpath: artifacts.classpath,
    target: "android",
  }).map(canonicalSchema);
  const libraries = new Set(
    modules
      .filter((m) => artifacts.libraries.some((l) => l.includes(`/${artifactPath(m)}/`)))
      .map((m) => m.provenance!.artifact),
  );

  return { bom: artifacts.bom, libraries: [...libraries].sort(), modules };
}

/**
 * The classpath Kotlin compiles content against: android.jar (the
 * newest platform installed), then the release's libraries and what they
 * depend on, AARs as their classes (extracted into `dir`). Undefined
 * without an Android SDK.
 */
export function kotlinClasspath(artifacts: ComposeArtifacts, dir: string): string[] | undefined {
  const sdk = process.env.ANDROID_HOME ?? path.join(os.homedir(), "Library/Android/sdk");
  const platforms = path.join(sdk, "platforms");
  const platform = fs.existsSync(platforms)
    ? fs
        .readdirSync(platforms)
        .filter((p) => fs.existsSync(path.join(platforms, p, "android.jar")))
        .sort(byVersion)
        .pop()
    : undefined;
  if (!platform) return undefined;

  // What the runtime's host of Compose content needs beside Compose (its view model store owner).
  const [group, name, version] = LIFECYCLE_VIEWMODEL.split(":") as [string, string, string];
  const host = locate(CACHE, group, name, undefined, version)?.archive;
  if (!host) return undefined;

  const jars = [...artifacts.libraries, ...artifacts.classpath, host].map((file, i) => {
    if (!file.endsWith(".aar")) return file;

    const jar = path.join(dir, `${i}-${path.basename(file, ".aar")}.jar`);
    fs.writeFileSync(jar, new ZipArchive(file).read("classes.jar") ?? Buffer.alloc(0));
    return jar;
  });

  return [path.join(platforms, platform, "android.jar"), ...jars];
}

/**
 * What two bindings of the same release share: all but the extractor's
 * identity, which changes with bindgen's code whether or not the schemas do.
 */
export function comparableSchemas(file: ComposeSchemaFile): ComposeSchemaFile {
  return {
    ...file,
    modules: file.modules.map((m) => {
      const { extractor: _, ...provenance } = m.provenance!;
      return { ...m, provenance } as typeof m;
    }),
  };
}

/** `group/artifact/version`, from a module's `maven:group:artifact:version` provenance. */
const artifactPath = (m: { provenance?: { artifact: string } }) =>
  (m.provenance?.artifact ?? "").replace(/^maven:/, "").replaceAll(":", "/");

/**
 * An artifact's archive and POM in the cache: its Android variant, else
 * its JVM one, else itself; at `exact` when given, else at `preferred`
 * when cached, else at the newest version cached.
 */
function locate(
  cache: string,
  group: string,
  artifact: string,
  exact: string | undefined,
  preferred: string | undefined,
): { archive: string; pom?: string } | undefined {
  const base = artifact.replace(/-(android|jvm)$/, "");

  for (const name of [`${base}-android`, `${base}-jvm`, base]) {
    const dir = path.join(cache, group, name);
    if (!fs.existsSync(dir)) continue;

    const versions = fs.readdirSync(dir).sort(byVersion);
    const version =
      exact ?? (preferred && versions.includes(preferred) ? preferred : versions.at(-1));
    if (!version || !versions.includes(version)) continue;

    const archive = [
      ...files(path.join(dir, version), ".aar"),
      ...files(path.join(dir, version), ".jar"),
    ][0];
    if (archive) return { archive, pom: files(path.join(dir, version), ".pom")[0] };
  }

  return undefined;
}

/** A POM's dependencies (`managed`: its dependencyManagement's), without test and optional ones. */
function dependencies(pom: string, managed = false): Dependency[] {
  const management =
    /<dependencyManagement>([\s\S]*?)<\/dependencyManagement>/.exec(pom)?.[1] ?? "";
  const text = managed ? management : pom.replace(management, "");

  return [...text.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)].flatMap(([, d]) => {
    const tag = (name: string) => new RegExp(`<${name}>([^<]*)</${name}>`).exec(d!)?.[1]?.trim();
    const scope = tag("scope");
    if (scope === "test" || scope === "provided" || tag("optional") === "true") return [];

    const group = tag("groupId");
    const artifact = tag("artifactId");
    if (!group || !artifact) return [];

    const version = tag("version")?.replace(/^\[(.*)\]$/, "$1");
    return [{ group, artifact, ...(version ? { version } : {}) }];
  });
}

/** Files with an extension under a directory (Gradle keeps each in a hash directory), sources left out. */
function files(dir: string, ext: string): string[] {
  if (!fs.existsSync(dir)) return [];

  return fs
    .readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(ext) && !f.includes("sources"))
    .sort()
    .map((f) => path.join(dir, f));
}

function byVersion(a: string, b: string): number {
  const parts = (v: string) => v.split(/[.-]/).map((p) => (/^\d+$/.test(p) ? Number(p) : p));
  const [x, y] = [parts(a), parts(b)];

  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const [p, q] = [x[i] ?? 0, y[i] ?? 0];
    if (p === q) continue;
    if (typeof p === "number" && typeof q === "number") return p - q;
    return String(p) < String(q) ? -1 : 1;
  }

  return 0;
}
