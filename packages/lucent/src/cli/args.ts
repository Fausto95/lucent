import type { Output } from "./output.ts";

export interface FlagSpec {
  name: string;
  /** Placeholder of the flag's value (`--out <dir>`); absent for a switch. */
  value?: string;
  /** The value may be left out (`--ios` alone): the flag is then "". */
  optional?: boolean;
  description: string;
}

/** What a command's module exports: run with the parsed invocation, returns the exit code. */
export interface CommandModule {
  run(invocation: Invocation): Promise<number> | number;
}

export interface CommandSpec {
  /** One or two words: "build", "sdk prefetch". */
  name: string;
  summary: string;
  flags: FlagSpec[];
  /** Loaded only when the command runs, so help and startup stay light. */
  load: () => Promise<CommandModule>;
}

export type Flags = Record<string, string | boolean>;

export interface Invocation {
  root: string;
  flags: Flags;
  positionals: string[];
  out: Output;
}

/** Flags every command takes. */
export const GLOBAL_FLAGS: FlagSpec[] = [
  { name: "root", value: "dir", description: "Project directory (default: the current one)" },
  { name: "json", description: "Machine-readable output, for tools and CI" },
  { name: "help", description: "Show help" },
];

export type Parsed =
  | { command: CommandSpec | undefined; flags: Flags; positionals: string[] }
  | { error: string };

export function parseArgs(argv: string[], commands: CommandSpec[]): Parsed {
  const words = argv.filter((a) => !a.startsWith("-"));
  const command = [...commands]
    .sort((a, b) => b.name.split(" ").length - a.name.split(" ").length)
    .find((c) => c.name.split(" ").every((w, i) => words[i] === w));
  const firstWord = argv[0];
  if (!command && firstWord && !firstWord.startsWith("-")) {
    const near = closest(firstWord, [...new Set(commands.map((c) => c.name.split(" ")[0]!))]);
    return { error: `unknown command ${firstWord}${near ? ` (did you mean ${near}?)` : ""}` };
  }
  const specs = [
    ...(command?.flags ?? []),
    ...GLOBAL_FLAGS,
    ...(command ? [] : [{ name: "version", description: "" }]),
  ];
  const flags: Flags = {};
  const positionals: string[] = [];
  const nameWords = command ? command.name.split(" ").length : 0;
  let skipped = 0;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) {
      if (skipped < nameWords) skipped++;
      else positionals.push(a);
      continue;
    }
    const [name, inline] = a.slice(2).split(/=(.*)/s, 2) as [string, string | undefined];
    const spec = specs.find((f) => f.name === name);
    if (!spec)
      return { error: `unknown flag --${name}${command ? ` for lucent ${command.name}` : ""}` };
    if (!spec.value) {
      flags[name] = true;
      continue;
    }
    const next = argv[i + 1];
    if (inline !== undefined) flags[name] = inline;
    else if (next !== undefined && !next.startsWith("--")) flags[name] = argv[++i]!;
    else if (spec.optional) flags[name] = "";
    else return { error: `--${name} needs a value (--${name} <${spec.value}>)` };
  }
  return { command, flags, positionals };
}

/** The candidate within two edits of `word`, if any. */
function closest(word: string, candidates: string[]): string | undefined {
  let best: { c: string; d: number } | undefined;
  for (const c of candidates) {
    const d = distance(word, c);
    if (d <= 2 && (!best || d < best.d)) best = { c, d };
  }
  return best?.c;
}

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length]!;
}
