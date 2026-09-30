import fs from "node:fs";
import path from "node:path";
import {
  type Diagnostic,
  LUCENT_EXTENSION,
  lucentPackages,
  moduleNameOf,
  platformOf,
} from "@lucent-lang/compiler";
import type { PendingAction } from "../build-graph.ts";
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
  lastBuild?: {
    at: Date;
    ms: number;
    ok: boolean;
    next?: Next;
    /** What the build's changes need from the app. */
    actions?: PendingAction[];
    fatal?: string;
  };
  problems: Problem[];
  notices?: Notice[];
}

export interface Store<T> {
  get(): T;
  set(next: T): void;
  subscribe(listener: () => void): () => void;
}

export function createStore(
  initial: DevState = { building: false, watching: [], modules: [], problems: [] },
): Store<DevState> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(next) {
      state = next;
      // oxlint-disable-next-line unicorn/no-useless-spread -- a listener may unsubscribe while notified
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

/** Files a build may read whatever the last one did: new modules, package manifests, lucent.json. */
const ALWAYS_READ = (file: string) =>
  LUCENT_EXTENSION.test(file) || ["lucent.json", "package.json"].includes(path.basename(file));

/**
 * Watches the project and its Lucent packages (those outside it too, linked
 * or in the workspace), and builds, one build at a time, on every change
 * to a file a build reads: modules, package manifests and lucent.json, and
 * the native files packages list. What builds write is never read, so they
 * never trigger one. A change during a build supersedes it: it stops before
 * publishing, and the next build starts. `store` holds the state for the
 * views.
 */
export function startSession(root: string): DevSession {
  const store = createStore();
  const theme = createTheme({
    color: false,
    interactive: false,
    unicode: true,
    links: false,
    width: 80,
  });
  let building: AbortController | undefined;
  let queued: { force: boolean } | undefined;
  let timer: NodeJS.Timeout | undefined;
  // What the last build read of Lucent packages: their lucent.json and listed native paths.
  let nativeInputs: string[] = [];
  let stopped = false;
  // When the last build that published started: it read every input as it was then.
  let readSince = 0;

  const build = async (force: boolean) => {
    if (stopped) return;

    if (building) {
      // The running build's analysis is stale: it stops before publishing.
      building.abort();
      queued = { force: force || !!queued?.force };
      return;
    }
    const controller = new AbortController();
    const started = Date.now();
    building = controller;
    store.set({
      ...store.get(),
      building: true,
      modules: store.get().modules.map((m) => ({
        ...m,
        platforms: mapPlatforms(m.platforms, (s) => (s === "none" ? s : "building")),
      })),
    });
    // Let the views show the build before it blocks the event loop.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const notices: Notice[] = [];
    const at = new Date();
    const r = await buildProject(
      root,
      { mode: "build", force, signal: controller.signal },
      plainSteps(() => {}, theme),
      (n) => notices.push(n),
    );

    if (r.superseded) {
      building = undefined;
      const again = queued ?? { force };
      queued = undefined;
      void build(again.force);
      return;
    }

    nativeInputs = r.nativeInputs;
    readSince = started;
    watch();
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
      if (!sources.has(file))
        sources.set(
          file,
          fs.existsSync(path.resolve(root, file))
            ? fs.readFileSync(path.resolve(root, file), "utf8")
            : undefined,
        );
      return sources.get(file);
    };
    store.set({
      ...store.get(),
      building: false,
      modules: r.modules.map((m) => {
        const has = (p: Platform) => m.platforms.includes(p) || m.platforms.includes("shared");
        const state = (p: Platform): PlatformState =>
          !has(p) ? "none" : failing.get(m.name)?.has(p) ? "error" : r.ok ? "ok" : "none";
        return { name: m.name, platforms: { ios: state("ios"), android: state("android") } };
      }),
      lastBuild: {
        at,
        ms: r.ms,
        ok: r.ok,
        next: r.ok && !r.upToDate ? r.next : undefined,
        actions: r.actions,
        fatal: r.fatal,
      },
      problems: [...r.diagnostics, ...r.warnings].map((d) => ({
        ...d,
        source: d.file ? source(d.file) : undefined,
      })),
      notices,
    });
    building = undefined;
    if (queued) {
      const again = queued;
      queued = undefined;
      void build(again.force);
    }
  };

  const relevant = (file: string, dir: string) => {
    const parts = path.relative(dir, file).split(path.sep);

    // Dependencies, and dot directories (.lucent, where builds write; .git).
    if (parts.some((part) => part === "node_modules" || part.startsWith("."))) return false;

    return (
      ALWAYS_READ(file) ||
      nativeInputs.some((p) => file === p || file.startsWith(`${p}${path.sep}`))
    );
  };

  const changed = (dir: string, name: string | null) => {
    if (!name || !relevant(path.join(dir, name), dir)) return;

    // A file last changed before the last build started is what that build read
    // (a watcher's first events can report files written before it started).
    const file = path.join(dir, name);
    if (fs.existsSync(file) && fs.statSync(file).mtimeMs < readSince) return;

    clearTimeout(timer);
    timer = setTimeout(() => void build(false), DEBOUNCE_MS);
  };

  // The app, and each Lucent package that lives outside it (workspaces, links), whole:
  // its modules, lucent.json and native files. Updated after each build.
  const watchers = new Map<string, fs.FSWatcher>();

  const watch = () => {
    if (stopped) return;

    let packages: string[] = [];
    try {
      packages = lucentPackages(root)
        .map((p) => p.dir)
        .filter((dir) => path.relative(root, dir).startsWith(".."));
    } catch {
      // The build reports it.
    }

    const dirs = new Set([root, ...packages]);

    for (const [dir, w] of watchers)
      if (!dirs.has(dir)) {
        w.close();
        watchers.delete(dir);
      }

    for (const dir of dirs)
      if (!watchers.has(dir))
        watchers.set(
          dir,
          fs.watch(dir, { recursive: true }, (_event, name) => changed(dir, name)),
        );

    store.set({ ...store.get(), watching: [...dirs].map((d) => path.relative(root, d) || ".") });
  };

  watch();
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
      stopped = true;
      clearTimeout(timer);
      building?.abort();
      for (const w of watchers.values()) w.close();
    },
  };
}

function mapPlatforms(
  p: Record<Platform, PlatformState>,
  f: (s: PlatformState) => PlatformState,
): Record<Platform, PlatformState> {
  return { ios: f(p.ios), android: f(p.android) };
}
