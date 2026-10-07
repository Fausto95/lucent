import {
  sdkAvailable,
  sdkDeclarations,
  sdkModule,
  sdkModules,
  toolkitModuleText,
  toolkitsFrom,
} from "@lucent-lang/compiler";
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
      // Compose's modules are declared in lucent:compose, and a toolkit
      // generated from the module (lucent:swiftui) declares its own names.
      const sources = [
        {
          from: r.schema.form === "source" ? "lucent:compose" : `lucent:${platform}/${module}`,
          dts: sdkDeclarations(r.schema),
        },
        ...toolkitsFrom(platform, module).flatMap((from) => {
          const found = toolkitModuleText(from, sdk);
          return "text" in found ? [{ from, dts: found.text }] : [];
        }),
      ];
      const declared = sources.flatMap(({ from, dts }) => {
        const blocks = declarations(dts, type!);
        return blocks.length ? [{ from, blocks }] : [];
      });
      if (!declared.length) {
        out.error(
          `${t.error(t.symbols.fail)} no ${type} in lucent:${platform}/${module}: lucent sdk search ${type} finds similar names`,
        );
        return 1;
      }
      const shown = declared.flatMap(({ from, blocks }) => {
        const text = member ? blocks.flatMap((b) => memberLines(b, member) ?? []) : blocks;
        return text.length ? [{ from, declaration: text.join("\n\n") }] : [];
      });
      if (!shown.length) {
        out.error(`${t.error(t.symbols.fail)} ${type} has no member ${member}`);
        return 1;
      }
      if (out.json)
        out.data({
          platform,
          module,
          symbol,
          declaration: shown.map((s) => s.declaration).join("\n\n"),
        });
      else
        out.print(
          shown
            .map(({ from, declaration }) => `${t.dim(`// ${from}`)}\n${highlight(declaration, t)}`)
            .join("\n\n"),
        );
      return 0;
    }
  }
  out.error(
    `${t.error(t.symbols.fail)} no SDK module in ${symbol}: write <module>.<Type>, e.g. android.os.Vibrator or UIKit.UIDevice`,
  );
  return 1;
}

/**
 * The top-level declarations of `name` in a module's .d.ts, each with its
 * doc comment and body: a toolkit's name is several (its interface, the
 * `$Name` of its calls, its value, its namespace), a function's each overload.
 */
function declarations(dts: string, name: string): string[] {
  const lines = dts.split("\n");
  const head = new RegExp(
    `^(export )?(declare )?(abstract )?(class|interface|enum|const enum|type|function|const|namespace) \\$?${name}(?![\\w$])`,
  );
  return lines.flatMap((l, start) => (head.test(l) ? [block(lines, start)] : []));
}

/** The declaration whose first line is `start`: its doc comment and body. */
function block(lines: string[], start: number): string {
  const from = docStart(lines, start);
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
  // A declaration's first line: not every one is exported (a toolkit's namespace).
  const head = lines.find((l) => !/^\s*(\/\*\*|\*)/.test(l))!;
  const declares = new RegExp(
    `^\\s+(static |readonly |get |set |protected |private )*${member}\\b[?(<:]`,
  );

  // Each declaration with its doc comment: what it calls natively, what using it takes.
  const found = lines.flatMap((l, i) => {
    if (!declares.test(l)) return [];

    let from = i;
    if (/\*\/\s*$/.test(lines[i - 1] ?? ""))
      while (from > 0 && !/^\s*\/\*\*/.test(lines[from - 1]!)) from--;
    return lines.slice(from > 0 && /^\s*\/\*\*/.test(lines[from - 1]!) ? from - 1 : i, i + 1);
  });
  return found.length ? [head, ...found, "}"].join("\n") : undefined;
}

/** The first line of the doc comment right above line `i` (`i` when there is none). */
function docStart(lines: string[], i: number): number {
  let from = i;
  while (from > 0 && /^\s*(\/\*\*|\*)/.test(lines[from - 1]!)) from--;
  return from;
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
