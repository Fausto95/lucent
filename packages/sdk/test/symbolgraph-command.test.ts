import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vite-plus/test";
import { sdkCommand } from "../src/command.ts";

test("CLI writes matched schema, bindings, declarations and coverage", () => {
  const dir = mkdtempSync(join(tmpdir(), "lucent-sdk-test-"));
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    sdkCommand(["swift-symbolgraph", new URL("./fixtures/probe.symbols.json", import.meta.url).pathname, "--out", dir]);
    const schema = JSON.parse(readFileSync(join(dir, "schema.json"), "utf8"));
    const coverage = JSON.parse(readFileSync(join(dir, "coverage.json"), "utf8"));
    expect(coverage.symbols).toEqual(schema.coverage);
    expect(coverage.extraction).toEqual(schema.extraction);
    expect(readFileSync(join(dir, "index.d.ts"), "utf8")).toContain("function magnitude");
    expect(JSON.parse(readFileSync(join(dir, "library.json"), "utf8")).schemaVersion).toBe(1);
  } finally {
    log.mockRestore();
    warn.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("all-unsupported graphs still produce actionable coverage and fail the command", () => {
  const dir = mkdtempSync(join(tmpdir(), "lucent-sdk-test-"));
  try {
    const graph = JSON.parse(readFileSync(new URL("./fixtures/probe.symbols.json", import.meta.url), "utf8"));
    graph.symbols = graph.symbols.filter(
      (s: { kind: { identifier: string } }) => s.kind.identifier === "swift.protocol",
    );
    const input = join(dir, "unsupported.json");
    writeFileSync(input, JSON.stringify(graph));
    expect(() => sdkCommand(["swift-symbolgraph", input, "--out", dir])).toThrow("No supported SDK declarations");
    expect(JSON.parse(readFileSync(join(dir, "coverage.json"), "utf8")).symbols[0].status).toBe("skipped");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
