/**
 * The package distribution matrix (T145): Lucent packages installed the
 * ways real apps install them, then built by the packed
 * @lucent-lang/lucent's own CLI, as smoke-install.ts packs it.
 *
 *   - Workspaces: a pnpm, a Yarn (4, node-modules linker) and an npm
 *     monorepo. Its app depends on two unrelated Lucent packages linked from
 *     the workspace, which both depend on a third the app doesn't name.
 *     Every package's modules are built, and the native package copies the
 *     third's resources and assets.
 *   - An upgrade: an app built with the release npm has, then with this
 *     one. Its build after the upgrade writes what a clean build writes.
 *
 * The builds target the host: what the platforms compile is the smoke
 * install's and the window apps' to check.
 *
 *   node scripts/install-matrix.ts [pnpm|yarn|npm|upgrade]…
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runToExit } from "../packages/lucent/test/run-to-exit.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-matrix-"));

const CASES = ["pnpm", "yarn", "npm", "upgrade"] as const;
type Case = (typeof CASES)[number];
const asked = process.argv.slice(2) as Case[];
for (const a of asked)
  if (!CASES.includes(a)) throw new Error(`unknown case ${a}: one of ${CASES.join(", ")}`);
const cases = asked.length ? asked : CASES;

/** The Yarn corepack runs, from npm's registry (Yarn's own may be out of reach). */
const YARN = "yarn@4.9.2";
const registry = "https://registry.npmjs.org";

function sh(cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = {}): string {
  // An install from nothing takes minutes; a hung step fails the case.
  const r = runToExit(cmd, args, {
    cwd,
    env: { ...process.env, COREPACK_NPM_REGISTRY: registry, ...env },
    maxBuffer: 64 << 20,
    timeout: 900_000,
  });
  if (r.status !== 0)
    throw new Error(`${cmd} ${args.join(" ")} failed in ${cwd}:\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
}

function write(dir: string, files: Record<string, string>): void {
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
}

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/** `pnpm pack`s `dir` into the work directory: the tarball's path. */
function pack(dir: string): string {
  const out = sh("pnpm", ["pack", "--pack-destination", work], dir).trim().split("\n").pop()!;
  return path.isAbsolute(out) ? out : path.join(work, path.basename(out));
}

console.log("• packing @lucent-lang/lucent");
const lucent = pack(path.join(root, "packages/lucent"));

/** The installed CLI of the app at `dir`, wherever the package manager put it. */
function lucentIn(dir: string, args: string[]): string {
  const pkg = sh(
    process.execPath,
    ["-p", 'require.resolve("@lucent-lang/lucent/package.json")'],
    dir,
  ).trim();
  return sh(process.execPath, [path.join(path.dirname(pkg), "bin/lucent.cjs"), ...args], dir, {
    NO_COLOR: "1",
  });
}

/** The modules a build compiled, as its native package's manifest lists them. */
const modulesOf = (app: string) =>
  (
    JSON.parse(fs.readFileSync(path.join(app, ".lucent/native/manifest.json"), "utf8")) as {
      modules: string[];
    }
  ).modules.sort();

// --- workspaces --------------------------------------------------------------------------

/** A Lucent package of the workspace: a module, and the Lucent packages it depends on. */
function lucentPackage(
  name: string,
  module: string,
  dependencies: Record<string, string>,
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    [`packages/${name}/package.json`]: json({
      name,
      version: "1.0.0",
      private: true,
      main: "index.ts",
      lucent: { sources: "src" },
      dependencies,
    }),
    [`packages/${name}/index.ts`]: `export * from "./src/${module}.lucent";\n`,
    ...extra,
  };
}

/**
 * A monorepo whose app uses lucent-weather and lucent-clock, linked from
 * the workspace with `link`, which both use lucent-units.
 */
function workspace(manager: "pnpm" | "yarn" | "npm"): string {
  const dir = path.join(work, manager);
  const link = manager === "npm" ? "1.0.0" : "workspace:*";

  write(dir, {
    "package.json": json({
      name: `matrix-${manager}`,
      private: true,
      ...(manager === "pnpm" ? {} : { workspaces: ["apps/*", "packages/*"] }),
      ...(manager === "yarn" ? { packageManager: YARN } : {}),
    }),
    ...(manager === "pnpm"
      ? { "pnpm-workspace.yaml": 'packages:\n  - "apps/*"\n  - "packages/*"\n' }
      : {}),
    ...(manager === "yarn"
      ? {
          ".yarnrc.yml": `nodeLinker: node-modules\nnpmRegistryServer: "${registry}"\nenableTelemetry: false\n# Yarn forbids a new lockfile under CI by default: the matrix makes one.\nenableImmutableInstalls: false\n`,
        }
      : {}),

    ...lucentPackage(
      "lucent-units",
      "units",
      {},
      {
        "packages/lucent-units/src/units.lucent.ts":
          "/** Degrees Fahrenheit in Celsius. */\nexport function celsius(fahrenheit: number): number {\n  return ((fahrenheit - 32) * 5) / 9;\n}\n",
        "packages/lucent-units/lucent.json": json({
          ios: { resources: ["res/units.txt"] },
          android: { assets: ["assets"] },
        }),
        "packages/lucent-units/res/units.txt": "°C °F\n",
        "packages/lucent-units/assets/units.txt": "°C °F\n",
      },
    ),
    ...lucentPackage(
      "lucent-weather",
      "weather",
      { "lucent-units": link },
      {
        "packages/lucent-weather/src/weather.lucent.ts":
          'import { celsius } from "lucent-units/src/units.lucent";\n\nexport function forecast(fahrenheit: number): string {\n  return `${Math.round(celsius(fahrenheit))} °C`;\n}\n',
      },
    ),
    ...lucentPackage(
      "lucent-clock",
      "clock",
      { "lucent-units": link },
      {
        "packages/lucent-clock/src/clock.lucent.ts":
          'import { celsius } from "lucent-units/src/units.lucent";\n\nexport function stamp(hour: number, fahrenheit: number): string {\n  return `${hour}:00, ${celsius(fahrenheit).toFixed(1)}`;\n}\n',
      },
    ),

    "apps/app/package.json": json({
      name: "app",
      private: true,
      dependencies: {
        "@lucent-lang/lucent": `file:${lucent}`,
        "lucent-weather": link,
        "lucent-clock": link,
      },
    }),
    "apps/app/src/today.lucent.ts":
      'import { stamp } from "lucent-clock/src/clock.lucent";\nimport { forecast } from "lucent-weather/src/weather.lucent";\n\nexport function today(): string {\n  return `${forecast(68)} at ${stamp(9, 68)}`;\n}\n',
  });

  return dir;
}

function workspaceCase(manager: "pnpm" | "yarn" | "npm"): void {
  console.log(`• a ${manager} workspace, its Lucent packages linked from it`);
  const dir = workspace(manager);
  const install = {
    pnpm: ["pnpm", ["install", "--no-frozen-lockfile"]],
    yarn: ["corepack", [YARN, "install"]],
    npm: ["npm", ["install", "--no-audit", "--no-fund", "--loglevel=error"]],
  }[manager] as [string, string[]];
  sh(install[0], install[1], dir);

  const app = path.join(dir, "apps/app");
  lucentIn(app, ["build", "--platforms", "host"]);

  const modules = modulesOf(app);
  for (const m of ["today", "lucent-clock/clock", "lucent-weather/weather", "lucent-units/units"])
    if (!modules.includes(m))
      throw new Error(`${manager}: ${m} was not built (the build has ${modules.join(", ")})`);

  // The transitive package's native files, copied into the one native package.
  for (const f of ["packages/lucent-units/res/units.txt", "packages/lucent-units/assets/units.txt"])
    if (!fs.existsSync(path.join(app, ".lucent/native", f)))
      throw new Error(`${manager}: the native package has no ${f}`);

  const resolved = JSON.parse(
    fs.readFileSync(path.join(app, ".lucent/native/resolved.json"), "utf8"),
  ) as { packages: Record<string, string> };
  for (const p of ["lucent-clock", "lucent-weather", "lucent-units"])
    if (resolved.packages[p] !== "1.0.0")
      throw new Error(`${manager}: resolved.json lacks ${p}: ${JSON.stringify(resolved.packages)}`);
}

// --- an upgrade ----------------------------------------------------------------------------

/** Every file of `dir`, by its path under it, with a hash of its contents. */
function snapshot(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (rel: string) => {
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const r = path.join(rel, e.name);
      if (e.isDirectory()) walk(r);
      else
        out.set(
          r,
          createHash("sha256")
            .update(fs.readFileSync(path.join(dir, r)))
            .digest("hex"),
        );
    }
  };
  walk("");
  return out;
}

function upgradeCase(): void {
  const previous = sh("npm", ["view", "@lucent-lang/lucent", "version"], work).trim();
  console.log(`• an upgrade from ${previous}, the release on npm, to this one`);

  const app = path.join(work, "upgrade");
  write(app, {
    "package.json": json({
      name: "upgrade",
      private: true,
      dependencies: {
        "@lucent-lang/lucent": previous,
        "lucent-haptics": `file:${pack(path.join(root, "examples/lucent-haptics"))}`,
      },
    }),
    "src/hello.lucent.ts":
      'import { delay } from "lucent:core";\n\nexport async function greet(name: string): Promise<string> {\n  await delay(1);\n  return `hello ${name}`;\n}\n',
  });
  const npm = ["--no-audit", "--no-fund", "--loglevel=error"];
  sh("npm", ["install", ...npm], app);
  lucentIn(app, ["build", "--platforms", "host"]);

  sh("npm", ["install", ...npm, `@lucent-lang/lucent@file:${lucent}`], app);
  // The packed package, whatever version it says it is.
  const lock = JSON.parse(fs.readFileSync(path.join(app, "package-lock.json"), "utf8")) as {
    packages: Record<string, { resolved?: string }>;
  };
  const resolved = lock.packages["node_modules/@lucent-lang/lucent"]?.resolved ?? "";
  if (!resolved.startsWith("file:")) throw new Error(`upgrade: npm installed ${resolved}`);
  lucentIn(app, ["build", "--platforms", "host"]);
  const upgraded = snapshot(path.join(app, ".lucent/native"));

  lucentIn(app, ["clean"]);
  lucentIn(app, ["build", "--platforms", "host"]);
  const clean = snapshot(path.join(app, ".lucent/native"));

  const differ = [...new Set([...upgraded.keys(), ...clean.keys()])]
    .filter((f) => upgraded.get(f) !== clean.get(f))
    .sort();
  if (differ.length)
    throw new Error(
      `the build after the upgrade differs from a clean build in ${differ.length} files: ${differ
        .slice(0, 10)
        .map((f) => `${f} (${!upgraded.has(f) ? "missing" : !clean.has(f) ? "stale" : "changed"})`)
        .join(", ")}`,
    );
  for (const m of ["hello", "lucent-haptics/haptics"])
    if (!modulesOf(app).includes(m)) throw new Error(`upgrade: ${m} was not built`);
}

for (const c of cases) {
  if (c === "upgrade") upgradeCase();
  else workspaceCase(c);
}

console.log(`✓ the distribution matrix: ${cases.join(", ")} (${work})`);
