import {
  Animation,
  AnyTransition,
  Button,
  ColorScheme,
  Environment,
  Font,
  ForEach,
  HorizontalAlignment,
  HStack,
  Slider,
  swiftUI,
  Text,
  TextField,
  Toggle,
  type UIHostingController,
  VStack,
  withAnimation,
} from "lucent:swiftui";
import { bind, expose, range, signal } from "lucent:ui";
import type { TodoListProps } from "./list.lucent";

type Todo = { id: number; title: string; done: boolean };

export function TodoList(props: TodoListProps): UIHostingController {
  const todos = signal<Todo[]>([]);
  const draft = signal("");
  const showDone = signal(true);
  const scheme = signal("unknown");
  const next = signal(1);
  const speed = signal(0.35);
  const level = signal(0.5);

  // The slider's value as the user sees it: its steps are tenths.
  const tenths = (n: number): number => Math.round(n * 10) / 10;

  const summary = (): string => {
    const all = todos.peek();
    const done = all.filter((t) => t.done).length;

    return `${all.length} todos, ${done} done, draft="${draft.peek()}", showDone=${showDone.peek()}, scheme=${scheme.peek()}, level=${tenths(level.peek())}`;
  };
  // Each change is logged with the main thread's time, and sent to JavaScript.
  const changed = (change: string) => {
    const at = Date.now();

    console.log(`LUCENT_LIST ${props.title} ${change}: ${summary()} at=${at}`);
    props.onChange?.(change, summary(), at);
  };
  const animated = (change: () => void) => {
    withAnimation(Animation.spring({ response: speed.peek(), dampingFraction: 0.8 }), change);
  };

  const add = (title: string) => {
    if (title === "") return;

    const id = next.peek();

    animated(() => {
      todos.set([...todos.peek(), { id, title, done: false }]);
      next.set(id + 1);
    });
    changed(`add ${id} ${title}`);
  };
  const addDraft = () => {
    add(draft.peek());
    draft.set("");
  };
  const toggle = (todo: Todo) => {
    animated(() => {
      todos.set(todos.peek().map((t) => (t.id === todo.id ? { ...t, done: !t.done } : t)));
    });
    changed(`toggle ${todo.id}`);
  };
  const remove = (id: number) => {
    animated(() => {
      todos.set(todos.peek().filter((t) => t.id !== id));
    });
    changed(`remove ${id}`);
  };
  const shown = (): Todo[] => todos.get().filter((t) => showDone.get() || !t.done);
  const heading = (): string => {
    const all = todos.get();

    return `${props.title}: ${all.length} todos, ${all.filter((t) => t.done).length} done`;
  };
  const seen = (dark: boolean) => {
    scheme.set(dark ? "dark" : "light");
    changed("scheme");
  };
  const typed = () => changed("typed");
  const leveled = (now: number) => changed(`level ${tenths(now)}`);

  expose({
    add: (title: string) => add(title),
    toggle: (id: number) => {
      const todo = todos.peek().find((t) => t.id === id);

      if (todo) toggle(todo);
    },
    remove: (id: number) => remove(id),
    type: (text: string) => draft.set(text),
    showDone: (on: boolean) => showDone.set(on),
    level: (to: number) => level.set(to),
    state: (): string => summary(),
  });

  return swiftUI(() =>
    VStack({ alignment: HorizontalAlignment.leading, spacing: 8 }, [
      Text(heading()).font(Font.headline),
      HStack([
        TextField("New todo", { text: bind(draft) }).onSubmit(() => addDraft()),
        Button("Add", () => addDraft()),
      ]),
      Text(`draft: ${draft.get()}`)
        .font(Font.caption)
        .onTapGesture(() => typed()),
      Toggle("Show done", { isOn: bind(showDone) }),
      HStack([
        Text(`level ${tenths(level.get())}`).font(Font.caption),
        Slider({ value: bind(level), in: range(0, 1), step: 0.1 }).onChange(
          { of: level.get() },
          (now) => leveled(now),
        ),
      ]),
      ForEach(shown(), { id: (t) => t.id }, (t) =>
        HStack([
          Text(t.done ? "[x]" : "[ ]").onTapGesture(() => toggle(t)),
          Text(t.title),
          Button("remove", () => remove(t.id)),
        ]).transition(AnyTransition.slide),
      ),
      shown().length === 0 && Text("nothing to do").transition(AnyTransition.opacity),
      Text(
        Environment((values) => values.colorScheme) === ColorScheme.dark
          ? "dark scheme"
          : "light scheme",
      )
        .font(Font.caption)
        .onAppear(() => seen(Environment((values) => values.colorScheme) === ColorScheme.dark)),
    ])
      .padding(8)
      .frame({ width: 320 }),
  );
}
