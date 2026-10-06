// Every command's output, three ways (T61): with --json, exactly one JSON
// document on stdout, valid against the schema the command declares; or,
// for a command without JSON output, a refusal saying so. Without --json,
// and not in a terminal, no escape codes. Every command of the registry is
// run here, so a new one cannot go without its output checked.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { sdkAvailable } from "@lucent-lang/bindgen";
import { commands } from "../src/cli/commands.ts";
import { runLucent } from "./run-to-exit.ts";

const android = sdkAvailable("android");

/** How a command runs in a test project; `needs` an SDK, `plain` false for one that keeps running. */
const RUNS: Record<
  string,
  { args: string[]; env?: Record<string, string>; needs?: "android"; plain?: false }
> = {
  build: { args: ["--platforms", "host"] },
  check: { args: [] },
  dev: { args: [], plain: false },
  doctor: { args: [] },
  init: { args: ["--yes"], plain: false },
  "new module": { args: ["geo"] },
  "new view": { args: ["Badge"], env: { LUCENT_VIEWS: "fabric" } },
  explain: { args: ["LUCENT1006"] },
  bench: { args: [], plain: false },
  trace: { args: [], plain: false },
  clean: { args: [] },
  "sdk search": { args: ["Vibrator", "--android"], needs: "android" },
  "sdk show": { args: ["android.os.Vibrator.vibrate"], needs: "android" },
  "sdk prefetch": { args: ["--android", "android.os"], needs: "android" },
  "sdk lock": { args: ["--platforms", "android"], needs: "android" },
  "sdk diff": { args: [], needs: "android" },
  "sdk coverage": { args: ["--android", "android.os"], needs: "android" },
};

const ESCAPE = /\u001b\[/;

/** A project with one module and a package naming it. */
function project(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-matrix-"));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "app" }));
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(
    path.join(root, "src/a.lucent.ts"),
    "export function one(): number { return 1; }\n",
  );
  return root;
}

const cache = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-matrix-cache-"));

function run(name: string, extra: string[]) {
  const spec = RUNS[name]!;
  // Not a terminal, and nothing asking for colour or none: the CLI decides.
  const { NO_COLOR, FORCE_COLOR, ...env } = process.env;
  void NO_COLOR;
  void FORCE_COLOR;

  return runLucent([...name.split(" "), ...spec.args, ...extra, "--root", project()], {
    env: { ...env, LUCENT_CACHE_DIR: cache, ...spec.env },
  });
}

async function validator(schema: string) {
  const { default: Ajv } = (await import("ajv")) as unknown as {
    default: new (o: object) => {
      compile(s: object): ((v: unknown) => boolean) & { errors?: unknown[] | null };
    };
  };
  const file = path.resolve(import.meta.dirname, `../schemas/${schema}.schema.json`);

  return new Ajv({ allErrors: true, strict: false }).compile(
    JSON.parse(fs.readFileSync(file, "utf8")) as object,
  );
}

describe("every command's output", () => {
  it("knows how to run every command of the registry", () => {
    expect(commands.map((c) => c.name).filter((n) => !RUNS[n])).toEqual([]);
  });

  for (const spec of commands) {
    const how = RUNS[spec.name];
    const skip = !how || (how.needs === "android" && !android);

    if (spec.json)
      it.skipIf(skip)(
        `${spec.name} --json: one JSON document${typeof spec.json === "string" ? `, a ${spec.json}.schema.json` : ""}`,
        async () => {
          const r = run(spec.name, ["--json"]);

          expect(r.stdout.trim(), r.stderr).not.toBe("");
          const value = JSON.parse(r.stdout) as unknown;
          expect(ESCAPE.test(r.stdout) || ESCAPE.test(r.stderr)).toBe(false);

          if (typeof spec.json === "string") {
            const valid = await validator(spec.json);
            expect(valid(value), JSON.stringify(valid.errors)).toBe(true);
          }
        },
        600_000,
      );
    else
      it.skipIf(skip)(`${spec.name} --json: refused, as it has no JSON output`, () => {
        const r = run(spec.name, ["--json"]);

        expect(r.status).toBe(2);
        expect(r.stdout).toBe("");
        expect(r.stderr).toContain(`lucent ${spec.name} has no JSON output`);
      });

    if (how?.plain !== false)
      it.skipIf(skip)(
        `${spec.name}: no escape codes outside a terminal`,
        () => {
          const r = run(spec.name, []);

          expect(r.stdout + r.stderr).not.toBe("");
          expect(ESCAPE.test(r.stdout) || ESCAPE.test(r.stderr), r.stdout + r.stderr).toBe(false);
        },
        600_000,
      );
  }
});
