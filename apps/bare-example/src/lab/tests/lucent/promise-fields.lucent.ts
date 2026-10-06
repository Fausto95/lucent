import { delay } from "lucent:core";

/** Serializes its writes through a promise field, the way a file writer queues them. */
export class Writer {
  pending: Promise<void> = Promise.resolve();
  log: string[] = [];

  async write(s: string, ms: number): Promise<void> {
    const previous = this.pending;

    this.pending = (async () => {
      await previous;
      await delay(ms);
      this.log.push(s);
    })();

    await this.pending;
  }
}

export async function serialized(): Promise<string> {
  const w = new Writer();
  await Promise.all([w.write("a", 6), w.write("b", 1), w.write("c", 3)]);

  return `${w.log.join(",")} ${JSON.stringify(w)}`;
}

interface Point {
  x: number;
  y: number;
}

/** A promise of an object, assigned in the constructor and replaced across awaits. */
export class Cache {
  point: Promise<Point>;
  total: Promise<number> | undefined;
  loads = 0;

  constructor(x: number) {
    this.point = this.load(x);
  }

  private async load(x: number): Promise<Point> {
    await delay(2);
    this.loads++;

    return { x, y: x * 2 };
  }

  async read(): Promise<number> {
    const p = await this.point;
    this.total = (async () => p.x + p.y)();
    const first = await this.total;
    this.point = this.load(first);
    const q = await this.point;

    return q.y + (await this.total);
  }
}

export async function cached(): Promise<string> {
  const c = new Cache(3);
  const before = c.total === undefined;
  const n = await c.read();

  return `${before} ${n} ${c.loads} ${JSON.stringify(c)}`;
}

/** Promises in a plain object and an array serialize as empty objects. */
export function stringified(): string {
  const box = { label: "box", ready: Promise.resolve(1) };
  const list = [Promise.resolve("a"), Promise.resolve("b")];

  return `${JSON.stringify(box)} ${JSON.stringify(list)}`;
}

export function makeWriter(): Writer {
  return new Writer();
}
