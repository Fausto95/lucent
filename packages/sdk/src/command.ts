import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  extractSwiftInterface,
  extractSwiftSymbolGraph,
  extractJavaSignatures,
  generateBindingLibrary,
  generateDelegateLibrary,
} from "./index.ts";
/** Explicit offline extraction; no SDK download or target application execution. */
export function sdkCommand(args: string[]): void {
  const [platform, input, ...flags] = args;
  const options: Record<string, string> = {};
  for (let i = 0; i < flags.length; i += 2) {
    const key = flags[i];
    const value = flags[i + 1];
    if (!key || !["--module", "--out", "--classpath", "--class"].includes(key) || !value || value.startsWith("--"))
      throw new Error("SDK options require --module, --out, --classpath, or --class values");
    options[key] = value;
  }
  if (platform === "delegate" && input) {
    const schema = JSON.parse(readFileSync(input, "utf8"));
    const output = generateDelegateLibrary(schema);
    const dir = options["--out"] ?? "lucent-sdk";
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "schema.json"), JSON.stringify(schema, null, 2) + "\n");
    writeFileSync(join(dir, "library.json"), JSON.stringify(output.library, null, 2) + "\n");
    writeFileSync(join(dir, "index.d.ts"), output.declarations);
    console.log(`Generated delegate ${schema.name} with ${schema.methods.length} curated requirements in ${dir}`);
    return;
  }
  if (!input || !["swift", "swift-symbolgraph", "android"].includes(platform ?? ""))
    throw new Error(
      'Usage: lucent sdk delegate <schema.json> --out <directory> OR lucent sdk swift <file.swiftinterface> --module <Module> --out <directory> OR lucent sdk swift-symbolgraph <file.symbols.json> --out <directory> OR lucent sdk android <javap.txt> --out <directory>; use input "-" with --classpath <android.jar> --class <qualified.Class> to run javap',
    );
  let schema;
  if (platform === "swift") {
    if (!options["--module"]) throw new Error("Swift extraction requires --module");
    schema = extractSwiftInterface(readFileSync(input, "utf8"), options["--module"]);
  } else if (platform === "swift-symbolgraph") {
    schema = extractSwiftSymbolGraph(readFileSync(input, "utf8"));
    if (options["--module"] && options["--module"] !== schema.module)
      throw new Error("--module must match the symbol graph module name");
  } else {
    let source: string;
    if (input === "-") {
      if (!options["--classpath"] || !options["--class"] || !/^[A-Za-z_$][\w.$]*$/.test(options["--class"]))
        throw new Error("Android extraction requires --classpath and a qualified --class");
      source = execFileSync("javap", ["-classpath", options["--classpath"], "-public", options["--class"]], {
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
      });
    } else source = readFileSync(input, "utf8");
    schema = extractJavaSignatures(source);
  }
  const output = generateBindingLibrary(schema);
  const dir = options["--out"] ?? "lucent-sdk";
  mkdirSync(dir, { recursive: true });
  for (const [name, contents] of Object.entries({
    ...(schema.coverage
      ? { "coverage.json": JSON.stringify({ extraction: schema.extraction, symbols: schema.coverage }, null, 2) + "\n" }
      : {}),
    "schema.json": JSON.stringify(schema, null, 2) + "\n",
    "library.json": JSON.stringify(output.library, null, 2) + "\n",
    "index.d.ts": output.declarations,
  }))
    writeFileSync(join(dir, name), contents);
  if (!schema.functions.length)
    throw new Error(
      "No supported SDK declarations found (coverage written to output):\n" + schema.diagnostics.join("\n"),
    );
  for (const diagnostic of schema.diagnostics) console.warn(diagnostic);
  console.log(`Generated ${schema.functions.length} SDK bindings in ${dir}`);
}
