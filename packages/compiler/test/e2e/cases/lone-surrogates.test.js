print(mod.lengths());
print(mod.units());
print(mod.comparisons());
const t = mod.templated(7);
print(t.length, t.charCodeAt(1), t === "7\uD8007");
print(mod.stringified());
const back = mod.echo("\uDC00x\uD800");
print(back.length, back.charCodeAt(0), back.charCodeAt(2), back === "\uDC00x\uD800");
print(mod.same("\uDC00"), mod.same("\uDC01"));
