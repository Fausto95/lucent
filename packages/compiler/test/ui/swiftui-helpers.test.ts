// Helper views in a SwiftUI body: a function of the
// iOS file returning SwiftUI's JSX, used as an element. Each is a Swift
// View struct of its own; what it computes from its props crosses from the
// setup as the body's values do, computed for each place it is used (each
// list item's too), and its callback props are closures the user's
// element gives it.
import { describe, expect, it } from "vite-plus/test";
import { build, diagnostics, generated, ios, swiftErrors } from "./toolkit-build.ts";

/** A SwiftUI component `Todos` in an iOS file whose code is `code` (helpers, then the component). */
function component(code: string): Record<string, string> {
  return {
    "todos.lucent.ts": `import type { View } from "lucent:swiftui";

export type Props = { title: string };

export declare function Todos(props: Props): View;
`,
    "todos.ios.lucent.tsx": `import { Button, Color, Environment, ColorScheme, Font, ForEach, HStack, Image, Text, VStack } from "lucent:swiftui";
import { bind, signal } from "lucent:ui";
import type { Props } from "./todos.lucent";

type Todo = { id: number; title: string; done: boolean };

${code}
`,
  };
}

const HELPERS = `/** A mark: a check while done. */
function Check(props: { done: boolean }) {
  return <HStack>{props.done && <Image systemName="checkmark" />}</HStack>;
}

/** One todo: its title and mark, a tap toggles it, a button removes it. */
function Row(props: {
  id: number;
  title: string;
  done: boolean;
  onToggle: () => void;
  onRemove: (id: number) => void;
}) {
  return (
    <HStack onTapGesture={props.onToggle}>
      <Check done={props.done} />
      <Text font={props.done ? Font.caption : Font.body}>
        {\`\${props.title}\${props.done ? " (done)" : ""}\`}
      </Text>
      <Text opacity={Environment((values) => values.colorScheme) === ColorScheme.dark ? 0.8 : 1}>
        {\`#\${props.id}\`}
      </Text>
      <Button action={() => props.onRemove(props.id)}>remove</Button>
    </HStack>
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
    <VStack>
      <Row id={0} title={props.title} done={todos.get().length === 0} onToggle={cleared} onRemove={remove} />
      <ForEach data={todos.get()} id={(t) => t.id}>
        {(t) => (
          <Row id={t.id} title={t.title} done={t.done} onToggle={() => toggle(t)} onRemove={remove} />
        )}
      </ForEach>
    </VStack>
  );
}`;

describe.skipIf(!ios)("a SwiftUI body's helper views", () => {
  it("are Swift views of their own, their values computed where they are used", async () => {
    const built = build(component(`${HELPERS}\n\n${TODOS}`), "ios");

    expect(diagnostics(built.result)).toEqual([]);

    const swift = generated(built.result, /^ios\/views\/.*\.swift$/);

    // A helper is a View struct: what it computes from its props, and its callbacks.
    expect(swift).toContain("fileprivate struct TodosView_Row: View {");
    expect(swift).toMatch(/ {2}let value\d+: String\n/);
    expect(swift).toContain("  let onToggle: () -> Void");
    expect(swift).toContain("  let onRemove: (Double) -> Void");
    // A helper using another gives it what that one computes, as its own values.
    expect(swift).toContain("fileprivate struct TodosView_Check: View {");
    expect(swift).toMatch(/TodosView_Check\(done\d+: done\d+\)/);
    // Its callbacks call the closures its user gives it; its environment is its own.
    expect(swift).toMatch(/Button\("remove"\) \{ onRemove\(id\d+\) \}/);
    expect(swift).toContain(".onTapGesture { onToggle() }");
    expect(swift).toMatch(
      /struct TodosView_Row: View \{[^]*@Environment\(\\\.colorScheme\) private var environment_colorScheme: ColorScheme/,
    );
    // Used in the body, its values are the model's; in a list's item, the item's.
    expect(swift).toMatch(/TodosView_Row\(done\d+: model\.\w+, value\d+: model\.\w+,/);
    expect(swift).toMatch(
      /TodosView_Row\(done\d+: item\.\w+, value\d+: item\.\w+, .*onToggle: \{ actions\(\d+, \[item\.id\]\) \}, onRemove: \{ p0 in actions\(\d+, \[p0\]\) \}\)/,
    );

    await expect(swift).toMatchFileSnapshot("__snapshots__/ios/Helpers.swift.snap");

    // The setup computes each value with the helper's props given what its user gives: the
    // setup's title, a constant id, a list item's fields.
    const glue = generated(built.result, /^ios\/m_todos\.mm$/);

    expect(glue).toContain("lucent::String v1_ = props.p0_title.get();");
    expect(glue).toContain('return lucent::String(LUCENT_STR("#")) + lucent::toJsString(0.0);');
    expect(glue).toMatch(
      /\(lucent::Ref<lucent_app::S_Todo> p0_\) mutable -> lucent::String \{[^}]*lucent::String v\d+_ = p0_->title;/,
    );
    expect(swiftErrors(built)).toBe("");
  }, 300_000);

  it("may be the setup's own, reading only its props", () => {
    const built = build(
      component(`export function Todos(props: Props) {
  const count = signal(2);
  const Badge = (badge: { n: number }) => <Text>{\`\${badge.n} left\`}</Text>;

  return (
    <VStack>
      <Badge n={count.get()} />
      {Badge({ n: 1 })}
    </VStack>
  );
}`),
      "ios",
    );

    expect(diagnostics(built.result)).toEqual([]);
    expect(swiftErrors(built)).toBe("");
  }, 300_000);

  it("refuses what a helper cannot be", () => {
    const refused = (code: string) => diagnostics(build(component(code), "ios").result);
    const use = (helper: string, element: string) => `${helper}

export function Todos(props: Props) {
  const count = signal(0);

  return <VStack>${element}</VStack>;
}`;

    expect(
      refused(`export function Todos(props: Props) {
  const count = signal(0);
  const Badge = () => <Text>{\`\${count.get()}\`}</Text>;

  return <Badge />;
}`),
    ).toContainEqual(
      "LUCENT3024 the helper view `Badge` reads `count`, its setup's: a helper reads its props, so give it `count` as one",
    );
    expect(
      refused(
        use(
          "function Nest(props: { n: number }) {\n  return <VStack><Nest n={props.n} /></VStack>;\n}",
          "<Nest n={1} />",
        ),
      ),
    ).toContainEqual("LUCENT3024 the helper view `Nest` uses itself: a helper's views end");
    expect(
      refused(
        use(
          "function Badge({ n }: { n: number }) {\n  return <Text>{`${n}`}</Text>;\n}",
          "<Badge n={1} />",
        ),
      ),
    ).toContainEqual(
      "LUCENT3024 the helper view `Badge` takes its props as one name: `(props) => …`, reading `props.name`",
    );
    expect(
      refused(
        use(
          "function Tinted(props: { tint: Color }) {\n  return <Text foregroundStyle={props.tint}>x</Text>;\n}",
          "<Tinted tint={Color.red} />",
        ),
      ),
    ).toContainEqual(
      "LUCENT3024 the helper view `Tinted` takes plain data and callbacks: `tint` is `Color`",
    );
    expect(
      refused(
        use(
          "function Field(props: { n: number }) {\n  const label = `${props.n}`;\n  return <Text>{label}</Text>;\n}",
          "<Field n={1} />",
        ),
      ),
    ).toContainEqual(
      "LUCENT3024 a SwiftUI helper view returns its view, its only statement: compute its values in the JSX, from its props",
    );
  }, 300_000);
});
