import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { HostName } from "./index.ts";

export interface PackageJson {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  [key: string]: unknown;
}

export function readPackageJson(root: string): PackageJson | null {
  const path = join(root, "package.json");
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as PackageJson) : null;
}

export const hasDependency = (pkg: PackageJson | null, name: string): boolean =>
  Boolean(pkg?.dependencies?.[name] ?? pkg?.devDependencies?.[name]);

/** A dependency that identifies each host, most specific first. */
const HOST_SIGNATURES: readonly (readonly [HostName, string])[] = [
  ["nitro", "react-native-nitro-modules"],
  ["expo", "expo"],
];

export function detectHost(pkg: PackageJson | null): HostName | null {
  return HOST_SIGNATURES.find(([, dependency]) => hasDependency(pkg, dependency))?.[0] ?? null;
}

export type PackageManagerName = "npm" | "pnpm" | "yarn" | "bun";

export interface PackageManager {
  readonly install: string;
  readonly exec: string;
  add(packages: readonly string[], dev: boolean): string;
}

const manager = (install: string, exec: string, add: string, devFlag: string): PackageManager => ({
  install,
  exec,
  add: (packages, dev) => [add, ...(dev ? [devFlag] : []), ...packages].join(" "),
});

export const PACKAGE_MANAGERS: Readonly<Record<PackageManagerName, PackageManager>> = {
  npm: manager("npm install", "npx", "npm install", "-D"),
  pnpm: manager("pnpm install", "pnpm exec", "pnpm add", "-D"),
  yarn: manager("yarn", "yarn", "yarn add", "-D"),
  bun: manager("bun install", "bunx", "bun add", "-d"),
};

const LOCKFILES: readonly (readonly [string, PackageManagerName])[] = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["package-lock.json", "npm"],
];

const isManager = (name: string): name is PackageManagerName => name in PACKAGE_MANAGERS;

/** The lockfile decides; otherwise whatever launched us; otherwise npm. */
export function detectPackageManager(input: {
  root: string;
  env: Readonly<Record<string, string | undefined>>;
}): PackageManagerName {
  const lock = LOCKFILES.find(([file]) => existsSync(join(input.root, file)));
  if (lock) return lock[1];
  const agent = input.env.npm_config_user_agent?.split("/")[0] ?? "";
  return isManager(agent) ? agent : "npm";
}
