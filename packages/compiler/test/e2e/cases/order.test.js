mod.reset();
print("pair", mod.pair(), "|", mod.trail());

mod.reset();
try {
  mod.firstThrows();
} catch (e) {
  print("first threw:", e.message, "|", mod.trail());
}

mod.reset();
try {
  mod.secondThrows();
} catch (e) {
  print("second threw:", e.message, "|", mod.trail());
}

mod.reset();
print("operands", mod.operands(), "|", mod.trail());

mod.reset();
print("locals", mod.locals(), "|", mod.trail());

mod.reset();
print("counted", mod.counted());

print("arithmetic", mod.arithmetic(1, 2), mod.arithmetic(-5.5, 0.25), mod.arithmetic(1e308, 1e308));
print("mulAdd", mod.mulAdd(0.1, 10, -1), mod.mulAdd(3, 1 / 3, -1));
print("numbers", mod.numbers());
print("negate", Object.is(mod.negate(0), -0), Object.is(mod.negate(-0), 0));
print("compare", mod.compare(1, 2, "a", "b"), "/", mod.compare(NaN, NaN, "b", "b"));
