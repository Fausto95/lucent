import {
  Alignment,
  BasicText,
  BasicTextField,
  Color,
  Column,
  dp,
  expandVertically,
  fadeIn,
  fadeOut,
  isSystemInDarkTheme,
  LaunchedEffect,
  LazyColumn,
  LocalDensity,
  Modifier,
  Row,
  shrinkVertically,
  Switch,
} from "lucent:compose";
import { bind, expose, signal } from "lucent:ui";
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
    <Row verticalAlignment={Alignment.CenterVertically}>
      {(row) => (
        <>
          <BasicText
            text={props.done ? "[x]" : "[ ]"}
            modifier={Modifier.clickable(props.onToggle).padding(dp(6))}
          />
          <BasicText text={props.title} modifier={row.Modifier.weight(1)} />
          <BasicText
            text="remove"
            modifier={Modifier.clickable(() => props.onRemove(props.id)).padding(dp(6))}
          />
        </>
      )}
    </Row>
  );
}

export function TodoList(props: TodoListProps) {
  const todos = signal<Todo[]>([]);
  const draft = signal("");
  const showDone = signal(true);
  const scheme = signal("unknown");
  const next = signal(1);

  const summary = (): string => {
    const all = todos.peek();
    const done = all.filter((t) => t.done).length;

    return `${all.length} todos, ${done} done, draft="${draft.peek()}", showDone=${showDone.peek()}, scheme=${scheme.peek()}`;
  };
  // Each change is logged with the main thread's time, and sent to JavaScript.
  const changed = (change: string) => {
    const at = Date.now();

    console.log(`LUCENT_LIST ${props.title} ${change}: ${summary()} at=${at}`);
    props.onChange?.(change, summary(), at);
  };

  const add = (title: string) => {
    if (title === "") return;

    const id = next.peek();

    todos.set([...todos.peek(), { id, title, done: false }]);
    next.set(id + 1);
    changed(`add ${id} ${title}`);
  };
  const addDraft = () => {
    add(draft.peek());
    draft.set("");
  };
  const toggle = (todo: Todo) => {
    todos.set(todos.peek().map((t) => (t.id === todo.id ? { ...t, done: !t.done } : t)));
    changed(`toggle ${todo.id}`);
  };
  const remove = (id: number) => {
    todos.set(todos.peek().filter((t) => t.id !== id));
    changed(`remove ${id}`);
  };
  const shown = (): Todo[] => todos.get().filter((t) => showDone.get() || !t.done);
  const heading = (): string => {
    const all = todos.get();

    return `${props.title}: ${all.length} todos, ${all.filter((t) => t.done).length} done`;
  };
  const seen = (dark: boolean, density: number) => {
    scheme.set(`${dark ? "dark" : "light"} ${density}x`);
    changed("scheme");
  };

  expose({
    add: (title: string) => add(title),
    toggle: (id: number) => {
      const todo = todos.peek().find((t) => t.id === id);

      if (todo) toggle(todo);
    },
    remove: (id: number) => remove(id),
    type: (text: string) => draft.set(text),
    showDone: (on: boolean) => showDone.set(on),
    state: (): string => summary(),
  });

  // What composes: lifted into the content.
  const density = LocalDensity.current.density;
  const dark = isSystemInDarkTheme();

  LaunchedEffect(dark, async () => {
    seen(dark, density);
  });

  return (
    <Column modifier={Modifier.width(dp(320)).padding(dp(8)).animateContentSize()}>
      {(column) => (
        <>
          <BasicText text={heading()} />
          <Row verticalAlignment={Alignment.CenterVertically}>
            {(row) => (
              <>
                <BasicTextField
                  value={bind(draft)}
                  singleLine
                  modifier={row.Modifier.weight(1).background(Color(0xffeeeeee)).padding(dp(6))}
                />
                <BasicText
                  text="Add"
                  modifier={Modifier.clickable(() => addDraft()).padding(dp(8))}
                />
              </>
            )}
          </Row>
          <BasicText text={`draft: ${draft.get()}`} />
          <Row verticalAlignment={Alignment.CenterVertically}>
            {(row) => (
              <>
                <BasicText text="Show done" modifier={row.Modifier.weight(1)} />
                <Switch checked={bind(showDone)} />
              </>
            )}
          </Row>
          <LazyColumn modifier={Modifier.height(dp(180))}>
            {(list) => (
              <list.items items={shown()} key={(t) => t.id}>
                {(_, t) => (
                  <TodoRow
                    id={t.id}
                    title={t.title}
                    done={t.done}
                    onToggle={() => toggle(t)}
                    onRemove={remove}
                  />
                )}
              </list.items>
            )}
          </LazyColumn>
          <column.AnimatedVisibility
            visible={shown().length === 0}
            enter={fadeIn().plus(expandVertically())}
            exit={fadeOut().plus(shrinkVertically())}
          >
            <BasicText text="nothing to do" />
          </column.AnimatedVisibility>
          <BasicText text={`${density}x density, ${dark ? "dark" : "light"}`} />
        </>
      )}
    </Column>
  );
}
