import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vite-plus/test";
import { sdkCommand } from "../src/command.ts";
test("CLI produces a matched curated delegate manifest and declarations", () => {
  const dir = mkdtempSync(join(tmpdir(), "lucent-delegate-cli-"));
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    const input = join(dir, "input.json");
    writeFileSync(
      input,
      JSON.stringify({
        version: 1,
        name: "Observer",
        swift: { protocol: "SDKObserver", imports: [] },
        kotlin: { interface: "SDKObserver" },
        methods: [
          {
            name: "decide",
            parameters: [],
            result: "boolean",
            errors: { kind: "fallback", value: false, reason: "Deny on failure" },
          },
        ],
      }),
    );
    sdkCommand(["delegate", input, "--out", dir]);
    const manifest = JSON.parse(readFileSync(join(dir, "library.json"), "utf8"));
    expect(manifest.references.Observer.nativeOnly).toBe(true);
    expect(Object.keys(manifest.native.swift)).toHaveLength(1);
    expect(Object.keys(manifest.native.kotlin)).toHaveLength(1);
    expect(readFileSync(join(dir, "index.d.ts"), "utf8")).toContain("class Observer");
  } finally {
    log.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  }
});
