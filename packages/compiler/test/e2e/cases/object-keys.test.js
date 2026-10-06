print("keys", mod.keys({ a: 1, b: 2, c: 3, d: "q" }), mod.keys({ a: 1, c: 3, d: "q" }));
print("null", mod.keys({ a: 1, b: null, c: 3, d: "q" }));
print("built", mod.built(true), mod.built(false));
print("nulled", mod.nulled());
