// Generated from packages/compiler/test/e2e/cases/closures.test.js. Do not edit.
// @ts-nocheck
export default function run(mod, print, lucentClass, mods) {
  print(JSON.stringify(mod.makeAdders()));
  print(mod.counter(), mod.compose(5), mod.recurse(10), mod.memo(50));
  print(mod.apply("add", 2, 3), mod.apply("mul", 2, 3), mod.apply("nope", 1, 1));
  // The running total is module state, kept from earlier runs: report this run's.
  const base = mod.accumulate(0);
  print(mod.accumulate(1) - base, mod.accumulate(2) - base, mod.accumulate(3) - base);
  const greet = mod.makeGreeter("Hello");
  print(greet("Ada"), greet("Bo"));
  print(mod.callTwice((x) => x * 3, 2));
  print(
    JSON.stringify(
      mod.sortBy([
        { name: "b", age: 2 },
        { name: "a", age: 2 },
        { name: "c", age: 1 },
      ]),
    ),
  );

}
