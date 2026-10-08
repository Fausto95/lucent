import { spawn } from "node:child_process";
import path from "node:path";
import type { Invocation } from "../args.ts";
import { compact } from "../dev/compact.ts";
import { startSession } from "../dev/session.ts";
import { diagnose, systemProbe } from "../doctor.ts";
import { version } from "../version.ts";

/** `lucent dev`: rebuild on every change; a dashboard in a terminal, one line per build elsewhere (Metro). */
export async function run({ root, flags, out }: Invocation): Promise<number> {
  const session = startSession(root);
  if (flags.compact || !out.terminal.interactive) {
    compact(session, out);
    // Runs until interrupted; Ctrl-C is how it ends.
    await new Promise<void>((resolve) => {
      // A terminal's Ctrl-C can arrive twice (to the process group and forwarded): both end it.
      for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => resolve());
    });
    session.stop();
    return 0;
  }
  const { dashboard } = await import("../dev/dashboard.tsx");
  await dashboard({
    session,
    theme: out.theme,
    root,
    open: (file, line, failed) => openInEditor(path.resolve(root, file), line, failed),
    doctor: () => diagnose(root, systemProbe(version())),
  });
  return 0;
}

/**
 * Opens `file` at `line` in $VISUAL or $EDITOR, or VS Code; calls
 * `failed` with why when the editor cannot be started (not installed,
 * not on the PATH), instead of crashing the dashboard.
 */
export function openInEditor(
  file: string,
  line: number,
  failed: (why: string) => void,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const editor = env.VISUAL || env.EDITOR || "code";
  const [command, ...own] = editor.split(" ").filter(Boolean);
  const name = path.basename(command!);
  // Editors spell "at this line" differently.
  const args = ["code", "cursor", "codium", "windsurf", "zed", "subl"].includes(name)
    ? ["-g", `${file}:${line}`]
    : name === "idea" || name === "webstorm"
      ? ["--line", String(line), file]
      : [`+${line}`, file];
  const child = spawn(command!, [...own, ...args], { stdio: "ignore", detached: true, env });
  child.on("error", (e: NodeJS.ErrnoException) =>
    failed(
      e.code === "ENOENT"
        ? `could not open ${path.basename(file)}: ${command} was not found; set $VISUAL or $EDITOR to your editor`
        : `could not open ${path.basename(file)} with ${command}: ${e.message}`,
    ),
  );
  child.unref();
}
