// oxlint-disable no-extraneous-class -- a class holding only static fields is the case
// A `let` or `const` exists from the start of its block, but code that
// uses it before its declaration runs throws ReferenceError: a function
// declared above it, or a closure made before it, called too early.
function outcome(f: () => string): string {
  try {
    return f();
  } catch (e) {
    if (e instanceof Error) return `${e.name}: ${e.message}`;
    throw e;
  }
}

// --- in a function --------------------------------------------------------------

export function helperAfter(): number {
  function helper(): number {
    return config.x + n;
  }
  const config = { x: 1 };
  let n = 2;
  n++;
  return helper();
}

export function hoistedCall(): string {
  return outcome(() => {
    const r = read();
    const x = 1;
    function read(): string {
      return `${x}`;
    }
    return `${r} ${x}`;
  });
}

export function closureBefore(): string {
  return outcome(() => {
    const read = () => `${label}`;
    const r = read();
    const label = "set";
    return `${r} ${label}`;
  });
}

export function writtenBefore(): string {
  return outcome(() => {
    const set = (v: number) => {
      count = v;
    };
    set(1);
    let count = 0;
    return `${count}`;
  });
}

export function closureAfter(): number {
  let total = 0;
  const add = (k: number) => {
    total += k + base;
  };
  const base = 10;
  add(1);
  return total;
}

// Each turn of a loop has its own variable, in its dead zone until declared.
export function inLoops(): string {
  const out: string[] = [];
  for (let i = 0; i < 2; i++) {
    const show = () => `${i}:${label}`;
    const label = `l${i}`;
    out.push(show());
  }
  return out.join(",");
}

export function recursive(): number {
  const fib = (n: number): number => (n < 2 ? n : fib(n - 1) + fib(n - 2));
  return fib(10);
}

// A declaration without a value gives the variable `undefined`.
export function declaredUndefined(): string {
  const read = () => `${maybe}`;
  let maybe: number | undefined;
  const before = read();
  maybe = 3;
  return `${before} ${read()}`;
}

// --- in a module ----------------------------------------------------------------

function readCount(): string {
  return `${count}`;
}

function writeCount(): string {
  count = 5;
  return `${count}`;
}

function readLimit(): string {
  return `${LIMIT}`;
}

class Probe {
  static seen = outcome(() => `${note} ${Probe.later}`);
  static later = 1;
}

const early = outcome(readCount);
const written = outcome(writeCount);
const limitEarly = outcome(readLimit);
let count = 2;
const LIMIT = 10;
const note = "ready";
const later = outcome(readCount);
// Nothing the module runs before it reaches this one.
const plain = 3;

export function moduleStart(): string {
  return [early, written, limitEarly, later, Probe.seen, readLimit()].join(" | ");
}

export function sum(): number {
  return plain + count;
}
