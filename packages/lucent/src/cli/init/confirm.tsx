/** @jsxRuntime automatic */
import { Box, Static, Text, useInput } from "ink";
import { useState } from "react";
import { renderDiff } from "../ui/diff.ts";
import type { Theme } from "../ui/theme.ts";
import type { Change } from "./plan.ts";

/** Shows each change as a diff and asks whether to apply it: y (or Enter) applies, n skips. */
export function Confirm({ changes, theme, onDone }: { changes: Change[]; theme: Theme; onDone: (answers: boolean[]) => void }) {
  const [answers, setAnswers] = useState<boolean[]>([]);
  useInput((input, key) => {
    const yes = input === "y" || input === "Y" || key.return;
    const no = input === "n" || input === "N";
    if ((!yes && !no) || answers.length >= changes.length) return;
    const next = [...answers, yes];
    setAnswers(next);
    if (next.length === changes.length) onDone(next);
  });
  const current = changes[answers.length];
  const decided = answers.map((yes, i) => ({ yes, change: changes[i]! }));
  return (
    <>
      <Static items={decided}>
        {({ yes, change }, i) => <Text key={i}>{`${yes ? theme.success(theme.symbols.ok) : theme.dim(theme.symbols.off)} ${change.file}  ${theme.dim(yes ? change.why : "skipped")}`}</Text>}
      </Static>
      {current ? (
        <Box flexDirection="column" marginTop={1}>
          <Text>{`${theme.bold(current.file)}${current.before === undefined ? theme.dim(" (new)") : ""}  ${theme.dim(current.why)}`}</Text>
          <Text>{renderDiff(current.before ?? "", current.after, theme)}</Text>
          <Text>{`Apply? ${theme.dim("(Y/n)")}`}</Text>
        </Box>
      ) : null}
    </>
  );
}
