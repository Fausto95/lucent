/**
 * The differential fuzzer (test/e2e/fuzz.ts). Its programs always compile
 * (the generator writes the subset, so a refusal or a type error is a
 * regression of one or the other); with LUCENT_FUZZ=1 and Hermes built,
 * a few run natively and as JavaScript too, which CI can opt into.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { generate, rng, triage } from "./e2e/fuzz.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const hermes = process.env.HERMES_DIR ?? path.join(os.homedir(), "hermes");
const run = !!process.env.LUCENT_FUZZ && fs.existsSync(path.join(hermes, "build/lib"));

describe("the differential fuzzer", () => {
  it("is deterministic: one seed, one program", () => {
    expect(generate(7).source).toBe(generate(7).source);
    expect(generate(7).source).not.toBe(generate(8).source);
    expect(rng(1)()).toBe(rng(1)());
  });

  it("writes programs the compiler accepts", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-fuzz-"));

    for (const seed of [1, 2, 3]) {
      const file = path.join(dir, `fuzz-${seed}.lucent.ts`);

      fs.writeFileSync(file, generate(seed, 3).source);
      expect({ seed, ...triage(file) }).toEqual({ seed, kind: "ok", detail: "" });
    }
  });

  it.skipIf(!run)(
    "finds native output equal to JavaScript's",
    () => {
      const seed = Number(process.env.LUCENT_FUZZ_SEED ?? 1);
      const r = spawnSync(
        process.execPath,
        [path.join(here, "e2e/fuzz.ts"), "--seed", String(seed), "--count", "3"],
        { encoding: "utf8", env: { ...process.env, HERMES_DIR: hermes } },
      );

      expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
    },
    1_200_000,
  );
});
