// The list spike's component, declared for every platform: a todo list
// whose view is written in Lucent with the platform's declarative UI
// (SwiftUI in list.ios.lucent.tsx, Jetpack Compose in
// list.android.lucent.tsx). Its items are keyed, each with its own state
// and actions; a text field and a switch (and on iOS, a slider) are bound
// to signals; items move in and out animated; the view reads the color scheme (or the screen's
// width). Internal, like the views spike (scripts/views-spike.ts --entry
// list.js).
import type { ComposeView } from "lucent:compose";
import type { View } from "lucent:swiftui";

export type TodoListProps = {
  title: string;
  /** After each change: what changed, the list's summary, and when (the main thread's time). */
  onChange?: (change: string, summary: string, at: number) => void;
};

export declare function TodoList(props: TodoListProps): View | ComposeView;
