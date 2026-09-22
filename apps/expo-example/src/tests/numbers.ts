// Generated from packages/compiler/test/e2e/cases/numbers.test.js. Do not edit.
// @ts-nocheck
export default function run(mod, print, lucentClass, mods) {
  print(JSON.stringify(mod.format([0, 1.5, -2.5, 10.126, 255, -7.5, 1e21])));
  print(JSON.stringify(mod.bits(12, 10)), JSON.stringify(mod.bits(-5, 3)), JSON.stringify(mod.bits(2147483647, 1)));
  print(JSON.stringify(mod.parse(["42", " 3.5 ", "", "0x10", "1e3", "abc", "-0", "Infinity", "12px"])));
  print(JSON.stringify(mod.parseInts(["42", "3.9", "-7x", "x"])));
  print(mod.special());
  print(JSON.stringify(mod.mathFns(2)));
  print(mod.precision(1234.5678), mod.precision(0.000123456));
  print(JSON.stringify(mod.checks(3)), JSON.stringify(mod.checks(3.5)), JSON.stringify(mod.checks(NaN)), JSON.stringify(mod.checks(Infinity)));
  print(mod.sum([1, 2, 3.5]), mod.fib(20));

}
