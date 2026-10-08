/**
 * Everything the compiler generates for a corpus of programs, to check that
 * a change to code generation keeps its meaning: the end-to-end cases (the
 * host), and both example apps for iOS, Android and the host, with their
 * packages. C++ is compared as tokens (whitespace outside literals
 * ignored, preprocessor lines whole), so layout changes pass; files that
 * then differ only in parentheses or braces are counted apart (the printer
 * adds the parentheses precedence needs and braces every branch, and the
 * end-to-end tests check what the code does); any other change shows as a
 * diff, after clang-format. Other files are compared as they are.
 *
 *   node scripts/codegen-corpus.ts write <dir>     write the corpus to <dir>
 *   node scripts/codegen-corpus.ts compare <dir>   compare today's output with <dir>
 *
 * --host: only the end-to-end cases, for the host, with no `#line`
 * directives (they move with every edit to a case): what any machine
 * builds without a platform SDK. packages/compiler/test/corpus holds this
 * corpus, and test/corpus.test.ts compares the compiler's output with it;
 * after a change to code generation, look at the diff it prints, then
 * write it again (`pnpm corpus:write`) in the same commit.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { casePackages, cases } from "../packages/compiler/test/e2e/run.ts";
import {
  bindExtensions,
  compile,
  projectFiles,
  type Target,
} from "../packages/compiler/src/index.ts";
import { projectSdk } from "../packages/lucent/src/cli/project.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const hostOnly = argv.includes("--host");
const [command, target] = argv.filter((a) => a !== "--host");
if ((command !== "write" && command !== "compare") || !target) {
  process.stderr.write("usage: node scripts/codegen-corpus.ts write|compare [--host] <dir>\n");
  process.exit(2);
}

/** One program's output: C++ units, JS proxies, Java, declarations. */
function outputs(r: ReturnType<typeof compile>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of r.files) out.set(k, v);
  for (const [k, v] of r.proxies) out.set(`proxies/${k}.js`, v);
  for (const [k, v] of r.java ?? []) out.set(`java/${k}`, v);
  for (const [k, v] of r.types ?? []) out.set(`types/${k}`, v);
  if (r.javaKeep?.length) out.set("java-keep.txt", `${r.javaKeep.join("\n")}\n`);
  return out;
}

function corpus(): Map<string, string> {
  const all = new Map<string, string>();
  const add = (prefix: string, r: ReturnType<typeof compile>) => {
    if (!r.ok)
      throw new Error(
        `${prefix}: ${r.diagnostics.map((d) => `${d.code} ${d.message}`).join("\n")}`,
      );
    for (const [k, v] of outputs(r)) all.set(`${prefix}/${k}`, v);
  };
  for (const c of cases([])) {
    // A case using a package's native extension binds it, as the e2e runner does.
    const found = casePackages(c);
    const extensions = found ? bindExtensions(found.native.extensions) : undefined;
    add(`e2e/${c.name}`, compile(c.files, { extensions }));
  }
  for (const app of hostOnly ? [] : ["apps/bare-example", "apps/expo-example"]) {
    const dir = path.join(root, app);
    const sdk = projectSdk(dir);
    const files = projectFiles(dir);
    for (const t of ["ios", "android", "host"] as Target[])
      add(`${path.basename(app)}/${t}`, compile(files, { platforms: [t], sdk }));
  }
  // Absolute paths (#line directives, stack frames) differ between machines.
  for (const [k, v] of all) {
    const text = v.split(root).join("<root>");
    all.set(k, hostOnly ? text.replace(/^#line .*\n/gm, "") : text);
  }
  return all;
}

const clangFormat =
  (process.platform === "darwin" &&
    spawnSync("xcrun", ["--find", "clang-format"], { encoding: "utf8" }).stdout?.trim()) ||
  "clang-format";

/** C++ in one canonical layout. */
function normalized(file: string, text: string): string {
  if (!/\.(cpp|h|mm)$/.test(file)) return text;
  const r = spawnSync(
    clangFormat,
    [
      `--assume-filename=${file.endsWith(".mm") ? "x.mm" : "x.cpp"}`,
      "--style={BasedOnStyle: LLVM, ColumnLimit: 0}",
    ],
    { input: text, encoding: "utf8", maxBuffer: 256 << 20 },
  );
  // Without clang-format, the diff is of the text as it is.
  if (r.error) return text;
  if (r.status !== 0) throw new Error(`clang-format ${file}: ${r.stderr}`);
  return r.stdout;
}

const now = corpus();
if (command === "write") {
  fs.rmSync(target, { recursive: true, force: true });
  for (const [k, v] of now) {
    fs.mkdirSync(path.dirname(path.join(target, k)), { recursive: true });
    fs.writeFileSync(path.join(target, k), v);
  }
  process.stdout.write(`${now.size} files written to ${target}\n`);
} else {
  const before = new Map<string, string>();
  for (const f of fs.readdirSync(target, { recursive: true, encoding: "utf8" })) {
    const p = path.join(target, f);
    if (fs.statSync(p).isFile()) before.set(f, fs.readFileSync(p, "utf8"));
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-corpus-"));
  let differences = 0;
  let parentheses = 0;
  /**
   * C++ as tokens: whitespace gone outside string and character literals,
   * and fresh temporaries (`coll_18`) unnumbered, as their numbers shift
   * when the compiler takes one more or less.
   */
  const tokens = (text: string) =>
    text
      .replace(/([A-Za-z])_\d+(?=_|\b)/g, "$1_N")
      .split("\n")
      .map((l) => (l.trim().startsWith("#") ? `\n${l.trim()}\n` : l))
      .join(" ")
      .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\s+/g, (m) => (/^\s/.test(m) ? "" : m));
  const punctuation = (text: string) => tokens(text).replace(/[(){}]/g, "");
  for (const k of new Set([...before.keys(), ...now.keys()])) {
    const a = before.get(k);
    const b = now.get(k);
    if (a === undefined || b === undefined) {
      process.stdout.write(`${a === undefined ? "added" : "removed"}: ${k}\n`);
      differences++;
      continue;
    }
    if (a === b) continue;
    const cxx = /\.(cpp|h|mm)$/.test(k);
    if (cxx && tokens(a) === tokens(b)) continue;
    if (cxx && punctuation(a) === punctuation(b)) {
      parentheses++;
      continue;
    }
    const [na, nb] = [normalized(k, a), normalized(k, b)];
    differences++;
    const fa = path.join(tmp, "a");
    const fb = path.join(tmp, "b");
    fs.writeFileSync(fa, na);
    fs.writeFileSync(fb, nb);
    const d = spawnSync("diff", ["-u", "--label", `before/${k}`, "--label", `now/${k}`, fa, fb], {
      encoding: "utf8",
    });
    process.stdout.write(d.stdout.split("\n").slice(0, 60).join("\n") + "\n");
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  const also = parentheses ? ` (${parentheses} differ in parentheses or braces only)` : "";
  process.stdout.write(
    differences
      ? `${differences} of ${now.size} files differ${also}\n`
      : `${now.size} files, no differences${also}\n`,
  );
  process.exit(differences ? 1 : 0);
}
