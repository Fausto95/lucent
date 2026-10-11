// ES2023's array methods: the copying forms of sort, reverse and splice,
// with() for one element, and the searches from the end.

function joined<T>(xs: readonly T[]): string {
  return xs.join(",");
}

/** Each copy leaves the array it read as it was. */
export function copies(): string {
  const xs = [3, 1, 2];
  const sorted = xs.toSorted();
  const descending = xs.toSorted((a, b) => b - a);
  const reversed = xs.toReversed();
  const spliced = xs.toSpliced(1, 1, 9, 8);
  // oxlint-disable-next-line unicorn/no-confusing-array-with -- an index from the end is the case
  const changed = xs.with(-1, 7);
  return [xs, sorted, descending, reversed, spliced, changed].map((a) => joined(a)).join(" ");
}

/** Copies are new arrays: changing one changes neither the original nor another copy. */
export function independent(): string {
  const xs = ["a", "b"];
  const a = xs.toReversed();
  const b = xs.with(0, "z");
  a.push("c");
  b[1] = "y";
  return [joined(xs), joined(a), joined(b), a === xs, b === xs].join(" ");
}

/** toSpliced reads its start and count as splice does, on a copy. */
export function splicing(): string {
  const xs = ["a", "b", "c", "d"];
  return [
    xs.toSpliced(2),
    xs.toSpliced(-1),
    xs.toSpliced(-10),
    xs.toSpliced(1, 0, "x"),
    xs.toSpliced(1, -5),
    xs.toSpliced(1, Infinity),
    xs.toSpliced(Number.NaN, 2),
    xs.toSpliced(10, 1, "z"),
    xs.toSpliced(1, 2, "p", "q", "r"),
    xs.toSpliced(1.9, 1.9),
    xs.toSpliced(0, undefined),
  ]
    .map((a) => joined(a))
    .join(" | ");
}

/** with() takes an index from the end too, and throws a RangeError outside the array. */
export function replacing(): string {
  const xs = [1, 2, 3];
  const out: string[] = [];
  for (const i of [0, 2, -1, -3, 3, -4, 1.7, -0.5, Number.NaN, Infinity]) {
    try {
      out.push(joined(xs.with(i, 0)));
    } catch (e) {
      out.push((e as Error).name);
    }
  }
  return out.join(" ");
}

/** findLast and findLastIndex visit from the end, with the index and the array. */
export function searches(): string {
  const xs = [5, 12, 8, 130, 44];
  const seen: number[] = [];
  const big = xs.findLast((x, i, a) => {
    seen.push(i);
    return x > 10 && a.length === 5;
  });
  return [
    big,
    xs.findLastIndex((x) => x > 100),
    xs.findLastIndex((x) => x > 1000),
    xs.findLast((x) => x < 0),
    joined(seen),
  ].join(" ");
}

type Word = { key: number; text: string };

/** toSorted with a comparator is stable; without one it compares elements as strings. */
export function sorting(): string {
  const words: Word[] = [
    { key: 1, text: "b" },
    { key: 0, text: "a" },
    { key: 1, text: "c" },
    { key: 0, text: "d" },
  ];
  const byKey = words
    .toSorted((a, b) => a.key - b.key)
    .map((w) => w.text)
    .join("");
  const asText = joined([10, 9, 1, 100].toSorted());
  // The copy holds the same objects.
  const same = words.toReversed()[3] === words[0];
  return `${byKey} ${asText} ${same}`;
}

/** Elements that may be absent: absent ones sort last, and with() can set one. */
export function absent(): string {
  const xs: (number | undefined)[] = [2, undefined, 1];
  const sorted = xs.toSorted();
  const filled = xs.with(1, 5);
  const emptied = xs.with(0, undefined);
  const show = (a: (number | undefined)[]) => a.map((x) => (x === undefined ? "_" : x)).join(",");
  return [show(sorted), show(filled), show(emptied), show(xs.toSpliced(0, 1))].join(" ");
}
