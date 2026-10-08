// `??` and `??=` where the left side's type is a type parameter: the
// instantiation decides whether it can be absent.
function orDefault<T>(x: T, d: T): T {
  return x ?? d;
}

function fill<T>(x: T, d: T): T {
  let v = x;
  v ??= d;
  return v;
}

export function defaults(): string {
  const a = orDefault<number | undefined>(undefined, 7);
  const b = orDefault<number | undefined>(3, 7);
  const c = orDefault<string | null>(null, "d");
  const e = orDefault<number>(0, 9);
  const f = fill<number | undefined>(undefined, 4);
  const g = fill<string | null>("x", "y");
  return [a, b, c, e, f, g].join(",");
}

// `??=` on a variable that is never absent keeps it, and its right side never runs.
export function present(): number {
  let x = 1;
  let ran = 0;
  x ??= (ran++, 2);
  return x * 10 + ran;
}

export function presentString(s: string): string {
  let t = s;
  t ??= "never";
  return t;
}
