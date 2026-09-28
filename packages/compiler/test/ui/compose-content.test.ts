// What a Compose body holds beyond a toggle (LUCENT_VIEWS=fabric):
// callbacks with parameters, values of every plain type, lists of keyed
// items, bindings, composition locals and animations. Each component's
// Kotlin compiles with the Compose compiler plugin, and its glue with the
// NDK.
import { describe, expect, it } from "vite-plus/test";
import {
  android,
  androidGlueErrors,
  build,
  diagnostics,
  generated,
  kotlinErrors,
} from "./toolkit-build.ts";

/**
 * A Compose component `Form`: its props' type, and its setup's `body`,
 * importing `imports` from lucent:compose and `ui` from lucent:ui.
 */
function component(
  imports: string,
  props: string,
  body: string,
  ui = "expose, signal",
): Record<string, string> {
  return {
    "form.lucent.ts": `import type { View } from "lucent:android/android.view";

export type Props = ${props};

export declare function Form(props: Props): View;
`,
    "form.android.lucent.tsx": `import { ${imports}, compose, type ComposeView } from "lucent:compose";
import { ${ui} } from "lucent:ui";
import type { Props } from "./form.lucent";

export function Form(props: Props): ComposeView {
${body}
}
`,
  };
}

const kotlinOf = (files: Record<string, string>) => {
  const built = build(files, "android");

  return { built, kotlin: generated(built.result, /^dev\/lucent\/compose\/.*\.kt$/) };
};

describe.skipIf(!android)("a Compose body", () => {
  it("gives its callbacks' parameters to the setup's functions they call", () => {
    const { built, kotlin } = kotlinOf(
      component(
        "BasicText, BasicTextField, Box, Column, dp, Modifier",
        "{ title: string; onPick?: (label: string, n: number) => void }",
        `  const draft = signal("");
  const on = signal(false);
  const typed = (text: string) => {
    draft.set(text);
  };
  const turned = (value: boolean) => {
    on.set(value);
    props.onPick?.(value ? "on" : "off", 0);
  };
  const pick = (label: string, n: number) => {
    props.onPick?.(label, n);
  };

  expose({ draft: (): string => draft.peek() });

  return compose(() =>
    Column({}, () => [
      BasicTextField({ value: draft.get(), onValueChange: (text) => typed(text) }),
      Box({ modifier: Modifier.toggleable(on.get(), (value) => turned(value)).size(dp(24)) }),
      BasicText({ text: "pick", modifier: Modifier.clickable(() => pick(props.title, 2)) }),
    ]),
  );`,
      ),
    );

    expect(diagnostics(built.result)).toEqual([]);
    expect(kotlin).toMatch(
      /BasicTextField\(value = lucent\.draft\d+\.value, onValueChange = \{ text -> lucent\.typed\d+\(text\) \}\)/,
    );
    expect(kotlin).toMatch(
      /Modifier\.toggleable\(value = lucent\.on\d+\.value\) \{ value -> lucent\.turned\d+\(value\) \}/,
    );
    expect(kotlin).toMatch(/lucent\.pick\d+\(lucent\.title\d+\.value, 2\.0\)/);
    expect(kotlinErrors(built)).toBe("");
    expect(androidGlueErrors(built)).toBe("");
  }, 600_000);

  it("takes arrays, objects and nulls from its setup", () => {
    const { built, kotlin } = kotlinOf(
      component(
        "BasicText, Column",
        `{ title: string; note?: string }`,
        `  type Stats = { label: string; done: number; total: number; note: string | null; tags: string[] };

  const stats = signal<Stats>({ label: "todo", done: 0, total: 0, note: null, tags: [] });
  const bump = () => {
    const s = stats.peek();
    stats.set({ ...s, done: s.done + 1, note: props.note ?? null });
  };

  expose({ bump });

  return compose(() => {
    const s = stats.get();

    return Column({}, () => [
      BasicText({ text: \`\${s.label}: \${s.done} of \${s.total}\` }),
      s.note !== null && BasicText({ text: s.note }),
    ]);
  });`,
      ),
    );

    expect(diagnostics(built.result)).toEqual([]);
    // An object crosses as a Kotlin data class, whose fields the body reads.
    expect(kotlin).toMatch(
      /data class \w+Value\d+\(val label: String = "", val done: Double = 0\.0, val total: Double = 0\.0, val note: String\? = null, val tags: List<String> = emptyList\(\)\)/,
    );
    expect(kotlin).toMatch(/val s = lucent\.stats\d+\.value/);
    expect(kotlin).toMatch(/if \(s\.note != null\) \{\n\s+BasicText\(text = s\.note\)/);

    const glue = generated(built.result, /^android\/m_form\.cpp$/);

    // The setup's C++ encodes it: a record of its fields, in order.
    expect(glue).toContain("lucent::compose::record({");
    expect(glue).toContain("lucent::compose::array(");
    expect(kotlinErrors(built)).toBe("");
    expect(androidGlueErrors(built)).toBe("");
  }, 600_000);

  it("shows a lazy list item by item, each keyed, with its own state and actions", () => {
    const { built, kotlin } = kotlinOf(
      component(
        "BasicText, Column, dp, LazyColumn, Modifier, Row",
        "{ title: string }",
        `  type Todo = { id: number; title: string; done: boolean };

  const todos = signal<Todo[]>([{ id: 1, title: "milk", done: false }]);
  const toggle = (todo: Todo) => {
    todos.set(todos.peek().map((t) => (t.id === todo.id ? { ...t, done: !t.done } : t)));
  };
  const remove = (id: number) => {
    todos.set(todos.peek().filter((t) => t.id !== id));
  };

  expose({ count: (): number => todos.peek().length });

  return compose(() =>
    Column({}, (column) => [
      LazyColumn({
        modifier: column.Modifier.weight(1).height(dp(200)),
        content: (list) => {
          list.items(
            todos.get(),
            (_, t) => [
              Row({}, (row) => [
                BasicText({
                  text: \`\${t.done ? "done" : "todo"} \${t.title}\`,
                  modifier: row.Modifier.weight(1).clickable(() => toggle(t)),
                }),
                BasicText({ text: "remove", modifier: Modifier.clickable(() => remove(t.id)) }),
              ]),
            ],
            { key: (t) => t.id },
          );
        },
      }),
    ]),
  );`,
      ),
    );

    expect(diagnostics(built.result)).toEqual([]);
    // Each item is a holder of its own, kept by key.
    expect(kotlin).toMatch(/class \w+Item0\(val key: Double\) \{/);
    // The scopes are Kotlin's receivers: calls and Modifier on them are written as Kotlin writes them.
    expect(kotlin).toContain("Modifier.weight(weight = 1f).height(height = 200.0.dp)");
    expect(kotlin).toContain(
      "items(items = lucent.list_0.value, key = { it.key }) { lucent_item -> ",
    );
    // The item itself crosses as its key; what the setup computes for it is its state.
    expect(kotlin).toMatch(/\.clickable \{ lucent\.toggle\d+\(lucent_item\.key\) \}/);
    expect(kotlin).toMatch(/lucent\.remove\d+\(lucent_item\.id\d+\.value\)/);

    const glue = generated(built.result, /^android\/m_form\.cpp$/);

    expect(glue).toContain("std::make_shared<lucent::ui::Items<double, ");
    expect(glue).toContain("lucent::compose::record({lucent::compose::value(lucent_key), ");
    expect(kotlinErrors(built)).toBe("");
    expect(androidGlueErrors(built)).toBe("");
  }, 600_000);

  it("keys its lists", () => {
    const { built } = kotlinOf(
      component(
        "BasicText, LazyColumn",
        "{ title: string }",
        `  const names = signal(["a", "b"]);

  return compose(() =>
    LazyColumn({ content: (list) => list.items(names.get(), (_, n) => [BasicText({ text: n })]) }),
  );`,
      ),
    );

    expect(diagnostics(built.result)).toContainEqual(
      expect.stringMatching(/^LUCENT3024 a Compose list keys its items: \{ key: \(item\) => /),
    );
  }, 300_000);

  it("binds its setup's signals to the value and change pairs of its views", () => {
    const { built, kotlin } = kotlinOf(
      component(
        "BasicTextField, Box, Column, dp, Modifier",
        "{ title: string }",
        `  const draft = signal("");
  const on = signal(false);

  expose({ draft: (): string => draft.peek() });

  return compose(() =>
    Column({}, () => [
      BasicTextField({ value: bind(draft) }),
      Box({ modifier: Modifier.toggleable(bind(on)).size(dp(24)) }),
    ]),
  );`,
        "bind, expose, signal",
      ),
    );

    expect(diagnostics(built.result)).toEqual([]);
    expect(kotlin).toMatch(
      /BasicTextField\(value = lucent\.draft\d+\.value, onValueChange = \{ value -> lucent\.draft\d+\(value\) \}\)/,
    );
    expect(kotlin).toMatch(
      /Modifier\.toggleable\(value = lucent\.on\d+\.value, onValueChange = \{ value -> lucent\.on\d+\(value\) \}\)/,
    );

    const glue = generated(built.result, /^android\/m_form\.cpp$/);

    expect(glue).toMatch(
      /\[signal = draft\]\(lucent::String value\) mutable \{\s+signal\.set\(value\);/,
    );
    expect(kotlinErrors(built)).toBe("");
    expect(androidGlueErrors(built)).toBe("");
  }, 600_000);

  it("reads composition locals where it composes", () => {
    const { built, kotlin } = kotlinOf(
      component(
        "BasicText, Column, isSystemInDarkTheme, LaunchedEffect, LocalDensity",
        "{ title: string }",
        `  const seen = (dark: boolean, density: number) => {
    console.log(\`dark \${dark} \${density}\`);
  };

  return compose(() => {
    const density = LocalDensity.current.density;
    const dark = isSystemInDarkTheme();

    LaunchedEffect(dark, async () => {
      seen(dark, density);
    });

    return Column({}, () => [BasicText({ text: \`\${density}x, \${dark ? "dark" : "light"}\` })]);
  });`,
      ),
    );

    expect(diagnostics(built.result)).toEqual([]);
    expect(kotlin).toContain("import androidx.compose.ui.platform.LocalDensity");
    expect(kotlin).toContain("val density = LocalDensity.current.density");
    expect(kotlin).toContain("val dark = isSystemInDarkTheme()");
    expect(kotlin).toMatch(/lucent\.seen\d+\(dark, density\.toDouble\(\)\)/);
    expect(kotlinErrors(built)).toBe("");
  }, 600_000);

  it("reads composition locals only where it composes", () => {
    const { built } = kotlinOf(
      component(
        "BasicText, LocalDensity, Modifier",
        "{ title: string }",
        `  const dense = (density: number) => {
    console.log(\`\${density}\`);
  };

  return compose(() =>
    BasicText({
      text: "x",
      modifier: Modifier.clickable(() => dense(LocalDensity.current.density)),
    }),
  );`,
      ),
    );

    expect(diagnostics(built.result)).toContainEqual(
      expect.stringMatching(
        /^LUCENT3024 LocalDensity\.current is composable: read it where the body composes/,
      ),
    );
  }, 300_000);

  it("animates with setup values, and moves content in and out", () => {
    const { built, kotlin } = kotlinOf(
      component(
        "AnimatedVisibility, animateDpAsState, BasicText, Box, Column, dp, expandVertically, fadeIn, fadeOut, Modifier, shrinkVertically, spring",
        "{ title: string }",
        `  const open = signal(false);
  const stiffness = signal(400);

  expose({ toggle: () => open.set(!open.peek()) });

  return compose(() => {
    const size = animateDpAsState(open.get() ? dp(80) : dp(40), spring({ stiffness: stiffness.get() }));

    return Column({ modifier: Modifier.animateContentSize() }, () => [
      AnimatedVisibility(
        {
          visible: open.get(),
          enter: fadeIn().plus(expandVertically()),
          exit: fadeOut().plus(shrinkVertically()),
        },
        () => [BasicText({ text: "details" })],
      ),
      Box({ modifier: Modifier.size(size.value) }),
    ]);
  });`,
      ),
    );

    expect(diagnostics(built.result)).toEqual([]);
    expect(kotlin).toMatch(/spring\(stiffness = lucent\.stiffness\d+\.value\.toFloat\(\)\)/);
    expect(kotlin).toMatch(
      /AnimatedVisibility\(visible = lucent\.open\d+\.value, enter = fadeIn\(\)\.plus\(enter = expandVertically\(\)\), exit = fadeOut\(\)\.plus\(exit = shrinkVertically\(\)\)\)/,
    );
    expect(kotlin).toContain("Column(modifier = Modifier.animateContentSize())");
    expect(kotlinErrors(built)).toBe("");
  }, 600_000);

  it("passes the setup's functions only what crosses back", () => {
    const { built } = kotlinOf(
      component(
        "BasicText, Modifier",
        "{ title: string }",
        `  const choose = (range: { min: number }) => {
    console.log(\`\${range.min}\`);
  };

  return compose(() =>
    BasicText({ text: "x", modifier: Modifier.clickable(() => choose({ min: 1 })) }),
  );`,
      ),
    );

    expect(diagnostics(built.result)).toContainEqual(
      expect.stringMatching(
        /^LUCENT3024 a Compose callback passes numbers, booleans and strings to the setup's functions/,
      ),
    );
  }, 300_000);
});
