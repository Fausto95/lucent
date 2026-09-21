import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { extractSwiftInterface, extractJavaSignatures, generateBindingLibrary } from "./index.ts";
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
  if (!input || !["swift", "android"].includes(platform ?? ""))
    throw new Error(
      'Usage: lucent sdk swift <file.swiftinterface> --module <Module> --out <directory> OR lucent sdk android <javap.txt> --out <directory>; use input "-" with --classpath <android.jar> --class <qualified.Class> to run javap',
    );
  let schema;
  if (platform === "swift") {
    if (!options["--module"]) throw new Error("Swift extraction requires --module");
    schema = extractSwiftInterface(readFileSync(input, "utf8"), options["--module"]);
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
  if (!schema.functions.length)
    throw new Error("No supported SDK declarations found:\n" + schema.diagnostics.join("\n"));
  const dir = options["--out"] ?? "lucent-sdk";
  mkdirSync(dir, { recursive: true });
  for (const [name, contents] of Object.entries({
    "schema.json": JSON.stringify(schema, null, 2) + "\n",
    "library.json": JSON.stringify(output.library, null, 2) + "\n",
    "index.d.ts": output.declarations,
  }))
    writeFileSync(join(dir, name), contents);
  for (const diagnostic of schema.diagnostics) console.warn(diagnostic);
  console.log(`Generated ${schema.functions.length} SDK bindings in ${dir}`);
}
