import type { Block } from "../../types";

export const blocks: Block[] = [
    {
      kind: "p",
      text: "Type parameters on functions, classes, interfaces and type aliases are supported. Each generic becomes a C++ template, and every use with concrete types (`Queue<string>`, `first<number>`) produces a specialized native version, with no boxing.",
    },
    {
      kind: "code",
      filename: "words.lucent.ts",
      code: `function groupBy<T>(xs: T[], key: (x: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const x of xs) {
    const k = key(x);
    const list = out.get(k);
    if (list) list.push(x);
    else out.set(k, [x]);
  }
  return out;
}

class Queue<T> {
  private items: T[] = [];
  push(item: T): void {
    this.items.push(item);
  }
  shift(): T | undefined {
    return this.items.shift();
  }
}

export function byInitial(words: string[]): Map<string, string[]> {
  return groupBy(words, (w) => w.charAt(0));
}

export function roundRobin(jobs: string[], rounds: number): string[] {
  const q = new Queue<string>();
  for (const j of jobs) q.push(j);
  const out: string[] = [];
  for (let i = 0; i < rounds; i++) {
    const j = q.shift();
    if (j === undefined) break;
    out.push(j);
    q.push(j);
  }
  return out;
}`,
    },
    { kind: "h2", text: "Generics cannot be exported" },
    {
      kind: "p",
      text: "JavaScript has no way to choose `T`, so a generic function or class cannot be exported (`LUCENT2007`). Keep generics inside the module, as above, and export concrete wrappers such as `byInitial`.",
    },
    {
      kind: "code",
      filename: "first.lucent.ts",
      expect: "LUCENT2007",
      code: `export function first<T>(xs: T[]): T | undefined {
  return xs[0];
}`,
    },
    {
      kind: "p",
      text: "A generic type alias used with concrete arguments, such as `Pair<number, string>` for `type Pair<A, B> = { first: A; second: B }`, is just an object type and can cross the boundary.",
    },
    { kind: "h2", text: "Working with T" },
    {
      kind: "p",
      text: "Inside a generic body, treat a `T` value as opaque: store it, pass it on, return it. Reading members through a constraint (`T extends { length: number }`, then `x.length`) is not supported. When the body needs something from `T`, take a function parameter, as `groupBy` takes `key`.",
    },
    {
      kind: "p",
      text: "A generic function also cannot be used as a value (`const f: (x: number) => number = identity`). Wrap it in an arrow function instead: `(x: number) => identity(x)`.",
    },
    { kind: "h2", text: "Generic interfaces" },
    {
      kind: "p",
      text: "Interfaces can be generic, and classes implement a specific instantiation or pass their own parameter through. Generic interfaces follow the same nominal rules as other interfaces with methods (see [Classes](/docs/language/classes/)).",
    },
    {
      kind: "code",
      filename: "feeds.lucent.ts",
      code: `interface Feed<T> {
  next(): T | undefined;
}

class Countdown implements Feed<number> {
  constructor(private n: number) {}
  next(): number | undefined {
    return this.n > 0 ? this.n-- : undefined;
  }
}

class ListFeed<T> implements Feed<T> {
  private i = 0;
  constructor(private items: T[]) {}
  next(): T | undefined {
    return this.items[this.i++];
  }
}

function drain<T>(feed: Feed<T>, show: (v: T) => string): string {
  const out: string[] = [];
  for (let v = feed.next(); v !== undefined; v = feed.next()) out.push(show(v));
  return out.join(",");
}

export function feeds(): string {
  return \`\${drain(new Countdown(3), (n) => \`\${n}\`)} \${drain(new ListFeed(["a", "b"]), (s) => s.toUpperCase())}\`;
}`,
    },
];
