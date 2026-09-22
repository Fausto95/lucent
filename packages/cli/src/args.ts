import { parseArgs } from "node:util";
import { CliError } from "./errors.ts";

/** One command-line option. Commands declare these as data; help and parsing derive from them. */
export interface OptionSpec {
  readonly type: "string" | "boolean";
  readonly short?: string;
  readonly description: string;
  readonly default?: string | boolean;
  /** Allowed values for string options; anything else is a usage error. */
  readonly values?: readonly string[];
  /** Shown in help after the flag, e.g. `<dir>`. */
  readonly placeholder?: string;
}

export type OptionSpecs = Readonly<Record<string, OptionSpec>>;

export type OptionValue<S extends OptionSpec> = S["type"] extends "string" ? string : boolean;

export type Values<S extends OptionSpecs> = { readonly [K in keyof S]?: OptionValue<S[K]> };

export interface ParsedArgs<S extends OptionSpecs> {
  values: Values<S>;
  positionals: string[];
}

type NodeOption = { type: "string" | "boolean"; short?: string; default?: string | boolean };

export function parseCommandArgs<S extends OptionSpecs>(specs: S, argv: readonly string[]): ParsedArgs<S> {
  const options: Record<string, NodeOption> = {};
  for (const [name, spec] of Object.entries(specs))
    options[name] = {
      type: spec.type,
      ...(spec.short === undefined ? {} : { short: spec.short }),
      ...(spec.default === undefined ? {} : { default: spec.default }),
    };
  let parsed;
  try {
    parsed = parseArgs({ args: [...argv], options, allowPositionals: true, allowNegative: true, strict: true });
  } catch (error) {
    throw usageError(error, specs);
  }
  const values = { ...parsed.values } as Record<string, string | boolean | undefined>;
  for (const [name, spec] of Object.entries(specs)) {
    const value = values[name];
    if (spec.values && value !== undefined && !spec.values.includes(String(value)))
      throw new CliError(`Invalid value "${String(value)}" for --${name}; expected one of ${spec.values.join(", ")}.`, {
        hint: "Run with --help to see every option.",
      });
  }
  return { values: values as Values<S>, positionals: parsed.positionals };
}

function usageError(error: unknown, specs: OptionSpecs): CliError {
  const message = error instanceof Error ? error.message : String(error);
  const unknown = /Unknown option '([^']+)'/.exec(message)?.[1];
  if (unknown) {
    const names: string[] = [];
    for (const [name, spec] of Object.entries(specs)) {
      names.push(`--${name}`);
      if (spec.short) names.push(`-${spec.short}`);
    }
    const near = suggest(unknown, names);
    return new CliError(`Unknown option ${unknown}.`, {
      hint: near ? `Did you mean ${near}?` : "Run with --help to see the available options.",
    });
  }
  const option = /Option '(-{1,2}[^' <]+)/.exec(message)?.[1];
  if (option) {
    const name = option.replace(/^-+/, "");
    const spec = specs[name] ?? Object.values(specs).find((s) => s.short === name);
    return new CliError(
      spec?.type === "string" ? `Option ${option} needs a value.` : `Option ${option} takes no value.`,
    );
  }
  return new CliError(message);
}

/** Closest candidate by prefix or edit distance, or undefined when nothing is close. */
export function suggest(input: string, candidates: readonly string[]): string | undefined {
  const needle = input.toLowerCase();
  let best: { name: string; distance: number } | undefined;
  for (const candidate of candidates) {
    const haystack = candidate.toLowerCase();
    const distance = haystack.startsWith(needle) ? 0 : levenshtein(needle, haystack);
    if (!best || distance < best.distance) best = { name: candidate, distance };
  }
  const tolerance = Math.max(2, Math.floor(needle.length / 3));
  return best && best.distance <= tolerance ? best.name : undefined;
}

function levenshtein(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const substitution = previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, substitution);
    }
    previous = current;
  }
  return previous[b.length]!;
}
