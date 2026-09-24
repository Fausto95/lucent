import type { Output } from "../output.ts";
import { nextText, plural } from "../pipeline.ts";
import type { DevSession } from "./session.ts";

/**
 * One line per build, for Metro's output and anything that is not a
 * terminal: `[12:04:31] ✓ 7 modules  38 ms · rebuild the app`, or the
 * problems, one line each with their fix.
 */
export function compact(session: DevSession, out: Output): () => void {
  const t = out.theme;
  let shown: unknown;
  return session.store.subscribe(() => {
    const s = session.store.get();
    const last = s.lastBuild;
    if (!last || last === shown || s.building) return;
    shown = last;
    const time = t.dim(`[${last.at.toLocaleTimeString("en-GB")}]`);
    for (const n of s.notices ?? [])
      out.print(
        `${time} ${n.level === "ok" ? t.success(t.symbols.ok) : t.warn(t.symbols.warn)} ${n.text}`,
      );
    if (last.fatal) {
      out.error(`${time} ${t.error(t.symbols.fail)} ${last.fatal}`);
      return;
    }
    if (last.ok) {
      const next = last.next?.rebuild ? ` ${t.dim("·")} ${nextText(last.next)}` : "";
      out.print(
        `${time} ${t.success(t.symbols.ok)} ${plural(s.modules.length, "module")}  ${t.dim(`${last.ms} ms`)}${next}`,
      );
      return;
    }
    out.error(`${time} ${t.error(t.symbols.fail)} ${plural(s.problems.length, "error")}`);
    for (const d of s.problems) {
      const where = d.file ? `${d.file}${d.line ? `:${d.line}:${d.column ?? 1}` : ""}  ` : "";
      out.error(`  ${where}${t.bold(d.code)}  ${d.message}`);
      if (d.fix) out.error(`    ${t.dim(`fix: ${d.fix}`)}`);
    }
  });
}
