import fs from "node:fs";
import path from "node:path";
import type { Invocation } from "../args.ts";
import { mapLucentPaths } from "../project.ts";

export function run({ root, out }: Invocation): number {
  const rnConfig = path.join(root, "react-native.config.js");
  const entry = `"lucent": { root: require("path").join(__dirname, ".lucent", "native") }`;
  const text = fs.existsSync(rnConfig) ? fs.readFileSync(rnConfig, "utf8") : undefined;
  if (text === undefined) {
    fs.writeFileSync(rnConfig, `module.exports = {\n  dependencies: {\n    ${entry},\n  },\n};\n`);
    process.stdout.write("✓ wrote react-native.config.js\n");
  } else if (text.includes('"lucent-native"')) {
    // Earlier versions named the dependency lucent-native.
    fs.writeFileSync(rnConfig, text.replace('"lucent-native"', '"lucent"'));
    process.stdout.write("✓ renamed the lucent-native dependency to lucent in react-native.config.js\n");
  } else if (!/["']lucent["']\s*:/.test(text)) {
    process.stdout.write(`! add this to the "dependencies" of react-native.config.js:\n    ${entry}\n`);
  }
  const gitignore = path.join(root, ".gitignore");
  const ignored = fs.existsSync(gitignore) ? fs.readFileSync(gitignore, "utf8") : "";
  if (!ignored.split("\n").includes(".lucent/")) {
    fs.appendFileSync(gitignore, `${ignored.endsWith("\n") || !ignored ? "" : "\n"}.lucent/\n`);
    process.stdout.write("✓ added .lucent/ to .gitignore\n");
  }
  const mapped = mapLucentPaths(root);
  if (mapped) out.print(`${mapped.level === "ok" ? "✓" : "!"} ${mapped.text}`);
  process.stdout.write(
    "Next: wrap your Metro config with withLucent() from @lucent-lang/lucent/metro, and enable\n" +
      '"noUncheckedIndexedAccess": true in tsconfig.json (Lucent requires it).\n',
  );
  return 0;
}
