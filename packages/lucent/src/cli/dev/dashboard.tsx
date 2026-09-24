/** @jsxRuntime automatic */
import { Box, render, Text, useApp, useInput } from "ink";
import { useState, useSyncExternalStore } from "react";
import type { Check } from "../doctor.ts";
import { nextText } from "../pipeline.ts";
import { codeFrame, duration, table } from "../ui/format.ts";
import type { Theme } from "../ui/theme.ts";
import type { DevSession, PlatformState } from "./session.ts";

export interface DashboardOptions {
  session: Pick<DevSession, "store" | "rebuild" | "clearCache" | "stop">;
  theme: Theme;
  root: string;
  stdout?: NodeJS.WriteStream;
  stdin?: NodeJS.ReadStream;
  /** Opens a problem's file at its line in the user's editor. */
  open(file: string, line: number): void;
  /** Runs doctor's checks. */
  doctor(): Check[];
}

// The terminal's alternate screen: the dashboard takes the whole window and leaves the scrollback as it was.
const ENTER = "\x1b[?1049h";
const LEAVE = "\x1b[?1049l\x1b[?25h";

/** The full-screen `lucent dev` view; resolves once the user quits. */
export async function dashboard(options: DashboardOptions): Promise<void> {
  const stdout = options.stdout ?? process.stdout;
  stdout.write(ENTER);
  const app = render(<Dashboard {...options} />, {
    stdout,
    stdin: options.stdin ?? process.stdin,
    exitOnCtrlC: false,
    patchConsole: false,
    // The caller chose the dashboard; Ink would otherwise check CI again itself.
    interactive: true,
  });
  const restore = () => stdout.write(LEAVE);
  // A crash or a kill still gives the terminal back.
  process.once("exit", restore);
  try {
    await app.waitUntilExit();
  } finally {
    options.session.stop();
    process.off("exit", restore);
    restore();
  }
}

function Dashboard({ session, theme: t, root, open, doctor }: DashboardOptions) {
  const s = useSyncExternalStore(session.store.subscribe, session.store.get);
  const { exit } = useApp();
  const [selected, setSelected] = useState(0);
  const [checks, setChecks] = useState<Check[] | undefined>(undefined);
  const problem = s.problems[Math.min(selected, s.problems.length - 1)];

  useInput((input, key) => {
    if (input === "q" || (key.ctrl && input === "c")) exit();
    else if (input === "r") session.rebuild();
    else if (input === "c") session.clearCache();
    else if (input === "d") setChecks(checks ? undefined : doctor());
    else if (input === "o" && problem?.file) open(problem.file, problem.line ?? 1);
    else if (key.upArrow) setSelected((i) => Math.max(0, i - 1));
    else if (key.downArrow) setSelected((i) => Math.min(s.problems.length - 1, i + 1));
  });

  const cell = (state: PlatformState) =>
    state === "ok"
      ? t.success(t.symbols.on)
      : state === "error"
        ? t.error(t.symbols.fail)
        : state === "building"
          ? t.progress(t.symbols.off)
          : " ";
  const last = s.lastBuild;
  const when = s.building
    ? t.progress(`building${t.symbols.ellipsis}`)
    : last
      ? `${last.at.toLocaleTimeString("en-GB")}  ${duration(last.ms)}`
      : "";
  const rows = table(
    [
      [t.dim("MODULE"), t.dim("IOS"), t.dim("ANDROID"), t.dim("LAST BUILD")],
      ...s.modules.map((m) => [m.name, cell(m.platforms.ios), cell(m.platforms.android), when]),
    ],
    3,
  );
  const status = last?.fatal
    ? t.error(`${t.symbols.fail} ${last.fatal}`)
    : last?.ok && last.next?.rebuild
      ? t.warn(`next: ${nextText(last.next)}`)
      : "";
  const rule = (title: string) =>
    t.dim(
      `${t.symbols.rule} ${title} ${t.symbols.rule.repeat(Math.max(3, t.terminal.width - title.length - 4))}`,
    );

  return (
    <Box flexDirection="column">
      <Text>{`${t.brand(t.symbols.brand)} ${t.bold("lucent dev")}   ${t.dim(`watching ${s.watching.join(" · ") || root}`)}`}</Text>
      <Text> </Text>
      {s.modules.length ? (
        <Text>{rows.join("\n")}</Text>
      ) : (
        <Text>
          {t.dim(s.building ? `building${t.symbols.ellipsis}` : "no *.lucent.ts modules yet")}
        </Text>
      )}
      {status ? <Text>{`\n${status}`}</Text> : null}
      {s.problems.length ? (
        <Box flexDirection="column" marginTop={1}>
          <Text>{rule(`problems (${s.problems.length})`)}</Text>
          {s.problems.map((d, i) => (
            <Text
              key={i}
            >{`${d === problem ? t.brand("›") : " "} ${d.file ? `${d.file}${d.line ? `:${d.line}` : ""}  ` : ""}${t.bold(d.code)}  ${d.message}`}</Text>
          ))}
          {problem?.fix ? <Text>{`  ${t.success("fix")}  ${problem.fix}`}</Text> : null}
          {problem?.source !== undefined && problem.line ? (
            <Text>
              {codeFrame(
                problem.source,
                { line: problem.line, column: problem.column ?? 1, length: problem.length ?? 1 },
                t,
              )}
            </Text>
          ) : null}
        </Box>
      ) : null}
      {checks ? (
        <Box flexDirection="column" marginTop={1}>
          <Text>{rule("doctor")}</Text>
          {checks
            .filter((c) => c.status !== "skip")
            .map((c, i) => (
              <Text
                key={i}
              >{`${c.status === "ok" ? t.success(t.symbols.ok) : c.status === "fail" ? t.error(t.symbols.fail) : t.warn(t.symbols.warn)} ${c.label}  ${t.dim(c.detail)}${c.fix ? `\n    fix: ${c.fix}` : ""}`}</Text>
            ))}
        </Box>
      ) : null}
      <Text>{`\n${t.dim("[r] rebuild  [c] clear cache  [d] doctor  [o] open  [q] quit")}`}</Text>
    </Box>
  );
}
