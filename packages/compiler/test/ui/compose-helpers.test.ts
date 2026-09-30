// Helper views in a Compose body (LUCENT_VIEWS=fabric): a function of the
// Android file returning Compose's JSX, used as an element. Each is a
// Kotlin @Composable function of its own, whose composition statements
// compose where it does; what it computes from its props crosses from the
// setup as the body's values do, computed for each place it is used (each
// list item's too), and its callback props are lambdas its user gives it.
import { describe, expect, it } from "vite-plus/test";
import {
  android,
  androidGlueErrors,
  build,
  diagnostics,
  generated,
  kotlinErrors,
} from "./toolkit-build.ts";

/** A Compose component `Todos` in an Android file whose code is `code` (helpers, then the component). */
function component(code: string): Record<string, string> {
  return {
    "todos.lucent.ts": `import type { View } from "lucent:android/android.view";

export type Props = { title: string };

export declare function Todos(props: Props): View;
`,
    "todos.android.lucent.tsx": `import {
  animateDpAsState,
  BasicText,
  Box,
  Column,
  dp,
  LazyColumn,
  Modifier,
  Row,
} from "lucent:compose";
import { signal } from "lucent:ui";
import type { Props } from "./todos.lucent";

type Todo = { id: number; title: string; done: boolean };

${code}
`,
  };
}

const HELPERS = `/** A mark: wider while done, animated. */
function Check(props: { done: boolean }) {
  const width = animateDpAsState(props.done ? dp(24) : dp(8));

  return <Box modifier={Modifier.size(width.value, dp(8))} />;
}

/** One todo: its mark and title, a tap toggles it, a button removes it. */
function Line(props: {
  id: number;
  title: string;
  done: boolean;
  onToggle: () => void;
  onRemove: (id: number) => void;
}) {
  return (
    <Row>
      <Check done={props.done} />
      <BasicText
        text={\`\${props.title}\${props.done ? " (done)" : ""}\`}
        modifier={Modifier.clickable(props.onToggle)}
      />
      <BasicText text="remove" modifier={Modifier.clickable(() => props.onRemove(props.id))} />
    </Row>
  );
}`;

const TODOS = `export function Todos(props: Props) {
  const todos = signal<Todo[]>([{ id: 1, title: "milk", done: false }]);
  const toggle = (todo: Todo) => {
    todos.set(todos.peek().map((t) => (t.id === todo.id ? { ...t, done: !t.done } : t)));
  };
  const remove = (id: number) => {
    todos.set(todos.peek().filter((t) => t.id !== id));
  };
  const cleared = () => {
    todos.set([]);
  };

  return (
    <Column>
      <Line id={0} title={props.title} done={todos.get().length === 0} onToggle={cleared} onRemove={remove} />
      <LazyColumn>
        {(list) => (
          <list.items items={todos.get()} key={(t) => t.id}>
            {(_, t) => (
              <Line id={t.id} title={t.title} done={t.done} onToggle={() => toggle(t)} onRemove={remove} />
            )}
          </list.items>
        )}
      </LazyColumn>
    </Column>
  );
}`;

describe.skipIf(!android)("a Compose body's helper views", () => {
  it("are composable functions of their own, their values computed where they are used", async () => {
    const built = build(component(`${HELPERS}\n\n${TODOS}`), "android");

    expect(diagnostics(built.result)).toEqual([]);

    const kotlin = generated(built.result, /^dev\/lucent\/compose\/.*\.kt$/);

    // A helper is a composable: what it computes from its props, and its callbacks.
    expect(kotlin).toMatch(/@Composable\nfun \w+_Line\(/);
    expect(kotlin).toMatch(/value\d+: String/);
    expect(kotlin).toContain("onToggle: () -> Unit");
    expect(kotlin).toContain("onRemove: (Double) -> Unit");
    // Its composition statements compose where it does; a helper using another gives it its values.
    expect(kotlin).toMatch(/fun \w+_Check\(done\d+: Boolean\) \{\n\s+val width = animateDpAsState/);
    expect(kotlin).toMatch(/\w+_Check\(done\d+ = done\d+\)/);
    // Its callbacks call the lambdas its user gives it.
    expect(kotlin).toMatch(/\.clickable\(onClick = onToggle\)|\.clickable \{ onToggle\(\) \}/);
    expect(kotlin).toMatch(/\.clickable \{ onRemove\(id\d+\) \}/);
    // Used in the body, its values are the state's; in a list's item, the item's.
    expect(kotlin).toMatch(/\w+_Line\(done\d+ = lucent\.\w+\.value, /);
    expect(kotlin).toMatch(
      /\w+_Line\(done\d+ = lucent_item\.\w+\.value, .*onToggle = \{ lucent\.toggle\d+\(lucent_item\.key\) \}/,
    );

    await expect(kotlin).toMatchFileSnapshot("__snapshots__/android/Helpers.kt.snap");

    expect(kotlinErrors(built)).toBe("");
    expect(androidGlueErrors(built)).toBe("");
  }, 600_000);

  it("refuses what a helper cannot be", () => {
    const refused = (code: string) => diagnostics(build(component(code), "android").result);

    expect(
      refused(`export function Todos(props: Props) {
  const count = signal(0);
  const Badge = () => <BasicText text={\`\${count.get()}\`} />;

  return <Badge />;
}`),
    ).toContainEqual(
      "LUCENT3024 the helper view `Badge` reads `count`, its setup's: a helper reads its props, so give it `count` as one",
    );
    expect(
      refused(`function Label(props: { n: number }) {
  const text = \`\${props.n}\`;

  return <BasicText text={text} />;
}

export function Todos(props: Props) {
  return <Label n={1} />;
}`),
    ).toContainEqual(
      "LUCENT3024 a Compose helper view's statements compose (`const x = animateDpAsState(…)`): it computes its other values in the JSX, from its props",
    );
  }, 600_000);
});
