// The list spike's component, in one file for both platforms: a todo list
// whose logic is written once and whose view is written with each
// platform's declarative UI (SwiftUI on iOS, Jetpack Compose on Android),
// each item a helper view of its toolkit. Its items are keyed, each with
// its own state and actions; a text field and a switch (and on iOS, a
// slider) are bound to signals; items move in and out animated; the view
// reads the color scheme (and on Android, the screen's density).
// Internal, like the views spike (scripts/views-spike.ts --entry list.js).
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
import { PLATFORM } from "lucent:platform";
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

export type TodoListProps = {
  title: string;
  /** After each change: what changed, the list's summary, and when (the main thread's time). */
  onChange?: (change: string, summary: string, at: number) => void;
};

type Todo = { id: number; title: string; done: boolean };

/** One todo on iOS, a SwiftUI helper view: tapping its mark toggles it, its button removes it. */
function SwiftUIRow(props: {
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

/** One todo on Android, a Compose helper view: tapping its mark toggles it, its text removes it. */
function ComposeRow(props: {
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
  const speed = signal(0.35);
  const level = signal(0.5);

  // The slider's value as the user sees it (iOS): its steps are tenths.
  const tenths = (n: number): number => Math.round(n * 10) / 10;

  const summary = (): string => {
    const all = todos.peek();
    const done = all.filter((t) => t.done).length;
    const seen = `${all.length} todos, ${done} done, draft="${draft.peek()}", showDone=${showDone.peek()}, scheme=${scheme.peek()}`;

    return PLATFORM === "ios" ? `${seen}, level=${tenths(level.peek())}` : seen;
  };
  // Each change is logged with the main thread's time, and sent to JavaScript.
  const changed = (change: string) => {
    const at = Date.now();

    console.log(`LUCENT_LIST ${props.title} ${change}: ${summary()} at=${at}`);
    props.onChange?.(change, summary(), at);
  };
  // iOS animates each change with withAnimation; Compose animates its list and its visibility.
  const animated = (change: () => void) => {
    if (PLATFORM === "ios")
      withAnimation(Animation.spring({ response: speed.peek(), dampingFraction: 0.8 }), change);
    else change();
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
  const seenAt = (dark: boolean, density: number) => {
    scheme.set(`${dark ? "dark" : "light"} ${density}x`);
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

  if (PLATFORM === "ios")
    return (
      <VStack
        alignment={HorizontalAlignment.leading}
        spacing={8}
        padding={8}
        frame={{ width: 320 }}
      >
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
            <SwiftUIRow
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

  // What composes: lifted into the content.
  const density = LocalDensity.current.density;
  const dark = isSystemInDarkTheme();

  LaunchedEffect(dark, async () => {
    seenAt(dark, density);
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
                  <ComposeRow
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
