// Generated from packages/compiler/test/e2e/cases/generators.test.js. Do not edit.
// @ts-nocheck
export default function run(mod, print, lucentClass, mods) {
  print(mod.basics());
  print(mod.lazy());
  print(mod.earlyExit());
  print(mod.throwsInside());
  print(mod.tree());
  print(mod.closures());
  print(mod.iterables());
  print(mod.sumIterable([1, 2, 3]), mod.sumIterable(new Set([4, 5])), mod.sumIterable("") );

}
