/**
 * What the published bundle (dist/) loads from outside it: Node's modules
 * and TypeScript, which the package depends on. Ink and React are bundled:
 * resolved from the app, they would be the app's React wherever it hoists
 * another version, and Ink's hooks would fail ("Invalid hook call").
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { REQUIREMENTS } from "../src/cli/doctor.ts";

const dist = path.resolve(import.meta.dirname, "../dist");
const pkg = JSON.parse(
  fs.readFileSync(path.resolve(import.meta.dirname, "../package.json"), "utf8"),
) as { dependencies: Record<string, string>; engines?: { node?: string } };

/** Every module the bundle's files import by name (static and dynamic imports). */
function external(): Set<string> {
  const out = new Set<string>();
  for (const f of fs.readdirSync(dist).filter((f) => f.endsWith(".js"))) {
    const text = fs.readFileSync(path.join(dist, f), "utf8");
    // Static imports: the bundler puts them first, so the header ends at the first line of code
    // (below it is text, like the templates' sources, that only looks like imports).
    const code = /^(?:\/\/#region|const |let |var |function |async |class |export )/m.exec(text);
    const header = code ? text.slice(0, code.index) : text;
    for (const m of header.matchAll(/^import (?:[\s\S]*? from )?"([^".][^"]*)";$/gm))
      out.add(m[1]!);
    // Dynamic imports of a literal name, anywhere (not a template's \`${…}\` text).
    for (const m of text.matchAll(/\bimport\("([^".$][^"$]*)"\)/g)) out.add(m[1]!);
  }
  return out;
}

describe("the published bundle", () => {
  it("loads only Node's modules and its dependencies, never the app's React or Ink", () => {
    // lucent:* imports are in the samples the CLI scaffolds, not the bundle's own.
    const outside = [...external()].filter(
      (m) => !m.startsWith("node:") && !m.startsWith("lucent:"),
    );
    // React's devtools: only with DEV=true, when the app installed them (Ink's own check).
    expect(outside.filter((m) => m !== "react-devtools-core").sort()).toEqual(["typescript"]);
    expect(Object.keys(pkg.dependencies).sort()).toEqual(["picocolors", "typescript"]);
  });

  it("states the Node version it runs on, as lucent doctor checks it", () => {
    expect(pkg.engines?.node).toBe(`>=${REQUIREMENTS.node}`);
  });
});
