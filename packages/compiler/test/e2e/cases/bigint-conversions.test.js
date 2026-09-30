const show = (xs) => xs.map(String).join(",");

for (const n of [
  0,
  -0,
  1,
  -1,
  2 ** 53,
  -(2 ** 53) - 2,
  2 ** 63,
  2 ** 64,
  1e21,
  1.7976931348623157e308,
  -1e300,
]) {
  print(mod.fromNumber(n));
}
for (const n of [1.5, -0.25, NaN, Infinity, -Infinity, 2 ** -1074]) {
  try {
    mod.fromNumber(n);
  } catch (e) {
    print(e.name, e.message, e instanceof RangeError);
  }
}

for (const s of [
  "0",
  "  42  ",
  "-17",
  "+17",
  "",
  " \n\t ",
  "0x1f",
  "0XFF",
  "0o777",
  "0b1010",
  "123456789012345678901234567890",
  "-00012",
  "  9 \uFEFF\u3000",
]) {
  print(JSON.stringify(s), mod.fromString(s));
}
for (const s of ["1.5", "abc", "1n", "-0x1", "0x", "1e3", " 1 2 ", "Infinity"]) {
  try {
    mod.fromString(s);
  } catch (e) {
    print(e.name, e.message, e instanceof SyntaxError);
  }
}

print(show(mod.fromBoolean(true)), show(mod.fromBoolean(false)), mod.same(2n ** 70n));

for (const x of [
  0n,
  -1n,
  9007199254740991n,
  9007199254740993n,
  9007199254740995n,
  -9007199254740993n,
  2n ** 63n - 1n,
  2n ** 64n,
  2n ** 64n + 2n ** 11n,
  2n ** 64n + 2n ** 11n + 1n,
  2n ** 1023n * 3n,
  2n ** 1024n,
  -(2n ** 1024n),
  2n ** 1024n - 2n ** 970n,
  2n ** 1024n - 2n ** 971n,
]) {
  print(mod.toNumber(x));
}

for (const x of [0n, 255n, -255n, 2n ** 64n, -(2n ** 100n) - 1n]) print(mod.strings(x).join(" "));
for (const r of [2, 8, 36, 2.9, 10]) print(mod.radix(-(2n ** 70n) - 12345n, r));
for (const r of [1, 37, NaN]) {
  try {
    print(mod.radix(5n, r));
  } catch (e) {
    print(e.name, e instanceof RangeError);
  }
}

for (const [bits, x] of [
  [64, 2n ** 63n],
  [64, 2n ** 64n - 1n],
  [64, -1n],
  [64, 2n ** 100n + 7n],
  [8, 255n],
  [8, 128n],
  [8, -129n],
  [1, 1n],
  [0, 12345n],
  [1.9, 3n],
  [200, -(2n ** 150n)],
]) {
  print(bits, show(mod.wrap(bits, x)));
}
try {
  mod.wrap(-1, 1n);
} catch (e) {
  print(e.name, e.message);
}

for (const [what, text] of [
  ["number", "1.5"],
  ["number", "12"],
  ["string", "12x"],
  ["string", "  0b11  "],
  ["json", "3"],
  ["radix", "40"],
  ["radix", "7"],
  ["bits", "-3"],
  ["bits", "3"],
]) {
  print(mod.attempt(what, text));
}

try {
  mod.json(1n);
} catch (e) {
  print(e.name, e.message, e instanceof TypeError);
}

print(mod.roundTrip(0n), mod.roundTrip(2n ** 200n + 5n), mod.roundTrip(12345678901234567890n));
