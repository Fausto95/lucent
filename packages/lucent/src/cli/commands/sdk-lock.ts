import path from "node:path";
import { exportSchemaSet } from "@lucent-lang/bindgen";
import type { Target } from "@lucent-lang/compiler";
import type { Invocation } from "../args.ts";
import { buildProject, plural } from "../pipeline.ts";
import { projectSdk, SCHEMA_SET_DIR } from "../project.ts";
import { LOCK_FILE, writeUsage } from "../sdk-usage.ts";
import { plainSteps } from "../ui/steps.ts";

/**
 * `lucent sdk lock`: checks the project, and records the SDKs its modules
 * were read from and the SDK symbols its code uses in lucent-sdk.lock.json,
 * which `--frozen` builds and `lucent sdk diff` compare the installed SDKs
 * with. Every platform the project has code for is locked, unless
 * `--platforms` leaves it out: a lock missing one would let frozen builds
 * skip it. With `--schemas`, the schemas the check read are exported
 * too (lucent-sdk.schemas/), for machines without a platform's SDK.
 */
export async function run({ root, flags, out }: Invocation): Promise<number> {
  const t = out.theme;
  const platforms =
    typeof flags.platforms === "string" && flags.platforms
      ? (flags.platforms.split(",") as Target[])
      : undefined;

  const result = await buildProject(
    root,
    { mode: "check", force: true, platforms },
    plainSteps(() => {}, t),
    (n) => out.error(`${n.level === "ok" ? t.symbols.ok : t.warn(t.symbols.warn)} ${n.text}`),
  );

  const others = result.usage?.targets.join(",");
  const failure =
    result.fatal ??
    (result.ok
      ? undefined
      : `${plural(result.diagnostics.length, "error")} in the project: lucent check shows them; the lock records a project that checks`) ??
    (result.skipped.length
      ? [
          ...result.skipped.map((s) => `${s.platform}: ${s.reason}`),
          `the lock needs every platform the project has code for: install the SDK, or lock ${others} alone with --platforms ${others}`,
        ].join("\n")
      : undefined);
  if (failure || !result.usage) {
    if (out.json) out.data({ ok: false, error: failure ?? "the check recorded no SDK usage" });
    else out.error(`${t.error(t.symbols.fail)} ${failure ?? "the check recorded no SDK usage"}`);
    return 1;
  }

  const usage = result.usage;
  writeUsage(path.join(root, LOCK_FILE), usage);

  let exported: string[] | undefined;
  if (flags.schemas) {
    try {
      exported = exportSchemaSet(path.join(root, SCHEMA_SET_DIR), usage.targets, projectSdk(root));
    } catch (e) {
      const message = `${LOCK_FILE} written, but the schemas were not exported: ${(e as Error).message}`;
      if (out.json) out.data({ ok: false, error: message });
      else out.error(`${t.error(t.symbols.fail)} ${message}`);
      return 1;
    }
  }

  const summary = {
    ok: true,
    file: LOCK_FILE,
    targets: usage.targets,
    modules: Object.keys(usage.modules).length,
    symbols: usage.symbols.length,
    ...(exported ? { schemas: exported.length } : {}),
  };
  if (out.json) out.data(summary);
  else
    out.print(
      `${t.success(t.symbols.ok)} ${LOCK_FILE}  ${plural(summary.symbols, "symbol")} of ${plural(summary.modules, "module")}${usage.targets.length ? `, for ${usage.targets.join(" and ")}` : ""}${exported ? `\n${t.success(t.symbols.ok)} ${SCHEMA_SET_DIR}/  ${plural(exported.length, "schema")}` : ""}`,
    );

  return 0;
}
