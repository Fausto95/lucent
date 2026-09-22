import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadLucentConfig, type LucentConfig } from "@lucent-lang/host-core";
import { analyzeFile } from "../analyze.ts";
import type { GlyphName } from "../emoji.ts";
import { findLucentFiles, type HostName } from "../index.ts";
import { detectHost, detectPackageManager, hasDependency, readPackageJson, type PackageJson } from "../project.ts";
import { count, type UI } from "../ui.ts";
import { HOST_LABELS, HOST_OPTION } from "./shared.ts";
import { defineCommand, type CommandContext } from "./types.ts";

type Status = "ok" | "warn" | "fail" | "skip";

interface CheckResult {
  name: string;
  status: Status;
  detail: string;
  hint?: string;
}

const STATUS_GLYPH: Readonly<Record<Status, GlyphName>> = { ok: "ok", warn: "warn", fail: "fail", skip: "skip" };

const MIN_NODE = [22, 12] as const;

interface Tool {
  name: string;
  args: readonly string[];
  required: boolean;
  hint: string;
}

const TOOLS: readonly Tool[] = [
  { name: "swiftc", args: ["--version"], required: true, hint: "Install Xcode, then run: xcode-select --install" },
  { name: "kotlinc", args: ["-version"], required: true, hint: "brew install kotlin" },
  {
    name: "xcodebuild",
    args: ["-version"],
    required: false,
    hint: "Install Xcode from the App Store to build for iOS",
  },
  { name: "java", args: ["-version"], required: false, hint: "Install a JDK; Android Studio bundles one" },
  { name: "adb", args: ["--version"], required: false, hint: "Install the Android platform tools from Android Studio" },
  { name: "pod", args: ["--version"], required: false, hint: "gem install cocoapods (iOS on bare React Native)" },
];

function toolchain(ctx: CommandContext): CheckResult[] {
  const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
  const nodeOk = major > MIN_NODE[0] || (major === MIN_NODE[0] && minor >= MIN_NODE[1]);
  const results: CheckResult[] = [
    {
      name: "node",
      status: nodeOk ? "ok" : "fail",
      detail: `v${process.versions.node}`,
      ...(nodeOk ? {} : { hint: `Lucent needs Node ${MIN_NODE.join(".")} or newer` }),
    },
    { name: "package manager", status: "ok", detail: detectPackageManager({ root: ctx.root, env: ctx.io.env }) },
  ];
  for (const tool of TOOLS) {
    const result = ctx.io.exec(tool.name, tool.args);
    results.push(
      result.status === 0
        ? { name: tool.name, status: "ok", detail: result.output }
        : {
            name: tool.name,
            status: tool.required ? "fail" : "skip",
            detail: tool.required ? "not found" : "not found (optional)",
            hint: tool.hint,
          },
    );
  }
  return results;
}

interface Project {
  root: string;
  pkg: PackageJson | null;
  host: HostName | null;
  files: string[];
  config: LucentConfig | null;
  configError: string | null;
}

/** null means "does not apply to this project". */
type ProjectCheck = (project: Project) => CheckResult | null;

const dependency =
  (name: string, missing: "fail" | "warn", why: string): ProjectCheck =>
  ({ pkg }) =>
    hasDependency(pkg, name)
      ? { name, status: "ok", detail: pkg?.dependencies?.[name] ?? pkg?.devDependencies?.[name] ?? "" }
      : { name, status: missing, detail: "not in package.json", hint: `${why}; lucent init adds it` };

const forHost =
  (host: HostName, check: ProjectCheck): ProjectCheck =>
  (project) =>
    project.host === host ? check(project) : null;

const METRO_FILES = ["metro.config.js", "metro.config.cjs", "metro.config.mjs", "metro.config.ts"];

const metroConfig: ProjectCheck = ({ root, host }) => {
  const file = METRO_FILES.find((f) => existsSync(join(root, f)));
  if (!file)
    return {
      name: "metro config",
      status: "fail",
      detail: "no metro.config.js",
      hint: "lucent init writes one, or wrap yours with withLucent from @lucent-lang/core/metro",
    };
  if (readFileSync(join(root, file), "utf8").includes("withLucent"))
    return { name: "metro config", status: "ok", detail: `${file} uses withLucent` };
  return {
    name: "metro config",
    status: "fail",
    detail: `${file} does not call withLucent`,
    hint: `module.exports = withLucent(config, { host: "${host ?? "expo"}" })`,
  };
};

const expoPlugin: ProjectCheck = ({ root }) => {
  const path = join(root, "app.json");
  const hint = 'Add ["@lucent-lang/core/expo", { "host": "expo" }] to expo.plugins; lucent init does this';
  if (!existsSync(path)) {
    const dynamic = ["app.config.js", "app.config.ts"].find((f) => existsSync(join(root, f)));
    return dynamic
      ? { name: "expo plugin", status: "warn", detail: `cannot inspect ${dynamic}`, hint }
      : { name: "expo plugin", status: "fail", detail: "no app.json", hint };
  }
  const app = JSON.parse(readFileSync(path, "utf8")) as { expo?: { plugins?: unknown[] } };
  const plugins = app.expo?.plugins ?? [];
  const wired = plugins.some((p) =>
    ["@lucent-lang/core/expo"].includes(typeof p === "string" ? p : Array.isArray(p) ? String(p[0]) : ""),
  );
  return wired
    ? { name: "expo plugin", status: "ok", detail: "app.json lists @lucent-lang/core/expo" }
    : { name: "expo plugin", status: "fail", detail: "app.json is missing @lucent-lang/core/expo", hint };
};

const nitroLink: ProjectCheck = ({ root }) => {
  const path = join(root, "react-native.config.js");
  const hint =
    'dependencies: { "lucent-native": { root: path.join(__dirname, ".lucent", "nitro") } }; lucent init writes it';
  if (!existsSync(path)) return { name: "react-native.config.js", status: "fail", detail: "not found", hint };
  return readFileSync(path, "utf8").includes("lucent-native")
    ? { name: "react-native.config.js", status: "ok", detail: "links lucent-native" }
    : { name: "react-native.config.js", status: "fail", detail: "does not link lucent-native", hint };
};

const lucentConfig: ProjectCheck = ({ root, config, configError }) => {
  if (!config)
    return {
      name: "lucent config",
      status: "fail",
      detail: configError ?? "invalid",
      hint: "Fix lucent.config.ts and run again",
    };
  const file = ["lucent.config.ts", "lucent.config.json"].find((f) => existsSync(join(root, f)));
  const n = config.capabilities.length;
  const capabilities = `${n} ${n === 1 ? "capability" : "capabilities"}`;
  return {
    name: "lucent config",
    status: "ok",
    detail: file ? `${file}, ${capabilities}` : "no config file, using defaults",
  };
};

const capabilities: ProjectCheck = ({ root, files, config }) => {
  if (!files.length || !config) return null;
  const reports = files.map((file) => analyzeFile(root, file, config));
  const missing = [...new Set(reports.flatMap((r) => r.missingCapabilities))].toSorted();
  if (missing.length)
    return {
      name: "capabilities",
      status: "fail",
      detail: `missing ${missing.join(", ")}`,
      hint: `Declare them in lucent.config.ts: capabilities: { ${missing.map((m) => `${m}: true`).join(", ")} }`,
    };
  const broken = reports.filter((r) => r.module === null || r.diagnostics.some((d) => d.severity !== "warning")).length;
  if (broken)
    return {
      name: "capabilities",
      status: "warn",
      detail: `${count(broken, "file")} with compile errors`,
      hint: "Run lucent check for details",
    };
  return { name: "capabilities", status: "ok", detail: "every required capability is declared" };
};

const PROJECT_CHECKS: readonly ProjectCheck[] = [
  ({ pkg }) =>
    pkg
      ? { name: "package.json", status: "ok", detail: pkg.name ?? "(unnamed)" }
      : { name: "package.json", status: "fail", detail: "not found", hint: "Run lucent doctor from the app root" },
  ({ host }) =>
    host
      ? { name: "host", status: "ok", detail: `${host} (${HOST_LABELS[host]})` }
      : {
          name: "host",
          status: "warn",
          detail: "not detected",
          hint: "Install expo or react-native-nitro-modules, then run lucent init",
        },
  dependency("@lucent-lang/core", "fail", "Lucent authoring types, runtime and build integrations"),
  metroConfig,
  forHost("expo", expoPlugin),
  forHost("nitro", dependency("nitrogen", "fail", "Nitro generates its bindings with nitrogen")),
  forHost("nitro", nitroLink),
  lucentConfig,
  ({ files }) => ({
    name: "Lucent files",
    status: files.length ? "ok" : "warn",
    detail: count(files.length, "Lucent file"),
    ...(files.length ? {} : { hint: "Run lucent init to add a starter module" }),
  }),
  capabilities,
];

function section(ui: UI, title: string, results: readonly CheckResult[]): void {
  const p = ui.palette;
  const paint: Readonly<Record<Status, (text: string) => string>> = {
    ok: p.dim,
    warn: p.yellow,
    fail: p.red,
    skip: p.dim,
  };
  ui.line();
  ui.line(p.bold(title));
  ui.rows(
    results.flatMap((r) => [
      [`${ui.glyph(STATUS_GLYPH[r.status])} ${r.name}`, paint[r.status](r.detail)],
      ...(r.hint && r.status !== "ok" ? [["", `${ui.glyph("info")} ${p.dim(r.hint)}`]] : []),
    ]),
  );
}

export const doctorCommand = defineCommand({
  name: "doctor",
  glyph: "doctor",
  summary: "Check the native toolchain and the project's Lucent wiring",
  usage: "[options]",
  options: { host: HOST_OPTION },
  examples: [
    { command: "lucent doctor", note: "Everything Lucent needs, with fixes for what is missing" },
    { command: "lucent doctor --json", note: "The same report for scripts" },
  ],
  async run(ctx, values) {
    const { ui, root } = ctx;
    const p = ui.palette;
    const pkg = readPackageJson(root);
    const host = values.host === "expo" || values.host === "nitro" ? values.host : detectHost(pkg);
    const project: Project = { root, pkg, host, files: findLucentFiles(root), config: null, configError: null };
    try {
      project.config = loadLucentConfig(root);
    } catch (error) {
      project.configError = error instanceof Error ? error.message : String(error);
    }
    const tools = toolchain(ctx);
    const checks = PROJECT_CHECKS.map((check) => check(project)).filter((c): c is CheckResult => c !== null);
    const all = [...tools, ...checks];
    const failures = all.filter((c) => c.status === "fail").length;
    const warnings = all.filter((c) => c.status === "warn").length;
    if (ui.json) {
      ui.data({ ok: failures === 0, host, toolchain: tools, project: checks });
      return failures ? 1 : 0;
    }
    ui.heading("doctor", "lucent doctor");
    section(ui, "Toolchain", tools);
    section(ui, `Project ${p.dim(`(${host ?? "host not detected"})`)}`, checks);
    ui.line();
    const warningTally = warnings ? `, ${count(warnings, "warning")}` : "";
    if (failures) ui.fail(`${count(failures, "problem")}${warningTally}. Fix the items marked above and run again.`);
    else if (warnings) ui.warn(`No blockers${warningTally}.`);
    else ui.ok(`Everything looks good. ${p.dim("Happy compiling!")}`);
    return failures ? 1 : 0;
  },
});
