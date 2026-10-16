/**
 * The headers of the libraries a native extension links (decision 0131),
 * which its header is read with: each prefab module's `include` directory
 * from the AAR the app's Android classpath resolved, extracted once per AAR
 * under .lucent/prefab; and on iOS the pods' header and framework search
 * paths, as the Pods xcconfig gives them, and the packages' vendored
 * frameworks. Each prefab artifact's package name, as its AAR's
 * prefab.json gives it, is what the native package's CMake finds.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { frameworkSearchPath, podsSearchPaths, ZipArchive } from "@lucent-lang/bindgen";
import type { NativeInputs } from "@lucent-lang/compiler";

export interface LibraryHeaders {
  includePaths: string[];
  frameworkPaths: string[];
  /** Gradle `group:artifact` → its prefab package's name. */
  prefabNames: Map<string, string>;
  /** Packages declare prefab modules, but no classpath is resolved yet to read them from. */
  prefabPending: boolean;
}

/**
 * The libraries' headers, for the app at `root`: `classpath` is the
 * resolved Android classpath's record (.lucent/android-classpath.json),
 * when there is one. Throws, naming the field, for an artifact the
 * classpath has no AAR of, or a module its AAR lacks.
 */
export function libraryHeaders(
  root: string,
  native: NativeInputs,
  classpath: string | undefined,
): LibraryHeaders {
  const prefab = prefabHeaders(root, native, classpath);
  const ios = iosHeaders(root, native);

  return {
    includePaths: [...prefab.includePaths, ...ios.includePaths],
    frameworkPaths: ios.frameworkPaths,
    prefabNames: prefab.names,
    prefabPending: prefab.pending,
  };
}

function prefabHeaders(
  root: string,
  native: NativeInputs,
  classpath: string | undefined,
): { includePaths: string[]; names: Map<string, string>; pending: boolean } {
  const declared = Object.entries(native.manifest.android.prefab ?? {});
  const names = new Map<string, string>();
  if (!declared.length) return { includePaths: [], names, pending: false };
  if (!classpath || !fs.existsSync(classpath)) return { includePaths: [], names, pending: true };

  const aars = (JSON.parse(fs.readFileSync(classpath, "utf8")) as { aars?: string[] }).aars ?? [];
  const includePaths: string[] = [];

  for (const [artifact, modules] of declared) {
    const who = Object.values(modules)[0]?.[0] ?? "a package";
    const field = `${who}/lucent.json: android.prefab.${artifact}`;
    const aar = aarOf(aars, artifact);
    if (!aar)
      throw new Error(
        `${field}: the app's Android classpath has no AAR of ${artifact}; build again once Gradle resolves it`,
      );

    const zip = new ZipArchive(fs.readFileSync(aar));
    const manifest = zip.read("prefab/prefab.json");
    if (!manifest) throw new Error(`${field}: ${path.basename(aar)} has no prefab package`);
    const name = (JSON.parse(manifest.toString("utf8")) as { name?: string }).name;
    names.set(artifact, name ?? artifact.slice(artifact.lastIndexOf(":") + 1));

    // Extracted once per AAR (its path and size): a new version is a new directory.
    const stat = fs.statSync(aar);
    const stamp = createHash("sha256").update(`${aar}\0${stat.size}`).digest("hex").slice(0, 12);
    const into = path.join(root, ".lucent/prefab", artifact.replace(/:/g, "_"), stamp);

    for (const module of Object.keys(modules)) {
      const prefix = `prefab/modules/${module}/`;
      if (!zip.names().some((n) => n.startsWith(prefix)))
        throw new Error(`${field}: ${path.basename(aar)} has no prefab module ${module}`);

      const include = path.join(into, module, "include");
      if (!fs.existsSync(include)) extract(zip, `${prefix}include/`, include);
      includePaths.push(include);
    }
  }

  return { includePaths, names, pending: false };
}

/** The AAR of `group:artifact` among the classpath's: by Gradle's cache layout, else its file name. */
function aarOf(aars: string[], artifact: string): string | undefined {
  const [group, name] = artifact.split(":") as [string, string];
  const portable = (p: string) => p.split(path.sep).join("/");

  return (
    aars.find((a) => portable(a).includes(`/${group}/${name}/`)) ??
    aars.find((a) => path.basename(a).startsWith(`${name}-`))
  );
}

/** Writes the entries under `prefix` to `into`, keeping their paths below it. */
function extract(zip: ZipArchive, prefix: string, into: string): void {
  const tmp = `${into}.tmp-${process.pid}`;
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });

  for (const n of zip.names()) {
    if (!n.startsWith(prefix) || n.endsWith("/")) continue;
    const rel = n.slice(prefix.length);
    // Nothing outside the directory: an entry with `..` is no header.
    if (rel.split("/").includes("..")) continue;
    const file = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, zip.read(n)!);
  }

  fs.mkdirSync(path.dirname(into), { recursive: true });
  fs.renameSync(tmp, into);
}

/** The pods' search paths (once pod install ran), and the packages' vendored frameworks'. */
function iosHeaders(
  root: string,
  native: NativeInputs,
): { includePaths: string[]; frameworkPaths: string[] } {
  const ios = path.join(root, "ios");
  const pods = fs.existsSync(path.join(ios, "Pods")) ? podsSearchPaths(ios) : undefined;
  const vendored = native.binaries.ios.flatMap((f) => {
    const dir = frameworkSearchPath(f);
    return dir ? [dir] : [];
  });

  return {
    includePaths: pods?.includePaths ?? [],
    frameworkPaths: [...new Set([...(pods?.frameworkPaths ?? []), ...vendored])],
  };
}
