import { PassThrough } from "node:stream";
import { stripVTControlCharacters } from "node:util";
import { describe, expect, it } from "vite-plus/test";
import { liveSteps } from "../src/cli/ui/live-steps.tsx";
import { createTheme } from "../src/cli/ui/theme.ts";

/** A stream Ink takes for an interactive terminal, recording what it draws. */
function terminal() {
  const stream = Object.assign(new PassThrough(), {
    isTTY: true,
    columns: 100,
    rows: 30,
  }) as unknown as NodeJS.WriteStream;
  let written = "";
  (stream as unknown as PassThrough).on("data", (d: Buffer) => (written += d.toString()));
  return { stream, text: () => stripVTControlCharacters(written) };
}

describe("live steps", () => {
  it("shows the running step, then keeps every finished step on screen", async () => {
    const t = terminal();
    const steps = liveSteps(
      createTheme({ color: false, interactive: true, unicode: true, links: false, width: 100 }),
      t.stream,
    );
    steps.start("check", "Checking 1 module");
    await steps.flush();
    expect(t.text()).toContain("Checking 1 module…");
    steps.finish({ name: "check", label: "Checked 1 module", status: "ok", ms: 95 });
    steps.finish({
      name: "package",
      label: "Native package",
      status: "ok",
      detail: ".lucent/native",
    });
    await steps.close();
    expect(t.text()).toMatch(/✓ Checked 1 module +95 ms/);
    expect(t.text()).toContain("✓ Native package  .lucent/native");
    expect(steps.results.map((r) => r.name)).toEqual(["check", "package"]);
  });
});
