import { useState } from "react";
import { logLine } from "./report.lucent";
import { type Check, checksSummary, type Summary } from "./summary";
import { useRun } from "./useRun";

interface Checks<R> {
  results: R[];
  running: boolean;
  /** Set once every check ran. */
  summary: Summary | null;
  run: () => void;
}

/** Runs `check` over `items` one at a time, and logs the summary line when all ran. */
export function useChecks<T, R extends Check>(
  screen: string,
  items: readonly T[],
  check: (item: T) => Promise<R>,
): Checks<R> {
  const [results, setResults] = useState<R[]>([]);

  const { running, run } = useRun(async (token) => {
    setResults([]);

    const out: R[] = [];
    for (const item of items) {
      const result = await check(item);
      if (token.stopped) return;

      out.push(result);
      setResults([...out]);
    }

    logLine(checksSummary(screen, out).line);
  });

  const done = !running && results.length === items.length;

  return { results, running, summary: done ? checksSummary(screen, results) : null, run };
}
