import { cachedModules, projectFiles, sdkAvailable, sdkModule, sdkNames, type SdkModuleSchema } from "@lucent-lang/compiler";
import type { Invocation } from "../args.ts";
import { projectSdk, sdkImports } from "../project.ts";
import { table } from "../ui/format.ts";

type Platform = "ios" | "android";

interface Match {
  platform: Platform;
  module: string;
  kind: "class" | "protocol" | "interface" | "enum" | "struct" | "method" | "property" | "function" | "constant";
  name: string;
  /** The import that brings the type in. */
  import: string;
}

/**
 * `lucent sdk search <term>`: classes and members whose name contains the
 * term, in the modules the project imports and every module the SDK cache
 * holds (a cold SDK takes minutes to extract; `sdk prefetch --all` fills it).
 */
export function run({ root, positionals, out }: Invocation): number {
  const t = out.theme;
  const term = positionals.join(" ").trim();
  if (!term) {
    out.error(`${t.error(t.symbols.fail)} search for a name: lucent sdk search <term>`);
    return 2;
  }
  const needle = term.toLowerCase();
  const hit = (name: string) => name.toLowerCase().includes(needle);
  const sdk = projectSdk(root);
  let imports: Record<Platform, string[]> = { ios: [], android: [] };
  try {
    imports = sdkImports(projectFiles(root));
  } catch {
    // Outside a project: the cache only.
  }
  const matches: Match[] = [];
  let searched = 0;
  let total = 0;
  for (const platform of ["ios", "android"] as const) {
    if (!sdkAvailable(platform, sdk)) continue;
    const cached = cachedModules(platform, sdk);
    const withSchema = [...new Set([...imports[platform], ...("missing" in cached ? [] : cached.schemas)])].sort();
    const namesOnly = "missing" in cached ? [] : cached.names.filter((m) => !withSchema.includes(m));
    total += withSchema.length + namesOnly.length;
    const importLine = (module: string, name: string) => `import { ${name} } from "lucent:${platform}/${module}";`;
    for (const module of withSchema) {
      const r = sdkModule(platform, module, sdk);
      if ("missing" in r) continue;
      searched++;
      matches.push(...schemaMatches(r.schema, platform, hit, importLine));
    }
    for (const module of namesOnly) {
      const r = sdkNames(platform, module, sdk);
      if ("missing" in r) continue;
      searched++;
      for (const [name, info] of Object.entries(r.names.types)) if (hit(name)) matches.push({ platform, module, kind: info.kind === "protocol" ? "protocol" : info.kind === "class" ? "class" : info.kind === "enum" ? "enum" : "struct", name, import: importLine(module, name) });
    }
  }
  if (out.json) {
    out.data({ term, searched, matches });
    return 0;
  }
  const groups = new Map<string, Match[]>();
  for (const m of matches) groups.set(`${m.platform}\0${m.module}`, [...(groups.get(`${m.platform}\0${m.module}`) ?? []), m]);
  const LIMIT = 12;
  for (const [key, list] of groups) {
    const [platform, module] = key.split("\0") as [string, string];
    out.print(`${t.brand(platform)}  ${t.bold(module)}`);
    const shown = list.slice(0, LIMIT);
    const types = new Set(shown.filter((m) => !m.name.includes(".")).map((m) => m.name));
    for (const line of table(shown.map((m) => [`  ${t.dim(m.kind)}`, m.name, types.has(m.name) ? t.dim(m.import) : ""]))) out.print(line.trimEnd());
    if (list.length > LIMIT) out.print(t.dim(`  … ${list.length - LIMIT} more (lucent sdk search ${term} --json lists them all)`));
    out.print("");
  }
  if (!matches.length) out.print(`${t.dim(t.symbols.off)} nothing named like ${term}`);
  out.print(t.dim(`searched ${searched} module${searched === 1 ? "" : "s"}${total > searched ? ` of ${total}` : ""} (your imports and the SDK cache; lucent sdk prefetch --all to search every module)`));
  return 0;
}

function schemaMatches(schema: SdkModuleSchema, platform: Platform, hit: (name: string) => boolean, importLine: (module: string, name: string) => string): Match[] {
  const out: Match[] = [];
  const module = schema.module;
  for (const type of schema.types) {
    const kind = type.kind === "class" ? (type.interface ? (platform === "ios" ? "protocol" : "interface") : "class") : type.kind;
    if (hit(type.name)) out.push({ platform, module, kind, name: type.name, import: importLine(module, type.name) });
    if (type.kind !== "class") continue;
    for (const m of type.methods ?? []) if (hit(m.name)) out.push({ platform, module, kind: "method", name: `${type.name}.${m.name}(${m.params.map((p) => p.name).join(", ")})`, import: importLine(module, type.name) });
    for (const p of type.properties ?? []) if (hit(p.name)) out.push({ platform, module, kind: "property", name: `${type.name}.${p.name}`, import: importLine(module, type.name) });
  }
  for (const f of schema.functions ?? []) if (hit(f.name)) out.push({ platform, module, kind: "function", name: `${f.name}(${f.params.map((p) => p.name).join(", ")})`, import: importLine(module, f.name) });
  for (const c of schema.constants ?? []) if (hit(c.name)) out.push({ platform, module, kind: "constant", name: c.name, import: importLine(module, c.name) });
  return out;
}
