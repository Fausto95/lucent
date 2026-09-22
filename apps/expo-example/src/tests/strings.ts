// Generated from packages/compiler/test/e2e/cases/strings.test.js. Do not edit.
// @ts-nocheck
export default function run(mod, print, lucentClass, mods) {
  print(mod.stats("hello world  foo"));
  print(mod.pad(7, 3), mod.pad(1234, 3));
  print(mod.reverseWords("one two three"));
  print(mod.countChars("a b c 🌍"));
  print(JSON.stringify(mod.builder(25)));
  print(JSON.stringify(mod.manip("  hello  ")));
  print(JSON.stringify(mod.manip("hello")));
  print(mod.compare("a", "b"), mod.compare("b", "a"), mod.compare("x", "x"), mod.compare("Z", "a"));
  print(mod.unicode());

}
