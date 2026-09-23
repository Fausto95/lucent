// Generated from packages/compiler/test/e2e/cases/json.test.js. Do not edit.
// @ts-nocheck
export default function run(mod, print, lucentClass, mods) {
  const order = '{"id":7,"items":[{"name":"tea","price":4.5,"tags":["hot"],"discount":null},{"name":"cake","price":6,"tags":[],"note":"gift","discount":0.25}],"paid":true,"meta":{"table":3,"guests":2},"point":[1.5,-2]}';
  print(mod.summarize(order));
  print(mod.roundTrip(order));
  print(mod.numbers());
  print(mod.strings());
  print(mod.shapes('[{"kind":"circle","r":2},{"kind":"square","side":3},{"r":1,"kind":"circle"}]'));
  print(mod.mixed());
  print(mod.lastKeyWins());
  print(mod.invalid(["[1,", "[1 2]", "", "[01]", "[1,]", "[NaN]", "['x']", " [ 1 , 2 ] ", "[1]x", "[\"\\x\"]", "[1e]", "[.5]", "[-]", "[\"\u0001\"]"]));

}
