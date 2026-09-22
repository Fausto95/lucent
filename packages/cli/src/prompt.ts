import { emitKeypressEvents } from "node:readline";
import { CliError } from "./errors.ts";
import type { IO } from "./io.ts";
import type { Palette } from "./style.ts";

const CSI = String.fromCharCode(27) + "[";

export interface Choice<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

/** Arrow-key picker on a terminal; the first choice when there is no terminal to ask. */
export function select<T extends string>(
  io: IO,
  question: string,
  choices: readonly Choice<T>[],
  palette: Palette,
): Promise<T> {
  const stdin = io.stdin;
  const first = choices[0];
  if (!first) throw new Error("select needs at least one choice");
  if (!io.isTTY || !stdin?.isTTY) return Promise.resolve(first.value);
  return new Promise<T>((resolve, reject) => {
    let index = 0;
    const render = (initial: boolean): void => {
      const lines = [
        `${palette.cyan("?")} ${palette.bold(question)} ${palette.dim("(↑/↓ to move, enter to pick)")}`,
        ...choices.map((choice, i) => {
          const active = i === index;
          const label = active ? palette.cyan(choice.label) : choice.label;
          return `  ${active ? palette.cyan("❯") : " "} ${label}${choice.hint ? palette.dim(`  ${choice.hint}`) : ""}`;
        }),
      ];
      if (!initial) io.stdout.write(`${CSI}${lines.length}A`);
      io.stdout.write(lines.map((line) => `${CSI}2K${line}`).join("\n") + "\n");
    };
    const cleanup = (): void => {
      stdin.off("keypress", onKey);
      stdin.setRawMode(false);
      stdin.pause();
    };
    const onKey = (_chunk: string, key: { name?: string; ctrl?: boolean }): void => {
      if (key.ctrl && key.name === "c") {
        cleanup();
        reject(new CliError("Cancelled.", { exitCode: 130 }));
        return;
      }
      if (key.name === "up" || key.name === "k") index = (index + choices.length - 1) % choices.length;
      else if (key.name === "down" || key.name === "j" || key.name === "tab") index = (index + 1) % choices.length;
      else if (key.name === "return") {
        cleanup();
        resolve(choices[index]!.value);
        return;
      }
      render(false);
    };
    emitKeypressEvents(stdin);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("keypress", onKey);
    render(true);
  });
}
