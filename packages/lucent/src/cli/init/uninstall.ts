/**
 * What `lucent uninstall` changes: the reverse of `lucent init` and of what
 * the Expo config plugin writes, each edit undone where it is as init
 * left it. The app's modules and its own edits stay.
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { type PackageManager, packageManagerOf, runner } from "../package-manager.ts";
import { type Change, type InitPlan, type Manual } from "./plan.ts";
import { GRADLE_LINES, linkNativePackage, metroConfig } from "./patch.ts";

const read = (root: string, file: string) =>
  fs.existsSync(path.join(root, file)) ? fs.readFileSync(path.join(root, file), "utf8") : undefined;

const METRO_REQUIRE = /^const \{ withLucent \} = require\("@lucent-lang\/lucent\/metro"\);\n/m;

/** The Metro config without withLucent, or undefined when it has none; "manual" when it's not as init wrapped it. */
export function unwrapMetro(text: string): string | "manual" | undefined {
  if (!text.includes("@lucent-lang/lucent/metro")) return undefined;
  const m = /^module\.exports = withLucent\(([\s\S]+)\);\n?$/m.exec(text);
  if (!m || !METRO_REQUIRE.test(text)) return "manual";
  return `${text.slice(0, m.index)}module.exports = ${m[1]};\n`.replace(METRO_REQUIRE, "");
}

/** The build script without Lucent's Gradle line, or undefined when it has none. */
export function removeGradleTask(text: string): string | undefined {
  const lines = text.split("\n");
  const kept = lines.filter((l) => !Object.values(GRADLE_LINES).includes(l));
  return kept.length === lines.length ? undefined : kept.join("\n");
}

/** .gitignore without the lines init added, or undefined when it has none. */
export function unignoreNativePackage(text: string): string | undefined {
  const next = text.replace(/^# Lucent's generated native package\n\.lucent\/\n?/m, "");
  return next === text ? undefined : next;
}

/** The JSON(C) text with `key` removed from the object at `at` (a path of keys), or undefined without it. */
function withoutMember(text: string, at: string[], key: string): string | undefined {
  const sf = ts.parseJsonText("file.json", text);
  let obj: ts.Expression | undefined = sf.statements[0]?.expression;
  for (const k of at) {
    if (!obj || !ts.isObjectLiteralExpression(obj)) return undefined;
    obj = member(obj, k)?.initializer;
  }
  if (!obj || !ts.isObjectLiteralExpression(obj)) return undefined;
  const props = obj.properties;
  const i = props.findIndex((p) => propName(p) === key);
  if (i < 0) return undefined;
  const p = props[i]!;
  // From the end of the member before (its comma) to this one's end; the first, through the next's start.
  const start = i > 0 ? props[i - 1]!.getEnd() : p.getFullStart();
  const end = i > 0 ? p.getEnd() : i + 1 < props.length ? props[i + 1]!.getStart(sf) : p.getEnd();
  let out = text.slice(0, start) + text.slice(end);
  // A trailing comma left after the last member, as the file had none before it.
  if (i > 0 && i === props.length - 1) out = out.replace(/^(\s*),(?=\s*\})/, "$1");
  return out;
}

const propName = (p: ts.ObjectLiteralElementLike) =>
  ts.isPropertyAssignment(p) && (ts.isStringLiteral(p.name) || ts.isIdentifier(p.name))
    ? p.name.text
    : undefined;

function member(o: ts.ObjectLiteralExpression, key: string): ts.PropertyAssignment | undefined {
  return o.properties.find(
    (p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && propName(p) === key,
  );
}

/** The value at `at` of JSON(C) text, parsed, or undefined. */
function valueAt(text: string, at: string[]): unknown {
  const { config } = ts.parseConfigFileTextToJson("file.json", text) as { config?: unknown };
  let v = config;
  for (const k of at)
    v = v && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined;
  return v;
}

/** Whether JSON(C) text is an object with no members left. */
const emptyObject = (text: string) => {
  const v = valueAt(text, []);
  return !!v && typeof v === "object" && !Object.keys(v).length;
};

/** tsconfig.json without the lucent:* path and the editor plugin, or undefined when it has neither. */
export function withoutLucentTsconfig(text: string): string | undefined {
  let out = text;
  const paths = valueAt(out, ["compilerOptions", "paths"]) as Record<string, unknown> | undefined;
  if (paths && "lucent:*" in paths) {
    out = withoutMember(out, ["compilerOptions", "paths"], "lucent:*") ?? out;
    if (!Object.keys(paths).filter((k) => k !== "lucent:*").length)
      out = withoutMember(out, ["compilerOptions"], "paths") ?? out;
  }
  const plugins = valueAt(out, ["compilerOptions", "plugins"]);
  if (Array.isArray(plugins)) {
    const sf = ts.parseJsonText("tsconfig.json", out);
    const options = member(
      sf.statements[0]!.expression as ts.ObjectLiteralExpression,
      "compilerOptions",
    )!.initializer as ts.ObjectLiteralExpression;
    const list = member(options, "plugins")!.initializer as ts.ArrayLiteralExpression;
    const els = list.elements;
    const i = els.findIndex((e) => e.getText(sf).includes("@lucent-lang/lucent/ts-plugin"));
    if (i >= 0) {
      if (els.length === 1) out = withoutMember(out, ["compilerOptions"], "plugins") ?? out;
      else {
        const start = i > 0 ? els[i - 1]!.getEnd() : els[i]!.getStart(sf);
        const end = i > 0 ? els[i]!.getEnd() : els[i + 1]!.getStart(sf);
        out = out.slice(0, start) + out.slice(end);
      }
    }
  }
  return out === text ? undefined : out;
}

/** .vscode/settings.json without the settings init wrote (with init's values); "remove" when nothing else is left. */
export function withoutVscodeSettings(text: string): string | "remove" | undefined {
  let out = text;
  if (valueAt(out, ["typescript.tsdk"]) === "node_modules/typescript/lib")
    out = withoutMember(out, [], "typescript.tsdk") ?? out;
  if (valueAt(out, ["typescript.enablePromptUseWorkspaceTsdk"]) === true)
    out = withoutMember(out, [], "typescript.enablePromptUseWorkspaceTsdk") ?? out;
  if (out === text) return undefined;
  return emptyObject(out) ? "remove" : out;
}

/** app.json without the config plugin, or undefined when it has none. */
export function removeExpoPlugin(text: string): string | undefined {
  const json = JSON.parse(text) as { expo?: { plugins?: unknown[] }; plugins?: unknown[] };
  const target = (json.expo ?? json) as { plugins?: unknown[] };
  const ours = (p: unknown) =>
    p === "@lucent-lang/lucent" || (Array.isArray(p) && p[0] === "@lucent-lang/lucent");
  if (!target.plugins?.some(ours)) return undefined;
  target.plugins = target.plugins.filter((p) => !ours(p));
  if (!target.plugins.length) delete target.plugins;
  const indent = /^[ \t]+(?=")/m.exec(text)?.[0] ?? "  ";
  return `${JSON.stringify(json, null, indent)}\n`;
}

/** react-native.config.js without Lucent's entry; "remove" when it's the file init wrote. */
export function unlinkNativePackage(text: string): string | "remove" | "manual" | undefined {
  if (text === linkNativePackage(undefined)) return "remove";
  const entry =
    /\n?[ \t]*(["']?)lucent\1\s*:\s*(require\(["']@lucent-lang\/lucent\/autolink["']\)\(__dirname\)|\{\s*root:\s*require\(["']path["']\)\.join\(__dirname,\s*["']\.lucent["'],\s*["']native["']\)\s*,?\s*\}),?/;
  if (entry.test(text)) return text.replace(entry, "");
  return /@lucent-lang\/lucent|\.lucent/.test(text) ? "manual" : undefined;
}

/** Everything uninstall would change in the app at `root`, changing nothing. */
export function planUninstall(root: string): InitPlan {
  const pkg = JSON.parse(read(root, "package.json") ?? "{}") as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const kind = "expo" in deps ? "expo" : "bare";
  const packageManager: PackageManager = packageManagerOf(root)?.name ?? "npm";
  const changes: Change[] = [];
  const manual: Manual[] = [];
  const change = (file: string, why: string, after: string | "remove" | undefined) => {
    const before = read(root, file);
    if (after === undefined || before === undefined) return;
    changes.push(
      after === "remove"
        ? { file, why, before, after: "", remove: true }
        : { file, why, before, after },
    );
  };

  for (const metro of [
    "metro.config.js",
    "metro.config.cjs",
    "metro.config.mjs",
    "metro.config.ts",
  ]) {
    const text = read(root, metro);
    if (text === undefined) continue;
    const why = "stop bundling *.lucent.ts as native proxies";
    // The file init wrote for an app without one.
    if (text === metroConfig(kind === "expo")) change(metro, why, "remove");
    else {
      const next = unwrapMetro(text);
      if (next === "manual")
        manual.push({
          file: metro,
          why,
          snippet: "remove the withLucent require and unwrap module.exports = withLucent(…)",
        });
      else change(metro, why, next);
    }
  }

  if (fs.existsSync(path.join(root, "app.json")))
    change(
      "app.json",
      "stop compiling modules during expo prebuild",
      removeExpoPlugin(read(root, "app.json")!),
    );
  for (const config of ["app.config.ts", "app.config.js"])
    if (read(root, config)?.includes("@lucent-lang/lucent"))
      manual.push({
        file: config,
        why: "stop compiling modules during expo prebuild",
        snippet: 'remove "@lucent-lang/lucent" from plugins',
      });

  for (const gradle of ["android/app/build.gradle", "android/app/build.gradle.kts"]) {
    const text = read(root, gradle);
    if (text !== undefined)
      change(gradle, "stop running lucent build before Android builds", removeGradleTask(text));
  }

  const rn = read(root, "react-native.config.js");
  if (rn !== undefined) {
    const why = "stop autolinking .lucent/native";
    const next = unlinkNativePackage(rn);
    if (next === "manual")
      manual.push({
        file: "react-native.config.js",
        why,
        snippet: 'remove the "lucent" dependency',
      });
    else change("react-native.config.js", why, next);
  }

  const tsconfig = read(root, "tsconfig.json");
  if (tsconfig !== undefined) {
    try {
      change(
        "tsconfig.json",
        "stop resolving lucent:* and loading the editor plugin",
        withoutLucentTsconfig(tsconfig),
      );
    } catch {
      manual.push({
        file: "tsconfig.json",
        why: "stop resolving lucent:* and loading the editor plugin",
        snippet: 'remove "lucent:*" from paths and "@lucent-lang/lucent/ts-plugin" from plugins',
      });
    }
  }
  const vscode = read(root, ".vscode/settings.json");
  if (vscode !== undefined)
    change(
      ".vscode/settings.json",
      "the workspace TypeScript was for the editor plugin",
      withoutVscodeSettings(vscode),
    );
  const gitignore = read(root, ".gitignore");
  if (gitignore !== undefined) {
    const next = unignoreNativePackage(gitignore);
    // The file init wrote for an app without one.
    change(".gitignore", "no generated native package any more", next === "" ? "remove" : next);
  }

  const x = runner(packageManager);
  const remove = {
    npm: "npm uninstall",
    pnpm: "pnpm remove",
    yarn: "yarn remove",
    bun: "bun remove",
  }[packageManager];
  return {
    kind,
    packageManager,
    changes,
    manual,
    next:
      kind === "expo"
        ? `${x} lucent clean && ${remove} @lucent-lang/lucent && ${x} expo prebuild --clean`
        : `${x} lucent clean && ${remove} @lucent-lang/lucent && cd ios && pod install`,
  };
}
