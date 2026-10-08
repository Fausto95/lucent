/** @jsxRuntime automatic */
import { Box, Text, useInput } from "ink";
import { useState } from "react";
import type { Theme } from "../ui/theme.ts";
import type { Choice } from "./pick.ts";

/** One question, its choices as a list: ↑ ↓ or a number to move, Enter to take, Esc to quit. */
export function Pick({
  question,
  choices,
  theme: t,
  onDone,
}: {
  question: string;
  choices: Choice<string>[];
  theme: Theme;
  onDone: (value: string | undefined) => void;
}) {
  const [at, setAt] = useState(0);
  const [done, setDone] = useState<string | undefined>(undefined);
  useInput((input, key) => {
    if (done !== undefined) return;
    const n = Number(input);
    if (key.upArrow) setAt((i) => (i + choices.length - 1) % choices.length);
    else if (key.downArrow) setAt((i) => (i + 1) % choices.length);
    else if (Number.isInteger(n) && n >= 1 && n <= choices.length) setAt(n - 1);
    else if (key.return) {
      setDone(choices[at]!.label);
      onDone(choices[at]!.value);
    } else if (key.escape || (key.ctrl && input === "c")) onDone(undefined);
  });
  if (done !== undefined)
    return <Text>{`${t.success(t.symbols.ok)} ${question} ${t.bold(done)}`}</Text>;
  return (
    <Box flexDirection="column">
      <Text>{`${t.bold(question)}  ${t.dim("↑ ↓ to choose, Enter to take")}`}</Text>
      {choices.map((c, i) => (
        <Text key={c.value}>
          {`${i === at ? t.brand("›") : " "} ${i + 1}. ${i === at ? t.bold(c.label) : c.label}${c.hint ? `  ${t.dim(c.hint)}` : ""}`}
        </Text>
      ))}
    </Box>
  );
}
