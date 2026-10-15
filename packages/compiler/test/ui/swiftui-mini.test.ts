/**
 * SwiftUI bodies built where Xcode is missing (mini-swiftui.ts): a
 * component compiled against a miniature SwiftUI's schema has its Swift
 * generated, and the Swift type-checks against the miniature modules.
 * The body uses what the writer's main paths take: stacks with labeled
 * arguments and builder content, modifiers, an `if`, a callback calling
 * a setup function, a bound signal, and a keyed list.
 */
import { describe, expect, it } from "vite-plus/test";
import { buildSwiftUI, miniSwiftErrors, miniSwiftUI } from "./mini-swiftui.ts";

const mini = miniSwiftUI();

const FILES = {
  "todos.lucent.ts": `import type { View } from "lucent:swiftui";

export type Props = { title: string };

export declare function Todos(props: Props): View;
`,
  "todos.ios.lucent.tsx": `import { Button, Color, Font, ForEach, HStack, Text, Toggle, VStack } from "lucent:swiftui";
import { bind, signal } from "lucent:ui";
import type { Props } from "./todos.lucent";

type Todo = { id: number; title: string };

export function Todos(props: Props) {
  const todos = signal<Todo[]>([{ id: 1, title: "milk" }]);
  const shown = signal(true);
  const remove = (id: number) => {
    todos.set(todos.peek().filter((t) => t.id !== id));
  };
  const clear = () => {
    todos.set([]);
  };

  return (
    <VStack spacing={8} padding={12}>
      <Text font={Font.headline} foregroundStyle={shown.get() ? Color.blue : Color.gray}>
        {props.title}
      </Text>
      <Toggle isOn={bind(shown)}>Shown</Toggle>
      {shown.get() ? (
        <ForEach data={todos.get()} id={(t) => t.id}>
          {(t) => (
            <HStack>
              <Text>{t.title}</Text>
              <Button action={() => remove(t.id)}>remove</Button>
            </HStack>
          )}
        </ForEach>
      ) : (
        <Text>hidden</Text>
      )}
      <Text onTapGesture={clear}>clear</Text>
    </VStack>
  );
}
`,
};

/** Instance props (decisions 0121, 0122) and a callback's computed arguments (T123). */
const INSTANCES = {
  "player.lucent.ts": `export class Player {
  constructor(readonly title: string) {}

  label(): string {
    return \`#\${this.title}\`;
  }
}
`,
  "screen.lucent.ts": `import type { View } from "lucent:swiftui";
import type { Player } from "./player.lucent";

export type Props = {
  title: string;
  player: Player;
  next: Player | null;
  players: Player[];
  onPick?: (label: string, n: number) => void;
};

export declare function Screen(props: Props): View;
`,
  "screen.ios.lucent.tsx": `import { Button, ForEach, HStack, Text, VStack } from "lucent:swiftui";
import type { Player } from "./player.lucent";
import type { Props } from "./screen.lucent";

let taps = 0;

function tapped(): number {
  taps++;
  return taps;
}

export function Screen(props: Props) {
  const pick = (label: string, n: number) => {
    props.onPick?.(label, n);
  };
  const play = (p: Player) => {
    props.onPick?.(p.label(), 0);
  };

  return (
    <VStack>
      <Text onTapGesture={() => pick(props.title, tapped())}>{props.player.title}</Text>
      <Text>{props.player.label()}</Text>
      <Text>{props.next?.title ?? "none"}</Text>
      <Button action={() => play(props.player)}>play</Button>
      <ForEach data={props.players} id={(p) => p.title}>
        {(p) => (
          <HStack>
            <Text>{p.label()}</Text>
            <Button action={() => play(p)}>pick</Button>
          </HStack>
        )}
      </ForEach>
    </VStack>
  );
}
`,
};

describe.skipIf(!mini)("a SwiftUI body against the miniature SwiftUI", () => {
  it("generates Swift that type-checks", () => {
    const built = buildSwiftUI(mini!, FILES);

    expect(built.result.diagnostics.map((d) => `${d.code} ${d.message}`)).toEqual([]);

    const swift = [...built.result.files].find(([f]) => f.endsWith(".swift"))?.[1] ?? "";

    expect(swift).toContain("VStack(spacing: 8) {");
    expect(swift).toMatch(/Text\(model\.title\d+\)\.font\(Font\.headline\)\.foregroundStyle\(/);
    expect(swift).toMatch(
      /Toggle\("Shown", isOn: Binding\(get: \{ model\.\w+ \}, set: \{ model\.actions\(\d+, \[\$0\]\) \}\)\)/,
    );
    expect(swift).toMatch(
      /ForEach\(model\.list_0\) \{ item in TodosRow0\(item: item, actions: model\.actions\) \}/,
    );
    expect(swift).toMatch(/Button\("remove"\) \{ actions\(\d+, \[item\.\w+\]\) \}/);
    expect(swift).toMatch(/\}\.padding\(12\)/);
    expect(miniSwiftErrors(mini!, built)).toBe("");
  }, 300_000);

  it("shows instance props and lists of them, and computes a callback's arguments when it runs", () => {
    const built = buildSwiftUI(mini!, INSTANCES);

    expect(built.result.diagnostics.map((d) => `${d.code} ${d.message}`)).toEqual([]);

    const swift =
      [...built.result.files].find(
        ([f]) => f.startsWith("ios/views/") && f.endsWith(".swift"),
      )?.[1] ?? "";

    // What the setup computes from an instance crosses as values; Swift never names its class.
    expect(swift).toMatch(/Text\(model\.\w+\)\n\s+Text\(model\.\w+\)\n/);
    expect(swift).not.toContain("Player");
    // A callback's arguments the setup computes are not Swift's to give.
    expect(swift).toMatch(/\.onTapGesture \{ model\.actions\(\d+\) \}/);
    expect(swift).toMatch(/Button\("play"\) \{ model\.actions\(\d+\) \}/);
    // A list's instance crosses as its key.
    expect(swift).toMatch(/Button\("pick"\) \{ actions\(\d+, \[item\.id\]\) \}/);
    expect(miniSwiftErrors(mini!, built)).toBe("");
  }, 300_000);
});
