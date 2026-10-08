/**
 * Where a project's bindings come from, as its build and its editor both
 * read them: the SDKs, and what the app links (its pods, Swift packages,
 * resolved Gradle classpath, and the Lucent packages' prebuilt binaries).
 */
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
  const binaries = native?.binaries ?? packageBinaries(root);
  const pods = podsSearchPaths(path.join(root, "ios"));

  // The app's Xcode project: the iOS version it is deployed to, and its Swift packages, built.
  const app = xcodeApp(path.join(root, "ios"));
  const project = app
    ? {
        ...(app.deploymentTarget ? { deploymentTarget: app.deploymentTarget } : {}),
        ...(app.packages.length ? { swiftPackages: swiftPackages(app) } : {}),
      }
    : {};

  const frameworkPaths = [
    ...new Set(
      binaries.ios.map(frameworkSearchPath).filter((dir): dir is string => dir !== undefined),
    ),
  ];
  const ios: NonNullable<SdkOptions["ios"]> | undefined =
    pods || frameworkPaths.length || app ? { ...pods, ...project } : undefined;

  return {
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
function packageBinaries(root: string): NativeInputs["binaries"] {
  const hashes = projectHashes(root);

  try {
    const { binaries } = resolveNative(lucentPackages(root), { hashes });
    hashes.save();
    return binaries;
  } catch {
    return { ios: [], android: [] };
  }
}
