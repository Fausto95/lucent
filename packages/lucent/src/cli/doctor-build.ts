/**
 * Doctor's checks of the app's build (T61): what `lucent build` recorded
 * (.lucent/build-record.json, and the record before it), the identity it
 * gave this JavaScript (.lucent/native/js/_lucent/identity.js), and the
 * native builds made since (Xcode's products, Gradle's native libraries),
 * read for the identity Lucent compiles into them. Files only: no build
 * runs, and nothing loads the compiler.
 */
import fs from "node:fs";
import path from "node:path";
import { type BuildRecord, reusable } from "./build-graph.ts";
import type { Check, Probe } from "./doctor.ts";

const RECORD = ".lucent/build-record.json";
const PREVIOUS = ".lucent/build-record.previous.json";
const IDENTITY = ".lucent/native/js/_lucent/identity.js";

/** The string the native runtime's identity is installed under: in every native build of Lucent code. */
const MARKER = "__lucentIdentity";

/** What a native build needs doing again: the app's own wording (lucent build's action kinds). */
const REBUILD =
  "rebuild and install the app (compile-native): `npx react-native run-ios` or `run-android`, or build it in Xcode or Android Studio";

interface Identity {
  runtimeAbi: number;
  programs: Record<string, string>;
  apis: Record<string, Record<string, string>>;
}

const check = (
  id: string,
  label: string,
  status: Check["status"],
  detail: string,
  fix?: string,
): Check => ({ id, label, status, detail, ...(fix ? { fix } : {}) });

function readJson<T>(file: string): T | undefined {
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as T) : undefined;
}

/** identity.js's object: `module.exports = {…};`. */
function readIdentity(root: string): Identity | undefined {
  const file = path.join(root, IDENTITY);
  if (!fs.existsSync(file)) return undefined;

  const text = fs.readFileSync(file, "utf8");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return JSON.parse(text.slice(start, end + 1)) as Identity;
}

const firstLine = (s: string) => s.split("\n")[0]!.trim();

/** The app's build, in the order doctor prints them. */
export function buildChecks(root: string, probe: Probe): Check[] {
  const record = readJson<BuildRecord>(path.join(root, RECORD));
  const identity = readIdentity(root);

  return [
    lastBuild(record),
    cache(record, readJson<BuildRecord>(path.join(root, PREVIOUS))),
    nativeTargets(root, identity),
    nativeBuild(root, probe, identity),
  ];
}

function lastBuild(record: BuildRecord | undefined): Check {
  const label = "Last build";
  if (!record) return check("last-build", label, "skip", "no build yet: run lucent build");

  const failed = record.nodes.filter((n) => n.status === "failed");
  if (failed.length) {
    const logs = failed.flatMap((n) => (n.log ? [n.log] : []));

    return check(
      "last-build",
      label,
      "fail",
      failed.map((n) => `${n.id}: ${firstLine(n.detail ?? "failed")}`).join("; "),
      `${logs.length ? `see ${logs.join(", ")}, ` : ""}fix what it says, then run lucent build again`,
    );
  }

  const needs = record.pendingActions.map(
    (a) => `${a.kind}${a.targets.length ? ` (${a.targets.join(", ")})` : ""}`,
  );
  return check(
    "last-build",
    label,
    "ok",
    `${record.mode}: ${record.nodes.length} steps${needs.length ? `; the app then needed ${needs.join(", ")}` : ""}`,
  );
}

/** Why steps ran again: the inputs that changed since the record before. */
function cache(record: BuildRecord | undefined, previous: BuildRecord | undefined): Check {
  const label = "Build cache";
  if (!record) return check("cache", label, "skip", "no build yet");
  if (!previous) return check("cache", label, "skip", "one build so far: nothing to compare with");

  // Only steps a build can reuse: the others run every build.
  const steps = record.nodes.filter((n) => reusable(n.id));
  const before = new Map(previous.nodes.map((n) => [n.id, n]));
  const reused = steps.filter((n) => n.status === "cached").length;
  const reasons: string[] = [];
  const unexplained: string[] = [];

  for (const n of steps.filter((x) => x.status === "ok")) {
    const was = before.get(n.id);
    if (!was) {
      reasons.push(`${n.id} ran for the first time`);
      continue;
    }

    const hashes = new Map(was.inputs.map((i) => [i.key, i.hash]));
    const keys = new Set([...hashes.keys(), ...n.inputs.map((i) => i.key)]);
    const changed = [...keys].filter(
      (k) => hashes.get(k) !== n.inputs.find((i) => i.key === k)?.hash,
    );

    if (!changed.length) unexplained.push(n.id);
    else
      reasons.push(
        `${n.id} ran again: ${changed.slice(0, 3).join(", ")}${changed.length > 3 ? ` and ${changed.length - 3} more` : ""} changed`,
      );
  }

  const detail = [
    `${reused} of ${steps.length} steps reused`,
    ...reasons,
    ...unexplained.map((id) => `${id} ran again with the same inputs`),
  ].join("; ");

  return unexplained.length
    ? check(
        "cache",
        label,
        "warn",
        detail,
        "a step that runs again with the same inputs is a cache miss Lucent cannot explain: report it with .lucent/build-record.json and build-record.previous.json",
      )
    : check("cache", label, "ok", detail);
}

/** The platforms the app has (its native projects), and whether this JavaScript was built for each. */
function nativeTargets(root: string, identity: Identity | undefined): Check {
  const label = "Native targets";
  if (!identity) return check("native-targets", label, "skip", "no build yet");

  const has = (["ios", "android"] as const).filter((p) => fs.existsSync(path.join(root, p)));
  const missing = has.filter((p) => !identity.programs[p]);

  return missing.length
    ? check(
        "native-targets",
        label,
        "fail",
        `this JavaScript was built without the ${missing.join(" and ")} native code the app has: it will refuse to load there`,
        `run lucent build${missing.length ? ` --platforms ${has.join(",")}` : ""}`,
      )
    : check(
        "native-targets",
        label,
        "ok",
        `built for ${Object.keys(identity.programs).join(", ") || "nothing"}`,
      );
}

/** The newest native build of each platform: its files holding Lucent's code. */
function nativeBinaries(root: string, probe: Probe): Partial<Record<"ios" | "android", Buffer[]>> {
  const out: Partial<Record<"ios" | "android", Buffer[]>> = {};

  const app = newest(iosApps(root, probe));
  if (app) {
    const found = files(app).flatMap((f) => {
      const data = fs.readFileSync(f);
      return data.includes(MARKER) ? [data] : [];
    });
    if (found.length) out.ios = found;
  }

  const lib = newest(
    [
      path.join(root, "android/app/build/intermediates"),
      path.join(root, ".lucent/native/android/build"),
    ].flatMap((dir) => files(dir).filter((f) => path.basename(f) === "liblucentnative.so")),
  );
  if (lib) out.android = [fs.readFileSync(lib)];

  return out;
}

/** The app bundles Xcode built for the app: ios/build's products, and DerivedData's for its workspace. */
function iosApps(root: string, probe: Probe): string[] {
  const iosDir = path.join(root, "ios");
  const products = [path.join(iosDir, "build/Build/Products")];
  const derived = path.join(probe.home, "Library/Developer/Xcode/DerivedData");

  for (const d of fs.existsSync(derived) ? fs.readdirSync(derived) : []) {
    const info = path.join(derived, d, "info.plist");
    const workspace = fs.existsSync(info)
      ? /<key>WorkspacePath<\/key>\s*<string>([^<]*)<\/string>/.exec(
          fs.readFileSync(info, "utf8"),
        )?.[1]
      : undefined;

    if (workspace && path.resolve(workspace).startsWith(path.resolve(iosDir) + path.sep))
      products.push(path.join(derived, d, "Build/Products"));
  }

  return products.flatMap((p) =>
    (fs.existsSync(p) ? fs.readdirSync(p) : []).flatMap((config) => {
      const dir = path.join(p, config);
      return fs.statSync(dir).isDirectory()
        ? fs
            .readdirSync(dir)
            .filter((f) => f.endsWith(".app"))
            .map((f) => path.join(dir, f))
        : [];
    }),
  );
}

/** Every file under `dir`. */
function files(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];

  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? files(p) : e.isFile() ? [p] : [];
  });
}

function newest(paths: string[]): string | undefined {
  return paths.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
}

/**
 * Each platform's newest native build, as the app checks it when it loads
 * a module: a module whose API hash is not in it would be refused; another
 * program with the same APIs runs, with a warning.
 */
function nativeBuild(root: string, probe: Probe, identity: Identity | undefined): Check {
  const label = "Native build";
  if (!identity) return check("native-build", label, "skip", "no build yet");

  const binaries = nativeBinaries(root, probe);
  const found = (["ios", "android"] as const).filter((p) => identity.programs[p] && binaries[p]);
  if (!found.length)
    return check("native-build", label, "skip", "no native build of the app found");

  const has = (p: "ios" | "android", s: string) => binaries[p]!.some((b) => b.includes(s));
  let status: Check["status"] = "ok";
  const lines = found.map((p) => {
    const other = Object.entries(identity.apis[p] ?? {}).filter(([, api]) => !has(p, api));

    if (other.length) {
      status = "fail";
      return `${p}: ${other.map(([m]) => m).join(", ")} ${other.length === 1 ? "has" : "have"} another API than this JavaScript expects (the app refuses to load ${other.length === 1 ? "it" : "them"})`;
    }

    if (!has(p, identity.programs[p]!)) {
      if (status === "ok") status = "warn";
      return `${p}: built from other sources, with the same APIs (the app runs them, with a warning)`;
    }

    return `${p}: built from these sources`;
  });

  return check(
    "native-build",
    label,
    status,
    lines.join("; "),
    status === "ok" ? undefined : REBUILD,
  );
}
