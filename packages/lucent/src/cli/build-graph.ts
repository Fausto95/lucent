/**
 * The build as a graph of recorded steps: what each consumed and produced,
 * with content hashes, so a build can be inspected and compared after the
 * fact (`.lucent/build-record.json`).
 *
 * Identities are portable: paths are relative to the project and hashes
 * cover content, never machine-specific locations. Timings live apart from
 * the nodes, so two builds of the same inputs write the same nodes.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const BUILD_RECORD_SCHEMA_VERSION = 1;

export type NodeKind =
  | "resolve"
  | "extract"
  | "check"
  | "generate"
  | "native-build"
  | "install"
  | "reload";

export type NodeStatus = "ok" | "cached" | "failed" | "skipped";

/**
 * The steps a build reuses when their inputs are unchanged (recorded
 * "cached"); with a `:` suffix, steps of that one (`extract:UIKit`). The
 * others run every build: resolving computes what these are reused by.
 */
export const REUSABLE_STEPS = ["resolve:android", "extract", "check", "generate"] as const;

export const reusable = (id: string) =>
  REUSABLE_STEPS.some((step) => id === step || id.startsWith(`${step}:`));

/** One input or output: a project-relative path or a named key, and its content hash. */
export interface Artifact {
  key: string;
  hash: string;
}

export interface BuildNode {
  /** Unique within a record: `check`, `extract:ios/UIKit`. */
  id: string;
  kind: NodeKind;
  status: NodeStatus;
  inputs: Artifact[];
  outputs: Artifact[];
  /** Hash of the kind, inputs and outputs: equal nodes did the same work. */
  hash: string;
  detail?: string;
  /** Where the step's full output was written, relative to the project. */
  log?: string;
}

/** What the app needs after this build, derived from what changed. */
export type RequiredAction =
  | { kind: "none" }
  | { kind: "reload-js" }
  | { kind: "compile-native"; targets: string[]; changedUnits: string[] }
  | { kind: "relink"; targets: string[]; dependencyChanges: string[] };

/** What the app needs for a change, strongest first. */
export const ACTION_KINDS = [
  // The app's configuration (Info.plist, entitlements, manifest) changed: build and install it again.
  "reinstall",
  // Native dependencies or build files changed (pod install first on iOS).
  "relink",
  // Native code changed: rebuild the app, which restarts it.
  "compile-native",
  // Resources or assets changed: rebuild the app's bundle.
  "repackage",
  // Only JavaScript proxies changed: reload.
  "reload-js",
] as const;

export type ActionKind = (typeof ACTION_KINDS)[number];

/** One thing the app needs after a build, on which targets, because of which files (native-package paths). */
export interface PendingAction {
  kind: ActionKind;
  targets: string[];
  files: string[];
}

export interface BuildRecord {
  schemaVersion: typeof BUILD_RECORD_SCHEMA_VERSION;
  mode: "build" | "check";
  nodes: BuildNode[];
  requiredAction: RequiredAction;
  /** Every action the build's changes need, by kind (strongest first); none when nothing changed. */
  pendingActions: PendingAction[];
  /** Milliseconds per node id; excluded from node hashes. */
  timings: Record<string, number>;
  /** When each timed node started, in milliseconds from the build's start (`lucent trace` lays them out). */
  startedAt: Record<string, number>;
}

export function contentHash(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex").slice(0, 16);
}

/** A file's path as artifacts key it: relative to `root`, with `/`. */
export function projectPath(root: string, file: string): string {
  return path.relative(root, path.resolve(file)).split(path.sep).join("/");
}

/** A file as an artifact: its path relative to `root` (with `/`), and its content's hash. */
export function fileArtifact(root: string, file: string): Artifact {
  const hash = fs.existsSync(file) ? contentHash(fs.readFileSync(file)) : "missing";

  return { key: projectPath(root, file), hash };
}

function byKey(a: Artifact, b: Artifact): number {
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/** Records the nodes of one build as they finish. */
export class BuildGraph {
  private readonly nodes = new Map<string, BuildNode>();
  private readonly timings: Record<string, number> = {};
  private readonly startedAt: Record<string, number> = {};
  private readonly started = Date.now();
  private readonly mode: "build" | "check";

  constructor(mode: "build" | "check") {
    this.mode = mode;
  }

  record(
    id: string,
    kind: NodeKind,
    status: NodeStatus,
    fields: {
      inputs?: Artifact[];
      outputs?: Artifact[];
      detail?: string;
      log?: string;
      ms?: number;
    } = {},
  ): BuildNode {
    if (this.nodes.has(id)) throw new Error(`build graph: node ${id} recorded twice`);

    const inputs = [...(fields.inputs ?? [])].sort(byKey);
    const outputs = [...(fields.outputs ?? [])].sort(byKey);
    const hash = contentHash(JSON.stringify({ kind, inputs, outputs }));

    const node: BuildNode = {
      id,
      kind,
      status,
      inputs,
      outputs,
      hash,
      ...(fields.detail !== undefined ? { detail: fields.detail } : {}),
      ...(fields.log !== undefined ? { log: fields.log } : {}),
    };

    this.nodes.set(id, node);

    // Recorded as it finishes: it started `ms` ago.
    if (fields.ms !== undefined) {
      this.timings[id] = fields.ms;
      this.startedAt[id] = Math.max(0, Date.now() - fields.ms - this.started);
    }

    return node;
  }

  /** The node recorded as `id`, if any. */
  get(id: string): BuildNode | undefined {
    return this.nodes.get(id);
  }

  toRecord(requiredAction: RequiredAction, pendingActions: PendingAction[] = []): BuildRecord {
    const nodes = [...this.nodes.values()];

    return {
      schemaVersion: BUILD_RECORD_SCHEMA_VERSION,
      mode: this.mode,
      nodes,
      requiredAction,
      pendingActions,
      timings: { ...this.timings },
      startedAt: { ...this.startedAt },
    };
  }
}

/**
 * Writes the record atomically: a reader never sees half a file. The one
 * it replaces stays beside it (`build-record.previous.json`), for doctor
 * to say what a step ran again for.
 */
export function writeBuildRecord(file: string, record: BuildRecord): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`);
  if (fs.existsSync(file)) fs.renameSync(file, file.replace(/\.json$/, ".previous.json"));
  fs.renameSync(tmp, file);
}

/** The pipeline's summary of what changed (Next), as the action it requires. */
export function requiredAction(
  next: { rebuild: boolean; podInstall: boolean; reload: boolean },
  targets: string[],
  changedUnits: string[],
  actions: PendingAction[] = [],
): RequiredAction {
  if (next.podInstall)
    return {
      kind: "relink",
      targets,
      dependencyChanges: actions.find((a) => a.kind === "relink")?.files ?? [],
    };

  if (next.rebuild)
    return { kind: "compile-native", targets, changedUnits: [...changedUnits].sort() };

  if (next.reload) return { kind: "reload-js" };

  return { kind: "none" };
}
