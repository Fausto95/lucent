/**
 * Where a project's bindings come from, as its build and its editor both
 * read them: the SDKs, and what the app links (its pods, Swift packages,
 * resolved Gradle classpath, and the Lucent packages' prebuilt binaries).
 */
import fs from "node:fs";
import path from "node:path";
import {
  frameworkSearchPath,
  podsSearchPaths,
  swiftPackages,
  xcodeApp,
} from "@lucent-lang/bindgen";
import { type NativeInputs, resolveNative } from "./package-config.ts";
import { fileHashes } from "./package-files.ts";
import { lucentPackages } from "./packages.ts";
import type { SdkOptions } from "./sdk/schema.ts";

/** Where `lucent sdk lock --schemas` exports the schemas a machine without an SDK types from. */
export const SCHEMA_SET_DIR = "lucent-sdk.schemas";

/** The project's memo of its packages' file hashes, by their stats. */
export const projectHashes = (root: string) =>
  fileHashes(path.join(root, ".lucent/file-hashes.json"));

/**
 * Where this project's bindings come from: the SDKs, and what the app
 * links: its pods, Swift packages and Gradle classpath, and the prebuilt
 * frameworks and libraries its Lucent packages ship (`native`, resolved
 * here when not given); and the iOS version it is deployed to.
 */
export function projectSdk(root: string, native?: NativeInputs): SdkOptions {
  const { binaries, swiftSources } = native ?? packageBinaries(root);
  const pods = podsSearchPaths(path.join(root, "ios"));

  // The app's Xcode project: the iOS version it is deployed to, and its Swift packages, built.
  const app = xcodeApp(path.join(root, "ios"));
  const project = app
    ? {
        ...(app.deploymentTarget ? { deploymentTarget: app.deploymentTarget } : {}),
        ...(app.packages.length || app.localPackages?.length
          ? { swiftPackages: swiftPackages(app) }
          : {}),
      }
    : {};

  const frameworkPaths = [
    ...new Set(
      binaries.ios.map(frameworkSearchPath).filter((dir): dir is string => dir !== undefined),
    ),
  ];
  const ios: NonNullable<SdkOptions["ios"]> | undefined =
    pods || frameworkPaths.length || app || swiftSources.length
      ? { ...pods, ...project, ...(swiftSources.length ? { swiftSources } : {}) }
      : undefined;

  // The schemas a teammate's `lucent sdk lock --schemas` exported: a platform without its SDK here.
  const schemas = path.join(root, SCHEMA_SET_DIR);

  return {
    ...(fs.existsSync(schemas) ? { schemas } : {}),
    android: {
      classpath: path.join(root, ".lucent/android-classpath.json"),
      ...(binaries.android.length ? { libraries: binaries.android } : {}),
    },
    ...(ios
      ? { ios: { ...ios, frameworkPaths: [...(ios.frameworkPaths ?? []), ...frameworkPaths] } }
      : {}),
  };
}

/**
 * The binaries the project's Lucent packages ship, for what binds without
 * building (lucent sdk …, the editor): none when a lucent.json is invalid,
 * which the build reports.
 */
function packageBinaries(root: string): Pick<NativeInputs, "binaries" | "swiftSources"> {
  const hashes = projectHashes(root);

  try {
    const { binaries, swiftSources } = resolveNative(lucentPackages(root), { hashes });
    hashes.save();
    return { binaries, swiftSources };
  } catch {
    return { binaries: { ios: [], android: [] }, swiftSources: [] };
  }
}
