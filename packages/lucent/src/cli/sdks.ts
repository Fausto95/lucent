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
  const home =
    process.env.ANDROID_HOME ||
    process.env.ANDROID_SDK_ROOT ||
    path.join(os.homedir(), process.platform === "darwin" ? "Library/Android/sdk" : "Android/Sdk");
  const platforms = path.join(home, "platforms");
  if (fs.existsSync(platforms)) {
    const newest = fs
      .readdirSync(platforms)
      .filter((p) => /^android-\d+/.test(p))
      .sort((a, b) => Number(b.slice(8)) - Number(a.slice(8)))[0];
    if (newest) out.android = newest;
  }
  return out;
}
