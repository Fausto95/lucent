import type { Invocation } from "../args.ts";
import { type Check, diagnose, systemProbe } from "../doctor.ts";
import { table } from "../ui/format.ts";
import { version } from "../version.ts";

export function run({ root, out }: Invocation): number {
  const checks = diagnose(root, systemProbe(version()));
  const failures = checks.filter((c) => c.status === "fail").length;
  const warnings = checks.filter((c) => c.status === "warn").length;
  if (out.json) {
    out.data({ ok: failures === 0, checks });
    return failures ? 1 : 0;
  }
  const t = out.theme;
  const symbol = (c: Check) =>
    c.status === "ok"
      ? t.success(t.symbols.ok)
      : c.status === "fail"
        ? t.error(t.symbols.fail)
        : c.status === "warn"
          ? t.warn(t.symbols.warn)
          : t.dim(t.symbols.off);
  out.print(`${t.brand(t.symbols.brand)} ${t.bold("lucent doctor")} ${t.dim(version())}\n`);
  const rows = table(
    checks.map((c) => [
      `${symbol(c)} ${c.label}`,
      c.status === "skip" ? t.dim(c.detail) : c.detail,
    ]),
  );
  checks.forEach((c, i) => {
    out.print(rows[i]!);
    if (c.fix) out.print(`    ${c.status === "fail" ? t.error("fix") : t.warn("fix")}  ${c.fix}`);
  });
  out.print("");
  const summary = [
    failures && t.error(`${failures} problem${failures === 1 ? "" : "s"}`),
    warnings && t.warn(`${warnings} warning${warnings === 1 ? "" : "s"}`),
  ]
    .filter(Boolean)
    .join(` ${t.dim("·")} `);
  out.print(summary || t.success("everything Lucent needs is in place"));
  return failures ? 1 : 0;
}
