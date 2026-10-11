// TypeScript's mapped utility types over object types: each is the object
// type it resolves to, a struct by shape like any other.

export type Point = { x: number; y: number; label: string };

/** Partial: every field optional, so defaults fill what a caller leaves out. */
export function withDefaults(given: Partial<Point>): Point {
  const defaults: Point = { x: 0, y: 0, label: "origin" };
  return { ...defaults, ...given };
}

/** Pick and Omit keep the fields they name, or the others. */
export function picked(p: Pick<Point, "x" | "label">): string {
  return `${p.label}@${p.x}`;
}

export function omitted(p: Omit<Point, "label">): number {
  return p.x * p.y;
}

/** Required undoes Partial; Readonly keeps the fields as they are. */
export function required(p: Required<Partial<Point>>): string {
  return `${p.label}:${p.x},${p.y}`;
}

export function frozen(p: Readonly<Point>): string {
  return JSON.stringify(p);
}

/** A record of literal keys is an object type with those fields. */
export type Scores = Record<"home" | "away", number>;

export function total(s: Scores): number {
  return s.home + s.away;
}

export function scores(home: number): Scores {
  return { home, away: home + 1 };
}

/** Made and read in Lucent, through every form. */
export function inLucent(): string {
  const p = withDefaults({ y: 5 });
  const q: Pick<Point, "x" | "label"> = { x: 3, label: "q" };
  const r: Omit<Point, "label"> = { x: 2, y: 4 };
  const s: Required<Partial<Point>> = { x: 1, y: 1, label: "s" };
  const half: Partial<Point> = {};
  half.x = 7;
  return [
    JSON.stringify(p),
    picked(q),
    omitted(r),
    required(s),
    frozen(p),
    total(scores(2)),
    half.x,
    half.y === undefined,
  ].join(" ");
}

type Task = { title: string; done: boolean };

/**
 * Object.groupBy with literal keys makes an object type of optional
 * fields, one per key; a key no item gave reads as undefined.
 */
export function byState(tasks: Task[]): string {
  const groups = Object.groupBy(tasks, (t) => (t.done ? "done" : "todo"));
  const titles = (ts: Task[] | undefined) => (ts ? ts.map((t) => t.title).join(",") : "none");
  return `done=${titles(groups.done)} todo=${titles(groups.todo)}`;
}
