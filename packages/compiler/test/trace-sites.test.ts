import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { compile } from "../src/index.ts";

/** The generated sources of one module, joined. */
function generated(source: string): { code: string; file: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-sites-"));
  const file = path.join(dir, "stats.lucent.ts");
  fs.writeFileSync(file, source);

  const r = compile([file]);
  const code = [...r.files.values()].join("\n");

  return { code, file: fs.realpathSync(file).replace(/\\/g, "/") };
}

describe("trace sites", () => {
  it("names each export's .lucent.ts declaration in its binding", () => {
    const { code, file } = generated(
      [
        "export function mean(xs: number[]): number {",
        "  return xs.reduce((a, b) => a + b, 0) / xs.length;",
        "}",
        "",
        "export async function later(x: number): Promise<number> {",
        "  return x;",
        "}",
        "",
        "export class Meter {",
        "  total = 0;",
        "",
        "  add(x: number): number {",
        "    this.total += x;",
        "    return this.total;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );

    // A synchronous call names its function; an async one names it for
    // the call, the job it posts and its completion; a method names its class.
    expect(code).toContain(
      `callSync(rt, host, lucent_app::actor_0(), LUCENT_TRACE_SITE_AT("mean", "${file}", 1), `,
    );
    expect(code).toContain(`LUCENT_TRACE_SITE_AT("later", "${file}", 5)`);
    expect(code).toMatch(
      /callAsync<[^>]+>\(rt, host, lucent_app::actor_0\(\), LUCENT_TRACE_SITE_AT\("later", /,
    );
    expect(code).toContain(`LUCENT_TRACE_SITE_AT("Meter.add", "${file}", 12)`);
  });
});
