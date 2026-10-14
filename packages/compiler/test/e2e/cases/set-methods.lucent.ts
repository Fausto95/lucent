// ES2025's set methods (T106), with JavaScript's orders: the smaller side is
// iterated where the result doesn't depend on which.
function show<T>(s: Set<T>): string {
  return [...s].join(",");
}

export function combine(): string {
  const a = new Set([1, 2, 3, 4]);
  const b = new Set([5, 3, 1]);
  return [
    show(a.union(b)),
    show(a.intersection(b)),
    show(b.intersection(a)),
    show(a.difference(b)),
    show(b.difference(a)),
    show(a.symmetricDifference(b)),
    show(b.symmetricDifference(a)),
  ].join(" | ");
}

export function predicates(): string {
  const small = new Set([1, 2]);
  const big = new Set([3, 2, 1]);
  const other = new Set([7, 8]);
  return [
    small.isSubsetOf(big),
    big.isSubsetOf(small),
    big.isSupersetOf(small),
    small.isSupersetOf(big),
    small.isDisjointFrom(other),
    small.isDisjointFrom(big),
    new Set<number>().isSubsetOf(small),
  ].join(",");
}

export function mixedTypes(): string {
  const nums = new Set([1, 2]);
  const words = new Set(["a", "b"]);
  const both: Set<number | string> = new Set([2, "a"]);
  return `${show(nums.union(words))} | ${show(both.intersection(nums))} | ${show(both.difference(words))} | ${nums.isDisjointFrom(words)}`;
}

export function withMaps(): string {
  const s = new Set(["x", "y", "z"]);
  const m = new Map([
    ["z", 1],
    ["w", 2],
  ]);
  return `${show(s.union(m))} | ${show(s.intersection(m))} | ${s.isSupersetOf(new Map([["x", 0]]))}`;
}

export function newSets(): string {
  const a = new Set([1]);
  const u = a.union(new Set<number>());
  u.add(2);
  return `${a.size} ${u.size} ${u !== a}`;
}
