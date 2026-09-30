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
  Text,
  TextField,
  Toggle,
  VStack,
  withAnimation,
} from "lucent:swiftui";
import { bind, expose, range, signal } from "lucent:ui";
import type { TodoListProps } from "./list.lucent";

type Todo = { id: number; title: string; done: boolean };

/** One todo, a helper view: tapping its mark toggles it, its button removes it. */
function TodoRow(props: {
  id: number;
  title: string;
  done: boolean;
  onToggle: () => void;
  onRemove: (id: number) => void;
}) {
  return (
    <HStack transition={AnyTransition.slide}>
      <Text onTapGesture={props.onToggle}>{props.done ? "[x]" : "[ ]"}</Text>
      <Text>{props.title}</Text>
      <Button action={() => props.onRemove(props.id)}>remove</Button>
    </HStack>
  );
}

export function TodoList(props: TodoListProps) {
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

  return (
    <VStack alignment={HorizontalAlignment.leading} spacing={8} padding={8} frame={{ width: 320 }}>
      <Text font={Font.headline}>{heading()}</Text>
      <HStack>
        <TextField text={bind(draft)} onSubmit={() => addDraft()}>
          New todo
        </TextField>
        <Button action={() => addDraft()}>Add</Button>
      </HStack>
      <Text font={Font.caption} onTapGesture={() => typed()}>
        {`draft: ${draft.get()}`}
      </Text>
      <Toggle isOn={bind(showDone)}>Show done</Toggle>
      <HStack>
        <Text font={Font.caption}>{`level ${tenths(level.get())}`}</Text>
        <Slider
          value={bind(level)}
          in={range(0, 1)}
          step={0.1}
          onChange={[{ of: level.get() }, (now: number) => leveled(now)]}
        />
      </HStack>
      <ForEach data={shown()} id={(t) => t.id}>
        {(t) => (
          <TodoRow
            id={t.id}
            title={t.title}
            done={t.done}
            onToggle={() => toggle(t)}
            onRemove={remove}
          />
        )}
      </ForEach>
      {shown().length === 0 && <Text transition={AnyTransition.opacity}>nothing to do</Text>}
      <Text
        font={Font.caption}
        onAppear={() => seen(Environment((values) => values.colorScheme) === ColorScheme.dark)}
      >
        {Environment((values) => values.colorScheme) === ColorScheme.dark
          ? "dark scheme"
          : "light scheme"}
      </Text>
    </VStack>
  );
}
