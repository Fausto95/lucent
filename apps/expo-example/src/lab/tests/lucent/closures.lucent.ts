export function makeAdders(): number[] {
  const fns: ((x: number) => number)[] = [];
  for (let i = 0; i < 3; i++) fns.push((x) => x + i);
  return fns.map((f) => f(10));
}

export function counter(): number {
  let count = 0;
  const inc = () => {
    count++;
  };
  inc();
  inc();
  inc();
  return count;
}

export function compose(n: number): number {
  const double = (x: number) => x * 2;
  const addOne = (x: number) => x + 1;
  const both = (x: number) => addOne(double(x));
  return both(n);
}

export function recurse(n: number): number {
  function fact(k: number): number {
    return k <= 1 ? 1 : k * fact(k - 1);
  }
  return fact(n);
}

export function memo(n: number): number {
  const cache = new Map<number, number>();
  const fib = (k: number): number => {
    if (k < 2) return k;
    const hit = cache.get(k);
    if (hit !== undefined) return hit;
    const v = fib(k - 1) + fib(k - 2);
    cache.set(k, v);
    return v;
  };
  return fib(n);
}

type Op = (a: number, b: number) => number;
const ops: Record<string, Op> = {
  add: (a, b) => a + b,
  mul: (a, b) => a * b,
};

export function apply(op: string, a: number, b: number): number {
  const f = ops[op];
  return f ? f(a, b) : NaN;
}

let total = 0;
export function accumulate(n: number): number {
  total += n;
  return total;
}

export function makeGreeter(greeting: string): (name: string) => string {
  return (name) => `${greeting}, ${name}!`;
}

export function callTwice(f: (x: number) => number, x: number): number {
  return f(f(x));
}

export function sortBy(people: { name: string; age: number }[]): string[] {
  return people
    .slice()
    .sort((a, b) => a.age - b.age || a.name.localeCompare(b.name))
    .map((p) => p.name);
}
