import { useState } from "react";
import { Stack } from "../../ui/Stack";
import { TableRow } from "../../ui/TableRow";
import { logLine } from "../report.lucent";
import { RunPanel } from "../RunPanel";
import { summaryLine } from "../summary";
import { useRun } from "../useRun";
import { modules } from "./modules";
import { RUNS, timeNumbers, timeStrings, warmup } from "./timeCalls";
import type { AddModule } from "./types";

/** Each loop runs this many times, interleaved across modules; the best counts. */
const ROUNDS = 3;

type Key = "numbers" | "strings";

interface Row {
  name: string;
  numbers: number;
  strings: number;
  error?: string;
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 30));

const ms = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : "–");

function best(rows: readonly Row[], key: Key, lucent: boolean): number {
  return Math.min(
    ...rows.filter((r) => (r.name === "Lucent") === lucent && !r.error).map((r) => r[key]),
  );
}

/** The fastest other module's time over Lucent's, per loop. */
function verdict(rows: readonly Row[]): string {
  const ratio = (key: Key) => (best(rows, key, false) / best(rows, key, true)).toFixed(2);

  return `fastest other ÷ Lucent: numbers ${ratio("numbers")}x, strings ${ratio("strings")}x`;
}

/**
 * NitroBenchmarks (github.com/mrousavy/NitroBenchmarks) with Lucent next to
 * the native module kinds it compares: 100,000 calls of addNumbers and of
 * addStrings through each.
 */
export function CompareLab() {
  const [rows, setRows] = useState<Row[]>([]);

  const { running, run } = useRun(async (token) => {
    const out: Row[] = modules.map((m) => ({ name: m.name, numbers: Infinity, strings: Infinity }));
    setRows(out.map((r) => ({ ...r })));

    // Loaded on first use, so a module the native build lacks fails its own row.
    const loaded: (AddModule | null)[] = modules.map(() => null);
    const attempt = (i: number, f: (m: AddModule) => void) => {
      if (out[i]!.error) return;

      try {
        loaded[i] ??= modules[i]!.load();
        if (!loaded[i]) throw new Error("not linked");
        f(loaded[i]!);
      } catch (e) {
        out[i]!.error = e instanceof Error ? e.message : String(e);
      }
    };

    modules.forEach((_, i) => attempt(i, warmup));

    for (const key of ["numbers", "strings"] as const) {
      const time = key === "numbers" ? timeNumbers : timeStrings;

      for (let round = 0; round < ROUNDS; round++) {
        for (let i = 0; i < modules.length; i++) {
          await tick();
          if (token.stopped) return;

          attempt(i, (m) => (out[i]![key] = Math.min(out[i]![key], time(m))));
          setRows(out.map((r) => ({ ...r })));
        }
      }
    }

    logLine(summaryLine("compare", verdict(out)));
  });

  const done = !running && rows.length > 0;

  return (
    <Stack>
      <RunPanel
        running={running}
        result={done ? { text: verdict(rows), ok: true } : null}
        progress={`${RUNS.toLocaleString("en-US")} calls of addNumbers(num, 5) and addStrings("hello ", "world") per module · best of ${ROUNDS}, in ms`}
        onRun={run}
        timed
      />

      <TableRow header cells={["module", "addNumbers", "addStrings"]} />

      {rows.map((r) => (
        <TableRow
          key={r.name}
          testID={`compare-${r.name}`}
          tone={r.error ? "danger" : r.name === "Lucent" ? "success" : undefined}
          cells={[r.name, r.error ?? ms(r.numbers), r.error ? "" : ms(r.strings)]}
        />
      ))}
    </Stack>
  );
}
