/**
 * What the app needs after a build, derived from what the build changed:
 * each changed file of the native package by its role there, and a Lucent
 * package's file by the lucent.json field that lists it. Never by a file's
 * extension alone.
 */
import {
  inNativePackage,
  type PackagePath,
  packagePods,
  type ResolvedNative,
} from "@lucent-lang/compiler";
import { ACTION_KINDS, type ActionKind, type PendingAction } from "./build-graph.ts";

/** What a build changed in the native package (paths relative to it, with `/`), and what it resolved. */
export interface NativeChange {
  written: string[];
  /** Written files that did not exist before (also in `written`). */
  added: string[];
  removed: string[];
  manifest: ResolvedNative;
  /** What the build before resolved (its resolved.json), if any. */
  previous?: ResolvedNative;
  /** The targets the build compiled for. */
  targets: string[];
}

/** Where a file acts, and what its change needs; `all` is every target the build compiled for. */
interface Role {
  kind: ActionKind | undefined;
  targets: "all" | string[];
}

const IGNORED: Role = { kind: undefined, targets: [] };

/** The native package's own files, by location: the first that matches decides. */
const OUTPUT_ROLES: [RegExp, (m: RegExpExecArray) => Role][] = [
  // The build cache's key, and declarations for editors: nothing for the app.
  [/^manifest\.json$/, () => IGNORED],
  [/^types\//, () => IGNORED],
  // The build identity changes with the generated native code, whose change says what the app needs.
  [/^js\/_lucent\/identity\.js$/, () => IGNORED],
  [/^js\//, () => ({ kind: "reload-js", targets: "all" })],
  [/^cpp\/generated\/(ios|android|host)\//, (m) => ({ kind: "compile-native", targets: [m[1]!] })],
  [/^cpp\//, () => ({ kind: "compile-native", targets: "all" })],
  [/^ios\//, () => ({ kind: "compile-native", targets: ["ios"] })],
  [/^android\/src\/main\/java\//, () => ({ kind: "compile-native", targets: ["android"] })],
  [
    /^android\/src\/main\/AndroidManifest\.xml$/,
    () => ({ kind: "reinstall", targets: ["android"] }),
  ],
  [/^LucentNative\.podspec$/, () => ({ kind: "relink", targets: ["ios"] })],
  [/^android\//, () => ({ kind: "relink", targets: ["android"] })],
];

/** What a change to a package's file needs, by the field that lists it. */
const FIELD_ACTIONS = {
  ios: {
    nativeSources: "compile-native",
    resources: "repackage",
    resourceBundles: "repackage",
    vendoredFrameworks: "relink",
  },
  android: {
    nativeSources: "compile-native",
    resources: "repackage",
    assets: "repackage",
    libraries: "relink",
    nativeLibraries: "relink",
  },
} as const satisfies {
  [P in "ios" | "android"]: Partial<Record<keyof ResolvedNative[P], ActionKind>>;
};

/** The app configuration resolved.json carries that no build file does: the app's own files take it at install. */
const APP_CONFIGURATION = ["infoPlist", "entitlements"] as const;

/**
 * The packages' dependencies a build writes into the build files before its
 * check (writeLinkedPackage), as those files say them. The full build finds
 * the files already written, so what the last full build resolved tells
 * whether they changed: the podspec's pods, build.gradle's artifacts and
 * minimum SDK.
 */
const LINKED_DEPENDENCIES = {
  ios: { pods: (n?: ResolvedNative) => packagePods(n) },
  android: {
    dependencies: (n?: ResolvedNative) =>
      Object.entries(n?.android.dependencies ?? {}).map(([artifact, versions]) => [
        artifact,
        Object.keys(versions),
      ]),
    minSdk: (n?: ResolvedNative) => n?.android.minSdk?.value,
  },
};

/** Each field listing `file` (a native-package path under packages/), as the role it gives it. */
function packageRoles(file: string, manifests: ResolvedNative[]): Role[] {
  const roles: Role[] = [];

  for (const manifest of manifests)
    for (const platform of ["ios", "android"] as const)
      for (const [field, kind] of Object.entries(FIELD_ACTIONS[platform])) {
        const listed = manifest[platform][field as keyof ResolvedNative[typeof platform]];
        const paths = (
          Array.isArray(listed) ? listed : Object.values(listed).flat()
        ) as PackagePath[];

        if (
          paths.some(
            (p) => file === inNativePackage(p) || file.startsWith(`${inNativePackage(p)}/`),
          )
        )
          roles.push({ kind, targets: [platform] });
      }

  return roles;
}

function rolesOf(file: string, change: NativeChange): Role[] {
  if (file.startsWith("packages/")) {
    const roles = packageRoles(file, [
      change.manifest,
      ...(change.previous ? [change.previous] : []),
    ]);
    return roles.length ? roles : [{ kind: "relink", targets: "all" }];
  }

  for (const [pattern, role] of OUTPUT_ROLES) {
    const m = pattern.exec(file);
    if (m) return [role(m)];
  }

  // Unknown: relinking is always enough.
  return [{ kind: "relink", targets: "all" }];
}

const canonical = (v: unknown) =>
  JSON.stringify(v, (_, x) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1)))
      : x,
  );

/**
 * The actions `change` needs, one per kind (strongest first), each with the
 * targets and files that need it.
 */
export function classifyChanges(change: NativeChange): PendingAction[] {
  const actions = new Map<ActionKind, { targets: Set<string>; files: Set<string> }>();

  const need = (kind: ActionKind, targets: Role["targets"], file: string) => {
    const on = (targets === "all" ? change.targets : targets).filter((t) =>
      change.targets.includes(t),
    );
    if (!on.length) return;

    const action = actions.get(kind) ?? { targets: new Set(), files: new Set() };
    for (const t of on) action.targets.add(t);
    action.files.add(file);
    actions.set(kind, action);
  };

  for (const file of [...change.written, ...change.removed]) {
    // resolved.json: what the app's own files take, and what the build files had before
    // this build wrote them (the rest shows in the build files).
    if (file === "resolved.json") {
      for (const key of APP_CONFIGURATION)
        if (canonical(change.manifest.ios[key]) !== canonical(change.previous?.ios[key] ?? {}))
          need("reinstall", ["ios"], `resolved.json#ios.${key}`);

      for (const platform of ["ios", "android"] as const)
        for (const [field, of] of Object.entries(LINKED_DEPENDENCIES[platform]))
          if (canonical(of(change.manifest)) !== canonical(of(change.previous)))
            need("relink", [platform], `resolved.json#${platform}.${field}`);
      continue;
    }

    for (const role of rolesOf(file, change)) if (role.kind) need(role.kind, role.targets, file);
  }

  // CocoaPods lists a pod's files at pod install: iOS relinks when one comes or goes.
  for (const file of [...change.added, ...change.removed])
    for (const role of rolesOf(file, change))
      if (role.kind && role.kind !== "reload-js")
        need(
          "relink",
          role.targets === "all" ? ["ios"] : role.targets.filter((t) => t === "ios"),
          file,
        );

  return ACTION_KINDS.filter((kind) => actions.has(kind)).map((kind) => {
    const { targets, files } = actions.get(kind)!;

    return {
      kind,
      targets: change.targets.filter((t) => targets.has(t)),
      files: [...files].sort(),
    };
  });
}

/**
 * Whether the iOS build needs pod install first: CocoaPods reads the
 * podspec, its pods and the files it lists at pod install, so whatever
 * relinks iOS does.
 */
export function needsPodInstall(actions: PendingAction[]): boolean {
  return actions.some((a) => a.kind === "relink" && a.targets.includes("ios"));
}

/** An action in words, for the CLI and lucent dev. */
export const ACTION_TEXT: Record<ActionKind, string> = {
  reinstall: "reinstall the app",
  relink: "relink native dependencies",
  "compile-native": "recompile native code",
  repackage: "repackage resources",
  "reload-js": "reload JavaScript",
};

/** The first files of an action, and how many more. */
export function filesText(files: string[], shown = 2): string {
  const more = files.length - shown;

  return `${files.slice(0, shown).join(", ")}${more > 0 ? ` +${more} more` : ""}`;
}
