import { duration, visibleWidth } from "./format.ts";
import type { Theme } from "./theme.ts";

export type StepStatus = "ok" | "cached" | "skipped" | "failed";

/** A finished step, as reported and as --json lists it. */
export interface StepResult {
  name: string;
  label: string;
  status: StepStatus;
  detail?: string;
  ms?: number;
}

/** Where a command reports its steps: printed as they finish, or shown live. */
export interface Steps {
  /** A step starts: live views show it as running. */
  start(name: string, label: string): void;
  /** The running step finished. */
  finish(result: StepResult): void;
  /** Everything reported. */
  readonly results: StepResult[];
  /** Waits until the step list is on screen (live views render asynchronously). */
  flush(): Promise<void>;
  /** Ends the step list; live views finish drawing first. Safe to call twice. */
  close(): Promise<void>;
}

// Where timings line up, as in the plan's examples.
const TIME_COLUMN = 40;

/** `✓ Checked 7 modules            312 ms`, in the theme's colours. */
export function stepLine(r: StepResult, theme: Theme): string {
  const symbol =
    r.status === "failed"
      ? theme.error(theme.symbols.fail)
      : r.status === "skipped"
        ? theme.dim(theme.symbols.off)
        : theme.success(theme.symbols.ok);
  const text = `${symbol} ${r.label}${r.detail ? `  ${theme.dim(r.detail)}` : ""}`;
  const time = r.status === "cached" ? "cached" : r.ms !== undefined ? duration(r.ms) : "";
  if (!time) return text;
  return `${text}${" ".repeat(Math.max(2, TIME_COLUMN - visibleWidth(text)))}${theme.dim(time)}`;
}

/** Prints each step when it finishes: pipes, CI, --json (silent). */
export function plainSteps(print: (line: string) => void, theme: Theme): Steps {
  const results: StepResult[] = [];
  return {
    results,
    start: () => {},
    finish(r) {
      results.push(r);
      print(stepLine(r, theme));
    },
    flush: async () => {},
    close: async () => {},
  };
}
