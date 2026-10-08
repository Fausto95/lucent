import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** The platform SDKs this machine has, for `lucent --version`: found without loading the compiler. */
export function installedSdks(): { ios?: string; android?: string } {
  const out: { ios?: string; android?: string } = {};
  if (process.platform === "darwin") {
    const r = spawnSync("xcrun", ["--sdk", "iphonesimulator", "--show-sdk-version"], {
      encoding: "utf8",
      timeout: 5000,
    });
    if (r.status === 0 && r.stdout.trim()) out.ios = r.stdout.trim();
  }
  const home = androidSdkCandidates(process.platform, os.homedir(), process.env).find((d) =>
    fs.existsSync(path.join(d, "platforms")),
  );
  const platforms = home && path.join(home, "platforms");
  if (platforms) {
    const newest = fs
      .readdirSync(platforms)
      .filter((p) => /^android-\d+/.test(p))
      .sort((a, b) => Number(b.slice(8)) - Number(a.slice(8)))[0];
    if (newest) out.android = newest;
  }
  return out;
}

/**
 * Where the Android SDK may be, first first: $ANDROID_HOME,
 * $ANDROID_SDK_ROOT, then Android Studio's default for the OS
 * (~/Library/Android/sdk, %LOCALAPPDATA%\Android\Sdk, ~/Android/Sdk).
 */
export function androidSdkCandidates(
  platform: NodeJS.Platform,
  home: string,
  env: Record<string, string | undefined>,
): string[] {
  const studio =
    platform === "darwin"
      ? path.join(home, "Library/Android/sdk")
      : platform === "win32"
        ? path.join(env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "Android", "Sdk")
        : path.join(home, "Android/Sdk");
  return [env.ANDROID_HOME, env.ANDROID_SDK_ROOT, studio].filter((d): d is string => !!d);
}
