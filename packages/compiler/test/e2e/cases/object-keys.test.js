print(mod.inRecord({ a: 1 }, "a"), mod.inRecord({ a: 1 }, "b"));
print(mod.inRecord({ a: 1 }, "toString"), mod.inRecord({}, "constructor"));
print(mod.literalKeys());
print(mod.enumerated());
