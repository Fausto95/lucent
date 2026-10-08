import type { Theme } from "../ui/theme.ts";

export interface Choice<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

/**
 * Asks which of `choices` to take, in a terminal: up and down (or the
 * choice's number) and Enter. Undefined when the prompt ends without an
 * answer (Ctrl-C, Escape).
 */
export async function pick<T extends string>(
  question: string,
  choices: Choice<T>[],
  theme: Theme,
): Promise<T | undefined> {
  const [{ render }, { createElement }, { Pick }] = await Promise.all([
    import("ink"),
    import("react"),
    import("./pick-view.tsx"),
  ]);
  return new Promise<T | undefined>((resolve) => {
    let answer: T | undefined;
    const app = render(
      createElement(Pick as never, {
        question,
        choices,
        theme,
        onDone: (v: T | undefined) => {
          answer = v;
          setTimeout(() => app.unmount(), 20);
        },
      }),
      { interactive: true },
    );
    app.waitUntilExit().then(
      () => resolve(answer),
      () => resolve(undefined),
    );
  });
}
