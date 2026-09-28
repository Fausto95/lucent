const show = (xs) => (Array.isArray(xs) ? xs.map(String).join(",") : String(xs));

const values = [
  0n,
  -1n,
  2n ** 53n + 1n,
  2n ** 53n + 3n,
  2n ** 64n,
  -(2n ** 1030n),
  0,
  -0,
  1.5,
  -2.5,
  NaN,
  Infinity,
];

for (const x of values) print(show(mod.toNumber(x)));

for (const x of [undefined, 7n, -(2n ** 70n)]) print(show(mod.toNumberOptional(x)));

for (const x of [null, 5n]) print(show(mod.toNumberNullable(x)));

for (const x of [undefined, null, 3n, 3.25]) print(show(mod.toNumberEither(x)));

for (const x of [undefined, true, false, "", " 12 ", "0x10", "1n", "abc", 9n, 4.5])
  print(show(mod.toNumberOfAnything(x)));

for (const x of [5n, 5, -0, 2 ** 60, 1.5, NaN, Infinity]) {
  try {
    print(show(mod.toBigInt(x)));
  } catch (e) {
    print(e.name, e.message);
  }
}

for (const x of [true, false, " 42 ", "0b101", "1.5", "x", 8n, 8]) {
  try {
    print(show(mod.toBigIntOfAnything(x)));
  } catch (e) {
    print(e.name, e.constructor === SyntaxError || e.constructor === RangeError);
  }
}

for (const x of [undefined, null, 12n, -0, 1.5, 2n ** 64n]) print(show(mod.strings(x)));

const pairs = [
  [1n, 1],
  [1n, 2],
  [2, 1n],
  [2n ** 53n + 1n, 2 ** 53],
  [0n, -0],
  [1n, NaN],
  [3n, 3n],
  [2.5, 2.5],
  [-(2n ** 64n), -Infinity],
];

for (const [a, b] of pairs) print(show(mod.compare(a, b)));

for (const [a, b] of [
  [undefined, 1n],
  [1n, 1n],
  [2n, 1n],
])
  print(show(mod.compareOptional(a, b)));

for (const a of [1n, -0, 2.5, 0n, -(2n ** 64n), 2 ** 31, NaN]) {
  print(show(mod.negate(a)), typeof mod.negate(a), show(mod.flip(a)), typeof mod.flip(a));
  print(show(mod.steps(a)));
}
