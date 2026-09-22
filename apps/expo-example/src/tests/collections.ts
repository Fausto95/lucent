// Generated from packages/compiler/test/e2e/cases/collections.test.js. Do not edit.
// @ts-nocheck
export default function run(mod, print, lucentClass, mods) {
  print(mod.arrays([1, 2, 3, 4, 5]));
  const counts = mod.words("the cat the dog the end");
  print(counts instanceof Map, JSON.stringify([...counts]));
  print(mod.mapOps());
  print(JSON.stringify(mod.records({ a: 1, b: 2, c: 3 })));
  print(mod.entries({ x: "1", y: "2" }));
  print(JSON.stringify(mod.matrix(3)));
  print(JSON.stringify(mod.uniq(["b", "a", "b", "c", "a"])));

}
