print(mod.inRecord({ a: 1 }, "a"), mod.inRecord({ a: 1 }, "b"));
print(mod.inRecord({ a: 1 }, "toString"), mod.inRecord({}, "constructor"));
print(mod.inObject("x"), mod.inObject("z"), mod.inObject("valueOf"), mod.inObject("__proto__"));
print(mod.literalKeys());
print(mod.enumerated());
