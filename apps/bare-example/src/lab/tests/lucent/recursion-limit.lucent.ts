// Recursion past what the stack holds throws a RangeError, as in
// JavaScript, which code can catch: through a function, a method, a
// closure or an async function. The stack is whole again afterwards.

function depth(n: number): number {
  return depth(n + 1) + 1;
}

class Walker {
  steps = 0;

  walk(n: number): number {
    this.steps++;
    return this.walk(n + 1) + 1;
  }
}

/** What a caught error says: its name, and whether it names the call stack. */
function described(error: Error): string {
  return `${error.name} ${error instanceof RangeError} ${error.message.includes("call stack")}`;
}

export function unbounded(): string {
  try {
    return `${depth(0)}`;
  } catch (e) {
    return described(e as Error);
  }
}

export function throughMethod(): string {
  const walker = new Walker();
  try {
    return `${walker.walk(0)}`;
  } catch (e) {
    return `${described(e as Error)} ${walker.steps > 100}`;
  }
}

export function throughClosure(): string {
  const f = (n: number): number => f(n + 1) + 1;
  try {
    return `${f(0)}`;
  } catch (e) {
    return described(e as Error);
  }
}

/** Mutual recursion. */
function ping(n: number): number {
  return pong(n + 1) + 1;
}

function pong(n: number): number {
  return ping(n + 1) + 1;
}

export function mutual(): string {
  try {
    return `${ping(0)}`;
  } catch (e) {
    return described(e as Error);
  }
}

/** Afterwards, deep but bounded recursion still works. */
export function bounded(): number {
  const sum = (n: number): number => (n === 0 ? 0 : n + sum(n - 1));
  return sum(1000);
}

async function deeper(n: number): Promise<number> {
  return (await deeper(n + 1)) + 1;
}

export async function unboundedAsync(): Promise<string> {
  try {
    return `${await deeper(0)}`;
  } catch (e) {
    return described(e as Error);
  }
}
