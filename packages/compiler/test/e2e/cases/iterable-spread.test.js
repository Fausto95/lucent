const m = new Map([
  ["a", 1],
  ["b", 2],
]);
print("entries", JSON.stringify(mod.entries(m)));
print("withEntry", JSON.stringify(mod.withEntry(m)));
print("keysAndValues", mod.keysAndValues(m));
print(
  "merged",
  JSON.stringify(
    mod.merged(
      m,
      new Map([
        ["b", 20],
        ["c", 3],
      ]),
    ),
  ),
);
print("unique", JSON.stringify(mod.unique([3, 1, 3, 2, 1])));
print("union", JSON.stringify(mod.union(new Set([3, 1]), new Set([2, 3]))));
print("mixed", JSON.stringify(mod.mixed(new Set([1, 2]))));
print("chars", JSON.stringify(mod.chars("hé😀")));
print("counted", JSON.stringify(mod.counted(3)));
