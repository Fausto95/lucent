import { nativeOut } from "../native-out.ts";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { packageFile } from "../version.ts";

/** The native package's ios-extensions.json, as ios-extensions.js reads and applies it. */
export interface ExtensionTargets {
  format: number;
  nativePackage: string;
  extensions: { name: string; pod: string }[];
}

interface XcodeProject {
  parseSync(): XcodeProject;
  writeSync(): string;
}

// The Expo config plugin adds the same targets at prebuild: one definition, found from the
// package's root (the sources and dist/ sit at different depths).
const require = createRequire(import.meta.url);
const extensions = require(packageFile("ios-extensions.js")) as {
  readExtensionTargets(root: string, nativePackage?: string): ExtensionTargets | undefined;
  extensionFiles(manifest: ExtensionTargets): [string, string][];
  withExtensionPods(
    podfile: string,
    manifest: ExtensionTargets,
    podPath: string,
  ): string | undefined;
  withExtensionTargets(
    project: XcodeProject,
    manifest: ExtensionTargets,
    app: { bundleIdentifier?: string },
  ): boolean;
};

/** The app's Xcode project in ios/ (Pods' aside), relative to `root`: undefined without one. */
export function appXcodeProject(root: string): string | undefined {
  const ios = path.join(root, "ios");
  const name = (fs.existsSync(ios) ? fs.readdirSync(ios) : [])
    .filter((f) => f.endsWith(".xcodeproj") && f !== "Pods.xcodeproj")
    .sort()[0];
  const file = name && path.join("ios", name, "project.pbxproj");
  return file && fs.existsSync(path.join(root, file)) ? file : undefined;
}

/** The last build's ios-extensions.json in the native package at `outDir`, or undefined. */
export function extensionTargetsOf(root: string, outDir = nativeOut(root)) {
  return extensions.readExtensionTargets(root, path.relative(root, outDir));
}

const WHY = "add the app extensions Lucent packages declare (ios.appExtensions) as targets";

/**
 * What a bare app needs for the app extensions the last build recorded
 * (decision 0124): the targets its Xcode project lacks, their files in
 * ios/<name>/, and their targets in the Podfile. Nothing without a build
 * that recorded some, or without an Xcode project.
 */
export function extensionTargetChanges(
  root: string,
): { file: string; why: string; after: string }[] {
  const manifest = extensionTargetsOf(root);
  const pbxproj = appXcodeProject(root);
  if (!manifest || !pbxproj) return [];

  const out: { file: string; why: string; after: string }[] = [];
  const read = (file: string) =>
    fs.existsSync(path.join(root, file))
      ? fs.readFileSync(path.join(root, file), "utf8")
      : undefined;

  const { project } = require("xcode") as { project(file: string): XcodeProject };
  const p = project(path.join(root, pbxproj)).parseSync();
  if (extensions.withExtensionTargets(p, manifest, {}))
    out.push({ file: pbxproj, why: WHY, after: p.writeSync() });

  for (const [rel, text] of extensions.extensionFiles(manifest)) {
    const file = path.join("ios", rel);
    if (read(file) !== text) out.push({ file, why: WHY, after: text });
  }

  const podfile = path.join("ios", "Podfile");
  const pods = read(podfile);
  if (pods !== undefined) {
    const podPath = path
      .relative(path.join(root, "ios"), path.join(root, manifest.nativePackage))
      .split(path.sep)
      .join("/");
    const after = extensions.withExtensionPods(pods, manifest, podPath);
    if (after !== undefined) out.push({ file: podfile, why: WHY, after });
  }

  return out;
}
