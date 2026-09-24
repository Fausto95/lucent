import fs from "node:fs";
import path from "node:path";
import { type Diagnostic, LUCENT_EXTENSION, lucentPackages, moduleNameOf, platformOf } from "@lucent-lang/compiler";
import { buildProject, type Next, type Platform } from "../pipeline.ts";
import type { Notice } from "../project.ts";
import { plainSteps } from "../ui/steps.ts";
import { createTheme } from "../ui/theme.ts";

export type PlatformState = "ok" | "error" | "building" | "none";

/** A problem of the last build, with its file's text for the code frame. */
export type Problem = Diagnostic & { source?: string };

export interface DevState {
  building: boolean;
  /** Directories watched, relative to the project. */
  watching: string[];
  modules: { name: string; platforms: Record<Platform, PlatformState> }[];
  lastBuild?: { at: Date; ms: number; ok: boolean; next?: Next; fatal?: string };
  problems: Problem[];
  notices?: Notice[];
}

export interface Store<T> {
  get(): T;
  set(next: T): void;
  subscribe(listener: () => void): () => void;
}

export function createStore(initial: DevState = { building: false, watching: [], modules: [], problems: [] }): Store<DevState> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(next) {
      state = next;
      for (const l of [...listeners]) l();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export interface DevSession {
  store: Store<DevState>;
  /** Builds again (forced: even when nothing changed). */
  rebuild(): void;
  /** Forgets the build's record of its inputs, then builds everything again. */
  clearCache(): void;
  stop(): void;
}

// Coalesces an editor's burst of writes (save, format on save) into one build.
const DEBOUNCE_MS = 40;

/**
 * Watches the project and its Lucent packages, and builds on every change
 * to a *.lucent.ts file, one build at a time; `store` holds the state for
 * the views.
 */
export function startSession(root: string): DevSession {
  const store = createStore();
  const theme = createTheme({ color: false, interactive: false, unicode: true, links: false, width: 80 });
  let building = false;
  let queued: { force: boolean } | undefined;
  let timer: NodeJS.Timeout | undefined;

  const build = async (force: boolean) => {
    if (building) {
      queued = { force: force || !!queued?.force };
      return;
    }
    building = true;
    store.set({ ...store.get(), building: true, modules: store.get().modules.map((m) => ({ ...m, platforms: mapPlatforms(m.platforms, (s) => (s === "none" ? s : "building")) })) });
    // Let the views show the build before it blocks the event loop.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const notices: Notice[] = [];
    const at = new Date();
    const r = await buildProject(root, { mode: "build", force }, plainSteps(() => {}, theme), (n) => notices.push(n));
    const failing = new Map<string, Set<Platform>>();
    for (const d of r.diagnostics) {
      if (!d.file) continue;
      const name = moduleNameOf(path.resolve(root, d.file));
      const p = platformOf(d.file);
      const set = failing.get(name) ?? new Set();
      for (const q of p ? [p] : (["ios", "android"] as const)) set.add(q);
      failing.set(name, set);
    }
    const sources = new Map<string, string | undefined>();
    const source = (file: string) => {
      if (!sources.has(file)) sources.set(file, fs.existsSync(path.resolve(root, file)) ? fs.readFileSync(path.resolve(root, file), "utf8") : undefined);
      return sources.get(file);
    };
    store.set({
      ...store.get(),
      building: false,
      modules: r.modules.map((m) => {
        const has = (p: Platform) => m.platforms.includes(p) || m.platforms.includes("shared");
        const state = (p: Platform): PlatformState => (!has(p) ? "none" : failing.get(m.name)?.has(p) ? "error" : r.ok ? "ok" : "none");
        return { name: m.name, platforms: { ios: state("ios"), android: state("android") } };
      }),
      lastBuild: { at, ms: r.ms, ok: r.ok, next: r.ok && !r.upToDate ? r.next : undefined, fatal: r.fatal },
      problems: r.diagnostics.map((d) => ({ ...d, source: d.file ? source(d.file) : undefined })),
      notices,
    });
    building = false;
    if (queued) {
      const again = queued;
      queued = undefined;
      void build(again.force);
    }
  };

  const changed = (name: string | null) => {
    if (!name || !LUCENT_EXTENSION.test(name) || name.split(path.sep).some((part) => part === "node_modules" || part.startsWith("."))) return;
    clearTimeout(timer);
    timer = setTimeout(() => void build(false), DEBOUNCE_MS);
  };
  // The app, and Lucent packages that live outside it (workspaces).
  let packages: string[] = [];
  try {
    packages = lucentPackages(root).map((p) => p.sources).filter((dir) => path.relative(root, dir).startsWith(".."));
  } catch {
    // The build reports it.
  }
  const watchers = [root, ...packages].map((dir) => fs.watch(dir, { recursive: true }, (_event, name) => changed(name)));
  store.set({ ...store.get(), watching: [root, ...packages].map((d) => path.relative(root, d) || ".") });
  void build(false);

  return {
    store,
    rebuild: () => void build(true),
    clearCache() {
      fs.rmSync(path.join(root, ".lucent/native/manifest.json"), { force: true });
      fs.rmSync(path.join(root, ".lucent/check.json"), { force: true });
      void build(true);
    },
    stop() {
      clearTimeout(timer);
      for (const w of watchers) w.close();
    },
  };
}

function mapPlatforms(p: Record<Platform, PlatformState>, f: (s: PlatformState) => PlatformState): Record<Platform, PlatformState> {
  return { ios: f(p.ios), android: f(p.android) };
}
