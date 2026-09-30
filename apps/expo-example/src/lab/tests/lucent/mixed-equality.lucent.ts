// `===`, `!==`, `==`, switch cases, indexOf, includes and Map and Set keys
// inside generics, instantiated with values of different types: a number
// and a bigint, null and undefined, optionals, overlapping unions, arrays,
// and instances of related and unrelated classes.

function strict<T>(a: T, b: T): string {
  return `${a === b}/${a !== b}`;
}

function loose<T>(a: T, b: T): string {
  return `${a == b}/${a != b}`;
}

/** `x` against a value of each primitive type, and null and undefined. */
function against<T>(x: T): string {
  return [x === 0, x === "", x === 0n, x === false, x !== 1].join(",");
}

function absent<T>(x: T): string {
  return [x === undefined, x === null, x == null, x != undefined].join(",");
}

function kind<T>(x: T): string {
  switch (x) {
    case undefined:
      return "undefined";
    case null:
      return "null";
    case 0:
      return "zero";
    case "":
      return "empty";
    default:
      return "other";
  }
}

function find<T>(xs: T[], x: T): string {
  return `${xs.indexOf(x)},${xs.lastIndexOf(x)},${xs.includes(x)}`;
}

function distinct<T>(xs: T[]): string {
  const counts = new Map<T, number>();

  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);

  return `${new Set<T>(xs).size},${counts.size}`;
}

// Values of declared types: a local initialized with a literal would be
// narrowed to the literal's type.
function num(v?: number): number | undefined {
  return v;
}

function numOrNull(v: number | null): number | null {
  return v;
}

function str(v?: string): string | undefined {
  return v;
}

function numOrStr(v: number | string): number | string {
  return v;
}

function strOrBool(v: string | boolean): string | boolean {
  return v;
}

function numOrStrOrNone(v?: number | string): number | string | undefined {
  return v;
}

class Animal {
  name = "animal";
}

class Dog extends Animal {
  barks = true;
}

class Car {
  wheels = 4;
}

export function literals(): string {
  return [
    against(0),
    against(-0),
    against(""),
    against(0n),
    against(false),
    against(1),
    against(num()),
    against(num(0)),
    against(numOrStr("")),
    against(numOrStrOrNone(0)),
    against([0]),
    against(new Map<number, number>()),
    against(new Dog()),
    against(new Uint8Array(1)),
  ].join(" ");
}

// Through a generic: unions compare member by member, so each pair of
// member types meets.
export function primitives(): string {
  return [
    strict<number | bigint>(1, 1n),
    strict<number | bigint>(0, 0n),
    strict<number | string>(1, "1"),
    strict<boolean | number>(true, 1),
    strict<number | string>("a", "a"),
    strict<number | null | undefined>(null, undefined),
    loose<number | null | undefined>(null, undefined),
    strict<bigint | number>(10n ** 20n, 10n ** 20n),
  ].join(" ");
}

export function optionals(): string {
  return [
    strict(num(), undefined),
    strict(num(), null),
    strict(numOrNull(null), null),
    strict<number | undefined | null>(num(), numOrNull(null)),
    loose<number | undefined | null>(num(), numOrNull(null)),
    strict(num(3), 3),
    strict(3, num(3)),
    strict<number | string | undefined>(num(3), "3"),
    strict(num(), 3),
    strict<number | string | undefined>(num(), str()),
    strict<number | string | undefined>(num(), str("x")),
    strict(str("x"), "x"),
  ].join(" ");
}

export function unions(): string {
  return [
    strict<number | string | boolean>(numOrStr(1), strOrBool("a")),
    strict<number | string | boolean>(numOrStr("a"), strOrBool("a")),
    strict(numOrStr(1), 1),
    strict(1, numOrStr(1)),
    strict(numOrStr("a"), 1),
    strict(numOrStrOrNone("a"), numOrStr("a")),
    strict(numOrStr("a"), numOrStrOrNone("a")),
    strict(numOrStrOrNone(), undefined),
    strict(strOrBool(true), true),
  ].join(" ");
}

export function objects(): string {
  const arr = [1];
  const d = new Dog();
  const a: Animal = d;

  return [
    strict(arr, arr),
    strict(arr, [1]),
    strict<number[] | undefined>(arr, undefined),
    strict<number[] | null>(arr, null),
    strict<number[] | number>(arr, 0),
    strict<string[] | number>(["a"], 0),
    strict<number[] | string>(arr, "a"),
    strict<Map<string, number> | Set<string>>(new Map<string, number>(), new Set<string>()),
    strict<Animal>(a, d),
    strict<Dog | Car>(d, new Dog()),
    strict<Dog | Car>(d, new Car()),
    strict<Dog | Car>(d, d),
    strict<Dog | undefined>(d, undefined),
  ].join(" ");
}

// Without a generic: operands of different declared types that overlap.
export function declared(): string {
  const u = num();
  const s = str();
  const x = numOrStr("a");
  const y = strOrBool("a");
  const d = new Dog();
  const a: Animal = d;

  return [
    u === s,
    u !== s,
    num(1) === str("1"),
    x === y,
    x !== y,
    numOrStr(1) === y,
    a === d,
    d === a,
  ].join(" ");
}

export function absents(): string {
  return [
    absent(num()),
    absent(numOrNull(null)),
    absent(num(0)),
    absent(0),
    absent([1]),
    absent(new Dog()),
    absent(undefined),
    absent(null),
  ].join(" ");
}

export function cases(): string {
  return [
    kind(undefined),
    kind(null),
    kind(num()),
    kind(0),
    kind(-0),
    kind(""),
    kind([1]),
    kind(0n),
    kind(false),
    kind("0"),
  ].join(" ");
}

export function searches(): string {
  const arr = [1];
  const d = new Dog();

  return [
    find([1, NaN], NaN),
    find([1, 0], -0),
    find<number | undefined>([num(), 1, num()], num()),
    find<number | string>([1, "a", NaN], NaN),
    find<number | string>([1, "a", "1"], "1"),
    find([arr, [1], arr], arr),
    find<Animal>([new Animal(), d], d),
  ].join(" ");
}

export function keys(): string {
  const arr = [1];

  return [
    distinct([1, NaN, NaN, 0, -0]),
    distinct<number | string>([1, "1", NaN, NaN]),
    distinct<number | undefined>([num(), num(), 1]),
    distinct([arr, arr, [1]]),
  ].join(" ");
}
