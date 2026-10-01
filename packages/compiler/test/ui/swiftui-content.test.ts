// What a SwiftUI body holds beyond a toggle (LUCENT_VIEWS=fabric): actions
// with arguments, values of every plain type, lists of keyed items,
// bindings, the environment and animations with Lucent values. Each
// component's Swift type-checks against the iOS SDK and its glue compiles
// with the runtime.
import { describe, expect, it } from "vite-plus/test";
import { build, diagnostics, generated, ios, swiftErrors } from "./toolkit-build.ts";

/**
 * A SwiftUI component `Counter`: its props' type, and its setup's `body`,
 * importing `imports` from lucent:swiftui and `ui` from lucent:ui.
 */
function component(
  imports: string,
  props: string,
  body: string,
  ui = "expose, signal",
): Record<string, string> {
  return {
    "counter.lucent.ts": `import type { View } from "lucent:swiftui";

export type Props = ${props};

export declare function Counter(props: Props): View;
`,
    "counter.ios.lucent.tsx": `import { ${imports} } from "lucent:swiftui";
import { ${ui} } from "lucent:ui";
import type { Props } from "./counter.lucent";

export function Counter(props: Props) {
${body}
}
`,
  };
}

const swiftOf = (files: Record<string, string>) => {
  const built = build(files, "ios");

  return { built, swift: generated(built.result, /^ios\/views\/.*\.swift$/) };
};

describe.skipIf(!ios)("a SwiftUI body", () => {
  it("passes values to the setup's functions its callbacks call", () => {
    const { built, swift } = swiftOf(
      component(
        "Button, Text, VStack",
        "{ title: string; onPick?: (label: string, n: number) => void }",
        `  const count = signal(0);
  const pick = (label: string, n: number) => {
    count.set(n);
    props.onPick?.(label, n);
  };
  const hovered = (over: boolean) => {
    console.log(\`hovered \${over}\`);
  };

  expose({ count: (): number => count.peek() });

  return (
    <VStack>
      <Text onHover={(over) => hovered(over)}>{\`\${count.get()} picked\`}</Text>
      <Button action={() => pick("one", 1)}>One</Button>
      <Text onTapGesture={() => pick(props.title, count.get() + 2)}>two</Text>
    </VStack>
  );`,
      ),
    );

    expect(diagnostics(built.result)).toEqual([]);
    // A callback's parameter is the closure's; the setup's function gets the values it is given.
    expect(swift).toContain(".onHover { over in model.actions(0, [over]) }");
    expect(swift).toContain('Button("One") { model.actions(1, ["one", 1]) }');
    // What the setup computes for an argument is a value of the model, as anywhere in the body.
    expect(swift).toMatch(
      /\.onTapGesture \{ model\.actions\(1, \[model\.title\d+, model\.value\d+\]\) \}/,
    );

    const glue = generated(built.result, /^ios\/m_counter\.mm$/);

    expect(glue).toMatch(/->list\.push_back\(lucent::swiftui::action\(hovered\)\);/);
    expect(glue).toMatch(/->list\.push_back\(lucent::swiftui::action\(pick\)\);/);
    expect(swiftErrors(built)).toBe("");
  }, 300_000);

  it("shows a list item by item, each keyed, with its own state and actions", () => {
    const { built, swift } = swiftOf(
      component(
        "ForEach, HStack, Text, VStack",
        "{ title: string }",
        `  type Todo = { id: number; title: string; done: boolean };

  const todos = signal<Todo[]>([{ id: 1, title: "milk", done: false }]);
  const suffix = signal("!");
  const toggle = (todo: Todo) => {
    todos.set(todos.peek().map((t) => (t.id === todo.id ? { ...t, done: !t.done } : t)));
  };
  const remove = (id: number) => {
    todos.set(todos.peek().filter((t) => t.id !== id));
  };

  expose({ count: (): number => todos.peek().length });

  return (
    <VStack>
      <Text>{props.title}</Text>
      <ForEach data={todos.get()} id={(t) => t.id}>
        {(t) => (
          <HStack>
            <Text onTapGesture={() => toggle(t)}>
              {\`\${t.done ? "done" : "todo"} \${t.title}\${suffix.get()}\`}
            </Text>
            <Text onTapGesture={() => remove(t.id)}>remove</Text>
          </HStack>
        )}
      </ForEach>
    </VStack>
  );`,
      ),
    );

    expect(diagnostics(built.result)).toEqual([]);
    // Each item is a model of its own, kept by key, and a row view observing it.
    expect(swift).toContain(
      "fileprivate final class CounterItem0: ObservableObject, Identifiable {",
    );
    expect(swift).toContain("  let id: Double");
    expect(swift).toContain("fileprivate struct CounterRow0: View {");
    expect(swift).toContain("  @ObservedObject var item: CounterItem0");
    expect(swift).toContain(
      "ForEach(model.list_0) { item in CounterRow0(item: item, actions: model.actions) }",
    );
    // What the setup computes for an item is the item's; the item itself crosses as its key.
    expect(swift).toMatch(
      /Text\(item\.value\d+\)\.onTapGesture \{ actions\(\d+, \[item\.id\]\) \}/,
    );
    expect(swift).toMatch(/\.onTapGesture \{ actions\(\d+, \[item\.id\d+\]\) \}/);

    const glue = generated(built.result, /^ios\/m_counter\.mm$/);

    expect(glue).toContain("std::make_shared<lucent::ui::Items<double, ");
    expect(glue).toMatch(/->add\(lucent_key, lucent_item\);/);
    expect(glue).toContain("lucent::swiftui::record({lucent::swiftui::value(lucent_key), ");
    // An action given the item finds it by key, and does nothing once it is gone.
    expect(glue).toMatch(/auto found0 = items_0_\d+->find\(p0\);/);
    expect(swiftErrors(built)).toBe("");
  }, 300_000);

  it("keys its lists, one level deep", () => {
    const refused = (content: string) =>
      diagnostics(
        swiftOf(
          component(
            "ForEach, Text, VStack",
            "{ title: string }",
            `  const rows = signal([{ id: "a", on: true, cells: ["x"] }]);

  return <VStack>{${content}}</VStack>;`,
          ),
        ).built.result,
      );

    expect(
      refused('<ForEach data={["a"]} id={(r) => r}>{(r) => <Text>{r}</Text>}</ForEach>'),
    ).toContainEqual(
      'LUCENT3024 a SwiftUI list shows an array the setup computes (a signal, a prop, what a setup function returns): `["a"]` is not one',
    );
    expect(
      refused(
        "<ForEach data={rows.get()} id={(r) => r.id}>{(r) => <ForEach data={r.cells} id={(c) => c}>{(c) => <Text>{c}</Text>}</ForEach>}</ForEach>",
      ),
    ).toContainEqual("LUCENT3024 a SwiftUI list's item shows no list of its own, for now");
  }, 300_000);

  it("binds its setup's signals to the views that change them", () => {
    const { built, swift } = swiftOf(
      component(
        "Text, TextField, Toggle, VStack",
        "{ title: string }",
        `  const draft = signal("");
  const done = signal(false);

  expose({ draft: (): string => draft.peek() });

  return (
    <VStack>
      <TextField text={bind(draft)}>New todo</TextField>
      <Toggle isOn={bind(done)}>Done</Toggle>
      <Text>{draft.get()}</Text>
    </VStack>
  );`,
        "bind, expose, signal",
      ),
    );

    expect(diagnostics(built.result)).toEqual([]);
    // Reads are the model's values; writes are the setup's, through an action.
    expect(swift).toMatch(
      /TextField\("New todo", text: Binding\(get: \{ model\.draft\d+ \}, set: \{ model\.actions\(\d+, \[\$0\]\) \}\)\)/,
    );
    expect(swift).toMatch(
      /Toggle\("Done", isOn: Binding\(get: \{ model\.done\d+ \}, set: \{ model\.actions\(\d+, \[\$0\]\) \}\)\)/,
    );

    const glue = generated(built.result, /^ios\/m_counter\.mm$/);

    expect(glue).toMatch(
      /\[signal = draft\]\(lucent::String value\) mutable \{\s+signal\.set\(value\);/,
    );
    expect(swiftErrors(built)).toBe("");
  }, 300_000);

  it("binds number signals to sliders and steppers over ranges", () => {
    const { built, swift } = swiftOf(
      component(
        "ProgressView, Slider, Stepper, Text, VStack",
        "{ title: string; max: number }",
        `  const level = signal(0.5);
  const count = signal(1);

  expose({ level: (): number => level.peek() });

  return (
    <VStack>
      <Slider value={bind(level)} in={range(0, 1)} step={0.1} />
      <Slider value={bind(level)} />
      <Stepper value={bind(count)} in={range(1, props.max)}>Count</Stepper>
      <ProgressView value={level.get()} total={1} />
      <Text>{\`\${level.get()} of \${count.get()}\`}</Text>
    </VStack>
  );`,
        "bind, expose, range, signal",
      ),
    );

    expect(diagnostics(built.result)).toEqual([]);
    // A range is Swift's closed one; its bounds are literals or what the setup computes.
    expect(swift).toMatch(
      /Slider\(value: Binding\(get: \{ model\.level\d+ \}, set: \{ model\.actions\(\d+, \[\$0\]\) \}\), in: 0 \.\.\. 1, step: 0\.1\)/,
    );
    expect(swift).toMatch(
      /Stepper\("Count", value: Binding\(get: \{ model\.count\d+ \}, set: \{ model\.actions\(\d+, \[\$0\]\) \}\), in: 1 \.\.\. model\.max\d+\)/,
    );
    expect(swift).toMatch(/ProgressView\(value: model\.\w+, total: 1\)/);
    expect(swiftErrors(built)).toBe("");
  }, 300_000);

  it("writes each builder as a closure, labeled or trailing", () => {
    const { built, swift } = swiftOf(
      component(
        "Slider, Text",
        "{ title: string }",
        `  const level = signal(0.5);
  const edited = (editing: boolean) => {
    console.log(\`editing \${editing}\`);
  };

  return (
    <Slider
      value={bind(level)}
      in={range(0, 1)}
      label={<Text>Level</Text>}
      minimumValueLabel={<Text>0</Text>}
      maximumValueLabel={<Text>{props.title}</Text>}
      onEditingChanged={(editing) => edited(editing)}
    />
  );`,
        "bind, range, signal",
      ),
    );

    expect(diagnostics(built.result)).toEqual([]);
    expect(swift).toMatch(
      /Slider\(value: Binding\(.*\), in: 0 \.\.\. 1, label: \{ Text\("Level"\) \}, minimumValueLabel: \{ Text\("0"\) \}, maximumValueLabel: \{ Text\(model\.title\d+\) \}\) \{ editing in model\.actions\(\d+, \[editing\]\) \}/,
    );
    expect(swiftErrors(built)).toBe("");
  }, 300_000);

  it("gives callbacks values of the type they watch, and binds pickers to their tags", () => {
    const { built, swift } = swiftOf(
      component(
        "Picker, Text, VStack",
        "{ title: string }",
        `  const level = signal(0.5);
  const size = signal("m");
  const count = signal(1);
  const leveled = (now: number) => {
    console.log(\`level \${now}\`);
  };
  const moved = () => {
    console.log("moved");
  };

  return (
    <VStack>
      {(<Text onChange={[{ of: level.get() }, (now: number) => leveled(now)]}>{\`\${level.get()}\`}</Text>)
        .onChange({ of: size.get() }, () => moved())
        .onChange({ of: count.get() }, leveled)}
      <Picker titleKey="Size" selection={bind(size)}>
        <Text tag="s">S</Text>
        <Text tag="m">M</Text>
      </Picker>
      <Picker titleKey="Count" selection={bind(count)}>
        <Text tag={1}>One</Text>
        <Text tag={2}>Two</Text>
      </Picker>
    </VStack>
  );`,
        "bind, signal",
      ),
    );

    expect(diagnostics(built.result)).toEqual([]);
    // Swift's closure takes what SwiftUI gives it; the callback, what it names.
    expect(swift).toMatch(
      /\.onChange\(of: model\.level\d+\) \{ now in model\.actions\(\d+, \[now\]\) \}/,
    );
    expect(swift).toMatch(/\.onChange\(of: model\.size\d+\) \{ _ in model\.actions\(\d+\) \}/);
    expect(swift).toMatch(
      /\.onChange\(of: model\.count\d+\) \{ p0 in model\.actions\(\d+, \[p0\]\) \}/,
    );
    // A tag is of the selection's type: a Lucent number is a Double.
    expect(swift).toContain('Text("S").tag("s")');
    expect(swift).toContain('Text("One").tag(Double(1))');
    expect(swiftErrors(built)).toBe("");
  }, 300_000);

  it("shows a view only while its condition holds", () => {
    const { built, swift } = swiftOf(
      component(
        "Text, VStack",
        "{ title: string }",
        `  const shown = signal(true);
  const count = signal(0);

  return (
    <VStack>
      {shown.get() && <Text>shown</Text>}
      {count.get() > 2 && <Text>many</Text>}
      {shown.get() ? <Text>yes</Text> : null}
      {props.title === "" ? null : <Text>{props.title}</Text>}
      {shown.get() ? <Text>on</Text> : <Text>off</Text>}
    </VStack>
  );`,
      ),
    );

    expect(diagnostics(built.result)).toEqual([]);
    // What the setup computes is the condition; the view is SwiftUI's `if`.
    expect(swift).toMatch(/if model\.shown\d+ \{\n\s+Text\("shown"\)\n\s+\}/);
    expect(swift).toMatch(/if model\.value\d+ \{\n\s+Text\("many"\)\n\s+\}/);
    expect(swift).toMatch(/if model\.shown\d+ \{\n\s+Text\("yes"\)\n\s+\}\n/);
    expect(swift).toMatch(/if model\.value\d+ \{\n\s+\} else \{\n\s+Text\(model\.title\d+\)/);
    expect(swift).toMatch(/\} else \{\n\s+Text\("off"\)/);
    expect(swiftErrors(built)).toBe("");
  }, 300_000);

  it("shows views on conditions that are booleans", () => {
    const { built } = swiftOf(
      component(
        "Text, VStack",
        "{ title: string }",
        `  const count = signal(0);

  return <VStack>{count.get() ? <Text>some</Text> : <Text>none</Text>}</VStack>;`,
      ),
    );

    expect(diagnostics(built.result)).toContainEqual(
      "LUCENT3024 a condition in a SwiftUI view's content is a boolean: `count.get()` is not one",
    );
  }, 300_000);

  it("makes ranges only in its views", () => {
    const { built } = swiftOf(
      component(
        "Slider",
        "{ title: string }",
        `  const level = signal(0.5);
  const bounds = range(0, 1);

  return <Slider value={bind(level)} in={bounds} />;`,
        "bind, range, signal",
      ),
    );

    expect(diagnostics(built.result)).toContainEqual(
      expect.stringMatching(/^LUCENT3024 range\(from, to\) is written where a view takes it/),
    );
  }, 300_000);

  it("binds signals only in its views", () => {
    const { built } = swiftOf(
      component(
        "Text",
        "{ title: string }",
        `  const draft = signal("");
  const bound = bind(draft);

  return <Text>x</Text>;`,
        "bind, signal",
      ),
    );

    expect(diagnostics(built.result)).toContainEqual(
      expect.stringMatching(/^LUCENT3024 bind\(signal\) gives a view of a body its value/),
    );
  }, 300_000);

  it("reads SwiftUI's environment where it draws", () => {
    const { built, swift } = swiftOf(
      component(
        "ColorScheme, Environment, ForEach, Text, VStack",
        "{ title: string }",
        `  const names = signal(["a", "b"]);
  const seen = (dark: boolean) => {
    console.log(\`dark \${dark}\`);
  };

  return (
    <VStack>
      <Text onAppear={() => seen(Environment((values) => values.colorScheme) === ColorScheme.dark)}>
        {Environment((values) => values.colorScheme) === ColorScheme.dark ? "dark" : "light"}
      </Text>
      <Text>
        {Environment((values) => values.colorScheme) === ColorScheme.dark === false ? "day" : "night"}
      </Text>
      <ForEach data={names.get()} id={(n) => n}>
        {(n) => (
          <Text opacity={Environment((values) => values.colorScheme) === ColorScheme.dark ? 0.8 : 1}>
            {n}
          </Text>
        )}
      </ForEach>
    </VStack>
  );`,
      ),
    );

    expect(diagnostics(built.result)).toEqual([]);
    // An environment value is a property of the view reading it (the body's, or a row's).
    expect(swift).toContain(
      "  @Environment(\\.colorScheme) private var environment_colorScheme: ColorScheme",
    );
    expect(swift).toContain(
      'Text(environment_colorScheme == ColorScheme.dark ? "dark" : "light").onAppear { model.actions(0, [environment_colorScheme == ColorScheme.dark]) }',
    );
    // Swift's comparisons are not associative: one compared again keeps its parentheses.
    expect(swift).toContain(
      'Text((environment_colorScheme == ColorScheme.dark) == false ? "day" : "night")',
    );
    expect(swift).toMatch(
      /struct CounterRow0: View \{\n\s+@ObservedObject var item: CounterItem0\n\s+let actions: CounterActions\n\s+@Environment\(\\\.colorScheme\) private var environment_colorScheme: ColorScheme/,
    );
    expect(swiftErrors(built)).toBe("");
  }, 300_000);

  it("animates with Lucent values, and moves views in and out", () => {
    const { built, swift } = swiftOf(
      component(
        "Animation, AnyTransition, Text, VStack, withAnimation",
        "{ title: string }",
        `  const shown = signal(true);
  const speed = signal(0.3);

  expose({
    flip: () => {
      withAnimation(Animation.spring({ response: speed.peek() * 2, dampingFraction: 0.5 }), () => {
        shown.set(!shown.peek());
      });
    },
    slower: () => speed.set(speed.peek() + 0.1),
  });

  return (
    <VStack>
      {shown.get() ? (
        <Text transition={AnyTransition.opacity}>on</Text>
      ) : (
        <Text transition={AnyTransition.slide}>off</Text>
      )}
      <Text animation={[Animation.easeInOut({ duration: speed.get() }), { value: shown.get() }]}>
        {props.title}
      </Text>
    </VStack>
  );`,
      ),
    );

    expect(diagnostics(built.result)).toEqual([]);
    // withAnimation's Lucent values are its shim's arguments, computed when it runs.
    expect(swift).toMatch(
      /_animate0\(_ context: UnsafeMutableRawPointer, _ body: @convention\(c\) \(UnsafeMutableRawPointer\) -> Void, _ a0: Double\)/,
    );
    expect(swift).toContain(
      "withAnimation(Animation.spring(response: a0, dampingFraction: 0.5)) { body(context) }",
    );
    // A conditional view moves in and out with its transition.
    expect(swift).toMatch(/Text\("on"\)\.transition\(AnyTransition\.opacity\)/);
    expect(swift).toMatch(/Animation\.easeInOut\(duration: model\.speed\d+\)/);

    const glue = generated(built.result, /^ios\/m_counter\.mm$/);

    expect(glue).toMatch(
      /double (v\d+_) = speed\.peek\(\);\n.*double (v\d+_) = \1 \* 2\.0;[^]*double lucent_a0 = \2;/,
    );
    expect(swiftErrors(built)).toBe("");
  }, 300_000);

  it("passes the setup's functions only what crosses back", () => {
    const { built } = swiftOf(
      component(
        "Text",
        "{ title: string }",
        `  const choose = (range: { min: number }) => {
    console.log(\`\${range.min}\`);
  };

  return <Text onTapGesture={() => choose({ min: 1 })}>x</Text>;`,
      ),
    );

    expect(diagnostics(built.result)).toContainEqual(
      expect.stringMatching(
        /^LUCENT3024 a SwiftUI callback passes numbers, booleans and strings to the setup's functions/,
      ),
    );
  }, 300_000);
});
