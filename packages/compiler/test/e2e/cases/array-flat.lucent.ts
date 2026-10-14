// Array.prototype.flat and copyWithin (T106).
export function flatOnce(): string {
  const nested = [[1, 2], [3], []];
  return JSON.stringify(nested.flat());
}

export function flatMixed(): string {
  const mixed = [1, [2, [3, [4]]], 5];
  return `${JSON.stringify(mixed.flat())} ${JSON.stringify(mixed.flat(2))} ${JSON.stringify(mixed.flat(Infinity))} ${JSON.stringify(mixed.flat(0))}`;
}

export function flatStrings(): string {
  const words = [["a", "b"], ["c"]].flat();
  words.push("d");
  return words.join("");
}

export function flatKeepsUndefined(): string {
  const xs: (number | undefined)[][] = [[1, undefined], [3]];
  return xs
    .flat()
    .map((x) => String(x))
    .join(",");
}

export function flatNewArray(): string {
  const inner = [1, 2];
  const outer = [inner];
  const flatCopy = outer.flat();
  flatCopy[0] = 9;
  return `${inner[0]} ${flatCopy[0]} ${outer.flat(1.7).length}`;
}

export function copyWithin(): string {
  const a = [1, 2, 3, 4, 5];
  const same = a.copyWithin(0, 3) === a;
  const b = [1, 2, 3, 4, 5].copyWithin(1, 0, 3);
  const c = [1, 2, 3, 4, 5].copyWithin(-2, -4, -1);
  const d = [1, 2, 3, 4, 5].copyWithin(2, 0);
  const e = ["a", "b", "c"].copyWithin(0, 1, 99);
  return `${a.join("")} ${same} ${b.join("")} ${c.join("")} ${d.join("")} ${e.join("")}`;
}

export function flatDepth(depth: number): string {
  return JSON.stringify([1, [2, [3, [4]]]].flat(depth));
}
