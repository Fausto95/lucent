// `await` waits a microtask whatever it awaits, and an async function that
// returns a promise settles when JavaScript's does: its promise adopts the
// returned one (a thenable job, then that promise's reaction) once the
// function has finished, so its catch blocks never see that rejection.
/* oxlint-disable unicorn/no-unnecessary-await -- awaiting a value that isn't a promise is the case */

async function values(log: string[], name: string): Promise<number> {
  log.push(`${name}0`);

  const one = await 1;

  log.push(`${name}1`);
  await undefined;
  log.push(`${name}2`);
  log.push(await `${name}!`);
  return one;
}

/** Awaiting values that are not promises, against a chain's ticks. */
export async function awaitValues(): Promise<string> {
  const log: string[] = [];
  const a = values(log, "a");
  const b = values(log, "b");
  const t = Promise.resolve(0)
    .then(() => log.push("t1"))
    .then(() => log.push("t2"))
    .then(() => log.push("t3"));

  log.push("sync");

  const [x, y] = await Promise.all([a, b, t]);

  return `${log.join(" ")} = ${x + y}`;
}

let counter = 0;

async function snapshot(): Promise<string> {
  const seen = await counter;

  return `${seen}/${counter}`;
}

/** What is awaited is read before the await waits. */
export async function readBeforeWaiting(): Promise<string> {
  counter = 1;

  const p = snapshot();

  counter = 2;
  return await p;
}

async function adopting(p: Promise<string>): Promise<string> {
  return p;
}

async function awaiting(p: Promise<string>): Promise<string> {
  return await p;
}

async function adoptingLater(p: Promise<string>): Promise<string> {
  await null;
  return p;
}

/** `return p` settles two microtasks after p, `return await p` one. */
export async function returnOrder(): Promise<string> {
  const log: string[] = [];
  const p = Promise.resolve("p");
  const a = adopting(p).then((v) => log.push(`adopted:${v}`));
  const w = awaiting(p).then((v) => log.push(`awaited:${v}`));
  const l = adoptingLater(p).then((v) => log.push(`later:${v}`));
  const t = Promise.resolve(0)
    .then(() => log.push("t1"))
    .then(() => log.push("t2"))
    .then(() => log.push("t3"))
    .then(() => log.push("t4"));

  log.push("sync");
  await Promise.all([a, w, l, t]);
  return log.join(" ");
}

async function guarded(log: string[], p: Promise<string>): Promise<string> {
  try {
    return p;
  } catch {
    return "caught";
  } finally {
    log.push("finally");
  }
}

async function guardedLater(log: string[], p: Promise<string>): Promise<string> {
  await null;

  try {
    return p;
  } catch {
    return "caught";
  } finally {
    log.push("finally later");
  }
}

function outcome(p: Promise<string>): Promise<string> {
  return p.then(
    (v) => `fulfilled ${v}`,
    (e: Error) => `rejected ${e.message}`,
  );
}

/** A returned promise's rejection passes the function's catch by, after its finally. */
export async function returnRejected(): Promise<string> {
  const log: string[] = [];
  const first = outcome(guarded(log, Promise.reject(new Error("no"))));
  const second = outcome(guardedLater(log, Promise.reject(new Error("not later"))));

  log.push("sync");

  const [one, two] = await Promise.all([first, second]);

  return `${log.join(", ")}: ${one}, ${two}`;
}

async function widened(p: Promise<number>): Promise<number | undefined> {
  return p;
}

async function nothing(p: Promise<void>): Promise<void> {
  return p;
}

async function refused(): Promise<number> {
  return Promise.reject(new Error("refused"));
}

class Shape {
  area(): number {
    return 0;
  }
}

class Square extends Shape {
  constructor(readonly side: number) {
    super();
  }

  override area(): number {
    return this.side * this.side;
  }
}

async function square(side: number): Promise<Square> {
  return new Square(side);
}

async function shape(side: number): Promise<Shape> {
  return square(side);
}

async function shapeLater(log: string[], side: number): Promise<Shape> {
  await null;

  try {
    return square(side);
  } finally {
    log.push("shaped");
  }
}

/** A promise of another type than the function's, of none, and into one giving nothing. */
export async function returnTypes(): Promise<string> {
  const log: string[] = [];
  const w = await widened(Promise.resolve(4));
  let r = "";

  await nothing(Promise.resolve());

  try {
    await refused();
  } catch (e) {
    r = (e as Error).message;
  }

  const a = await shape(2);
  const b = await shapeLater(log, 3);

  return `${w} ${r} ${a.area()} ${b.area()} ${log.join(",")}`;
}
