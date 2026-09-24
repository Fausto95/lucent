import { sdkAvailable, sdkDts, sdkModule, sdkModules } from "@lucent-lang/compiler";
import type { Invocation } from "../args.ts";
import { projectSdk } from "../project.ts";
import type { Theme } from "../ui/theme.ts";

/**
 * `lucent sdk show <module>.<Type>[.<member>]`: the declaration Lucent code
 * sees, as the editor does (android.os.Vibrator, UIKit.UIDevice.current).
 */
export function run({ root, positionals, out }: Invocation): number {
  const t = out.theme;
  const [symbol] = positionals;
  if (!symbol) {
    out.error(
      `${t.error(t.symbols.fail)} name a symbol: lucent sdk show <module>.<Type>[.<member>], e.g. android.os.Vibrator`,
    );
    return 2;
  }
  const sdk = projectSdk(root);
  const parts = symbol.split(".");
  // The module is the longest prefix naming one (Android packages have dots).
  for (const platform of ["android", "ios"] as const) {
    if (!sdkAvailable(platform, sdk)) continue;
    const known = sdkModules(platform, sdk);
    for (let n = parts.length - 1; n >= 1; n--) {
      const module = parts.slice(0, n).join(".");
      // Prefixes that name no module (com, com.example) are not extracted.
      if (Array.isArray(known) && !known.includes(module)) continue;
      const r = sdkModule(platform, module, sdk);
      if ("missing" in r) continue;
      const [type, member] = parts.slice(n);
      const dts = sdkDts(r.schema);
      const block = declaration(dts, type!);
      if (!block) {
        out.error(
          `${t.error(t.symbols.fail)} no ${type} in lucent:${platform}/${module}: lucent sdk search ${type} finds similar names`,
        );
        return 1;
      }
      const shown = member ? memberLines(block, member) : block;
      if (!shown) {
        out.error(`${t.error(t.symbols.fail)} ${type} has no member ${member}`);
        return 1;
      }
      if (out.json) out.data({ platform, module, symbol, declaration: shown });
      else out.print(`${t.dim(`// lucent:${platform}/${module}`)}\n${highlight(shown, t)}`);
      return 0;
    }
  }
  out.error(
    `${t.error(t.symbols.fail)} no SDK module in ${symbol}: write <module>.<Type>, e.g. android.os.Vibrator or UIKit.UIDevice`,
  );
  return 1;
}

/** The declaration of `name` in a module's .d.ts: its doc comment and body. */
function declaration(dts: string, name: string): string | undefined {
  const lines = dts.split("\n");
  const start = lines.findIndex((l) =>
    new RegExp(
      `^export (declare )?(abstract )?(class|interface|enum|const enum|type|function|const) ${name}\\b`,
    ).test(l),
  );
  if (start < 0) return undefined;
  let from = start;
  while (from > 0 && /^\s*(\/\*\*|\*)/.test(lines[from - 1]!)) from--;
  if (!lines[start]!.trimEnd().endsWith("{")) return lines.slice(from, start + 1).join("\n");
  let depth = 0;
  for (let i = start; i < lines.length; i++) {
    depth += (lines[i]!.match(/\{/g) ?? []).length - (lines[i]!.match(/\}/g) ?? []).length;
    if (depth === 0) return lines.slice(from, i + 1).join("\n");
  }
  return lines.slice(from).join("\n");
}

/** A member's lines inside a declaration (its overloads too), with the declaration's first line for context. */
function memberLines(block: string, member: string): string | undefined {
  const lines = block.split("\n");
  const head = lines.find((l) => /^export /.test(l))!;
  const found = lines.filter((l) =>
    new RegExp(`^\\s+(static |readonly |get |set |protected |private )*${member}\\b[?(<:]`).test(l),
  );
  return found.length ? [head, ...found, "}"].join("\n") : undefined;
}

/** Keywords and types in colour, the rest as is. */
function highlight(code: string, t: Theme): string {
  if (!t.terminal.color) return code;
  return code
    .split("\n")
    .map((line) =>
      /^\s*(\/\/|\/\*\*|\*)/.test(line)
        ? t.dim(line)
        : line
            .replace(
              /\b(export|declare|class|interface|enum|static|readonly|abstract|extends|implements|function|const|type|protected|private|new)\b/g,
              (k) => t.brand(k),
            )
            .replace(/\b(string|number|boolean|void|undefined|null|Promise|Uint8Array)\b/g, (k) =>
              t.progress(k),
            ),
    )
    .join("\n");
}
