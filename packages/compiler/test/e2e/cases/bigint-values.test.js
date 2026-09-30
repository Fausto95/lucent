const show = (xs) => xs.map(String).join(",");

print(mod.BIG, typeof mod.BIG, mod.LIMITS.min, mod.LIMITS.max);

print(mod.keys([1n, 2n ** 64n, 1n, (2n ** 32n) ** 2n, 0n, -0n, 3n, 2n ** 64n + 0n]));
const xs = [5n, -3n, 2n ** 70n, 10n, -(2n ** 70n), 0n, 100n, 9n];
print(show(mod.sorted(xs)));
print(show(mod.defaultSorted(xs)));
print(mod.search(xs, 10n), "|", mod.search(xs, 2n ** 70n), "|", mod.search(xs, 7n));
print(mod.sum([]), mod.sum([1n, 2n ** 64n, -3n]));

const totals = mod.totals(
  new Map([
    [1n, [1n, 2n]],
    [2n ** 64n, [2n ** 64n, 2n ** 64n]],
    [-5n, []],
  ]),
);
print(
  [...totals].map(([k, v]) => `${k}=${v}`).join(" "),
  [...totals.keys()].every((k) => typeof k === "bigint"),
);
print(show(mod.unique(new Set([3n, -3n, 3n, 2n ** 40n]))));

print(
  mod.describe({ id: 7n, label: "a" }),
  mod.describe({ id: 2n ** 64n, label: "b", limit: -1n }),
);
const l1 = mod.ledger(2n ** 63n, true);
const l2 = mod.ledger(5n, false);
print(l1.id, l1.label, l1.limit, typeof l1.id, l2.id, l2.limit);

print(mod.maybe(undefined), mod.maybe(2n ** 64n - 1n), mod.orZero(), mod.orZero(-9n));
print(mod.either(41n), mod.either("41"), mod.either(2n ** 80n));
print(mod.pick(true), typeof mod.pick(true), mod.pick(false));
print(mod.mixed([1n, 1, 2n ** 60n, 2.5, -0]));

const acct = mod.openAccount(10n);
print(
  acct.id,
  acct.balance,
  acct.deposit(2n ** 64n),
  acct.balance,
  acct.doubled,
  show(acct.history),
);
const Account = lucentClass(mod.Account);
const direct = new Account(-1n);
print(direct.deposit(5n), direct.balance, direct.id);

print(
  mod.applyTwice((x) => x * x + 1n, 3n),
  mod.applyTwice((x) => -x, 2n ** 90n),
);
const seen = [];
mod.each([1n, 2n ** 64n], (x, i) => seen.push(`${i}:${x}:${typeof x}`));
print(seen.join(" "));

const c = mod.counter(1n);
print(c(), c(), c());
const big = mod.counter(2n ** 62n);
print(big(), big());

print(show(mod.tupled(2n ** 63n)));
print(
  JSON.stringify(
    Object.entries(mod.records({ a: 1n, b: 2n ** 64n })).map(([k, v]) => [k, String(v)]),
  ),
);

// One after the other: the order the lines print in does not depend on timing.
mod
  .factorialLater(25n)
  .then((r) => {
    print("factorial", r, typeof r);
    return mod.sumLater([1n, 2n, 2n ** 30n]);
  })
  .then((r) => {
    print("sum", r);
    return mod.failLater("oops");
  })
  .then(
    (r) => print("unexpected", r),
    (e) => print("failLater", e.name, e.message, e instanceof SyntaxError),
  )
  .then(() => mod.failLater(" 0x10 "))
  .then((r) => print("failLater ok", r));
