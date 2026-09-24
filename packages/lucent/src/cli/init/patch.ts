import { createRequire } from "node:module";
import { packageFile } from "../version.ts";

// The Expo config plugin applies the same Gradle line during prebuild: one
// definition, found from the package's root (the sources and dist/ sit at
// different depths).
const plugin = createRequire(import.meta.url)(packageFile("app.plugin.js")) as { GRADLE_LINE: string; applyGradleTask(text: string): string | undefined };

export const GRADLE_LINE = plugin.GRADLE_LINE;
export const applyGradleTask = plugin.applyGradleTask;

const METRO_REQUIRE = 'const { withLucent } = require("@lucent-lang/lucent/metro");';

/** metro.config.js for an app that has none. */
export function metroConfig(expo: boolean): string {
  return expo
    ? `const { getDefaultConfig } = require("expo/metro-config");\n${METRO_REQUIRE}\n\nmodule.exports = withLucent(getDefaultConfig(__dirname));\n`
    : `const { getDefaultConfig, mergeConfig } = require("@react-native/metro-config");\n${METRO_REQUIRE}\n\nmodule.exports = withLucent(mergeConfig(getDefaultConfig(__dirname), {}));\n`;
}

/**
 * The Metro config with its export wrapped in withLucent: undefined when it
 * is already, "manual" when there is no `module.exports = …` to wrap.
 */
export function wrapMetro(text: string): string | "manual" | undefined {
  if (text.includes("@lucent-lang/lucent/metro") && /withLucent\(/.test(text)) return undefined;
  const m = /^module\.exports\s*=\s*([\s\S]+?);?\s*$/m.exec(text);
  if (!m || text.slice(m.index + m[0].length).trim()) return "manual";
  const wrapped = `${text.slice(0, m.index)}module.exports = withLucent(${m[1]!.trim()});\n`;
  // The require goes after the file's last require, or first.
  const lines = wrapped.split("\n");
  const lastRequire = lines.reduce((at, l, i) => (/^(const|let|var) .*=\s*require\(/.test(l) ? i : at), -1);
  lines.splice(lastRequire + 1, 0, METRO_REQUIRE);
  return lines.join("\n");
}

/** app.json with the Lucent config plugin, or undefined when it has it. Keeps the file's indentation. */
export function addExpoPlugin(text: string): string | undefined {
  const json = JSON.parse(text) as { expo?: { plugins?: unknown[] }; plugins?: unknown[] };
  const target = (json.expo ?? json) as { plugins?: unknown[] };
  const plugins = target.plugins ?? [];
  if (plugins.some((p) => p === "@lucent-lang/lucent" || (Array.isArray(p) && p[0] === "@lucent-lang/lucent"))) return undefined;
  target.plugins = [...plugins, "@lucent-lang/lucent"];
  const indent = /^[ \t]+(?=")/m.exec(text)?.[0] ?? "  ";
  return `${JSON.stringify(json, null, indent)}\n`;
}

const RN_ENTRY = `"lucent": { root: require("path").join(__dirname, ".lucent", "native") }`;

/** react-native.config.js linking .lucent/native, or undefined when it does; "manual" when it exists without a place to add it. */
export function linkNativePackage(text: string | undefined): string | "manual" | undefined {
  if (text === undefined) return `module.exports = {\n  dependencies: {\n    ${RN_ENTRY},\n  },\n};\n`;
  if (text.includes('"lucent-native"')) return text.replace('"lucent-native"', '"lucent"');
  if (/["']?lucent["']?\s*:\s*\{\s*root:/.test(text)) return undefined;
  const deps = /dependencies\s*:\s*\{/.exec(text);
  if (!deps) return "manual";
  const at = deps.index + deps[0].length;
  return `${text.slice(0, at)}\n    ${RN_ENTRY},${text.slice(at)}`;
}

export const RN_CONFIG_SNIPPET = `module.exports = {\n  dependencies: {\n    ${RN_ENTRY},\n  },\n};`;

/** .gitignore ignoring .lucent/, or undefined when it does. */
export function ignoreNativePackage(text: string | undefined): string | undefined {
  const current = text ?? "";
  if (current.split("\n").some((l) => l.trim() === ".lucent/" || l.trim() === ".lucent" || l.trim() === "/.lucent")) return undefined;
  return `${current}${current && !current.endsWith("\n") ? "\n" : ""}# Lucent's generated native package\n.lucent/\n`;
}

/** The module init scaffolds in a project without one. */
export const HELLO = `// A Lucent module: this runs as C++, and JavaScript calls it like any function:
//
//   import { hello } from "./src/hello.lucent";
//   hello("Ada"); // "Hello, Ada, from native code"
export function hello(name: string): string {
  return \`Hello, \${name}, from native code\`;
}
`;
