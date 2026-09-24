import fs from "node:fs";
import path from "node:path";
import { type PackageManager, packageManagerOf, runner } from "../package-manager.ts";
import { withLucentTsconfig } from "../tsconfig.ts";
import { addExpoPlugin, applyGradleTask, GRADLE_LINE, HELLO, ignoreNativePackage, linkNativePackage, metroConfig, RN_CONFIG_SNIPPET, wrapMetro } from "./patch.ts";

/** A file init writes: its text before (undefined: a new file) and after. */
export interface Change {
  file: string;
  why: string;
  before: string | undefined;
  after: string;
}

/** A change init cannot make safely: what to add by hand. */
export interface Manual {
  file: string;
  why: string;
  snippet: string;
}

export interface InitPlan {
  kind: "expo" | "bare";
  packageManager: PackageManager;
  changes: Change[];
  manual: Manual[];
  /** The command to run once the app is set up. */
  next: string;
}

const read = (root: string, file: string) => (fs.existsSync(path.join(root, file)) ? fs.readFileSync(path.join(root, file), "utf8") : undefined);
const first = (root: string, files: string[]) => files.find((f) => fs.existsSync(path.join(root, f)));

/** Everything init would change in the app at `root`, changing nothing. */
export function planInit(root: string): InitPlan {
  const pkg = JSON.parse(read(root, "package.json") ?? "{}") as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  const kind = "expo" in { ...pkg.dependencies, ...pkg.devDependencies } ? "expo" : "bare";
  const packageManager = packageManagerOf(root)?.name ?? "npm";
  const changes: Change[] = [];
  const manual: Manual[] = [];
  const change = (file: string, why: string, after: string | undefined) => {
    if (after !== undefined) changes.push({ file, why, before: read(root, file), after });
  };

  const metro = first(root, ["metro.config.js", "metro.config.cjs", "metro.config.mjs", "metro.config.ts"]);
  const wrapped = metro ? wrapMetro(read(root, metro)!) : metroConfig(kind === "expo");
  const metroWhy = "bundle each *.lucent.ts as the proxy of its native module";
  if (wrapped === "manual") manual.push({ file: metro!, why: metroWhy, snippet: 'const { withLucent } = require("@lucent-lang/lucent/metro");\n// …\nexport default withLucent(config);' });
  else change(metro ?? "metro.config.js", metroWhy, wrapped);

  if (kind === "expo") {
    const pluginWhy = "compile the modules during expo prebuild, and link the native package";
    if (fs.existsSync(path.join(root, "app.json"))) change("app.json", pluginWhy, addExpoPlugin(read(root, "app.json")!));
    else {
      const config = first(root, ["app.config.ts", "app.config.js"]);
      if (config && !read(root, config)!.includes("@lucent-lang/lucent")) manual.push({ file: config, why: pluginWhy, snippet: 'plugins: ["@lucent-lang/lucent"]' });
    }
  } else {
    const gradleWhy = "run lucent build before every Android build";
    if (fs.existsSync(path.join(root, "android/app/build.gradle"))) change("android/app/build.gradle", gradleWhy, applyGradleTask(read(root, "android/app/build.gradle")!));
    else if (fs.existsSync(path.join(root, "android/app/build.gradle.kts")) && !read(root, "android/app/build.gradle.kts")!.includes("lucent.gradle")) manual.push({ file: "android/app/build.gradle.kts", why: gradleWhy, snippet: `apply(from = ${GRADLE_LINE.replace(/^apply from: /, "")})` });
    const linked = linkNativePackage(read(root, "react-native.config.js"));
    const linkWhy = "autolink the generated native package (.lucent/native)";
    if (linked === "manual") manual.push({ file: "react-native.config.js", why: linkWhy, snippet: RN_CONFIG_SNIPPET });
    else change("react-native.config.js", linkWhy, linked);
  }

  const tsconfig = read(root, "tsconfig.json");
  if (tsconfig !== undefined) {
    const tsWhy = "let editors and tsc resolve lucent:* and check indexing as the compiler does";
    try {
      change("tsconfig.json", tsWhy, withLucentTsconfig(tsconfig));
    } catch (e) {
      manual.push({ file: "tsconfig.json", why: `${tsWhy} (${(e as Error).message})`, snippet: '"noUncheckedIndexedAccess": true,\n"paths": { "lucent:*": ["./.lucent/native/types/*"] }' });
    }
  }
  change(".gitignore", "the native package is generated, like a build output", ignoreNativePackage(read(root, ".gitignore")));
  if (!hasModules(root)) change("src/hello.lucent.ts", "a first module to try", HELLO);

  const x = runner(packageManager);
  return { kind, packageManager, changes, manual, next: kind === "expo" ? `${x} expo run:ios` : `${x} lucent build && ${x} react-native run-ios` };
}

/** Whether the project has a *.lucent.ts file (build output and dependencies aside). */
function hasModules(root: string): boolean {
  const walk = (dir: string): boolean =>
    fs.readdirSync(dir, { withFileTypes: true }).some((e) => {
      if (e.name === "node_modules" || e.name.startsWith(".") || e.name === "ios" || e.name === "android") return false;
      return e.isDirectory() ? walk(path.join(dir, e.name)) : /\.lucent\.tsx?$/.test(e.name);
    });
  return walk(root);
}

/** Writes the changes. */
export function applyChanges(root: string, changes: Change[]): void {
  for (const c of changes) {
    fs.mkdirSync(path.dirname(path.join(root, c.file)), { recursive: true });
    fs.writeFileSync(path.join(root, c.file), c.after);
  }
}
