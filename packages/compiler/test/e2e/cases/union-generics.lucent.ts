// Generics whose signatures put a type parameter in a union (`A | B`,
// `T | undefined`, `T | null`), instantiated so that the union's members
// come out in any order, and `null | undefined` as a type.

function pick<A, B>(first: boolean, a: A, b: B): A | B {
  return first ? a : b;
}

function show<A, B>(v: A | B): string {
  return `${typeof v}:${String(v)}`;
}

function same<A, B>(a: A, b: A | B): boolean {
  return a === b;
}

function orNull<T>(x: T | null): string {
  return x === null ? "null" : String(x);
}

function firstOf<T>(xs: T[]): T | undefined {
  return xs[0];
}

export function members(): string {
  const n: number | string = pick<number, string>(true, 1, "a");
  const s: string | number = pick<string, number>(false, "a", 2);
  const b = pick<boolean, string>(false, true, "b");

  return [
    n,
    s,
    b,
    show<number, string>(3),
    show<string, number>("x"),
    show<boolean, number>(4),
  ].join(" ");
}

export function comparisons(): string {
  return [
    same<number, string>(1, 1),
    same<string, number>("a", 1),
    same<string, number>("a", "a"),
  ].join(" ");
}

export function optionals(): string {
  const empty: number[] = [];

  return [
    orNull<number>(1),
    orNull<string>(null),
    firstOf([5]),
    firstOf(empty),
    firstOf(["x"]),
  ].join(" ");
}

export function absent(flag: boolean): string {
  const nothing: null | undefined = flag ? null : undefined;

  return [nothing === null, nothing === undefined, nothing == null, String(nothing)].join(" ");
}
