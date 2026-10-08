import { describe, expect, it } from "vite-plus/test";
import {
  appLines,
  crashLines,
  crashReport,
  describeProgress,
  diagnose,
  type Facts,
  iosAppPid,
  jsErrorLines,
  lastProgress,
  lastVerdict,
  pickSimulator,
  screenText,
} from "./device-check.ts";

describe("lastVerdict", () => {
  it("reads the Tests screen's line from a device log", () => {
    const log = [
      "10-08 12:00:01.000 I Lucent: something else",
      "10-08 12:00:09.000 I Lucent: LUCENT_SUMMARY tests 23/23 passed",
    ].join("\n");
    expect(lastVerdict(log)).toEqual({
      passed: 23,
      total: 23,
      ok: true,
      line: "LUCENT_SUMMARY tests 23/23 passed",
    });
  });

  it("fails a run with a failed case, and keeps the names", () => {
    const v = lastVerdict("LUCENT_SUMMARY tests 22/23 passed; failed: closures\n");
    expect(v).toMatchObject({ passed: 22, total: 23, ok: false });
    expect(v?.line).toBe("LUCENT_SUMMARY tests 22/23 passed; failed: closures");
  });

  it("takes the last run when the screen ran twice", () => {
    const log = "LUCENT_SUMMARY tests 1/2 passed\nLUCENT_SUMMARY tests 2/2 passed\n";
    expect(lastVerdict(log)?.ok).toBe(true);
  });

  it("ignores the other screens and an empty run", () => {
    expect(lastVerdict("LUCENT_SUMMARY sdk 3/3 passed")).toBeUndefined();
    expect(lastVerdict("LUCENT_SUMMARY tests 0/0 passed")?.ok).toBe(false);
  });
});

describe("pickSimulator", () => {
  const phone = (name: string, udid: string, isAvailable = true) => ({
    name,
    udid,
    state: "Shutdown",
    isAvailable,
  });

  it("takes an available iPhone on the newest iOS runtime", () => {
    const list = {
      devices: {
        "com.apple.CoreSimulator.SimRuntime.iOS-26-4": [phone("iPhone 17", "a")],
        "com.apple.CoreSimulator.SimRuntime.iOS-26-5": [
          phone("iPad Air 11-inch (M4)", "b"),
          phone("iPhone 17 Pro", "c", false),
          phone("iPhone 17", "d"),
        ],
        "com.apple.CoreSimulator.SimRuntime.tvOS-26-5": [phone("Apple TV", "e")],
      },
    };
    expect(pickSimulator(list)?.udid).toBe("d");
  });

  it("finds none without an iPhone", () => {
    expect(pickSimulator({ devices: {} })).toBeUndefined();
  });
});

describe("lastProgress", () => {
  it("reads how far the run got, with the last case's name", () => {
    const log = [
      "I Lucent: [Lucent] LUCENT_PROGRESS tests 0/70 started",
      "I Lucent: [Lucent] LUCENT_PROGRESS tests 1/70 abort ok 31ms",
      "I Lucent: [Lucent] LUCENT_PROGRESS tests 2/70 absent results FAILED 10012ms",
    ].join("\n");
    expect(lastProgress(log)).toEqual({ done: 2, total: 70, name: "absent results", pass: false });
    expect(describeProgress(lastProgress(log))).toBe("2/70 run (last: absent results, failed)");
  });

  it("knows a run that started and one that didn't", () => {
    expect(lastProgress("LUCENT_PROGRESS tests 0/70 started")).toEqual({ done: 0, total: 70 });
    expect(describeProgress(lastProgress("LUCENT_PROGRESS tests 0/70 started"))).toBe(
      "started, 0/70 run",
    );
    expect(lastProgress("LUCENT_PROGRESS sdk 1/3 clipboard ok 4ms")).toBeUndefined();
  });
});

// The noise of the first runs: the simulator's network and UIKit lines for the app's process.
const iosLog = [
  "2026-10-08 11:59:59.256 Df BareExample[31848:159f0] [com.apple.network:connection] nw_flow_connected [C1.1.1 IPv6#21bc498c.8081 in_progress socket-flow]",
  "2026-10-08 11:59:59.318 Df BareExample[31848:159e4] [com.apple.UIKit:BackgroundTask] Ending background task with UIBackgroundTaskIdentifier: 2",
  "2026-10-08 12:00:01.100 Df BareExample[31848:159e4] [com.facebook.react.log:native] Running surface 'BareExample'",
  "2026-10-08 12:00:02.000 Df BareExample[31848:159e4] [Lucent] LUCENT_PROGRESS tests 0/70 started",
  "2026-10-08 12:00:03.000 E  BareExample[31848:159e4] [com.facebook.react.log:javascript] Unhandled JS Exception: TypeError: undefined is not a function",
  "2026-10-08 12:00:03.500 E  BareExample[31848:159e4] libc++abi: terminating due to uncaught exception of type facebook::jsi::JSError",
].join("\n");

describe("appLines", () => {
  it("keeps the app's own lines and drops the system's", () => {
    expect(appLines(iosLog).map((l) => l.slice(24, 26))).toEqual(["Df", "Df", "E ", "E "]);
    expect(appLines(iosLog).join("\n")).not.toContain("com.apple.network");
  });

  it("keeps Android's React Native, Lucent and crash tags", () => {
    const log = [
      "10-08 12:00:00.000  1234  1250 I ActivityManager: Start proc 4321:com.bareexample/u0a190",
      "10-08 12:00:00.100  4321  4321 D SoLoader: init start",
      '10-08 12:00:01.000  4321  4330 I ReactNativeJS: Running "BareExample"',
      "10-08 12:00:02.000  4321  4330 E AndroidRuntime: FATAL EXCEPTION: mqt_v_js",
      "10-08 12:00:02.000   999   999 I chatty  : uid=1000 system_server expire 3 lines",
    ].join("\n");
    expect(appLines(log)).toHaveLength(3);
  });

  it("keeps the last lines, each cut to a width", () => {
    const log = Array.from({ length: 100 }, (_, i) => `I Lucent: ${i} ${"x".repeat(300)}`).join(
      "\n",
    );
    const kept = appLines(log, 10, 50);
    expect(kept).toHaveLength(10);
    expect(kept[0]).toMatch(/^I Lucent: 90 x+…$/);
    expect(kept[0]).toHaveLength(50);
  });
});

describe("crashLines and jsErrorLines", () => {
  it("find a native abort and a JavaScript exception", () => {
    expect(crashLines(iosLog)).toHaveLength(1);
    expect(crashLines(iosLog)[0]).toContain("libc++abi: terminating");
    expect(jsErrorLines(iosLog)).toHaveLength(1);
    expect(jsErrorLines(iosLog)[0]).toContain("Unhandled JS Exception");
  });

  it("keep the exception under Java's FATAL EXCEPTION", () => {
    const log = [
      "10-08 12:00:02.000  4321  4330 E AndroidRuntime: FATAL EXCEPTION: mqt_v_js",
      "10-08 12:00:02.000  4321  4330 E AndroidRuntime: Process: com.bareexample, PID: 4321",
      "10-08 12:00:02.000  4321  4330 E AndroidRuntime: java.lang.UnsatisfiedLinkError: liblucent.so",
      "10-08 12:00:02.000  4321  4330 E AndroidRuntime: \tat java.lang.Runtime.loadLibrary0",
    ].join("\n");
    expect(crashLines(log)).toHaveLength(3);
    expect(crashLines(log)[2]).toContain("UnsatisfiedLinkError");
  });
});

describe("crashReport", () => {
  it("reads an .ips report's exception and termination", () => {
    const ips = `{"app_name":"BareExample"}
{
  "exception" : {"codes":"0x0000000000000000, 0x0000000000000000","rawCodes":[0,0],"type":"EXC_CRASH","signal":"SIGABRT"},
  "termination" : {"flags":0,"code":6,"namespace":"SIGNAL","indicator":"Abort trap: 6","byProc":"BareExample"}
}`;
    expect(crashReport(ips)).toBe("EXC_CRASH, SIGABRT, Abort trap: 6");
    expect(crashReport("{}")).toBe("no exception recorded");
  });
});

describe("screenText", () => {
  it("reads the text and descriptions of a uiautomator dump, once each", () => {
    const xml = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0">
<node text="Tests" content-desc="" /><node text="12/70 run · 12 passed" content-desc="" />
<node text="" content-desc="Run again" /><node text="Tests" /><node text="a &amp; b&#10;c" /></hierarchy>`;
    expect(screenText(xml)).toEqual(["Tests", "12/70 run · 12 passed", "Run again", "a & b c"]);
  });
});

describe("iosAppPid", () => {
  const list = [
    "PID\tStatus\tLabel",
    "-\t0\tcom.apple.Preferences",
    "5123\t0\tUIKitApplication:org.reactjs.native.example.BareExample[a1b2][rb-legacy]",
  ].join("\n");

  it("finds the app's process", () => {
    expect(iosAppPid(list, "org.reactjs.native.example.BareExample")).toBe(5123);
  });

  it("finds none for an app that isn't running", () => {
    const stopped = list.replace("5123", "-");
    expect(iosAppPid(stopped, "org.reactjs.native.example.BareExample")).toBeUndefined();
  });
});

describe("diagnose", () => {
  const base: Facts = {
    platform: "ios",
    stop: "timeout",
    minutes: 15,
    running: true,
    crash: [],
    jsErrors: [],
    metroUp: true,
  };

  it("names the failed cases of a verdict", () => {
    const lines = diagnose({
      ...base,
      stop: "verdict",
      verdict: {
        passed: 69,
        total: 70,
        ok: false,
        line: "LUCENT_SUMMARY tests 69/70 passed; failed: closures",
      },
      progress: { done: 70, total: 70, name: "weakrefs", pass: true },
    });
    expect(lines[0]).toBe(
      "Device run (ios) failed. The Tests screen failed: 69/70 passed; failed: closures",
    );
  });

  it("says where the app crashed, and how", () => {
    const lines = diagnose({
      ...base,
      stop: "exited",
      running: false,
      progress: { done: 12, total: 70, name: "closures", pass: true },
      crash: ["crash report BareExample-2026-10-08.ips: EXC_CRASH, SIGABRT"],
    });
    expect(lines[0]).toBe(
      "Device run (ios) failed. The app crashed after case 12/70 (closures): crash report BareExample-2026-10-08.ips: EXC_CRASH, SIGABRT",
    );
    expect(lines).toContain("App: not running. Metro: up.");
  });

  it("tells an exit without a crash", () => {
    const lines = diagnose({ ...base, stop: "exited", running: false });
    expect(lines[0]).toBe(
      "Device run (ios) failed. The app exited before the Tests screen started a run, with no crash in the log",
    );
  });

  it("blames Metro when it stopped answering and nothing ran", () => {
    expect(diagnose({ ...base, stop: "no-start", minutes: 8, metroUp: false })[0]).toContain(
      "Metro stopped answering",
    );
  });

  it("quotes the JavaScript error that kept the screen from starting", () => {
    const lines = diagnose({
      ...base,
      platform: "android",
      stop: "no-start",
      minutes: 8,
      jsErrors: ['E ReactNativeJS: Invariant Violation: "BareExample" has not been registered'],
      screen: ["Invariant Violation", "Reload"],
    });
    expect(lines[0]).toBe(
      'Device run (android) failed. The Tests screen never started a run; JavaScript failed: E ReactNativeJS: Invariant Violation: "BareExample" has not been registered',
    );
    expect(lines.at(-1)).toBe("Screen shows: Invariant Violation | Reload");
  });

  it("says a run never started when nothing else explains it", () => {
    expect(diagnose({ ...base, stop: "no-start", minutes: 8 })[0]).toMatch(
      /never started a run in 8 minutes \(no LUCENT_PROGRESS line\)/,
    );
  });

  it("names the case a stalled run stopped after", () => {
    const lines = diagnose({
      ...base,
      stop: "stalled",
      minutes: 3,
      progress: { done: 40, total: 70, name: "promises", pass: true },
    });
    expect(lines[0]).toBe(
      "Device run (ios) failed. The run stopped moving after case 40/70 (promises): no case finished for 3 minutes",
    );
  });

  it("says how far a run that ran out of time got", () => {
    const lines = diagnose({ ...base, progress: { done: 69, total: 70, name: "x", pass: false } });
    expect(lines[0]).toBe(
      "Device run (ios) failed. No verdict within 15 minutes; the run got to 69/70 run (last: x, failed)",
    );
  });

  it("keeps every line short", () => {
    const lines = diagnose({
      ...base,
      stop: "no-start",
      jsErrors: ["E ReactNativeJS: " + "y".repeat(2000)],
    });
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(600);
  });
});
