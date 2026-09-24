import { detectTerminal, type Terminal } from "./ui/terminal.ts";
import { createTheme, type Theme } from "./ui/theme.ts";

/** Where a command writes: human output for the terminal, or one JSON document with --json. */
export interface Output {
  terminal: Terminal;
  theme: Theme;
  json: boolean;
  /** A line of human output (stdout). Silent with --json. */
  print(line?: string): void;
  /** A line about a problem (stderr). Silent with --json. */
  error(line: string): void;
  /** The command's JSON document (stdout), with --json. */
  data(value: unknown): void;
}

export function createOutput(
  json: boolean,
  stdout: NodeJS.WriteStream = process.stdout,
  stderr: NodeJS.WriteStream = process.stderr,
  env: NodeJS.ProcessEnv = process.env,
): Output {
  const terminal = detectTerminal(env, stdout);
  return {
    terminal,
    theme: createTheme(terminal),
    json,
    print: (line = "") => void (json || stdout.write(`${line}\n`)),
    error: (line) => void (json || stderr.write(`${line}\n`)),
    data: (value) => void stdout.write(`${JSON.stringify(value, null, 2)}\n`),
  };
}
