import type { Invocation } from "../args.ts";
import { applyChanges, type Change, planInit } from "../init/plan.ts";
import { renderDiff } from "../ui/diff.ts";

/** `lucent init`: shows what the app needs for Lucent and applies it (all of it with --yes). */
export async function run({ root, flags, out }: Invocation): Promise<number> {
  const t = out.theme;
  const plan = planInit(root);
  out.print(
    `${t.brand(t.symbols.brand)} ${t.bold("lucent init")}  ${t.dim(`${plan.kind === "expo" ? "Expo app" : "bare React Native app"} · ${plan.packageManager}`)}\n`,
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
    out.print(`${t.success(t.symbols.ok)} already set up`);
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
    const answers = await new Promise<boolean[]>((resolve) => {
      const app = render(
        createElement(Confirm, {
          changes: plan.changes,
          theme: t,
          onDone: (a: boolean[]) => setTimeout(() => (app.unmount(), resolve(a)), 20),
        }),
        // out.terminal already chose the prompt; Ink would otherwise check CI again itself.
        { interactive: true },
      );
    });
    accepted = plan.changes.filter((_, i) => answers[i]);
    applyChanges(root, accepted);
    manual();
    nextLine();
    return 0;
  } else {
    for (const c of plan.changes)
      out.print(
        `${t.bold(c.file)}${c.before === undefined ? t.dim(" (new)") : ""}  ${t.dim(c.why)}\n${renderDiff(c.before ?? "", c.after, t)}\n`,
      );
    manual();
    out.error(
      `${t.warn(t.symbols.warn)} nothing was changed: run lucent init --yes to apply these, or run lucent init in a terminal to choose`,
    );
    return 1;
  }

  applyChanges(root, accepted);
  for (const c of accepted) out.print(`${t.success(t.symbols.ok)} ${c.file}  ${t.dim(c.why)}`);
  manual();
  nextLine();
  return 0;
}
