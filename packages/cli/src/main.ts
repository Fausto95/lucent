import fs from "node:fs";
import path from "node:path";
import { compile, findLucentFiles, formatDiagnostic, inputsKey, isUpToDate, writeNativePackage } from "@lucent-lang/compiler";

const HELP = `lucent — compile *.lucent.ts modules into a native React Native package

Usage:
  lucent build [--root <dir>] [--out <dir>] [--force]
                                             Compile and write the native package (default out: <root>/.lucent/native);
                                             skipped when nothing changed since the last build, unless --force
  lucent check [--root <dir>]                 Type-check and validate without writing anything
  lucent init  [--root <dir>]                 Wire an app: react-native.config.js, .gitignore, tsconfig
`;

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

function run(): number {
  const command = process.argv[2];
  const root = path.resolve(arg("--root", process.cwd()));
  if (!command || command === "--help" || command === "-h" || command === "help") {
    process.stdout.write(HELP);
    return command ? 0 : 1;
  }
  if (command === "init") return init(root);
  if (command !== "build" && command !== "check") {
    process.stderr.write(`Unknown command: ${command}\n\n${HELP}`);
    return 1;
  }
  const files = findLucentFiles(root);
  if (files.length === 0) {
    process.stdout.write(`No *.lucent.ts files under ${root}\n`);
  }
  const t0 = Date.now();
  const out = path.resolve(arg("--out", path.join(root, ".lucent/native")));
  const key = inputsKey(files, out);
  if (command === "build" && !process.argv.includes("--force") && isUpToDate(out, key)) {
    process.stdout.write(`✓ ${path.relative(root, out)} is up to date (${files.length} module(s), ${Date.now() - t0} ms)\n`);
    return 0;
  }
  const result = compile(files);
  for (const d of result.diagnostics) process.stderr.write(formatDiagnostic({ ...d, file: d.file && path.relative(root, d.file) }) + "\n");
  if (!result.ok) {
    process.stderr.write(`\n✗ ${result.diagnostics.length} problem(s); nothing was written.\n`);
    return 1;
  }
  const names = [...result.proxies.keys()];
  if (command === "check") {
    process.stdout.write(`✓ ${names.length} module(s) OK: ${names.join(", ")} (${Date.now() - t0} ms)\n`);
    return 0;
  }
  const w = writeNativePackage(result, out, { inputsKey: key });
  process.stdout.write(`✓ Compiled ${names.length} module(s): ${names.join(", ")} (${Date.now() - t0} ms)\n`);
  process.stdout.write(`  ${path.relative(root, out)}: ${w.written.length} written, ${w.unchanged} unchanged, ${w.removed.length} removed\n`);
  if (w.structureChanged) {
    process.stdout.write(`  Native files were added or removed: run \`pod install\` (iOS) before the next build.\n`);
  }
  return 0;
}

function init(root: string): number {
  const rnConfig = path.join(root, "react-native.config.js");
  const entry = `"lucent-native": { root: require("path").join(__dirname, ".lucent", "native") }`;
  if (!fs.existsSync(rnConfig)) {
    fs.writeFileSync(rnConfig, `module.exports = {\n  dependencies: {\n    ${entry},\n  },\n};\n`);
    process.stdout.write("✓ wrote react-native.config.js\n");
  } else if (!fs.readFileSync(rnConfig, "utf8").includes("lucent-native")) {
    process.stdout.write(`! add this to the "dependencies" of react-native.config.js:\n    ${entry}\n`);
  }
  const gitignore = path.join(root, ".gitignore");
  const ignored = fs.existsSync(gitignore) ? fs.readFileSync(gitignore, "utf8") : "";
  if (!ignored.split("\n").includes(".lucent/")) {
    fs.appendFileSync(gitignore, `${ignored.endsWith("\n") || !ignored ? "" : "\n"}.lucent/\n`);
    process.stdout.write("✓ added .lucent/ to .gitignore\n");
  }
  process.stdout.write(
    "Next: wrap your Metro config with withLucent() from @lucent-lang/metro, and enable\n" +
      '"noUncheckedIndexedAccess": true in tsconfig.json (Lucent requires it).\n',
  );
  return 0;
}

process.exit(run());
