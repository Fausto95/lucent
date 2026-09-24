import type { Block } from "../../types";

export const blocks: Block[] = [
  {
    kind: "p",
    text: "Objects are freed when the last reference to them goes: Lucent counts references, as Swift does. Most code never notices. Three cases need care.",
  },
  { kind: "h2", text: "Cycles are never freed" },
  {
    kind: "code",
    filename: "graph.lucent.ts",
    code: `export class GraphNode {
  next: GraphNode | null = null;
}

export function ring(): number {
  const a = new GraphNode();
  const b = new GraphNode();
  a.next = b;
  b.next = a; // a and b now keep each other alive
  const size = a.next === b ? 2 : 1;
  a.next = null; // break the cycle, so both can be freed
  return size;
}`,
  },
  {
    kind: "p",
    text: "Two objects that point at each other keep each other alive. Break the cycle when you're done: set one link to `null`, or keep such links in a `Map` you clear.",
  },
  { kind: "h2", text: "Delegates and listeners live until removed" },
  {
    kind: "code",
    filename: "ticks.lucent.ts",
    code: `const listeners = new Map<number, (tick: number) => void>();
let nextId = 1;

export function subscribe(listener: (tick: number) => void): number {
  const id = nextId++;
  listeners.set(id, listener);
  return id;
}

export function unsubscribe(id: number): void {
  listeners.delete(id); // the only way the listener is freed
}`,
  },
  {
    kind: "p",
    text: "An SDK object holds on to the delegate or listener you give it, and the listener often holds a JS callback. Give every `subscribe` an `unsubscribe`, and remove the SDK registration there too.",
  },
  {
    kind: "p",
    text: "Debug builds log what's left when the app reloads: `[lucent] 2 native reference(s) still held at teardown`.",
  },
  { kind: "h2", text: "Close sessions and files yourself" },
  {
    kind: "code",
    filename: "log.lucent.ts",
    code: `export class LogWriter {
  private lines: string[] = [];
  private open = true;

  write(line: string): void {
    if (!this.open) throw new Error("LogWriter is closed");
    this.lines.push(line);
  }

  close(): string[] {
    this.open = false;
    return this.lines;
  }
}`,
  },
  {
    kind: "p",
    text: "Give classes that hold a session, a file or a sensor a `close()` method, and call it from JavaScript in a `finally`. JavaScript's garbage collector decides when a JS reference goes, so don't rely on it to release native resources.",
  },
  {
    kind: "p",
    text: "There's no `Weak` reference and no `using` statement yet ([roadmap](/docs/status/)).",
  },
];
