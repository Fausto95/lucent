// The list spike's screen: a TodoList, a component whose view is written
// in Lucent with the platform's declarative UI (SwiftUI on iOS, Jetpack
// Compose on Android). Commands add todos (each animated in), toggle one
// done, type into its bound field, hide the done ones through its bound
// switch, remove one, and (iOS) move its bound slider; requests read its
// Lucent state, and a new title reaches its heading. Then the screen waits for taps and typing.
// Each step logs a LUCENT_VIEWS line (JavaScript's time in `at=`); each
// change the list makes a LUCENT_LIST line (the main thread's).
import { useEffect, useRef, useState } from "react";
import { type LayoutChangeEvent, SafeAreaView, Text, View } from "react-native";
// Components' React exports exist only when views are generated.
import * as list from "./list.lucent";

type TodoListRef = {
  add(title: string): void;
  toggle(id: number): void;
  remove(id: number): void;
  type(text: string): void;
  showDone(on: boolean): void;
  /** iOS's list only: its slider's value. */
  level?(to: number): void;
  state(): Promise<string>;
};

const { TodoList } = list as unknown as {
  TodoList: (props: {
    title: string;
    onChange?: (change: string, summary: string, at: number) => void;
    style?: object;
    ref?: React.Ref<TodoListRef>;
  }) => React.ReactNode;
};

// console.error: the only level a Release build logs (to the unified log).
const log = (line: string) => console.error(`LUCENT_VIEWS ${line}`);

export function ListSpike() {
  const todo = useRef<TodoListRef>(null);
  const [title, setTitle] = useState("Todo");
  const [lines, setLines] = useState<string[]>([]);

  useEffect(() => {
    // The effect's own: it runs once.
    const note = (line: string) => {
      log(`${line} at=${Date.now()}`);
      setLines((all) => [...all.slice(-10), line]);
    };
    const state = async () => note(`state: ${(await todo.current?.state()) ?? "no view"}`);
    const command = (name: string, run: (t: TodoListRef) => void) => () => {
      note(`command ${name}`);
      if (todo.current) run(todo.current);
    };

    const steps: [number, () => void][] = [
      [1000, () => void state()],
      [1500, command("add milk", (t) => t.add("milk"))],
      [2200, command("add eggs", (t) => t.add("eggs"))],
      [2900, command("add bread", (t) => t.add("bread"))],
      [3600, command("toggle 2", (t) => t.toggle(2))],
      [4300, command("type tea", (t) => t.type("tea"))],
      [5000, () => void state()],
      [5500, command("hide done", (t) => t.showDone(false))],
      [6500, command("show done", (t) => t.showDone(true))],
      [7500, command("remove 1", (t) => t.remove(1))],
      [8200, () => (note("prop title -> Groceries"), setTitle("Groceries"))],
      [8600, command("level 0.8", (t) => t.level?.(0.8))],
      [9000, () => void state()],
      [9500, () => note("waiting for taps and typing")],
    ];

    const timers = steps.map(([ms, step]) => setTimeout(step, ms));

    return () => timers.forEach(clearTimeout);
  }, []);

  const heard = (change: string, summary: string, at: number) => {
    const rx = Date.now();

    log(`event ${change}: ${summary} late=${rx - at} ms`);
  };

  const layout = (e: LayoutChangeEvent) => {
    const { width: w, height: h } = e.nativeEvent.layout;

    log(`layout list ${Math.round(w * 10) / 10}x${Math.round(h * 10) / 10}`);
  };

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <View style={{ padding: 16, gap: 12 }}>
        <Text style={{ fontWeight: "600" }}>Lucent list spike</Text>
        <View onLayout={layout} style={{ alignSelf: "flex-start" }}>
          <TodoList ref={todo} title={title} onChange={heard} />
        </View>
        {lines.map((line, i) => (
          <Text key={i} style={{ fontSize: 12 }}>
            {line}
          </Text>
        ))}
      </View>
    </SafeAreaView>
  );
}
