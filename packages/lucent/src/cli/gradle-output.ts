/** The most lines of a failed Gradle run lucent shows. */
const shownLines = 20;

/** Lines of the output's end shown when Gradle printed no cause. */
const tailLines = 8;

/**
 * What to show of a failed Gradle run's output: each of its
 * "* What went wrong:" sections (the cause, without Gradle's "* Try:"
 * footer), capped at `shownLines`; its last lines when it has none.
 */
export function gradleFailure(output: string): string {
  const lines = output.trimEnd().split("\n");
  const causes: string[][] = [];
  let cause: string[] | undefined;

  for (const line of lines) {
    if (line.trim() === "* What went wrong:") {
      cause = [];
      causes.push(cause);
    } else if (cause && (line.trim() === "" || line.startsWith("* "))) {
      cause = undefined;
    } else {
      cause?.push(line.trimEnd());
    }
  }

  if (!causes.length) return lines.slice(-tailLines).join("\n");

  const shown = causes
    .map((c) => c.join("\n"))
    .join("\n\n")
    .split("\n");
  if (shown.length <= shownLines) return shown.join("\n");

  return [...shown.slice(0, shownLines), `… ${shown.length - shownLines} more lines`].join("\n");
}
