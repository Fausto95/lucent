/**
 * Runs the bare example's Tests screen on a booted-here iOS simulator or a
 * running Android emulator, and passes when every end-to-end case passed:
 *   1. installs the Debug build (its bundle comes from Metro, which the
 *      caller started on port 8081);
 *   2. opens the Tests screen: on Android with the deep link
 *      lucentbare://lab/tests, on iOS with the launch argument
 *      `-lucentTab lab/tests` (the simulator asks to confirm a link that
 *      `simctl openurl` opens, and nobody is there to confirm it);
 *   3. follows the lines the screen logs, LUCENT_PROGRESS after each case and
 *      LUCENT_SUMMARY with its verdict (`LUCENT_SUMMARY tests 70/70 passed`).
 *
 *   node scripts/device-check.ts ios --app <BareExample.app>
 *   node scripts/device-check.ts android --apk <app-debug.apk>
 *
 * It gives up early when the app exits, when the screen never starts a run,
 * or when a run stops moving. On failure it keeps the device log, a
 * screenshot and the summary in $DEVICE_CHECK_OUT (default: device-check/),
 * prints the app's own log lines (not the system's), then a short summary of
 * why, last: CI annotates a failing step with the end of its output. The
 * summary also goes to $GITHUB_STEP_SUMMARY and an error annotation. $METRO_LOG
 * names Metro's log, whose end the summary includes.
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

export interface Progress {
  done: number;
  total: number;
  /** The case that finished last; undefined at the run's start. */
  name?: string;
  pass?: boolean;
}

/** How far the last Tests run got: `LUCENT_PROGRESS tests 5/70 closures ok 12ms`. */
export function lastProgress(log: string): Progress | undefined {
  let found: Progress | undefined;
  for (const m of log.matchAll(/LUCENT_PROGRESS tests (\d+)\/(\d+) ([^\n]*)/g)) {
    const done = Number(m[1]);
    const total = Number(m[2]);
    const c = m[3]!.trim().match(/^(.*) (ok|FAILED)(?: \d+ms)?$/);
    found = c ? { done, total, name: c[1], pass: c[2] === "ok" } : { done, total };
  }
  return found;
}

/** Progress for people: `12/70 run (last: closures, failed)`. */
export function describeProgress(p: Progress | undefined): string {
  if (!p) return "no case ran";
  if (p.name === undefined) return `started, 0/${p.total} run`;
  return `${p.done}/${p.total} run (last: ${p.name}${p.pass ? "" : ", failed"})`;
}

/** Lines that say the app crashed: native aborts, uncaught exceptions, signals. */
const CRASH =
  /FATAL EXCEPTION|Fatal signal \d+|Abort message|Terminating app due to|libc\+\+abi: terminating|terminating due to uncaught|EXC_BAD_ACCESS|EXC_CRASH|SIGABRT|SIGSEGV|SIGBUS|SIGILL|Process com\.bareexample \(pid \d+\) has died/;

/** Lines that say JavaScript failed: a red box, a fatal JS error, a bundle that didn't load. */
const JS_ERROR =
  /RedBox|RCTFatal|Unhandled JS Exception|Uncaught (Error|TypeError|ReferenceError)|E ReactNativeJS|Could not connect to (the )?development server|Unable to load script|No (script|bundle) URL|Invariant Violation|SyntaxError:|TypeError:|ReferenceError:|Requiring unknown module/;

/** The app's own lines: Lucent, React Native, JavaScript, crashes, its errors. */
const APP_LINE =
  /Lucent|LUCENT_|ReactNative|ReactHost|com\.facebook\.react|\[javascript\]|hermes|Metro|AndroidRuntime|DEBUG\s*:|libc\s*:|com\.bareexample|^\S+ \S+ +(E|F|Er|Ft|Fa) +BareExample/;

/** Lines from the app's process that match the patterns above but say nothing about it. */
const NOISE =
  /com\.apple\.network|com\.apple\.CFNetwork:Default|com\.apple\.UIKit:BackgroundTask|BKSProcessAssertion|nw_(flow|connection|endpoint)|boringssl|dexopt|Compiler allocated|JIT profile/;

const keep = (l: string, re: RegExp) => re.test(l) && !NOISE.test(l);

/** The app's own lines of a device log, the last `max`, each at most `width` long. */
export function appLines(log: string, max = 40, width = 240): string[] {
  const kept = log
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => keep(l, APP_LINE) || keep(l, CRASH) || keep(l, JS_ERROR));
  return kept.slice(-max).map((l) => (l.length > width ? `${l.slice(0, width - 1)}…` : l));
}

/** The crash lines of a log; Java's uncaught exception with the two lines that name it. */
export function crashLines(log: string): string[] {
  const lines = log.split("\n");
  const found: string[] = [];
  lines.forEach((l, i) => {
    if (!keep(l, CRASH)) return;
    found.push(l);
    if (/FATAL EXCEPTION/.test(l))
      found.push(...lines.slice(i + 1, i + 3).filter((n) => n.includes("AndroidRuntime")));
  });
  return found;
}

export function jsErrorLines(log: string): string[] {
  return log.split("\n").filter((l) => keep(l, JS_ERROR));
}

/** The text an Android `uiautomator dump` shows on the screen, in order, once each. */
export function screenText(xml: string): string[] {
  const seen = new Set<string>();
  for (const m of xml.matchAll(/(?:text|content-desc)="([^"]+)"/g)) {
    const t = m[1]!
      .replace(/&#10;/g, " ")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim();
    if (t) seen.add(t);
  }
  return [...seen];
}

/** An iOS crash report's (.ips) exception and termination, in one line. */
export function crashReport(ips: string): string {
  const field = (name: string) =>
    [...ips.matchAll(new RegExp(`"${name}"\\s*:\\s*"([^"]*)"`, "g"))].map((m) => m[1]!);
  const parts = [
    ...field("type"),
    ...field("signal"),
    ...field("indicator"),
    ...field("reason").slice(0, 1),
  ];
  return [...new Set(parts)].join(", ") || "no exception recorded";
}

/** The pid of a running iOS app in `launchctl list` (inside the simulator), if it runs. */
export function iosAppPid(launchctl: string, bundleId: string): number | undefined {
  for (const line of launchctl.split("\n")) {
    const [pid, , label] = line.trim().split(/\s+/);
    if (label?.startsWith(`UIKitApplication:${bundleId}[`) && pid && /^\d+$/.test(pid))
      return Number(pid);
  }
  return undefined;
}

/** Why the wait ended. */
export type Stop = "verdict" | "timeout" | "exited" | "stalled" | "no-start";

export interface Facts {
  platform: "ios" | "android";
  stop: Stop;
  /** Minutes waited: since the app opened, or for a stalled run since its last case. */
  minutes: number;
  verdict?: Verdict;
  progress?: Progress;
  /** Whether the app's process was running at the end (undefined: unknown). */
  running?: boolean;
  crash: string[];
  jsErrors: string[];
  /** Other things seen, said as they are. */
  notes?: string[];
  metroUp: boolean;
  /** What the screen showed at the end, if it could be read. */
  screen?: string[];
}

const minutes = (m: number) => {
  const n = Math.max(1, Math.round(m));
  return `${n} minute${n === 1 ? "" : "s"}`;
};

/** A short account of a failed run: the first line says why, the others what was seen. */
export function diagnose(f: Facts): string[] {
  const at = f.progress?.name
    ? `after case ${f.progress.done}/${f.progress.total} (${f.progress.name})`
    : f.progress
      ? "before its first case finished"
      : "before the Tests screen started a run";
  let why: string;
  if (f.verdict && !f.verdict.ok)
    why = `The Tests screen failed: ${f.verdict.line.replace(/^LUCENT_SUMMARY tests /, "")}`;
  else if (f.crash.length > 0) why = `The app crashed ${at}: ${f.crash[0]!.trim()}`;
  else if (f.stop === "exited" || f.running === false)
    why = `The app exited ${at}, with no crash in the log`;
  else if (!f.progress && !f.metroUp)
    why = "Metro stopped answering on localhost:8081, and the Tests screen never started a run";
  else if (!f.progress && f.jsErrors.length > 0)
    why = `The Tests screen never started a run; JavaScript failed: ${f.jsErrors[0]!.trim()}`;
  else if (!f.progress)
    why = `The Tests screen never started a run in ${minutes(f.minutes)} (no LUCENT_PROGRESS line): the bundle didn't load, the screen didn't open, or Lucent's console doesn't reach the device log`;
  else if (f.stop === "stalled")
    why = `The run stopped moving ${at}: no case finished for ${minutes(f.minutes)}`;
  else
    why = `No verdict within ${minutes(f.minutes)}; the run got to ${describeProgress(f.progress)}`;

  const lines = [
    `Device run (${f.platform}) failed. ${why}`,
    `Progress: ${describeProgress(f.progress)}.`,
    `App: ${f.running === undefined ? "unknown" : f.running ? "running" : "not running"}. Metro: ${f.metroUp ? "up" : "not answering"}.`,
  ];
  if (f.crash.length > 1)
    lines.push(
      `Crash: ${f.crash
        .slice(0, 4)
        .map((l) => l.trim())
        .join(" / ")}`,
    );
  if (f.jsErrors.length > 0)
    lines.push(
      `JavaScript errors: ${f.jsErrors
        .slice(-3)
        .map((l) => l.trim())
        .join(" / ")}`,
    );
  for (const note of f.notes ?? []) lines.push(`${note}.`);
  if (f.screen?.length) lines.push(`Screen shows: ${f.screen.slice(0, 25).join(" | ")}`);
  return lines.map((l) => (l.length > 600 ? `${l.slice(0, 599)}…` : l));
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
    const phone = list.devices[r]!.find((d) => d.isAvailable && d.name.startsWith("iPhone"));
    if (phone) return phone;
  }
  return undefined;
}

const BUNDLE_ID = "org.reactjs.native.example.BareExample";
const PACKAGE = "com.bareexample";
const seconds = (name: string, fallback: number) => Number(process.env[name] ?? fallback) * 1000;
/** The whole wait for a verdict. */
const TIMEOUT_MS = seconds("DEVICE_CHECK_TIMEOUT_S", 900);
/** Until the screen starts its run: Metro serves the bundle, the app opens the screen. */
const START_MS = seconds("DEVICE_CHECK_START_S", 480);
/** Between two finished cases (a case gives up after 10 seconds). */
const STALL_MS = seconds("DEVICE_CHECK_STALL_S", 180);
const POLL_MS = 10_000;

const outDir = () => path.resolve(process.env.DEVICE_CHECK_OUT ?? "device-check");

function sh(cmd: string, args: string[], allowFail = false, timeout?: number): string {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 256 << 20, timeout });
  if (r.status !== 0 && !allowFail)
    throw new Error(`${cmd} ${args.join(" ")} failed (${r.status}):\n${r.stderr}${r.stdout}`);
  return r.stdout ?? "";
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function metroUp(): Promise<boolean> {
  try {
    const res = await fetch("http://localhost:8081/status", { signal: AbortSignal.timeout(5000) });
    return (await res.text()).includes("packager-status:running");
  } catch {
    return false;
  }
}

/** A failure whose message is already the summary. */
class Failure extends Error {
  readonly summary: string[];
  constructor(summary: string[]) {
    super(summary.join("\n"));
    this.summary = summary;
  }
}

async function waitForMetro(platform: string): Promise<void> {
  const until = Date.now() + 120_000;
  while (Date.now() < until) {
    if (await metroUp()) return;
    await sleep(2000);
  }
  throw new Failure([
    `Device run (${platform}) failed. Metro did not answer on http://localhost:8081/status within 2 minutes (see the Start Metro step).`,
  ]);
}

interface Device {
  install(): void;
  open(): void;
  /** The Lucent lines of the device log since the app opened (LUCENT_PROGRESS, LUCENT_SUMMARY). */
  lucent(): string;
  /** The app's whole log, crash buffers included. */
  log(): string;
  running(): boolean | undefined;
  /** Saves a screenshot, and returns the text on the screen when it can be read. */
  screen(file: string): string[] | undefined;
  /** What else says why: crash reports (`crash`), the device's state (`notes`). */
  evidence(): { crash: string[]; notes: string[] };
}

function ios(app: string): Device {
  const list = JSON.parse(sh("xcrun", ["simctl", "list", "devices", "available", "--json"]));
  const sim = pickSimulator(list);
  if (!sim) throw new Failure(["Device run (ios) failed. No available iPhone simulator."]);
  console.log(`Simulator: ${sim.name} (${sim.udid})`);
  if (sim.state !== "Booted") sh("xcrun", ["simctl", "boot", sim.udid], true);
  sh("xcrun", ["simctl", "bootstatus", sim.udid, "-b"]);
  const since = Date.now();
  const show = (predicate: string) =>
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
        "--info",
        "--last",
        `${Math.ceil((Date.now() - since) / 60_000) + 2}m`,
        "--predicate",
        predicate,
      ],
      true,
    );
  const reports = path.join(process.env.HOME ?? "", "Library/Logs/DiagnosticReports");
  return {
    install: () => sh("xcrun", ["simctl", "install", sim.udid, app]),
    open: () =>
      console.log(
        sh("xcrun", [
          "simctl",
          "launch",
          "--terminate-running-process",
          sim.udid,
          BUNDLE_ID,
          "-lucentTab",
          "lab/tests",
        ]).trim(),
      ),
    lucent: () => show('eventMessage CONTAINS "LUCENT_"'),
    log: () => show('process == "BareExample"'),
    running: () => {
      const r = spawnSync("xcrun", ["simctl", "spawn", sim.udid, "launchctl", "list"], {
        encoding: "utf8",
      });
      return r.status === 0 ? iosAppPid(r.stdout, BUNDLE_ID) !== undefined : undefined;
    },
    screen: (file) => {
      sh("xcrun", ["simctl", "io", sim.udid, "screenshot", file], true);
      if (!fs.existsSync(file)) return undefined;
      // Vision's text recognition, through the Swift interpreter: what the screen says.
      const ocr = path.join(import.meta.dirname, "ocr.swift");
      const text = sh("xcrun", ["swift", ocr, file], true, 180_000);
      return text.split("\n").filter((l) => l.trim());
    },
    evidence: () => {
      let files: string[] = [];
      try {
        files = fs
          .readdirSync(reports)
          .filter((f) => f.startsWith("BareExample"))
          .map((f) => path.join(reports, f))
          .filter((f) => fs.statSync(f).mtimeMs >= since);
      } catch {
        // No reports folder: no crash reports.
      }
      const crash = files.map((f) => {
        fs.copyFileSync(f, path.join(outDir(), path.basename(f)));
        return `crash report ${path.basename(f)}: ${crashReport(fs.readFileSync(f, "utf8"))}`;
      });
      return { crash, notes: [] };
    },
  };
}

function android(apk: string): Device {
  sh("adb", ["wait-for-device"]);
  // The Debug build asks Metro on the device's localhost.
  sh("adb", ["reverse", "tcp:8081", "tcp:8081"]);
  return {
    install: () => {
      sh("adb", ["install", "-r", apk]);
      sh("adb", ["logcat", "-b", "all", "-c"], true);
    },
    open: () => {
      const out = sh("adb", [
        "shell",
        "am",
        "start",
        "-W",
        "-a",
        "android.intent.action.VIEW",
        "-d",
        "lucentbare://lab/tests",
        PACKAGE,
      ]).trim();
      console.log(out);
      if (/^Error|Exception/m.test(out))
        throw new Failure([
          `Device run (android) failed. The deep link lucentbare://lab/tests didn't open the app: ${out.split("\n").at(-1)}`,
        ]);
    },
    lucent: () => sh("adb", ["logcat", "-d", "-s", "Lucent:*"], true),
    log: () => sh("adb", ["logcat", "-d", "-b", "main,system,crash", "-v", "threadtime"], true),
    running: () => {
      const r = spawnSync("adb", ["shell", "pidof", PACKAGE], { encoding: "utf8" });
      return r.error ? undefined : /\d/.test(r.stdout ?? "");
    },
    screen: (file) => {
      const r = spawnSync("adb", ["exec-out", "screencap", "-p"], { maxBuffer: 64 << 20 });
      if (r.status === 0) fs.writeFileSync(file, r.stdout);
      sh("adb", ["shell", "uiautomator", "dump", "/sdcard/lucent-ui.xml"], true, 60_000);
      const xml = sh("adb", ["shell", "cat", "/sdcard/lucent-ui.xml"], true);
      fs.writeFileSync(file.replace(/\.png$/, ".xml"), xml);
      return xml.includes("<hierarchy") ? screenText(xml) : undefined;
    },
    evidence: () => ({
      crash: [],
      notes: sh("adb", ["reverse", "--list"], true).includes("8081")
        ? []
        : ["adb reverse of tcp:8081 is gone: the app can't reach Metro"],
    }),
  };
}

/** The end of Metro's log, without its escape sequences and redrawn progress bars. */
function metroTail(): string[] {
  const file = process.env.METRO_LOG;
  if (!file || !fs.existsSync(file)) return [];
  return (
    fs
      .readFileSync(file, "utf8")
      // oxlint-disable-next-line no-control-regex -- Metro's colors and cursor moves
      .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
      .split("\n")
      .map((l) => l.split("\r").at(-1)!.trimEnd())
      .filter((l) => l.trim())
      .slice(-15)
      .map((l) => (l.length > 240 ? `${l.slice(0, 239)}…` : l))
  );
}

/** Prints and keeps the summary: last in the output, in the step summary, as an annotation. */
function report(summary: string[], details: { app: string[]; metro: string[] }): void {
  fs.mkdirSync(outDir(), { recursive: true });
  fs.writeFileSync(path.join(outDir(), "summary.txt"), `${summary.join("\n")}\n`);
  const step = process.env.GITHUB_STEP_SUMMARY;
  if (step) {
    const fold = (title: string, lines: string[]) =>
      lines.length
        ? [`<details><summary>${title}</summary>`, "", "```", ...lines, "```", "</details>", ""]
        : [];
    const md = [
      `### ${summary[0]}`,
      "",
      ...summary.slice(1).map((l) => `- ${l}`),
      "",
      ...fold("The app's log, its own lines", details.app),
      ...fold("The end of Metro's log", details.metro),
    ];
    fs.appendFileSync(step, `${md.join("\n").replace(/```(?=.)/g, "'''")}\n`);
  }
  if (process.env.GITHUB_ACTIONS) {
    const text = summary.join("\n").slice(0, 3500);
    const escaped = text.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
    console.log(`::error title=Device run failed::${escaped}`);
  }
  // Last, so the step's annotation (the end of its output) carries it.
  console.log(`\n${summary.join("\n")}`);
}

async function main(): Promise<boolean> {
  const [platform, flag, artifact] = process.argv.slice(2);
  if (
    !artifact ||
    !((platform === "ios" && flag === "--app") || (platform === "android" && flag === "--apk"))
  )
    throw new Error("usage: device-check.ts ios --app <.app> | android --apk <.apk>");
  fs.mkdirSync(outDir(), { recursive: true });

  await waitForMetro(platform);
  const device = platform === "ios" ? ios(artifact) : android(artifact);
  device.install();
  device.open();
  const opened = Date.now();
  console.log(
    `Opened the Tests screen; waiting up to ${TIMEOUT_MS / 60000} minutes for its verdict.`,
  );

  let verdict: Verdict | undefined;
  let progress: Progress | undefined;
  let moved = opened;
  let gone = 0;
  let stop: Stop = "timeout";
  while (Date.now() < opened + TIMEOUT_MS) {
    await sleep(POLL_MS);
    const lucent = device.lucent();
    verdict = lastVerdict(lucent);
    if (verdict) {
      stop = "verdict";
      break;
    }
    const now = lastProgress(lucent);
    if (now && (now.done !== progress?.done || now.total !== progress?.total)) {
      console.log(`Progress: ${describeProgress(now)}`);
      moved = Date.now();
    }
    progress = now;
    // An app that quit stays quit: two polls in a row, past its first seconds.
    gone = Date.now() - opened > 30_000 && device.running() === false ? gone + 1 : 0;
    if (gone >= 2) {
      stop = "exited";
      break;
    }
    if (!progress && Date.now() - opened > START_MS) {
      stop = "no-start";
      break;
    }
    if (progress && Date.now() - moved > STALL_MS) {
      stop = "stalled";
      break;
    }
  }

  if (verdict?.ok) {
    console.log(verdict.line);
    return true;
  }

  const log = device.log();
  fs.writeFileSync(path.join(outDir(), `${platform}-device.log`), log);
  const evidence = device.evidence();
  const facts: Facts = {
    platform: platform as "ios" | "android",
    stop,
    minutes: (Date.now() - (stop === "stalled" ? moved : opened)) / 60_000,
    verdict,
    progress,
    running: device.running(),
    crash: [...evidence.crash, ...crashLines(log)],
    notes: evidence.notes,
    jsErrors: jsErrorLines(log),
    metroUp: await metroUp(),
    screen: device.screen(path.join(outDir(), `${platform}-screen.png`)),
  };
  const app = appLines(log);
  const metro = metroTail();
  console.log(`--- The app's own lines in the device log (the last ${app.length}):`);
  console.log(app.join("\n"));
  if (metro.length) console.log(`--- The end of Metro's log:\n${metro.join("\n")}`);
  report(diagnose(facts), { app, metro });
  return false;
}

if (import.meta.main)
  main().then(
    (ok) => process.exit(ok ? 0 : 1),
    (e: unknown) => {
      const summary =
        e instanceof Failure
          ? e.summary
          : [`Device run failed. ${e instanceof Error ? e.message : String(e)}`];
      report(summary, { app: [], metro: metroTail() });
      process.exit(1);
    },
  );
