import type { Invocation } from "../args.ts";
import { applyChanges, type Change, type InitPlan, planInit } from "../init/plan.ts";
import { renderDiff } from "../ui/diff.ts";

/** `lucent init`: shows what the app needs for Lucent and applies it (all of it with --yes). */
export function run(invocation: Invocation): Promise<number> {
  return applyPlan("init", planInit(invocation.root), invocation);
}

/**
 * Shows `plan`'s changes and applies them: each confirmed in a terminal,
 * all with --yes, none elsewhere. `lucent init` and `lucent uninstall`.
 */
export async function applyPlan(
  command: "init" | "uninstall",
  plan: InitPlan,
  { root, flags, out }: Invocation,
): Promise<number> {
  const t = out.theme;
  out.print(
    `${t.brand(t.symbols.brand)} ${t.bold(`lucent ${command}`)}  ${t.dim(`${plan.kind === "expo" ? "Expo app" : "bare React Native app"} · ${plan.packageManager}`)}\n`,
  );
  const nextLine = () => out.print(`\n${t.dim("next")}  ${plan.next}`);
  const manual = () => {
    for (const m of plan.manual)
      out.print(
        `${t.warn(t.symbols.warn)} ${m.file}  ${t.dim(m.why)}; add by hand:\n${m.snippet
          .split("\n")
          .map((l) => `    ${l}`)
          .join("\n")}`,
      );
  };

  if (!plan.changes.length) {
    out.print(
      `${t.success(t.symbols.ok)} ${command === "init" ? "already set up" : "nothing of Lucent's to remove"}`,
    );
    manual();
    nextLine();
    return 0;
  }

  let accepted: Change[];
  if (flags.yes) accepted = plan.changes;
  else if (out.terminal.interactive) {
    const [{ render }, { createElement }, { Confirm }] = await Promise.all([
      import("ink"),
      import("react"),
      import("../init/confirm.tsx"),
    ]);
    // The prompt's answers, or why it ended without them (it crashed, or was quit): then
    // nothing was applied, and init fails rather than leave the app half set up unsaid.
    const answers = await new Promise<boolean[] | Error>((resolve) => {
      let done: boolean[] | undefined;
      const app = render(
        createElement(Confirm, {
          changes: plan.changes,
          theme: t,
          onDone: (a: boolean[]) => {
            done = a;
            setTimeout(() => app.unmount(), 20);
          },
        }),
        // out.terminal already chose the prompt; Ink would otherwise check CI again itself.
        { interactive: true },
      );
      app.waitUntilExit().then(
        () => resolve(done ?? new Error("the prompt ended before every change was answered")),
        (e: unknown) => resolve(e instanceof Error ? e : new Error(String(e))),
      );
    });
    if (answers instanceof Error) {
      out.error(
        `${t.error(t.symbols.fail)} nothing was changed: ${answers.message}. Run lucent ${command} --yes to apply every change`,
      );
      return 1;
    }
    accepted = plan.changes.filter((_, i) => answers[i]);
    applyChanges(root, accepted);
    manual();
    nextLine();
    return 0;
  } else {
    for (const c of plan.changes)
      out.print(
        `${t.bold(c.file)}${c.before === undefined ? t.dim(" (new)") : c.remove ? t.dim(" (removed)") : ""}  ${t.dim(c.why)}\n${renderDiff(c.before ?? "", c.after, t)}\n`,
      );
    manual();
    out.error(
      `${t.warn(t.symbols.warn)} nothing was changed: run lucent ${command} --yes to apply these, or run lucent ${command} in a terminal to choose`,
    );
    return 1;
  }

  applyChanges(root, accepted);
  for (const c of accepted) out.print(`${t.success(t.symbols.ok)} ${c.file}  ${t.dim(c.why)}`);
  manual();
  nextLine();
  return 0;
}
