/**
 * Micro harness: time compile() of fixtures/add.lucent.ts.
 * Prints elapsed ms only — not a performance claim or budget result.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "@lucent-lang/compiler";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const fixture = join(root, "fixtures", "add.lucent.ts");
const source = readFileSync(fixture, "utf8");
const iterations = Number(process.argv[2] ?? 50);

const started = performance.now();
for (let i = 0; i < iterations; i++) {
  const result = compile(source, { fileName: fixture });
  if (result.diagnostics.length || !result.module) {
    console.error("compile failed", result.diagnostics);
    process.exit(1);
  }
}
const ms = performance.now() - started;
console.log(`compile fixtures/add.lucent.ts × ${iterations}: ${ms.toFixed(2)} ms`);
