import { compute } from "lucent:core";

// The edge detector: positions where neighbouring bytes differ by more than 40.
function edgePositions(bytes: Uint8Array): number[] {
  const positions: number[] = [];

  for (let i = 1; i < bytes.length; i++) {
    if (Math.abs(bytes[i]! - bytes[i - 1]!) > 40) positions.push(i);
  }

  return positions;
}

export async function edges(bytes: Uint8Array, signal?: AbortSignal): Promise<number[]> {
  return await compute(edgePositions, bytes, { signal });
}

function checkedRoot(n: number): number {
  if (n < 0) throw new RangeError(`negative: ${n}`);

  return Math.sqrt(n);
}

export async function root(n: number): Promise<string> {
  try {
    return `ok ${await compute(checkedRoot, n)}`;
  } catch (e) {
    return `${(e as Error).name}: ${(e as Error).message}`;
  }
}

function spin(n: number): number {
  let x = 0;

  for (let i = 0; i < n; i++) x = (x * 31 + i) % 1000003;

  return x;
}

/** Aborted before it is submitted, or right after: the promise rejects with the signal's reason. */
export async function cancelled(when: string): Promise<string> {
  const controller = new AbortController();

  if (when === "before") controller.abort();

  const pending = compute(spin, 200_000_000, { signal: controller.signal });

  if (when === "after") controller.abort(new Error(`stopped ${when}`));

  try {
    return `ran ${await pending}`;
  } catch (e) {
    // The default reason's message is the platform's own.
    return when === "after" ? `${(e as Error).name}: ${(e as Error).message}` : (e as Error).name;
  }
}

function sum(xs: number[]): number {
  let total = 0;

  for (const x of xs) total += x;

  return total;
}

/** The task sees the input as it was at submission. */
export async function snapshot(): Promise<string> {
  const xs = [1, 2, 3];
  const pending = compute(sum, xs);

  xs.push(100);
  xs[0] = 50;

  return `${await pending} ${xs.join(",")}`;
}

type Node = { label: string; next?: Node };
type Pair = { a: Node; b: Node; list: number[]; same: number[] };

function describeGraph(p: Pair): string {
  p.list.push(4);

  const cycle = p.a.next === p.b && p.b.next === p.a;

  // Arrays reached twice are one array: the push shows through `same`.
  return `${cycle} ${p.same.length} ${p.a.label}${p.b.label}`;
}

/** Aliases and cycles survive the copy; the caller's objects stay as they were. */
export async function graph(): Promise<string> {
  const a: Node = { label: "a" };
  const b: Node = { label: "b", next: a };
  const list = [1, 2, 3];

  a.next = b;

  const described = await compute(describeGraph, { a, b, list, same: list });

  return `${described} ${list.length}`;
}

type Shared = { left: number[]; right: number[] };

function share(n: number): Shared {
  const items = [n, n + 1];

  return { left: items, right: items };
}

/** What a task returns keeps its aliases, and is its own. */
export async function results(): Promise<string> {
  const r = await compute(share, 7);

  r.left.push(9);

  return r.right.join(",");
}

class Counter {
  count = 0;

  constructor(readonly step: number) {}

  bump(): number {
    this.count += this.step;
    return this.count;
  }
}

function bumpTwice(c: Counter): number {
  c.bump();
  return c.bump();
}

/** A class instance crosses as a copy of its fields: its methods run on the copy. */
export async function objects(): Promise<string> {
  const counter = new Counter(2);
  const result = await compute(bumpTwice, counter);

  return `${result} ${counter.count}`;
}

function views(parts: Uint8Array[]): string {
  parts[0]![0] = 9;

  return `${parts[1]![0]} ${parts[1]!.length}`;
}

/** Views of one buffer stay views of one (copied) buffer. */
export async function bytes(): Promise<string> {
  const buffer = new Uint8Array([1, 2, 3, 4]);
  const described = await compute(views, [buffer.subarray(0, 2), buffer]);

  return `${described} ${buffer[0]}`;
}

function tally(counts: Map<string, number>): string {
  let total = 0;

  for (const [, n] of counts) total += n;

  return `${counts.size} ${total}`;
}

/** Several tasks at once: each result reaches its own caller. */
export async function many(): Promise<string> {
  const pending: Promise<number>[] = [];

  for (let i = 1; i <= 8; i++) pending.push(compute(spin, i * 1000));

  const done = await Promise.all(pending);
  const counts = new Map<string, number>([
    ["a", 1],
    ["b", 2],
  ]);

  return `${done.join(",")} ${await compute(tally, counts)}`;
}

/** A function that is not async hands back the task's promise. */
export function start(n: number): Promise<number> {
  return compute(spin, n);
}

const LABEL = "tiles";
const WIDTH = 16;
const OFFSET = -3;
const HUGE = 12345678901234567890n;
const EXACT = true;

class Tile {
  static readonly SIDE = 4;

  constructor(readonly index: number) {}

  area(): number {
    return Tile.SIDE * Tile.SIDE + this.index;
  }
}

function tiles(count: number): string {
  let total = 0;
  let big = 0n;

  for (let i = 0; i < count; i++) {
    total += new Tile(i).area() + WIDTH + OFFSET;
    big += HUGE;
  }

  return `${LABEL} ${total} ${big} ${EXACT}`;
}

/** Literal module constants read in a task, in its own code and in the methods it calls. */
export async function constants(): Promise<string> {
  return `${await compute(tiles, 3)} ${tiles(1)}`;
}

function hexes(n: number): string {
  const wide = BigInt.asUintN(64, BigInt(n) * -3n);

  return `${wide.toString(16)} ${BigInt("0x" + n.toString(16)).valueOf()} ${[wide, wide * 2n].toString()}`;
}

/** Conversions run in a task: BigInt(), its toString and an array's text. */
export async function conversions(): Promise<string> {
  return `${await compute(hexes, 255)} ${await compute(hexes, 4096)}`;
}
