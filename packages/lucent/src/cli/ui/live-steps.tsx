/** @jsxRuntime automatic */
import { render, Static, Text } from "ink";
import { useEffect, useState, useSyncExternalStore } from "react";
import { type StepResult, type Steps, stepLine } from "./steps.ts";
import type { Theme } from "./theme.ts";

type State = { done: StepResult[]; running?: { label: string } };

const FRAMES = ["◐", "◓", "◑", "◒"];

function StepList({ store, theme }: { store: Store; theme: Theme }) {
  const state = useSyncExternalStore(store.subscribe, store.get);
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setFrame((f) => (f + 1) % FRAMES.length), 120);
    return () => clearInterval(timer);
  }, []);
  const spinner = theme.terminal.unicode ? FRAMES[frame]! : theme.symbols.busy;
  return (
    <>
      <Static items={state.done}>{(r, i) => <Text key={i}>{stepLine(r, theme)}</Text>}</Static>
      {state.running ? (
        <Text>{`${theme.progress(spinner)} ${state.running.label}${theme.dim(theme.symbols.ellipsis)}`}</Text>
      ) : null}
    </>
  );
}

interface Store {
  get(): State;
  set(next: State): void;
  subscribe(listener: () => void): () => void;
}

function createStore(): Store {
  let state: State = { done: [] };
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(next) {
      state = next;
      for (const l of listeners) l();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Steps shown live in an interactive terminal: finished steps stay, the running one spins. */
export function liveSteps(theme: Theme, stdout: NodeJS.WriteStream = process.stdout): Steps {
  const store = createStore();
  const app = render(<StepList store={store} theme={theme} />, { patchConsole: false, stdout });
  const results: StepResult[] = [];
  let closed = false;
  return {
    results,
    start(_name, label) {
      store.set({ ...store.get(), running: { label } });
    },
    finish(r) {
      results.push(r);
      store.set({ done: [...store.get().done, r] });
    },
    // Compiles block the event loop: let Ink paint the running step first.
    flush: () => new Promise((resolve) => setTimeout(resolve, 20)),
    async close() {
      if (closed) return;
      closed = true;
      store.set({ ...store.get(), running: undefined });
      // React commits the last steps asynchronously: let Ink draw them before unmounting.
      await new Promise((resolve) => setTimeout(resolve, 20));
      app.unmount();
      await app.waitUntilExit();
    },
  };
}
