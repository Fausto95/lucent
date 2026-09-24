import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";

const bin = path.resolve(import.meta.dirname, "../bin/lucent.cjs");

/** `lucent dev --compact` in a project, with its output as it comes. */
function dev(root: string) {
  const child = spawn(process.execPath, [bin, "dev", "--compact", "--root", root], { env: { ...process.env, NO_COLOR: "1" } });
  let out = "";
  child.stdout.on("data", (d: Buffer) => (out += d.toString()));
  child.stderr.on("data", (d: Buffer) => (out += d.toString()));
  const exited = new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code)));
  /** Resolves with the time it took once the output matches, from `since`. */
  const until = async (pattern: RegExp, since = Date.now(), timeout = 30_000): Promise<number> => {
    for (;;) {
      if (pattern.test(out)) return Date.now() - since;
      if (Date.now() - since > timeout) throw new Error(`no ${pattern} in:\n${out}`);
      await new Promise((r) => setTimeout(r, 20));
    }
  };
  return { child, until, exited, output: () => out, clear: () => (out = "") };
}

describe("lucent dev --compact", () => {
  it("rebuilds on save, shows a new error within a second, clears it when fixed, and quits cleanly", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-dev-"));
    const file = path.join(root, "a.lucent.ts");
    fs.writeFileSync(file, "export function one(): number { return 1; }\n");
    const d = dev(root);
    await d.until(/✓ 1 module/);
    d.clear();

    const saved = Date.now();
    fs.writeFileSync(file, "export function one(): number {\n  var x = 1;\n  return x;\n}\n");
    const shown = await d.until(/✗ .*LUCENT1001/s, saved);
    expect(shown).toBeLessThan(1000);
    expect(d.output()).toMatch(/a\.lucent\.ts:2:3/);
    d.clear();

    fs.writeFileSync(file, "export function one(): number {\n  let x = 1;\n  return x;\n}\n");
    await d.until(/✓ 1 module/);
    expect(d.output()).not.toMatch(/LUCENT/);

    d.child.kill("SIGINT");
    expect(await d.exited).toBe(0);
  }, 60_000);
});

/** A terminal Ink draws into, with keys to press. */
function terminal() {
  const stdout = Object.assign(new PassThrough(), { isTTY: true, columns: 100, rows: 30 }) as unknown as NodeJS.WriteStream;
  const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode: () => {}, ref: () => {}, unref: () => {} }) as unknown as NodeJS.ReadStream;
  let written = "";
  (stdout as unknown as PassThrough).on("data", (d: Buffer) => (written += d.toString()));
  return { stdout, stdin, raw: () => written, text: () => written.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "").replace(/\x1b\][^\x1b]*\x1b\\/g, "") };
}

describe("lucent dev dashboard", () => {
  async function setup() {
    const { dashboard } = await import("../src/cli/dev/dashboard.tsx");
    const { createStore } = await import("../src/cli/dev/session.ts");
    const { createTheme } = await import("../src/cli/ui/theme.ts");
    const store = createStore();
    const calls: string[] = [];
    const session = {
      store,
      rebuild: () => void calls.push("rebuild"),
      clearCache: () => void calls.push("clear"),
      stop: () => void calls.push("stop"),
    };
    const t = terminal();
    const theme = createTheme({ color: false, interactive: true, unicode: true, links: false, width: 100 });
    const opened: string[] = [];
    const running = dashboard({ session, theme, root: "/app", stdout: t.stdout, stdin: t.stdin, open: (file, line) => void opened.push(`${file}:${line}`), doctor: () => [] });
    const tick = () => new Promise((r) => setTimeout(r, 40));
    return { store, calls, t, running, opened, tick };
  }

  it("shows modules by platform, the last build, and problems with their fix", async () => {
    const { store, t, tick, running } = await setup();
    store.set({
      building: false,
      watching: ["src"],
      modules: [
        { name: "haptics", platforms: { ios: "ok", android: "ok" } },
        { name: "location", platforms: { ios: "ok", android: "error" } },
      ],
      lastBuild: { at: new Date(2026, 8, 24, 12, 4, 31), ms: 38, ok: false },
      problems: [{ code: "LUCENT3004", message: "androidx.biometric not found", file: "src/location.android.lucent.ts", line: 8, column: 1, length: 4, fix: 'add "androidx.biometric:biometric:1.2.0" to android/app/build.gradle', source: "a\nb\nc\nd\ne\nf\ng\nhere\ni\n" }],
    });
    // Ink redraws asynchronously: wait for the frame with the modules.
    for (let i = 0; i < 100 && !/MODULE/.test(t.text()); i++) await tick();
    const frame = t.text();
    expect(frame).toMatch(/lucent dev/);
    expect(frame).toMatch(/MODULE +IOS +ANDROID +LAST BUILD/);
    expect(frame).toMatch(/haptics +● +●/);
    expect(frame).toMatch(/location +● +✗/);
    expect(frame).toMatch(/12:04:31 +38 ms/);
    expect(frame).toMatch(/LUCENT3004 +androidx\.biometric not found/);
    expect(frame).toMatch(/fix +add "androidx\.biometric/);
    expect(frame).toMatch(/\[r\] rebuild +\[c\] clear cache +\[d\] doctor +\[o\] open +\[q\] quit/);
    t.stdin.write("q");
    await running;
  });

  it("rebuilds, clears the cache, opens the selected problem, and quits restoring the terminal", async () => {
    const { store, calls, t, tick, running, opened } = await setup();
    store.set({ building: false, watching: ["."], modules: [], problems: [{ code: "LUCENT1001", message: "use let", file: "a.lucent.ts", line: 2, column: 3, length: 3 }] });
    await tick();
    for (const key of ["r", "c", "o"]) {
      t.stdin.write(key);
      await tick();
    }
    expect(calls).toEqual(["rebuild", "clear"]);
    expect(opened).toEqual(["a.lucent.ts:2"]);
    t.stdin.write("q");
    await running;
    expect(calls).toContain("stop");
    // The alternate screen, left again, and the cursor shown.
    expect(t.raw()).toContain("\x1b[?1049h");
    expect(t.raw().lastIndexOf("\x1b[?1049l")).toBeGreaterThan(t.raw().lastIndexOf("\x1b[?1049h"));
    expect(t.raw()).toContain("\x1b[?25h");
  });
});
