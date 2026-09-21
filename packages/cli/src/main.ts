#!/usr/bin/env bun
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { compile, renderDiagnostic } from "@lucent/compiler";
import { build, findLucentFiles, type HostName } from "./index.ts";

const USAGE = `lucent — ahead-of-time TypeScript → Swift/Kotlin for React Native

Usage:
  lucent build [--host expo|nitro] [--out <dir>] [--emit-ir] [--force] [--no-postgen] [files…]
  lucent check [files…]
  lucent init [--host expo|nitro]
`;

interface Args {
  command: string | undefined;
  host: HostName;
  out: string | undefined;
  emitIR: boolean;
  force: boolean;
  postGenerate: boolean;
  files: string[];
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    command: argv[0],
    host: "expo",
    out: undefined,
    emitIR: false,
    force: false,
    postGenerate: true,
    files: [],
  };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--host") args.host = argv[++i] as HostName;
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--emit-ir") args.emitIR = true;
    else if (a === "--force") args.force = true;
    else if (a === "--no-postgen") args.postGenerate = false;
    else if (a.startsWith("-")) throw new Error(`Unknown flag ${a}`);
    else args.files.push(a);
  }
  if (args.host !== "expo" && args.host !== "nitro") throw new Error(`Unknown host ${String(args.host)}`);
  return args;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const root = process.cwd();
  switch (args.command) {
    case "build": {
      const result = await build({
        root,
        host: args.host,
        ...(args.out ? { outDir: args.out } : {}),
        ...(args.files.length ? { files: args.files } : {}),
        emitIR: args.emitIR,
        force: args.force,
        postGenerate: args.postGenerate,
        log: (l) => console.log(l),
      });
      for (const d of result.diagnostics) console.error("\n" + d.rendered);
      if (!result.ok) return 1;
      console.log(
        `\n${result.compiled.length} compiled, ${result.cached.length} cached → ${relative(root, result.outDir)}`,
      );
      return 0;
    }
    case "check": {
      const files = args.files.length ? args.files.map((f) => join(root, f)) : findLucentFiles(root);
      let failed = false;
      for (const file of files) {
        const source = readFileSync(file, "utf8");
        const result = compile(source, { fileName: file });
        const rel = relative(root, file);
        if (result.diagnostics.length) failed = true;
        for (const d of result.diagnostics) console.error("\n" + renderDiagnostic(d, source, rel));
        if (!result.diagnostics.length) console.log(`✓ ${rel}`);
      }
      return failed ? 1 : 0;
    }
    case "init":
      return init(root, args.host);
    default:
      console.log(USAGE);
      return args.command ? 1 : 0;
  }
}

/** Adds the host's runtime dependencies to package.json and a starter module. */
function init(root: string, host: HostName): number {
  const pkgPath = join(root, "package.json");
  if (!existsSync(pkgPath)) {
    console.error("No package.json here.");
    return 1;
  }
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  pkg.dependencies ??= {};
  pkg.devDependencies ??= {};
  pkg.dependencies["@lucent/runtime"] ??= "*";
  pkg.devDependencies["@lucent/types"] ??= "*";
  if (host === "nitro") {
    pkg.dependencies["react-native-nitro-modules"] ??= "*";
    pkg.dependencies["lucent-native"] = "file:./.lucent/nitro";
    pkg.devDependencies["nitrogen"] ??= "*";
  }
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  const starter = join(root, "src", "math.lucent.ts");
  if (!existsSync(starter)) {
    writeFileSync(starter, "export function add(a: number, b: number): number {\n  return a + b;\n}\n");
    console.log(`✓ wrote ${relative(root, starter)}`);
  }
  console.log(`✓ updated package.json for the ${host} host; run your package manager's install.`);
  return 0;
}

process.exit(await main());
