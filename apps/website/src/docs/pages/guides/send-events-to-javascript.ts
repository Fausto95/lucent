import type { Block } from "../../types";

export const blocks: Block[] = [
  {
    kind: "tabs",
    tabs: [
      {
        label: "module",
        filename: "ticker.lucent.ts",
        code: `import { delay } from "lucent:core";

const running = new Set<number>();
let nextId = 1;

/** Calls \`onTick\` every \`ms\` milliseconds, until \`stop(id)\`. */
export async function start(ms: number, onTick: (count: number) => void): Promise<number> {
  const id = nextId++;
  running.add(id);
  void tick(id, ms, onTick);
  return id;
}

async function tick(id: number, ms: number, onTick: (count: number) => void): Promise<void> {
  let count = 0;
  while (running.has(id)) {
    await delay(ms);
    if (running.has(id)) onTick(++count);
  }
}

export function stop(id: number): void {
  running.delete(id);
}`,
      },
      {
        label: "JS usage",
        filename: "Clock.tsx",
        code: `import { useEffect, useState } from "react";
import { Text } from "react-native";
import { start, stop } from "./src/ticker.lucent";

export function Clock() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const started = start(1000, setCount);
    return () => void started.then(stop);
  }, []);
  return <Text>{count}</Text>;
}`,
      },
    ],
  },
  {
    kind: "list",
    items: [
      "JavaScript passes a function, and Lucent keeps it while `tick` runs. Each call from async code is posted to the JS thread.",
      "`start` returns an id and `stop` takes it back. Stopping is what lets go of the function.",
      "An event handler called from async code must return `void` or a `Promise`.",
    ],
  },
  {
    kind: "p",
    text: "For events that come from the SDK, keep the delegate or listener in a `Map` by id instead of the `Set`. [Implement a delegate or listener](/docs/guides/implement-a-delegate/) shows one, and the [network state example](/docs/examples/netinfo/) the whole pattern.",
  },
];
