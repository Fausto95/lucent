/**
 * How much of the e2e corpus the semantic IR lowers (LUCENT_LOWERING=ir):
 * the functions it lowers, and why the others fall back to the legacy
 * emitter, most common reason first. A migration aid (ROADMAP T53).
 *
 *   node scripts/ir-coverage.ts [--why] [case…]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "../packages/compiler/src/index.ts";
import { coverage } from "../packages/compiler/src/ir/cpp.ts";

const cases = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../packages/compiler/test/e2e/cases",
);
const args = process.argv.slice(2);
const why = args.includes("--why");
const filter = args.filter((a) => !a.startsWith("--"));
const names = fs
  .readdirSync(cases)
  .filter((f) => f.endsWith(".test.js"))
  .map((f) => f.replace(/\.test\.js$/, ""))
  .filter((n) => filter.length === 0 || filter.includes(n))
  .sort();

/** A case's modules: one file, or a directory of them. */
function files(name: string): string[] {
  const dir = path.join(cases, name);

  if (!fs.existsSync(dir)) return [`${dir}.lucent.ts`];

  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".lucent.ts"))
    .map((f) => path.join(dir, f));
}

process.env.LUCENT_LOWERING = "ir";

const complete: string[] = [];

for (const name of names) {
  const [lowered, fellBack] = [coverage.lowered.length, coverage.fellBack.length];
  const result = compile(files(name));

  if (!result.ok) console.log(`${name}: does not compile`);
  else if (coverage.fellBack.length === fellBack && coverage.lowered.length > lowered)
    complete.push(name);
}

const total = coverage.lowered.length + coverage.fellBack.length;

console.log(`lowered ${coverage.lowered.length} of ${total} functions`);
console.log(`cases lowered completely: ${complete.join(", ") || "none"}`);

const reasons = new Map<string, string[]>();

for (const f of coverage.fellBack) {
  const reason = f.why.replace(/ \(\/.*\)$/, "").replace(/ yet$/, "");

  reasons.set(reason, [...(reasons.get(reason) ?? []), why ? `${f.id}: ${f.why}` : f.id]);
}

for (const [reason, fns] of [...reasons].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`${String(fns.length).padStart(4)}  ${reason}`);

  if (why) for (const f of fns) console.log(`        ${f}`);
}
