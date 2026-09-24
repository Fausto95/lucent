import { docsUrl, Explanations } from "@lucent-lang/compiler/codes";
import type { Invocation } from "../args.ts";
import { link, table } from "../ui/format.ts";

/** `lucent explain <code>`: what a diagnostic means and how to fix it; every code without one. */
export function run({ positionals, out }: Invocation): number {
  const t = out.theme;
  const [wanted] = positionals;
  if (!wanted) {
    for (const line of table(
      Object.entries(Explanations).map(([code, e]) => [t.bold(code), e.title]),
    ))
      out.print(line);
    out.print(t.dim("\nlucent explain <code> for one of them"));
    return 0;
  }
  const code = `LUCENT${wanted.replace(/^lucent/i, "")}`;
  const e = Explanations[code as keyof typeof Explanations];
  if (!e) {
    out.error(`${t.error(t.symbols.fail)} no ${code}: run lucent explain for the list of codes`);
    return 1;
  }
  const indent = (text: string) =>
    text
      .trimEnd()
      .split("\n")
      .map((l) => `    ${l}`)
      .join("\n");
  out.print(`${t.bold(code)}  ${e.title}\n`);
  out.print(`${e.details}\n`);
  out.print(`${t.success("fix")}  ${e.fix}\n`);
  for (const [label, files, paint] of [
    ["wrong", e.wrong, t.error],
    ["right", e.right, t.success],
  ] as const) {
    for (const [file, source] of Object.entries(files))
      out.print(
        `${paint(`${label === "wrong" ? t.symbols.fail : t.symbols.ok} ${label}`)}  ${t.dim(file)}\n${indent(source)}\n`,
      );
  }
  out.print(t.dim(link(docsUrl(code), docsUrl(code), t.terminal)));
  return 0;
}
