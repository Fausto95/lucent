export interface Check {
  readonly name: string;
  readonly pass: boolean;
}

export interface Summary {
  readonly ok: boolean;
  /** What the screen shows. */
  readonly text: string;
  /** What the screen logs, for scripts. */
  readonly line: string;
}

/** A Lab screen's result as one line a script can find in the device log. */
export function summaryLine(screen: string, detail: string): string {
  return `LUCENT_SUMMARY ${screen} ${detail.replace(/\s+/g, " ").trim()}`;
}

/** The verdict of a run of pass/fail checks. */
export function checksSummary(screen: string, checks: readonly Check[]): Summary {
  const failed = checks.filter((c) => !c.pass).map((c) => c.name);

  const passed = checks.length - failed.length;

  const detail = `${passed}/${checks.length} passed`;

  return {
    ok: failed.length === 0,
    text: failed.length === 0 ? "ALL PASSED" : `${failed.length} FAILED`,
    line: summaryLine(
      screen,
      failed.length === 0 ? detail : `${detail}; failed: ${failed.join(" | ")}`,
    ),
  };
}
