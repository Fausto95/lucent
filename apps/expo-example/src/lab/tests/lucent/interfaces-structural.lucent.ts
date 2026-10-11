// An object literal stands for a data-only interface that classes
// implement too, as TypeScript allows: one object, with JavaScript's
// identity and mutation, written as JSON by its fields and given to
// JavaScript as a plain object.

export interface Point {
  x: number;
  y: number;
}

export interface Labeled {
  label: string;
  readonly size?: number;
}

/** An interface extending another: a literal has every member. */
export interface Placed extends Point {
  name: string;
}

export class Pixel implements Point {
  constructor(
    public x: number,
    public y: number,
  ) {}
}

class Tag implements Labeled {
  readonly size?: number;

  constructor(public label: string) {}
}

class Pin implements Placed {
  constructor(
    public x: number,
    public y: number,
    public name: string,
  ) {}
}

function norm(p: Point): number {
  return Math.hypot(p.x, p.y);
}

export function literals(): string {
  const a: Point = { x: 3, y: 4 };
  const b: Point = new Pixel(6, 8);
  const both: Point[] = [a, b, { x: 0, y: 1 }];
  a.x = 5;
  return `${both.map((p) => norm(p)).join(",")} ${a.x} ${norm({ x: 3, y: 4 })}`;
}

/** One object: an alias sees a change, and is the same value. */
export function identity(): string {
  const a: Point = { x: 1, y: 1 };
  const alias = a;
  alias.y = 9;
  return `${a.y} ${a === alias}`;
}

export function labeled(): string {
  const l: Labeled = { label: "a" };
  const m: Labeled = { label: "b", size: 2 };
  const t: Labeled = new Tag("c");
  return [l, m, t].map((x) => `${x.label}:${x.size}`).join(" ");
}

export function placed(): string {
  const p: Placed = { x: 1, y: 2, name: "home" };
  const q: Placed = new Pin(3, 4, "work");
  const point: Point = p;
  return `${p.name} ${norm(point).toFixed(3)} ${q.name} ${norm(q)}`;
}

/** JSON writes a literal's fields, and a class instance's, as JavaScript does. */
export function json(): string {
  const a: Point = { x: 1, y: 2 };
  const b: Point = new Pixel(3, 4);
  return JSON.stringify([a, b]);
}

/** To JavaScript, a literal is a plain object. */
export function toJs(): Point {
  return { x: 7, y: 8 };
}

export function placedToJs(): Placed {
  return { x: 1, y: 2, name: "home" };
}
