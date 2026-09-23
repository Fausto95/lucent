import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { watchBuild } from "../src/index.ts";

function waitFor<T>(get: () => T | undefined, ms = 10000): Promise<T> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      const v = get();
      if (v !== undefined) return resolve(v);
      if (Date.now() - start > ms) return reject(new Error("timed out"));
      setTimeout(tick, 50);
    };
    tick();
  });
}

describe("watchBuild", () => {
  it("builds, then rebuilds when a module changes, and reports diagnostics", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-watch-"));
    const src = path.join(root, "a.lucent.ts");
    fs.writeFileSync(src, "export function one(): number { return 1; }\n");
    const events: { ok: boolean; modules: string[]; messages: string[] }[] = [];
    const stop = watchBuild(root, path.join(root, ".lucent/native"), (e) => events.push(e));
    try {
      await waitFor(() => (events.length >= 1 ? true : undefined));
      expect(events[0]!.ok).toBe(true);
      fs.writeFileSync(src, "export function one(): number { return 1; }\nexport function two(): number { return 2; }\n");
      await waitFor(() => (events.length >= 2 ? true : undefined));
      expect(fs.readFileSync(path.join(root, ".lucent/native/cpp/generated/m_a.h"), "utf8")).toContain("two");
      fs.writeFileSync(src, "export function bad(): number { var x = 1; return x; }\n");
      const failed = await waitFor(() => events.find((e) => !e.ok));
      expect(failed.messages.join("\n")).toContain("LUCENT1001");
    } finally {
      stop();
    }
  });
});
