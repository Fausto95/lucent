// Generated from packages/compiler/test/e2e/cases/classes.test.js. Do not edit.
// @ts-nocheck
export default function run(mod, print, lucentClass, mods) {
  const Counter = lucentClass(mod.Counter);
  const c = new Counter(5);
  print(c.increment(), c.increment(3), c.value, c.label, c.describe());
  c.value = -10;
  print(c.value, c instanceof Counter);
  c.value = 7;
  print(mod.advance(c, 3), c.value);
  print(c.reset() === c, c.value);
  const d = mod.makeCounter(2);
  print(d.describe(), d instanceof Counter, mod.same(c, c), mod.same(c, d));
  print(Counter.total());
  print(mod.useStack([1, 2, 3, 4]));
  const Account = lucentClass(mod.Account);
  const a = new Account("ada");
  a.deposit(10);
  a.deposit(5);
  print(a.owner, a.balance, a.secret());
  try { a.deposit(-1); } catch (e) { print(e.name, e.message); }
  const seen = [];
  a.onEach((n) => seen.push(n));
  print(seen.join(","));
  print(mod.presence(c, "s", 1));

}
