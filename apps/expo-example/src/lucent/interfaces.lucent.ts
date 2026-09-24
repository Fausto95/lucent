import { delay } from "lucent:core";

export interface Shape {
  readonly kind: string;
  area(): number;
  describe(prefix: string): string;
}

export interface Named {
  name: string;
}

export class Circle implements Shape, Named {
  readonly kind = "circle";
  name = "c";
  constructor(private r: number) {}
  area(): number {
    return Math.PI * this.r * this.r;
  }
  describe(prefix: string): string {
    return `${prefix} circle r=${this.r}`;
  }
}

export class Rect implements Shape {
  constructor(
    private w: number,
    private h: number,
  ) {}
  get kind(): string {
    return "rect";
  }
  area(): number {
    return this.w * this.h;
  }
  describe(prefix: string): string {
    return `${prefix} rect ${this.w}x${this.h}`;
  }
}

export function totalArea(shapes: Shape[]): number {
  let sum = 0;
  for (const s of shapes) sum += s.area();
  return Math.round(sum * 100) / 100;
}

export function describeAll(): string {
  const shapes: Shape[] = [new Circle(1), new Rect(2, 3)];
  return shapes.map((s) => `${s.kind}: ${s.describe(">")}`).join("; ");
}

export function largest(shapes: Shape[]): Shape | undefined {
  let best: Shape | undefined;
  for (const s of shapes) if (best === undefined || s.area() > best.area()) best = s;
  return best;
}

export function same(a: Shape, b: Shape): boolean {
  return a === b;
}

export function rename(n: Named, to: string): string {
  n.name = to;
  return n.name;
}

export function circleNames(shapes: Shape[]): string {
  const names: string[] = [];
  for (const s of shapes) if (s instanceof Circle) names.push(s.name);
  return names.join(",");
}

interface Counter {
  next(): number;
}

class Up implements Counter {
  private i = 0;
  next(): number {
    return ++this.i;
  }
}

class Down implements Counter {
  constructor(private i: number) {}
  next(): number {
    return this.i--;
  }
}

export function counters(): string {
  const cs: Counter[] = [new Up(), new Down(3)];
  const out: number[] = [];
  for (let k = 0; k < 3; k++) for (const c of cs) out.push(c.next());
  return out.join(",");
}

interface Source {
  load(key: string): Promise<string>;
}

class Echo implements Source {
  async load(key: string): Promise<string> {
    await delay(1);
    return `${key}!`;
  }
}

export async function loadVia(key: string): Promise<string> {
  const s: Source = new Echo();
  return `${await s.load(key)} ${await s.load(key.toUpperCase())}`;
}

export interface Feed<T> {
  readonly count: number;
  next(): T | undefined;
}

class Countdown implements Feed<number> {
  count = 0;
  constructor(private n: number) {}
  next(): number | undefined {
    if (this.n <= 0) return undefined;
    this.count++;
    return this.n--;
  }
}

class ListSource<T> implements Feed<T> {
  count = 0;
  private i = 0;
  constructor(private items: T[]) {}
  next(): T | undefined {
    const v = this.items[this.i];
    if (v !== undefined) {
      this.i++;
      this.count++;
    }
    return v;
  }
}

function drain<T>(s: Feed<T>, show: (v: T) => string): string {
  const out: string[] = [];
  for (let v = s.next(); v !== undefined; v = s.next()) out.push(show(v));
  return `${out.join(",")} (${s.count})`;
}

export function feeds(): string {
  const words: Feed<string> = new ListSource(["a", "b"]);
  return [
    drain(new Countdown(3), (n) => `${n}`),
    drain(words, (s) => s.toUpperCase()),
    drain(new ListSource([1, 2]), (n) => `${n * 10}`),
  ].join(" | ");
}

export interface Labelled {
  readonly label: string;
}

export interface Tagged extends Labelled {
  tag(): string;
}

class Item implements Tagged {
  constructor(public label: string) {}
  tag(): string {
    return `#${this.label}`;
  }
}

class Special implements Tagged, Labelled {
  label = "special";
  tag(): string {
    return "!";
  }
}

function labelOf(l: Labelled): string {
  return l.label;
}

export function tagged(): string {
  const xs: Tagged[] = [new Item("x"), new Special()];
  return xs.map((t) => `${labelOf(t)}${t.tag()}`).join(" ");
}

export function exportTagged(): Tagged {
  return new Item("out");
}
