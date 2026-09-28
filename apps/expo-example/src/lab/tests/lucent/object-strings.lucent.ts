// String(x), template literals, `+` with a string and toString() on arrays,
// maps, sets, records, byte views, promises and abort objects give
// JavaScript's text: arrays and byte views join their elements with ",",
// the others name their class ("[object Map]").

function describe<T>(label: string, value: T): string {
  return `${label}=${String(value)}`;
}

export function arrays(): string {
  const xs = [1, 2.5, -0];
  const nested = [[1, 2], [3]];
  const holes: (number | undefined | null)[] = [1, undefined, null, 4];
  const words = ["a", "b"];
  const empty: number[] = [];

  return [
    String(xs),
    `${nested}`,
    "" + holes,
    words.toString(),
    `[${empty}]`,
    describe("xs", xs),
  ].join(" | ");
}

export function collections(): string {
  const m = new Map<string, number>([["k", 1]]);
  const s = new Set<number>([1, 2]);
  const r: Record<string, number> = { a: 1 };

  return [String(m), `${s}`, "r: " + r, m.toString(), describe("s", s), String([m, s])].join(" | ");
}

export function bytes(): string {
  const u = new Uint8Array([1, 2, 255]);
  const empty = new Uint8Array(0);

  return [String(u), `${u.subarray(1)}`, "<" + empty + ">", u.toString(), describe("u", u)].join(
    " | ",
  );
}

export function promises(): string {
  const p = Promise.resolve(1);

  return [String(p), `${p}`, "p: " + p, describe("p", p)].join(" | ");
}

export function aborts(): string {
  const c = new AbortController();

  return [String(c), `${c.signal}`, describe("signal", c.signal)].join(" | ");
}

export function optionals(): string {
  const maybe: number[] | undefined = [1, 2];
  const none: Map<string, number> | undefined = undefined;
  const either: number[] | string = [3, 4];

  return [String(maybe), `${none}`, String(either)].join(" | ");
}

export function kinds(): string {
  const values = [
    typeof [1],
    typeof new Map<string, number>(),
    typeof new Set<number>(),
    typeof ({} as Record<string, number>),
    typeof new Uint8Array(1),
    typeof Promise.resolve(1),
  ];

  return values.join(" ");
}

// Not run by the test: console output goes to the platform log. It must
// still compile, since console.log prints String(value) for each argument.
export function log(): void {
  console.log([1, 2], new Map<string, number>(), new Set<number>(), new Uint8Array(1));
  console.log({} as Record<string, number>, Promise.resolve(1), new AbortController().signal);
}
