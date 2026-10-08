/**
 * Runs the bare example's Tests screen on a booted-here iOS simulator or a
 * running Android emulator, and passes when every end-to-end case passed:
 *   1. installs the Debug build (its bundle comes from Metro, which the
 *      caller started on port 8081);
 *   2. opens the Tests screen: on Android with the deep link
 *      lucentbare://lab/tests, on iOS with the launch argument
 *      `-lucentTab lab/tests` (the simulator asks to confirm a link that
 *      `simctl openurl` opens, and nobody is there to confirm it);
 *   3. waits for the line the screen logs when it has run every case, the
 *      verdict its `lucent-summary` text shows: `LUCENT_SUMMARY tests 23/23 passed`.
 *
 *   node scripts/device-check.ts ios --app <BareExample.app>
 *   node scripts/device-check.ts android --apk <app-debug.apk>
 *
 * On failure it keeps the device log, a screenshot and the verdict in
 * $DEVICE_CHECK_OUT (default: device-check/ under the working directory).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export interface Verdict {
  passed: number;
  total: number;
  ok: boolean;
  line: string;
}

/** The last Tests verdict in a device log, if the screen got that far. */
export function lastVerdict(log: string): Verdict | undefined {
  let found: Verdict | undefined;
  for (const m of log.matchAll(/LUCENT_SUMMARY tests (\d+)\/(\d+) passed[^\n]*/g)) {
    const passed = Number(m[1]);
    const total = Number(m[2]);
    found = { passed, total, ok: total > 0 && passed === total, line: m[0].trim() };
  }
  return found;
}

interface SimDevice {
  udid: string;
  name: string;
  state: string;
  isAvailable: boolean;
}

/** An available iPhone on the newest iOS runtime of `xcrun simctl list devices --json`. */
export function pickSimulator(list: {
  devices: Record<string, SimDevice[]>;
}): SimDevice | undefined {
  const version = (runtime: string) =>
    (runtime.match(/iOS-(\d+)-(\d+)/) ?? []).slice(1).map(Number) as number[];
  const runtimes = Object.keys(list.devices)
    .filter((r) => r.includes(".SimRuntime.iOS-"))
    .sort((a, b) => {
      const [am = 0, an = 0] = version(a);
      const [bm = 0, bn = 0] = version(b);
      return bm - am || bn - an;
    });
  for (const r of runtimes) {
    const phone = list.devices[r]!.find((d) => d.isAvailable && /^iPhone/.test(d.name));
    if (phone) return phone;
  }
  return undefined;
}

const BUNDLE_ID = "org.reactjs.native.example.BareExample";
const PACKAGE = "com.bareexample";
/** Metro bundles the app on its first request, then the screen runs every case. */
const TIMEOUT_MS = Number(process.env.DEVICE_CHECK_TIMEOUT_S ?? 900) * 1000;
const POLL_MS = 10_000;

function sh(cmd: string, args: string[], allowFail = false): string {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 256 << 20 });
  if (r.status !== 0 && !allowFail)
    throw new Error(`${cmd} ${args.join(" ")} failed (${r.status}):\n${r.stderr}${r.stdout}`);
  return r.stdout ?? "";
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForMetro(): Promise<void> {
  const until = Date.now() + 120_000;
  while (Date.now() < until) {
    try {
      const res = await fetch("http://localhost:8081/status");
      if ((await res.text()).includes("packager-status:running")) return;
    } catch {
      // Not listening yet.
    }
    await sleep(2000);
  }
  throw new Error("Metro did not answer on http://localhost:8081/status within 2 minutes");
}

interface Device {
  install(): void;
  open(): void;
  /** The device's log: the Tests screen's lines, or with `full` the app's whole log. */
  log(full?: boolean): string;
  screenshot(file: string): void;
}

function ios(app: string): Device {
  const list = JSON.parse(sh("xcrun", ["simctl", "list", "devices", "available", "--json"]));
  const sim = pickSimulator(list);
  if (!sim) throw new Error("No available iPhone simulator");
  console.log(`Simulator: ${sim.name} (${sim.udid})`);
  if (sim.state !== "Booted") sh("xcrun", ["simctl", "boot", sim.udid], true);
  sh("xcrun", ["simctl", "bootstatus", sim.udid, "-b"]);
  return {
    install: () => sh("xcrun", ["simctl", "install", sim.udid, app]),
    open: () =>
      sh("xcrun", [
        "simctl",
        "launch",
        "--terminate-running-process",
        sim.udid,
        BUNDLE_ID,
        "-lucentTab",
        "lab/tests",
      ]),
    log: (full) =>
      sh(
        "xcrun",
        [
          "simctl",
          "spawn",
          sim.udid,
          "log",
          "show",
          "--style",
          "compact",
          "--last",
          "30m",
          "--predicate",
          full ? 'process == "BareExample"' : 'eventMessage CONTAINS "LUCENT_SUMMARY"',
        ],
        true,
      ),
    screenshot: (file) => sh("xcrun", ["simctl", "io", sim.udid, "screenshot", file], true),
  };
}

function android(apk: string): Device {
  sh("adb", ["wait-for-device"]);
  // The Debug build asks Metro on the device's localhost.
  sh("adb", ["reverse", "tcp:8081", "tcp:8081"]);
  return {
    install: () => {
      sh("adb", ["install", "-r", apk]);
      sh("adb", ["logcat", "-c"], true);
    },
    open: () =>
      sh("adb", [
        "shell",
        "am",
        "start",
        "-W",
        "-a",
        "android.intent.action.VIEW",
        "-d",
        "lucentbare://lab/tests",
        PACKAGE,
      ]),
    log: (full) =>
      sh(
        "adb",
        full
          ? [
              "logcat",
              "-d",
              "-s",
              "Lucent:*",
              "ReactNativeJS:*",
              "ReactNative:*",
              "AndroidRuntime:E",
              "DEBUG:*",
            ]
          : ["logcat", "-d", "-s", "Lucent:*"],
        true,
      ),
    screenshot: (file) => {
      const r = spawnSync("adb", ["exec-out", "screencap", "-p"], { maxBuffer: 64 << 20 });
      if (r.status === 0) fs.writeFileSync(file, r.stdout);
    },
  };
}

async function main(): Promise<void> {
  const [platform, flag, artifact] = process.argv.slice(2);
  if (
    !artifact ||
    !((platform === "ios" && flag === "--app") || (platform === "android" && flag === "--apk"))
  )
    throw new Error("usage: device-check.ts ios --app <.app> | android --apk <.apk>");
  const out = path.resolve(process.env.DEVICE_CHECK_OUT ?? "device-check");
  fs.mkdirSync(out, { recursive: true });

  await waitForMetro();
  const device = platform === "ios" ? ios(artifact) : android(artifact);
  device.install();
  device.open();
  console.log(
    `Opened the Tests screen; waiting up to ${TIMEOUT_MS / 60000} minutes for its verdict.`,
  );

  const until = Date.now() + TIMEOUT_MS;
  let log = "";
  let verdict: Verdict | undefined;
  while (Date.now() < until) {
    await sleep(POLL_MS);
    log = device.log();
    verdict = lastVerdict(log);
    if (verdict) break;
  }

  if (verdict?.ok) {
    console.log(verdict.line);
    return;
  }
  const full = device.log(true);
  fs.writeFileSync(path.join(out, `${platform}-device.log`), full);
  device.screenshot(path.join(out, `${platform}-screen.png`));
  console.log(full.split("\n").slice(-200).join("\n"));
  throw new Error(
    verdict
      ? `The Tests screen failed: ${verdict.line}`
      : `No verdict from the Tests screen within ${TIMEOUT_MS / 60000} minutes`,
  );
}

if (import.meta.main)
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
