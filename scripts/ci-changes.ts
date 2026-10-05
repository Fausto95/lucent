// Which CI jobs a pull request needs, from the files it changes. The unit
// tests and typecheck always run; the rest run when a file they read changes.
// A file no area names (and no quiet path) runs everything: a new directory
// is tested until it is placed here.
//
//   node scripts/ci-changes.ts HEAD^   # the jobs a pull request's merge commit needs
//   node scripts/ci-changes.ts         # no base (a push): every job
//
// On GitHub it writes the outputs to $GITHUB_OUTPUT; elsewhere it prints them.
import { execFileSync } from "node:child_process";
import fs from "node:fs";

/** A pattern ending in `/` names a directory; `*` matches within one path segment. */
type Pattern = string;

/** Files that change how everything builds or runs: every job runs. */
const everything: Pattern[] = [
  ".github/",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  ".npmrc",
  ".node-version",
  "patches/",
  "tsconfig.json",
  "vite.config.ts",
  "vitest.*.ts",
  "scripts/ci-changes.ts",
];

/** Files no job reads beyond the unit tests. */
const quiet: Pattern[] = [
  "docs/",
  "assets/",
  ".changeset/",
  ".vscode/",
  ".claude/",
  "*.md",
  "LICENSE",
  ".gitignore",
  ".git-blame-ignore-revs",
  "test-timings.json",
  "scripts/test-timings.ts",
  "scripts/cli-recording.ts",
];

/** The areas, each with the files that put it in play. */
const areas = {
  // Everything under packages/ ships in @lucent-lang/lucent: the harnesses run it.
  packages: ["packages/"],
  runtime: ["packages/runtime/"],
  bench: ["benchmarks/", "scripts/bench*", "scripts/smoke-install.ts", "examples/"],
  bare: [
    "apps/bare-example/",
    "examples/",
    "scripts/app-check.ts",
    "scripts/sync-examples.ts",
    "scripts/example-app/",
  ],
  expo: [
    "apps/expo-example/",
    "examples/",
    "scripts/app-check.ts",
    "scripts/sync-examples.ts",
    "scripts/example-app/",
  ],
  website: ["apps/website/", "apps/tutorial/", "scripts/website.ts"],
  sdkCoverage: ["sdk-coverage.json"],
} satisfies Record<string, Pattern[]>;

type Area = keyof typeof areas;

function matches(file: string, pattern: Pattern): boolean {
  if (pattern.endsWith("/")) return file.startsWith(pattern);
  const source = pattern
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join("[^/]*");
  return new RegExp(`^${source}$`).test(file);
}

const any = (file: string, patterns: Pattern[]) => patterns.some((p) => matches(file, p));

/** The harnesses of the `harnesses` matrix, each with the areas it needs. */
const harnesses = [
  {
    name: "End-to-end (native vs. JavaScript)",
    key: "e2e",
    run: "pnpm test:e2e",
    needs: ["packages"],
  },
  {
    name: "Performance budgets, fresh install",
    key: "bench",
    // The kernels' budgets enforced; the CPU-bound ratios reported (see scripts/bench.ts).
    run: "node scripts/bench.ts --check --shared-runner && node scripts/smoke-install.ts",
    needs: ["packages", "bench"],
  },
  {
    name: "App check (bare)",
    key: "app-check-bare",
    run: "node scripts/app-check.ts apps/bare-example",
    needs: ["packages", "bare"],
  },
  {
    name: "App check (Expo)",
    key: "app-check-expo",
    run: "node scripts/app-check.ts apps/expo-example",
    needs: ["packages", "expo"],
  },
] satisfies { name: string; key: string; run: string; needs: Area[] }[];

export interface Plan {
  runtime: boolean;
  harnesses: { name: string; key: string; run: string }[];
  website: boolean;
  /** The tests that need the iOS SDK. */
  iosTest: boolean;
  /** SDK coverage and the runtime under libc++. */
  iosChecks: boolean;
  /** The bare example's iOS and Android builds. */
  apps: boolean;
}

/** The jobs `files` need; `undefined` (no diff, as on a push) needs them all. */
export function plan(files: string[] | undefined): Plan {
  const all = files === undefined || files.some((f) => any(f, everything));
  const hit = new Set<Area>();
  let unplaced = false;
  for (const file of files ?? []) {
    const placed = (Object.keys(areas) as Area[]).filter((a) => any(file, areas[a]));
    for (const a of placed) hit.add(a);
    if (placed.length === 0 && !any(file, quiet)) unplaced = true;
  }
  const on = (...needs: Area[]) => all || unplaced || needs.some((a) => hit.has(a));
  return {
    runtime: on("runtime"),
    harnesses: harnesses
      .filter((h) => on(...h.needs))
      .map((h) => ({ name: h.name, key: h.key, run: h.run })),
    website: on("packages", "website"),
    iosTest: on("packages"),
    iosChecks: on("packages", "sdkCoverage"),
    apps: on("packages", "bare"),
  };
}

if (import.meta.main) {
  const base = process.argv[2];
  let files: string[] | undefined;
  if (base)
    try {
      const out = execFileSync("git", ["diff", "--name-only", base, "HEAD"], { encoding: "utf8" });
      files = out.split("\n").filter(Boolean);
    } catch {
      // No base to compare with (a shallow clone without it): run everything.
      console.warn(`No diff against ${base}: every job runs.`);
    }
  const p = plan(files);
  const lines = Object.entries(p).map(([k, v]) => `${k}=${JSON.stringify(v)}`);
  console.log(
    files ? `${files.length} files changed:\n  ${files.join("\n  ")}` : "No diff: every job runs.",
  );
  console.log(lines.join("\n"));
  if (process.env.GITHUB_OUTPUT)
    fs.appendFileSync(process.env.GITHUB_OUTPUT, lines.join("\n") + "\n");
}
