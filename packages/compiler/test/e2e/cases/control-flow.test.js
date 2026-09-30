const run = (name, ...args) => {
  mod.reset();
  print(name, mod[name](...args), "|", mod.trail());
};

print("sign", mod.sign(3), mod.sign(-2), mod.sign(0), mod.sign(-0), mod.sign(NaN));
print("clamp", mod.clamp(5, 0, 3), mod.clamp(-1, 0, 3), mod.clamp(2, 0, 3), mod.clamp(NaN, 0, 3));
print("sumTo", mod.sumTo(10), mod.sumTo(0), mod.sumTo(2.5));
print("countdown", mod.countdown(3), "/", mod.countdown(0));
print("oddsBelow", mod.oddsBelow(8));
print("firstSquareOver", mod.firstSquareOver(50), mod.firstSquareOver(-1));
print("pairs", mod.pairs(4));
print("skipBlock", mod.skipBlock(true), "/", mod.skipBlock(false));
print("doContinue", mod.doContinue(4));
run("conditions");

mod.reset();
try {
  mod.throwsOut(4);
} catch (e) {
  print("throwsOut", e.message, mod.totals());
}

print(
  "ternary",
  mod.ternary(5),
  "/",
  mod.ternary(-500),
  "/",
  mod.ternary(0),
  "/",
  mod.ternary(NaN),
);
run("increments");
print("bits", mod.bits(0x1234, 3), "/", mod.bits(-7, 2 ** 32 + 5));
run("optionals", 4);
run("optionals", undefined);
mod.reset();
print("optionals zero", mod.optionals(0));
print("kinds", mod.kinds("a"), mod.kinds(21), mod.kinds(true), mod.kinds(false));
print("truthy", mod.truthy("", 0), mod.truthy("x", 0), mod.truthy("", 2), mod.truthy("x", NaN));
print("reassign", mod.reassign(3, "a"), mod.reassign(6, "b"));
print("scopes", mod.scopes(4));
print("nanLoop", mod.nanLoop());
print(
  "grade",
  mod.grade(100),
  mod.grade(95),
  mod.grade(81),
  mod.grade(75),
  mod.grade(64),
  mod.grade(12),
);
