// Generated from packages/compiler/test/e2e/cases/control.test.js. Do not edit.
// @ts-nocheck
export default function run(mod, print, lucentClass, mods) {
  print([0, 1, 2, 3, 4].map(mod.classify).join(" / "));
  print(mod.labeled());
  print(mod.finallyOrder());
  print(mod.nestedFinally());
  print(mod.catches("type"), mod.catches("range"), mod.catches("plain"), mod.catches("x"));
  print(JSON.stringify(mod.whileLoops(7)));
  print(JSON.stringify(mod.ternaries([1, -1, 0, undefined])));
  print(mod.logic("", 0), mod.logic("x", 3));
  print(mod.forIn({ b: 1, a: 2, 1: 3 }));
  print(mod.earlyReturnInLoop([4, 5, 6], 6), mod.earlyReturnInLoop([4], 1));

}
