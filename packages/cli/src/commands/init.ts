import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CliError } from "../errors.ts";
import { findLucentFiles, type HostName } from "../index.ts";
import { select } from "../prompt.ts";
import {
  detectHost,
  detectPackageManager,
  PACKAGE_MANAGERS,
  readPackageJson,
  type PackageJson,
  type PackageManager,
} from "../project.ts";
import { CLI_VERSION } from "../version.ts";
import type { GlyphName } from "../emoji.ts";
import { HOST_LABELS, HOST_OPTION } from "./shared.ts";
import { defineCommand, type CommandContext } from "./types.ts";

interface Change {
  file: string;
  action: "wrote" | "updated" | "kept";
  detail: string;
  hint?: string;
}

type Step = (root: string, host: HostName, pkg: PackageJson) => Change;

const DEPENDENCIES: Readonly<
  Record<HostName, { dependencies: readonly string[]; devDependencies: readonly string[] }>
> = {
  expo: {
    dependencies: ["@lucent-lang/core"],
    devDependencies: ["@lucent-lang/cli"],
  },
  nitro: {
    dependencies: ["@lucent-lang/core", "react-native-nitro-modules"],
    devDependencies: ["@lucent-lang/cli", "nitrogen"],
  },
};

/** Lucent packages release in lockstep, so the CLI's own version is the right one to pin. */
const versionOf = (name: string): string => (name.startsWith("@lucent-lang/") ? CLI_VERSION : "*");

const NITRO_LINK = "file:./.lucent/nitro";
const EXPO_PLUGIN = "@lucent-lang/core/expo";
const METRO_FILES = ["metro.config.js", "metro.config.cjs", "metro.config.mjs", "metro.config.ts"];
const CONFIG_FILES = ["lucent.config.ts", "lucent.config.json"];

const STARTER = `/** Compiled to Swift and Kotlin by Lucent. Import it like any other module. */
export function add(a: number, b: number): number {
  return a + b;
}
`;

const CONFIG = `import { defineNativeConfig } from "@lucent-lang/core/config";

export default defineNativeConfig({
  // Capabilities your modules use, e.g. { clock: true, camera: { reason: "Scan codes" } }.
  capabilities: {},
});
`;

const METRO_CONFIG: Readonly<Record<HostName, string>> = {
  expo: `const { getDefaultConfig } = require("expo/metro-config");
const { withLucent } = require("@lucent-lang/core/metro");

module.exports = withLucent(getDefaultConfig(__dirname), { host: "expo" });
`,
  nitro: `const { getDefaultConfig, mergeConfig } = require("@react-native/metro-config");
const { withLucent } = require("@lucent-lang/core/metro");

module.exports = withLucent(mergeConfig(getDefaultConfig(__dirname), {}), { host: "nitro" });
`,
};

const RN_CONFIG = `const path = require("path");

module.exports = {
  dependencies: { "lucent-native": { root: path.join(__dirname, ".lucent", "nitro") } },
};
`;

const ACTION_GLYPH: Readonly<Record<Change["action"], GlyphName>> = { wrote: "ok", updated: "pencil", kept: "skip" };

const NEXT: Readonly<Record<HostName, (pm: PackageManager) => string[]>> = {
  expo: (pm) => [pm.install, "npx expo prebuild", "npx expo run:ios   (or run:android)", `${pm.exec} lucent doctor`],
  nitro: (pm) => [
    pm.install,
    `${pm.exec} lucent build --host nitro`,
    "cd ios && pod install && cd ..",
    "npx react-native run-ios   (or run-android)",
    `${pm.exec} lucent doctor`,
  ],
};

/** Rewrites a JSON file with the indentation it already uses. */
function writeJson(path: string, value: unknown): void {
  const original = existsSync(path) ? readFileSync(path, "utf8") : "";
  const indent = /^([ \t]+)"/m.exec(original)?.[1] ?? "  ";
  writeFileSync(path, JSON.stringify(value, null, indent) + "\n");
}

const addDependencies: Step = (root, host, pkg) => {
  const added: string[] = [];
  pkg.dependencies ??= {};
  pkg.devDependencies ??= {};
  const present = (name: string): boolean => name in pkg.dependencies! || name in pkg.devDependencies!;
  for (const name of DEPENDENCIES[host].dependencies)
    if (!present(name)) {
      pkg.dependencies[name] = versionOf(name);
      added.push(name);
    }
  for (const name of DEPENDENCIES[host].devDependencies)
    if (!present(name)) {
      pkg.devDependencies[name] = versionOf(name);
      added.push(name);
    }
  if (host === "nitro" && pkg.dependencies["lucent-native"] !== NITRO_LINK) {
    pkg.dependencies["lucent-native"] = NITRO_LINK;
    added.push("lucent-native");
  }
  if (!added.length) return { file: "package.json", action: "kept", detail: "already lists the Lucent packages" };
  writeJson(join(root, "package.json"), pkg);
  return { file: "package.json", action: "updated", detail: `added ${added.join(", ")}` };
};

const writeConfig: Step = (root) => {
  const existing = CONFIG_FILES.find((f) => existsSync(join(root, f)));
  if (existing) return { file: existing, action: "kept", detail: "already exists" };
  writeFileSync(join(root, "lucent.config.ts"), CONFIG);
  return { file: "lucent.config.ts", action: "wrote", detail: "declare capabilities and libraries here" };
};

const writeStarter: Step = (root) => {
  const existing = findLucentFiles(root);
  if (existing.length)
    return {
      file: "src/math.lucent.ts",
      action: "kept",
      detail: `project already has ${existing.length} Lucent file(s)`,
    };
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "math.lucent.ts"), STARTER);
  return { file: "src/math.lucent.ts", action: "wrote", detail: "a starter module to import from JavaScript" };
};

const wireMetro: Step = (root, host) => {
  const existing = METRO_FILES.find((f) => existsSync(join(root, f)));
  if (!existing) {
    writeFileSync(join(root, "metro.config.js"), METRO_CONFIG[host]);
    return { file: "metro.config.js", action: "wrote", detail: "wraps the default config with withLucent" };
  }
  if (readFileSync(join(root, existing), "utf8").includes("withLucent"))
    return { file: existing, action: "kept", detail: "already wired with withLucent" };
  return {
    file: existing,
    action: "kept",
    detail: "exists but does not call withLucent",
    hint: `Wrap the exported config: module.exports = withLucent(config, { host: "${host}" }) with withLucent from @lucent-lang/core/metro.`,
  };
};

const hasExpoPlugin = (plugins: unknown[]): boolean =>
  plugins.some((p) => p === EXPO_PLUGIN || (Array.isArray(p) && p[0] === EXPO_PLUGIN));

const wireExpo: Step = (root, host) => {
  const path = join(root, "app.json");
  const hint = `Add ["${EXPO_PLUGIN}", { "host": "${host}" }] to expo.plugins so prebuild compiles your modules.`;
  if (!existsSync(path)) {
    const dynamic = ["app.config.js", "app.config.ts"].find((f) => existsSync(join(root, f)));
    return {
      file: dynamic ?? "app.json",
      action: "kept",
      detail: dynamic ? "cannot edit a dynamic config" : "not found",
      hint,
    };
  }
  const app = JSON.parse(readFileSync(path, "utf8")) as { expo?: { plugins?: unknown[] } };
  app.expo ??= {};
  app.expo.plugins ??= [];
  if (hasExpoPlugin(app.expo.plugins))
    return { file: "app.json", action: "kept", detail: `already has the ${EXPO_PLUGIN} plugin` };
  app.expo.plugins.push([EXPO_PLUGIN, { host }]);
  writeJson(path, app);
  return { file: "app.json", action: "updated", detail: `added the ${EXPO_PLUGIN} plugin` };
};

const wireNitro: Step = (root) => {
  const path = join(root, "react-native.config.js");
  if (!existsSync(path)) {
    writeFileSync(path, RN_CONFIG);
    return { file: "react-native.config.js", action: "wrote", detail: "autolinks the generated lucent-native package" };
  }
  if (readFileSync(path, "utf8").includes("lucent-native"))
    return { file: "react-native.config.js", action: "kept", detail: "already links lucent-native" };
  return {
    file: "react-native.config.js",
    action: "kept",
    detail: "exists but does not link lucent-native",
    hint: 'Add dependencies: { "lucent-native": { root: path.join(__dirname, ".lucent", "nitro") } }.',
  };
};

const STEPS: Readonly<Record<HostName, readonly Step[]>> = {
  expo: [addDependencies, writeConfig, writeStarter, wireMetro, wireExpo],
  nitro: [addDependencies, writeConfig, writeStarter, wireMetro, wireNitro],
};

async function chooseHost(
  ctx: CommandContext,
  explicit: string | undefined,
  yes: boolean,
  pkg: PackageJson,
): Promise<HostName> {
  if (explicit === "expo" || explicit === "nitro") return explicit;
  const detected = detectHost(pkg);
  if (detected) {
    ctx.ui.hint(`Detected ${HOST_LABELS[detected]} from package.json.`);
    return detected;
  }
  if (yes) {
    ctx.ui.hint("No host detected in package.json; defaulting to expo.");
    return "expo";
  }
  if (ctx.io.isTTY && ctx.io.stdin?.isTTY)
    return select(
      ctx.io,
      "Which host should Lucent target?",
      [
        { value: "expo", label: "Expo Modules", hint: "Expo SDK 58 apps" },
        { value: "nitro", label: "Nitro Modules", hint: "bare React Native" },
      ],
      ctx.ui.palette,
    );
  throw new CliError("Could not detect the host from package.json.", {
    hint: "Pass --host expo or --host nitro, or --yes to default to expo.",
  });
}

export const initCommand = defineCommand({
  name: "init",
  glyph: "init",
  summary: "Wire an Expo or bare React Native app for Lucent",
  usage: "[options]",
  options: {
    host: HOST_OPTION,
    yes: { type: "boolean", short: "y", description: "Accept defaults instead of prompting" },
  },
  examples: [
    { command: "lucent init", note: "Detect the host and wire the app in the current directory" },
    { command: "lucent init --host nitro --yes", note: "Non-interactive setup for a bare React Native app" },
  ],
  async run(ctx, values) {
    const { ui, root, io } = ctx;
    const p = ui.palette;
    const pkg = readPackageJson(root);
    if (!pkg)
      throw new CliError("No package.json here.", {
        hint: "Run lucent init from the root of your React Native or Expo app.",
      });
    const host = await chooseHost(ctx, values.host, values.yes ?? false, pkg);
    const changes = STEPS[host].map((step) => step(root, host, pkg));
    const manager = PACKAGE_MANAGERS[detectPackageManager({ root, env: io.env })];
    const next = NEXT[host](manager);
    if (ui.json) {
      ui.data({ host, changes, next });
      return 0;
    }
    ui.heading("init", `lucent init ${p.dim(`(${host} · ${HOST_LABELS[host]})`)}`);
    ui.line();
    for (const change of changes) {
      ui.step(ACTION_GLYPH[change.action], `${p.bold(change.file)} ${p.dim(`${change.action}, ${change.detail}`)}`);
      if (change.hint) ui.hint(change.hint);
    }
    ui.line();
    ui.heading("rocket", "Next steps");
    ui.rows(next.map((step, i) => [p.dim(`${i + 1}.`), p.cyan(step)]));
    return 0;
  },
});
