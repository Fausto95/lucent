// Generated from packages/compiler/test/e2e/cases/errors.test.js. Do not edit.
// @ts-nocheck
export default function run(mod, print, lucentClass, mods) {
  print(mod.divide(6, 3));
  try { mod.divide(1, 0); } catch (e) { print(e instanceof Error, e.code, e.message); }
  try { mod.validate(-5); } catch (e) { print(e.name, e.message); }
  print(mod.validate(5), mod.safeDivide(1, 0), mod.safeDivide(1, 4));
  print(mod.rethrow());

}
